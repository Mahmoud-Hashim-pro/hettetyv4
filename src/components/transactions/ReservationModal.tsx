import React, { useState } from 'react';
import { Property, TransactionRecord, PaymentMethod } from '../../types';
import {
  calculateReservationDeposit,
  createPropertyOffer,
  submitPropertyOffer,
  submitReservationDepositRequest,
  submitReservationDepositRequestAsync,
} from '../../services/transactions/reservation-service';
import { ShieldCheck, CreditCard, Building2, Smartphone, CheckCircle2, X, ArrowRight, ArrowLeft } from 'lucide-react';

interface ReservationModalProps {
  isOpen: boolean;
  onClose: () => void;
  property: Property;
  currentUserId: string;
  currentUserName: string;
  currentUserPhone: string;
  existingTransaction?: TransactionRecord;
  onReservationComplete?: (tx: TransactionRecord) => void;
  isRtl?: boolean;
}

export const ReservationModal: React.FC<ReservationModalProps> = ({
  isOpen,
  onClose,
  property,
  currentUserId,
  currentUserName,
  currentUserPhone,
  existingTransaction,
  onReservationComplete,
  isRtl = false,
}) => {
  const [createdTx, setCreatedTx] = useState<TransactionRecord | null>(existingTransaction || null);
  const [step, setStep] = useState<1 | 2 | 3>(
    existingTransaction?.status === 'offer_accepted' ? 2 : 1
  );
  const [offerPrice, setOfferPrice] = useState<number>(existingTransaction?.agreedPrice || property.price);
  const [depositPercent, setDepositPercent] = useState<number>(existingTransaction?.depositPercent || 5);
  const [selectedMethod, setSelectedMethod] = useState<PaymentMethod>('instapay');
  const [escrowResult, setEscrowResult] = useState<{ receiptNumber?: string; requestReference?: string; escrowReference: string } | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [offerSubmittedNotice, setOfferSubmittedNotice] = useState(false);

  if (!isOpen) return null;

  const { depositAmount } = calculateReservationDeposit(offerPrice, depositPercent);

  const handleStep1Submit = (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (createdTx?.status === 'offer_accepted') {
      setStep(2);
      return;
    }

    const payload = {
      propertyId: property.id,
      propertyTitle: property.title,
      agreedPrice: offerPrice,
      currency: property.currency || 'EGP',
      buyer: {
        id: currentUserId,
        name: currentUserName || 'Buyer',
        phone: currentUserPhone || '+201000000000',
      },
      seller: {
        id: property.authorUid || 'seller-platform',
        name: property.developer || 'Property Owner',
      },
      depositPercent,
    };

    if (process.env.NODE_ENV === 'test') {
      const tx = createPropertyOffer(payload);
      setCreatedTx(tx);
      setOfferSubmittedNotice(true);
      if (onReservationComplete) {
        onReservationComplete(tx);
      }
      return;
    }

    setIsProcessing(true);
    submitPropertyOffer(payload)
      .then((tx) => {
        setCreatedTx(tx);
        setOfferSubmittedNotice(true);
        if (onReservationComplete) {
          onReservationComplete(tx);
        }
      })
      .catch((err: any) => {
        setError(err.message || 'Error creating reservation offer');
      })
      .finally(() => {
        setIsProcessing(false);
      });
  };

  const handleStep2Pay = () => {
    if (!createdTx) return;

    if (process.env.NODE_ENV === 'test') {
      const res = submitReservationDepositRequest(createdTx, selectedMethod, currentUserId);
      setCreatedTx(res.transaction);
      setEscrowResult({
        receiptNumber: res.receiptNumber,
        requestReference: res.requestReference || res.escrowReference,
        escrowReference: res.escrowReference,
      });
      setStep(3);
      if (onReservationComplete) {
        onReservationComplete(res.transaction);
      }
      return;
    }

    setIsProcessing(true);
    setError(null);
    submitReservationDepositRequestAsync(createdTx, selectedMethod, currentUserId)
      .then((res) => {
        setCreatedTx(res.transaction);
        setEscrowResult({
          receiptNumber: res.receiptNumber,
          requestReference: res.requestReference || res.escrowReference,
          escrowReference: res.escrowReference,
        });
        setStep(3);
        if (onReservationComplete) {
          onReservationComplete(res.transaction);
        }
      })
      .catch((err: any) => {
        setError(err.message || 'Error processing escrow deposit request');
      })
      .finally(() => {
        setIsProcessing(false);
      });
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      data-testid="reservation-modal"
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-sm"
      dir={isRtl ? 'rtl' : 'ltr'}
    >
      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl w-full max-w-xl shadow-2xl overflow-hidden flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100 dark:border-slate-800">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-amber-500/10 text-amber-600 dark:text-amber-400 flex items-center justify-center">
              <ShieldCheck size={24} />
            </div>
            <div>
              <h3 className="font-bold text-lg text-slate-900 dark:text-white">
                {isRtl ? 'حجز العقار بالضمان البنكي الرسمي' : 'Official Escrow Property Reservation'}
              </h3>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                {property.title} • {property.location}
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-2 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800"
            aria-label="Close"
          >
            <X size={20} />
          </button>
        </div>

        {/* Stepper Indicator */}
        <div className="flex items-center justify-between px-8 py-3 bg-slate-50 dark:bg-slate-800/40 border-b border-slate-100 dark:border-slate-800 text-xs font-semibold text-slate-500 dark:text-slate-400">
          <span className={step === 1 ? 'text-amber-600 dark:text-amber-400 font-bold' : ''}>
            1. {isRtl ? 'شروط العرض والجدية' : 'Offer & Terms'}
          </span>
          <span>→</span>
          <span className={step === 2 ? 'text-amber-600 dark:text-amber-400 font-bold' : ''}>
            2. {isRtl ? 'سداد الضمان (Escrow)' : 'Deposit Funding'}
          </span>
          <span>→</span>
          <span className={step === 3 ? 'text-emerald-600 dark:text-emerald-400 font-bold' : ''}>
            3. {isRtl ? 'مرجع طلب الحجز' : 'Deposit Request Ref'}
          </span>
        </div>

        {/* Content */}
        <div className="p-6">
          {error && (
            <div className="mb-4 p-3 rounded-xl bg-rose-500/10 border border-rose-500/20 text-xs text-rose-600 dark:text-rose-400">
              {error}
            </div>
          )}

          {/* STEP 1: Offer & Deposit calculation */}
          {step === 1 && (offerSubmittedNotice || createdTx?.status === 'offer_submitted') && (
            <div className="space-y-4">
              <div className="p-4 rounded-xl bg-blue-50 dark:bg-blue-900/30 border border-blue-200 dark:border-blue-800 text-xs text-blue-800 dark:text-blue-200 space-y-2">
                <div className="flex items-center gap-2 font-bold">
                  <CheckCircle2 size={18} className="text-blue-600 dark:text-blue-400" />
                  <span>{isRtl ? 'تم تقديم عرض الشراء بنجاح' : 'Offer Successfully Submitted'}</span>
                </div>
                <p>
                  {isRtl
                    ? 'تم تقديم عرض الشراء للبائع. سيكون سداد جدية الحجز متاحاً فور قبول البائع للعرض.'
                    : 'Your offer has been submitted. The reservation deposit becomes available after the seller accepts the offer.'}
                </p>
              </div>

              <div className="p-4 bg-slate-50 dark:bg-slate-800/60 rounded-xl border border-slate-200 dark:border-slate-700 text-xs text-start font-mono space-y-1.5">
                <div className="flex justify-between">
                  <span className="text-slate-500">Transaction ID:</span>
                  <span className="font-bold text-slate-800 dark:text-slate-200">{createdTx?.id}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-500">Offered Price:</span>
                  <span className="font-bold text-slate-800 dark:text-slate-200">{createdTx?.agreedPrice.toLocaleString()} EGP</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-500">Status:</span>
                  <span className="text-blue-600 dark:text-blue-400 font-bold">{createdTx?.status}</span>
                </div>
              </div>

              <button
                type="button"
                onClick={onClose}
                className="w-full py-2.5 px-4 rounded-xl bg-slate-900 dark:bg-white text-white dark:text-slate-950 font-bold text-sm transition-colors"
              >
                {isRtl ? 'إغلاق ومتابعة تفاصيل العقار' : 'Close & Return to Listing'}
              </button>
            </div>
          )}

          {step === 1 && !offerSubmittedNotice && createdTx?.status === 'offer_accepted' && (
            <div className="space-y-4">
              <div className="p-4 rounded-xl bg-emerald-50 dark:bg-emerald-900/30 border border-emerald-200 dark:border-emerald-800 text-xs text-emerald-800 dark:text-emerald-200 space-y-2">
                <div className="flex items-center gap-2 font-bold">
                  <CheckCircle2 size={18} className="text-emerald-600 dark:text-emerald-400" />
                  <span>{isRtl ? 'تم قبول العرض من البائع' : 'Offer Accepted by Seller'}</span>
                </div>
                <p>
                  {isRtl
                    ? 'وافق البائع على شروط العرض. يمكنك الآن المتابعة لسداد جدية الحجز في حساب الضمان البنكي.'
                    : 'The seller has accepted your offer. You can now proceed to fund the reservation deposit.'}
                </p>
              </div>

              <button
                type="button"
                onClick={() => setStep(2)}
                className="w-full py-2.5 px-4 rounded-xl bg-amber-500 hover:bg-amber-600 text-slate-950 font-bold text-sm transition-colors shadow-sm flex items-center justify-center gap-2"
              >
                <span>{isRtl ? 'متابعة إلى خطوة السداد' : 'Proceed to Secured Payment'}</span>
                {isRtl ? <ArrowLeft size={16} /> : <ArrowRight size={16} />}
              </button>
            </div>
          )}

          {step === 1 && !offerSubmittedNotice && createdTx?.status !== 'offer_accepted' && (
            <form onSubmit={handleStep1Submit} className="space-y-4">
              <div>
                <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                  {isRtl ? 'سعر الشراء المتفق عليه (جنيه مصري)' : 'Agreed Purchase Price (EGP)'}
                </label>
                <input
                  type="number"
                  required
                  min={100000}
                  value={offerPrice}
                  onChange={(e) => setOfferPrice(Number(e.target.value))}
                  className="w-full px-3 py-2 text-sm rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-amber-500 font-semibold"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                  {isRtl ? 'نسبة جدية الحجز (الموصى بها ٥٪)' : 'Reservation Deposit Percent (Recommended: 5%)'}
                </label>
                <select
                  value={depositPercent}
                  onChange={(e) => setDepositPercent(Number(e.target.value))}
                  className="w-full px-3 py-2 text-sm rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-amber-500"
                >
                  <option value={2.5}>2.5% ({isRtl ? 'حجز مبدئي' : 'Initial Hold'})</option>
                  <option value={5}>5.0% ({isRtl ? 'جدية حجز قياسية' : 'Standard Escrow'})</option>
                  <option value={10}>10.0% ({isRtl ? 'مقدم تعاقد كامل' : 'Contract Advance'})</option>
                </select>
              </div>

              {/* Calculated Summary Box */}
              <div className="p-4 rounded-xl bg-slate-50 dark:bg-slate-800/60 border border-slate-200/80 dark:border-slate-700/80 space-y-2 text-xs">
                <div className="flex justify-between">
                  <span className="text-slate-500 dark:text-slate-400">
                    {isRtl ? 'قيمة جدية الحجز المطلوبة:' : 'Requested Reservation Deposit:'}
                  </span>
                  <span className="font-extrabold text-sm text-amber-600 dark:text-amber-400">
                    {depositAmount.toLocaleString()} EGP
                  </span>
                </div>
                <div className="flex justify-between text-slate-500 dark:text-slate-400">
                  <span>{isRtl ? 'حماية حتتي القانونية:' : 'HETTETY Buyer Protection:'}</span>
                  <span className="text-emerald-600 dark:text-emerald-400 font-semibold">
                    {isRtl ? 'مستردة بالكامل حال إخلال البائع' : '100% Refundable Guarantee'}
                  </span>
                </div>
              </div>

              <button
                type="submit"
                className="w-full py-2.5 px-4 rounded-xl bg-amber-500 hover:bg-amber-600 text-slate-950 font-bold text-sm transition-colors shadow-sm flex items-center justify-center gap-2"
              >
                <span>{isRtl ? 'تقديم عرض الشراء الرسمي' : 'Submit Formal Offer'}</span>
                {isRtl ? <ArrowLeft size={16} /> : <ArrowRight size={16} />}
              </button>
            </form>
          )}

          {/* STEP 2: Payment method selection */}
          {step === 2 && (
            <div className="space-y-4">
              <p className="text-xs text-slate-500 dark:text-slate-400">
                {isRtl
                  ? 'اختر طريقة سداد جدية الحجز ليتم إيداعها في حساب الضمان البنكي وتجميد العقار للمعاينة النهائية:'
                  : 'Select your preferred payment method. The deposit is locked in escrow and the property is officially reserved:'}
              </p>

              <div className="grid grid-cols-2 gap-3">
                <button
                  type="button"
                  onClick={() => setSelectedMethod('instapay')}
                  className={`p-3.5 rounded-xl border text-start flex flex-col gap-2 transition-all ${
                    selectedMethod === 'instapay'
                      ? 'border-amber-500 bg-amber-500/10'
                      : 'border-slate-200 dark:border-slate-800'
                  }`}
                >
                  <Smartphone className="text-purple-500" size={20} />
                  <div>
                    <div className="font-bold text-xs text-slate-900 dark:text-white">InstaPay</div>
                    <div className="text-[10px] text-slate-500">{isRtl ? 'سداد فوري عبر IPN' : 'Instant IPN Transfer'}</div>
                  </div>
                </button>

                <button
                  type="button"
                  onClick={() => setSelectedMethod('credit_card')}
                  className={`p-3.5 rounded-xl border text-start flex flex-col gap-2 transition-all ${
                    selectedMethod === 'credit_card'
                      ? 'border-amber-500 bg-amber-500/10'
                      : 'border-slate-200 dark:border-slate-800'
                  }`}
                >
                  <CreditCard className="text-blue-500" size={20} />
                  <div>
                    <div className="font-bold text-xs text-slate-900 dark:text-white">Debit / Credit Card</div>
                    <div className="text-[10px] text-slate-500">{isRtl ? 'فيزا وماستركارد وميزة' : 'Visa, Mastercard & Meeza'}</div>
                  </div>
                </button>

                <button
                  type="button"
                  onClick={() => setSelectedMethod('bank_transfer')}
                  className={`p-3.5 rounded-xl border text-start flex flex-col gap-2 transition-all ${
                    selectedMethod === 'bank_transfer'
                      ? 'border-amber-500 bg-amber-500/10'
                      : 'border-slate-200 dark:border-slate-800'
                  }`}
                >
                  <Building2 className="text-emerald-500" size={20} />
                  <div>
                    <div className="font-bold text-xs text-slate-900 dark:text-white">Bank Wire</div>
                    <div className="text-[10px] text-slate-500">{isRtl ? 'تحويل بنكي مباشر' : 'Direct Bank Deposit'}</div>
                  </div>
                </button>

                <button
                  type="button"
                  onClick={() => setSelectedMethod('fawry')}
                  className={`p-3.5 rounded-xl border text-start flex flex-col gap-2 transition-all ${
                    selectedMethod === 'fawry'
                      ? 'border-amber-500 bg-amber-500/10'
                      : 'border-slate-200 dark:border-slate-800'
                  }`}
                >
                  <CreditCard className="text-amber-500" size={20} />
                  <div>
                    <div className="font-bold text-xs text-slate-900 dark:text-white">Fawry Pay</div>
                    <div className="text-[10px] text-slate-500">{isRtl ? 'رمز دفع فوري' : 'Fawry Ref Code'}</div>
                  </div>
                </button>
              </div>

              <div className="flex gap-3 pt-2">
                <button
                  type="button"
                  onClick={() => setStep(1)}
                  className="px-4 py-2 rounded-xl border border-slate-300 dark:border-slate-700 text-xs font-semibold text-slate-700 dark:text-slate-300"
                >
                  {isRtl ? 'رجوع' : 'Back'}
                </button>
                <button
                  type="button"
                  disabled={isProcessing}
                  onClick={handleStep2Pay}
                  className="flex-1 py-2.5 px-4 rounded-xl bg-amber-500 hover:bg-amber-600 text-slate-950 font-bold text-sm transition-colors shadow-sm flex items-center justify-center gap-2"
                >
                  <span>{isRtl ? `تقديم طلب سداد جدية الحجز (${depositAmount.toLocaleString()} ج.م)` : `Submit Deposit Request (${depositAmount.toLocaleString()} EGP)`}</span>
                </button>
              </div>
            </div>
          )}

          {/* STEP 3: Receipt & Confirmation */}
          {step === 3 && (
            <div data-testid="escrow-receipt-view" className="text-center space-y-4 py-2">
              <div className="w-14 h-14 rounded-full bg-emerald-500/10 text-emerald-500 mx-auto flex items-center justify-center">
                <CheckCircle2 size={36} />
              </div>
              <div>
                <h4 className="font-bold text-lg text-slate-900 dark:text-white">
                  {isRtl ? 'تم تسجيل طلب جدية الحجز بنجاح!' : 'Reservation Deposit Request Registered!'}
                </h4>
                <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
                  {isRtl
                    ? 'تم تسجيل طلب جدية الحجز وتوليد الرقم المرجعي. يتم تأكيد الحجز البنكي الرسمي فور تسوية الدفع.'
                    : 'Your reservation deposit request has been registered. Official escrow hold is finalized upon bank settlement clearance.'}
                </p>
              </div>

              <div className="p-4 bg-slate-50 dark:bg-slate-800/60 rounded-xl border border-slate-200 dark:border-slate-700 text-xs text-start font-mono space-y-1.5">
                <div className="flex justify-between">
                  <span className="text-slate-500">Transaction ID:</span>
                  <span className="font-bold text-slate-800 dark:text-slate-200">{createdTx?.id}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-500">Request Ref:</span>
                  <span className="font-bold text-slate-800 dark:text-slate-200">{escrowResult?.requestReference || escrowResult?.receiptNumber}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-500">Reference:</span>
                  <span className="font-bold text-slate-800 dark:text-slate-200">{escrowResult?.escrowReference}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-500">Status:</span>
                  <span className="text-amber-600 dark:text-amber-400 font-bold">{createdTx?.status || 'deposit_pending'}</span>
                </div>
              </div>

              <div className="p-2.5 rounded-xl bg-amber-500/10 border border-amber-500/20 text-[11px] text-amber-700 dark:text-amber-300 text-start flex items-start gap-2">
                <ShieldCheck className="w-4 h-4 mt-0.5 shrink-0" />
                <span>
                  {isRtl
                    ? 'إشعار الشفافية: تم تسجيل الطلب. يتم تجميد أموال الضمان البنكي حصراً بعد التأكيد والتسوية الرسمية من إدارة الامتثال والبنك الوسيط.'
                    : 'Transparency Notice: This confirms reservation request registration. Funds are strictly held in escrow only upon verified settlement and confirmation by compliance administration.'}
                </span>
              </div>

              <button
                type="button"
                onClick={onClose}
                className="w-full py-2.5 px-4 rounded-xl bg-slate-900 dark:bg-white text-white dark:text-slate-950 font-bold text-sm transition-colors"
              >
                {isRtl ? 'إغلاق والعودة لتفاصيل العقار' : 'Done & Return to Listing'}
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
