import { AccountType, Prisma, ReferenceStatus, TeacherAccountAuditAction, WorkshopRole, type PrismaClient } from "@prisma/client";
import argon2 from "argon2";
import { passwordSchema, usernameSchema } from "@carbon/contracts";

export type OwnerBootstrapInput = { username: string; displayName: string; password: string; schoolId?: string };

export async function bootstrapFirstOwner(prisma: PrismaClient, input: OwnerBootstrapInput) {
  const username = usernameSchema.safeParse(input.username);
  const displayName = input.displayName.trim();
  const password = passwordSchema.safeParse(input.password);
  if (!username.success || !displayName || displayName.length > 150 || !password.success) throw new Error("Invalid OWNER username, display name, or password (password must be 8-128 characters)");

  const schools = input.schoolId
    ? await prisma.school.findMany({ where: { id: input.schoolId, status: ReferenceStatus.ACTIVE }, take: 2 })
    : await prisma.school.findMany({ where: { status: ReferenceStatus.ACTIVE }, orderBy: { name: "asc" }, take: 2 });
  if (schools.length !== 1) throw new Error(input.schoolId ? "ADMIN_OWNER_SCHOOL_ID must identify one active School" : "Exactly one active School is required, or configure ADMIN_OWNER_SCHOOL_ID");
  const passwordHash = await argon2.hash(password.data, { type: argon2.argon2id });

  try {
    return await prisma.$transaction(async (tx) => {
      const owners = await tx.teacherProfile.count({ where: { platformRole: WorkshopRole.OWNER } });
      if (owners > 0) throw new Error("OWNER_ALREADY_EXISTS: refusing to create another bootstrap OWNER");
      const duplicate = await tx.userAccount.findUnique({ where: { username: username.data } });
      if (duplicate) throw new Error("USERNAME_ALREADY_EXISTS: this username is already in use");
      const account = await tx.userAccount.create({ data: { username: username.data, passwordHash, accountType: AccountType.TEACHER } });
      const profile = await tx.teacherProfile.create({ data: { userId: account.id, schoolId: schools[0]!.id, name: displayName, platformRole: WorkshopRole.OWNER } });
      await tx.teacherAccountAudit.create({ data: { actorTeacherId: null, targetTeacherId: account.id, action: TeacherAccountAuditAction.TEACHER_CREATED, details: { role: WorkshopRole.OWNER, source: "ADMIN_BOOTSTRAP" } } });
      return { id: account.id, username: account.username, displayName: profile.name, role: profile.platformRole };
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
  } catch (error) {
    if ((error as { code?: string }).code === "P2002") throw new Error("USERNAME_ALREADY_EXISTS: this username is already in use");
    throw error;
  }
}
