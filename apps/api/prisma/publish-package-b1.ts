import { PrismaClient } from "@prisma/client";
import { publishPackageB1Content } from "./package-b1-content";

const prisma = new PrismaClient();
publishPackageB1Content(prisma)
  .then((version) => console.log(`Published ${version.versionCode} (${version.id}) without changing existing Workshop references.`))
  .finally(() => prisma.$disconnect());
