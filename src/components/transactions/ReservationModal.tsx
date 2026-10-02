import React, { useState } from 'react';
import { Property, TransactionRecord, PaymentMethod } from '../../types';
import {
  calculateReservationDeposit,
  createPropertyOffer,
  placeReservationDeposit,
} from '../../services/transactions/reservation-service';
import { ShieldCheck, CreditCard, Building2, Smartphone, CheckCircle2, X, ArrowRight, ArrowLeft } from 'lucide-react';

interface ReservationModalProps {
  isOpen: boolean;
  onClose: () => void;
  property: Property;
  currentUserId: string;
  currentUserName: string;
  currentUserPhone: string;
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
  onReservationComplete,
  isRtl = false,
}) => {
  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [offerPrice, setOfferPrice] = useState<number>(property.price);
  const [depositPercent, setDepositPercent] = useState<number>(5);
  const [selectedMethod, setSelectedMethod] = useState<PaymentMethod>('instapay');
  const [createdTx, setCreatedTx] = useState<TransactionRecord | null>(null);
  const [escrowResult, setEscrowResult] = useState<{ receiptNumber: string; escrowReference: string } | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!isOpen) return null;

  const { depositAmount } = calculateReservationDeposit(offerPrice, depositPercent);

  const handleStep1Submit = (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    try {
      const tx = createPropertyOffer({
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
      });

      // Automatically advance to accepted state for instant reservation flow
      tx.status = 'offer_accepted';
      setCreatedTx(tx);
      setStep(2);
    } catch (err: any) {
      setError(err.message || 'Error creating reservation offer');
    }
  };

  const handleStep2Pay = () => {
    if (!createdTx) return;
    setIsProcessing(true);
    setError(null);

    try {
      const res = placeReservationDeposit(createdTx, selectedMethod, currentUserId);
      setCreatedTx(res.transaction);
      setEscrowResult({
        receiptNumber: res.receiptNumber,
        escrowReference: res.escrowReference,
      });
      setStep(3);
      if (onReservationComplete) {
        onReservationComplete(res.transaction);
      }
    } catch (err: any) {
      setError(err.message || 'Error processing escrow deposit');
    } finally {
      setIsProcessing(false);
    }
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
            3. {isRtl ? 'إيصال الحجز الرسمي' : 'Official Receipt'}
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
          {step === 1 && (
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
                    {isRtl ? 'قيمة جدية الحجز المحتجزة بالضمان:' : 'Secured Escrow Deposit Amount:'}
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
                <span>{isRtl ? 'متابعة إلى خطوة السداد' : 'Proceed to Secured Payment'}</span>
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
                  <span>{isRtl ? `تأكيد ودفع ${depositAmount.toLocaleString()} ج.م` : `Confirm & Fund ${depositAmount.toLocaleString()} EGP`}</span>
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
                  {isRtl ? 'تم إيداع جدية الحجز بنجاح!' : 'Escrow Deposit Successfully Secured!'}
                </h4>
                <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
                  {isRtl
                    ? 'تم حجز العقار وتجميد العروض الأخرى. المبلغ محفوظ بحساب الضمان البنكي لحين إتمام التعاقد.'
                    : 'The listing is now marked Reserved. Funds are safeguarded in escrow pending final title handover.'}
                </p>
              </div>

              <div className="p-4 bg-slate-50 dark:bg-slate-800/60 rounded-xl border border-slate-200 dark:border-slate-700 text-xs text-start font-mono space-y-1.5">
                <div className="flex justify-between">
                  <span className="text-slate-500">Transaction ID:</span>
                  <span className="font-bold text-slate-800 dark:text-slate-200">{createdTx?.id}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-500">Receipt No:</span>
                  <span className="font-bold text-slate-800 dark:text-slate-200">{escrowResult?.receiptNumber}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-500">Escrow Ref:</span>
                  <span className="font-bold text-slate-800 dark:text-slate-200">{escrowResult?.escrowReference}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-500">Status:</span>
                  <span className="text-emerald-600 dark:text-emerald-400 font-bold">deposit_escrowed</span>
                </div>
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
