/**
 * HETTETY Serverless Transactions & Reservation Control Plane
 * Provides authenticated, authoritative state machine transitions for property offers,
 * reservation deposit intents, and bank escrow settlements under CBE guidelines.
 *
 * Persistence priority:
 *   1. Neon Serverless PostgreSQL (`transactions` table) when DATABASE_URL is configured
 *   2. Legacy Firestore Admin (`getAdminServices()`) fallback
 *   3. In-memory store (`mockTransactionsStore`) in dev/test ONLY (fails closed 503 in prod)
 */

import crypto from 'crypto';
import type { TransactionRecord, PaymentMethod } from '../src/types.js';
import { authenticateRequest, getAdminServices } from './reconstruction.js';
import {
  isNeonConfigured,
  getNeonSql,
  ensureNeonSchema,
  writeAuditLog,
} from './_lib/neon.js';
import { verifyAuthHeader, getQueryParams, getJsonBody } from './_lib/auth.js';

export const mockTransactionsStore = new Map<string, TransactionRecord>();

async function authenticateTransactionRequest(req: any): Promise<{
  uid: string;
  isAdmin: boolean;
  isWorker: boolean;
  email?: string;
  role?: string;
}> {
  const neonAuth = verifyAuthHeader(req);
  if (neonAuth) {
    return {
      uid: neonAuth.uid,
      isAdmin: neonAuth.isAdmin,
      isWorker: false,
      email: neonAuth.email,
      role: neonAuth.role,
    };
  }
  const legacyAuth = await authenticateRequest(req);
  return legacyAuth;
}

/**
 * Retrieves a transaction record from Neon Postgres, Firestore Admin, or dev in-memory store.
 * Fails closed in production if durable persistence is unavailable.
 */
async function getDurableTransaction(txId: string): Promise<{ tx: TransactionRecord | null; adminDbRef: any }> {
  // 1. Primary: Neon Serverless PostgreSQL
  if (isNeonConfigured()) {
    try {
      await ensureNeonSchema();
      const sql = getNeonSql();
      const rows = (await sql`
        SELECT payload FROM transactions WHERE id = ${txId} LIMIT 1
      `) as Record<string, any>[];
      if (rows[0]?.payload) {
        const data = rows[0].payload as TransactionRecord;
        mockTransactionsStore.set(txId, data);
        return { tx: data, adminDbRef: null };
      }
      return { tx: null, adminDbRef: null };
    } catch (err: any) {
      if (process.env.NODE_ENV === 'production') {
        const dbErr: any = new Error(
          `DATABASE_PERSISTENCE_FAILED: Error reading transaction ${txId} from Neon Postgres: ${err.message}`
        );
        dbErr.status = 503;
        throw dbErr;
      }
      console.warn('[TransactionsAPI] Neon read fallback warning:', err?.message);
    }
  }

  // 2. Legacy Firestore Admin fallback
  let adminDbRef: any = null;
  try {
    const { adminDb } = await getAdminServices();
    adminDbRef = adminDb;
  } catch (err: any) {
    if (process.env.NODE_ENV === 'production') {
      const dbErr: any = new Error(`DATABASE_PERSISTENCE_FAILED: Failed to connect to Firestore Admin: ${err.message}`);
      dbErr.status = 503;
      throw dbErr;
    }
  }

  if (process.env.NODE_ENV === 'production' && !adminDbRef) {
    const dbErr: any = new Error('DATABASE_PERSISTENCE_FAILED: Database unavailable in production.');
    dbErr.status = 503;
    throw dbErr;
  }

  if (adminDbRef) {
    try {
      const snap = await adminDbRef.collection('transactions').doc(txId).get();
      if (snap.exists) {
        const data = snap.data() as TransactionRecord;
        mockTransactionsStore.set(txId, data);
        return { tx: data, adminDbRef };
      }
      return { tx: null, adminDbRef };
    } catch (err: any) {
      if (process.env.NODE_ENV === 'production') {
        const dbErr: any = new Error(`DATABASE_PERSISTENCE_FAILED: Error reading transaction ${txId}: ${err.message}`);
        dbErr.status = 503;
        throw dbErr;
      }
    }
  }

  return { tx: mockTransactionsStore.get(txId) || null, adminDbRef: null };
}

/**
 * Lists transactions for an authenticated actor (all for admin, own party records otherwise).
 */
async function listDurableTransactions(uid: string, isAdmin: boolean): Promise<TransactionRecord[]> {
  if (isNeonConfigured()) {
    await ensureNeonSchema();
    const sql = getNeonSql();
    const rows = (isAdmin
      ? await sql`SELECT payload FROM transactions ORDER BY updated_at DESC LIMIT 250`
      : await sql`
          SELECT payload FROM transactions
          WHERE buyer_id = ${uid} OR seller_id = ${uid} OR agent_id = ${uid}
          ORDER BY updated_at DESC
          LIMIT 250
        `) as Record<string, any>[];
    return rows.map((r) => r.payload as TransactionRecord).filter(Boolean);
  }

  const all = Array.from(mockTransactionsStore.values());
  if (isAdmin) return all;
  return all.filter((tx) => tx.buyerId === uid || tx.sellerId === uid || tx.agentId === uid);
}

/**
 * Persists a transaction record to Neon Postgres (or Firestore Admin fallback).
 * In production, fails closed without modifying in-memory cache if the write fails.
 */
async function persistDurableTransaction(tx: TransactionRecord, isCreate: boolean = false): Promise<void> {
  // 1. Primary: Neon Serverless PostgreSQL
  if (isNeonConfigured()) {
    try {
      await ensureNeonSchema();
      const sql = getNeonSql();
      await sql`
        INSERT INTO transactions (
          id, property_id, property_title, buyer_id, seller_id, agent_id,
          agreed_price, currency, deposit_amount, status, payload, created_at, updated_at
        )
        VALUES (
          ${tx.id},
          ${tx.propertyId || null},
          ${tx.propertyTitle || null},
          ${tx.buyerId || null},
          ${tx.sellerId || null},
          ${tx.agentId || null},
          ${tx.agreedPrice ?? 0},
          ${tx.currency || 'EGP'},
          ${tx.depositAmount ?? 0},
          ${tx.status || 'offer_submitted'},
          ${JSON.stringify(tx)}::jsonb,
          ${tx.createdAt || new Date().toISOString()}::timestamptz,
          ${tx.updatedAt || new Date().toISOString()}::timestamptz
        )
        ON CONFLICT (id) DO UPDATE
        SET property_id = EXCLUDED.property_id,
            property_title = EXCLUDED.property_title,
            buyer_id = EXCLUDED.buyer_id,
            seller_id = EXCLUDED.seller_id,
            agent_id = EXCLUDED.agent_id,
            agreed_price = EXCLUDED.agreed_price,
            currency = EXCLUDED.currency,
            deposit_amount = EXCLUDED.deposit_amount,
            status = EXCLUDED.status,
            payload = EXCLUDED.payload,
            updated_at = EXCLUDED.updated_at
      `;
      mockTransactionsStore.set(tx.id, tx);
      return;
    } catch (err: any) {
      const dbErr: any = new Error(
        `DATABASE_PERSISTENCE_FAILED: Failed to durably persist transaction ${tx.id} to Neon Postgres: ${err.message}`
      );
      dbErr.status = 503;
      throw dbErr;
    }
  }

  // 2. Legacy Firestore Admin fallback
  let adminDbRef: any = null;
  try {
    const { adminDb } = await getAdminServices();
    adminDbRef = adminDb;
  } catch (err: any) {
    if (process.env.NODE_ENV === 'production') {
      const dbErr: any = new Error(`DATABASE_PERSISTENCE_FAILED: Failed to connect to Firestore Admin: ${err.message}`);
      dbErr.status = 503;
      throw dbErr;
    }
  }

  if (process.env.NODE_ENV === 'production' && !adminDbRef) {
    const dbErr: any = new Error('DATABASE_PERSISTENCE_FAILED: Firestore Admin database unavailable in production.');
    dbErr.status = 503;
    throw dbErr;
  }

  if (adminDbRef) {
    try {
      if (isCreate) {
        await adminDbRef.collection('transactions').doc(tx.id).set(tx);
      } else {
        await adminDbRef.collection('transactions').doc(tx.id).set(tx, { merge: true });
      }
    } catch (err: any) {
      const dbErr: any = new Error(`DATABASE_PERSISTENCE_FAILED: Failed to durably persist transaction ${tx.id} to Firestore: ${err.message}`);
      dbErr.status = 503;
      throw dbErr;
    }
  }

  // Cache updated only after durable persistence succeeds
  mockTransactionsStore.set(tx.id, tx);
}

export default async function handler(req: any, res: any) {
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST' && req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed. Use GET or POST.' });
  }

  try {
    const auth = await authenticateTransactionRequest(req);
    const query = getQueryParams(req);
    const body = getJsonBody(req);
    const action = query.action || body.action;

    // GET /api/transactions?list=1 or action=list-transactions
    if ((req.method === 'GET' && (query.list === '1' || query.list === 'true')) || action === 'list-transactions') {
      const transactions = await listDurableTransactions(auth.uid, auth.isAdmin);
      return res.status(200).json({ success: true, transactions });
    }

    // GET /api/transactions?transactionId=...
    if (req.method === 'GET' || action === 'get-transaction') {
      const txId = query.transactionId || query.id || body.transactionId || body.id;
      if (!txId) {
        return res.status(400).json({ error: 'INVALID_REQUEST: transactionId is required.' });
      }

      const { tx } = await getDurableTransaction(txId);
      if (!tx) {
        return res.status(404).json({ error: `TRANSACTION_NOT_FOUND: Transaction ${txId} does not exist.` });
      }

      // Authorization: Only buyer, seller, agent, or admin can read
      if (!auth.isAdmin && auth.uid !== tx.buyerId && auth.uid !== tx.sellerId && auth.uid !== tx.agentId) {
        return res.status(403).json({ error: 'FORBIDDEN: You are not authorized to view this transaction.' });
      }

      return res.status(200).json({ success: true, transaction: tx });
    }

    // 1. Action: CREATE OFFER (Buyer Submits Binding Offer)
    if (action === 'create-offer') {
      const {
        propertyId,
        propertyTitle,
        agreedPrice,
        currency,
        buyer,
        seller,
        agentId,
        depositPercent,
        contractTerms,
        idempotencyKey,
      } = body;

      if (!propertyId || !agreedPrice || !buyer?.id || !seller?.id) {
        return res.status(400).json({ error: 'INVALID_REQUEST: Missing required offer fields.' });
      }

      // Verification: Caller MUST be the asserting buyer (no identity spoofing)
      if (!auth.isAdmin && auth.uid !== buyer.id) {
        return res.status(403).json({ error: 'FORBIDDEN: You can only submit offers on your own behalf.' });
      }

      if (buyer.id === seller.id) {
        return res.status(400).json({ error: 'INVALID_REQUEST: A seller cannot place an offer on their own property.' });
      }

      if (typeof agreedPrice !== 'number' || agreedPrice <= 0) {
        return res.status(400).json({ error: 'INVALID_REQUEST: Agreed price must be a positive number.' });
      }

      const safePercent = Math.min(25, Math.max(1, depositPercent || 5));
      const depositAmount = Math.round((agreedPrice * safePercent) / 100);
      const now = new Date().toISOString();
      const txId = `tx_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
      const safeIdempKey = idempotencyKey || `idemp_${txId}`;

      const newTx: TransactionRecord = {
        id: txId,
        propertyId,
        propertyTitle: propertyTitle || 'Property Listing',
        buyerId: buyer.id,
        buyerName: buyer.name || 'Buyer',
        buyerPhone: buyer.phone || '',
        sellerId: seller.id,
        sellerName: seller.name || 'Seller',
        agentId,
        agreedPrice,
        currency: currency || 'EGP',
        depositAmount,
        depositPercent: safePercent,
        depositStatus: 'unpaid',
        status: 'offer_submitted',
        idempotencyKey: safeIdempKey,
        contractTerms,
        createdAt: now,
        updatedAt: now,
      };

      await persistDurableTransaction(newTx, true);

      return res.status(200).json({ success: true, transaction: newTx });
    }

    // 2. Action: ACCEPT OFFER (Authorized Seller Accepts Buyer Offer)
    if (action === 'accept-offer') {
      const { transactionId } = body;
      if (!transactionId) {
        return res.status(400).json({ error: 'INVALID_REQUEST: transactionId is required.' });
      }

      const { tx } = await getDurableTransaction(transactionId);
      if (!tx) {
        return res.status(404).json({ error: `TRANSACTION_NOT_FOUND: Transaction ${transactionId} not found.` });
      }

      // Verification: Caller MUST be the property seller or admin
      if (!auth.isAdmin && auth.uid !== tx.sellerId) {
        return res.status(403).json({ error: 'FORBIDDEN: Only the seller can accept this offer.' });
      }

      if (tx.status !== 'offer_submitted' && tx.status !== 'counter_offered') {
        return res.status(409).json({ error: `INVALID_STATE_TRANSITION: Cannot accept offer from state ${tx.status}.` });
      }

      const now = new Date().toISOString();
      const updatedTx: TransactionRecord = {
        ...tx,
        status: 'offer_accepted',
        updatedAt: now,
      };

      await persistDurableTransaction(updatedTx, false);

      return res.status(200).json({ success: true, transaction: updatedTx });
    }

    // 3. Action: SUBMIT DEPOSIT REQUEST (Buyer Selects Payment Preference)
    if (action === 'submit-deposit-request') {
      const { transactionId, paymentMethod } = body;
      if (!transactionId || !paymentMethod) {
        return res.status(400).json({ error: 'INVALID_REQUEST: transactionId and paymentMethod are required.' });
      }

      const { tx } = await getDurableTransaction(transactionId);
      if (!tx) {
        return res.status(404).json({ error: `TRANSACTION_NOT_FOUND: Transaction ${transactionId} not found.` });
      }

      // Verification: Caller MUST be the buyer
      if (!auth.isAdmin && auth.uid !== tx.buyerId) {
        return res.status(403).json({ error: 'FORBIDDEN: Only the buyer can submit a deposit payment request.' });
      }

      if (tx.status !== 'offer_accepted' && tx.status !== 'deposit_pending') {
        return res.status(409).json({ error: `INVALID_STATE_TRANSITION: Cannot submit deposit request from state ${tx.status}.` });
      }

      const now = new Date().toISOString();
      const requestReference = `REQ-RES-${Math.random().toString(36).substring(2, 9).toUpperCase()}`;

      const updatedTx: TransactionRecord = {
        ...tx,
        status: 'deposit_pending',
        depositStatus: 'payment_pending',
        paymentMethod: paymentMethod as PaymentMethod,
        escrowReference: requestReference,
        updatedAt: now,
      };

      await persistDurableTransaction(updatedTx, false);

      return res.status(200).json({
        success: true,
        transaction: updatedTx,
        requestReference,
        escrowReference: requestReference,
        timestamp: now,
      });
    }

    // 4. Action: CONFIRM ESCROW (Admin / Bank Webhook Authoritative Confirmation)
    if (action === 'confirm-escrow') {
      const {
        transactionId,
        verifiedEscrowReference,
        amount,
        currency,
        settlementStatus,
      } = body;

      if (!transactionId || !verifiedEscrowReference) {
        return res.status(400).json({ error: 'INVALID_REQUEST: transactionId and verifiedEscrowReference are required.' });
      }

      // Cryptographic webhook verification (HMAC SHA-256)
      const webhookSig = (req.headers?.['x-webhook-signature'] || req.headers?.['x-escrow-signature'] || '') as string;
      const webhookSecret = process.env.ESCROW_WEBHOOK_SECRET || process.env.PAYMENT_WEBHOOK_SECRET;
      let isVerifiedWebhook = false;

      if (webhookSig && webhookSecret) {
        try {
          const bodyPayload = typeof req.body === 'string' ? req.body : JSON.stringify(req.body);
          const expectedSig = crypto.createHmac('sha256', webhookSecret).update(bodyPayload).digest('hex');
          if (webhookSig.length === expectedSig.length && crypto.timingSafeEqual(Buffer.from(webhookSig), Buffer.from(expectedSig))) {
            isVerifiedWebhook = true;
          }
        } catch (_) {}
      }

      // Verification: Strictly authenticated admin or cryptographically authenticated payment webhook
      // NEVER allow forgeable client-controlled headers like x-compliance-token: true
      if (!auth.isAdmin && !isVerifiedWebhook) {
        return res.status(403).json({
          error: 'FORBIDDEN: Only authorized compliance admin or cryptographically verified payment webhook can confirm escrow funding.',
        });
      }

      const { tx, adminDbRef } = await getDurableTransaction(transactionId);
      if (!tx) {
        return res.status(404).json({ error: `TRANSACTION_NOT_FOUND: Transaction ${transactionId} not found.` });
      }

      // If provider reports settlementStatus, validate it represents completed settlement
      if (settlementStatus && !['SETTLED', 'PAID', 'HELD_IN_ESCROW'].includes(String(settlementStatus).toUpperCase())) {
        return res.status(422).json({
          error: `PAYMENT_NOT_SETTLED: Payment provider reports non-settled status '${settlementStatus}'. Escrow cannot be confirmed.`,
        });
      }

      // Validate payment amount against transaction agreed deposit amount
      if (amount !== undefined && Number(amount) !== tx.depositAmount) {
        return res.status(422).json({
          error: `AMOUNT_MISMATCH: Provided settlement amount (${amount}) does not match agreed transaction deposit amount (${tx.depositAmount}).`,
        });
      }

      // Validate payment currency against transaction currency
      if (currency && String(currency).toUpperCase() !== tx.currency.toUpperCase()) {
        return res.status(422).json({
          error: `CURRENCY_MISMATCH: Provided currency (${currency}) does not match agreed transaction currency (${tx.currency}).`,
        });
      }

      // Idempotency: If already confirmed with matching verifiedEscrowReference, return idempotent success
      if (tx.status === 'deposit_escrowed') {
        if (tx.escrowReference === verifiedEscrowReference) {
          return res.status(200).json({
            success: true,
            transaction: tx,
            escrowReference: verifiedEscrowReference,
            idempotent: true,
            message: 'IDEMPOTENT_ALREADY_CONFIRMED: Transaction escrow was already authoritatively confirmed.',
          });
        }
        return res.status(409).json({
          error: `CONFLICT: Transaction ${transactionId} is already held in escrow under reference ${tx.escrowReference}.`,
        });
      }

      if (tx.status !== 'deposit_pending' && tx.status !== 'offer_accepted') {
        return res.status(409).json({ error: `INVALID_STATE_TRANSITION: Cannot confirm escrow from state ${tx.status}.` });
      }

      const now = new Date().toISOString();
      const updatedTx: TransactionRecord = {
        ...tx,
        status: 'deposit_escrowed',
        depositStatus: 'held_in_escrow',
        escrowReference: verifiedEscrowReference,
        updatedAt: now,
      };

      await persistDurableTransaction(updatedTx, false);

      // Record immutable audit trail
      const auditLog = {
        transactionId,
        propertyId: tx.propertyId,
        event: 'ESCROW_DEPOSIT_CONFIRMED',
        actorId: auth.isAdmin ? auth.uid : 'payment_gateway_webhook',
        actorRole: auth.isAdmin ? 'compliance_admin' : 'payment_provider',
        escrowReference: verifiedEscrowReference,
        agreedPrice: tx.agreedPrice,
        depositAmount: tx.depositAmount,
        currency: tx.currency,
        timestamp: now,
      };

      await writeAuditLog({
        actorId: auth.isAdmin ? auth.uid : 'payment_gateway_webhook',
        actorEmail: auth.email || (auth.isAdmin ? 'admin@hettety.com' : 'webhook@cbe-escrow.local'),
        actorRole: auth.isAdmin ? 'admin' : 'operations',
        action: 'ESCROW_DEPOSIT_CONFIRMED',
        resourceType: 'transaction',
        resourceId: transactionId,
        summary: `Escrow confirmed (${verifiedEscrowReference}) for ${tx.depositAmount} ${tx.currency}.`,
        beforeState: { status: tx.status, depositStatus: tx.depositStatus },
        afterState: { status: updatedTx.status, depositStatus: updatedTx.depositStatus, escrowReference: verifiedEscrowReference },
      });

      if (adminDbRef) {
        try {
          await adminDbRef.collection('transaction_audit_logs').add(auditLog);
        } catch (auditErr) {
          console.warn('[TransactionsAPI] Non-fatal audit log persistence warning:', auditErr);
        }
      }

      return res.status(200).json({
        success: true,
        transaction: updatedTx,
        escrowReference: verifiedEscrowReference,
        timestamp: now,
      });
    }

    // 5. Action: CANCEL OFFER
    if (action === 'cancel-offer') {
      const { transactionId, reason } = body;
      if (!transactionId) {
        return res.status(400).json({ error: 'INVALID_REQUEST: transactionId is required.' });
      }

      const { tx } = await getDurableTransaction(transactionId);
      if (!tx) {
        return res.status(404).json({ error: `TRANSACTION_NOT_FOUND: Transaction ${transactionId} not found.` });
      }

      const isBuyer = auth.uid === tx.buyerId;
      const isSeller = auth.uid === tx.sellerId;
      if (!auth.isAdmin && !isBuyer && !isSeller) {
        return res.status(403).json({ error: 'FORBIDDEN: You are not a party to this transaction.' });
      }

      if (isBuyer && tx.status !== 'offer_submitted' && tx.status !== 'counter_offered' && !auth.isAdmin) {
        return res.status(409).json({ error: `INVALID_STATE_TRANSITION: Buyer cannot cancel accepted offer directly without admin review.` });
      }

      const now = new Date().toISOString();
      const updatedTx: TransactionRecord = {
        ...tx,
        status: 'cancelled',
        updatedAt: now,
      };

      await persistDurableTransaction(updatedTx, false);

      return res.status(200).json({ success: true, transaction: updatedTx, reason: reason || 'Cancelled by user' });
    }

    return res.status(400).json({ error: `UNKNOWN_ACTION: ${action}` });
  } catch (err: any) {
    console.error('[TransactionsAPI] Unhandled error:', err);
    if (err.message?.startsWith('AUTHENTICATION')) {
      return res.status(401).json({ error: err.message });
    }
    const statusCode = err.status || 500;
    return res.status(statusCode).json({ error: err.message || 'Internal transaction control plane error.' });
  }
}
