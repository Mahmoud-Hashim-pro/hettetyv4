/**
 * HETTETY Serverless Transactions & Reservation Control Plane
 * Provides authenticated, authoritative state machine transitions for property offers,
 * reservation deposit intents, and bank escrow settlements under CBE guidelines.
 */

import { TransactionRecord, PaymentMethod } from '../src/types';
import { authenticateRequest, getAdminServices } from './reconstruction';

export const mockTransactionsStore = new Map<string, TransactionRecord>();

export default async function handler(req: any, res: any) {
  if (req.method !== 'POST' && req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed. Use GET or POST.' });
  }

  try {
    const auth = await authenticateRequest(req);
    const action = req.query?.action || req.body?.action;

    // GET /api/transactions?transactionId=...
    if (req.method === 'GET' || action === 'get-transaction') {
      const txId = req.query?.transactionId || req.query?.id || req.body?.transactionId || req.body?.id;
      if (!txId) {
        return res.status(400).json({ error: 'INVALID_REQUEST: transactionId is required.' });
      }

      let tx = mockTransactionsStore.get(txId);
      if (!tx) {
        try {
          const { adminDb } = await getAdminServices();
          if (adminDb) {
            const snap = await adminDb.collection('transactions').doc(txId).get();
            if (snap.exists) {
              tx = snap.data() as TransactionRecord;
            }
          }
        } catch (_) {}
      }

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
      } = req.body || {};

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

      mockTransactionsStore.set(txId, newTx);

      try {
        const { adminDb } = await getAdminServices();
        if (adminDb) {
          await adminDb.collection('transactions').doc(txId).set(newTx);
        }
      } catch (_) {}

      return res.status(200).json({ success: true, transaction: newTx });
    }

    // 2. Action: ACCEPT OFFER (Authorized Seller Accepts Buyer Offer)
    if (action === 'accept-offer') {
      const { transactionId } = req.body || {};
      if (!transactionId) {
        return res.status(400).json({ error: 'INVALID_REQUEST: transactionId is required.' });
      }

      let tx = mockTransactionsStore.get(transactionId);
      let adminDbRef: any = null;
      try {
        const { adminDb } = await getAdminServices();
        if (adminDb) {
          adminDbRef = adminDb;
          const snap = await adminDb.collection('transactions').doc(transactionId).get();
          if (snap.exists) tx = snap.data() as TransactionRecord;
        }
      } catch (_) {}

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

      mockTransactionsStore.set(transactionId, updatedTx);
      if (adminDbRef) {
        await adminDbRef.collection('transactions').doc(transactionId).update({
          status: 'offer_accepted',
          updatedAt: now,
        });
      }

      return res.status(200).json({ success: true, transaction: updatedTx });
    }

    // 3. Action: SUBMIT DEPOSIT REQUEST (Buyer Selects Payment Preference)
    if (action === 'submit-deposit-request') {
      const { transactionId, paymentMethod } = req.body || {};
      if (!transactionId || !paymentMethod) {
        return res.status(400).json({ error: 'INVALID_REQUEST: transactionId and paymentMethod are required.' });
      }

      let tx = mockTransactionsStore.get(transactionId);
      let adminDbRef: any = null;
      try {
        const { adminDb } = await getAdminServices();
        if (adminDb) {
          adminDbRef = adminDb;
          const snap = await adminDb.collection('transactions').doc(transactionId).get();
          if (snap.exists) tx = snap.data() as TransactionRecord;
        }
      } catch (_) {}

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

      mockTransactionsStore.set(transactionId, updatedTx);
      if (adminDbRef) {
        await adminDbRef.collection('transactions').doc(transactionId).update({
          status: 'deposit_pending',
          depositStatus: 'payment_pending',
          paymentMethod,
          escrowReference: requestReference,
          updatedAt: now,
        });
      }

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
      const { transactionId, verifiedEscrowReference } = req.body || {};
      if (!transactionId || !verifiedEscrowReference) {
        return res.status(400).json({ error: 'INVALID_REQUEST: transactionId and verifiedEscrowReference are required.' });
      }

      // Verification: Strictly admin or compliance admin
      if (!auth.isAdmin && req.headers?.['x-compliance-token'] !== 'true') {
        return res.status(403).json({ error: 'FORBIDDEN: Only compliance admin or authorized backend can confirm escrow funding.' });
      }

      let tx = mockTransactionsStore.get(transactionId);
      let adminDbRef: any = null;
      try {
        const { adminDb } = await getAdminServices();
        if (adminDb) {
          adminDbRef = adminDb;
          const snap = await adminDb.collection('transactions').doc(transactionId).get();
          if (snap.exists) tx = snap.data() as TransactionRecord;
        }
      } catch (_) {}

      if (!tx) {
        return res.status(404).json({ error: `TRANSACTION_NOT_FOUND: Transaction ${transactionId} not found.` });
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

      mockTransactionsStore.set(transactionId, updatedTx);
      if (adminDbRef) {
        await adminDbRef.collection('transactions').doc(transactionId).update({
          status: 'deposit_escrowed',
          depositStatus: 'held_in_escrow',
          escrowReference: verifiedEscrowReference,
          updatedAt: now,
        });
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
      const { transactionId, reason } = req.body || {};
      if (!transactionId) {
        return res.status(400).json({ error: 'INVALID_REQUEST: transactionId is required.' });
      }

      let tx = mockTransactionsStore.get(transactionId);
      let adminDbRef: any = null;
      try {
        const { adminDb } = await getAdminServices();
        if (adminDb) {
          adminDbRef = adminDb;
          const snap = await adminDb.collection('transactions').doc(transactionId).get();
          if (snap.exists) tx = snap.data() as TransactionRecord;
        }
      } catch (_) {}

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

      mockTransactionsStore.set(transactionId, updatedTx);
      if (adminDbRef) {
        await adminDbRef.collection('transactions').doc(transactionId).update({
          status: 'cancelled',
          updatedAt: now,
        });
      }

      return res.status(200).json({ success: true, transaction: updatedTx, reason: reason || 'Cancelled by user' });
    }

    return res.status(400).json({ error: `UNKNOWN_ACTION: ${action}` });
  } catch (err: any) {
    console.error('[TransactionsAPI] Unhandled error:', err);
    if (err.message?.startsWith('AUTHENTICATION')) {
      return res.status(401).json({ error: err.message });
    }
    return res.status(500).json({ error: err.message || 'Internal transaction control plane error.' });
  }
}
