-- Final Phase 1 survey models and cross-version/session integrity.
CREATE TYPE "FeedbackFormStatus" AS ENUM ('DRAFT', 'PUBLISHED', 'ARCHIVED');
CREATE TYPE "FeedbackQuestionType" AS ENUM ('SINGLE_CHOICE', 'OPEN_TEXT');

CREATE UNIQUE INDEX "workshop_session_id_workshop_id_key"
ON "workshop_session"("id", "workshop_id");

CREATE TABLE "feedback_form" (
  "id" UUID NOT NULL,
  "stable_id" VARCHAR(40) NOT NULL,
  "version" INTEGER NOT NULL,
  "status" "FeedbackFormStatus" NOT NULL DEFAULT 'DRAFT',
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "published_at" TIMESTAMPTZ,
  CONSTRAINT "feedback_form_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "feedback_question" (
  "id" UUID NOT NULL,
  "feedback_form_id" UUID NOT NULL,
  "stable_id" VARCHAR(40) NOT NULL,
  "question_type" "FeedbackQuestionType" NOT NULL,
  "prompt" TEXT NOT NULL,
  "display_order" SMALLINT NOT NULL,
  "options" JSONB,
  "validation_config" JSONB NOT NULL DEFAULT '{}',
  CONSTRAINT "feedback_question_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "feedback_submission" (
  "id" UUID NOT NULL,
  "feedback_form_id" UUID NOT NULL,
  "student_id" UUID NOT NULL,
  "workshop_id" UUID NOT NULL,
  "session_id" UUID NOT NULL,
  "submitted_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "feedback_submission_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "feedback_response" (
  "id" UUID NOT NULL,
  "submission_id" UUID NOT NULL,
  "feedback_question_id" UUID NOT NULL,
  "feedback_form_id" UUID NOT NULL,
  "selected_option" TEXT,
  "other_text" TEXT,
  "text_response" TEXT,
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "feedback_response_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "feedback_form_stable_id_version_key"
ON "feedback_form"("stable_id", "version");
CREATE INDEX "feedback_form_status_published_at_idx"
ON "feedback_form"("status", "published_at");

CREATE UNIQUE INDEX "feedback_question_feedback_form_id_stable_id_key"
ON "feedback_question"("feedback_form_id", "stable_id");
CREATE UNIQUE INDEX "feedback_question_feedback_form_id_display_order_key"
ON "feedback_question"("feedback_form_id", "display_order");
CREATE UNIQUE INDEX "feedback_question_id_feedback_form_id_key"
ON "feedback_question"("id", "feedback_form_id");

CREATE UNIQUE INDEX "feedback_submission_feedback_form_id_student_id_session_id_key"
ON "feedback_submission"("feedback_form_id", "student_id", "session_id");
CREATE UNIQUE INDEX "feedback_submission_id_feedback_form_id_key"
ON "feedback_submission"("id", "feedback_form_id");
CREATE INDEX "feedback_submission_session_id_submitted_at_idx"
ON "feedback_submission"("session_id", "submitted_at");

CREATE UNIQUE INDEX "feedback_response_submission_id_feedback_question_id_key"
ON "feedback_response"("submission_id", "feedback_question_id");
CREATE INDEX "feedback_response_feedback_question_id_selected_option_idx"
ON "feedback_response"("feedback_question_id", "selected_option");

ALTER TABLE "feedback_question"
ADD CONSTRAINT "feedback_question_feedback_form_id_fkey"
FOREIGN KEY ("feedback_form_id") REFERENCES "feedback_form"("id")
ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "feedback_submission"
ADD CONSTRAINT "feedback_submission_feedback_form_id_fkey"
FOREIGN KEY ("feedback_form_id") REFERENCES "feedback_form"("id")
ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "feedback_submission"
ADD CONSTRAINT "feedback_submission_student_id_fkey"
FOREIGN KEY ("student_id") REFERENCES "student_profile"("user_id")
ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "feedback_submission"
ADD CONSTRAINT "feedback_submission_workshop_id_fkey"
FOREIGN KEY ("workshop_id") REFERENCES "workshop"("id")
ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "feedback_submission"
ADD CONSTRAINT "feedback_submission_session_workshop_fkey"
FOREIGN KEY ("session_id", "workshop_id") REFERENCES "workshop_session"("id", "workshop_id")
ON DELETE RESTRICT ON UPDATE CASCADE;

-- These two composite foreign keys guarantee that a response's Question and
-- Submission belong to the exact same versioned FeedbackForm.
ALTER TABLE "feedback_response"
ADD CONSTRAINT "feedback_response_submission_same_form_fkey"
FOREIGN KEY ("submission_id", "feedback_form_id")
REFERENCES "feedback_submission"("id", "feedback_form_id")
ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "feedback_response"
ADD CONSTRAINT "feedback_response_question_same_form_fkey"
FOREIGN KEY ("feedback_question_id", "feedback_form_id")
REFERENCES "feedback_question"("id", "feedback_form_id")
ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "feedback_response"
ADD CONSTRAINT "feedback_response_shape"
CHECK (
  ("selected_option" IS NOT NULL AND "text_response" IS NULL)
  OR ("selected_option" IS NULL AND "other_text" IS NULL)
);

CREATE FUNCTION "validate_feedback_response"() RETURNS trigger AS $$
DECLARE
  response_type "FeedbackQuestionType";
  response_stable_id text;
  allowed_options jsonb;
BEGIN
  SELECT "question_type", "stable_id", "options"
  INTO response_type, response_stable_id, allowed_options
  FROM "feedback_question"
  WHERE "id" = NEW."feedback_question_id"
    AND "feedback_form_id" = NEW."feedback_form_id";

  IF response_type = 'SINGLE_CHOICE' THEN
    IF NEW."selected_option" IS NULL OR NOT (allowed_options ? NEW."selected_option") THEN
      RAISE EXCEPTION 'Feedback selected option is invalid';
    END IF;
    IF response_stable_id = 'FB-Q02' AND NEW."selected_option" = 'Other'
       AND NULLIF(BTRIM(NEW."other_text"), '') IS NULL THEN
      RAISE EXCEPTION 'FB-Q02 Other requires non-empty other_text';
    END IF;
    IF NULLIF(BTRIM(NEW."other_text"), '') IS NOT NULL
       AND NOT (response_stable_id = 'FB-Q02' AND NEW."selected_option" = 'Other') THEN
      RAISE EXCEPTION 'other_text is valid only for FB-Q02 Other';
    END IF;
  ELSIF response_type = 'OPEN_TEXT' AND NEW."selected_option" IS NOT NULL THEN
    RAISE EXCEPTION 'OPEN_TEXT Feedback cannot have a selected option';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "feedback_response_invariants"
BEFORE INSERT OR UPDATE ON "feedback_response"
FOR EACH ROW EXECUTE FUNCTION "validate_feedback_response"();
