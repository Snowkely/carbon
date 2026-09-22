import { HttpException } from "@nestjs/common";
import { AccountType, SessionStatus, UnlockSource } from "@prisma/client";
import argon2 from "argon2";
import { describe, expect, it, vi } from "vitest";
import { AuthController, AuthService } from "./auth";
import { StudentService } from "../student/student";

const response = (error: unknown) => (error as HttpException).getResponse() as { error: { code: string; message: string } };

function registrationHarness(existing: unknown = null) {
  const create = vi.fn(async ({ data }: any) => ({ id: "student-new", ...data }));
  const prisma: any = {
    userAccount: { findUnique: vi.fn().mockResolvedValue(existing), create },
    authSession: { create: vi.fn().mockResolvedValue({ id: "auth-session" }) },
    loginRecord: { create: vi.fn().mockResolvedValue({ id: "login-record" }) },
    $transaction: vi.fn(async (operation: Promise<unknown>[] | ((tx: any) => Promise<unknown>)) => typeof operation === "function" ? operation(prisma) : Promise.all(operation))
  };
  const jwt: any = { sign: vi.fn().mockReturnValueOnce("access-token").mockReturnValueOnce("refresh-token") };
  return { service: new AuthService(prisma, jwt), prisma, create };
}

describe("public student self-registration", () => {
  it("creates only a STUDENT, hashes its password, authenticates it, and returns no credential material", async () => {
    const { service, prisma, create } = registrationHarness();
    const result = await service.registerStudent({ username: "StudentAlex", password: "Carbon123!" });
    const stored = create.mock.calls[0]![0].data;

    expect(stored.accountType).toBe(AccountType.STUDENT);
    expect(stored.passwordHash).not.toBe("Carbon123!");
    await expect(argon2.verify(stored.passwordHash, "Carbon123!")).resolves.toBe(true);
    expect(result).toEqual({ accessToken: "access-token", refreshToken: "refresh-token", accountType: AccountType.STUDENT, profileRequired: true });
    expect(JSON.stringify(result)).not.toMatch(/password|hash/i);
    expect(prisma.authSession.create).toHaveBeenCalledOnce();
    expect(prisma.loginRecord.create).toHaveBeenCalledOnce();
    expect(prisma).not.toHaveProperty("workshopParticipant");
    expect(prisma).not.toHaveProperty("missionUnlock");
    expect(prisma).not.toHaveProperty("scoreAdjustment");
  });

  it.each([{ role: "OWNER" }, { role: "INSTRUCTOR" }, { accountType: "TEACHER" }])("rejects privilege-bearing input %o", async (extra) => {
    const { service, create } = registrationHarness();
    await expect(service.registerStudent({ username: "student", password: "Carbon123!", ...extra })).rejects.toSatisfy((error: unknown) => response(error).error.code === "VALIDATION_ERROR");
    expect(create).not.toHaveBeenCalled();
  });

  it.each(["StudentAlex", "studentalex"])("maps an existing CITEXT username (%s) to a safe conflict", async (username) => {
    const { service, create } = registrationHarness({ id: "existing" });
    await expect(service.registerStudent({ username, password: "Carbon123!" })).rejects.toSatisfy((error: unknown) => {
      const body = response(error);
      return (error as HttpException).getStatus() === 409 && body.error.code === "USERNAME_ALREADY_EXISTS" && body.error.message === "This username is already in use.";
    });
    expect(create).not.toHaveBeenCalled();
  });

  it("maps a database uniqueness race to the same safe conflict", async () => {
    const { service, create } = registrationHarness();
    create.mockRejectedValueOnce({ code: "P2002", meta: { target: "user_account_username_key" } });
    await expect(service.registerStudent({ username: "student", password: "Carbon123!" })).rejects.toSatisfy((error: unknown) => response(error).error.code === "USERNAME_ALREADY_EXISTS");
  });

  it("rejects a weak password before persistence", async () => {
    const { service, create } = registrationHarness();
    await expect(service.registerStudent({ username: "student", password: "short" })).rejects.toSatisfy((error: unknown) => response(error).error.code === "VALIDATION_ERROR");
    expect(create).not.toHaveBeenCalled();
  });

  it("exposes registration without an authenticated user argument", async () => {
    const service = { registerStudent: vi.fn().mockResolvedValue({ profileRequired: true }) } as unknown as AuthService;
    await expect(new AuthController(service).registerStudent({ username: "student", password: "Carbon123!" })).resolves.toEqual({ profileRequired: true });
    expect(service.registerStudent).toHaveBeenCalledWith({ username: "student", password: "Carbon123!" });
  });

  it("leaves normal existing Student sign-in on the shared session path", async () => {
    const passwordHash = await argon2.hash("Carbon123!", { type: argon2.argon2id });
    const { service, prisma } = registrationHarness({ id: "student-existing", username: "student.existing", accountType: AccountType.STUDENT, status: "ACTIVE", passwordHash, student: { userId: "student-existing" }, teacher: null });
    await expect(service.login({ username: "STUDENT.EXISTING", password: "Carbon123!" })).resolves.toEqual({ accessToken: "access-token", refreshToken: "refresh-token", accountType: AccountType.STUDENT, profileRequired: false });
    expect(prisma.authSession.create).toHaveBeenCalledOnce();
    expect(prisma.loginRecord.create).toHaveBeenCalledOnce();
  });
});

describe("registration to existing profile and Session discovery integration", () => {
  it("keeps profile setup, audience matching, and INITIAL-only M1 availability authoritative", async () => {
    let profile: any = null;
    const participant = { id: "participant-new", studentId: "student-new", session: { id: "session-1", status: SessionStatus.ACTIVE, workshop: { contentVersionId: "content-v5" } } };
    const prisma: any = {
      userAccount: { findUnique: vi.fn().mockResolvedValue(null), create: vi.fn(async ({ data }: any) => ({ id: "student-new", ...data })) },
      authSession: { create: vi.fn().mockResolvedValue({}) }, loginRecord: { create: vi.fn().mockResolvedValue({}) },
      schoolClass: { findFirst: vi.fn().mockResolvedValue({ id: "c2222222-2222-4222-8222-222222222222" }) },
      studentProfile: {
        findUnique: vi.fn(async () => profile),
        upsert: vi.fn(async ({ create }: any) => { profile = { ...create, profileCompletedAt: new Date() }; return profile; })
      },
      workshopSession: { findMany: vi.fn().mockResolvedValue([{ id: "session-1", workshopId: "workshop-1", startedAt: new Date(), workshop: { name: "Carbon Lab" } }]) },
      workshopParticipant: { upsert: vi.fn().mockResolvedValue(participant), findUnique: vi.fn().mockResolvedValue(participant) },
      missionTemplate: { findMany: vi.fn().mockResolvedValue([
        { id: "m1", stableId: "M1", titleCn: "M1", titleEn: "Mission 1", sequenceNo: 1, displayConfig: { gameplayImplemented: true } },
        { id: "m2", stableId: "M2", titleCn: "M2", titleEn: "Mission 2", sequenceNo: 2, displayConfig: { gameplayImplemented: true } }
      ]) },
      missionUnlock: { findMany: vi.fn().mockResolvedValue([{ missionTemplateId: "m1", unlockSource: UnlockSource.INITIAL }]) },
      missionAttempt: { findMany: vi.fn().mockResolvedValue([]) },
      $transaction: vi.fn(async (operation: Promise<unknown>[] | ((tx: any) => Promise<unknown>)) => typeof operation === "function" ? operation(prisma) : Promise.all(operation))
    };
    const jwt: any = { sign: vi.fn().mockReturnValueOnce("access-token").mockReturnValueOnce("refresh-token") };
    const auth = new AuthService(prisma, jwt);
    const registration = await auth.registerStudent({ username: "new.student", password: "Carbon123!" });
    const user = { userId: "student-new", username: "new.student", accountType: AccountType.STUDENT };
    expect(registration.profileRequired).toBe(true);
    await expect(auth.profile(user)).resolves.toBeNull();

    await auth.updateProfile(user, { name: "Alex", studentId: "S-NEW", schoolId: "c1111111-1111-4111-8111-111111111111", classId: "c2222222-2222-4222-8222-222222222222" });
    await expect(auth.profile(user)).resolves.toMatchObject({ name: "Alex", studentId: "S-NEW" });

    const studentService = new StudentService(prisma, {} as any);
    await expect(studentService.activeSessions(user)).resolves.toEqual([expect.objectContaining({ id: "session-1", participantId: "participant-new" })]);
    expect(prisma.workshopSession.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ status: SessionStatus.ACTIVE, audiences: { some: { schoolId: profile.schoolId, OR: [{ classId: null }, { classId: profile.classId }] } } }) }));
    const missions = await studentService.missions(user, "session-1");
    expect(missions[0]).toMatchObject({ missionStableId: "M1", accessState: "AVAILABLE", sessionUnlock: { source: UnlockSource.INITIAL }, capabilities: { canStartAttempt: true } });
    expect(missions[1]).toMatchObject({ missionStableId: "M2", accessState: "BLOCKED_SESSION_UNLOCK", capabilities: { canStartAttempt: false } });
    expect(prisma.missionUnlock.findMany).toHaveBeenCalledTimes(1);
  });

  it("preserves the same-school composite Student ID conflict", async () => {
    const prisma: any = { schoolClass: { findFirst: vi.fn().mockResolvedValue({ id: "class" }) }, studentProfile: { upsert: vi.fn().mockRejectedValue({ code: "P2002" }) } };
    const user = { userId: "student-2", username: "student.two", accountType: AccountType.STUDENT };
    await expect(new AuthService(prisma, {} as any).updateProfile(user, { name: "Two", studentId: "S-NEW", schoolId: "c1111111-1111-4111-8111-111111111111", classId: "c2222222-2222-4222-8222-222222222222" })).rejects.toSatisfy((error: unknown) => response(error).error.code === "STUDENT_ID_DUPLICATE");
  });
});
