-- Migrasi v2.0 -> v3.0 (TDD v3.0 3.5b): reposisi produk.
-- Full Try Out satu-satunya tipe; paket 1x / Bundle / Lifetime dengan kredit dan akses musim;
-- referral + voucher; target kampus & jurusan; panduan materi; roadmap dan plan harian.

-- ----------------------------------------------------------------- 1. Tipe exam: hanya FULL_TRYOUT
ALTER TABLE exams DROP CONSTRAINT exams_series_fk;
ALTER TABLE exams DROP CONSTRAINT exams_type_check;
ALTER TABLE exams DROP CONSTRAINT exams_free_mode_check;
ALTER TABLE exams DROP CONSTRAINT exams_free_attempts_check;
ALTER TABLE exam_series DROP CONSTRAINT exam_series_type_check;
-- Data v2.0: Free dan Mini Try Out dijadikan FULL_TRYOUT; Exam Admin meninjau dan mengarsipkan
-- exam lama yang tidak sesuai cetak biru Full Try Out (3.10).
UPDATE exam_series SET exam_type = 'FULL_TRYOUT' WHERE exam_type <> 'FULL_TRYOUT';
UPDATE exams SET exam_type = 'FULL_TRYOUT' WHERE exam_type <> 'FULL_TRYOUT';
ALTER TABLE exams ADD CONSTRAINT exams_type_check CHECK (exam_type = 'FULL_TRYOUT');
ALTER TABLE exam_series ADD CONSTRAINT exam_series_type_check CHECK (exam_type = 'FULL_TRYOUT');
ALTER TABLE exams ADD CONSTRAINT exams_series_fk
  FOREIGN KEY (series_id, exam_type) REFERENCES exam_series (id, exam_type);

-- Musim: tanggal SNBT (dasar akses Lifetime H-7 dan horizon roadmap)
ALTER TABLE exam_series ADD COLUMN exam_date DATE;

-- Laporan satu tingkat
UPDATE result_analyses SET report_tier = 'COMPLETE' WHERE report_tier <> 'COMPLETE';
ALTER TABLE result_analyses ALTER COLUMN report_tier SET DEFAULT 'COMPLETE';

-- ----------------------------------------------------------------- 2. Paket (products)
ALTER TABLE products DROP CONSTRAINT products_type_check;
ALTER TABLE products ADD CONSTRAINT products_type_check CHECK (product_type IN ('SINGLE','BUNDLE','LIFETIME'));
ALTER TABLE products ADD COLUMN is_package BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE products ADD COLUMN tryout_credits SMALLINT;
ALTER TABLE products ADD COLUMN series_id UUID REFERENCES exam_series(id);
ALTER TABLE products ADD COLUMN display_order SMALLINT NOT NULL DEFAULT 0;
ALTER TABLE products ADD CONSTRAINT products_package_check CHECK (
  (NOT is_package AND product_type <> 'LIFETIME' AND tryout_credits IS NULL)
  OR (is_package AND series_id IS NOT NULL AND price_amount > 0 AND (
        (product_type = 'LIFETIME' AND tryout_credits IS NULL)
     OR (product_type IN ('SINGLE','BUNDLE') AND tryout_credits BETWEEN 1 AND 20))));
-- Product per exam (v1.0/v2.0) tidak dijual lagi
UPDATE products SET status = 'INACTIVE' WHERE NOT is_package AND status = 'ACTIVE';
CREATE UNIQUE INDEX products_package_type_series_key ON products (series_id, product_type)
  WHERE is_package AND status = 'ACTIVE';

ALTER TABLE order_items DROP CONSTRAINT order_items_type_check;
ALTER TABLE order_items ADD CONSTRAINT order_items_type_check CHECK (product_type IN ('SINGLE','BUNDLE','LIFETIME'));
ALTER TABLE order_items ADD COLUMN tryout_credits SMALLINT;           -- snapshot
ALTER TABLE order_items ADD COLUMN series_id UUID REFERENCES exam_series(id);  -- snapshot

-- Simulator pembayaran khusus pengembangan; gateway produksi = OQ-T1
ALTER TABLE payments DROP CONSTRAINT payments_provider_check;
ALTER TABLE payments ADD CONSTRAINT payments_provider_check CHECK (provider IN ('MIDTRANS','DEV_SIMULATED'));

-- ----------------------------------------------------------------- 3. Package grants + entitlement
CREATE TABLE package_grants (
  id            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       UUID        NOT NULL REFERENCES users(id),
  order_item_id UUID        REFERENCES order_items(id),
  kind          TEXT        NOT NULL,                       -- CREDITS | SEASON_PASS
  series_id     UUID        NOT NULL REFERENCES exam_series(id),
  credits_total SMALLINT,
  credits_used  SMALLINT    NOT NULL DEFAULT 0,
  valid_until   TIMESTAMPTZ NOT NULL,
  status        TEXT        NOT NULL DEFAULT 'ACTIVE',
  granted_by    UUID        REFERENCES users(id),
  grant_reason  TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT package_grants_order_item_key UNIQUE (order_item_id),
  CONSTRAINT package_grants_kind_check CHECK (kind IN ('CREDITS','SEASON_PASS')),
  CONSTRAINT package_grants_status_check CHECK (status IN ('ACTIVE','REVOKED')),
  CONSTRAINT package_grants_credits_check CHECK (
    (kind = 'CREDITS' AND credits_total >= 1 AND credits_used BETWEEN 0 AND credits_total)
    OR (kind = 'SEASON_PASS' AND credits_total IS NULL AND credits_used = 0)),
  CONSTRAINT package_grants_source_check CHECK (order_item_id IS NOT NULL OR (granted_by IS NOT NULL AND grant_reason IS NOT NULL))
);
CREATE INDEX package_grants_user_idx ON package_grants (user_id, status, valid_until);
-- BR-PKG-05: satu akses musim aktif per akun per musim
CREATE UNIQUE INDEX package_grants_one_pass_key ON package_grants (user_id, series_id)
  WHERE kind = 'SEASON_PASS' AND status = 'ACTIVE';

ALTER TABLE entitlements DROP CONSTRAINT entitlements_source_check;
-- FREE_CLAIM dipertahankan hanya untuk baris historis v2.0; kode v3.0 tidak membuatnya lagi
ALTER TABLE entitlements ADD CONSTRAINT entitlements_source_check
  CHECK (source IN ('PURCHASE','FREE_CLAIM','ADMIN_GRANT','PACKAGE'));
ALTER TABLE entitlements ADD COLUMN package_grant_id UUID REFERENCES package_grants(id);
ALTER TABLE entitlements ADD CONSTRAINT entitlements_package_check
  CHECK (source <> 'PACKAGE' OR package_grant_id IS NOT NULL);
-- FR-ENT-02 (3): penukaran berulang tidak memakai kredit lagi
CREATE UNIQUE INDEX entitlements_package_user_exam_key ON entitlements (user_id, exam_id)
  WHERE source = 'PACKAGE';

-- ----------------------------------------------------------------- 4. Referral + voucher
ALTER TABLE users ADD COLUMN referral_code TEXT;
ALTER TABLE users ADD CONSTRAINT users_referral_code_key UNIQUE (referral_code);
ALTER TABLE users ADD CONSTRAINT users_referral_code_check
  CHECK (referral_code IS NULL OR referral_code ~ '^[A-Z0-9]{6,10}$');

CREATE TABLE referrals (
  id                  UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  referrer_id         UUID        NOT NULL REFERENCES users(id),
  referred_id         UUID        NOT NULL REFERENCES users(id),
  code_used           TEXT        NOT NULL,
  qualified_at        TIMESTAMPTZ,
  qualifying_order_id UUID        REFERENCES orders(id),
  disqualified_at     TIMESTAMPTZ,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT referrals_referred_key UNIQUE (referred_id),          -- BR-REF-01
  CONSTRAINT referrals_self_check CHECK (referrer_id <> referred_id),
  CONSTRAINT referrals_qualified_check CHECK (qualified_at IS NULL OR qualifying_order_id IS NOT NULL)
);
CREATE INDEX referrals_referrer_idx ON referrals (referrer_id) WHERE qualified_at IS NOT NULL AND disqualified_at IS NULL;

CREATE TABLE vouchers (
  id                UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id           UUID        NOT NULL REFERENCES users(id),
  source            TEXT        NOT NULL DEFAULT 'REFERRAL',
  batch_no          INTEGER     NOT NULL,                   -- voucher ke-n dari kelipatan 3 referral
  percent_off       SMALLINT    NOT NULL,
  status            TEXT        NOT NULL DEFAULT 'AVAILABLE',
  reserved_order_id UUID        REFERENCES orders(id),
  used_order_id     UUID        REFERENCES orders(id),
  expires_at        TIMESTAMPTZ NOT NULL,
  used_at           TIMESTAMPTZ,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT vouchers_batch_key UNIQUE (user_id, source, batch_no),  -- penerbitan idempotent
  CONSTRAINT vouchers_source_check CHECK (source IN ('REFERRAL')),
  CONSTRAINT vouchers_percent_check CHECK (percent_off BETWEEN 1 AND 100),
  CONSTRAINT vouchers_status_check CHECK (status IN ('AVAILABLE','RESERVED','USED','EXPIRED')),
  CONSTRAINT vouchers_reserved_check CHECK (status <> 'RESERVED' OR reserved_order_id IS NOT NULL),
  CONSTRAINT vouchers_used_check CHECK (status <> 'USED' OR (used_order_id IS NOT NULL AND used_at IS NOT NULL))
);
CREATE INDEX vouchers_user_idx ON vouchers (user_id, status);
ALTER TABLE orders ADD COLUMN voucher_id UUID REFERENCES vouchers(id);

-- ----------------------------------------------------------------- 5. Target kampus & jurusan
CREATE TABLE universities (
  id         UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  name       TEXT        NOT NULL,
  short_name TEXT,
  province   TEXT,
  is_active  BOOLEAN     NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT universities_name_key UNIQUE (name)
);
CREATE TABLE study_programs (
  id               UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  university_id    UUID         NOT NULL REFERENCES universities(id),
  name             TEXT         NOT NULL,
  reference_score  NUMERIC(7,2),                -- skala sumber, BUKAN skala Cogniverse (BR-TGT-03)
  reference_source TEXT,
  reference_year   SMALLINT,
  is_active        BOOLEAN      NOT NULL DEFAULT TRUE,
  created_at       TIMESTAMPTZ  NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ  NOT NULL DEFAULT now(),
  CONSTRAINT study_programs_name_key UNIQUE (university_id, name),
  -- BR-TGT-02: tanpa sumber dan tahun, skor acuan tidak dapat disimpan
  CONSTRAINT study_programs_reference_check CHECK (
    reference_score IS NULL OR (reference_source IS NOT NULL AND length(trim(reference_source)) > 0
                                AND reference_year BETWEEN 2000 AND 2100))
);
CREATE TABLE student_targets (
  id                    UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id               UUID        NOT NULL REFERENCES users(id),
  priority              SMALLINT    NOT NULL,
  study_program_id      UUID        REFERENCES study_programs(id),
  custom_university     TEXT,
  custom_program        TEXT,
  personal_target_score SMALLINT,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT student_targets_priority_key UNIQUE (user_id, priority),
  CONSTRAINT student_targets_priority_check CHECK (priority IN (1, 2)),
  CONSTRAINT student_targets_choice_check CHECK (
    study_program_id IS NOT NULL OR (custom_university IS NOT NULL AND custom_program IS NOT NULL)),
  CONSTRAINT student_targets_score_check CHECK (
    personal_target_score IS NULL OR (personal_target_score BETWEEN 0 AND 1000 AND personal_target_score % 10 = 0))
);
ALTER TABLE student_profiles ADD COLUMN daily_study_minutes SMALLINT NOT NULL DEFAULT 60;
ALTER TABLE student_profiles ADD CONSTRAINT student_profiles_minutes_check
  CHECK (daily_study_minutes IN (30, 60, 90, 120));

-- ----------------------------------------------------------------- 6. Panduan materi + roadmap
CREATE TABLE topic_guides (
  topic_id   UUID        PRIMARY KEY REFERENCES topics(id),
  summary    TEXT        NOT NULL,
  key_points JSONB       NOT NULL DEFAULT '[]',
  updated_by UUID        REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT topic_guides_points_check CHECK (jsonb_typeof(key_points) = 'array')
);
CREATE TABLE study_plans (
  id               UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id          UUID        NOT NULL REFERENCES users(id),
  result_id        UUID        NOT NULL REFERENCES exam_results(id),
  rule_set_version TEXT        NOT NULL,
  status           TEXT        NOT NULL DEFAULT 'ACTIVE',
  start_date       DATE        NOT NULL,
  end_date         DATE        NOT NULL,
  exam_date        DATE,                         -- NULL = tanggal SNBT belum ditetapkan (FR-RMP-03)
  daily_minutes    SMALLINT    NOT NULL,
  target_score     SMALLINT,
  current_score    NUMERIC(7,2) NOT NULL,
  phases           JSONB       NOT NULL,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT study_plans_status_check CHECK (status IN ('ACTIVE','SUPERSEDED')),
  CONSTRAINT study_plans_dates_check CHECK (start_date <= end_date),
  CONSTRAINT study_plans_phases_check CHECK (jsonb_typeof(phases) = 'array')
);
CREATE UNIQUE INDEX study_plans_active_key ON study_plans (user_id) WHERE status = 'ACTIVE';
CREATE TABLE study_plan_items (
  id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  plan_id      UUID        NOT NULL REFERENCES study_plans(id),
  user_id      UUID        NOT NULL REFERENCES users(id),
  plan_date    DATE        NOT NULL,
  position     SMALLINT    NOT NULL,
  kind         TEXT        NOT NULL,
  topic_id     UUID        REFERENCES topics(id),
  title        TEXT        NOT NULL,
  detail       TEXT        NOT NULL DEFAULT '',
  est_minutes  SMALLINT    NOT NULL,
  status       TEXT        NOT NULL DEFAULT 'TODO',
  completed_at TIMESTAMPTZ,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT study_plan_items_position_key UNIQUE (plan_id, plan_date, position),
  CONSTRAINT study_plan_items_kind_check CHECK (kind IN ('GUIDE','REVIEW','PRACTICE','TRYOUT')),
  CONSTRAINT study_plan_items_status_check CHECK (status IN ('TODO','DONE')),
  CONSTRAINT study_plan_items_done_check CHECK (status <> 'DONE' OR completed_at IS NOT NULL),
  CONSTRAINT study_plan_items_minutes_check CHECK (est_minutes BETWEEN 5 AND 240)
);
CREATE INDEX study_plan_items_user_date_idx ON study_plan_items (user_id, plan_date);

-- ----------------------------------------------------------------- 7. updated_at + pengaturan
DO $$
DECLARE t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY['package_grants','referrals','vouchers','universities','study_programs',
                           'student_targets','topic_guides','study_plans','study_plan_items'] LOOP
    EXECUTE format('CREATE TRIGGER %I BEFORE UPDATE ON %I FOR EACH ROW EXECUTE FUNCTION set_updated_at()',
      t || '_set_updated_at', t);
  END LOOP;
END $$;

DELETE FROM system_settings WHERE key LIKE 'tryout.free.%' OR key LIKE 'tryout.mini.%';
INSERT INTO system_settings (key, value, description) VALUES
  ('tryout.full.question_count_range', '{"min":60,"max":160}', 'Rentang jumlah soal Full Try Out; di luar rentang = peringatan publish'),
  ('tryout.full.duration_minutes_range', '{"min":120,"max":200}', 'Rentang durasi Full Try Out (menit); peringatan publish'),
  ('referral.qualify_threshold', '3', 'Jumlah referral qualified per voucher (BR-REF-03)'),
  ('referral.discount_percent', '20', 'Persen diskon voucher referral (BR-REF-03)'),
  ('referral.voucher_valid_days', '90', 'Masa berlaku voucher referral dalam hari (BR-REF-04)'),
  ('roadmap.default_horizon_weeks', '8', 'Horizon roadmap bila tanggal SNBT belum ditetapkan (FR-RMP-03)'),
  ('roadmap.rule_set_version', '"rmp-2026.11"', 'Versi aturan roadmap'),
  ('lifetime.days_before_exam', '7', 'Akses Lifetime berakhir H-n sebelum tanggal SNBT (BR-PKG-04)'),
  ('payments.dev_simulator_enabled', 'true', 'Simulator pembayaran pengembangan; WAJIB false di produksi')
ON CONFLICT (key) DO NOTHING;
