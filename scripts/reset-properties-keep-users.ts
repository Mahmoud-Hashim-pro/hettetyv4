/**
 * Safe Property Reset Utility (Preserves Users, Sessions & System Settings)
 *
 * Usage:
 *   npx tsx scripts/reset-properties-keep-users.ts --dry-run
 *   npx tsx scripts/reset-properties-keep-users.ts --confirm
 */

import 'dotenv/config';
import crypto from 'crypto';
import { neon } from '@neondatabase/serverless';

interface TableCounts {
  properties: number;
  media_assets: number;
  reviews: number;
  reports: number;
  viewing_appointments: number;
  crm_leads: number;
  purchases: number;
  transactions: number;
  reconstruction_jobs: number;
  users: number;
  sessions: number;
}

async function fetchCounts(sql: ReturnType<typeof neon>): Promise<TableCounts> {
  const rows = (await sql`
    SELECT
      (SELECT COUNT(*)::int FROM properties) AS properties,
      (SELECT COUNT(*)::int FROM media_assets) AS media_assets,
      (SELECT COUNT(*)::int FROM reviews) AS reviews,
      (SELECT COUNT(*)::int FROM reports) AS reports,
      (SELECT COUNT(*)::int FROM viewing_appointments) AS viewing_appointments,
      (SELECT COUNT(*)::int FROM crm_leads) AS crm_leads,
      (SELECT COUNT(*)::int FROM purchases) AS purchases,
      (SELECT COUNT(*)::int FROM transactions) AS transactions,
      (SELECT COUNT(*)::int FROM reconstruction_jobs) AS reconstruction_jobs,
      (SELECT COUNT(*)::int FROM users) AS users,
      (SELECT COUNT(*)::int FROM sessions) AS sessions
  `) as Record<string, any>[];

  const row = rows[0] || {};
  return {
    properties: Number(row.properties || 0),
    media_assets: Number(row.media_assets || 0),
    reviews: Number(row.reviews || 0),
    reports: Number(row.reports || 0),
    viewing_appointments: Number(row.viewing_appointments || 0),
    crm_leads: Number(row.crm_leads || 0),
    purchases: Number(row.purchases || 0),
    transactions: Number(row.transactions || 0),
    reconstruction_jobs: Number(row.reconstruction_jobs || 0),
    users: Number(row.users || 0),
    sessions: Number(row.sessions || 0),
  };
}

async function main(): Promise<void> {
  const args = new Set(process.argv.slice(2));
  const isDryRun = args.has('--dry-run') || !args.has('--confirm');
  const isConfirmed = args.has('--confirm') && !args.has('--dry-run');

  const databaseUrl =
    process.env.DATABASE_URL || process.env.POSTGRES_URL || process.env.NEON_DATABASE_URL || '';

  if (!databaseUrl || databaseUrl.startsWith('mock://')) {
    console.error('[reset-properties-keep-users] ERROR: DATABASE_URL is not configured.');
    console.error('Set DATABASE_URL to your Neon PostgreSQL connection string and re-run.');
    process.exit(1);
  }

  const sql = neon(databaseUrl);

  console.log('=== HETTETY v4 — Safe Property Reset (Preserve Users) ===');
  console.log(`Mode: ${isConfirmed ? 'LIVE EXECUTION (--confirm)' : 'DRY RUN (--dry-run)'}`);

  const before = await fetchCounts(sql);
  console.log('\nCurrent Neon Postgres Row Counts:');
  console.table({
    'properties (DELETE)': before.properties,
    'media_assets (DELETE)': before.media_assets,
    'reviews (DELETE)': before.reviews,
    'reports (DELETE)': before.reports,
    'viewing_appointments (DELETE)': before.viewing_appointments,
    'crm_leads (DELETE)': before.crm_leads,
    'purchases (DELETE)': before.purchases,
    'transactions (DELETE)': before.transactions,
    'reconstruction_jobs (DELETE)': before.reconstruction_jobs,
    'users (PRESERVE)': before.users,
    'sessions (PRESERVE)': before.sessions,
  });

  if (isDryRun) {
    console.log(
      `\n[DRY RUN] Would delete ${before.properties} properties (and dependent media/reviews/reports/viewings/leads/purchases/transactions/3D jobs) while strictly preserving ${before.users} users.`
    );
    console.log('Re-run with --confirm to execute inside an atomic PostgreSQL transaction.');
    return;
  }

  const auditId = `aud_reset_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;
  const summary = `CLI reset cleared ${before.properties} properties while strictly preserving ${before.users} users.`;

  await sql.transaction([
    sql`DELETE FROM media_assets`,
    sql`DELETE FROM reviews`,
    sql`DELETE FROM reports`,
    sql`DELETE FROM viewing_appointments`,
    sql`DELETE FROM crm_leads`,
    sql`DELETE FROM purchases`,
    sql`DELETE FROM transactions`,
    sql`DELETE FROM reconstruction_jobs`,
    sql`DELETE FROM properties`,
    sql`
      INSERT INTO audit_logs (
        id, actor_id, actor_email, actor_role, action, resource_type, resource_id, summary, before_state, after_state, created_at
      )
      VALUES (
        ${auditId},
        'cli_script',
        ${process.env.RESET_ACTOR_EMAIL || 'cli-admin@hettety.com'},
        'super_admin',
        'RESET_PROPERTIES_PRESERVE_USERS',
        'system',
        'properties_catalog',
        ${summary},
        ${JSON.stringify(before)}::jsonb,
        ${JSON.stringify({ properties: 0, users_preserved: before.users })}::jsonb,
        NOW()
      )
    `,
  ]);

  const after = await fetchCounts(sql);

  console.log('\nReset Completed Successfully (Atomic Transaction Committed):');
  console.log(`  Deleted properties: ${before.properties}`);
  console.log(`  Remaining properties: ${after.properties}`);
  console.log(`  Preserved users: ${after.users}`);
  console.log(`  Preserved sessions: ${after.sessions}`);
  console.log(`  Audit Log ID: ${auditId}`);
}

main().catch((err) => {
  console.error('[reset-properties-keep-users] Fatal error:', err?.message || err);
  process.exit(1);
});
