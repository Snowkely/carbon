import { PrismaClient } from "@prisma/client";
import { publishPackageAContent } from "./package-a-content";

const prisma = new PrismaClient();
publishPackageAContent(prisma)
  .then((version) => console.log(`Published ${version.versionCode} (${version.id}) without changing existing Workshop references.`))
  .finally(() => prisma.$disconnect());
