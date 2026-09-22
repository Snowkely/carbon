import { Body, Controller, Get, HttpCode, Injectable, Post, Put, UseGuards } from "@nestjs/common";
import { JwtService } from "@nestjs/jwt";
import { ApiBadRequestResponse, ApiBearerAuth, ApiBody, ApiConflictResponse, ApiCreatedResponse, ApiForbiddenResponse, ApiNoContentResponse, ApiOkResponse, ApiTags, ApiUnauthorizedResponse } from "@nestjs/swagger";
import { AccountStatus, AccountType, Prisma, ReferenceStatus } from "@prisma/client";
import argon2 from "argon2";
import { createHash, randomUUID } from "node:crypto";
import { loginSchema, profileSchema, studentRegistrationSchema } from "@carbon/contracts";
import { PrismaService } from "../common/prisma.service";
import { apiError } from "../common/api-error";
import { AuthUser, CurrentUser, JwtAuthGuard } from "../common/auth";
import { LoginDto, LogoutDto, RefreshTokenDto, StudentProfileDto, StudentRegistrationDto } from "../openapi/request-dtos";
import { validateRuntimeConfig } from "../common/runtime-config";

const refreshHash = (token: string) => createHash("sha256").update(token).digest("hex");

@Injectable()
export class AuthService {
  constructor(private readonly prisma: PrismaService, private readonly jwt: JwtService) {}

  private tokens(user: { id: string; username: string; accountType: AccountType; authVersion?: number }) {
    const config = validateRuntimeConfig();
    const payload = { sub: user.id, username: user.username, accountType: user.accountType, authVersion: user.authVersion ?? 0 };
    const accessToken = this.jwt.sign(payload);
    const refreshToken = this.jwt.sign({ ...payload, jti: randomUUID(), kind: "refresh" }, { secret: config.jwtRefreshSecret, expiresIn: `${config.refreshTokenTtlDays}d`, algorithm: "HS256" });
    return { accessToken, refreshToken };
  }

  private authenticatedSessionWrites(client: Pick<Prisma.TransactionClient, "authSession" | "loginRecord">, user: { id: string }, refreshToken: string) {
    return [
      client.authSession.create({ data: { userId: user.id, refreshTokenHash: refreshHash(refreshToken), expiresAt: new Date(Date.now() + validateRuntimeConfig().refreshTokenTtlDays * 86_400_000) } }),
      client.loginRecord.create({ data: { userId: user.id, lastSeenAt: new Date() } })
    ];
  }

  private async issueAuthenticatedSession(user: { id: string; username: string; accountType: AccountType; authVersion?: number }) {
    const tokens = this.tokens(user);
    await this.prisma.$transaction(this.authenticatedSessionWrites(this.prisma, user, tokens.refreshToken));
    return tokens;
  }

  async registerStudent(input: unknown) {
    const parsed = studentRegistrationSchema.safeParse(input);
    if (!parsed.success) apiError(400, "VALIDATION_ERROR", "Invalid registration data", { issues: parsed.error.issues });
    const exists = await this.prisma.userAccount.findUnique({ where: { username: parsed.data.username } });
    if (exists) apiError(409, "USERNAME_ALREADY_EXISTS", "This username is already in use.");
    const passwordHash = await argon2.hash(parsed.data.password, { type: argon2.argon2id });
    try {
      return await this.prisma.$transaction(async (tx) => {
        const user = await tx.userAccount.create({ data: { username: parsed.data.username, passwordHash, accountType: AccountType.STUDENT } });
        const tokens = this.tokens(user);
        await Promise.all(this.authenticatedSessionWrites(tx, user, tokens.refreshToken));
        return { ...tokens, accountType: user.accountType, profileRequired: true };
      });
    } catch (error) {
      if ((error as { code?: string }).code === "P2002") apiError(409, "USERNAME_ALREADY_EXISTS", "This username is already in use.");
      throw error;
    }
  }

  async login(input: unknown) {
    const parsed = loginSchema.safeParse(input);
    if (!parsed.success) apiError(400, "VALIDATION_ERROR", "Invalid login data");
    const user = await this.prisma.userAccount.findUnique({ where: { username: parsed.data.username }, include: { student: true, teacher: true } });
    if (!user || !(await argon2.verify(user.passwordHash, parsed.data.password))) apiError(401, "INVALID_CREDENTIALS", "Invalid username or password");
    if (user.status !== AccountStatus.ACTIVE) apiError(401, "ACCOUNT_DISABLED", "This account is disabled");
    const tokens = await this.issueAuthenticatedSession(user);
    return { ...tokens, accountType: user.accountType, teacherRole: user.teacher?.platformRole, profileRequired: user.accountType === AccountType.STUDENT ? !user.student : !user.teacher };
  }

  async refresh(input: { refreshToken?: string }) {
    if (!input.refreshToken) apiError(400, "VALIDATION_ERROR", "refreshToken is required");
    let payload: { sub: string; username: string; accountType: AccountType; authVersion?: number };
    try { payload = this.jwt.verify(input.refreshToken, { secret: validateRuntimeConfig().jwtRefreshSecret, algorithms: ["HS256"] }); }
    catch { apiError(401, "SESSION_EXPIRED", "Refresh session is invalid or expired"); }
    const session = await this.prisma.authSession.findUnique({ where: { refreshTokenHash: refreshHash(input.refreshToken) } });
    if (!session || session.revokedAt || session.expiresAt <= new Date()) apiError(401, "SESSION_EXPIRED", "Refresh session is invalid or expired");
    const user = await this.prisma.userAccount.findUniqueOrThrow({ where: { id: payload.sub } });
    if (user.status !== AccountStatus.ACTIVE || user.authVersion !== (payload.authVersion ?? 0)) apiError(401, "SESSION_EXPIRED", "Refresh session is invalid or expired");
    const tokens = this.tokens(user);
    await this.prisma.$transaction([
      this.prisma.authSession.update({ where: { id: session.id }, data: { revokedAt: new Date() } }),
      this.prisma.authSession.create({ data: { userId: user.id, refreshTokenHash: refreshHash(tokens.refreshToken), expiresAt: new Date(Date.now() + validateRuntimeConfig().refreshTokenTtlDays * 86_400_000) } })
    ]);
    return tokens;
  }

  async logout(user: AuthUser, input: { refreshToken?: string }) {
    const now = new Date();
    await this.prisma.$transaction(async (tx) => {
      if (input.refreshToken) await tx.authSession.updateMany({ where: { userId: user.userId, refreshTokenHash: refreshHash(input.refreshToken), revokedAt: null }, data: { revokedAt: now } });
      const login = await tx.loginRecord.findFirst({ where: { userId: user.userId, logoutAt: null }, orderBy: { loginAt: "desc" } });
      if (login) await tx.loginRecord.update({ where: { id: login.id }, data: { logoutAt: now, closeReason: "EXPLICIT_LOGOUT", lastSeenAt: now } });
    });
  }

  async references() {
    return this.prisma.school.findMany({ where: { status: ReferenceStatus.ACTIVE }, select: { id: true, name: true, classes: { where: { status: ReferenceStatus.ACTIVE }, select: { id: true, name: true }, orderBy: { name: "asc" } } } });
  }

  async profile(user: AuthUser) {
    if (user.accountType !== AccountType.STUDENT) apiError(403, "FORBIDDEN", "Student account required");
    return this.prisma.studentProfile.findUnique({ where: { userId: user.userId }, include: { school: true, schoolClass: true } });
  }

  async updateProfile(user: AuthUser, input: unknown) {
    if (user.accountType !== AccountType.STUDENT) apiError(403, "FORBIDDEN", "Student account required");
    const parsed = profileSchema.safeParse(input);
    if (!parsed.success) apiError(400, "VALIDATION_ERROR", "Invalid profile data", { issues: parsed.error.issues });
    const schoolClass = await this.prisma.schoolClass.findFirst({ where: { id: parsed.data.classId, schoolId: parsed.data.schoolId, status: ReferenceStatus.ACTIVE, school: { status: ReferenceStatus.ACTIVE } } });
    if (!schoolClass) apiError(400, "INVALID_REFERENCE", "School and Class must be selected from active reference data");
    try {
      return await this.prisma.studentProfile.upsert({ where: { userId: user.userId }, update: { name: parsed.data.name, studentId: parsed.data.studentId, schoolId: parsed.data.schoolId, classId: parsed.data.classId }, create: { userId: user.userId, ...parsed.data } });
    } catch (error) {
      if ((error as { code?: string }).code === "P2002") apiError(409, "STUDENT_ID_DUPLICATE", "Student ID already exists in this school");
      throw error;
    }
  }
}

@Controller()
@ApiTags("Auth")
export class AuthController {
  constructor(private readonly service: AuthService) {}
  @Post("auth/student/register") @ApiBody({ type: StudentRegistrationDto }) @ApiCreatedResponse({ description: "Student account registered and authenticated" }) @ApiBadRequestResponse({ description: "Invalid registration data" }) @ApiConflictResponse({ description: "Username already registered" }) registerStudent(@Body() body: StudentRegistrationDto) { return this.service.registerStudent(body); }
  @Post("auth/login") @HttpCode(200) @ApiBody({ type: LoginDto }) @ApiOkResponse({ description: "Authenticated" }) @ApiBadRequestResponse({ description: "Invalid login data" }) @ApiUnauthorizedResponse({ description: "Invalid credentials" }) login(@Body() body: LoginDto) { return this.service.login(body); }
  @Post("auth/refresh") @HttpCode(200) @ApiBody({ type: RefreshTokenDto }) @ApiOkResponse({ description: "Tokens refreshed" }) @ApiBadRequestResponse({ description: "refreshToken is required" }) @ApiUnauthorizedResponse({ description: "Refresh session is invalid or expired" }) refresh(@Body() body: RefreshTokenDto) { return this.service.refresh(body); }
  @Post("auth/logout") @UseGuards(JwtAuthGuard) @ApiBearerAuth() @HttpCode(204) @ApiBody({ type: LogoutDto }) @ApiNoContentResponse({ description: "Logged out" }) @ApiUnauthorizedResponse({ description: "Authentication required" }) logout(@CurrentUser() user: AuthUser, @Body() body: LogoutDto) { return this.service.logout(user, body); }
  @Get("reference/schools") references() { return this.service.references(); }
  @Get("student/profile") @UseGuards(JwtAuthGuard) @ApiTags("Student") @ApiBearerAuth() @ApiUnauthorizedResponse({ description: "Authentication required" }) @ApiForbiddenResponse({ description: "Student account required" }) profile(@CurrentUser() user: AuthUser) { return this.service.profile(user); }
  @Put("student/profile") @UseGuards(JwtAuthGuard) @ApiTags("Student") @ApiBearerAuth() @ApiBody({ type: StudentProfileDto }) @ApiBadRequestResponse({ description: "Invalid profile or controlled reference data" }) @ApiUnauthorizedResponse({ description: "Authentication required" }) @ApiForbiddenResponse({ description: "Student account required" }) @ApiConflictResponse({ description: "Student ID already exists in this school" }) updateProfile(@CurrentUser() user: AuthUser, @Body() body: StudentProfileDto) { return this.service.updateProfile(user, body); }
}
