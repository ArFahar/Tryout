// Mengeksekusi seluruh blok SQL TDD Bagian 3.5–3.8 (dan opsional 3.10) pada database baru.
// Pemakaian: node scripts/verify-tdd-ddl.mjs "<path TDD.md>" [--with-migration]
import fs from 'node:fs';
import pg from 'pg';

const file = process.argv[2];
const withMigration = process.argv.includes('--with-migration');
const md = fs.readFileSync(file, 'utf8');
const section = (start, end) => md.slice(md.indexOf(start), md.indexOf(end, md.indexOf(start)));
const blocks = (s) => [...s.matchAll(/```sql\n([\s\S]*?)```/g)].map((m) => m[1]);
const parts = [
  ['3.5 DDL', blocks(section('### 3.5 PostgreSQL SQL DDL', '### 3.6'))],
  ['3.6 Index', blocks(section('### 3.6 Index Definitions', '### 3.7'))],
  ['3.7 Trigger', blocks(section('### 3.7 Trigger', '### 3.8'))],
  ['3.8 Seed', blocks(section('### 3.8 Seed Data Examples', '### 3.9'))],
];
const admin = 'postgres://postgres:postgres@127.0.0.1:54329/postgres';
const db = `tdd_check_${Date.now()}`;
const a = new pg.Client({ connectionString: admin });
await a.connect();
await a.query(`CREATE DATABASE ${db}`);
const c = new pg.Client({ connectionString: `postgres://postgres:postgres@127.0.0.1:54329/${db}` });
await c.connect();
let ok = true;
for (const [name, sqls] of parts) {
  for (const [i, sql] of sqls.entries()) {
    try {
      await c.query(sql);
      console.log(`OK   ${name} blok ${i + 1}`);
    } catch (e) {
      ok = false;
      console.log(`FAIL ${name} blok ${i + 1}: ${e.message}`);
      break;
    }
  }
  if (!ok) break;
}
if (ok) {
  const t = await c.query(`SELECT count(*)::int AS n FROM information_schema.tables WHERE table_schema = 'public'`);
  const tr = await c.query(`SELECT count(*)::int AS n FROM pg_trigger WHERE NOT tgisinternal`);
  console.log(`Tabel: ${t.rows[0].n}, trigger: ${tr.rows[0].n}`);
}
await c.end();
await a.query(`DROP DATABASE ${db}`);
await a.end();
process.exit(ok ? 0 : 1);
