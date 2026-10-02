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
  receiptNumber: string;
  escrowReference: string;
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

  return {
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
 * Places reservation deposit into secured platform escrow
 */
export const placeReservationDeposit = (
  transaction: TransactionRecord,
  paymentMethod: PaymentMethod,
  buyerId: string
): DepositPlacementResult => {
  if (transaction.buyerId !== buyerId) {
    throw new Error('Unauthorized: Only the buyer can fund this reservation deposit.');
  }

  if (transaction.status !== 'offer_accepted' && transaction.status !== 'deposit_pending') {
    throw new Error(`Cannot fund deposit when offer status is ${transaction.status}`);
  }

  const now = new Date().toISOString();
  const receiptNumber = `RCP-HET-${Date.now().toString().slice(-6)}`;
  const escrowReference = `ESCROW-CBE-${Math.random().toString(36).substring(2, 9).toUpperCase()}`;

  const updatedTx: TransactionRecord = {
    ...transaction,
    status: 'deposit_escrowed',
    depositStatus: 'held_in_escrow',
    paymentMethod,
    escrowReference,
    updatedAt: now,
  };

  return {
    transaction: updatedTx,
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
