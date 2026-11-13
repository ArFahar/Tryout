// Pengelola database lokal untuk pengembangan.
// Memakai PostgreSQL 16 embedded (npm: embedded-postgres) karena Docker tidak tersedia
// di mesin pengembang. Produksi memakai PostgreSQL terkelola (TDD 9.2).
//
//   node scripts/db.mjs start    menjalankan server (proses tetap hidup)
//   node scripts/db.mjs migrate  menerapkan db/migrations/*.sql yang belum diterapkan
//   node scripts/db.mjs seed     mengisi data contoh (db/seed/*.sql)
//   node scripts/db.mjs reset    menghapus dan membuat ulang database, lalu migrate + seed
import EmbeddedPostgres from 'embedded-postgres';
import pg from 'pg';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = Number(process.env.PGPORT ?? 54329);
const DB = process.env.PGDATABASE ?? 'cogniverse';
const USER = 'postgres';
const PASSWORD = 'postgres';
const dataDir = path.join(root, '.data', 'pg');

const adminUrl = `postgres://${USER}:${PASSWORD}@127.0.0.1:${PORT}/postgres`;
const dbUrl = `postgres://${USER}:${PASSWORD}@127.0.0.1:${PORT}/${DB}`;

async function startServer() {
  const server = new EmbeddedPostgres({
    databaseDir: dataDir,
    user: USER,
    password: PASSWORD,
    port: PORT,
    persistent: true,
    onLog: () => {},
    initdbFlags: ['--encoding=UTF8', '--locale=C'],
  });
  if (!fs.existsSync(path.join(dataDir, 'PG_VERSION'))) {
    console.log('[db] initdb', dataDir);
    await server.initialise();
  }
  await server.start();
  const c = new pg.Client({ connectionString: adminUrl });
  await c.connect();
  const r = await c.query('SELECT 1 FROM pg_database WHERE datname = $1', [DB]);
  if (r.rowCount === 0) await c.query(`CREATE DATABASE ${DB}`);
  await c.query("ALTER DATABASE " + DB + " SET timezone TO 'UTC'");
  await c.end();
  console.log(`[db] PostgreSQL berjalan di ${dbUrl}`);
  return server;
}

async function migrate() {
  const c = new pg.Client({ connectionString: dbUrl });
  await c.connect();
  await c.query(`CREATE TABLE IF NOT EXISTS schema_migrations (
    name TEXT PRIMARY KEY, applied_at TIMESTAMPTZ NOT NULL DEFAULT now())`);
  const done = new Set((await c.query('SELECT name FROM schema_migrations')).rows.map((r) => r.name));
  const files = fs.readdirSync(path.join(root, 'db', 'migrations')).filter((f) => f.endsWith('.sql')).sort();
  for (const f of files) {
    if (done.has(f)) continue;
    const sql = fs.readFileSync(path.join(root, 'db', 'migrations', f), 'utf8');
    process.stdout.write(`[db] migrate ${f} ... `);
    try {
      await c.query('BEGIN');
      await c.query(sql);
      await c.query('INSERT INTO schema_migrations (name) VALUES ($1)', [f]);
      await c.query('COMMIT');
      console.log('ok');
    } catch (e) {
      await c.query('ROLLBACK');
      console.log('GAGAL');
      console.error(e.message, e.position ? `(posisi ${e.position})` : '');
      process.exitCode = 1;
      break;
    }
  }
  await c.end();
}

async function seed() {
  const c = new pg.Client({ connectionString: dbUrl });
  await c.connect();
  const { default: run } = await import(pathToFileURL(path.join(root, 'db', 'seed', 'seed.mjs')).href);
  process.stdout.write('[db] seed ... ');
  try {
    await c.query('BEGIN');
    await run(c);
    await c.query('COMMIT');
    console.log('ok');
  } catch (e) {
    await c.query('ROLLBACK');
    console.log('GAGAL');
    console.error(e.message, e.detail ?? '');
    process.exitCode = 1;
  }
  await c.end();
}

async function reset() {
  const c = new pg.Client({ connectionString: adminUrl });
  await c.connect();
  await c.query(`SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = $1 AND pid <> pg_backend_pid()`, [DB]);
  await c.query(`DROP DATABASE IF EXISTS ${DB}`);
  await c.query(`CREATE DATABASE ${DB}`);
  await c.query("ALTER DATABASE " + DB + " SET timezone TO 'UTC'");
  await c.end();
  await migrate();
  if (!process.exitCode) await seed();
}

async function isUp() {
  const c = new pg.Client({ connectionString: adminUrl, connectionTimeoutMillis: 1500 });
  try { await c.connect(); await c.end(); return true; } catch { return false; }
}

const cmd = process.argv[2];
if (cmd === 'start') {
  const server = await startServer();
  await migrate();
  const stop = async () => { await server.stop(); process.exit(0); };
  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);
  setInterval(() => {}, 1 << 30);
} else if (['migrate', 'seed', 'reset'].includes(cmd)) {
  let server = null;
  if (!(await isUp())) server = await startServer();
  if (cmd === 'migrate') await migrate();
  if (cmd === 'seed') await seed();
  if (cmd === 'reset') await reset();
  if (server) await server.stop();
} else {
  console.log('Pemakaian: node scripts/db.mjs start|migrate|seed|reset');
}
