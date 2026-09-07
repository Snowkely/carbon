-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateExtension
CREATE EXTENSION IF NOT EXISTS "citext";

-- CreateEnum
CREATE TYPE "AccountType" AS ENUM ('STUDENT', 'TEACHER');

-- CreateEnum
CREATE TYPE "AccountStatus" AS ENUM ('ACTIVE', 'SUSPENDED', 'DISABLED');

-- CreateEnum
CREATE TYPE "ReferenceStatus" AS ENUM ('ACTIVE', 'INACTIVE');

-- CreateEnum
CREATE TYPE "LoginCloseReason" AS ENUM ('EXPLICIT_LOGOUT', 'EXPIRED', 'REVOKED');

-- CreateEnum
CREATE TYPE "ContentStatus" AS ENUM ('DRAFT', 'PUBLISHED', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "SourceType" AS ENUM ('REAL_WORLD', 'SIMULATION', 'INTERNAL');

-- CreateEnum
CREATE TYPE "QuestionType" AS ENUM ('TAP', 'DRAG', 'ORDER', 'SC', 'MC', 'NUM', 'SLIDER', 'DECISION', 'REFLECTION');

-- CreateEnum
CREATE TYPE "AnswerMode" AS ENUM ('EXACT', 'MULTI_EXACT', 'NUMERIC', 'STRATEGY');

-- CreateEnum
CREATE TYPE "WorkshopStatus" AS ENUM ('DRAFT', 'READY', 'COMPLETED', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "WorkshopRole" AS ENUM ('OWNER', 'INSTRUCTOR', 'VIEWER');

-- CreateEnum
CREATE TYPE "SessionStatus" AS ENUM ('SCHEDULED', 'ACTIVE', 'ENDED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "UnlockSource" AS ENUM ('INITIAL', 'TEACHER');

-- CreateEnum
CREATE TYPE "ParticipantSource" AS ENUM ('AUTO_DISCOVERY');

-- CreateEnum
CREATE TYPE "AttemptKind" AS ENUM ('COURSE', 'MISSION_REPLAY');

-- CreateEnum
CREATE TYPE "AttemptStatus" AS ENUM ('IN_PROGRESS', 'COMPLETED', 'ABANDONED');

-- CreateEnum
CREATE TYPE "QuestionResultStatus" AS ENUM ('PENDING', 'FINALIZED');

-- CreateEnum
CREATE TYPE "ResolutionMode" AS ENUM ('INDEPENDENT', 'REVEALED', 'STRATEGY');

-- CreateEnum
CREATE TYPE "ScoreTargetLevel" AS ENUM ('QUESTION', 'MISSION', 'FINAL_TOTAL');

-- CreateEnum
CREATE TYPE "ExportDataset" AS ENUM ('STUDENT_SUMMARY', 'MISSION_SCORE', 'QUESTION_DETAIL', 'LOGIN_HISTORY');

-- CreateEnum
CREATE TYPE "ExportFormat" AS ENUM ('CSV', 'XLSX', 'PDF');

-- CreateEnum
CREATE TYPE "ExportStatus" AS ENUM ('QUEUED', 'RUNNING', 'SUCCEEDED', 'FAILED', 'EXPIRED');

-- CreateTable
CREATE TABLE "school" (
    "id" UUID NOT NULL,
    "code" VARCHAR(50) NOT NULL,
    "name" VARCHAR(200) NOT NULL,
    "status" "ReferenceStatus" NOT NULL DEFAULT 'ACTIVE',
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "school_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "school_class" (
    "id" UUID NOT NULL,
    "school_id" UUID NOT NULL,
    "name" VARCHAR(100) NOT NULL,
    "status" "ReferenceStatus" NOT NULL DEFAULT 'ACTIVE',
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "school_class_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "user_account" (
    "id" UUID NOT NULL,
    "username" CITEXT NOT NULL,
    "password_hash" VARCHAR(255) NOT NULL,
    "account_type" "AccountType" NOT NULL,
    "status" "AccountStatus" NOT NULL DEFAULT 'ACTIVE',
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "user_account_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "student_profile" (
    "user_id" UUID NOT NULL,
    "school_id" UUID NOT NULL,
    "class_id" UUID NOT NULL,
    "student_id" VARCHAR(100) NOT NULL,
    "name" VARCHAR(150) NOT NULL,
    "profile_completed_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "student_profile_pkey" PRIMARY KEY ("user_id")
);

-- CreateTable
CREATE TABLE "teacher_profile" (
    "user_id" UUID NOT NULL,
    "school_id" UUID NOT NULL,
    "name" VARCHAR(150) NOT NULL,

    CONSTRAINT "teacher_profile_pkey" PRIMARY KEY ("user_id")
);

-- CreateTable
CREATE TABLE "auth_session" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "refresh_token_hash" VARCHAR(255) NOT NULL,
    "expires_at" TIMESTAMPTZ NOT NULL,
    "revoked_at" TIMESTAMPTZ,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "auth_session_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "login_record" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "login_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "logout_at" TIMESTAMPTZ,
    "close_reason" "LoginCloseReason",
    "last_seen_at" TIMESTAMPTZ,

    CONSTRAINT "login_record_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "game_content_version" (
    "id" UUID NOT NULL,
    "version_code" VARCHAR(50) NOT NULL,
    "status" "ContentStatus" NOT NULL,
    "schema_version" VARCHAR(30) NOT NULL,
    "checksum" CHAR(64) NOT NULL,
    "published_at" TIMESTAMPTZ,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "game_content_version_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "content_source" (
    "id" UUID NOT NULL,
    "source_type" "SourceType" NOT NULL,
    "name" VARCHAR(255) NOT NULL,
    "url" TEXT,
    "reporting_year" INTEGER,
    "geography" VARCHAR(100),
    "retrieval_date" DATE,

    CONSTRAINT "content_source_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "mission_template" (
    "id" UUID NOT NULL,
    "content_version_id" UUID NOT NULL,
    "stable_id" VARCHAR(20) NOT NULL,
    "sequence_no" SMALLINT NOT NULL,
    "title_cn" VARCHAR(255) NOT NULL,
    "title_en" VARCHAR(255) NOT NULL,
    "display_config" JSONB NOT NULL,

    CONSTRAINT "mission_template_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "mission_screen_template" (
    "id" UUID NOT NULL,
    "content_version_id" UUID NOT NULL,
    "mission_template_id" UUID NOT NULL,
    "stable_id" VARCHAR(30) NOT NULL,
    "sequence_no" SMALLINT NOT NULL,
    "display_config" JSONB NOT NULL,
    "input_config" JSONB NOT NULL,
    "progression_rule_ref" VARCHAR(100),

    CONSTRAINT "mission_screen_template_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "question_template" (
    "id" UUID NOT NULL,
    "content_version_id" UUID NOT NULL,
    "mission_template_id" UUID NOT NULL,
    "screen_template_id" UUID NOT NULL,
    "stable_id" VARCHAR(30) NOT NULL,
    "question_type" "QuestionType" NOT NULL,
    "answer_mode" "AnswerMode" NOT NULL,
    "prompt_cn" TEXT NOT NULL,
    "prompt_en" TEXT NOT NULL,
    "options" JSONB,
    "answer_rule" JSONB NOT NULL,
    "tolerance" DECIMAL(18,6),
    "base_score" DECIMAL(10,2) NOT NULL,
    "hint_config" JSONB NOT NULL,
    "feedback_config" JSONB NOT NULL,
    "source_id" UUID,
    "is_simulation" BOOLEAN NOT NULL DEFAULT false,
    "difficulty" SMALLINT,

    CONSTRAINT "question_template_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "game_scoring_config" (
    "id" UUID NOT NULL,
    "content_version_id" UUID NOT NULL,
    "policy_schema_version" VARCHAR(30) NOT NULL,
    "score_scale_min" DECIMAL(5,2) NOT NULL,
    "score_scale_max" DECIMAL(5,2) NOT NULL,
    "mission_weights" JSONB NOT NULL,
    "level_bands" JSONB NOT NULL,
    "rounding_mode" VARCHAR(30) NOT NULL,
    "decimal_places" SMALLINT NOT NULL,
    "checksum" CHAR(64) NOT NULL,
    "published_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "game_scoring_config_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "mission_scoring_config" (
    "id" UUID NOT NULL,
    "content_version_id" UUID NOT NULL,
    "mission_template_id" UUID NOT NULL,
    "policy_schema_version" VARCHAR(30) NOT NULL,
    "component_definitions" JSONB NOT NULL,
    "retry_policy" JSONB NOT NULL,
    "assistance_policy" JSONB NOT NULL,
    "reveal_policy" JSONB NOT NULL,
    "completion_policy" JSONB NOT NULL,
    "adjustment_bounds" JSONB NOT NULL,
    "rounding_mode" VARCHAR(30) NOT NULL,
    "decimal_places" SMALLINT NOT NULL,
    "checksum" CHAR(64) NOT NULL,
    "published_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "mission_scoring_config_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "workshop" (
    "id" UUID NOT NULL,
    "school_id" UUID NOT NULL,
    "content_version_id" UUID NOT NULL,
    "name" VARCHAR(200) NOT NULL,
    "status" "WorkshopStatus" NOT NULL DEFAULT 'DRAFT',
    "created_by_teacher_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "workshop_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "workshop_teacher" (
    "workshop_id" UUID NOT NULL,
    "teacher_id" UUID NOT NULL,
    "role" "WorkshopRole" NOT NULL,
    "assigned_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "workshop_teacher_pkey" PRIMARY KEY ("workshop_id","teacher_id")
);

-- CreateTable
CREATE TABLE "workshop_audience" (
    "id" UUID NOT NULL,
    "workshop_id" UUID NOT NULL,
    "school_id" UUID NOT NULL,
    "class_id" UUID,

    CONSTRAINT "workshop_audience_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "workshop_session" (
    "id" UUID NOT NULL,
    "workshop_id" UUID NOT NULL,
    "session_no" INTEGER NOT NULL,
    "status" "SessionStatus" NOT NULL DEFAULT 'SCHEDULED',
    "scheduled_at" TIMESTAMPTZ,
    "started_by_teacher_id" UUID,
    "started_at" TIMESTAMPTZ,
    "ended_at" TIMESTAMPTZ,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "workshop_session_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "workshop_session_audience" (
    "id" UUID NOT NULL,
    "session_id" UUID NOT NULL,
    "school_id" UUID NOT NULL,
    "class_id" UUID,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "workshop_session_audience_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "workshop_participant" (
    "id" UUID NOT NULL,
    "session_id" UUID NOT NULL,
    "student_id" UUID NOT NULL,
    "discovery_source" "ParticipantSource" NOT NULL DEFAULT 'AUTO_DISCOVERY',
    "discovered_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_activity_at" TIMESTAMPTZ,

    CONSTRAINT "workshop_participant_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "mission_unlock" (
    "id" UUID NOT NULL,
    "session_id" UUID NOT NULL,
    "mission_template_id" UUID NOT NULL,
    "unlock_source" "UnlockSource" NOT NULL,
    "unlocked_by_teacher_id" UUID,
    "unlocked_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "mission_unlock_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "attempt" (
    "id" UUID NOT NULL,
    "participant_id" UUID NOT NULL,
    "attempt_no" INTEGER NOT NULL,
    "attempt_kind" "AttemptKind" NOT NULL DEFAULT 'COURSE',
    "parent_attempt_id" UUID,
    "status" "AttemptStatus" NOT NULL DEFAULT 'IN_PROGRESS',
    "system_total_score" DECIMAL(5,2),
    "scoring_policy_snapshot" JSONB,
    "started_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completed_at" TIMESTAMPTZ,

    CONSTRAINT "attempt_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "mission_attempt" (
    "id" UUID NOT NULL,
    "attempt_id" UUID NOT NULL,
    "mission_template_id" UUID NOT NULL,
    "mission_attempt_no" INTEGER NOT NULL,
    "status" "AttemptStatus" NOT NULL DEFAULT 'IN_PROGRESS',
    "current_screen_id" UUID,
    "runtime_state" JSONB NOT NULL DEFAULT '{}',
    "system_score" DECIMAL(5,2),
    "scoring_policy_snapshot" JSONB,
    "started_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completed_at" TIMESTAMPTZ,

    CONSTRAINT "mission_attempt_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "question_attempt" (
    "id" UUID NOT NULL,
    "mission_attempt_id" UUID NOT NULL,
    "question_template_id" UUID NOT NULL,
    "question_attempt_no" INTEGER NOT NULL,
    "client_submission_id" UUID NOT NULL,
    "request_hash" CHAR(64) NOT NULL,
    "student_answer" JSONB NOT NULL,
    "evaluated_result" JSONB NOT NULL,
    "candidate_system_score" DECIMAL(10,2) NOT NULL,
    "question_snapshot" JSONB NOT NULL,
    "rule_snapshot" JSONB NOT NULL,
    "feedback_snapshot" JSONB NOT NULL,
    "time_spent_ms" INTEGER NOT NULL,
    "hint_usage" JSONB NOT NULL,
    "resolution_mode" "ResolutionMode" NOT NULL DEFAULT 'INDEPENDENT',
    "reveal_used" BOOLEAN NOT NULL DEFAULT false,
    "independently_correct" BOOLEAN NOT NULL DEFAULT false,
    "submitted_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "question_attempt_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "question_result" (
    "id" UUID NOT NULL,
    "mission_attempt_id" UUID NOT NULL,
    "question_template_id" UUID NOT NULL,
    "status" "QuestionResultStatus" NOT NULL DEFAULT 'PENDING',
    "selected_question_attempt_id" UUID,
    "resolution_mode" "ResolutionMode",
    "v5_base_score" DECIMAL(10,2) NOT NULL,
    "system_score" DECIMAL(10,2),
    "scoring_config_id" UUID NOT NULL,
    "scoring_config_checksum" CHAR(64) NOT NULL,
    "scoring_policy_snapshot" JSONB NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finalized_at" TIMESTAMPTZ,

    CONSTRAINT "question_result_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "score_adjustment_stream" (
    "id" UUID NOT NULL,
    "target_level" "ScoreTargetLevel" NOT NULL,
    "question_result_id" UUID,
    "mission_attempt_id" UUID,
    "attempt_id" UUID,
    "current_adjustment_id" UUID,
    "version" BIGINT NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "score_adjustment_stream_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "score_adjustment" (
    "id" UUID NOT NULL,
    "stream_id" UUID NOT NULL,
    "supersedes_adjustment_id" UUID,
    "original_system_score" DECIMAL(10,2) NOT NULL,
    "adjusted_score" DECIMAL(10,2) NOT NULL,
    "reason" TEXT NOT NULL,
    "adjusted_by_teacher_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "score_adjustment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "export_record" (
    "id" UUID NOT NULL,
    "workshop_id" UUID NOT NULL,
    "requested_by_teacher_id" UUID NOT NULL,
    "dataset_type" "ExportDataset" NOT NULL,
    "format" "ExportFormat" NOT NULL,
    "filters" JSONB NOT NULL,
    "status" "ExportStatus" NOT NULL,
    "object_key" TEXT,
    "file_data" BYTEA,
    "error_message" TEXT,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completed_at" TIMESTAMPTZ,

    CONSTRAINT "export_record_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "school_code_key" ON "school"("code");

-- CreateIndex
CREATE INDEX "school_class_school_id_status_idx" ON "school_class"("school_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "school_class_school_id_name_key" ON "school_class"("school_id", "name");

-- CreateIndex
CREATE UNIQUE INDEX "school_class_id_school_id_key" ON "school_class"("id", "school_id");

-- CreateIndex
CREATE UNIQUE INDEX "user_account_username_key" ON "user_account"("username");

-- CreateIndex
CREATE INDEX "user_account_account_type_status_idx" ON "user_account"("account_type", "status");

-- CreateIndex
CREATE INDEX "student_profile_class_id_idx" ON "student_profile"("class_id");

-- CreateIndex
CREATE UNIQUE INDEX "student_profile_school_id_student_id_key" ON "student_profile"("school_id", "student_id");

-- CreateIndex
CREATE INDEX "teacher_profile_school_id_idx" ON "teacher_profile"("school_id");

-- CreateIndex
CREATE UNIQUE INDEX "auth_session_refresh_token_hash_key" ON "auth_session"("refresh_token_hash");

-- CreateIndex
CREATE INDEX "auth_session_user_id_expires_at_idx" ON "auth_session"("user_id", "expires_at");

-- CreateIndex
CREATE INDEX "login_record_user_id_login_at_idx" ON "login_record"("user_id", "login_at");

-- CreateIndex
CREATE UNIQUE INDEX "game_content_version_version_code_key" ON "game_content_version"("version_code");

-- CreateIndex
CREATE UNIQUE INDEX "game_content_version_checksum_key" ON "game_content_version"("checksum");

-- CreateIndex
CREATE UNIQUE INDEX "mission_template_content_version_id_stable_id_key" ON "mission_template"("content_version_id", "stable_id");

-- CreateIndex
CREATE UNIQUE INDEX "mission_template_content_version_id_sequence_no_key" ON "mission_template"("content_version_id", "sequence_no");

-- CreateIndex
CREATE UNIQUE INDEX "mission_template_id_content_version_id_key" ON "mission_template"("id", "content_version_id");

-- CreateIndex
CREATE INDEX "mission_screen_template_content_version_id_idx" ON "mission_screen_template"("content_version_id");

-- CreateIndex
CREATE UNIQUE INDEX "mission_screen_template_mission_template_id_stable_id_key" ON "mission_screen_template"("mission_template_id", "stable_id");

-- CreateIndex
CREATE UNIQUE INDEX "mission_screen_template_id_mission_template_id_content_vers_key" ON "mission_screen_template"("id", "mission_template_id", "content_version_id");

-- CreateIndex
CREATE INDEX "question_template_mission_template_id_screen_template_id_idx" ON "question_template"("mission_template_id", "screen_template_id");

-- CreateIndex
CREATE UNIQUE INDEX "question_template_content_version_id_stable_id_key" ON "question_template"("content_version_id", "stable_id");

-- CreateIndex
CREATE UNIQUE INDEX "question_template_id_content_version_id_key" ON "question_template"("id", "content_version_id");

-- CreateIndex
CREATE UNIQUE INDEX "game_scoring_config_content_version_id_key" ON "game_scoring_config"("content_version_id");

-- CreateIndex
CREATE UNIQUE INDEX "mission_scoring_config_content_version_id_mission_template__key" ON "mission_scoring_config"("content_version_id", "mission_template_id");

-- CreateIndex
CREATE INDEX "workshop_school_id_status_idx" ON "workshop"("school_id", "status");

-- CreateIndex
CREATE INDEX "workshop_teacher_teacher_id_role_idx" ON "workshop_teacher"("teacher_id", "role");

-- CreateIndex
CREATE INDEX "workshop_audience_workshop_id_idx" ON "workshop_audience"("workshop_id");

-- CreateIndex
CREATE INDEX "workshop_audience_school_id_class_id_idx" ON "workshop_audience"("school_id", "class_id");

-- CreateIndex
CREATE INDEX "workshop_session_status_started_at_idx" ON "workshop_session"("status", "started_at");

-- CreateIndex
CREATE UNIQUE INDEX "workshop_session_workshop_id_session_no_key" ON "workshop_session"("workshop_id", "session_no");

-- CreateIndex
CREATE INDEX "workshop_session_audience_session_id_idx" ON "workshop_session_audience"("session_id");

-- CreateIndex
CREATE INDEX "workshop_session_audience_school_id_class_id_idx" ON "workshop_session_audience"("school_id", "class_id");

-- CreateIndex
CREATE INDEX "workshop_participant_student_id_last_activity_at_idx" ON "workshop_participant"("student_id", "last_activity_at");

-- CreateIndex
CREATE UNIQUE INDEX "workshop_participant_session_id_student_id_key" ON "workshop_participant"("session_id", "student_id");

-- CreateIndex
CREATE INDEX "mission_unlock_mission_template_id_idx" ON "mission_unlock"("mission_template_id");

-- CreateIndex
CREATE UNIQUE INDEX "mission_unlock_session_id_mission_template_id_key" ON "mission_unlock"("session_id", "mission_template_id");

-- CreateIndex
CREATE INDEX "attempt_status_started_at_idx" ON "attempt"("status", "started_at");

-- CreateIndex
CREATE UNIQUE INDEX "attempt_participant_id_attempt_no_key" ON "attempt"("participant_id", "attempt_no");

-- CreateIndex
CREATE INDEX "mission_attempt_mission_template_id_status_idx" ON "mission_attempt"("mission_template_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "mission_attempt_attempt_id_mission_template_id_mission_atte_key" ON "mission_attempt"("attempt_id", "mission_template_id", "mission_attempt_no");

-- CreateIndex
CREATE UNIQUE INDEX "question_attempt_client_submission_id_key" ON "question_attempt"("client_submission_id");

-- CreateIndex
CREATE INDEX "question_attempt_mission_attempt_id_submitted_at_idx" ON "question_attempt"("mission_attempt_id", "submitted_at");

-- CreateIndex
CREATE UNIQUE INDEX "question_attempt_mission_attempt_id_question_template_id_qu_key" ON "question_attempt"("mission_attempt_id", "question_template_id", "question_attempt_no");

-- CreateIndex
CREATE UNIQUE INDEX "question_attempt_id_mission_attempt_id_question_template_id_key" ON "question_attempt"("id", "mission_attempt_id", "question_template_id");

-- CreateIndex
CREATE INDEX "question_result_status_finalized_at_idx" ON "question_result"("status", "finalized_at");

-- CreateIndex
CREATE UNIQUE INDEX "question_result_mission_attempt_id_question_template_id_key" ON "question_result"("mission_attempt_id", "question_template_id");

-- CreateIndex
CREATE UNIQUE INDEX "score_adjustment_stream_question_result_id_key" ON "score_adjustment_stream"("question_result_id");

-- CreateIndex
CREATE UNIQUE INDEX "score_adjustment_stream_mission_attempt_id_key" ON "score_adjustment_stream"("mission_attempt_id");

-- CreateIndex
CREATE UNIQUE INDEX "score_adjustment_stream_attempt_id_key" ON "score_adjustment_stream"("attempt_id");

-- CreateIndex
CREATE INDEX "score_adjustment_stream_id_created_at_idx" ON "score_adjustment"("stream_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "score_adjustment_id_stream_id_key" ON "score_adjustment"("id", "stream_id");

-- CreateIndex
CREATE INDEX "export_record_workshop_id_status_idx" ON "export_record"("workshop_id", "status");

-- AddForeignKey
ALTER TABLE "school_class" ADD CONSTRAINT "school_class_school_id_fkey" FOREIGN KEY ("school_id") REFERENCES "school"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "student_profile" ADD CONSTRAINT "student_profile_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "user_account"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "student_profile" ADD CONSTRAINT "student_profile_school_id_fkey" FOREIGN KEY ("school_id") REFERENCES "school"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "student_profile" ADD CONSTRAINT "student_profile_class_id_school_id_fkey" FOREIGN KEY ("class_id", "school_id") REFERENCES "school_class"("id", "school_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "teacher_profile" ADD CONSTRAINT "teacher_profile_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "user_account"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "teacher_profile" ADD CONSTRAINT "teacher_profile_school_id_fkey" FOREIGN KEY ("school_id") REFERENCES "school"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "auth_session" ADD CONSTRAINT "auth_session_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "user_account"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "login_record" ADD CONSTRAINT "login_record_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "user_account"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "mission_template" ADD CONSTRAINT "mission_template_content_version_id_fkey" FOREIGN KEY ("content_version_id") REFERENCES "game_content_version"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "mission_screen_template" ADD CONSTRAINT "mission_screen_template_content_version_id_fkey" FOREIGN KEY ("content_version_id") REFERENCES "game_content_version"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "mission_screen_template" ADD CONSTRAINT "mission_screen_template_mission_template_id_content_versio_fkey" FOREIGN KEY ("mission_template_id", "content_version_id") REFERENCES "mission_template"("id", "content_version_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "question_template" ADD CONSTRAINT "question_template_content_version_id_fkey" FOREIGN KEY ("content_version_id") REFERENCES "game_content_version"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "question_template" ADD CONSTRAINT "question_template_mission_template_id_content_version_id_fkey" FOREIGN KEY ("mission_template_id", "content_version_id") REFERENCES "mission_template"("id", "content_version_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "question_template" ADD CONSTRAINT "question_template_screen_template_id_mission_template_id_c_fkey" FOREIGN KEY ("screen_template_id", "mission_template_id", "content_version_id") REFERENCES "mission_screen_template"("id", "mission_template_id", "content_version_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "question_template" ADD CONSTRAINT "question_template_source_id_fkey" FOREIGN KEY ("source_id") REFERENCES "content_source"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "game_scoring_config" ADD CONSTRAINT "game_scoring_config_content_version_id_fkey" FOREIGN KEY ("content_version_id") REFERENCES "game_content_version"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "mission_scoring_config" ADD CONSTRAINT "mission_scoring_config_content_version_id_fkey" FOREIGN KEY ("content_version_id") REFERENCES "game_content_version"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "mission_scoring_config" ADD CONSTRAINT "mission_scoring_config_mission_template_id_content_version_fkey" FOREIGN KEY ("mission_template_id", "content_version_id") REFERENCES "mission_template"("id", "content_version_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "workshop" ADD CONSTRAINT "workshop_school_id_fkey" FOREIGN KEY ("school_id") REFERENCES "school"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "workshop" ADD CONSTRAINT "workshop_content_version_id_fkey" FOREIGN KEY ("content_version_id") REFERENCES "game_content_version"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "workshop" ADD CONSTRAINT "workshop_created_by_teacher_id_fkey" FOREIGN KEY ("created_by_teacher_id") REFERENCES "teacher_profile"("user_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "workshop_teacher" ADD CONSTRAINT "workshop_teacher_workshop_id_fkey" FOREIGN KEY ("workshop_id") REFERENCES "workshop"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "workshop_teacher" ADD CONSTRAINT "workshop_teacher_teacher_id_fkey" FOREIGN KEY ("teacher_id") REFERENCES "teacher_profile"("user_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "workshop_audience" ADD CONSTRAINT "workshop_audience_workshop_id_fkey" FOREIGN KEY ("workshop_id") REFERENCES "workshop"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "workshop_audience" ADD CONSTRAINT "workshop_audience_school_id_fkey" FOREIGN KEY ("school_id") REFERENCES "school"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "workshop_audience" ADD CONSTRAINT "workshop_audience_class_id_school_id_fkey" FOREIGN KEY ("class_id", "school_id") REFERENCES "school_class"("id", "school_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "workshop_session" ADD CONSTRAINT "workshop_session_workshop_id_fkey" FOREIGN KEY ("workshop_id") REFERENCES "workshop"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "workshop_session" ADD CONSTRAINT "workshop_session_started_by_teacher_id_fkey" FOREIGN KEY ("started_by_teacher_id") REFERENCES "teacher_profile"("user_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "workshop_session_audience" ADD CONSTRAINT "workshop_session_audience_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "workshop_session"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "workshop_session_audience" ADD CONSTRAINT "workshop_session_audience_school_id_fkey" FOREIGN KEY ("school_id") REFERENCES "school"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "workshop_session_audience" ADD CONSTRAINT "workshop_session_audience_class_id_school_id_fkey" FOREIGN KEY ("class_id", "school_id") REFERENCES "school_class"("id", "school_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "workshop_participant" ADD CONSTRAINT "workshop_participant_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "workshop_session"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "workshop_participant" ADD CONSTRAINT "workshop_participant_student_id_fkey" FOREIGN KEY ("student_id") REFERENCES "student_profile"("user_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "mission_unlock" ADD CONSTRAINT "mission_unlock_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "workshop_session"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "mission_unlock" ADD CONSTRAINT "mission_unlock_mission_template_id_fkey" FOREIGN KEY ("mission_template_id") REFERENCES "mission_template"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "mission_unlock" ADD CONSTRAINT "mission_unlock_unlocked_by_teacher_id_fkey" FOREIGN KEY ("unlocked_by_teacher_id") REFERENCES "teacher_profile"("user_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "attempt" ADD CONSTRAINT "attempt_participant_id_fkey" FOREIGN KEY ("participant_id") REFERENCES "workshop_participant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "attempt" ADD CONSTRAINT "attempt_parent_attempt_id_fkey" FOREIGN KEY ("parent_attempt_id") REFERENCES "attempt"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "mission_attempt" ADD CONSTRAINT "mission_attempt_attempt_id_fkey" FOREIGN KEY ("attempt_id") REFERENCES "attempt"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "mission_attempt" ADD CONSTRAINT "mission_attempt_mission_template_id_fkey" FOREIGN KEY ("mission_template_id") REFERENCES "mission_template"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "mission_attempt" ADD CONSTRAINT "mission_attempt_current_screen_id_fkey" FOREIGN KEY ("current_screen_id") REFERENCES "mission_screen_template"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "question_attempt" ADD CONSTRAINT "question_attempt_mission_attempt_id_fkey" FOREIGN KEY ("mission_attempt_id") REFERENCES "mission_attempt"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "question_attempt" ADD CONSTRAINT "question_attempt_question_template_id_fkey" FOREIGN KEY ("question_template_id") REFERENCES "question_template"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "question_result" ADD CONSTRAINT "question_result_mission_attempt_id_fkey" FOREIGN KEY ("mission_attempt_id") REFERENCES "mission_attempt"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "question_result" ADD CONSTRAINT "question_result_question_template_id_fkey" FOREIGN KEY ("question_template_id") REFERENCES "question_template"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "question_result" ADD CONSTRAINT "question_result_selected_question_attempt_id_fkey" FOREIGN KEY ("selected_question_attempt_id") REFERENCES "question_attempt"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "score_adjustment_stream" ADD CONSTRAINT "score_adjustment_stream_question_result_id_fkey" FOREIGN KEY ("question_result_id") REFERENCES "question_result"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "score_adjustment_stream" ADD CONSTRAINT "score_adjustment_stream_mission_attempt_id_fkey" FOREIGN KEY ("mission_attempt_id") REFERENCES "mission_attempt"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "score_adjustment_stream" ADD CONSTRAINT "score_adjustment_stream_attempt_id_fkey" FOREIGN KEY ("attempt_id") REFERENCES "attempt"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "score_adjustment_stream" ADD CONSTRAINT "score_adjustment_stream_current_adjustment_id_fkey" FOREIGN KEY ("current_adjustment_id") REFERENCES "score_adjustment"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "score_adjustment" ADD CONSTRAINT "score_adjustment_stream_id_fkey" FOREIGN KEY ("stream_id") REFERENCES "score_adjustment_stream"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "score_adjustment" ADD CONSTRAINT "score_adjustment_supersedes_adjustment_id_fkey" FOREIGN KEY ("supersedes_adjustment_id") REFERENCES "score_adjustment"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "score_adjustment" ADD CONSTRAINT "score_adjustment_adjusted_by_teacher_id_fkey" FOREIGN KEY ("adjusted_by_teacher_id") REFERENCES "teacher_profile"("user_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "export_record" ADD CONSTRAINT "export_record_workshop_id_fkey" FOREIGN KEY ("workshop_id") REFERENCES "workshop"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "export_record" ADD CONSTRAINT "export_record_requested_by_teacher_id_fkey" FOREIGN KEY ("requested_by_teacher_id") REFERENCES "teacher_profile"("user_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Frozen P0 constraints that Prisma cannot express directly.

-- Nullable class_id requires two partial unique indexes so duplicate whole-school
-- and duplicate class-specific audience rows are both rejected.
CREATE UNIQUE INDEX "workshop_session_audience_whole_school_key"
ON "workshop_session_audience" ("session_id", "school_id")
WHERE "class_id" IS NULL;

CREATE UNIQUE INDEX "workshop_session_audience_specific_class_key"
ON "workshop_session_audience" ("session_id", "school_id", "class_id")
WHERE "class_id" IS NOT NULL;

ALTER TABLE "question_attempt"
ADD CONSTRAINT "question_attempt_time_spent_nonnegative"
CHECK ("time_spent_ms" >= 0);

ALTER TABLE "score_adjustment_stream"
ADD CONSTRAINT "score_adjustment_stream_target_shape"
CHECK (
  ("target_level" = 'QUESTION' AND "question_result_id" IS NOT NULL AND "mission_attempt_id" IS NULL AND "attempt_id" IS NULL)
  OR ("target_level" = 'MISSION' AND "question_result_id" IS NULL AND "mission_attempt_id" IS NOT NULL AND "attempt_id" IS NULL)
  OR ("target_level" = 'FINAL_TOTAL' AND "question_result_id" IS NULL AND "mission_attempt_id" IS NULL AND "attempt_id" IS NOT NULL)
);

-- A selected submission must belong to the same MissionAttempt and Question.
ALTER TABLE "question_result" DROP CONSTRAINT "question_result_selected_question_attempt_id_fkey";
ALTER TABLE "question_result"
ADD CONSTRAINT "question_result_selected_attempt_same_question_fkey"
FOREIGN KEY ("selected_question_attempt_id", "mission_attempt_id", "question_template_id")
REFERENCES "question_attempt" ("id", "mission_attempt_id", "question_template_id")
ON DELETE RESTRICT ON UPDATE CASCADE;

-- Both adjustment pointers are DB-enforced to remain inside the same stream.
ALTER TABLE "score_adjustment_stream" DROP CONSTRAINT "score_adjustment_stream_current_adjustment_id_fkey";
ALTER TABLE "score_adjustment"
DROP CONSTRAINT "score_adjustment_supersedes_adjustment_id_fkey";

ALTER TABLE "score_adjustment"
ADD CONSTRAINT "score_adjustment_supersedes_same_stream_fkey"
FOREIGN KEY ("supersedes_adjustment_id", "stream_id")
REFERENCES "score_adjustment" ("id", "stream_id")
ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "score_adjustment_stream"
ADD CONSTRAINT "score_adjustment_current_same_stream_fkey"
FOREIGN KEY ("current_adjustment_id", "id")
REFERENCES "score_adjustment" ("id", "stream_id")
ON DELETE RESTRICT ON UPDATE CASCADE;

-- Mission unlock type, content-version consistency, and teacher audit invariants.
CREATE FUNCTION "validate_mission_unlock"() RETURNS trigger AS $$
DECLARE
  mission_sequence smallint;
  mission_version uuid;
  workshop_version uuid;
BEGIN
  SELECT "sequence_no", "content_version_id"
    INTO mission_sequence, mission_version
    FROM "mission_template" WHERE "id" = NEW."mission_template_id";

  SELECT w."content_version_id"
    INTO workshop_version
    FROM "workshop_session" s
    JOIN "workshop" w ON w."id" = s."workshop_id"
    WHERE s."id" = NEW."session_id";

  IF mission_version IS DISTINCT FROM workshop_version THEN
    RAISE EXCEPTION 'Mission unlock content version does not match Workshop';
  END IF;
  IF NEW."unlock_source" = 'INITIAL' AND mission_sequence <> 1 THEN
    RAISE EXCEPTION 'INITIAL unlock is only valid for Mission 1';
  END IF;
  IF NEW."unlock_source" = 'TEACHER' AND (mission_sequence < 2 OR NEW."unlocked_by_teacher_id" IS NULL) THEN
    RAISE EXCEPTION 'TEACHER unlock requires Mission 2+ and an authorized teacher';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "mission_unlock_invariants"
BEFORE INSERT OR UPDATE ON "mission_unlock"
FOR EACH ROW EXECUTE FUNCTION "validate_mission_unlock"();

-- Submission evidence is append-only. Idempotent retries read the existing row.
CREATE FUNCTION "prevent_question_attempt_mutation"() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'QuestionAttempt is immutable';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "question_attempt_no_update"
BEFORE UPDATE OR DELETE ON "question_attempt"
FOR EACH ROW EXECUTE FUNCTION "prevent_question_attempt_mutation"();
