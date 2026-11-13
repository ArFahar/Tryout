// Menguji migrasi db/proposed/0005_v2_realignment.sql pada salinan skema tonggak 1 yang berisi data contoh.
import fs from 'node:fs';
import path from 'node:path';
import pg from 'pg';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const admin = new pg.Client({ connectionString: 'postgres://postgres:postgres@127.0.0.1:54329/postgres' });
const name = `mig_check_${Date.now()}`;
await admin.connect();
await admin.query(`CREATE DATABASE ${name}`);
const c = new pg.Client({ connectionString: `postgres://postgres:postgres@127.0.0.1:54329/${name}` });
await c.connect();
let ok = true;
const step = async (label, fn) => {
  try { await fn(); console.log(`OK   ${label}`); } catch (e) { ok = false; console.log(`FAIL ${label}: ${e.message}`); }
};
for (const f of fs.readdirSync(path.join(root, 'db/migrations')).sort()) {
  if (ok) await step(`v1 ${f}`, () => c.query(fs.readFileSync(path.join(root, 'db/migrations', f), 'utf8')));
}
if (ok) await step('seed tonggak 1 (berisi attempt? tidak; exam DIAGNOSTIC + TRYOUT)', async () => {
  const { default: seed } = await import(pathToFileURL(path.join(root, 'db/seed/seed.mjs')).href);
  await c.query('BEGIN'); await seed(c); await c.query('COMMIT');
});
if (ok) await step('migrasi 0005_v2_realignment', async () => {
  await c.query('BEGIN');
  await c.query(fs.readFileSync(path.join(root, 'db/proposed/0005_v2_realignment.sql'), 'utf8'));
  await c.query('COMMIT');
});
if (ok) {
  const types = (await c.query('SELECT exam_type, count(*)::int AS n FROM exams GROUP BY 1 ORDER BY 1')).rows;
  console.log('exam_type setelah migrasi:', JSON.stringify(types));
  await step('constraint: FREE_TRYOUT scheduled ditolak', async () => {
    try {
      await c.query(`UPDATE exams SET delivery_mode = 'SCHEDULED' WHERE exam_type = 'FREE_TRYOUT'`);
      throw new Error('tidak ditolak');
    } catch (e) { if (!String(e.message).includes('exams_free_mode_check')) throw e; }
  });
  await step('constraint: INFERENCE tanpa pengamatan ditolak', async () => {
    try {
      await c.query(`INSERT INTO performance_insights (analysis_id, user_id, dimension, kind, rule_code, scope_type, min_report_tier, message_key, evidence)
        VALUES (gen_random_uuid(), gen_random_uuid(), 'BEHAVIOR', 'INFERENCE', 'INF-BEH-01', 'ATTEMPT', 'COMPLETE', 'x', '{}')`);
      throw new Error('tidak ditolak');
    } catch (e) { if (!String(e.message).includes('performance_insights_inference_check')) throw e; }
  });
  const s = (await c.query('SELECT count(*)::int AS n FROM system_settings')).rows[0].n;
  console.log(`system_settings: ${s} baris`);
}
await c.end();
await admin.query(`DROP DATABASE ${name}`);
await admin.end();
process.exit(ok ? 0 : 1);
