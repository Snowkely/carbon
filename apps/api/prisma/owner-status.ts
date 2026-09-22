import { AccountStatus, PrismaClient, WorkshopRole } from "@prisma/client";

const prisma = new PrismaClient();
prisma.teacherProfile.count({ where: { platformRole: WorkshopRole.OWNER, user: { status: AccountStatus.ACTIVE } } })
  .then((count) => { process.stdout.write(count > 0 ? "OWNER_PRESENT\n" : "OWNER_REQUIRED\n"); process.exitCode = count > 0 ? 0 : 10; })
  .catch(() => { process.stderr.write("Unable to check OWNER status.\n"); process.exitCode = 1; })
  .finally(() => prisma.$disconnect());
