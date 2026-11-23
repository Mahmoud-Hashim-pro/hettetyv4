/**
 * HETTETY v4 — Neon Serverless Postgres Schema Migration Runner
 * Applies database/migrations/001_initial_neon_schema.sql idempotently against DATABASE_URL
 * and prints a live verification table count report.
 *
 * Usage:
 *   npx tsx scripts/run-neon-migrations.ts
 */

import 'dotenv/config';
import fs from 'fs';
import path from 'path';
import { neon } from '@neondatabase/serverless';

/** Splits a SQL script into executable statements, respecting dollar/single quotes and comments. */
function splitSqlStatements(sqlText: string): string[] {
  const statements: string[] = [];
  let current = '';
  let inSingle = false;
  let inLineComment = false;
  let inBlockComment = false;

  for (let i = 0; i < sqlText.length; i++) {
    const ch = sqlText[i];
    const next = sqlText[i + 1] || '';

    if (inLineComment) {
      if (ch === '\n') {
        inLineComment = false;
        current += ch;
      }
      continue;
    }

    if (inBlockComment) {
      if (ch === '*' && next === '/') {
        inBlockComment = false;
        i++;
      }
      continue;
    }

    if (!inSingle && ch === '-' && next === '-') {
      inLineComment = true;
      i++;
      continue;
    }

    if (!inSingle && ch === '/' && next === '*') {
      inBlockComment = true;
      i++;
      continue;
    }

    if (ch === "'") {
      current += ch;
      if (inSingle && next === "'") {
        current += next;
        i++;
      } else {
        inSingle = !inSingle;
      }
      continue;
    }

    if (!inSingle && ch === ';') {
      const trimmed = current.trim();
      if (trimmed && !/^BEGIN$/i.test(trimmed) && !/^COMMIT$/i.test(trimmed)) {
        statements.push(trimmed);
      }
      current = '';
      continue;
    }

    current += ch;
  }

  const tail = current.trim();
  if (tail && !/^BEGIN$/i.test(tail) && !/^COMMIT$/i.test(tail)) {
    statements.push(tail);
  }
  return statements;
}

async function main() {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    console.error('❌ ERROR: DATABASE_URL is not set in environment or .env');
    process.exit(1);
  }

  const sql = neon(databaseUrl);
  const start = Date.now();

  // 1. Connectivity probe
  const ping = await sql`SELECT current_database() AS db, version() AS ver, NOW() AS server_time`;
  console.log(`✅ Connected to Neon Postgres: ${ping[0].db} (${Date.now() - start}ms)`);
  console.log(`   Version: ${String(ping[0].ver).split(',')[0]}`);

  // 2. Apply 001_initial_neon_schema.sql
  const migrationPath = path.resolve(process.cwd(), 'database/migrations/001_initial_neon_schema.sql');
  const rawSql = fs.readFileSync(migrationPath, 'utf8');
  const statements = splitSqlStatements(rawSql);

  console.log(`\n🚀 Applying ${statements.length} DDL/index/seed statements from 001_initial_neon_schema.sql...`);
  for (let i = 0; i < statements.length; i++) {
    await sql.query(statements[i]);
  }
  console.log(`✅ Schema migration 001 applied cleanly!`);

  // 3. Verify all public tables and live row counts
  const tables = (await sql`
    SELECT table_name
    FROM information_schema.tables
    WHERE table_schema = 'public' AND table_type = 'BASE TABLE'
    ORDER BY table_name ASC
  `) as Array<{ table_name: string }>;

  console.log(`\n📊 Verified ${tables.length} tables in Neon Postgres ('public' schema):`);
  for (const t of tables) {
    const countRes = await sql.query(`SELECT COUNT(*)::int AS cnt FROM "${t.table_name}"`);
    const cnt = countRes?.[0]?.cnt ?? 0;
    console.log(`   • ${t.table_name.padEnd(24)} -> ${cnt} rows`);
  }
}

main().catch((err) => {
  console.error('❌ Migration failed:', err?.message || err);
  process.exit(1);
});
