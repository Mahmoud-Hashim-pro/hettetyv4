/**
 * HETTETY v4 — Seed Super Admin Accounts into Neon PostgreSQL
 * Seeds all 4 configured Super Admin emails with scrypt password hashes
 * and super_admin privileges.
 */

import dotenv from 'dotenv';
dotenv.config();

import crypto from 'crypto';
import { getNeonSql, ensureNeonSchema, isNeonConfigured, writeAuditLog } from '../api/_lib/neon.js';
import { SUPER_ADMIN_EMAILS, hashPassword, normalizeEmail } from '../api/_lib/auth.js';

const DEFAULT_ADMIN_PASSWORD = process.env.ADMIN_INITIAL_PASSWORD || 'Hettety@Admin2026!';

interface AdminSeedConfig {
  email: string;
  name: string;
  phone?: string;
  role: 'super_admin' | 'admin';
}

const ADMIN_ACCOUNTS: AdminSeedConfig[] = [
  {
    email: 'pro.mahmoud.h@gmail.com',
    name: 'Mahmoud Hashim (Super Admin)',
    phone: '+20 100 000 0001',
    role: 'super_admin',
  },
  {
    email: 'modyhashim2006@gmail.com',
    name: 'Mody Hashim (Super Admin)',
    phone: '+20 100 000 0002',
    role: 'super_admin',
  },
  {
    email: 'abdallahahmedpilot2426@gmail.com',
    name: 'Abdallah Ahmed (Super Admin)',
    phone: '+20 100 000 0003',
    role: 'super_admin',
  },
  {
    email: 'marwaneltaweel0@gmail.com',
    name: 'Marwan Eltaweel (Super Admin)',
    phone: '+20 100 000 0004',
    role: 'super_admin',
  },
  {
    email: 'admin@hettety.com',
    name: 'Hettety Chief Admin',
    phone: '+20 100 000 0000',
    role: 'super_admin',
  },
];

async function main() {
  if (!isNeonConfigured()) {
    console.error('ERROR: Neon DATABASE_URL is not configured in .env');
    process.exit(1);
  }

  console.log('Ensuring Neon schema exists...');
  await ensureNeonSchema();
  const sql = getNeonSql();

  const passwordHash = hashPassword(DEFAULT_ADMIN_PASSWORD);
  const nowIso = new Date().toISOString();

  console.log('\n============================================================');
  console.log('HETTETY v4 — Seeding Super Admin Accounts into Neon DB');
  console.log(`Initial Admin Password: ${DEFAULT_ADMIN_PASSWORD}`);
  console.log('============================================================\n');

  for (const account of ADMIN_ACCOUNTS) {
    const cleanEmail = normalizeEmail(account.email);
    const userId = `usr_admin_${crypto.createHash('md5').update(cleanEmail).digest('hex').slice(0, 12)}`;

    // Upsert into users table
    const result = await sql`
      INSERT INTO users (
        id, email, password_hash, name, phone, role, kyc_status,
        is_suspended, avatar_url, preferences, created_at, last_login_at
      )
      VALUES (
        ${userId}, ${cleanEmail}, ${passwordHash}, ${account.name},
        ${account.phone || ''}, ${account.role}, 'verified',
        FALSE, NULL, '{"theme":"dark","language":"ar"}',
        ${nowIso}::timestamptz, ${nowIso}::timestamptz
      )
      ON CONFLICT (email) DO UPDATE SET
        password_hash = ${passwordHash},
        role = ${account.role},
        name = ${account.name},
        kyc_status = 'verified',
        is_suspended = FALSE
      RETURNING id, email, name, role;
    `;

    console.log(`✔ Admin Account Ready: ${result[0]?.email} (Role: ${result[0]?.role}, ID: ${result[0]?.id})`);

    await writeAuditLog({
      actorId: userId,
      actorEmail: cleanEmail,
      actorRole: account.role,
      action: 'ADMIN_SEED_INITIALIZED',
      resourceType: 'user',
      resourceId: userId,
      summary: `Admin account ${cleanEmail} initialized or password reset by seed tool.`,
    });
  }

  console.log('\n============================================================');
  console.log('Verification: Querying active admin accounts in Neon DB...');
  const verifyRows = await sql`
    SELECT id, email, name, role, kyc_status, (password_hash IS NOT NULL) as has_pass
    FROM users
    WHERE role IN ('super_admin', 'admin')
    ORDER BY created_at ASC;
  `;
  console.table(verifyRows);
  console.log('============================================================\n');
}

main().catch(err => {
  console.error('Migration/Seed Error:', err);
  process.exit(1);
});
