-- Add platform-level Teacher authorization without changing Workshop-scoped roles.
CREATE TYPE "TeacherAccountAuditAction" AS ENUM (
  'TEACHER_CREATED',
  'TEACHER_ROLE_CHANGED',
  'TEACHER_DISABLED',
  'TEACHER_ENABLED',
  'TEACHER_PASSWORD_RESET',
  'TEACHER_PASSWORD_CHANGED'
);

ALTER TABLE "user_account"
ADD COLUMN "auth_version" INTEGER NOT NULL DEFAULT 0;

ALTER TABLE "teacher_profile"
ADD COLUMN "platform_role" "WorkshopRole" NOT NULL DEFAULT 'VIEWER';

-- Preserve the strongest role already entrusted to each existing Teacher.
UPDATE "teacher_profile" profile
SET "platform_role" = CASE
  WHEN EXISTS (SELECT 1 FROM "workshop_teacher" membership WHERE membership."teacher_id" = profile."user_id" AND membership."role" = 'OWNER') THEN 'OWNER'::"WorkshopRole"
  WHEN EXISTS (SELECT 1 FROM "workshop_teacher" membership WHERE membership."teacher_id" = profile."user_id" AND membership."role" = 'INSTRUCTOR') THEN 'INSTRUCTOR'::"WorkshopRole"
  ELSE 'VIEWER'::"WorkshopRole"
END;

CREATE TABLE "teacher_account_audit" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "actor_teacher_id" UUID,
  "target_teacher_id" UUID NOT NULL,
  "action" "TeacherAccountAuditAction" NOT NULL,
  "details" JSONB NOT NULL DEFAULT '{}',
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "teacher_account_audit_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "teacher_account_audit_actor_teacher_id_fkey" FOREIGN KEY ("actor_teacher_id") REFERENCES "teacher_profile"("user_id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "teacher_account_audit_target_teacher_id_fkey" FOREIGN KEY ("target_teacher_id") REFERENCES "teacher_profile"("user_id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE INDEX "teacher_account_audit_target_teacher_id_created_at_idx" ON "teacher_account_audit"("target_teacher_id", "created_at");
CREATE INDEX "teacher_account_audit_actor_teacher_id_created_at_idx" ON "teacher_account_audit"("actor_teacher_id", "created_at");
