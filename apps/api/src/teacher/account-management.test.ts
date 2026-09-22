import { HttpException } from "@nestjs/common";
import { AccountStatus, AccountType, TeacherAccountAuditAction, WorkshopRole } from "@prisma/client";
import argon2 from "argon2";
import { describe, expect, it, vi } from "vitest";
import { AuthService } from "../auth/auth";
import { TeacherAccountService } from "./account-management";

const owner = { userId: "owner-1", username: "owner.one", accountType: AccountType.TEACHER };
const instructor = { userId: "instructor-1", username: "teacher.one", accountType: AccountType.TEACHER };
const viewer = { userId: "viewer-1", username: "viewer.one", accountType: AccountType.TEACHER };
const student = { userId: "student-1", username: "student.one", accountType: AccountType.STUDENT };
const responseCode = (error: unknown) => ((error as HttpException).getResponse() as { error: { code: string } }).error.code;
const actorProfile = (role: WorkshopRole, userId = "owner-1") => ({ userId, schoolId: "school-1", name: "Actor", platformRole: role, user: { id: userId, username: "actor", accountType: AccountType.TEACHER, status: AccountStatus.ACTIVE } });

function createHarness(role: WorkshopRole = WorkshopRole.OWNER) {
  const accountCreate = vi.fn(async ({ data }: any) => ({ id: "teacher-new", status: AccountStatus.ACTIVE, createdAt: new Date("2026-09-14"), authVersion: 0, ...data }));
  const profileCreate = vi.fn(async ({ data }: any) => ({ ...data }));
  const auditCreate = vi.fn().mockResolvedValue({});
  const tx: any = { userAccount: { create: accountCreate }, teacherProfile: { create: profileCreate }, teacherAccountAudit: { create: auditCreate } };
  const prisma: any = {
    teacherProfile: { findUnique: vi.fn().mockResolvedValue(actorProfile(role)) },
    userAccount: { findUnique: vi.fn().mockResolvedValue(null) },
    $transaction: vi.fn((callback: (client: any) => unknown) => callback(tx))
  };
  return { service: new TeacherAccountService(prisma), prisma, tx, accountCreate, profileCreate, auditCreate };
}

describe("OWNER Teacher account management", () => {
  it("blocks disabled-account login without revealing status to an incorrect password", async () => {
    const passwordHash = await argon2.hash("Carbon123!", { type: argon2.argon2id });
    const prisma: any = { userAccount: { findUnique: vi.fn().mockResolvedValue({ id: "disabled", username: "disabled.teacher", accountType: AccountType.TEACHER, status: AccountStatus.DISABLED, authVersion: 1, passwordHash, student: null, teacher: { platformRole: WorkshopRole.VIEWER } }) } };
    const service = new AuthService(prisma, {} as any);
    await expect(service.login({ username: "disabled.teacher", password: "WrongCarbon123!" })).rejects.toSatisfy((error: unknown) => responseCode(error) === "INVALID_CREDENTIALS");
    await expect(service.login({ username: "disabled.teacher", password: "Carbon123!" })).rejects.toSatisfy((error: unknown) => responseCode(error) === "ACCOUNT_DISABLED");
  });

  it("lists safe Teacher account data with last login and no credential fields", async () => {
    const prisma: any = { teacherProfile: { findUnique: vi.fn().mockResolvedValue(actorProfile(WorkshopRole.OWNER)) }, userAccount: { findMany: vi.fn().mockResolvedValue([{ id: "t1", username: "teacher.one", status: AccountStatus.ACTIVE, createdAt: new Date(), teacher: { name: "One", platformRole: WorkshopRole.INSTRUCTOR }, loginRecords: [{ loginAt: new Date("2026-09-14") }] }]) } };
    const result = await new TeacherAccountService(prisma).list(owner);
    expect(result[0]).toMatchObject({ username: "teacher.one", displayName: "One", role: WorkshopRole.INSTRUCTOR, status: AccountStatus.ACTIVE });
    expect(JSON.stringify(result)).not.toMatch(/passwordHash|refreshToken|jwt/i);
  });

  it.each([WorkshopRole.INSTRUCTOR, WorkshopRole.VIEWER])("creates %s with an Argon2id hash and an audit event", async (role) => {
    const { service, accountCreate, profileCreate, auditCreate } = createHarness();
    const result = await service.create(owner, { username: `new.${role.toLowerCase()}`, displayName: "New Teacher", role, password: "Carbon123!" });
    const data = accountCreate.mock.calls[0]![0].data;
    expect(data.accountType).toBe(AccountType.TEACHER); expect(data.passwordHash).not.toBe("Carbon123!");
    await expect(argon2.verify(data.passwordHash, "Carbon123!")).resolves.toBe(true);
    expect(profileCreate).toHaveBeenCalledWith({ data: expect.objectContaining({ schoolId: "school-1", platformRole: role }) });
    expect(auditCreate).toHaveBeenCalledWith({ data: expect.objectContaining({ actorTeacherId: owner.userId, action: TeacherAccountAuditAction.TEACHER_CREATED }) });
    expect(JSON.stringify(result)).not.toMatch(/password|hash/i);
  });

  it.each([{ role: "OWNER" }, { role: "STUDENT" }, { role: "ADMIN" }])("rejects malicious create role $role", async (input) => {
    const { service, accountCreate } = createHarness();
    await expect(service.create(owner, { username: "bad.role", displayName: "Bad", password: "Carbon123!", ...input })).rejects.toSatisfy((error: unknown) => responseCode(error) === "VALIDATION_ERROR");
    expect(accountCreate).not.toHaveBeenCalled();
  });

  it.each([[instructor, WorkshopRole.INSTRUCTOR], [viewer, WorkshopRole.VIEWER]] as const)("forbids non-OWNER management", async (user, role) => {
    const { service, accountCreate } = createHarness(role);
    await expect(service.create(user, { username: "forbidden", displayName: "No", role: "VIEWER", password: "Carbon123!" })).rejects.toSatisfy((error: unknown) => responseCode(error) === "FORBIDDEN");
    expect(accountCreate).not.toHaveBeenCalled();
  });

  it.each([[instructor, WorkshopRole.INSTRUCTOR], [viewer, WorkshopRole.VIEWER]] as const)("forbids %s from every management operation", async (user, role) => {
    const { service } = createHarness(role);
    for (const operation of [
      () => service.list(user),
      () => service.audit(user),
      () => service.changeRole(user, "target", { role: "VIEWER" }),
      () => service.changeStatus(user, "target", { status: "DISABLED" }),
      () => service.resetPassword(user, "target", { password: "Carbon123!" })
    ]) await expect(operation()).rejects.toSatisfy((error: unknown) => responseCode(error) === "FORBIDDEN");
  });

  it("forbids STUDENT management", async () => {
    const { service, accountCreate } = createHarness();
    await expect(service.create(student, { username: "forbidden", displayName: "No", role: "VIEWER", password: "Carbon123!" })).rejects.toSatisfy((error: unknown) => responseCode(error) === "FORBIDDEN");
    expect(accountCreate).not.toHaveBeenCalled();
  });

  it("maps a CITEXT duplicate and uniqueness race to USERNAME_ALREADY_EXISTS", async () => {
    const first = createHarness(); first.prisma.userAccount.findUnique.mockResolvedValue({ id: "existing" });
    await expect(first.service.create(owner, { username: "Teacher.One", displayName: "Duplicate", role: "VIEWER", password: "Carbon123!" })).rejects.toSatisfy((error: unknown) => responseCode(error) === "USERNAME_ALREADY_EXISTS");
    const race = createHarness(); race.accountCreate.mockRejectedValueOnce({ code: "P2002" });
    await expect(race.service.create(owner, { username: "teacher.one", displayName: "Race", role: "VIEWER", password: "Carbon123!" })).rejects.toSatisfy((error: unknown) => responseCode(error) === "USERNAME_ALREADY_EXISTS");
  });

  it("changes INSTRUCTOR to VIEWER without permitting OWNER or STUDENT injection", async () => {
    const update = vi.fn().mockResolvedValue({ platformRole: WorkshopRole.VIEWER }); const audit = vi.fn().mockResolvedValue({});
    const target = { id: "target", accountType: AccountType.TEACHER, teacher: { userId: "target", platformRole: WorkshopRole.INSTRUCTOR } };
    const prisma: any = { teacherProfile: { findUnique: vi.fn().mockResolvedValue(actorProfile(WorkshopRole.OWNER)) }, userAccount: { findFirst: vi.fn().mockResolvedValue(target) }, $transaction: vi.fn((callback: any) => callback({ teacherProfile: { update }, teacherAccountAudit: { create: audit } })) };
    await expect(new TeacherAccountService(prisma).changeRole(owner, "target", { role: "VIEWER" })).resolves.toEqual({ id: "target", role: WorkshopRole.VIEWER });
    expect(audit).toHaveBeenCalledWith({ data: expect.objectContaining({ action: TeacherAccountAuditAction.TEACHER_ROLE_CHANGED }) });
    await expect(new TeacherAccountService(prisma).changeRole(owner, "target", { role: "OWNER" })).rejects.toSatisfy((error: unknown) => responseCode(error) === "VALIDATION_ERROR");
    await expect(new TeacherAccountService(prisma).changeRole(owner, "target", { role: "STUDENT" })).rejects.toSatisfy((error: unknown) => responseCode(error) === "VALIDATION_ERROR");
  });

  it("disables and re-enables a managed teacher, revoking sessions and incrementing authVersion", async () => {
    const update = vi.fn(async ({ data }: any) => ({ id: "target", status: data.status })); const revoke = vi.fn().mockResolvedValue({ count: 1 }); const close = vi.fn().mockResolvedValue({ count: 1 }); const audit = vi.fn().mockResolvedValue({});
    const target = { id: "target", accountType: AccountType.TEACHER, status: AccountStatus.ACTIVE, teacher: { userId: "target", platformRole: WorkshopRole.INSTRUCTOR } };
    const tx = { userAccount: { update }, authSession: { updateMany: revoke }, loginRecord: { updateMany: close }, teacherAccountAudit: { create: audit } };
    const prisma: any = { teacherProfile: { findUnique: vi.fn().mockResolvedValue(actorProfile(WorkshopRole.OWNER)) }, userAccount: { findFirst: vi.fn().mockResolvedValue(target) }, $transaction: vi.fn((callback: any) => callback(tx)) };
    const service = new TeacherAccountService(prisma);
    await expect(service.changeStatus(owner, "target", { status: "DISABLED" })).resolves.toEqual({ id: "target", status: "DISABLED" });
    expect(update).toHaveBeenCalledWith({ where: { id: "target" }, data: { status: "DISABLED", authVersion: { increment: 1 } } }); expect(revoke).toHaveBeenCalledOnce(); expect(close).toHaveBeenCalledOnce();
    revoke.mockClear(); close.mockClear();
    await expect(service.changeStatus(owner, "target", { status: "ACTIVE" })).resolves.toEqual({ id: "target", status: "ACTIVE" });
    expect(revoke).not.toHaveBeenCalled(); expect(close).not.toHaveBeenCalled();
  });

  it("blocks self-disable and protects the final active OWNER", async () => {
    const selfPrisma: any = { teacherProfile: { findUnique: vi.fn().mockResolvedValue(actorProfile(WorkshopRole.OWNER)) } };
    await expect(new TeacherAccountService(selfPrisma).changeStatus(owner, owner.userId, { status: "DISABLED" })).rejects.toSatisfy((error: unknown) => responseCode(error) === "CANNOT_DISABLE_SELF");
    const targetOwner = { id: "owner-2", accountType: AccountType.TEACHER, teacher: { userId: "owner-2", platformRole: WorkshopRole.OWNER } };
    const lastPrisma: any = { teacherProfile: { findUnique: vi.fn().mockResolvedValue(actorProfile(WorkshopRole.OWNER)), count: vi.fn().mockResolvedValue(1) }, userAccount: { findFirst: vi.fn().mockResolvedValue(targetOwner) } };
    await expect(new TeacherAccountService(lastPrisma).changeStatus(owner, "owner-2", { status: "DISABLED" })).rejects.toSatisfy((error: unknown) => responseCode(error) === "LAST_ACTIVE_OWNER");
  });

  it("resets a managed password, revokes sessions, and makes only the new credential valid", async () => {
    let passwordHash = await argon2.hash("OldCarbon123!", { type: argon2.argon2id }); let authVersion = 0;
    const target = () => ({ id: "target", username: "teacher.target", accountType: AccountType.TEACHER, status: AccountStatus.ACTIVE, authVersion, passwordHash, student: null, teacher: { userId: "target", platformRole: WorkshopRole.INSTRUCTOR } });
    const tx: any = { userAccount: { update: vi.fn(async ({ data }: any) => { passwordHash = data.passwordHash; authVersion += 1; return target(); }) }, authSession: { updateMany: vi.fn().mockResolvedValue({ count: 1 }), create: vi.fn().mockResolvedValue({}) }, loginRecord: { updateMany: vi.fn().mockResolvedValue({ count: 1 }), create: vi.fn().mockResolvedValue({}) }, teacherAccountAudit: { create: vi.fn().mockResolvedValue({}) } };
    const prisma: any = { teacherProfile: { findUnique: vi.fn().mockResolvedValue(actorProfile(WorkshopRole.OWNER)) }, userAccount: { findFirst: vi.fn(async () => target()), findUnique: vi.fn(async () => target()) }, authSession: tx.authSession, loginRecord: tx.loginRecord, $transaction: vi.fn(async (operation: any) => typeof operation === "function" ? operation(tx) : Promise.all(operation)) };
    await new TeacherAccountService(prisma).resetPassword(owner, "target", { password: "NewCarbon123!" });
    await expect(argon2.verify(passwordHash, "OldCarbon123!")).resolves.toBe(false); await expect(argon2.verify(passwordHash, "NewCarbon123!")).resolves.toBe(true);
    expect(tx.authSession.updateMany).toHaveBeenCalledOnce(); expect(tx.loginRecord.updateMany).toHaveBeenCalledOnce(); expect(authVersion).toBe(1);
    const jwt: any = { sign: vi.fn().mockReturnValueOnce("access").mockReturnValueOnce("refresh") };
    await expect(new AuthService(prisma, jwt).login({ username: "teacher.target", password: "OldCarbon123!" })).rejects.toSatisfy((error: unknown) => responseCode(error) === "INVALID_CREDENTIALS");
    await expect(new AuthService(prisma, jwt).login({ username: "teacher.target", password: "NewCarbon123!" })).resolves.toMatchObject({ accountType: AccountType.TEACHER });
  });

  it("allows all Teacher roles to change their own password after verifying the current password", async () => {
    const oldHash = await argon2.hash("OldCarbon123!", { type: argon2.argon2id }); const update = vi.fn().mockResolvedValue({});
    const tx: any = { userAccount: { update }, authSession: { updateMany: vi.fn().mockResolvedValue({}) }, loginRecord: { updateMany: vi.fn().mockResolvedValue({}) }, teacherAccountAudit: { create: vi.fn().mockResolvedValue({}) } };
    const prisma: any = { teacherProfile: { findUnique: vi.fn().mockResolvedValue(actorProfile(WorkshopRole.VIEWER, viewer.userId)) }, userAccount: { findUniqueOrThrow: vi.fn().mockResolvedValue({ id: viewer.userId, passwordHash: oldHash }) }, $transaction: vi.fn((callback: any) => callback(tx)) };
    await expect(new TeacherAccountService(prisma).changeOwnPassword(viewer, { currentPassword: "wrong-password", newPassword: "NewCarbon123!" })).rejects.toSatisfy((error: unknown) => responseCode(error) === "CURRENT_PASSWORD_INVALID");
    await expect(new TeacherAccountService(prisma).changeOwnPassword(viewer, { currentPassword: "OldCarbon123!", newPassword: "NewCarbon123!" })).resolves.toEqual({ reauthenticate: true });
    expect(update).toHaveBeenCalledWith({ where: { id: viewer.userId }, data: { passwordHash: expect.any(String), authVersion: { increment: 1 } } });
  });
});
