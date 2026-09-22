import { Body, Controller, Get, Injectable, Param, Patch, Post, UseGuards } from "@nestjs/common";
import { ApiBearerAuth, ApiBody, ApiForbiddenResponse, ApiTags, ApiUnauthorizedResponse } from "@nestjs/swagger";
import { AccountStatus, AccountType, Prisma, TeacherAccountAuditAction, WorkshopRole } from "@prisma/client";
import argon2 from "argon2";
import { changeOwnPasswordSchema, changeTeacherRoleSchema, changeTeacherStatusSchema, createTeacherAccountSchema, resetTeacherPasswordSchema } from "@carbon/contracts";
import { AuthUser, CurrentUser, JwtAuthGuard } from "../common/auth";
import { apiError } from "../common/api-error";
import { PrismaService } from "../common/prisma.service";
import { ChangeOwnPasswordDto, ChangeTeacherRoleDto, ChangeTeacherStatusDto, CreateTeacherAccountDto, ResetTeacherPasswordDto } from "../openapi/request-dtos";

const managedRoles = [WorkshopRole.INSTRUCTOR, WorkshopRole.VIEWER] as const;
const json = (value: unknown) => value as Prisma.InputJsonValue;

@Injectable()
export class TeacherAccountService {
  constructor(private readonly prisma: PrismaService) {}

  private ensureTeacher(user: AuthUser) {
    if (user.accountType !== AccountType.TEACHER) apiError(403, "FORBIDDEN", "Teacher account required");
  }

  private async actor(user: AuthUser, ownerRequired = false) {
    this.ensureTeacher(user);
    const actor = await this.prisma.teacherProfile.findUnique({ where: { userId: user.userId }, include: { user: true } });
    if (!actor || actor.user.status !== AccountStatus.ACTIVE || (ownerRequired && actor.platformRole !== WorkshopRole.OWNER)) apiError(403, "FORBIDDEN", ownerRequired ? "OWNER permission required" : "Teacher account required");
    return actor;
  }

  private async target(id: string) {
    const target = await this.prisma.userAccount.findFirst({ where: { id, accountType: AccountType.TEACHER }, include: { teacher: true } });
    const teacher = target?.teacher;
    if (!target || !teacher) apiError(404, "TEACHER_NOT_FOUND", "Teacher account not found");
    return { ...target, teacher };
  }

  private sessionRevocations(tx: Prisma.TransactionClient, userId: string, now: Date) {
    return [
      tx.authSession.updateMany({ where: { userId, revokedAt: null }, data: { revokedAt: now } }),
      tx.loginRecord.updateMany({ where: { userId, logoutAt: null }, data: { logoutAt: now, lastSeenAt: now, closeReason: "REVOKED" } })
    ];
  }

  async current(user: AuthUser) {
    const actor = await this.actor(user);
    return { id: actor.userId, username: actor.user.username, displayName: actor.name, role: actor.platformRole, status: actor.user.status };
  }

  async list(user: AuthUser) {
    await this.actor(user, true);
    const accounts = await this.prisma.userAccount.findMany({
      where: { accountType: AccountType.TEACHER }, orderBy: { createdAt: "asc" },
      select: { id: true, username: true, status: true, createdAt: true, teacher: { select: { name: true, platformRole: true } }, loginRecords: { select: { loginAt: true }, orderBy: { loginAt: "desc" }, take: 1 } }
    });
    return accounts.map(({ teacher, loginRecords, ...account }) => ({ ...account, displayName: teacher?.name ?? "", role: teacher?.platformRole ?? WorkshopRole.VIEWER, lastLoginAt: loginRecords[0]?.loginAt ?? null }));
  }

  async audit(user: AuthUser) {
    await this.actor(user, true);
    return this.prisma.teacherAccountAudit.findMany({
      orderBy: { createdAt: "desc" }, take: 100,
      select: { id: true, action: true, details: true, createdAt: true, actor: { select: { user: { select: { username: true } } } }, target: { select: { user: { select: { username: true } } } } }
    });
  }

  async create(user: AuthUser, input: unknown) {
    const actor = await this.actor(user, true);
    const parsed = createTeacherAccountSchema.safeParse(input);
    if (!parsed.success) apiError(400, "VALIDATION_ERROR", "Invalid teacher account data", { issues: parsed.error.issues });
    const exists = await this.prisma.userAccount.findUnique({ where: { username: parsed.data.username } });
    if (exists) apiError(409, "USERNAME_ALREADY_EXISTS", "This username is already in use.");
    const passwordHash = await argon2.hash(parsed.data.password, { type: argon2.argon2id });
    try {
      return await this.prisma.$transaction(async (tx) => {
        const account = await tx.userAccount.create({ data: { username: parsed.data.username, passwordHash, accountType: AccountType.TEACHER } });
        const profile = await tx.teacherProfile.create({ data: { userId: account.id, schoolId: actor.schoolId, name: parsed.data.displayName, platformRole: parsed.data.role } });
        await tx.teacherAccountAudit.create({ data: { actorTeacherId: actor.userId, targetTeacherId: account.id, action: TeacherAccountAuditAction.TEACHER_CREATED, details: json({ role: parsed.data.role }) } });
        return { id: account.id, username: account.username, displayName: profile.name, role: profile.platformRole, status: account.status, createdAt: account.createdAt, lastLoginAt: null };
      });
    } catch (error) {
      if ((error as { code?: string }).code === "P2002") apiError(409, "USERNAME_ALREADY_EXISTS", "This username is already in use.");
      throw error;
    }
  }

  async changeRole(user: AuthUser, id: string, input: unknown) {
    const actor = await this.actor(user, true);
    const parsed = changeTeacherRoleSchema.safeParse(input);
    if (!parsed.success) apiError(400, "VALIDATION_ERROR", "Role must be INSTRUCTOR or VIEWER");
    const target = await this.target(id);
    if (target.teacher.platformRole === WorkshopRole.OWNER) await this.rejectOwnerMutation(target.id);
    return this.prisma.$transaction(async (tx) => {
      const profile = await tx.teacherProfile.update({ where: { userId: id }, data: { platformRole: parsed.data.role } });
      await tx.teacherAccountAudit.create({ data: { actorTeacherId: actor.userId, targetTeacherId: id, action: TeacherAccountAuditAction.TEACHER_ROLE_CHANGED, details: json({ from: target.teacher!.platformRole, to: parsed.data.role }) } });
      return { id, role: profile.platformRole };
    });
  }

  async changeStatus(user: AuthUser, id: string, input: unknown) {
    const actor = await this.actor(user, true);
    const parsed = changeTeacherStatusSchema.safeParse(input);
    if (!parsed.success) apiError(400, "VALIDATION_ERROR", "Status must be ACTIVE or DISABLED");
    if (id === user.userId && parsed.data.status === AccountStatus.DISABLED) apiError(409, "CANNOT_DISABLE_SELF", "You cannot disable your own account");
    const target = await this.target(id);
    if (target.teacher.platformRole === WorkshopRole.OWNER && parsed.data.status === AccountStatus.DISABLED) await this.rejectOwnerMutation(target.id);
    const now = new Date();
    return this.prisma.$transaction(async (tx) => {
      const account = await tx.userAccount.update({ where: { id }, data: { status: parsed.data.status, authVersion: { increment: 1 } } });
      if (parsed.data.status === AccountStatus.DISABLED) await Promise.all(this.sessionRevocations(tx, id, now));
      await tx.teacherAccountAudit.create({ data: { actorTeacherId: actor.userId, targetTeacherId: id, action: parsed.data.status === AccountStatus.DISABLED ? TeacherAccountAuditAction.TEACHER_DISABLED : TeacherAccountAuditAction.TEACHER_ENABLED, details: json({}) } });
      return { id: account.id, status: account.status };
    });
  }

  private async rejectOwnerMutation(targetId: string): Promise<never> {
    const activeOwners = await this.prisma.teacherProfile.count({ where: { platformRole: WorkshopRole.OWNER, user: { status: AccountStatus.ACTIVE } } });
    if (activeOwners <= 1) apiError(409, "LAST_ACTIVE_OWNER", "The final active OWNER cannot be changed");
    apiError(409, "OWNER_MANAGEMENT_RESTRICTED", "OWNER accounts are managed only through the secure admin process", { targetId });
  }

  async resetPassword(user: AuthUser, id: string, input: unknown) {
    const actor = await this.actor(user, true);
    const parsed = resetTeacherPasswordSchema.safeParse(input);
    if (!parsed.success) apiError(400, "INVALID_PASSWORD", "Password must be between 8 and 128 characters");
    const target = await this.target(id);
    if (!managedRoles.includes(target.teacher.platformRole as typeof managedRoles[number])) await this.rejectOwnerMutation(id);
    const passwordHash = await argon2.hash(parsed.data.password, { type: argon2.argon2id });
    const now = new Date();
    await this.prisma.$transaction(async (tx) => {
      await tx.userAccount.update({ where: { id }, data: { passwordHash, authVersion: { increment: 1 } } });
      await Promise.all(this.sessionRevocations(tx, id, now));
      await tx.teacherAccountAudit.create({ data: { actorTeacherId: actor.userId, targetTeacherId: id, action: TeacherAccountAuditAction.TEACHER_PASSWORD_RESET, details: json({ sessionsRevoked: true }) } });
    });
    return { reauthenticate: true };
  }

  async changeOwnPassword(user: AuthUser, input: unknown) {
    await this.actor(user);
    const parsed = changeOwnPasswordSchema.safeParse(input);
    if (!parsed.success) apiError(400, "INVALID_PASSWORD", "Passwords must be between 8 and 128 characters");
    const account = await this.prisma.userAccount.findUniqueOrThrow({ where: { id: user.userId } });
    if (!(await argon2.verify(account.passwordHash, parsed.data.currentPassword))) apiError(400, "CURRENT_PASSWORD_INVALID", "Current password is incorrect");
    const passwordHash = await argon2.hash(parsed.data.newPassword, { type: argon2.argon2id });
    const now = new Date();
    await this.prisma.$transaction(async (tx) => {
      await tx.userAccount.update({ where: { id: user.userId }, data: { passwordHash, authVersion: { increment: 1 } } });
      await Promise.all(this.sessionRevocations(tx, user.userId, now));
      await tx.teacherAccountAudit.create({ data: { actorTeacherId: user.userId, targetTeacherId: user.userId, action: TeacherAccountAuditAction.TEACHER_PASSWORD_CHANGED, details: json({ sessionsRevoked: true }) } });
    });
    return { reauthenticate: true };
  }
}

@Controller("teacher")
@ApiTags("Teacher Accounts")
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@ApiUnauthorizedResponse({ description: "Authentication required" })
@ApiForbiddenResponse({ description: "OWNER permission required" })
export class TeacherAccountController {
  constructor(private readonly service: TeacherAccountService) {}
  @Get("account") current(@CurrentUser() user: AuthUser) { return this.service.current(user); }
  @Post("account/change-password") @ApiBody({ type: ChangeOwnPasswordDto }) changeOwnPassword(@CurrentUser() user: AuthUser, @Body() body: ChangeOwnPasswordDto) { return this.service.changeOwnPassword(user, body); }
  @Get("accounts") list(@CurrentUser() user: AuthUser) { return this.service.list(user); }
  @Get("accounts/audit") audit(@CurrentUser() user: AuthUser) { return this.service.audit(user); }
  @Post("accounts") @ApiBody({ type: CreateTeacherAccountDto }) create(@CurrentUser() user: AuthUser, @Body() body: CreateTeacherAccountDto) { return this.service.create(user, body); }
  @Patch("accounts/:id/role") @ApiBody({ type: ChangeTeacherRoleDto }) changeRole(@CurrentUser() user: AuthUser, @Param("id") id: string, @Body() body: ChangeTeacherRoleDto) { return this.service.changeRole(user, id, body); }
  @Patch("accounts/:id/status") @ApiBody({ type: ChangeTeacherStatusDto }) changeStatus(@CurrentUser() user: AuthUser, @Param("id") id: string, @Body() body: ChangeTeacherStatusDto) { return this.service.changeStatus(user, id, body); }
  @Post("accounts/:id/reset-password") @ApiBody({ type: ResetTeacherPasswordDto }) resetPassword(@CurrentUser() user: AuthUser, @Param("id") id: string, @Body() body: ResetTeacherPasswordDto) { return this.service.resetPassword(user, id, body); }
}
