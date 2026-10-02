import React from 'react';
import { TransactionRecord } from '../../types';
import { getTransactionStatusLabel } from '../../services/transactions/reservation-service';
import { ShieldCheck, Calendar, ArrowRight, UserCheck, CheckCircle2, XCircle } from 'lucide-react';

interface TransactionManagementCardProps {
  transaction: TransactionRecord;
  currentUserId: string;
  onAcceptOffer?: (txId: string) => void;
  onPayDeposit?: (tx: TransactionRecord) => void;
  onFinalizeClosing?: (txId: string) => void;
  onCancel?: (txId: string) => void;
  isRtl?: boolean;
}

export const TransactionManagementCard: React.FC<TransactionManagementCardProps> = ({
  transaction,
  currentUserId,
  onAcceptOffer,
  onPayDeposit,
  onFinalizeClosing,
  onCancel,
  isRtl = false,
}) => {
  const isSeller = currentUserId === transaction.sellerId;
  const isBuyer = currentUserId === transaction.buyerId;
  const statusInfo = getTransactionStatusLabel(transaction.status, isRtl);

  return (
    <div
      data-testid="transaction-management-card"
      className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-5 shadow-sm space-y-4"
      dir={isRtl ? 'rtl' : 'ltr'}
    >
      {/* Top Bar */}
      <div className="flex items-center justify-between">
        <div>
          <span className="text-[11px] font-mono text-slate-400">#{transaction.id}</span>
          <h4 className="font-bold text-sm text-slate-900 dark:text-white">
            {transaction.propertyTitle}
          </h4>
        </div>
        <span className={`text-xs px-2.5 py-1 rounded-full font-semibold ${statusInfo.color}`}>
          {statusInfo.label}
        </span>
      </div>

      {/* Financial Details */}
      <div className="grid grid-cols-2 gap-3 p-3.5 bg-slate-50 dark:bg-slate-800/50 rounded-xl text-xs">
        <div>
          <span className="text-slate-500 dark:text-slate-400 block">{isRtl ? 'السعر المتفق عليه:' : 'Agreed Price:'}</span>
          <span className="font-extrabold text-sm text-slate-900 dark:text-white">
            {transaction.agreedPrice.toLocaleString()} {transaction.currency}
          </span>
        </div>
        <div>
          <span className="text-slate-500 dark:text-slate-400 block">{isRtl ? 'جدية الحجز (الضمان):' : 'Escrow Deposit:'}</span>
          <span className="font-extrabold text-sm text-amber-600 dark:text-amber-400">
            {transaction.depositAmount.toLocaleString()} {transaction.currency} ({transaction.depositPercent}%)
          </span>
        </div>
      </div>

      {/* Counterparties */}
      <div className="flex items-center justify-between text-xs text-slate-500 dark:text-slate-400 border-t border-slate-100 dark:border-slate-800 pt-3">
        <div className="flex items-center gap-1.5">
          <UserCheck size={14} className="text-blue-500" />
          <span>{isRtl ? 'المشتري:' : 'Buyer:'} <strong className="text-slate-800 dark:text-slate-200">{transaction.buyerName}</strong></span>
        </div>
        <div>
          <span>{isRtl ? 'البائع:' : 'Seller:'} <strong className="text-slate-800 dark:text-slate-200">{transaction.sellerName}</strong></span>
        </div>
      </div>

      {/* Escrow reference if held */}
      {transaction.escrowReference && (
        <div className="flex items-center gap-2 p-2.5 rounded-lg bg-teal-500/10 border border-teal-500/20 text-xs text-teal-700 dark:text-teal-300 font-mono">
          <ShieldCheck size={16} className="shrink-0" />
          <span className="truncate">Escrow Ref: {transaction.escrowReference}</span>
        </div>
      )}

      {/* Contextual Actions */}
      <div className="flex items-center gap-2 pt-1">
        {/* Seller Actions on offer_submitted */}
        {isSeller && transaction.status === 'offer_submitted' && onAcceptOffer && (
          <button
            onClick={() => onAcceptOffer(transaction.id)}
            className="flex-1 py-2 px-3 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-xs transition-colors flex items-center justify-center gap-1.5"
          >
            <CheckCircle2 size={14} />
            <span>{isRtl ? 'قبول العرض وجدية الحجز' : 'Accept Offer'}</span>
          </button>
        )}

        {/* Buyer Action on offer_accepted */}
        {isBuyer && transaction.status === 'offer_accepted' && onPayDeposit && (
          <button
            onClick={() => onPayDeposit(transaction)}
            className="flex-1 py-2 px-3 rounded-xl bg-amber-500 hover:bg-amber-600 text-slate-950 font-bold text-xs transition-colors flex items-center justify-center gap-1.5 shadow-sm"
          >
            <ShieldCheck size={14} />
            <span>{isRtl ? 'سداد جدية الحجز في الضمان' : 'Fund Escrow Deposit'}</span>
          </button>
        )}

        {/* Finalize Closing when deposit_escrowed */}
        {transaction.status === 'deposit_escrowed' && onFinalizeClosing && (
          <button
            onClick={() => onFinalizeClosing(transaction.id)}
            className="flex-1 py-2 px-3 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-xs transition-colors flex items-center justify-center gap-1.5"
          >
            <CheckCircle2 size={14} />
            <span>{isRtl ? 'إتمام التعاقد ونقل الملكية' : 'Finalize Closing & Title Transfer'}</span>
          </button>
        )}

        {/* Cancel button if not completed/cancelled */}
        {transaction.status !== 'completed' && transaction.status !== 'cancelled' && transaction.status !== 'refunded' && onCancel && (
          <button
            onClick={() => onCancel(transaction.id)}
            className="py-2 px-3 rounded-xl border border-slate-200 dark:border-slate-800 text-slate-500 hover:text-rose-600 hover:border-rose-300 text-xs font-semibold transition-colors"
          >
            {isRtl ? 'إلغاء' : 'Cancel'}
          </button>
        )}
      </div>
    </div>
  );
};
