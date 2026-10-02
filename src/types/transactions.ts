/**
 * HETTETY Transactions & Escrow Reservation Domain Types
 * Governs buyer offers, down payments, escrow deposits (جدية الحجز), and contract closings.
 */

export type TransactionStatus =
  | 'offer_submitted'     // تم تقديم العرض
  | 'counter_offered'     // تفاوض وسعر معدل
  | 'offer_accepted'      // تم قبول العرض
  | 'deposit_pending'     // بانتظار سداد جدية الحجز
  | 'deposit_escrowed'    // تم حجز الوديعة في حساب الضمان (محجوز)
  | 'contract_drafting'   // مرحلة تحرير العقود
  | 'closing_scheduled'   // موعد إتمام البيع والشهر العقاري
  | 'completed'           // تم إتمام الصفقة ونقل الملكية (مباع)
  | 'cancelled'           // ملغي
  | 'refunded';           // مسترد بالكامل

export type PaymentMethod = 'bank_transfer' | 'instapay' | 'credit_card' | 'fawry' | 'cheque';

export type EscrowAccountType =
  | 'hettety_secure_escrow'
  | 'bank_trust_account'
  | 'developer_official_escrow';

export interface PaymentMilestone {
  milestone: string;
  milestoneAr: string;
  amount: number;
  dueDate: string;
  isPaid: boolean;
  paymentReference?: string;
}

export interface ContractTerms {
  paymentSchedule: PaymentMilestone[];
  contingencies: string[];
  contingenciesAr: string[];
  handoverDate: string;
  specialConditions?: string;
}

export interface TransactionRecord {
  id: string;
  propertyId: string;
  propertyTitle: string;
  buyerId: string;
  buyerName: string;
  buyerPhone: string;
  sellerId: string;
  sellerName: string;
  agentId?: string;
  agreedPrice: number;
  currency: 'EGP' | 'USD';
  depositAmount: number;
  depositPercent: number; // e.g. 5%
  depositStatus: 'unpaid' | 'held_in_escrow' | 'released_to_seller' | 'refunded_to_buyer';
  paymentMethod?: PaymentMethod;
  escrowReference?: string;
  status: TransactionStatus;
  idempotencyKey: string;
  contractTerms?: ContractTerms;
  closingDate?: string;
  createdAt: string;
  updatedAt: string;
}
