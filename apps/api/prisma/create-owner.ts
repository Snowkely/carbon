import { PrismaClient } from "@prisma/client";
import { validateRuntimeConfig } from "../src/common/runtime-config";
import { bootstrapFirstOwner } from "./bootstrap-owner";

async function main() {
  const config = validateRuntimeConfig();
  if (!config.databaseUrl) throw new Error("DATABASE_URL is required for OWNER bootstrap");
  const username = process.env.ADMIN_OWNER_USERNAME?.trim();
  const displayName = process.env.ADMIN_OWNER_DISPLAY_NAME?.trim();
  const password = process.env.ADMIN_OWNER_PASSWORD;
  if (!username || !displayName || !password) throw new Error("ADMIN_OWNER_USERNAME, ADMIN_OWNER_DISPLAY_NAME, and ADMIN_OWNER_PASSWORD are required");
  const prisma = new PrismaClient();
  try {
    const owner = await bootstrapFirstOwner(prisma, { username, displayName, password, schoolId: process.env.ADMIN_OWNER_SCHOOL_ID?.trim() || undefined });
    process.stdout.write(`Created first OWNER ${owner.username} (${owner.displayName}).\n`);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.message : "OWNER bootstrap failed"}\n`);
  process.exitCode = 1;
});
