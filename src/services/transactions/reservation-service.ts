/**
 * HETTETY Reservation & Escrow Service
 * Manages formal property offers, escrow holds (جدية الحجز), and contract closings
 * under Egyptian Real Estate transactions and consumer protection guidelines.
 */

import {
  TransactionRecord,
  TransactionStatus,
  PaymentMethod,
  ContractTerms,
} from '../../types';
import { auth } from '../../firebase';
import { mockTransactionsStore } from '../../../api/transactions';

export interface CreateOfferParams {
  propertyId: string;
  propertyTitle: string;
  agreedPrice: number;
  currency?: 'EGP' | 'USD';
  buyer: {
    id: string;
    name: string;
    phone: string;
  };
  seller: {
    id: string;
    name: string;
  };
  agentId?: string;
  depositPercent?: number;
  contractTerms?: ContractTerms;
  idempotencyKey?: string;
}

export interface DepositPlacementResult {
  transaction: TransactionRecord;
  requestReference?: string;
  escrowReference: string;
  receiptNumber?: string;
  timestamp: string;
}

export interface CancellationResult {
  transaction: TransactionRecord;
  refundGranted: boolean;
  refundAmount: number;
  reason: string;
}

/**
 * Calculates reservation deposit amount based on property price (default: 5% of price)
 */
export const calculateReservationDeposit = (
  price: number,
  percent: number = 5
): { depositAmount: number; depositPercent: number } => {
  const safePercent = Math.min(25, Math.max(1, percent));
  const depositAmount = Math.round((price * safePercent) / 100);
  return {
    depositAmount,
    depositPercent: safePercent,
  };
};

/**
 * Creates a formal, binding reservation offer
 */
export const createPropertyOffer = (params: CreateOfferParams): TransactionRecord => {
  if (params.buyer.id === params.seller.id) {
    throw new Error('A seller cannot place an offer on their own property listing.');
  }

  if (params.agreedPrice <= 0) {
    throw new Error('Agreed transaction price must be greater than zero.');
  }

  const { depositAmount, depositPercent } = calculateReservationDeposit(
    params.agreedPrice,
    params.depositPercent || 5
  );

  const now = new Date().toISOString();
  const txId = `tx_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
  const idempotencyKey = params.idempotencyKey || `idemp_${txId}`;

  const newTx: TransactionRecord = {
    id: txId,
    propertyId: params.propertyId,
    propertyTitle: params.propertyTitle,
    buyerId: params.buyer.id,
    buyerName: params.buyer.name,
    buyerPhone: params.buyer.phone,
    sellerId: params.seller.id,
    sellerName: params.seller.name,
    agentId: params.agentId,
    agreedPrice: params.agreedPrice,
    currency: params.currency || 'EGP',
    depositAmount,
    depositPercent,
    depositStatus: 'unpaid',
    status: 'offer_submitted',
    idempotencyKey,
    contractTerms: params.contractTerms,
    createdAt: now,
    updatedAt: now,
  };

  mockTransactionsStore.set(txId, newTx);
  return newTx;
};

/**
 * Submits property offer to backend control plane API with user authentication
 */
export const submitPropertyOffer = async (params: CreateOfferParams): Promise<TransactionRecord> => {
  const currentUid = auth?.currentUser?.uid || params.buyer.id;
  let authToken = '';
  if (auth?.currentUser) {
    try {
      authToken = await auth.currentUser.getIdToken();
    } catch (e) {
      console.debug('Failed to get auth token in submitPropertyOffer:', e);
    }
  }
  if (!authToken && process.env.NODE_ENV === 'test') {
    authToken = currentUid;
  }

  // 1. Browser production: call backend API
  if (typeof fetch !== 'undefined' && typeof window !== 'undefined' && window.location?.origin && process.env.NODE_ENV !== 'test') {
    const res = await fetch('/api/transactions?action=create-offer', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${authToken}`,
      },
      body: JSON.stringify(params),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: res.statusText }));
      throw new Error(err.error || 'Failed to submit offer');
    }
    const data = await res.json();
    return data.transaction;
  }

  // 2. Local fallback / unit test
  return createPropertyOffer(params);
};

/**
 * Seller accepts the formal offer
 */
export const acceptOffer = (
  transaction: TransactionRecord,
  sellerId: string
): TransactionRecord => {
  if (transaction.sellerId !== sellerId) {
    throw new Error('Unauthorized: Only the designated seller can accept this offer.');
  }

  if (transaction.status !== 'offer_submitted' && transaction.status !== 'counter_offered') {
    throw new Error(`Cannot accept offer in current state: ${transaction.status}`);
  }

  return {
    ...transaction,
    status: 'offer_accepted',
    updatedAt: new Date().toISOString(),
  };
};

/**
 * Buyer submits reservation deposit payment intent / method preference.
 * Explicitly records transaction as 'deposit_pending' with 'payment_pending' deposit status.
 * DOES NOT fabricate bank escrow confirmation before backend payment settlement.
 */
export const submitReservationDepositRequest = (
  transaction: TransactionRecord,
  paymentMethod: PaymentMethod,
  buyerId: string
): DepositPlacementResult => {
  if (transaction.buyerId !== buyerId) {
    throw new Error('Unauthorized: Only the buyer can submit this reservation deposit request.');
  }

  if (transaction.status !== 'offer_accepted' && transaction.status !== 'deposit_pending') {
    throw new Error(`Cannot fund deposit when offer status is ${transaction.status}`);
  }

  const now = new Date().toISOString();
  const receiptNumber = `RCP-HET-${Date.now().toString().slice(-6)}`;
  const requestReference = `REQ-RES-${Math.random().toString(36).substring(2, 9).toUpperCase()}`;

  const updatedTx: TransactionRecord = {
    ...transaction,
    status: 'deposit_pending',
    depositStatus: 'payment_pending',
    paymentMethod,
    escrowReference: requestReference,
    updatedAt: now,
  };

  mockTransactionsStore.set(transaction.id, updatedTx);

  return {
    transaction: updatedTx,
    requestReference,
    escrowReference: requestReference,
    receiptNumber,
    timestamp: now,
  };
};

/**
 * Submits reservation deposit request to backend control plane with user authentication
 */
export const submitReservationDepositRequestAsync = async (
  transaction: TransactionRecord,
  paymentMethod: PaymentMethod,
  buyerId: string
): Promise<DepositPlacementResult> => {
  const currentUid = auth?.currentUser?.uid || buyerId;
  let authToken = '';
  if (auth?.currentUser) {
    try {
      authToken = await auth.currentUser.getIdToken();
    } catch (e) {
      console.debug('Failed to get auth token in submitReservationDepositRequestAsync:', e);
    }
  }
  if (!authToken && process.env.NODE_ENV === 'test') {
    authToken = currentUid;
  }

  // 1. Browser production: call backend API
  if (typeof fetch !== 'undefined' && typeof window !== 'undefined' && window.location?.origin && process.env.NODE_ENV !== 'test') {
    const res = await fetch('/api/transactions?action=submit-deposit-request', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${authToken}`,
      },
      body: JSON.stringify({
        transactionId: transaction.id,
        paymentMethod,
      }),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: res.statusText }));
      throw new Error(err.error || 'Failed to submit deposit request');
    }
    const data = await res.json();
    return {
      transaction: data.transaction,
      requestReference: data.requestReference,
      escrowReference: data.escrowReference,
      receiptNumber: data.requestReference,
      timestamp: data.timestamp || new Date().toISOString(),
    };
  }

  // 2. Local fallback / unit test
  return submitReservationDepositRequest(transaction, paymentMethod, buyerId);
};

/**
 * Authoritative Server/Compliance Admin Escrow Confirmation
 * Executed ONLY upon verified payment gateway webhook or bank clearance.
 * Authoritatively transitions transaction to 'deposit_escrowed' and depositStatus to 'held_in_escrow'.
 */
export const confirmEscrowDeposit = (
  transaction: TransactionRecord,
  actorRole: 'compliance_admin',
  verifiedEscrowReference: string
): DepositPlacementResult => {
  if (actorRole !== 'compliance_admin') {
    throw new Error('Unauthorized: Only compliance_admin or authoritative backend can confirm escrow funding.');
  }

  if (transaction.status !== 'deposit_pending' && transaction.status !== 'offer_accepted') {
    throw new Error(`Cannot confirm escrow deposit from state: ${transaction.status}`);
  }

  const now = new Date().toISOString();
  const receiptNumber = `RCP-ESC-${Date.now().toString().slice(-6)}`;

  const updatedTx: TransactionRecord = {
    ...transaction,
    status: 'deposit_escrowed',
    depositStatus: 'held_in_escrow',
    escrowReference: verifiedEscrowReference,
    updatedAt: now,
  };

  return {
    transaction: updatedTx,
    requestReference: transaction.escrowReference || verifiedEscrowReference,
    receiptNumber,
    escrowReference: verifiedEscrowReference,
    timestamp: now,
  };
};

/**
 * Places reservation deposit into secured platform escrow
 */
export const placeReservationDeposit = (
  transaction: TransactionRecord,
  paymentMethod: PaymentMethod,
  buyerId: string,
  options?: { isAuthoritative?: boolean; actorRole?: 'compliance_admin' }
): DepositPlacementResult => {
  if (transaction.buyerId !== buyerId && options?.actorRole !== 'compliance_admin') {
    throw new Error('Unauthorized: Only the buyer can fund this reservation deposit.');
  }

  if (transaction.status !== 'offer_accepted' && transaction.status !== 'deposit_pending') {
    throw new Error(`Cannot fund deposit when offer status is ${transaction.status}`);
  }

  const now = new Date().toISOString();
  const receiptNumber = `RCP-HET-${Date.now().toString().slice(-6)}`;
  const isEscrowed = Boolean(options?.isAuthoritative && options?.actorRole === 'compliance_admin');
  const escrowReference = isEscrowed
    ? `ESCROW-CBE-${Math.random().toString(36).substring(2, 9).toUpperCase()}`
    : `REQ-RES-${Math.random().toString(36).substring(2, 9).toUpperCase()}`;

  const updatedTx: TransactionRecord = {
    ...transaction,
    status: isEscrowed ? 'deposit_escrowed' : 'deposit_pending',
    depositStatus: isEscrowed ? 'held_in_escrow' : 'payment_pending',
    paymentMethod,
    escrowReference,
    updatedAt: now,
  };

  return {
    transaction: updatedTx,
    requestReference: escrowReference,
    receiptNumber,
    escrowReference,
    timestamp: now,
  };
};

/**
 * Finalizes contract closing at the developer or Real Estate Publicity Department
 */
export const finalizeClosing = (
  transaction: TransactionRecord,
  actorRole: 'seller' | 'compliance_admin',
  deedNumber?: string
): TransactionRecord => {
  if (actorRole !== 'compliance_admin') {
    throw new Error('Unauthorized: Title deed closing and escrow release must be executed by compliance_admin.');
  }

  if (transaction.status !== 'deposit_escrowed' && transaction.status !== 'closing_scheduled') {
    throw new Error(`Cannot finalize transaction from state: ${transaction.status}`);
  }

  const now = new Date().toISOString();
  return {
    ...transaction,
    status: 'completed',
    depositStatus: 'released_to_seller',
    closingDate: now,
    updatedAt: now,
  };
};

/**
 * Handles transaction cancellation and statutory refund rules
 */
export const cancelTransaction = (
  transaction: TransactionRecord,
  cancelledBy: 'buyer' | 'seller' | 'compliance_admin',
  reason: string
): CancellationResult => {
  const isHeldInEscrow = transaction.depositStatus === 'held_in_escrow';
  let refundGranted = false;
  let refundAmount = 0;

  // Under Egyptian consumer rules:
  // If seller cancels or deal cancelled by compliance -> full refund to buyer
  // If buyer cancels without defect -> subject to platform terms
  if (cancelledBy === 'seller' || cancelledBy === 'compliance_admin') {
    refundGranted = isHeldInEscrow;
    refundAmount = isHeldInEscrow ? transaction.depositAmount : 0;
  } else {
    // Buyer cancellation
    refundGranted = isHeldInEscrow;
    refundAmount = isHeldInEscrow ? transaction.depositAmount : 0;
  }

  const now = new Date().toISOString();
  const updatedTx: TransactionRecord = {
    ...transaction,
    status: refundGranted ? 'refunded' : 'cancelled',
    depositStatus: refundGranted ? 'refunded_to_buyer' : transaction.depositStatus,
    updatedAt: now,
  };

  return {
    transaction: updatedTx,
    refundGranted,
    refundAmount,
    reason,
  };
};

/**
 * Bilingual status presentation
 */
export const getTransactionStatusLabel = (status: TransactionStatus, isRtl: boolean = false) => {
  const labels: Record<TransactionStatus, { en: string; ar: string; color: string }> = {
    offer_submitted: { en: 'Offer Submitted', ar: 'تم تقديم العرض', color: 'bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300' },
    counter_offered: { en: 'Counter Offer', ar: 'عرض مقابل للتفاوض', color: 'bg-purple-100 text-purple-700 dark:bg-purple-900/40 dark:text-purple-300' },
    offer_accepted: { en: 'Offer Accepted', ar: 'تم قبول العرض', color: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300' },
    deposit_pending: { en: 'Awaiting Deposit', ar: 'بانتظار جدية الحجز', color: 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300' },
    deposit_escrowed: { en: 'Reserved in Escrow', ar: 'محجوز رسمياً بالضمان', color: 'bg-teal-100 text-teal-700 dark:bg-teal-900/40 dark:text-teal-300' },
    contract_drafting: { en: 'Contract Drafting', ar: 'تحرير العقود', color: 'bg-indigo-100 text-indigo-700 dark:bg-indigo-900/40 dark:text-indigo-300' },
    closing_scheduled: { en: 'Closing Scheduled', ar: 'موعد الإتمام محدد', color: 'bg-cyan-100 text-cyan-700 dark:bg-cyan-900/40 dark:text-cyan-300' },
    completed: { en: 'Closed & Sold', ar: 'تمت الصفقة بنجاح (مباع)', color: 'bg-emerald-200 text-emerald-800 dark:bg-emerald-900/60 dark:text-emerald-200' },
    cancelled: { en: 'Cancelled', ar: 'ملغي', color: 'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-400' },
    refunded: { en: 'Deposit Refunded', ar: 'تم رد جدية الحجز', color: 'bg-rose-100 text-rose-700 dark:bg-rose-900/40 dark:text-rose-300' },
  };

  const item = labels[status] || { en: status, ar: status, color: 'bg-slate-100 text-slate-700' };
  return {
    label: isRtl ? item.ar : item.en,
    color: item.color,
  };
};
