// Kontrak bersama API <-> web (TDD 1.4: "Zod schema di paket contracts").
import { z } from 'zod';

export const TERMS_VERSION = '2026-11';
export const PRIVACY_VERSION = '2026-11';

export const ROLES = ['STUDENT', 'CONTRIBUTOR', 'CONTENT_EDITOR', 'EXAM_ADMIN', 'SUPER_ADMIN'] as const;
export type Role = (typeof ROLES)[number];

/** Katalog kode error (TDD 4.1). */
export type ErrorCode =
  | 'VALIDATION_FAILED' | 'MALFORMED_REQUEST' | 'UNAUTHENTICATED' | 'SESSION_EXPIRED' | 'INVALID_CREDENTIALS'
  | 'FORBIDDEN' | 'EMAIL_NOT_VERIFIED' | 'PROFILE_INCOMPLETE' | 'CONSENT_REQUIRED' | 'ACCOUNT_SUSPENDED'
  | 'SELF_REVIEW_FORBIDDEN' | 'NOT_FOUND' | 'TOKEN_EXPIRED_OR_USED' | 'PUBLISH_VALIDATION_FAILED'
  | 'SUBMISSION_INCOMPLETE' | 'ATTEMPT_SESSION_TAKEN_OVER' | 'RATE_LIMITED' | 'INTERNAL_ERROR'
  | 'EXAM_NOT_AVAILABLE' | 'NO_ENTITLEMENT' | 'ENTITLEMENT_EXPIRED' | 'ATTEMPT_LIMIT_REACHED'
  | 'ANOTHER_ATTEMPT_IN_PROGRESS' | 'ALREADY_ENTITLED' | 'NOT_ENROLLED' | 'SESSION_NOT_STARTED'
  | 'ENTRY_WINDOW_CLOSED' | 'SESSION_CANCELLED' | 'ATTEMPT_NOT_IN_PROGRESS' | 'ATTEMPT_EXPIRED'
  | 'SECTION_NOT_ACTIVE' | 'QUESTION_NOT_IN_ATTEMPT' | 'INVALID_OPTION' | 'RESULT_NOT_PUBLISHED'
  | 'REVIEW_NOT_AVAILABLE_YET' | 'RESULT_PROCESSING' | 'ATTEMPT_VOIDED' | 'PRODUCT_NOT_PURCHASABLE'
  | 'EMAIL_ALREADY_REGISTERED' | 'VERSION_NOT_EDITABLE' | 'VERSION_STATUS_CHANGED' | 'OPEN_VERSION_EXISTS'
  | 'QUESTION_RETIRED' | 'EXAM_STRUCTURE_LOCKED'
  | 'PUBLISH_WARNINGS_UNCONFIRMED' | 'SERIES_LOCKED' | 'SERIES_TYPE_MISMATCH'
  | 'NO_ACCESS' | 'CREDIT_CONFIRMATION_REQUIRED' | 'SEASON_PASS_EXISTS' | 'VOUCHER_NOT_AVAILABLE'
  | 'REFERENCE_SOURCE_REQUIRED' | 'TARGET_REQUIRED' | 'NO_ACTIVE_SEASON';

export interface ApiErrorBody {
  error: { code: ErrorCode; message: string; details?: { field?: string; issue?: string; message: string }[]; requestId?: string };
}

export const ATTEMPT_SESSION_HEADER = 'x-attempt-session';
export const CLIENT_HEADER = 'x-cv-client';

// ---------- Auth ----------
export const passwordSchema = z.string().min(8, 'Kata sandi minimal 8 karakter.').max(128);
export const registerSchema = z.object({
  fullName: z.string().trim().min(1, 'Nama wajib diisi.').max(120),
  email: z.string().trim().toLowerCase().email('Format email tidak valid.'),
  password: passwordSchema,
  acceptedTermsVersion: z.literal(TERMS_VERSION, { errorMap: () => ({ message: 'Kamu perlu menyetujui Syarat & Ketentuan terbaru.' }) }),
  acceptedPrivacyVersion: z.literal(PRIVACY_VERSION, { errorMap: () => ({ message: 'Kamu perlu menyetujui Kebijakan Privasi terbaru.' }) }),
  referralCode: z.string().trim().toUpperCase().max(20).optional().or(z.literal('')),
});
export type RegisterInput = z.infer<typeof registerSchema>;
export const loginSchema = z.object({ email: z.string().trim().toLowerCase().email('Format email tidak valid.'), password: z.string().min(1, 'Kata sandi wajib diisi.') });
export const tokenSchema = z.object({ token: z.string().min(10) });
export const forgotSchema = z.object({ email: z.string().trim().toLowerCase().email('Format email tidak valid.') });
export const resetSchema = z.object({ token: z.string().min(10), newPassword: passwordSchema });

export const PROVINCES = [
  'Aceh', 'Sumatera Utara', 'Sumatera Barat', 'Riau', 'Kepulauan Riau', 'Jambi', 'Sumatera Selatan', 'Kepulauan Bangka Belitung',
  'Bengkulu', 'Lampung', 'DKI Jakarta', 'Banten', 'Jawa Barat', 'Jawa Tengah', 'DI Yogyakarta', 'Jawa Timur', 'Bali',
  'Nusa Tenggara Barat', 'Nusa Tenggara Timur', 'Kalimantan Barat', 'Kalimantan Tengah', 'Kalimantan Selatan', 'Kalimantan Timur',
  'Kalimantan Utara', 'Sulawesi Utara', 'Gorontalo', 'Sulawesi Tengah', 'Sulawesi Barat', 'Sulawesi Selatan', 'Sulawesi Tenggara',
  'Maluku', 'Maluku Utara', 'Papua', 'Papua Barat', 'Papua Barat Daya', 'Papua Tengah', 'Papua Pegunungan', 'Papua Selatan',
] as const;

export const studentProfileSchema = z.object({
  studentStatus: z.enum(['GRADE_12', 'GAP_YEAR'], { errorMap: () => ({ message: 'Pilih status kamu.' }) }),
  schoolName: z.string().trim().min(2, 'Nama sekolah wajib diisi.').max(160),
  graduationYear: z.coerce.number().int().min(2000).max(2100),
  province: z.enum(PROVINCES, { errorMap: () => ({ message: 'Pilih provinsi.' }) }),
  phone: z.string().trim().max(20).optional().or(z.literal('')),
});

export interface MeUser {
  id: string; email: string; fullName: string; roles: Role[]; emailVerified: boolean; profileComplete: boolean;
  /** v3.0: minimal satu target kampus & jurusan (FR-TGT-01). */
  hasTarget: boolean;
}

// ---------- Engine ----------
export const startAttemptSchema = z.object({ examId: z.string().uuid() });
export const saveAnswerSchema = z.object({
  clientSeq: z.number().int().min(0),
  selectedOptionId: z.string().uuid().nullable(),
  isFlagged: z.boolean(),
  timeSpentMs: z.number().int().min(0).max(24 * 3600 * 1000),
});
export type SaveAnswerInput = z.infer<typeof saveAnswerSchema>;
export const batchAnswerSchema = z.object({
  items: z.array(saveAnswerSchema.extend({ questionId: z.string().uuid() })).min(1).max(200),
});

export type SectionStatus = 'PENDING' | 'ACTIVE' | 'ENDED';
export interface AttemptSectionDto {
  id: string; name: string; position: number; status: SectionStatus; durationSeconds: number;
  questionCount: number; startedAt: string | null; deadlineAt: string | null;
}
export interface AttemptQuestionDto {
  id: string; sectionId: string; position: number; number: number; stemHtml: string;
  options: { id: string; key: string; contentHtml: string }[];
}
export interface AttemptAnswerDto { questionId: string; selectedOptionId: string | null; isFlagged: boolean; clientSeq: number }
export interface AttemptStateDto {
  attempt: { id: string; examId: string; examTitle: string; status: string; timingMode: 'TOTAL' | 'PER_SECTION'; expiresAt: string; totalQuestions: number };
  sections: AttemptSectionDto[]; questions: AttemptQuestionDto[]; answers: AttemptAnswerDto[]; serverTime: string;
}

// ---------- Konten ----------
export const DIFFICULTIES = ['EASY', 'MEDIUM', 'HARD'] as const;
export const COGNITIVE_LEVELS = ['REMEMBER', 'UNDERSTAND', 'APPLY', 'ANALYZE', 'EVALUATE', 'CREATE'] as const;
export const OPTION_KEYS = ['A', 'B', 'C', 'D', 'E'] as const;

export const versionContentSchema = z.object({
  subjectId: z.string().uuid().nullable().optional(),
  topicId: z.string().uuid().nullable().optional(),
  difficulty: z.enum(DIFFICULTIES).nullable().optional(),
  cognitiveLevel: z.enum(COGNITIVE_LEVELS).nullable().optional(),
  stemHtml: z.string().max(50000).default(''),
  explanationHtml: z.string().max(50000).default(''),
  options: z.array(z.object({
    key: z.enum(OPTION_KEYS), contentHtml: z.string().max(10000), isCorrect: z.boolean(),
  })).max(5).default([]),
});
export type VersionContentInput = z.infer<typeof versionContentSchema>;

export const reviewDecisionSchema = z.object({
  decision: z.enum(['APPROVED', 'CHANGES_REQUESTED', 'REJECTED']),
  notes: z.string().trim().max(4000).optional(),
  expectedStatus: z.literal('IN_REVIEW'),
});

// ---------- v3.0: satu tipe exam (PRD 2.11) ----------
export const EXAM_TYPES = ['FULL_TRYOUT'] as const;
export type ExamType = (typeof EXAM_TYPES)[number];
export type ReportTier = 'COMPLETE';
export const EXAM_TYPE_LABEL: Record<ExamType, string> = { FULL_TRYOUT: 'Full Try Out' };
export const PACKAGE_TYPES = ['SINGLE', 'BUNDLE', 'LIFETIME'] as const;
export type PackageType = (typeof PACKAGE_TYPES)[number];
export const PACKAGE_LABEL: Record<PackageType, string> = { SINGLE: 'Try Out Umum', BUNDLE: 'Bundle', LIFETIME: 'Lifetime' };

export const createExamSchema = z.object({
  title: z.string().trim().min(3).max(160),
  description: z.string().trim().max(2000).default(''),
  examType: z.enum(EXAM_TYPES).default('FULL_TRYOUT'),
  deliveryMode: z.literal('ON_DEMAND'),
  seriesId: z.string().uuid().nullable().optional(),
  timingMode: z.enum(['TOTAL', 'PER_SECTION']),
});
export const updateExamSchema = z.object({
  title: z.string().trim().min(3).max(160).optional(),
  description: z.string().trim().max(2000).optional(),
  instructionsHtml: z.string().max(20000).optional(),
  durationMinutes: z.number().int().min(1).max(600).nullable().optional(),
  availableFrom: z.string().datetime().nullable().optional(),
  availableUntil: z.string().datetime().nullable().optional(),
  maxAttempts: z.number().int().min(1).max(5).optional(),
  accessDurationDays: z.number().int().min(1).max(3650).nullable().optional(),
  seriesId: z.string().uuid().nullable().optional(),
});
export const createSeriesSchema = z.object({
  code: z.string().trim().regex(/^[A-Z0-9-]{2,40}$/, 'Kode hanya huruf kapital, angka, dan tanda hubung.'),
  name: z.string().trim().min(3).max(120),
  description: z.string().trim().max(2000).default(''),
  examType: z.enum(EXAM_TYPES).default('FULL_TRYOUT'),
  examDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Format tanggal YYYY-MM-DD.').nullable().optional(),
});
export const publishSchema = z.object({ dryRun: z.boolean().optional(), confirmWarnings: z.boolean().optional() });
export const sectionsSchema = z.object({
  sections: z.array(z.object({
    id: z.string().uuid().optional(), name: z.string().trim().min(1).max(120),
    durationMinutes: z.number().int().min(1).max(600).nullable().optional(),
    instructionsHtml: z.string().max(10000).optional(),
  })).min(1).max(20),
});
export const sectionQuestionsSchema = z.object({
  items: z.array(z.object({ questionVersionId: z.string().uuid(), weight: z.number().positive().max(100).optional() })).max(300),
});
export const pricingSchema = z.object({ priceAmount: z.number().int().min(0) });

export const SCORE_DISCLAIMER =
  'Skor ini adalah estimasi internal Cogniverse, tidak memakai metode penilaian resmi SNBT, dan bukan prediksi kelulusan.';

// ---------- v3.0: paket, referral, target, roadmap (TDD 4.22) ----------
export const createOrderSchema = z.object({ productId: z.string().uuid(), voucherId: z.string().uuid().nullable().optional() });
export const redeemSchema = z.object({ useCredit: z.boolean().optional() });
export const devPaySchema = z.object({ outcome: z.enum(['SETTLED', 'FAILED']) });
export const packageSchema = z.object({
  seriesId: z.string().uuid(), type: z.enum(PACKAGE_TYPES), name: z.string().trim().min(2).max(80),
  priceAmount: z.number().int().positive(), tryoutCredits: z.number().int().min(1).max(20).nullable().optional(),
});
export const packagePatchSchema = z.object({
  name: z.string().trim().min(2).max(80).optional(), priceAmount: z.number().int().positive().optional(),
  status: z.enum(['ACTIVE', 'INACTIVE']).optional(),
});
export const targetItemSchema = z.object({
  priority: z.union([z.literal(1), z.literal(2)]),
  studyProgramId: z.string().uuid().nullable().optional(),
  customUniversity: z.string().trim().min(2).max(160).nullable().optional(),
  customProgram: z.string().trim().min(2).max(160).nullable().optional(),
  personalTargetScore: z.number().int().min(0).max(1000).refine((n) => n % 10 === 0, 'Gunakan kelipatan 10, misalnya 650.').nullable().optional(),
}).refine((t) => !!t.studyProgramId || (!!t.customUniversity && !!t.customProgram), { message: 'Pilih program studi atau isi kampus dan jurusan.' });
export const targetsSchema = z.object({ targets: z.array(targetItemSchema).min(1).max(2) })
  .refine((x) => x.targets.some((t) => t.priority === 1), { message: 'Target pertama wajib diisi.' })
  .refine((x) => new Set(x.targets.map((t) => t.priority)).size === x.targets.length, { message: 'Prioritas target tidak boleh sama.' });
export const studyPrefsSchema = z.object({ dailyMinutes: z.union([z.literal(30), z.literal(60), z.literal(90), z.literal(120)]) });
export const planItemSchema = z.object({ done: z.boolean() });
export const guideSchema = z.object({ summary: z.string().trim().min(10).max(2000), keyPoints: z.array(z.string().trim().min(2).max(300)).max(12) });
export const universitySchema = z.object({ name: z.string().trim().min(3).max(160), shortName: z.string().trim().max(20).optional(), province: z.string().trim().max(80).optional() });
export const referenceSchema = z.object({ score: z.number().positive().max(100000), source: z.string().trim().min(3).max(300), year: z.number().int().min(2000).max(2100) });
export const studyProgramSchema = z.object({ universityId: z.string().uuid(), name: z.string().trim().min(2).max(160), reference: referenceSchema.nullable().optional() });
export const studyProgramPatchSchema = z.object({ name: z.string().trim().min(2).max(160).optional(), reference: referenceSchema.nullable().optional() });
