-- Sumber: TDD 3.7
-- 3.7.1 updated_at
DO $$
DECLARE t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'users','student_profiles','subjects','topics','questions','question_versions',
    'question_options','exams','exam_sections','exam_questions','exam_sessions',
    'exam_enrollments','products','orders','payments','entitlements','exam_attempts',
    'attempt_sections','exam_key_corrections','notifications']
  LOOP
    EXECUTE format(
      'CREATE TRIGGER %I BEFORE UPDATE ON %I FOR EACH ROW EXECUTE FUNCTION set_updated_at()',
      t || '_set_updated_at', t);
  END LOOP;
END $$;

-- 3.7.2 Versi soal: immutable setelah diputuskan; terkunci selama review (BR-QV-01)
CREATE OR REPLACE FUNCTION guard_question_version() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD.status <> 'DRAFT' THEN
      RAISE EXCEPTION 'question_version % cannot be deleted in status %', OLD.id, OLD.status
        USING ERRCODE = 'restrict_violation';
    END IF;
    RETURN OLD;
  END IF;

  IF OLD.status IN ('APPROVED','REJECTED') THEN
    RAISE EXCEPTION 'question_version % is immutable (status %)', OLD.id, OLD.status
      USING ERRCODE = 'restrict_violation';
  END IF;

  IF OLD.status = 'IN_REVIEW' AND
     (NEW.stem_html, NEW.stem_plain, NEW.explanation_html, NEW.subject_id,
      NEW.topic_id, NEW.difficulty, NEW.cognitive_level)
     IS DISTINCT FROM
     (OLD.stem_html, OLD.stem_plain, OLD.explanation_html, OLD.subject_id,
      OLD.topic_id, OLD.difficulty, OLD.cognitive_level) THEN
    RAISE EXCEPTION 'question_version % content is locked during review', OLD.id
      USING ERRCODE = 'restrict_violation';
  END IF;

  IF (NEW.question_id, NEW.version_number, NEW.author_id)
     IS DISTINCT FROM (OLD.question_id, OLD.version_number, OLD.author_id) THEN
    RAISE EXCEPTION 'question_version identity columns are immutable'
      USING ERRCODE = 'restrict_violation';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER question_versions_guard
  BEFORE UPDATE OR DELETE ON question_versions
  FOR EACH ROW EXECUTE FUNCTION guard_question_version();

-- 3.7.3 Opsi: hanya dapat diubah saat versi induk DRAFT / CHANGES_REQUESTED
CREATE OR REPLACE FUNCTION guard_question_option() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE v_status TEXT;
BEGIN
  SELECT status INTO v_status FROM question_versions
   WHERE id = COALESCE(NEW.question_version_id, OLD.question_version_id);
  -- v_status NULL = versi induk sedang dihapus (cascade dari DRAFT): diizinkan
  IF v_status IS NOT NULL AND v_status NOT IN ('DRAFT','CHANGES_REQUESTED') THEN
    RAISE EXCEPTION 'options of question_version in status % are immutable', v_status
      USING ERRCODE = 'restrict_violation';
  END IF;
  RETURN COALESCE(NEW, OLD);
END;
$$;

CREATE TRIGGER question_options_guard
  BEFORE INSERT OR UPDATE OR DELETE ON question_options
  FOR EACH ROW EXECUTE FUNCTION guard_question_option();

-- 3.7.4 Append-only: riwayat review, snapshot attempt, skor, audit log
CREATE TRIGGER question_reviews_immutable
  BEFORE UPDATE OR DELETE ON question_reviews
  FOR EACH ROW EXECUTE FUNCTION forbid_mutation();
CREATE TRIGGER attempt_questions_immutable
  BEFORE UPDATE OR DELETE ON attempt_questions
  FOR EACH ROW EXECUTE FUNCTION forbid_mutation();
CREATE TRIGGER result_section_scores_immutable
  BEFORE UPDATE OR DELETE ON result_section_scores
  FOR EACH ROW EXECUTE FUNCTION forbid_mutation();
CREATE TRIGGER result_topic_scores_immutable
  BEFORE UPDATE OR DELETE ON result_topic_scores
  FOR EACH ROW EXECUTE FUNCTION forbid_mutation();
CREATE TRIGGER audit_logs_immutable
  BEFORE UPDATE OR DELETE ON audit_logs
  FOR EACH ROW EXECUTE FUNCTION forbid_mutation();

-- 3.7.5 Result: hanya is_current dan publikasi yang boleh berubah (BR-SCR-06)
CREATE OR REPLACE FUNCTION guard_exam_result() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'exam_results rows cannot be deleted' USING ERRCODE = 'restrict_violation';
  END IF;
  IF (to_jsonb(NEW) - 'is_current' - 'publication_status' - 'published_at')
     IS DISTINCT FROM
     (to_jsonb(OLD) - 'is_current' - 'publication_status' - 'published_at') THEN
    RAISE EXCEPTION 'exam_result % is immutable', OLD.id USING ERRCODE = 'restrict_violation';
  END IF;
  IF OLD.publication_status = 'PUBLISHED' AND NEW.publication_status <> 'PUBLISHED' THEN
    RAISE EXCEPTION 'exam_result % cannot be unpublished', OLD.id
      USING ERRCODE = 'restrict_violation';
  END IF;
  IF NOT OLD.is_current AND NEW.is_current THEN
    RAISE EXCEPTION 'superseded exam_result % cannot become current again', OLD.id
      USING ERRCODE = 'restrict_violation';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER exam_results_guard
  BEFORE UPDATE OR DELETE ON exam_results
  FOR EACH ROW EXECUTE FUNCTION guard_exam_result();

-- 3.7.6 Jawaban: tidak dapat diubah setelah attempt terkumpul (BR-LIF-05)
-- Lapisan kedua; lapisan pertama adalah kondisi pada pernyataan simpan (6.2).
CREATE OR REPLACE FUNCTION guard_attempt_answer() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE v_status TEXT;
BEGIN
  SELECT status INTO v_status FROM exam_attempts
   WHERE id = COALESCE(NEW.attempt_id, OLD.attempt_id);
  IF v_status <> 'IN_PROGRESS' THEN
    RAISE EXCEPTION 'answers of attempt in status % are immutable', v_status
      USING ERRCODE = 'restrict_violation';
  END IF;
  RETURN COALESCE(NEW, OLD);
END;
$$;

CREATE TRIGGER attempt_answers_guard
  BEFORE INSERT OR UPDATE OR DELETE ON attempt_answers
  FOR EACH ROW EXECUTE FUNCTION guard_attempt_answer();
