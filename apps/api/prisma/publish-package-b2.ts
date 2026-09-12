import { PrismaClient } from "@prisma/client";
import { publishPackageB2Content } from "./package-b2-content";

const prisma = new PrismaClient();
publishPackageB2Content(prisma)
  .then((version) => console.log(`Published ${version.versionCode} (${version.id}) without changing existing Workshop references.`))
  .finally(() => prisma.$disconnect());
