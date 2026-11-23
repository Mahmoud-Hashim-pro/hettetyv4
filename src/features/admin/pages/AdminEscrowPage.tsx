import React, { useMemo, useState } from 'react';
import {
  Landmark,
  Download,
  Search,
  CheckCircle2,
  XCircle,
  Clock,
  ShieldCheck,
  ShoppingBag,
  ArrowRight,
  ArrowLeft,
  Loader2,
} from 'lucide-react';
import {
  AdminPurchaseRecord,
  Property,
  TransactionRecord,
  UserAccountRecord,
} from '../types';

export interface AdminEscrowPageProps {
  isRtl: boolean;
  transactions: TransactionRecord[];
  purchases: AdminPurchaseRecord[];
  properties: Property[];
  users: UserAccountRecord[];
  busyId: string | null;
  onUpdatePurchase: (purchaseId: string, status: 'completed' | 'cancelled' | 'processing') => Promise<void>;
  onUpdateTransaction: (
    tx: TransactionRecord,
    nextStatus: TransactionRecord['status'],
    nextDepositStatus?: TransactionRecord['depositStatus'],
    escrowRef?: string
  ) => Promise<void>;
}

const ESCROW_STEPS: { id: TransactionRecord['status']; en: string; ar: string }[] = [
  { id: 'offer_submitted', en: 'Offer', ar: 'عرض' },
  { id: 'offer_accepted', en: 'Accepted', ar: 'مقبول' },
  { id: 'deposit_pending', en: 'Deposit Due', ar: 'بانتظار الجدية' },
  { id: 'deposit_escrowed', en: 'Escrowed', ar: 'في الضمان' },
  { id: 'completed', en: 'Settled', ar: 'مكتمل' },
];

export const AdminEscrowPage: React.FC<AdminEscrowPageProps> = ({
  isRtl,
  transactions,
  purchases,
  properties,
  users,
  busyId,
  onUpdatePurchase,
  onUpdateTransaction,
}) => {
  const [subTab, setSubTab] = useState<'escrow' | 'purchases'>('escrow');
  const [filter, setFilter] = useState<'all' | 'active' | 'pending' | 'settled' | 'cancelled'>('all');
  const [search, setSearch] = useState('');
  const ArrowStep = isRtl ? ArrowLeft : ArrowRight;

  const propTitle = (id: string, fallback?: string) =>
    properties.find((p) => p.id === id)?.title || fallback || `#${id.slice(0, 8)}`;

  const buyerEmail = (uid?: string, fallback?: string) => {
    if (fallback) return fallback;
    if (!uid) return '—';
    return users.find((u) => u.id === uid || u.uid === uid)?.email || `#${uid.slice(0, 8)}`;
  };

  const activeEscrowVolume = useMemo(() => {
    return transactions
      .filter((t) => ['deposit_escrowed', 'deposit_pending', 'contract_drafting', 'closing_scheduled'].includes(t.status))
      .reduce((acc, tx) => acc + (tx.currency === 'USD' ? tx.depositAmount * 50 : tx.depositAmount), 0);
  }, [transactions]);

  const settledVolume = useMemo(() => {
    return transactions
      .filter((t) => t.status === 'completed')
      .reduce((acc, tx) => acc + (tx.currency === 'USD' ? tx.agreedPrice * 50 : tx.agreedPrice), 0);
  }, [transactions]);

  const openPurchasesCount = purchases.filter((p) => p.status === 'processing').length;

  const filteredTransactions = useMemo(() => {
    const q = search.trim().toLowerCase();
    return transactions.filter((tx) => {
      if (filter === 'active' && !['deposit_escrowed', 'contract_drafting', 'closing_scheduled'].includes(tx.status)) return false;
      if (filter === 'pending' && !['offer_submitted', 'counter_offered', 'offer_accepted', 'deposit_pending'].includes(tx.status)) return false;
      if (filter === 'settled' && tx.status !== 'completed') return false;
      if (filter === 'cancelled' && tx.status !== 'cancelled' && tx.status !== 'refunded') return false;
      if (q) {
        const hay = `${tx.id} ${tx.propertyTitle} ${tx.buyerName} ${tx.sellerName} ${tx.escrowReference || ''}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [transactions, filter, search]);

  const filteredPurchases = useMemo(() => {
    const q = search.trim().toLowerCase();
    return purchases.filter((p) => {
      if (filter === 'pending' && p.status !== 'processing') return false;
      if (filter === 'active' && p.status !== 'processing') return false;
      if (filter === 'settled' && p.status !== 'completed') return false;
      if (filter === 'cancelled' && p.status !== 'cancelled') return false;
      if (q) {
        const title = propTitle(p.propertyId);
        const email = buyerEmail(p.userId, p.buyerEmail);
        if (!`${p.id} ${title} ${email}`.toLowerCase().includes(q)) return false;
      }
      return true;
    });
  }, [purchases, filter, search, properties, users]);

  const exportCsv = () => {
    const rows: string[][] = [
      ['Type', 'ID', 'Property', 'Buyer', 'Amount', 'Currency', 'Status', 'Escrow Reference', 'Date'],
    ];
    for (const tx of transactions) {
      rows.push([
        'Escrow',
        tx.id,
        tx.propertyTitle,
        tx.buyerName,
        String(tx.agreedPrice),
        tx.currency,
        tx.status,
        tx.escrowReference || '',
        tx.updatedAt || tx.createdAt,
      ]);
    }
    for (const p of purchases) {
      rows.push([
        'Purchase',
        p.id,
        propTitle(p.propertyId),
        buyerEmail(p.userId, p.buyerEmail),
        String(p.amount || ''),
        p.currency || 'EGP',
        p.status,
        '',
        p.purchaseDate || p.createdAt || '',
      ]);
    }
    const csvContent =
      '\uFEFF' +
      rows
        .map((r) => r.map((cell) => `"${String(cell ?? '').replace(/"/g, '""')}"`).join(','))
        .join('\n');

    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `hettety-escrow-deals-${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  const stepIndex = (st: TransactionRecord['status']) => {
    if (st === 'offer_submitted' || st === 'counter_offered') return 0;
    if (st === 'offer_accepted') return 1;
    if (st === 'deposit_pending') return 2;
    if (st === 'deposit_escrowed' || st === 'contract_drafting' || st === 'closing_scheduled') return 3;
    if (st === 'completed') return 4;
    return -1;
  };

  return (
    <div className="space-y-6 animate-fade-in" data-testid="admin-escrow-page">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-black text-slate-900 dark:text-white flex items-center gap-2.5">
            <Landmark className="text-accent-500" size={24} />
            {isRtl ? 'مكتب الضمان المالي وتسوية الصفقات (Escrow)' : 'Financial Escrow & Deals Settlement Desk'}
          </h1>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
            {isRtl
              ? 'إدارة ودائع جدية الحجز وحسابات الضمان وطلبات الشراء المباشرة مع تصدير فوري للتقارير'
              : 'Authoritative management of CBE-aligned escrow deposits, offers & direct purchase requests with CSV reporting'}
          </p>
        </div>

        <button
          type="button"
          onClick={exportCsv}
          className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-brand-600 hover:bg-brand-700 text-white text-xs font-bold shadow-sm transition-all cursor-pointer"
        >
          <Download size={15} />
          {isRtl ? 'تصدير CSV' : 'Export CSV'}
        </button>
      </div>

      {/* Financial KPI Row */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200/80 dark:border-slate-800 p-5 shadow-xs">
          <div className="text-xs font-semibold text-slate-500 dark:text-slate-400">
            {isRtl ? 'السيولة المحتجزة في الضمان' : 'Active Escrow Liquidity'}
          </div>
          <div className="text-2xl font-black font-mono text-teal-600 dark:text-teal-400 mt-1.5">
            {(activeEscrowVolume / 1_000_000).toFixed(2)}M <span className="text-xs font-semibold text-slate-400">EGP</span>
          </div>
        </div>

        <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200/80 dark:border-slate-800 p-5 shadow-xs">
          <div className="text-xs font-semibold text-slate-500 dark:text-slate-400">
            {isRtl ? 'إجمالي صفقات الضمان' : 'Formal Escrow Transactions'}
          </div>
          <div className="text-2xl font-black font-mono text-slate-900 dark:text-white mt-1.5">
            {transactions.length}
          </div>
        </div>

        <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200/80 dark:border-slate-800 p-5 shadow-xs">
          <div className="text-xs font-semibold text-slate-500 dark:text-slate-400">
            {isRtl ? 'طلبات شراء قيد التنفيذ' : 'Open Purchase Requests'}
          </div>
          <div className="text-2xl font-black font-mono text-accent-600 dark:text-accent-400 mt-1.5">
            {openPurchasesCount}
          </div>
        </div>

        <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200/80 dark:border-slate-800 p-5 shadow-xs">
          <div className="text-xs font-semibold text-slate-500 dark:text-slate-400">
            {isRtl ? 'حجم الصفقات المكتملة' : 'Settled Deals Volume'}
          </div>
          <div className="text-2xl font-black font-mono text-emerald-600 dark:text-emerald-400 mt-1.5">
            {(settledVolume / 1_000_000).toFixed(2)}M <span className="text-xs font-semibold text-slate-400">EGP</span>
          </div>
        </div>
      </div>

      {/* Tabs + Filters */}
      <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200/80 dark:border-slate-800 p-4 shadow-xs flex flex-col lg:flex-row lg:items-center justify-between gap-4">
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => setSubTab('escrow')}
            className={`px-4 py-2 rounded-xl text-xs font-bold inline-flex items-center gap-2 cursor-pointer ${
              subTab === 'escrow'
                ? 'bg-brand-600 text-white'
                : 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300'
            }`}
          >
            <ShieldCheck size={14} />
            {isRtl ? `صفقات الضمان (${transactions.length})` : `Escrow Transactions (${transactions.length})`}
          </button>
          <button
            type="button"
            onClick={() => setSubTab('purchases')}
            className={`px-4 py-2 rounded-xl text-xs font-bold inline-flex items-center gap-2 cursor-pointer ${
              subTab === 'purchases'
                ? 'bg-brand-600 text-white'
                : 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300'
            }`}
          >
            <ShoppingBag size={14} />
            {isRtl ? `طلبات الشراء (${purchases.length})` : `Purchase Requests (${purchases.length})`}
          </button>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <div className="relative">
            <Search size={14} className="absolute start-3 top-1/2 -translate-y-1/2 text-slate-400" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={isRtl ? 'بحث برقم الصفقة أو العقار...' : 'Search ID, property, buyer...'}
              className="ps-9 pe-3 py-2 rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-xs w-56"
            />
          </div>
          {(['all', 'pending', 'active', 'settled', 'cancelled'] as const).map((f) => (
            <button
              key={f}
              type="button"
              onClick={() => setFilter(f)}
              className={`px-3 py-1.5 rounded-lg text-[11px] font-bold cursor-pointer ${
                filter === f
                  ? 'bg-accent-500 text-white'
                  : 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300'
              }`}
            >
              {f === 'all'
                ? isRtl ? 'الكل' : 'All'
                : f === 'pending'
                ? isRtl ? 'قيد الانتظار' : 'Pending'
                : f === 'active'
                ? isRtl ? 'في الضمان' : 'In Escrow'
                : f === 'settled'
                ? isRtl ? 'مكتمل' : 'Settled'
                : isRtl ? 'ملغي' : 'Cancelled'}
            </button>
          ))}
        </div>
      </div>

      {/* Main Content */}
      {subTab === 'escrow' ? (
        filteredTransactions.length === 0 ? (
          <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 py-16 text-center space-y-2">
            <Landmark size={36} className="text-slate-300 dark:text-slate-700 mx-auto" />
            <h3 className="text-base font-bold text-slate-800 dark:text-slate-200">
              {isRtl ? 'لا توجد صفقات ضمان في هذا التصنيف' : 'No escrow transactions in this view'}
            </h3>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              {isRtl
                ? 'عندما يقدم المشترون عروض حجز عبر حساب الضمان ستظهر مراحلها هنا.'
                : 'Formal buyer offers and escrow reservation deposits will appear here with step-by-step settlement controls.'}
            </p>
          </div>
        ) : (
          <div className="space-y-4">
            {filteredTransactions.map((tx) => {
              const curIdx = stepIndex(tx.status);
              const isBusy = busyId === tx.id;
              return (
                <div
                  key={tx.id}
                  className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200/80 dark:border-slate-800 p-5 shadow-xs space-y-4"
                >
                  <div className="flex flex-col md:flex-row md:items-center justify-between gap-3">
                    <div>
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-bold text-sm text-slate-900 dark:text-white">
                          {tx.propertyTitle || propTitle(tx.propertyId)}
                        </span>
                        <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-slate-100 dark:bg-slate-800 text-slate-500">
                          {tx.id}
                        </span>
                        {tx.escrowReference && (
                          <span className="text-[10px] font-mono font-bold px-2 py-0.5 rounded bg-teal-100 text-teal-700 dark:bg-teal-950/50 dark:text-teal-300">
                            REF: {tx.escrowReference}
                          </span>
                        )}
                      </div>
                      <div className="text-xs text-slate-500 dark:text-slate-400 mt-1">
                        {isRtl ? 'المشتري:' : 'Buyer:'} <strong className="text-slate-800 dark:text-slate-200">{tx.buyerName}</strong> ({tx.buyerPhone || '—'}) • {isRtl ? 'البائع:' : 'Seller:'} <strong className="text-slate-800 dark:text-slate-200">{tx.sellerName}</strong>
                      </div>
                    </div>

                    <div className="text-end">
                      <div className="text-base font-black font-mono text-slate-900 dark:text-white">
                        {tx.agreedPrice.toLocaleString()} {tx.currency}
                      </div>
                      <div className="text-[11px] font-bold text-teal-600 dark:text-teal-400">
                        {isRtl ? 'جدية الحجز:' : 'Escrow Deposit:'} {tx.depositAmount.toLocaleString()} {tx.currency} ({tx.depositPercent}%)
                      </div>
                    </div>
                  </div>

                  {/* Pipeline Stepper */}
                  <div className="flex items-center gap-1.5 overflow-x-auto py-1">
                    {ESCROW_STEPS.map((st, idx) => {
                      const done = curIdx >= idx;
                      return (
                        <React.Fragment key={st.id}>
                          <div
                            className={`px-3 py-1.5 rounded-lg text-[11px] font-bold shrink-0 ${
                              tx.status === 'cancelled' || tx.status === 'refunded'
                                ? 'bg-rose-50 dark:bg-rose-950/30 text-rose-500'
                                : done
                                ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950/50 dark:text-emerald-300'
                                : 'bg-slate-100 text-slate-400 dark:bg-slate-800'
                            }`}
                          >
                            {isRtl ? st.ar : st.en}
                          </div>
                          {idx < ESCROW_STEPS.length - 1 && (
                            <ArrowStep size={13} className="text-slate-300 dark:text-slate-700 shrink-0" />
                          )}
                        </React.Fragment>
                      );
                    })}
                  </div>

                  {/* Admin Controls */}
                  <div className="flex flex-wrap items-center justify-between gap-2 pt-3 border-t border-slate-100 dark:border-slate-800">
                    <span className="text-[11px] text-slate-400 font-mono">
                      {isRtl ? 'الحالة:' : 'Status:'} <strong>{tx.status}</strong> • {isRtl ? 'الوديعة:' : 'Deposit:'} <strong>{tx.depositStatus}</strong>
                    </span>

                    <div className="flex flex-wrap items-center gap-2">
                      {isBusy && <Loader2 size={14} className="animate-spin text-accent-500" />}
                      {(tx.status === 'offer_submitted' || tx.status === 'counter_offered') && (
                        <button
                          type="button"
                          disabled={isBusy}
                          onClick={() => onUpdateTransaction(tx, 'offer_accepted')}
                          className="px-3 py-1.5 rounded-lg bg-brand-600 hover:bg-brand-700 text-white text-xs font-bold cursor-pointer"
                        >
                          {isRtl ? 'قبول العرض' : 'Accept Offer'}
                        </button>
                      )}
                      {(tx.status === 'offer_accepted' || tx.status === 'deposit_pending') && (
                        <button
                          type="button"
                          disabled={isBusy}
                          onClick={() =>
                            onUpdateTransaction(
                              tx,
                              'deposit_escrowed',
                              'held_in_escrow',
                              tx.escrowReference || `ESC-CBE-${Date.now().toString().slice(-6)}`
                            )
                          }
                          className="px-3 py-1.5 rounded-lg bg-teal-600 hover:bg-teal-700 text-white text-xs font-bold cursor-pointer"
                        >
                          {isRtl ? 'تأكيد استلام الضمان' : 'Confirm Escrow Deposit'}
                        </button>
                      )}
                      {['deposit_escrowed', 'contract_drafting', 'closing_scheduled'].includes(tx.status) && (
                        <button
                          type="button"
                          disabled={isBusy}
                          onClick={() => onUpdateTransaction(tx, 'completed', 'released_to_seller')}
                          className="px-3 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold cursor-pointer"
                        >
                          {isRtl ? 'إتمام التسوية ونقل الملكية' : 'Mark Settled'}
                        </button>
                      )}
                      {tx.status !== 'completed' && tx.status !== 'cancelled' && (
                        <button
                          type="button"
                          disabled={isBusy}
                          onClick={() => onUpdateTransaction(tx, 'cancelled', 'refunded_to_buyer')}
                          className="px-3 py-1.5 rounded-lg bg-rose-50 dark:bg-rose-950/40 text-rose-700 dark:text-rose-300 hover:bg-rose-100 text-xs font-bold cursor-pointer"
                        >
                          {isRtl ? 'إلغاء / استرداد' : 'Cancel / Refund'}
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )
      ) : (
        /* Direct Purchase Requests Table */
        <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200/80 dark:border-slate-800 overflow-hidden shadow-xs">
          {filteredPurchases.length === 0 ? (
            <div className="py-16 text-center space-y-2">
              <ShoppingBag size={34} className="text-slate-300 dark:text-slate-700 mx-auto" />
              <p className="text-sm font-bold text-slate-700 dark:text-slate-200">
                {isRtl ? 'لا توجد طلبات شراء مسجلة' : 'No purchase requests found'}
              </p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-xs text-start">
                <thead className="bg-slate-50 dark:bg-slate-800/60 text-slate-500 dark:text-slate-400 font-bold border-b border-slate-100 dark:border-slate-800">
                  <tr>
                    <th className="py-3.5 px-4">{isRtl ? 'العقار' : 'Property'}</th>
                    <th className="py-3.5 px-4">{isRtl ? 'المشتري' : 'Buyer'}</th>
                    <th className="py-3.5 px-4">{isRtl ? 'التاريخ' : 'Date'}</th>
                    <th className="py-3.5 px-4">{isRtl ? 'الحالة' : 'Status'}</th>
                    <th className="py-3.5 px-4 text-end">{isRtl ? 'إجراءات' : 'Actions'}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                  {filteredPurchases.map((p) => {
                    const isBusy = busyId === p.id;
                    return (
                      <tr key={p.id} className="hover:bg-slate-50/70 dark:hover:bg-slate-800/30">
                        <td className="py-3.5 px-4 font-bold text-slate-900 dark:text-white">
                          {propTitle(p.propertyId)}
                        </td>
                        <td className="py-3.5 px-4 text-slate-600 dark:text-slate-300">
                          {buyerEmail(p.userId, p.buyerEmail)}
                        </td>
                        <td className="py-3.5 px-4 font-mono text-slate-500">
                          {p.purchaseDate || p.createdAt || '—'}
                        </td>
                        <td className="py-3.5 px-4">
                          <span
                            className={`inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[10px] font-bold ${
                              p.status === 'completed'
                                ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950/50 dark:text-emerald-300'
                                : p.status === 'cancelled'
                                ? 'bg-rose-100 text-rose-700 dark:bg-rose-950/50 dark:text-rose-300'
                                : 'bg-amber-100 text-amber-700 dark:bg-amber-950/50 dark:text-amber-300'
                            }`}
                          >
                            {p.status === 'completed' ? (
                              <CheckCircle2 size={11} />
                            ) : p.status === 'cancelled' ? (
                              <XCircle size={11} />
                            ) : (
                              <Clock size={11} />
                            )}
                            {p.status}
                          </span>
                        </td>
                        <td className="py-3.5 px-4 text-end">
                          <div className="inline-flex items-center gap-1.5">
                            {p.status !== 'completed' && (
                              <button
                                type="button"
                                disabled={isBusy}
                                onClick={() => onUpdatePurchase(p.id, 'completed')}
                                className="px-2.5 py-1 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-[11px] font-bold cursor-pointer disabled:opacity-50"
                              >
                                {isRtl ? 'إتمام' : 'Complete'}
                              </button>
                            )}
                            {p.status !== 'cancelled' && (
                              <button
                                type="button"
                                disabled={isBusy}
                                onClick={() => onUpdatePurchase(p.id, 'cancelled')}
                                className="px-2.5 py-1 rounded-lg bg-rose-50 dark:bg-rose-950/40 text-rose-700 dark:text-rose-300 hover:bg-rose-100 text-[11px] font-bold cursor-pointer disabled:opacity-50"
                              >
                                {isRtl ? 'إلغاء' : 'Cancel'}
                              </button>
                            )}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </div>
  );
};
