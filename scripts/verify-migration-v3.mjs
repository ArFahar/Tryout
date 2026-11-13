// Menguji migrasi 0006 (v2.0 -> v3.0) pada database berisi data v2.0, di dalam transaksi yang di-rollback.
// Pemakaian: node scripts/verify-migration-v3.mjs   (database pengembangan harus berjalan dan berada di skema v2.0)
import pg from 'pg';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const c = new pg.Client({ connectionString: process.env.DATABASE_URL ?? 'postgres://postgres:postgres@127.0.0.1:54329/cogniverse' });
await c.connect();
const q = async (sql) => (await c.query(sql)).rows;
try {
  await c.query('BEGIN');
  const before = await q(`SELECT exam_type, count(*)::int n FROM exams GROUP BY 1 ORDER BY 1`);
  await c.query(fs.readFileSync(path.join(root, 'db/migrations/0006_v3_packages_roadmap.sql'), 'utf8'));
  const after = await q(`SELECT exam_type, count(*)::int n FROM exams GROUP BY 1`);
  const tables = await q(`SELECT count(*)::int n FROM information_schema.tables WHERE table_schema='public' AND table_type='BASE TABLE'`);
  const legacy = await q(`SELECT count(*)::int n FROM products WHERE status='ACTIVE' AND NOT is_package`);
  const ents = await q(`SELECT source, count(*)::int n FROM entitlements GROUP BY 1`);
  // constraint penting
  const expectFail = async (label, sql) => {
    await c.query('SAVEPOINT x');
    try { await c.query(sql); console.log('FAIL', label, '(tidak ditolak)'); process.exitCode = 1; }
    catch (e) { console.log('OK  ', label, '->', e.code); }
    await c.query('ROLLBACK TO SAVEPOINT x');
  };
  await expectFail('exam_type selain FULL_TRYOUT ditolak', `UPDATE exams SET exam_type='MINI_TRYOUT' WHERE id=(SELECT id FROM exams LIMIT 1)`);
  await expectFail('skor acuan tanpa sumber ditolak', `INSERT INTO universities(name) VALUES ('Uji'); INSERT INTO study_programs(university_id,name,reference_score) SELECT id,'Prodi',600 FROM universities WHERE name='Uji'`);
  await expectFail('target skor bukan kelipatan 10 ditolak', `INSERT INTO student_targets(user_id,priority,custom_university,custom_program,personal_target_score) SELECT id,1,'X','Y',655 FROM users LIMIT 1`);
  await expectFail('referral diri sendiri ditolak', `INSERT INTO referrals(referrer_id,referred_id,code_used) SELECT id,id,'ABCDEF' FROM users LIMIT 1`);
  console.log('exam_type sebelum', JSON.stringify(before), 'sesudah', JSON.stringify(after));
  console.log('tabel', tables[0].n, '| product non-paket ACTIVE', legacy[0].n, '| entitlement', JSON.stringify(ents));
} finally {
  await c.query('ROLLBACK');
  await c.end();
}
