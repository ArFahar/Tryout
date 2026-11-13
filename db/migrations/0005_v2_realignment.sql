-- 0005_v2_realignment.sql — migrasi skema v1.0 -> v2.0 (TDD v2.0 Bagian 3.10)
-- Dijalankan dalam satu transaksi oleh runner migrasi. Urutan: tabel baru yang dirujuk,
-- perubahan tabel lama, tabel Performance Intelligence, index, trigger, konfigurasi.

-- 1. Taksonomi dan seri
CREATE TABLE competencies (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  code        TEXT        NOT NULL,
  name        TEXT        NOT NULL,
  description TEXT        NOT NULL DEFAULT '',
  is_active   BOOLEAN     NOT NULL DEFAULT TRUE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT competencies_code_key UNIQUE (code),
  CONSTRAINT competencies_name_check CHECK (length(btrim(name)) > 0)
);

CREATE TABLE question_competencies (
  question_version_id UUID        NOT NULL REFERENCES question_versions(id) ON DELETE CASCADE,
  competency_id       UUID        NOT NULL REFERENCES competencies(id),
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (question_version_id, competency_id)
);

CREATE TABLE exam_series (
  id             UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  code           TEXT        NOT NULL,
  name           TEXT        NOT NULL,
  description    TEXT        NOT NULL DEFAULT '',   -- cetak biru: struktur, komposisi kesulitan
  exam_type      TEXT        NOT NULL,
  scoring_scheme TEXT        NOT NULL DEFAULT 'PROPORTIONAL_V1',
  status         TEXT        NOT NULL DEFAULT 'ACTIVE',
  created_by     UUID        NOT NULL REFERENCES users(id),
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT exam_series_code_key UNIQUE (code),
  CONSTRAINT exam_series_id_type_key UNIQUE (id, exam_type),   -- target FK komposit
  CONSTRAINT exam_series_type_check CHECK (exam_type IN ('MINI_TRYOUT','FULL_TRYOUT')),
  CONSTRAINT exam_series_scheme_check CHECK (scoring_scheme IN ('PROPORTIONAL_V1')),
  CONSTRAINT exam_series_status_check CHECK (status IN ('ACTIVE','ARCHIVED'))
);

-- 2. exams: taksonomi produk v2.0 (D-17)
ALTER TABLE exams DROP CONSTRAINT exams_type_check;
ALTER TABLE exams DROP CONSTRAINT exams_single_attempt_check;
ALTER TABLE exams ADD COLUMN series_id UUID;
-- DIAGNOSTIC -> FREE_TRYOUT. TRYOUT -> FULL_TRYOUT; Exam Admin mengklasifikasi ulang
-- exam pendek menjadi MINI_TRYOUT secara manual setelah migrasi (lihat 3.10).
UPDATE exams SET exam_type = CASE exam_type WHEN 'DIAGNOSTIC' THEN 'FREE_TRYOUT' ELSE 'FULL_TRYOUT' END;
ALTER TABLE exams ADD CONSTRAINT exams_type_check
  CHECK (exam_type IN ('FREE_TRYOUT','MINI_TRYOUT','FULL_TRYOUT'));
ALTER TABLE exams ADD CONSTRAINT exams_series_fk
  FOREIGN KEY (series_id, exam_type) REFERENCES exam_series (id, exam_type);
ALTER TABLE exams ADD CONSTRAINT exams_free_mode_check
  CHECK (exam_type <> 'FREE_TRYOUT' OR delivery_mode = 'ON_DEMAND');
ALTER TABLE exams ADD CONSTRAINT exams_scheduled_single_attempt_check
  CHECK (delivery_mode = 'ON_DEMAND' OR max_attempts = 1);
ALTER TABLE exams ADD CONSTRAINT exams_free_attempts_check
  CHECK (exam_type <> 'FREE_TRYOUT' OR max_attempts <= 3);

-- 3. attempt_answers: pencatatan perubahan jawaban (FR-ENG-17).
-- Tidak di-backfill: riwayat perubahan attempt lama tidak diketahui (NULL / 0).
ALTER TABLE attempt_answers ADD COLUMN first_selected_option_id UUID REFERENCES question_options(id);
ALTER TABLE attempt_answers ADD COLUMN answer_change_count INTEGER NOT NULL DEFAULT 0;
ALTER TABLE attempt_answers ADD CONSTRAINT attempt_answers_changes_check CHECK (answer_change_count >= 0);

-- 4. Performance Intelligence, konfigurasi, dan jembatan tahap 3–4

-- =====================================================================
-- 7. PERFORMANCE INTELLIGENCE (v2.0)
-- =====================================================================
-- Agregasi per kompetensi: deterministik dari result (seperti result_topic_scores)
CREATE TABLE result_competency_scores (
  id               UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  result_id        UUID         NOT NULL REFERENCES exam_results(id),
  competency_id    UUID         NOT NULL REFERENCES competencies(id),
  question_count   INTEGER      NOT NULL,
  correct_count    INTEGER      NOT NULL,
  incorrect_count  INTEGER      NOT NULL,
  unanswered_count INTEGER      NOT NULL,
  accuracy         NUMERIC(5,4) NOT NULL,              -- benar / jumlah soal kompetensi
  created_at       TIMESTAMPTZ  NOT NULL DEFAULT now(),
  CONSTRAINT result_competency_scores_unique UNIQUE (result_id, competency_id),
  CONSTRAINT result_competency_scores_counts_check
    CHECK (question_count > 0
           AND correct_count + incorrect_count + unanswered_count = question_count),
  CONSTRAINT result_competency_scores_accuracy_check CHECK (accuracy BETWEEN 0 AND 1)
);

-- Metrik perilaku pengerjaan per result (FR-PI-05/06): deterministik dari data attempt
CREATE TABLE result_behavior_metrics (
  result_id                  UUID         PRIMARY KEY REFERENCES exam_results(id),
  total_time_seconds         INTEGER      NOT NULL,   -- submitted_at - started_at
  recorded_time_ms           BIGINT       NOT NULL,   -- Σ time_spent_ms (indikatif, BR-PI-09)
  median_time_per_question_ms INTEGER,                -- atas soal yang pernah dibuka
  slow_question_count        INTEGER      NOT NULL DEFAULT 0,  -- waktu > 3 × median siswa
  unanswered_by_quartile     INTEGER[]    NOT NULL,   -- 4 elemen: kuartil urutan soal dalam section
  section_time               JSONB        NOT NULL,   -- [{attemptSectionId, position, usedSeconds, allottedSeconds, unanswered}]
  accuracy_by_difficulty     JSONB        NOT NULL,   -- {"EASY":{"n":..,"correct":..}, "MEDIUM":.., "HARD":..}
  answer_changes_total       INTEGER      NOT NULL DEFAULT 0,
  changes_wrong_to_right     INTEGER      NOT NULL DEFAULT 0,
  changes_right_to_wrong     INTEGER      NOT NULL DEFAULT 0,
  created_at                 TIMESTAMPTZ  NOT NULL DEFAULT now(),
  CONSTRAINT result_behavior_metrics_quartile_check CHECK (cardinality(unanswered_by_quartile) = 4),
  CONSTRAINT result_behavior_metrics_nonneg_check
    CHECK (total_time_seconds >= 0 AND recorded_time_ms >= 0 AND slow_question_count >= 0
           AND answer_changes_total >= 0 AND changes_wrong_to_right >= 0 AND changes_right_to_wrong >= 0)
);

-- Satu eksekusi aturan Performance Intelligence atas satu result (BR-PI-05, BR-PI-06)
CREATE TABLE result_analyses (
  id               UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  result_id        UUID        NOT NULL REFERENCES exam_results(id),
  user_id          UUID        NOT NULL REFERENCES users(id),        -- denormalisasi untuk isolasi
  rule_set_version TEXT        NOT NULL,                             -- mis. 'pi-rules-2026.11'
  report_tier      TEXT        NOT NULL,                             -- BASIC | COMPLETE (FR-PI-11)
  status           TEXT        NOT NULL DEFAULT 'PENDING',
  is_current       BOOLEAN     NOT NULL DEFAULT FALSE,
  run_count        INTEGER     NOT NULL DEFAULT 0,
  started_at       TIMESTAMPTZ,
  completed_at     TIMESTAMPTZ,
  error_message    TEXT,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT result_analyses_version_key UNIQUE (result_id, rule_set_version),
  CONSTRAINT result_analyses_tier_check CHECK (report_tier IN ('BASIC','COMPLETE')),
  CONSTRAINT result_analyses_status_check
    CHECK (status IN ('PENDING','RUNNING','COMPLETED','FAILED')),
  CONSTRAINT result_analyses_current_check CHECK (NOT is_current OR status = 'COMPLETED'),
  CONSTRAINT result_analyses_completed_check
    CHECK (status <> 'COMPLETED' OR completed_at IS NOT NULL)
);

-- Tepat satu analisis terkini per result
CREATE UNIQUE INDEX result_analyses_one_current_idx
  ON result_analyses (result_id) WHERE is_current;

-- Insight berbukti (FR-PI-07, BR-PI-03): append-only
CREATE TABLE performance_insights (
  id                  UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  analysis_id         UUID        NOT NULL REFERENCES result_analyses(id),
  user_id             UUID        NOT NULL REFERENCES users(id),
  dimension           TEXT        NOT NULL,
  kind                TEXT        NOT NULL,
  rule_code           TEXT        NOT NULL,                  -- mis. 'OBS-CAP-01'
  scope_type          TEXT        NOT NULL,
  subject_id          UUID        REFERENCES subjects(id),
  topic_id            UUID        REFERENCES topics(id),
  competency_id       UUID        REFERENCES competencies(id),
  attempt_section_id  UUID        REFERENCES attempt_sections(id),
  difficulty          TEXT,
  classification      TEXT,
  min_report_tier     TEXT        NOT NULL,                  -- tingkatan minimum yang menampilkan
  message_key         TEXT        NOT NULL,                  -- kunci templat bahasa (FR-PI-12)
  params              JSONB       NOT NULL DEFAULT '{}',     -- nilai untuk templat
  evidence            JSONB       NOT NULL,                  -- {attemptQuestionIds:[...], metrics:{...}}
  based_on_insight_id UUID        REFERENCES performance_insights(id),
  display_order       INTEGER     NOT NULL DEFAULT 0,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT performance_insights_dimension_check
    CHECK (dimension IN ('OVERVIEW','CAPABILITY','BEHAVIOR','PROGRESS','RECOMMENDATION')),
  CONSTRAINT performance_insights_kind_check CHECK (kind IN ('OBSERVATION','INFERENCE')),
  CONSTRAINT performance_insights_scope_check
    CHECK (scope_type IN ('ATTEMPT','SECTION','SUBJECT','TOPIC','COMPETENCY','DIFFICULTY')),
  CONSTRAINT performance_insights_tier_check CHECK (min_report_tier IN ('BASIC','COMPLETE')),
  CONSTRAINT performance_insights_difficulty_check
    CHECK (difficulty IS NULL OR difficulty IN ('EASY','MEDIUM','HARD')),
  CONSTRAINT performance_insights_classification_check
    CHECK (classification IS NULL OR classification IN ('STRONG','ADEQUATE','NEEDS_IMPROVEMENT')),
  -- BR-PI-03: dugaan wajib merujuk pengamatan
  CONSTRAINT performance_insights_inference_check
    CHECK (kind = 'OBSERVATION' OR based_on_insight_id IS NOT NULL),
  CONSTRAINT performance_insights_evidence_check CHECK (jsonb_typeof(evidence) = 'object')
);

-- Rekomendasi pengembangan (FR-PI-08..10)
CREATE TABLE learning_recommendations (
  id                    UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  analysis_id           UUID        NOT NULL REFERENCES result_analyses(id),
  user_id               UUID        NOT NULL REFERENCES users(id),
  rank                  SMALLINT    NOT NULL,
  recommendation_type   TEXT        NOT NULL,
  target_type           TEXT        NOT NULL,
  subject_id            UUID        REFERENCES subjects(id),
  topic_id              UUID        REFERENCES topics(id),
  competency_id         UUID        REFERENCES competencies(id),
  recommended_exam_id   UUID        REFERENCES exams(id),
  rationale_insight_id  UUID        NOT NULL REFERENCES performance_insights(id),
  rule_code             TEXT        NOT NULL,
  min_report_tier       TEXT        NOT NULL,
  message_key           TEXT        NOT NULL,
  params                JSONB       NOT NULL DEFAULT '{}',
  status                TEXT        NOT NULL DEFAULT 'ACTIVE',
  dismissed_at          TIMESTAMPTZ,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT learning_recommendations_rank_key UNIQUE (analysis_id, recommendation_type, rank),
  CONSTRAINT learning_recommendations_rank_check CHECK (rank BETWEEN 1 AND 10),
  CONSTRAINT learning_recommendations_type_check
    CHECK (recommendation_type IN ('PRIORITY_AREA','REVIEW_EXPLANATIONS','TAKE_ASSESSMENT')),
  CONSTRAINT learning_recommendations_target_check
    CHECK (target_type IN ('SUBJECT','TOPIC','COMPETENCY','EXAM')),
  CONSTRAINT learning_recommendations_target_ref_check
    CHECK ((target_type = 'SUBJECT'    AND subject_id IS NOT NULL)
        OR (target_type = 'TOPIC'      AND topic_id IS NOT NULL)
        OR (target_type = 'COMPETENCY' AND competency_id IS NOT NULL)
        OR (target_type = 'EXAM'       AND recommended_exam_id IS NOT NULL)),
  CONSTRAINT learning_recommendations_tier_check CHECK (min_report_tier IN ('BASIC','COMPLETE')),
  CONSTRAINT learning_recommendations_status_check
    CHECK (status IN ('ACTIVE','SUPERSEDED','DISMISSED')),
  CONSTRAINT learning_recommendations_dismissed_check
    CHECK (status <> 'DISMISSED' OR dismissed_at IS NOT NULL)
);

-- Umpan balik siswa atas insight (FR-PI-16, P1)
CREATE TABLE insight_feedback (
  insight_id UUID        NOT NULL REFERENCES performance_insights(id),
  user_id    UUID        NOT NULL REFERENCES users(id),
  helpful    BOOLEAN     NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (insight_id, user_id)
);

-- Snapshot performa untuk Progress Tracking (FR-PRG-01): append-only, hanya is_current yang berubah
CREATE TABLE student_performance_snapshots (
  id             UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id        UUID         NOT NULL REFERENCES users(id),
  result_id      UUID         NOT NULL REFERENCES exam_results(id),
  attempt_id     UUID         NOT NULL REFERENCES exam_attempts(id),
  exam_id        UUID         NOT NULL REFERENCES exams(id),
  series_id      UUID         REFERENCES exam_series(id),     -- snapshot dari exam saat dinilai
  scoring_scheme TEXT         NOT NULL,
  scope_type     TEXT         NOT NULL,
  scope_key      TEXT         NOT NULL,     -- 'total' | posisi section | id topik/kompetensi
  scope_label    TEXT         NOT NULL,     -- nama section/topik saat dinilai
  subject_id     UUID         REFERENCES subjects(id),
  topic_id       UUID         REFERENCES topics(id),
  competency_id  UUID         REFERENCES competencies(id),
  score          NUMERIC(7,2),               -- skala 0–1000 (OVERALL, SECTION)
  accuracy       NUMERIC(5,4) NOT NULL,
  question_count INTEGER      NOT NULL,
  correct_count  INTEGER      NOT NULL,
  taken_at       TIMESTAMPTZ  NOT NULL,      -- submitted_at attempt
  is_current     BOOLEAN      NOT NULL DEFAULT TRUE,
  created_at     TIMESTAMPTZ  NOT NULL DEFAULT now(),
  CONSTRAINT student_performance_snapshots_unique UNIQUE (result_id, scope_type, scope_key),
  CONSTRAINT student_performance_snapshots_scope_check
    CHECK (scope_type IN ('OVERALL','SECTION','TOPIC','COMPETENCY')),
  CONSTRAINT student_performance_snapshots_scheme_check
    CHECK (scoring_scheme IN ('PROPORTIONAL_V1')),
  CONSTRAINT student_performance_snapshots_score_check
    CHECK (score IS NULL OR score BETWEEN 0 AND 1000),
  CONSTRAINT student_performance_snapshots_counts_check
    CHECK (question_count > 0 AND correct_count BETWEEN 0 AND question_count
           AND accuracy BETWEEN 0 AND 1)
);

-- =====================================================================
-- 8. CONFIGURATION, PRIVACY & FUTURE-STAGE BRIDGE (v2.0)
-- =====================================================================
-- Parameter produk dan ambang analitik (FR-EXM-13, FR-ADM-07)
CREATE TABLE system_settings (
  key         TEXT        PRIMARY KEY,
  value       JSONB       NOT NULL,
  description TEXT        NOT NULL DEFAULT '',
  updated_by  UUID        REFERENCES users(id),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT system_settings_key_check CHECK (key ~ '^[a-z][a-z0-9_.]*$')
);

-- Pendaftaran minat program tahap 3–4 (FR-FUT-01, P1)
CREATE TABLE program_interests (
  id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      UUID        NOT NULL REFERENCES users(id),
  program_type TEXT        NOT NULL,
  status       TEXT        NOT NULL DEFAULT 'ACTIVE',
  context      JSONB       NOT NULL DEFAULT '{}',   -- area prioritas terakhir, status siswa
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT program_interests_unique UNIQUE (user_id, program_type),
  CONSTRAINT program_interests_type_check
    CHECK (program_type IN ('PERSONALIZED_LEARNING','MENTORING','UNIVERSITY_PREPARATION')),
  CONSTRAINT program_interests_status_check CHECK (status IN ('ACTIVE','WITHDRAWN'))
);

-- Permintaan ekspor data siswa (FR-PROF-06, BR-PRV-05; P1)
CREATE TABLE data_export_requests (
  id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      UUID        NOT NULL REFERENCES users(id),
  status       TEXT        NOT NULL DEFAULT 'PENDING',
  storage_key  TEXT,
  expires_at   TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  error_message TEXT,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT data_export_requests_status_check
    CHECK (status IN ('PENDING','PROCESSING','READY','EXPIRED','FAILED')),
  CONSTRAINT data_export_requests_ready_check
    CHECK (status <> 'READY' OR (storage_key IS NOT NULL AND expires_at IS NOT NULL))
);

-- 5. Index v2.0
-- (v2.0) Taksonomi, seri, dan Performance Intelligence
CREATE INDEX question_competencies_competency_idx ON question_competencies (competency_id);
CREATE INDEX exams_series_idx                ON exams (series_id) WHERE series_id IS NOT NULL;
CREATE INDEX exams_type_status_idx           ON exams (exam_type, status);
CREATE INDEX result_competency_scores_comp_idx ON result_competency_scores (competency_id);
CREATE INDEX result_analyses_due_idx         ON result_analyses (created_at) WHERE status IN ('PENDING','FAILED');
CREATE INDEX performance_insights_analysis_idx ON performance_insights (analysis_id, dimension, display_order);
CREATE INDEX performance_insights_user_idx   ON performance_insights (user_id, created_at DESC);
CREATE INDEX learning_recommendations_analysis_idx ON learning_recommendations (analysis_id, recommendation_type, rank);
CREATE INDEX learning_recommendations_user_active_idx
  ON learning_recommendations (user_id, created_at DESC) WHERE status = 'ACTIVE';
CREATE INDEX snapshots_user_series_idx
  ON student_performance_snapshots (user_id, series_id, scope_type, scope_key, taken_at)
  WHERE is_current;
CREATE INDEX snapshots_user_taken_idx
  ON student_performance_snapshots (user_id, taken_at DESC) WHERE is_current;
CREATE INDEX snapshots_result_idx            ON student_performance_snapshots (result_id);
CREATE INDEX program_interests_type_idx      ON program_interests (program_type, status);
CREATE INDEX data_export_requests_user_idx   ON data_export_requests (user_id, created_at DESC);

-- 6. Trigger v2.0
DO $$
DECLARE t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY['competencies','exam_series','result_analyses','learning_recommendations',
    'insight_feedback','system_settings','program_interests','data_export_requests']
  LOOP
    EXECUTE format('CREATE TRIGGER %I BEFORE UPDATE ON %I FOR EACH ROW EXECUTE FUNCTION set_updated_at()',
      t || '_set_updated_at', t);
  END LOOP;
END $$;

CREATE TRIGGER question_competencies_guard
  BEFORE INSERT OR UPDATE OR DELETE ON question_competencies
  FOR EACH ROW EXECUTE FUNCTION guard_question_option();
-- (v2.0) Turunan result dan insight bersifat append-only (BR-PI-05/06)
CREATE TRIGGER result_competency_scores_immutable
  BEFORE UPDATE OR DELETE ON result_competency_scores
  FOR EACH ROW EXECUTE FUNCTION forbid_mutation();
CREATE TRIGGER result_behavior_metrics_immutable
  BEFORE UPDATE OR DELETE ON result_behavior_metrics
  FOR EACH ROW EXECUTE FUNCTION forbid_mutation();
CREATE TRIGGER performance_insights_immutable
  BEFORE UPDATE OR DELETE ON performance_insights
  FOR EACH ROW EXECUTE FUNCTION forbid_mutation();

-- (v2.0) Snapshot: hanya is_current TRUE → FALSE yang diizinkan
CREATE OR REPLACE FUNCTION guard_performance_snapshot() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'snapshot rows cannot be deleted' USING ERRCODE = 'restrict_violation';
  END IF;
  IF (to_jsonb(NEW) - 'is_current') IS DISTINCT FROM (to_jsonb(OLD) - 'is_current')
     OR (NOT OLD.is_current AND NEW.is_current) THEN
    RAISE EXCEPTION 'snapshot % is immutable', OLD.id USING ERRCODE = 'restrict_violation';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER student_performance_snapshots_guard
  BEFORE UPDATE OR DELETE ON student_performance_snapshots
  FOR EACH ROW EXECUTE FUNCTION guard_performance_snapshot();

-- (v2.0) Rekomendasi: hanya status (dan dismissed_at, updated_at) yang boleh berubah
CREATE OR REPLACE FUNCTION guard_learning_recommendation() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'recommendations cannot be deleted' USING ERRCODE = 'restrict_violation';
  END IF;
  IF (to_jsonb(NEW) - 'status' - 'dismissed_at' - 'updated_at')
     IS DISTINCT FROM (to_jsonb(OLD) - 'status' - 'dismissed_at' - 'updated_at') THEN
    RAISE EXCEPTION 'recommendation % is immutable', OLD.id USING ERRCODE = 'restrict_violation';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER learning_recommendations_guard
  BEFORE UPDATE OR DELETE ON learning_recommendations
  FOR EACH ROW EXECUTE FUNCTION guard_learning_recommendation();

-- 7. Konfigurasi esensial
-- (v2.0) Konfigurasi sistem esensial (wajib di semua lingkungan; migrasi 0006)
-- Parameter produk (FR-EXM-13, PRD 2.11) dan ambang analitik (BR-PI-02, BR-PRG-03)
INSERT INTO system_settings (key, value, description) VALUES
  ('tryout.free.question_count_range', '{"min":15,"max":25}', 'Rentang jumlah soal Free Try Out; di luar rentang = peringatan publish'),
  ('tryout.free.duration_minutes_range', '{"min":20,"max":30}', 'Rentang durasi Free Try Out; peringatan publish'),
  ('tryout.free.default_max_attempts', '1', 'Default max_attempts exam FREE_TRYOUT (1-3)'),
  ('tryout.free.max_claims_per_account', 'null', 'Batas jumlah Free Try Out per akun; null = tidak dibatasi'),
  ('tryout.mini.question_count_range', '{"min":10,"max":60}', 'Rentang jumlah soal Mini Try Out; peringatan publish'),
  ('analytics.min_questions_for_classification', '3', 'Minimum soal per topik/kompetensi untuk klasifikasi dan rekomendasi'),
  ('analytics.strong_threshold', '0.8', 'Akurasi minimum klasifikasi STRONG'),
  ('analytics.weak_threshold', '0.5', 'Akurasi di bawah nilai ini = NEEDS_IMPROVEMENT'),
  ('analytics.rule_set_version', '"pi-rules-2026.11"', 'Versi aturan Performance Intelligence yang aktif'),
  ('progress.same_score_delta', '50', 'Selisih skor skala di bawah nilai ini = relatif sama'),
  ('progress.same_accuracy_delta', '0.10', 'Selisih akurasi di bawah nilai ini = relatif sama')
ON CONFLICT (key) DO NOTHING;
