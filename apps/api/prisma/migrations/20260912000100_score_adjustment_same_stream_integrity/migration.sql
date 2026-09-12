-- Enforce that both score-adjustment pointers stay within their owning stream.
-- Adding the composite constraints before removing the legacy constraints also
-- makes the migration fail safely if pre-existing cross-stream data is present.
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

ALTER TABLE "score_adjustment"
DROP CONSTRAINT "score_adjustment_supersedes_adjustment_id_fkey";

ALTER TABLE "score_adjustment_stream"
DROP CONSTRAINT "score_adjustment_stream_current_adjustment_id_fkey";
