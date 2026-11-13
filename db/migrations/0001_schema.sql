-- Sumber: TDD 3.5 (DDL)
-- =====================================================================
-- 0. EXTENSIONS & HELPER FUNCTIONS
-- =====================================================================
CREATE EXTENSION IF NOT EXISTS citext;
CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE OR REPLACE FUNCTION set_updated_at() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION forbid_mutation() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION '% on table % is not allowed', TG_OP, TG_TABLE_NAME
    USING ERRCODE = 'restrict_violation';
END;
$$;

-- =====================================================================
-- 1. IDENTITY & ACCESS
-- =====================================================================
CREATE TABLE users (
  id                 UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  email              CITEXT      NOT NULL,
  password_hash      TEXT,                              -- NULL selama status INVITED
  full_name          TEXT        NOT NULL,
  status             TEXT        NOT NULL DEFAULT 'ACTIVE',
  email_verified_at  TIMESTAMPTZ,
  failed_login_count INTEGER     NOT NULL DEFAULT 0,
  locked_until       TIMESTAMPTZ,
  last_login_at      TIMESTAMPTZ,
  suspended_at       TIMESTAMPTZ,
  suspended_by       UUID        REFERENCES users(id),
  suspension_reason  TEXT,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT users_email_key UNIQUE (email),
  CONSTRAINT users_status_check
    CHECK (status IN ('INVITED','ACTIVE','SUSPENDED','DELETED')),
  CONSTRAINT users_full_name_check CHECK (length(btrim(full_name)) > 0),
  CONSTRAINT users_password_required_check
    CHECK (status = 'INVITED' OR status = 'DELETED' OR password_hash IS NOT NULL),
  CONSTRAINT users_suspension_check
    CHECK (status <> 'SUSPENDED' OR (suspended_at IS NOT NULL AND suspension_reason IS NOT NULL))
);

CREATE TABLE roles (
  id         UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  code       TEXT        NOT NULL,
  name       TEXT        NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT roles_code_key UNIQUE (code),
  CONSTRAINT roles_code_check
    CHECK (code IN ('STUDENT','CONTRIBUTOR','CONTENT_EDITOR','EXAM_ADMIN','SUPER_ADMIN'))
);

CREATE TABLE user_roles (
  user_id     UUID        NOT NULL REFERENCES users(id),
  role_id     UUID        NOT NULL REFERENCES roles(id),
  assigned_by UUID        REFERENCES users(id),
  assigned_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, role_id)
);

CREATE TABLE student_profiles (
  id                      UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id                 UUID        NOT NULL REFERENCES users(id),
  student_status          TEXT,
  school_name             TEXT,
  graduation_year         SMALLINT,
  province                TEXT,
  phone                   TEXT,
  onboarding_completed_at TIMESTAMPTZ,                  -- NOT NULL = profil lengkap (FR-PROF-03)
  created_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT student_profiles_user_id_key UNIQUE (user_id),
  CONSTRAINT student_profiles_status_check
    CHECK (student_status IS NULL OR student_status IN ('GRADE_12','GAP_YEAR')),
  CONSTRAINT student_profiles_graduation_year_check
    CHECK (graduation_year IS NULL OR graduation_year BETWEEN 2000 AND 2100),
  CONSTRAINT student_profiles_complete_check
    CHECK (onboarding_completed_at IS NULL OR
           (student_status IS NOT NULL AND school_name IS NOT NULL
            AND graduation_year IS NOT NULL AND province IS NOT NULL))
);

CREATE TABLE auth_sessions (
  id                 UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id            UUID        NOT NULL REFERENCES users(id),
  family_id          UUID        NOT NULL,              -- rantai rotasi refresh token
  refresh_token_hash TEXT        NOT NULL,
  expires_at         TIMESTAMPTZ NOT NULL,
  last_used_at       TIMESTAMPTZ,
  revoked_at         TIMESTAMPTZ,
  revoked_reason     TEXT,
  replaced_by_id     UUID        REFERENCES auth_sessions(id),
  user_agent         TEXT,
  ip                 INET,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT auth_sessions_refresh_token_hash_key UNIQUE (refresh_token_hash)
);

CREATE TABLE auth_tokens (
  id         UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    UUID        NOT NULL REFERENCES users(id),
  purpose    TEXT        NOT NULL,
  token_hash TEXT        NOT NULL,
  new_email  CITEXT,                                    -- hanya untuk EMAIL_CHANGE
  expires_at TIMESTAMPTZ NOT NULL,
  used_at    TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT auth_tokens_token_hash_key UNIQUE (token_hash),
  CONSTRAINT auth_tokens_purpose_check
    CHECK (purpose IN ('EMAIL_VERIFICATION','PASSWORD_RESET','INVITATION','EMAIL_CHANGE'))
);

CREATE TABLE user_consents (
  id               UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id          UUID        NOT NULL REFERENCES users(id),
  document_type    TEXT        NOT NULL,
  document_version TEXT        NOT NULL,
  accepted_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  ip               INET,
  CONSTRAINT user_consents_unique UNIQUE (user_id, document_type, document_version),
  CONSTRAINT user_consents_type_check
    CHECK (document_type IN ('TERMS','PRIVACY','CONTRIBUTOR_AGREEMENT'))
);

-- =====================================================================
-- 2. QUESTION BANK
-- =====================================================================
CREATE TABLE subjects (
  id         UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  code       TEXT        NOT NULL,
  name       TEXT        NOT NULL,
  position   INTEGER     NOT NULL DEFAULT 0,
  is_active  BOOLEAN     NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT subjects_code_key UNIQUE (code)
);

CREATE TABLE topics (
  id         UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  subject_id UUID        NOT NULL REFERENCES subjects(id),
  code       TEXT        NOT NULL,
  name       TEXT        NOT NULL,
  is_active  BOOLEAN     NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT topics_subject_code_key UNIQUE (subject_id, code),
  CONSTRAINT topics_id_subject_key   UNIQUE (id, subject_id)   -- target FK komposit
);

CREATE TABLE questions (
  id             UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  author_id      UUID        NOT NULL REFERENCES users(id),
  question_type  TEXT        NOT NULL DEFAULT 'SINGLE_CHOICE',
  status         TEXT        NOT NULL DEFAULT 'ACTIVE',
  retired_at     TIMESTAMPTZ,
  retired_by     UUID        REFERENCES users(id),
  retired_reason TEXT,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT questions_type_check   CHECK (question_type IN ('SINGLE_CHOICE')),
  CONSTRAINT questions_status_check CHECK (status IN ('ACTIVE','RETIRED')),
  CONSTRAINT questions_retired_check
    CHECK (status <> 'RETIRED' OR (retired_at IS NOT NULL AND retired_reason IS NOT NULL))
);

CREATE TABLE question_versions (
  id                  UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  question_id         UUID        NOT NULL REFERENCES questions(id),
  version_number      INTEGER     NOT NULL,
  status              TEXT        NOT NULL DEFAULT 'DRAFT',
  author_id           UUID        NOT NULL REFERENCES users(id),
  subject_id          UUID        REFERENCES subjects(id),
  topic_id            UUID,
  difficulty          TEXT,
  cognitive_level     TEXT,
  stem_html           TEXT        NOT NULL DEFAULT '',
  stem_plain          TEXT        NOT NULL DEFAULT '',     -- teks polos untuk pencarian
  explanation_html    TEXT        NOT NULL DEFAULT '',
  corrects_version_id UUID        REFERENCES question_versions(id),  -- versi yang dikoreksi (BR-QV-07)
  submitted_at        TIMESTAMPTZ,
  decided_at          TIMESTAMPTZ,
  decided_by          UUID        REFERENCES users(id),
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT question_versions_number_key UNIQUE (question_id, version_number),
  CONSTRAINT question_versions_id_question_key UNIQUE (id, question_id),  -- target FK komposit
  CONSTRAINT question_versions_topic_fk
    FOREIGN KEY (topic_id, subject_id) REFERENCES topics (id, subject_id),
  CONSTRAINT question_versions_number_check CHECK (version_number > 0),
  CONSTRAINT question_versions_status_check
    CHECK (status IN ('DRAFT','IN_REVIEW','CHANGES_REQUESTED','APPROVED','REJECTED')),
  CONSTRAINT question_versions_difficulty_check
    CHECK (difficulty IS NULL OR difficulty IN ('EASY','MEDIUM','HARD')),
  CONSTRAINT question_versions_cognitive_check
    CHECK (cognitive_level IS NULL OR cognitive_level IN
           ('REMEMBER','UNDERSTAND','APPLY','ANALYZE','EVALUATE','CREATE')),
  -- BR-QV-08: metadata dan isi wajib lengkap sebelum masuk review
  CONSTRAINT question_versions_complete_check
    CHECK (status NOT IN ('IN_REVIEW','APPROVED') OR
           (subject_id IS NOT NULL AND topic_id IS NOT NULL
            AND difficulty IS NOT NULL AND cognitive_level IS NOT NULL
            AND length(btrim(stem_plain)) > 0
            AND length(btrim(explanation_html)) > 0)),
  -- BR-QV-04: pemutus tidak boleh penulis
  CONSTRAINT question_versions_four_eyes_check
    CHECK (decided_by IS NULL OR decided_by <> author_id),
  CONSTRAINT question_versions_decided_check
    CHECK (status NOT IN ('APPROVED','REJECTED')
           OR (decided_by IS NOT NULL AND decided_at IS NOT NULL))
);

-- FR-QV-01: paling banyak satu versi yang belum diputuskan per soal
CREATE UNIQUE INDEX question_versions_one_open_idx
  ON question_versions (question_id)
  WHERE status IN ('DRAFT','IN_REVIEW','CHANGES_REQUESTED');

CREATE TABLE question_options (
  id                  UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  question_version_id UUID        NOT NULL REFERENCES question_versions(id) ON DELETE CASCADE,
  option_key          CHAR(1)     NOT NULL,
  content_html        TEXT        NOT NULL,
  is_correct          BOOLEAN     NOT NULL DEFAULT FALSE,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT question_options_key_key UNIQUE (question_version_id, option_key),
  CONSTRAINT question_options_id_version_key UNIQUE (id, question_version_id),
  CONSTRAINT question_options_key_check CHECK (option_key IN ('A','B','C','D','E'))
);

-- BR-QV-08: paling banyak satu kunci per versi
-- ("tepat satu" dan "4–5 opsi" divalidasi aplikasi saat pengajuan review)
CREATE UNIQUE INDEX question_options_one_correct_idx
  ON question_options (question_version_id) WHERE is_correct;

CREATE TABLE question_reviews (
  id                  UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  question_version_id UUID        NOT NULL REFERENCES question_versions(id),
  reviewer_id         UUID        NOT NULL REFERENCES users(id),
  decision            TEXT        NOT NULL,
  notes               TEXT,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT question_reviews_decision_check
    CHECK (decision IN ('APPROVED','CHANGES_REQUESTED','REJECTED')),
  CONSTRAINT question_reviews_notes_check
    CHECK (decision = 'APPROVED' OR length(btrim(coalesce(notes, ''))) > 0)
);

CREATE TABLE media_assets (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  uploader_id     UUID        NOT NULL REFERENCES users(id),
  storage_key     TEXT        NOT NULL,
  mime_type       TEXT        NOT NULL,
  size_bytes      INTEGER     NOT NULL,
  checksum_sha256 TEXT,
  status          TEXT        NOT NULL DEFAULT 'PENDING',
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT media_assets_storage_key_key UNIQUE (storage_key),
  CONSTRAINT media_assets_mime_check
    CHECK (mime_type IN ('image/png','image/jpeg','image/webp')),
  CONSTRAINT media_assets_size_check CHECK (size_bytes BETWEEN 1 AND 2097152),
  CONSTRAINT media_assets_status_check CHECK (status IN ('PENDING','READY'))
);

-- =====================================================================
-- 3. EXAMINATION
-- =====================================================================
CREATE TABLE exams (
  id                   UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  slug                 TEXT        NOT NULL,
  title                TEXT        NOT NULL,
  description          TEXT        NOT NULL DEFAULT '',
  instructions_html    TEXT        NOT NULL DEFAULT '',
  exam_type            TEXT        NOT NULL,
  delivery_mode        TEXT        NOT NULL,
  timing_mode          TEXT        NOT NULL,
  status               TEXT        NOT NULL DEFAULT 'DRAFT',
  duration_minutes     INTEGER,                         -- wajib untuk timing_mode TOTAL
  available_from       TIMESTAMPTZ,
  available_until      TIMESTAMPTZ,
  max_attempts         SMALLINT    NOT NULL DEFAULT 1,
  access_duration_days INTEGER,
  created_by           UUID        NOT NULL REFERENCES users(id),
  published_at         TIMESTAMPTZ,
  published_by         UUID        REFERENCES users(id),
  archived_at          TIMESTAMPTZ,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT exams_slug_key UNIQUE (slug),
  CONSTRAINT exams_type_check     CHECK (exam_type IN ('DIAGNOSTIC','TRYOUT')),
  CONSTRAINT exams_delivery_check CHECK (delivery_mode IN ('ON_DEMAND','SCHEDULED')),
  CONSTRAINT exams_timing_check   CHECK (timing_mode IN ('TOTAL','PER_SECTION')),
  CONSTRAINT exams_status_check
    CHECK (status IN ('DRAFT','PUBLISHED','UNPUBLISHED','ARCHIVED')),
  CONSTRAINT exams_duration_check
    CHECK (duration_minutes IS NULL OR duration_minutes > 0),
  CONSTRAINT exams_total_duration_required_check
    CHECK (status = 'DRAFT' OR timing_mode <> 'TOTAL' OR duration_minutes IS NOT NULL),
  CONSTRAINT exams_availability_check
    CHECK (status = 'DRAFT' OR
           (available_from IS NOT NULL AND available_until IS NOT NULL
            AND available_from < available_until)),
  -- BR-ATT-01
  CONSTRAINT exams_max_attempts_check CHECK (max_attempts BETWEEN 1 AND 5),
  CONSTRAINT exams_single_attempt_check
    CHECK (max_attempts = 1 OR (delivery_mode = 'ON_DEMAND' AND exam_type <> 'DIAGNOSTIC')),
  CONSTRAINT exams_access_days_check
    CHECK (access_duration_days IS NULL OR access_duration_days > 0)
);

CREATE TABLE exam_sections (
  id                UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  exam_id           UUID        NOT NULL REFERENCES exams(id) ON DELETE CASCADE,
  name              TEXT        NOT NULL,
  position          INTEGER     NOT NULL,
  duration_minutes  INTEGER,                            -- wajib untuk timing_mode PER_SECTION
  instructions_html TEXT        NOT NULL DEFAULT '',
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT exam_sections_position_key
    UNIQUE (exam_id, position) DEFERRABLE INITIALLY DEFERRED,
  CONSTRAINT exam_sections_id_exam_key UNIQUE (id, exam_id),
  CONSTRAINT exam_sections_position_check CHECK (position > 0),
  CONSTRAINT exam_sections_duration_check
    CHECK (duration_minutes IS NULL OR duration_minutes > 0)
);

CREATE TABLE exam_questions (
  id                  UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  exam_id             UUID         NOT NULL,
  exam_section_id     UUID         NOT NULL,
  question_id         UUID         NOT NULL REFERENCES questions(id),
  question_version_id UUID         NOT NULL,            -- versi yang disematkan (BR-QV-03)
  scoring_version_id  UUID,                             -- versi koreksi kunci, bila ada (BR-QV-07)
  position            INTEGER      NOT NULL,
  weight              NUMERIC(6,2) NOT NULL DEFAULT 1,
  created_at          TIMESTAMPTZ  NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ  NOT NULL DEFAULT now(),
  CONSTRAINT exam_questions_section_fk
    FOREIGN KEY (exam_section_id, exam_id)
    REFERENCES exam_sections (id, exam_id) ON DELETE CASCADE,
  CONSTRAINT exam_questions_version_fk
    FOREIGN KEY (question_version_id, question_id)
    REFERENCES question_versions (id, question_id),
  CONSTRAINT exam_questions_scoring_version_fk
    FOREIGN KEY (scoring_version_id, question_id)
    REFERENCES question_versions (id, question_id),
  -- FR-EXM-03: satu soal hanya sekali dalam satu exam
  CONSTRAINT exam_questions_unique_question UNIQUE (exam_id, question_id),
  CONSTRAINT exam_questions_position_key
    UNIQUE (exam_section_id, position) DEFERRABLE INITIALLY DEFERRED,
  CONSTRAINT exam_questions_position_check CHECK (position > 0),
  CONSTRAINT exam_questions_weight_check   CHECK (weight > 0)
);

CREATE TABLE exam_sessions (
  id                    UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  exam_id               UUID        NOT NULL REFERENCES exams(id),
  name                  TEXT        NOT NULL,
  status                TEXT        NOT NULL DEFAULT 'DRAFT',
  registration_open_at  TIMESTAMPTZ NOT NULL,
  registration_close_at TIMESTAMPTZ NOT NULL,
  start_at              TIMESTAMPTZ NOT NULL,
  entry_close_at        TIMESTAMPTZ NOT NULL,
  hard_end_at           TIMESTAMPTZ NOT NULL,           -- dihitung aplikasi (BR-SCH-02)
  capacity              INTEGER     NOT NULL,
  seats_taken           INTEGER     NOT NULL DEFAULT 0,
  result_publish_mode   TEXT        NOT NULL DEFAULT 'IMMEDIATE',
  result_publish_at     TIMESTAMPTZ,
  results_published_at  TIMESTAMPTZ,
  no_show_processed_at  TIMESTAMPTZ,
  cancelled_at          TIMESTAMPTZ,
  cancelled_by          UUID        REFERENCES users(id),
  cancel_reason         TEXT,
  created_by            UUID        NOT NULL REFERENCES users(id),
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT exam_sessions_id_exam_key UNIQUE (id, exam_id),
  CONSTRAINT exam_sessions_status_check
    CHECK (status IN ('DRAFT','PUBLISHED','CANCELLED')),
  -- BR-SCH-01
  CONSTRAINT exam_sessions_time_order_check
    CHECK (registration_open_at < registration_close_at
           AND registration_close_at <= entry_close_at
           AND start_at < entry_close_at
           AND entry_close_at < hard_end_at),
  CONSTRAINT exam_sessions_publish_mode_check
    CHECK (result_publish_mode IN ('IMMEDIATE','AT_TIME')),
  CONSTRAINT exam_sessions_publish_at_check
    CHECK ((result_publish_mode = 'IMMEDIATE' AND result_publish_at IS NULL)
        OR (result_publish_mode = 'AT_TIME'
            AND result_publish_at IS NOT NULL
            AND result_publish_at >= hard_end_at)),
  -- BR-CAP-02, BR-CAP-04
  CONSTRAINT exam_sessions_capacity_check CHECK (capacity >= 1),
  CONSTRAINT exam_sessions_seats_check    CHECK (seats_taken BETWEEN 0 AND capacity),
  CONSTRAINT exam_sessions_cancel_check
    CHECK (status <> 'CANCELLED' OR (cancelled_at IS NOT NULL AND cancel_reason IS NOT NULL))
);

-- =====================================================================
-- 4. COMMERCE
-- =====================================================================
CREATE TABLE products (
  id             UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  slug           TEXT          NOT NULL,
  product_type   TEXT          NOT NULL,
  name           TEXT          NOT NULL,
  description    TEXT          NOT NULL DEFAULT '',
  price_amount   NUMERIC(14,2) NOT NULL,
  currency       CHAR(3)       NOT NULL DEFAULT 'IDR',
  status         TEXT          NOT NULL DEFAULT 'DRAFT',
  sale_starts_at TIMESTAMPTZ,
  sale_ends_at   TIMESTAMPTZ,
  created_by     UUID          NOT NULL REFERENCES users(id),
  created_at     TIMESTAMPTZ   NOT NULL DEFAULT now(),
  updated_at     TIMESTAMPTZ   NOT NULL DEFAULT now(),
  CONSTRAINT products_slug_key UNIQUE (slug),
  CONSTRAINT products_type_check   CHECK (product_type IN ('SINGLE','BUNDLE')),
  CONSTRAINT products_status_check CHECK (status IN ('DRAFT','ACTIVE','INACTIVE')),
  CONSTRAINT products_currency_check CHECK (currency = 'IDR'),
  -- BR-PAY-09: rupiah bulat; harga 0 = gratis (hanya SINGLE)
  CONSTRAINT products_price_check
    CHECK (price_amount >= 0 AND price_amount = trunc(price_amount)),
  CONSTRAINT products_bundle_paid_check
    CHECK (product_type <> 'BUNDLE' OR price_amount > 0),
  CONSTRAINT products_sale_window_check
    CHECK (sale_starts_at IS NULL OR sale_ends_at IS NULL OR sale_starts_at < sale_ends_at)
);

CREATE TABLE product_exams (
  id         UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id UUID        NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  exam_id    UUID        NOT NULL REFERENCES exams(id),
  position   INTEGER     NOT NULL DEFAULT 1,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT product_exams_unique UNIQUE (product_id, exam_id)
);

CREATE TABLE orders (
  id               UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  order_number     TEXT          NOT NULL,
  user_id          UUID          NOT NULL REFERENCES users(id),
  status           TEXT          NOT NULL DEFAULT 'PENDING',
  currency         CHAR(3)       NOT NULL DEFAULT 'IDR',
  subtotal_amount  NUMERIC(14,2) NOT NULL,
  discount_amount  NUMERIC(14,2) NOT NULL DEFAULT 0,
  total_amount     NUMERIC(14,2) NOT NULL,
  expires_at       TIMESTAMPTZ   NOT NULL,
  paid_at          TIMESTAMPTZ,
  cancelled_at     TIMESTAMPTZ,
  cancel_reason    TEXT,
  refunded_at      TIMESTAMPTZ,
  refunded_by      UUID          REFERENCES users(id),
  refund_reference TEXT,
  refund_reason    TEXT,
  idempotency_key  TEXT,
  created_at       TIMESTAMPTZ   NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ   NOT NULL DEFAULT now(),
  CONSTRAINT orders_order_number_key UNIQUE (order_number),
  CONSTRAINT orders_idempotency_key UNIQUE (user_id, idempotency_key),
  CONSTRAINT orders_status_check
    CHECK (status IN ('PENDING','PAID','EXPIRED','CANCELLED','REFUNDED')),
  CONSTRAINT orders_currency_check CHECK (currency = 'IDR'),
  CONSTRAINT orders_amounts_check
    CHECK (subtotal_amount > 0 AND discount_amount >= 0
           AND total_amount = subtotal_amount - discount_amount
           AND total_amount > 0
           AND total_amount = trunc(total_amount)),
  CONSTRAINT orders_paid_check
    CHECK (status NOT IN ('PAID','REFUNDED') OR paid_at IS NOT NULL)
);

CREATE TABLE order_items (
  id           UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id     UUID          NOT NULL REFERENCES orders(id),
  product_id   UUID          NOT NULL REFERENCES products(id),
  product_type TEXT          NOT NULL,                  -- snapshot
  product_name TEXT          NOT NULL,                  -- snapshot (BR-PAY-01)
  unit_price   NUMERIC(14,2) NOT NULL,                  -- snapshot
  quantity     SMALLINT      NOT NULL DEFAULT 1,
  line_total   NUMERIC(14,2) NOT NULL,
  created_at   TIMESTAMPTZ   NOT NULL DEFAULT now(),
  CONSTRAINT order_items_unique_product UNIQUE (order_id, product_id),
  CONSTRAINT order_items_type_check CHECK (product_type IN ('SINGLE','BUNDLE')),
  CONSTRAINT order_items_quantity_check CHECK (quantity = 1),
  CONSTRAINT order_items_amount_check
    CHECK (unit_price > 0 AND line_total = unit_price * quantity)
);

CREATE TABLE order_item_exams (
  id            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  order_item_id UUID        NOT NULL REFERENCES order_items(id),
  exam_id       UUID        NOT NULL REFERENCES exams(id),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT order_item_exams_unique UNIQUE (order_item_id, exam_id)
);

CREATE TABLE payments (
  id                      UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id                UUID          NOT NULL REFERENCES orders(id),
  provider                TEXT          NOT NULL DEFAULT 'MIDTRANS',
  provider_order_id       TEXT          NOT NULL,       -- ID yang dikirim ke gateway
  provider_transaction_id TEXT,                         -- ID dari gateway
  status                  TEXT          NOT NULL DEFAULT 'PENDING',
  amount                  NUMERIC(14,2) NOT NULL,
  currency                CHAR(3)       NOT NULL DEFAULT 'IDR',
  payment_method          TEXT,
  checkout_token          TEXT,
  checkout_url            TEXT,
  expires_at              TIMESTAMPTZ   NOT NULL,
  settled_at              TIMESTAMPTZ,
  failed_at               TIMESTAMPTZ,
  failure_reason          TEXT,
  raw_status              JSONB,                        -- respons Status API terakhir
  created_at              TIMESTAMPTZ   NOT NULL DEFAULT now(),
  updated_at              TIMESTAMPTZ   NOT NULL DEFAULT now(),
  CONSTRAINT payments_provider_order_id_key UNIQUE (provider_order_id),
  CONSTRAINT payments_provider_txn_key UNIQUE (provider, provider_transaction_id),
  CONSTRAINT payments_provider_check CHECK (provider IN ('MIDTRANS')),
  CONSTRAINT payments_status_check
    CHECK (status IN ('PENDING','SETTLED','FAILED','EXPIRED','REFUNDED')),
  CONSTRAINT payments_amount_check CHECK (amount > 0),
  CONSTRAINT payments_settled_check
    CHECK (status NOT IN ('SETTLED','REFUNDED') OR settled_at IS NOT NULL)
);

-- BR-PAY-04: paling banyak satu pembayaran berhasil per order
CREATE UNIQUE INDEX payments_one_settled_idx
  ON payments (order_id) WHERE status IN ('SETTLED','REFUNDED');
-- paling banyak satu percobaan aktif per order
CREATE UNIQUE INDEX payments_one_pending_idx
  ON payments (order_id) WHERE status = 'PENDING';

CREATE TABLE payment_webhook_events (
  id                UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  provider          TEXT        NOT NULL,
  dedupe_key        TEXT        NOT NULL,   -- provider:transaction_id:transaction_status
  provider_order_id TEXT,
  payment_id        UUID        REFERENCES payments(id),
  signature_valid   BOOLEAN     NOT NULL,
  payload           JSONB       NOT NULL,
  outcome           TEXT        NOT NULL DEFAULT 'RECEIVED',
  error_message     TEXT,
  received_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  processed_at      TIMESTAMPTZ,
  CONSTRAINT payment_webhook_events_outcome_check
    CHECK (outcome IN ('RECEIVED','APPLIED','IGNORED_DUPLICATE','IGNORED_STALE',
                       'REJECTED_SIGNATURE','REJECTED_MISMATCH','UNKNOWN_ORDER','ERROR'))
);

CREATE TABLE entitlements (
  id            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       UUID        NOT NULL REFERENCES users(id),
  exam_id       UUID        NOT NULL REFERENCES exams(id),
  source        TEXT        NOT NULL,
  order_item_id UUID        REFERENCES order_items(id),
  status        TEXT        NOT NULL DEFAULT 'ACTIVE',
  max_attempts  SMALLINT    NOT NULL,
  attempts_used SMALLINT    NOT NULL DEFAULT 0,
  valid_until   TIMESTAMPTZ NOT NULL,                   -- BR-OND-02
  granted_by    UUID        REFERENCES users(id),
  grant_reason  TEXT,
  revoked_at    TIMESTAMPTZ,
  revoked_by    UUID        REFERENCES users(id),
  revoke_reason TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- BR-ENT-02 + idempotency pembuatan dari pembayaran
  CONSTRAINT entitlements_order_item_exam_key UNIQUE (order_item_id, exam_id),
  CONSTRAINT entitlements_source_check
    CHECK (source IN ('PURCHASE','FREE_CLAIM','ADMIN_GRANT')),
  CONSTRAINT entitlements_status_check CHECK (status IN ('ACTIVE','REVOKED')),
  CONSTRAINT entitlements_attempts_check
    CHECK (max_attempts >= 1 AND attempts_used BETWEEN 0 AND max_attempts),
  CONSTRAINT entitlements_purchase_check
    CHECK (source <> 'PURCHASE' OR order_item_id IS NOT NULL),
  CONSTRAINT entitlements_grant_check
    CHECK (source <> 'ADMIN_GRANT' OR (granted_by IS NOT NULL AND grant_reason IS NOT NULL)),
  CONSTRAINT entitlements_revoke_check
    CHECK (status <> 'REVOKED' OR (revoked_at IS NOT NULL AND revoke_reason IS NOT NULL))
);

-- BR-OND-05: satu klaim gratis per akun per exam
CREATE UNIQUE INDEX entitlements_one_free_claim_idx
  ON entitlements (user_id, exam_id) WHERE source = 'FREE_CLAIM';

-- (didefinisikan setelah orders & entitlements karena FK)
CREATE TABLE exam_enrollments (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id      UUID        NOT NULL,
  exam_id         UUID        NOT NULL,
  user_id         UUID        NOT NULL REFERENCES users(id),
  entitlement_id  UUID        REFERENCES entitlements(id),
  order_id        UUID        REFERENCES orders(id),
  status          TEXT        NOT NULL,
  hold_expires_at TIMESTAMPTZ,
  confirmed_at    TIMESTAMPTZ,
  cancelled_at    TIMESTAMPTZ,
  cancel_reason   TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT exam_enrollments_session_fk
    FOREIGN KEY (session_id, exam_id) REFERENCES exam_sessions (id, exam_id),
  CONSTRAINT exam_enrollments_status_check
    CHECK (status IN ('PENDING_PAYMENT','CONFIRMED','ATTENDED','NO_SHOW','EXPIRED','CANCELLED')),
  CONSTRAINT exam_enrollments_hold_check
    CHECK (status <> 'PENDING_PAYMENT' OR (order_id IS NOT NULL AND hold_expires_at IS NOT NULL)),
  CONSTRAINT exam_enrollments_entitlement_check
    CHECK (status NOT IN ('CONFIRMED','ATTENDED','NO_SHOW') OR entitlement_id IS NOT NULL)
);

-- BR-SCH-04: satu enrollment aktif per siswa per exam
CREATE UNIQUE INDEX exam_enrollments_one_active_per_exam_idx
  ON exam_enrollments (user_id, exam_id)
  WHERE status IN ('PENDING_PAYMENT','CONFIRMED');
-- BR-SCH-04: satu enrollment non-terminal-gagal per siswa per session
CREATE UNIQUE INDEX exam_enrollments_one_per_session_idx
  ON exam_enrollments (user_id, session_id)
  WHERE status NOT IN ('EXPIRED','CANCELLED');

-- =====================================================================
-- 5. EXAMINATION EXECUTION
-- =====================================================================
CREATE TABLE exam_attempts (
  id                        UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id                   UUID        NOT NULL REFERENCES users(id),
  exam_id                   UUID        NOT NULL REFERENCES exams(id),
  entitlement_id            UUID        NOT NULL REFERENCES entitlements(id),
  enrollment_id             UUID        REFERENCES exam_enrollments(id),
  session_id                UUID        REFERENCES exam_sessions(id),
  attempt_number            SMALLINT    NOT NULL,
  status                    TEXT        NOT NULL DEFAULT 'IN_PROGRESS',
  submission_type           TEXT,
  timing_mode               TEXT        NOT NULL,       -- snapshot (BR-LIF-02)
  total_questions           INTEGER     NOT NULL,
  started_at                TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at                TIMESTAMPTZ NOT NULL,       -- tenggat akhir (BR-DUR-02/03)
  submitted_at              TIMESTAMPTZ,
  scored_at                 TIMESTAMPTZ,
  client_session_hash       TEXT,                       -- sesi perangkat aktif (BR-LIF-04)
  client_session_started_at TIMESTAMPTZ,
  voided_at                 TIMESTAMPTZ,
  voided_by                 UUID        REFERENCES users(id),
  void_reason               TEXT,
  created_at                TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at                TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT exam_attempts_number_key UNIQUE (entitlement_id, attempt_number),
  CONSTRAINT exam_attempts_enrollment_key UNIQUE (enrollment_id),
  CONSTRAINT exam_attempts_status_check
    CHECK (status IN ('IN_PROGRESS','SUBMITTED','SCORED','VOIDED')),
  CONSTRAINT exam_attempts_submission_type_check
    CHECK (submission_type IS NULL OR submission_type IN ('MANUAL','AUTO_TIMEOUT')),
  CONSTRAINT exam_attempts_timing_check CHECK (timing_mode IN ('TOTAL','PER_SECTION')),
  CONSTRAINT exam_attempts_expiry_check CHECK (expires_at > started_at),
  CONSTRAINT exam_attempts_submitted_check
    CHECK (status NOT IN ('SUBMITTED','SCORED')
           OR (submitted_at IS NOT NULL AND submission_type IS NOT NULL)),
  CONSTRAINT exam_attempts_in_progress_check
    CHECK (status <> 'IN_PROGRESS' OR submitted_at IS NULL),
  CONSTRAINT exam_attempts_void_check
    CHECK (status <> 'VOIDED' OR (voided_at IS NOT NULL AND void_reason IS NOT NULL)),
  CONSTRAINT exam_attempts_session_pair_check
    CHECK ((enrollment_id IS NULL) = (session_id IS NULL))
);

-- BR-ATT-03: satu attempt IN_PROGRESS per siswa, lintas exam
CREATE UNIQUE INDEX exam_attempts_one_in_progress_idx
  ON exam_attempts (user_id) WHERE status = 'IN_PROGRESS';

CREATE TABLE attempt_sections (
  id               UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  attempt_id       UUID        NOT NULL REFERENCES exam_attempts(id),
  exam_section_id  UUID        NOT NULL REFERENCES exam_sections(id),
  name             TEXT        NOT NULL,                -- snapshot
  position         INTEGER     NOT NULL,
  duration_seconds INTEGER     NOT NULL,                -- snapshot (BR-DUR-05)
  question_count   INTEGER     NOT NULL,
  status           TEXT        NOT NULL DEFAULT 'PENDING',
  started_at       TIMESTAMPTZ,
  deadline_at      TIMESTAMPTZ,
  ended_at         TIMESTAMPTZ,
  end_reason       TEXT,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT attempt_sections_position_key UNIQUE (attempt_id, position),
  CONSTRAINT attempt_sections_id_attempt_key UNIQUE (id, attempt_id),
  CONSTRAINT attempt_sections_status_check CHECK (status IN ('PENDING','ACTIVE','ENDED')),
  CONSTRAINT attempt_sections_duration_check CHECK (duration_seconds > 0),
  CONSTRAINT attempt_sections_end_reason_check
    CHECK (end_reason IS NULL OR end_reason IN ('MANUAL','TIMEOUT','ATTEMPT_SUBMITTED','VOIDED')),
  CONSTRAINT attempt_sections_active_check
    CHECK (status = 'PENDING' OR (started_at IS NOT NULL AND deadline_at IS NOT NULL)),
  CONSTRAINT attempt_sections_ended_check
    CHECK (status <> 'ENDED' OR (ended_at IS NOT NULL AND end_reason IS NOT NULL))
);

CREATE TABLE attempt_questions (
  id                  UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  attempt_id          UUID         NOT NULL,
  attempt_section_id  UUID         NOT NULL,
  exam_question_id    UUID         NOT NULL REFERENCES exam_questions(id),
  question_version_id UUID         NOT NULL REFERENCES question_versions(id),
  position            INTEGER      NOT NULL,            -- urutan dalam section
  weight              NUMERIC(6,2) NOT NULL,            -- snapshot
  created_at          TIMESTAMPTZ  NOT NULL DEFAULT now(),
  CONSTRAINT attempt_questions_section_fk
    FOREIGN KEY (attempt_section_id, attempt_id)
    REFERENCES attempt_sections (id, attempt_id),
  CONSTRAINT attempt_questions_version_key UNIQUE (attempt_id, question_version_id),
  CONSTRAINT attempt_questions_position_key UNIQUE (attempt_section_id, position),
  CONSTRAINT attempt_questions_id_attempt_key UNIQUE (id, attempt_id),
  CONSTRAINT attempt_questions_weight_check CHECK (weight > 0)
);

CREATE TABLE attempt_answers (
  id                  UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  attempt_id          UUID        NOT NULL,
  attempt_question_id UUID        NOT NULL,
  selected_option_id  UUID        REFERENCES question_options(id),  -- NULL = dikosongkan
  is_flagged          BOOLEAN     NOT NULL DEFAULT FALSE,
  client_seq          BIGINT      NOT NULL,             -- BR-SUB-05
  time_spent_ms       INTEGER     NOT NULL DEFAULT 0,   -- FR-ENG-14
  answered_at         TIMESTAMPTZ,
  saved_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT attempt_answers_question_fk
    FOREIGN KEY (attempt_question_id, attempt_id)
    REFERENCES attempt_questions (id, attempt_id),
  -- BR-SUB-05: tepat satu record jawaban per attempt-soal
  CONSTRAINT attempt_answers_one_per_question UNIQUE (attempt_question_id),
  CONSTRAINT attempt_answers_seq_check  CHECK (client_seq >= 0),
  CONSTRAINT attempt_answers_time_check CHECK (time_spent_ms >= 0)
);

CREATE TABLE exam_key_corrections (
  id               UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  exam_id          UUID        NOT NULL REFERENCES exams(id),
  exam_question_id UUID        NOT NULL REFERENCES exam_questions(id),
  from_version_id  UUID        NOT NULL REFERENCES question_versions(id),
  to_version_id    UUID        NOT NULL REFERENCES question_versions(id),
  reason           TEXT        NOT NULL,
  applied_by       UUID        NOT NULL REFERENCES users(id),
  applied_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  rescoring_status TEXT        NOT NULL DEFAULT 'PENDING',
  attempts_affected INTEGER,
  results_revised  INTEGER,
  completed_at     TIMESTAMPTZ,
  error_message    TEXT,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT exam_key_corrections_status_check
    CHECK (rescoring_status IN ('PENDING','RUNNING','COMPLETED','FAILED')),
  CONSTRAINT exam_key_corrections_versions_check CHECK (from_version_id <> to_version_id),
  CONSTRAINT exam_key_corrections_reason_check CHECK (length(btrim(reason)) > 0)
);

CREATE TABLE exam_results (
  id                 UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  attempt_id         UUID         NOT NULL REFERENCES exam_attempts(id),
  revision           INTEGER      NOT NULL DEFAULT 1,
  is_current         BOOLEAN      NOT NULL DEFAULT TRUE,
  user_id            UUID         NOT NULL REFERENCES users(id),        -- denormalisasi
  exam_id            UUID         NOT NULL REFERENCES exams(id),        -- denormalisasi
  session_id         UUID         REFERENCES exam_sessions(id),         -- denormalisasi
  total_score        NUMERIC(7,2) NOT NULL,             -- BR-SCR-04
  total_questions    INTEGER      NOT NULL,
  correct_count      INTEGER      NOT NULL,
  incorrect_count    INTEGER      NOT NULL,
  unanswered_count   INTEGER      NOT NULL,
  accuracy           NUMERIC(5,4) NOT NULL,             -- BR-SCR-05, 0..1
  completion_rate    NUMERIC(5,4) NOT NULL,             -- BR-SCR-05, 0..1
  duration_seconds   INTEGER      NOT NULL,
  publication_status TEXT         NOT NULL DEFAULT 'PENDING_PUBLICATION',
  published_at       TIMESTAMPTZ,
  revision_reason    TEXT,
  key_correction_id  UUID         REFERENCES exam_key_corrections(id),
  created_at         TIMESTAMPTZ  NOT NULL DEFAULT now(),
  CONSTRAINT exam_results_revision_key UNIQUE (attempt_id, revision),
  CONSTRAINT exam_results_revision_check CHECK (revision >= 1),
  CONSTRAINT exam_results_score_check CHECK (total_score BETWEEN 0 AND 1000),
  CONSTRAINT exam_results_counts_check
    CHECK (correct_count >= 0 AND incorrect_count >= 0 AND unanswered_count >= 0
           AND correct_count + incorrect_count + unanswered_count = total_questions),
  CONSTRAINT exam_results_ratio_check
    CHECK (accuracy BETWEEN 0 AND 1 AND completion_rate BETWEEN 0 AND 1),
  CONSTRAINT exam_results_publication_check
    CHECK (publication_status IN ('PENDING_PUBLICATION','PUBLISHED')),
  CONSTRAINT exam_results_published_check
    CHECK (publication_status <> 'PUBLISHED' OR published_at IS NOT NULL),
  CONSTRAINT exam_results_revision_reason_check
    CHECK (revision = 1 OR revision_reason IS NOT NULL)
);

-- BR-SCR-06: tepat satu revisi terkini per attempt
CREATE UNIQUE INDEX exam_results_one_current_idx
  ON exam_results (attempt_id) WHERE is_current;

CREATE TABLE result_section_scores (
  id                 UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  result_id          UUID         NOT NULL REFERENCES exam_results(id),
  attempt_section_id UUID         NOT NULL REFERENCES attempt_sections(id),
  section_name       TEXT         NOT NULL,
  position           INTEGER      NOT NULL,
  question_count     INTEGER      NOT NULL,
  correct_count      INTEGER      NOT NULL,
  incorrect_count    INTEGER      NOT NULL,
  unanswered_count   INTEGER      NOT NULL,
  raw_score          NUMERIC(8,2) NOT NULL,
  max_score          NUMERIC(8,2) NOT NULL,
  scaled_score       NUMERIC(7,2) NOT NULL,             -- BR-SCR-03
  created_at         TIMESTAMPTZ  NOT NULL DEFAULT now(),
  CONSTRAINT result_section_scores_unique UNIQUE (result_id, attempt_section_id),
  CONSTRAINT result_section_scores_counts_check
    CHECK (correct_count + incorrect_count + unanswered_count = question_count),
  CONSTRAINT result_section_scores_score_check
    CHECK (max_score > 0 AND raw_score BETWEEN 0 AND max_score
           AND scaled_score BETWEEN 0 AND 1000)
);

CREATE TABLE result_topic_scores (
  id               UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  result_id        UUID         NOT NULL REFERENCES exam_results(id),
  subject_id       UUID         NOT NULL REFERENCES subjects(id),
  topic_id         UUID         NOT NULL REFERENCES topics(id),
  question_count   INTEGER      NOT NULL,
  correct_count    INTEGER      NOT NULL,
  incorrect_count  INTEGER      NOT NULL,
  unanswered_count INTEGER      NOT NULL,
  accuracy         NUMERIC(5,4) NOT NULL,               -- benar / jumlah soal topik (FR-ANL-02)
  created_at       TIMESTAMPTZ  NOT NULL DEFAULT now(),
  CONSTRAINT result_topic_scores_unique UNIQUE (result_id, topic_id),
  CONSTRAINT result_topic_scores_counts_check
    CHECK (question_count > 0
           AND correct_count + incorrect_count + unanswered_count = question_count)
);

-- =====================================================================
-- 6. OPERATIONS
-- =====================================================================
CREATE TABLE audit_logs (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_id    UUID        REFERENCES users(id),         -- NULL = sistem
  actor_roles TEXT[]      NOT NULL DEFAULT '{}',
  action      TEXT        NOT NULL,                     -- mis. 'EXAM_PUBLISHED'
  entity_type TEXT        NOT NULL,
  entity_id   UUID,
  before_data JSONB,
  after_data  JSONB,
  reason      TEXT,
  request_id  TEXT,
  ip          INET,
  user_agent  TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE notifications (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         UUID        REFERENCES users(id),
  channel         TEXT        NOT NULL DEFAULT 'EMAIL',
  template        TEXT        NOT NULL,
  recipient       CITEXT      NOT NULL,
  dedupe_key      TEXT        NOT NULL,   -- mis. 'ORDER_PAID:<order_id>'
  payload         JSONB       NOT NULL DEFAULT '{}',
  status          TEXT        NOT NULL DEFAULT 'PENDING',
  attempt_count   INTEGER     NOT NULL DEFAULT 0,
  next_attempt_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  sent_at         TIMESTAMPTZ,
  last_error      TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT notifications_dedupe_key UNIQUE (dedupe_key),
  CONSTRAINT notifications_channel_check CHECK (channel IN ('EMAIL')),
  CONSTRAINT notifications_status_check
    CHECK (status IN ('PENDING','SENDING','SENT','FAILED'))
);
