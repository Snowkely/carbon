import { AccountType, TeacherAccountAuditAction, WorkshopRole } from "@prisma/client";
import argon2 from "argon2";
import { describe, expect, it, vi } from "vitest";
import { bootstrapFirstOwner } from "./bootstrap-owner";

function harness(ownerCount = 0) {
  const userCreate = vi.fn(async ({ data }: any) => ({ id: "owner-new", ...data })); const profileCreate = vi.fn(async ({ data }: any) => data); const auditCreate = vi.fn().mockResolvedValue({});
  const tx: any = { teacherProfile: { count: vi.fn().mockResolvedValue(ownerCount), create: profileCreate }, userAccount: { findUnique: vi.fn().mockResolvedValue(null), create: userCreate }, teacherAccountAudit: { create: auditCreate } };
  const prisma: any = { school: { findMany: vi.fn().mockResolvedValue([{ id: "school-1", name: "School" }]) }, $transaction: vi.fn((callback: any) => callback(tx)) };
  return { prisma, tx, userCreate, profileCreate, auditCreate };
}

describe("first OWNER bootstrap", () => {
  it("creates exactly one audited OWNER with a hash and no plaintext output", async () => {
    const { prisma, userCreate, profileCreate, auditCreate } = harness(); const result = await bootstrapFirstOwner(prisma, { username: "owner.one", displayName: "Owner One", password: "Carbon123!" });
    const stored = userCreate.mock.calls[0]![0].data; expect(stored.accountType).toBe(AccountType.TEACHER); expect(stored.passwordHash).not.toBe("Carbon123!"); await expect(argon2.verify(stored.passwordHash, "Carbon123!")).resolves.toBe(true);
    expect(profileCreate).toHaveBeenCalledWith({ data: expect.objectContaining({ platformRole: WorkshopRole.OWNER }) }); expect(auditCreate).toHaveBeenCalledWith({ data: expect.objectContaining({ actorTeacherId: null, action: TeacherAccountAuditAction.TEACHER_CREATED }) }); expect(JSON.stringify(result)).not.toMatch(/password|hash/i);
  });
  it("preserves existing OWNER data by refusing a second bootstrap OWNER", async () => { const { prisma, userCreate } = harness(1); await expect(bootstrapFirstOwner(prisma, { username: "owner.two", displayName: "Owner Two", password: "Carbon123!" })).rejects.toThrow("OWNER_ALREADY_EXISTS"); expect(userCreate).not.toHaveBeenCalled(); });
  it("rejects duplicate username and invalid bootstrap input safely", async () => { const duplicate = harness(); duplicate.tx.userAccount.findUnique.mockResolvedValue({ id: "existing" }); await expect(bootstrapFirstOwner(duplicate.prisma, { username: "OWNER.ONE", displayName: "Owner", password: "Carbon123!" })).rejects.toThrow("USERNAME_ALREADY_EXISTS"); const invalid = harness(); await expect(bootstrapFirstOwner(invalid.prisma, { username: "x", displayName: "", password: "short" })).rejects.toThrow("Invalid OWNER"); expect(invalid.userCreate).not.toHaveBeenCalled(); });
});
