import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const migration = readFileSync(resolve(process.cwd(), "prisma/migrations/20260831000100_init/migration.sql"), "utf8");
const feedbackMigration = readFileSync(resolve(process.cwd(), "prisma/migrations/20260904000100_final_phase1_feedback/migration.sql"), "utf8");
const hardeningMigration = readFileSync(resolve(process.cwd(), "prisma/migrations/20260904000200_final_phase1_hardening/migration.sql"), "utf8");
const scoreAdjustmentIntegrityMigration = readFileSync(resolve(process.cwd(), "prisma/migrations/20260912000100_score_adjustment_same_stream_integrity/migration.sql"), "utf8");
const schema = readFileSync(resolve(process.cwd(), "prisma/schema.prisma"), "utf8");
const seed = readFileSync(resolve(process.cwd(), "prisma/seed.ts"), "utf8");
const teacherService = readFileSync(resolve(process.cwd(), "src/teacher/teacher.ts"), "utf8");

describe("database-enforced frozen invariants", () => {
  it("uses CITEXT and a global username unique index", () => {
    expect(migration).toContain('CREATE EXTENSION IF NOT EXISTS "citext"');
    expect(schema).toMatch(/username\s+String\s+@unique\s+@db\.Citext/);
    expect(migration).toContain('CREATE UNIQUE INDEX "user_account_username_key" ON "user_account"("username")');
  });

  it("enforces school-scoped Student ID uniqueness", () => {
    expect(schema).toContain("@@unique([schoolId, studentId])");
    expect(migration).toContain('CREATE UNIQUE INDEX "student_profile_school_id_student_id_key"');
  });

  it("rejects duplicate nullable and non-null Session audiences", () => {
    expect(migration).toMatch(/workshop_session_audience_whole_school_key[\s\S]*WHERE "class_id" IS NULL/);
    expect(migration).toMatch(/workshop_session_audience_specific_class_key[\s\S]*WHERE "class_id" IS NOT NULL/);
  });

  it("keeps both adjustment pointers in the same stream", () => {
    expect(scoreAdjustmentIntegrityMigration).toMatch(/score_adjustment_supersedes_same_stream_fkey[\s\S]*FOREIGN KEY \("supersedes_adjustment_id", "stream_id"\)[\s\S]*REFERENCES "score_adjustment" \("id", "stream_id"\)/);
    expect(scoreAdjustmentIntegrityMigration).toMatch(/score_adjustment_current_same_stream_fkey[\s\S]*FOREIGN KEY \("current_adjustment_id", "id"\)[\s\S]*REFERENCES "score_adjustment" \("id", "stream_id"\)/);
    expect(scoreAdjustmentIntegrityMigration).toContain('DROP CONSTRAINT "score_adjustment_supersedes_adjustment_id_fkey"');
    expect(scoreAdjustmentIntegrityMigration).toContain('DROP CONSTRAINT "score_adjustment_stream_current_adjustment_id_fkey"');
    expect(schema).toMatch(/CurrentAdjustment"\s*,\s*fields:\s*\[currentAdjustmentId, id\],\s*references:\s*\[id, streamId\]/);
    expect(schema).toMatch(/AdjustmentSupersede"\s*,\s*fields:\s*\[supersedesAdjustmentId, streamId\],\s*references:\s*\[id, streamId\]/);
  });

  it("makes QuestionAttempt update and delete impossible", () => {
    expect(migration).toContain("CREATE FUNCTION \"prevent_question_attempt_mutation\"");
    expect(migration).toMatch(/BEFORE UPDATE OR DELETE ON "question_attempt"/);
  });

  it("enforces selected-attempt ownership and versioned content references", () => {
    expect(migration).toMatch(/question_result_selected_attempt_same_question_fkey[\s\S]*mission_attempt_id[\s\S]*question_template_id/);
    expect(schema).toMatch(/contentVersionId\s+String/);
    expect(schema).toMatch(/screenTemplateId\s+String/);
  });

  it("enforces Feedback form version and response ownership in the database", () => {
    expect(feedbackMigration).toContain('CREATE UNIQUE INDEX "feedback_form_stable_id_version_key"');
    expect(feedbackMigration).toMatch(/feedback_response_submission_same_form_fkey[\s\S]*\("submission_id", "feedback_form_id"\)/);
    expect(feedbackMigration).toMatch(/feedback_response_question_same_form_fkey[\s\S]*\("feedback_question_id", "feedback_form_id"\)/);
    expect(feedbackMigration).toContain('CREATE TRIGGER "feedback_response_invariants"');
    expect(feedbackMigration).toContain("FB-Q02 Other requires non-empty other_text");
  });

  it("seeds the final scoring weights, single Hint policy, and future M6 round weights", () => {
    expect(seed).toContain("M1: 0.15, M2: 0.15, M3: 0.15, M4: 0.15, M5: 0.2, M6: 0.2");
    expect(seed).toContain("assistance: { noHint: 8, hintUsed: 6, reveal: 0 }");
    expect(seed).not.toMatch(/hint1|hint2|hint3/);
    expect(seed).toContain("roundWeights: { R1: 0.5, R2: 0.25, R3: 0.25 }");
  });

  it("locks an adjustment stream row before comparing the current pointer", () => {
    expect(teacherService).toMatch(/SELECT "id", "current_adjustment_id"[\s\S]*FOR UPDATE/);
    expect(teacherService).toContain("SCORE_ADJUSTMENT_STALE");
  });

  it("makes adjustments and submitted Feedback append-only evidence", () => {
    expect(hardeningMigration).toMatch(/BEFORE UPDATE OR DELETE ON "score_adjustment"/);
    expect(hardeningMigration).toMatch(/BEFORE UPDATE OR DELETE ON "feedback_submission"/);
    expect(hardeningMigration).toMatch(/BEFORE UPDATE OR DELETE ON "feedback_response"/);
  });
});
