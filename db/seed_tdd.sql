-- Sumber: TDD 3.8
-- Roles (wajib di semua lingkungan; bagian dari migrasi, bukan seed opsional)
INSERT INTO roles (id, code, name) VALUES
  ('00000000-0000-7000-8000-000000000001', 'STUDENT',        'Student'),
  ('00000000-0000-7000-8000-000000000002', 'CONTRIBUTOR',    'Tutor / Contributor'),
  ('00000000-0000-7000-8000-000000000003', 'CONTENT_EDITOR', 'Content Editor'),
  ('00000000-0000-7000-8000-000000000004', 'EXAM_ADMIN',     'Exam Admin'),
  ('00000000-0000-7000-8000-000000000005', 'SUPER_ADMIN',    'Super Admin')
ON CONFLICT (code) DO NOTHING;

-- Subjects (contoh)
INSERT INTO subjects (id, code, name, position) VALUES
  ('10000000-0000-7000-8000-000000000001', 'PU',  'Penalaran Umum', 1),
  ('10000000-0000-7000-8000-000000000002', 'PPU', 'Pengetahuan dan Pemahaman Umum', 2),
  ('10000000-0000-7000-8000-000000000003', 'PBM', 'Pemahaman Bacaan dan Menulis', 3),
  ('10000000-0000-7000-8000-000000000004', 'PK',  'Pengetahuan Kuantitatif', 4),
  ('10000000-0000-7000-8000-000000000005', 'LBI', 'Literasi dalam Bahasa Indonesia', 5),
  ('10000000-0000-7000-8000-000000000006', 'LBE', 'Literasi dalam Bahasa Inggris', 6),
  ('10000000-0000-7000-8000-000000000007', 'PM',  'Penalaran Matematika', 7);

-- Topics (contoh sebagian)
INSERT INTO topics (id, subject_id, code, name) VALUES
  ('11000000-0000-7000-8000-000000000001', '10000000-0000-7000-8000-000000000001', 'PU-IND', 'Penalaran Induktif'),
  ('11000000-0000-7000-8000-000000000002', '10000000-0000-7000-8000-000000000001', 'PU-DED', 'Penalaran Deduktif'),
  ('11000000-0000-7000-8000-000000000003', '10000000-0000-7000-8000-000000000004', 'PK-ALJ', 'Aljabar'),
  ('11000000-0000-7000-8000-000000000004', '10000000-0000-7000-8000-000000000004', 'PK-GEO', 'Geometri');

-- Pengguna contoh (hanya dev; hash di bawah adalah placeholder, bukan hash valid)
INSERT INTO users (id, email, password_hash, full_name, status, email_verified_at) VALUES
  ('20000000-0000-7000-8000-000000000001', 'editor@example.test',  '<argon2id-hash>', 'Laras Editor',  'ACTIVE', now()),
  ('20000000-0000-7000-8000-000000000002', 'tutor@example.test',   '<argon2id-hash>', 'Sinta Tutor',   'ACTIVE', now()),
  ('20000000-0000-7000-8000-000000000003', 'admin@example.test',   '<argon2id-hash>', 'Dimas Admin',   'ACTIVE', now()),
  ('20000000-0000-7000-8000-000000000004', 'student@example.test', '<argon2id-hash>', 'Nadia Student', 'ACTIVE', now());

INSERT INTO user_roles (user_id, role_id) VALUES
  ('20000000-0000-7000-8000-000000000001', '00000000-0000-7000-8000-000000000003'),
  ('20000000-0000-7000-8000-000000000002', '00000000-0000-7000-8000-000000000002'),
  ('20000000-0000-7000-8000-000000000003', '00000000-0000-7000-8000-000000000004'),
  ('20000000-0000-7000-8000-000000000004', '00000000-0000-7000-8000-000000000001');

INSERT INTO student_profiles (user_id, student_status, school_name, graduation_year, province, onboarding_completed_at)
VALUES ('20000000-0000-7000-8000-000000000004', 'GRADE_12', 'SMA Negeri 1 Contoh', 2027, 'Jawa Barat', now());

-- Satu soal: dibuat tutor (DRAFT) → opsi → diajukan → disetujui editor
INSERT INTO questions (id, author_id) VALUES
  ('30000000-0000-7000-8000-000000000001', '20000000-0000-7000-8000-000000000002');

INSERT INTO question_versions
  (id, question_id, version_number, status, author_id, subject_id, topic_id,
   difficulty, cognitive_level, stem_html, stem_plain, explanation_html)
VALUES
  ('31000000-0000-7000-8000-000000000001', '30000000-0000-7000-8000-000000000001', 1, 'DRAFT',
   '20000000-0000-7000-8000-000000000002',
   '10000000-0000-7000-8000-000000000004', '11000000-0000-7000-8000-000000000003',
   'EASY', 'APPLY',
   '<p>Jika \(2x + 3 = 11\), nilai \(x\) adalah …</p>',
   'Jika 2x + 3 = 11, nilai x adalah …',
   '<p>\(2x = 8\) sehingga \(x = 4\).</p>');

INSERT INTO question_options (question_version_id, option_key, content_html, is_correct) VALUES
  ('31000000-0000-7000-8000-000000000001', 'A', '<p>2</p>', FALSE),
  ('31000000-0000-7000-8000-000000000001', 'B', '<p>3</p>', FALSE),
  ('31000000-0000-7000-8000-000000000001', 'C', '<p>4</p>', TRUE),
  ('31000000-0000-7000-8000-000000000001', 'D', '<p>5</p>', FALSE),
  ('31000000-0000-7000-8000-000000000001', 'E', '<p>7</p>', FALSE);

UPDATE question_versions SET status = 'IN_REVIEW', submitted_at = now()
 WHERE id = '31000000-0000-7000-8000-000000000001';

INSERT INTO question_reviews (question_version_id, reviewer_id, decision)
VALUES ('31000000-0000-7000-8000-000000000001', '20000000-0000-7000-8000-000000000001', 'APPROVED');

UPDATE question_versions
   SET status = 'APPROVED', decided_at = now(),
       decided_by = '20000000-0000-7000-8000-000000000001'
 WHERE id = '31000000-0000-7000-8000-000000000001';

-- Exam diagnostic gratis dengan satu section dan satu soal
INSERT INTO exams (id, slug, title, exam_type, delivery_mode, timing_mode, status,
                   duration_minutes, max_attempts, created_by)
VALUES ('40000000-0000-7000-8000-000000000001', 'diagnostic-snbt-contoh',
        'Diagnostic Test SNBT (Contoh)', 'DIAGNOSTIC', 'ON_DEMAND', 'TOTAL', 'DRAFT',
        30, 1, '20000000-0000-7000-8000-000000000003');

INSERT INTO exam_sections (id, exam_id, name, position) VALUES
  ('41000000-0000-7000-8000-000000000001', '40000000-0000-7000-8000-000000000001',
   'Pengetahuan Kuantitatif', 1);

INSERT INTO exam_questions (exam_id, exam_section_id, question_id, question_version_id, position)
VALUES ('40000000-0000-7000-8000-000000000001', '41000000-0000-7000-8000-000000000001',
        '30000000-0000-7000-8000-000000000001', '31000000-0000-7000-8000-000000000001', 1);

INSERT INTO products (id, slug, product_type, name, price_amount, status, created_by)
VALUES ('50000000-0000-7000-8000-000000000001', 'diagnostic-snbt-contoh', 'SINGLE',
        'Diagnostic Test SNBT (Contoh)', 0, 'ACTIVE', '20000000-0000-7000-8000-000000000003');

INSERT INTO product_exams (product_id, exam_id)
VALUES ('50000000-0000-7000-8000-000000000001', '40000000-0000-7000-8000-000000000001');

UPDATE exams
   SET status = 'PUBLISHED', published_at = now(),
       published_by = '20000000-0000-7000-8000-000000000003',
       available_from = now(), available_until = now() + INTERVAL '180 days'
 WHERE id = '40000000-0000-7000-8000-000000000001';
