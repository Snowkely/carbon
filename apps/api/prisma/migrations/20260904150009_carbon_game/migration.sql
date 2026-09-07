-- DropForeignKey
ALTER TABLE "question_result" DROP CONSTRAINT "question_result_selected_attempt_same_question_fkey";

-- DropForeignKey
ALTER TABLE "score_adjustment" DROP CONSTRAINT "score_adjustment_supersedes_same_stream_fkey";

-- DropForeignKey
ALTER TABLE "score_adjustment_stream" DROP CONSTRAINT "score_adjustment_current_same_stream_fkey";

-- RenameForeignKey
ALTER TABLE "feedback_response" RENAME CONSTRAINT "feedback_response_question_same_form_fkey" TO "feedback_response_feedback_question_id_feedback_form_id_fkey";

-- RenameForeignKey
ALTER TABLE "feedback_response" RENAME CONSTRAINT "feedback_response_submission_same_form_fkey" TO "feedback_response_submission_id_feedback_form_id_fkey";

-- RenameForeignKey
ALTER TABLE "feedback_submission" RENAME CONSTRAINT "feedback_submission_session_workshop_fkey" TO "feedback_submission_session_id_workshop_id_fkey";

-- AddForeignKey
ALTER TABLE "question_result" ADD CONSTRAINT "question_result_selected_question_attempt_id_fkey" FOREIGN KEY ("selected_question_attempt_id") REFERENCES "question_attempt"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "score_adjustment_stream" ADD CONSTRAINT "score_adjustment_stream_current_adjustment_id_fkey" FOREIGN KEY ("current_adjustment_id") REFERENCES "score_adjustment"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "score_adjustment" ADD CONSTRAINT "score_adjustment_supersedes_adjustment_id_fkey" FOREIGN KEY ("supersedes_adjustment_id") REFERENCES "score_adjustment"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
