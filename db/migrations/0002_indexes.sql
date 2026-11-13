-- Sumber: TDD 3.6
-- Identity
CREATE INDEX user_roles_role_idx          ON user_roles (role_id);
CREATE INDEX users_status_idx             ON users (status) WHERE status <> 'ACTIVE';
CREATE INDEX users_name_trgm_idx          ON users USING gin (full_name gin_trgm_ops);
CREATE INDEX auth_sessions_user_idx       ON auth_sessions (user_id) WHERE revoked_at IS NULL;
CREATE INDEX auth_sessions_family_idx     ON auth_sessions (family_id);
CREATE INDEX auth_tokens_user_purpose_idx ON auth_tokens (user_id, purpose) WHERE used_at IS NULL;

-- Question bank
CREATE INDEX topics_subject_idx              ON topics (subject_id);
CREATE INDEX questions_author_idx            ON questions (author_id);
CREATE INDEX question_versions_question_idx  ON question_versions (question_id, version_number DESC);
CREATE INDEX question_versions_review_queue_idx
  ON question_versions (submitted_at) WHERE status = 'IN_REVIEW';
CREATE INDEX question_versions_filter_idx
  ON question_versions (status, subject_id, topic_id, difficulty);
CREATE INDEX question_versions_author_idx    ON question_versions (author_id, status);
CREATE INDEX question_versions_stem_trgm_idx
  ON question_versions USING gin (stem_plain gin_trgm_ops);
CREATE INDEX question_reviews_version_idx    ON question_reviews (question_version_id, created_at);
CREATE INDEX question_reviews_reviewer_idx   ON question_reviews (reviewer_id);

-- Examination
CREATE INDEX exams_catalog_idx
  ON exams (available_from, available_until) WHERE status = 'PUBLISHED';
CREATE INDEX exam_questions_section_idx      ON exam_questions (exam_section_id, position);
CREATE INDEX exam_questions_version_idx      ON exam_questions (question_version_id);
CREATE INDEX exam_sessions_exam_idx          ON exam_sessions (exam_id, start_at);
CREATE INDEX exam_sessions_publish_due_idx
  ON exam_sessions (result_publish_at)
  WHERE result_publish_mode = 'AT_TIME' AND results_published_at IS NULL AND status = 'PUBLISHED';
CREATE INDEX exam_sessions_no_show_due_idx
  ON exam_sessions (entry_close_at)
  WHERE no_show_processed_at IS NULL AND status = 'PUBLISHED';
CREATE INDEX exam_enrollments_session_idx    ON exam_enrollments (session_id, status);
CREATE INDEX exam_enrollments_user_idx       ON exam_enrollments (user_id, created_at DESC);
CREATE INDEX exam_enrollments_order_idx      ON exam_enrollments (order_id) WHERE order_id IS NOT NULL;
CREATE INDEX exam_enrollments_entitlement_idx
  ON exam_enrollments (entitlement_id) WHERE entitlement_id IS NOT NULL;

-- Commerce
CREATE INDEX product_exams_exam_idx          ON product_exams (exam_id);
CREATE INDEX products_active_idx             ON products (product_type) WHERE status = 'ACTIVE';
CREATE INDEX orders_user_idx                 ON orders (user_id, created_at DESC);
CREATE INDEX orders_status_created_idx       ON orders (status, created_at DESC);
CREATE INDEX orders_expiry_due_idx           ON orders (expires_at) WHERE status = 'PENDING';
CREATE INDEX order_items_product_idx         ON order_items (product_id);
CREATE INDEX order_item_exams_exam_idx       ON order_item_exams (exam_id);
CREATE INDEX payments_order_idx              ON payments (order_id, created_at DESC);
CREATE INDEX payment_webhook_events_dedupe_idx ON payment_webhook_events (dedupe_key);
CREATE INDEX payment_webhook_events_order_idx
  ON payment_webhook_events (provider_order_id, received_at);
CREATE INDEX entitlements_user_idx           ON entitlements (user_id, exam_id);
CREATE INDEX entitlements_exam_idx           ON entitlements (exam_id) WHERE status = 'ACTIVE';

-- Execution
CREATE INDEX exam_attempts_user_idx          ON exam_attempts (user_id, started_at DESC);
CREATE INDEX exam_attempts_exam_idx          ON exam_attempts (exam_id, status);
CREATE INDEX exam_attempts_session_idx       ON exam_attempts (session_id) WHERE session_id IS NOT NULL;
CREATE INDEX exam_attempts_timeout_due_idx   ON exam_attempts (expires_at) WHERE status = 'IN_PROGRESS';
CREATE INDEX exam_attempts_scoring_due_idx   ON exam_attempts (submitted_at) WHERE status = 'SUBMITTED';
CREATE INDEX attempt_questions_exam_question_idx ON attempt_questions (exam_question_id);
CREATE INDEX attempt_answers_attempt_idx     ON attempt_answers (attempt_id);
CREATE INDEX exam_results_user_idx           ON exam_results (user_id, created_at DESC) WHERE is_current;
CREATE INDEX exam_results_exam_idx           ON exam_results (exam_id, publication_status) WHERE is_current;
CREATE INDEX exam_results_session_idx
  ON exam_results (session_id, total_score DESC) WHERE is_current AND session_id IS NOT NULL;
CREATE INDEX result_topic_scores_topic_idx   ON result_topic_scores (topic_id);
CREATE INDEX exam_key_corrections_exam_idx   ON exam_key_corrections (exam_id, applied_at DESC);

-- Operations
CREATE INDEX audit_logs_entity_idx           ON audit_logs (entity_type, entity_id, created_at DESC);
CREATE INDEX audit_logs_actor_idx            ON audit_logs (actor_id, created_at DESC);
CREATE INDEX audit_logs_action_idx           ON audit_logs (action, created_at DESC);
CREATE INDEX notifications_dispatch_idx      ON notifications (next_attempt_at) WHERE status = 'PENDING';
CREATE INDEX notifications_user_idx          ON notifications (user_id, created_at DESC);
