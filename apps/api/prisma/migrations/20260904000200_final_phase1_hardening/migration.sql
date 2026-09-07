-- Append-only audit evidence for finalized Phase 1 records.
CREATE FUNCTION "prevent_score_adjustment_mutation"() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'ScoreAdjustment records are append-only';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "score_adjustment_append_only"
BEFORE UPDATE OR DELETE ON "score_adjustment"
FOR EACH ROW EXECUTE FUNCTION "prevent_score_adjustment_mutation"();

CREATE FUNCTION "prevent_feedback_evidence_mutation"() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'Submitted Feedback evidence is immutable';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "feedback_submission_append_only"
BEFORE UPDATE OR DELETE ON "feedback_submission"
FOR EACH ROW EXECUTE FUNCTION "prevent_feedback_evidence_mutation"();

CREATE TRIGGER "feedback_response_append_only"
BEFORE UPDATE OR DELETE ON "feedback_response"
FOR EACH ROW EXECUTE FUNCTION "prevent_feedback_evidence_mutation"();
