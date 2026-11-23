import React, { useState } from 'react';
import {
  MapPin,
  FileCheck,
  Loader2,
  ShieldCheck,
  BedDouble,
  Bath,
  Maximize,
  PhoneCall,
  CalendarCheck2,
  ClipboardCheck,
  AlertCircle,
  Lock,
  Building2,
  ArrowLeft,
  ArrowRight,
  Info,
} from 'lucide-react';
import { Property } from '../../types';
import {
  priceLabel,
  priceProvenance,
  pricePeriodSuffix,
  typeLabel,
  listingReviewInfo,
} from '../../shared/utils/propertyFormatters';
import { BrandButton } from '../../shared/ui/BrandButton';
import { PropertyImage } from '../../shared/ui/PropertyImage';

export interface PaymentPageProps {
  property: Property;
  onConfirm: () => void | Promise<void>;
  onCancel: () => void;
  t: any;
  isRtl: boolean;
}

export const PaymentPage: React.FC<PaymentPageProps> = ({
  property,
  onConfirm,
  onCancel,
  t,
  isRtl,
}) => {
  const [processing, setProcessing] = useState(false);
  const [error, setError] = useState('');

  const handlePay = async () => {
    if (processing) return; // Double-submit lock prevents duplicate purchase requests
    setProcessing(true);
    setError('');
    try {
      await onConfirm();
    } catch (err: any) {
      console.error('Purchase request failed:', err);
      setError(
        isRtl
          ? 'تعذّر إرسال الطلب. حاول تاني أو كلّمنا على واتساب.'
          : 'Could not send your request. Please try again, or contact us on WhatsApp.'
      );
    } finally {
      setProcessing(false);
    }
  };

  const provenance = priceProvenance(property, isRtl);
  const propType = typeLabel(property.propertyType, isRtl);
  const review = listingReviewInfo(property, t);
  const period = property.price ? pricePeriodSuffix(property.pricePeriod, isRtl) : '';

  const steps = [
    {
      num: '1',
      icon: <ClipboardCheck size={17} aria-hidden="true" />,
      title: isRtl ? 'تسجيل الطلب فوراً' : 'Request Registered',
      desc: isRtl
        ? 'بنسجّل طلبك على الوحدة دي ويوصلك تأكيد.'
        : 'We register your request for this unit and send you a confirmation.',
    },
    {
      num: '2',
      icon: <PhoneCall size={17} aria-hidden="true" />,
      title: isRtl ? 'تواصل فريق حتتي' : 'Team Follow-Up',
      desc: isRtl
        ? 'فريق هيتيتي بيراجع الطلب ويتواصل معاك.'
        : 'The HETTETY team reviews it and contacts you.',
    },
    {
      num: '3',
      icon: <CalendarCheck2 size={17} aria-hidden="true" />,
      title: isRtl ? 'المعاينة والاتفاق المباشر' : 'Direct Viewing & Terms',
      desc: isRtl
        ? 'بنتفق على المعاينة والتفاصيل والدفع بعد كده — مفيش أي فلوس بتتدفع من هنا.'
        : 'Viewing, terms and payment are arranged with you directly — no money is taken here.',
    },
  ];

  return (
    <div
      dir={isRtl ? 'rtl' : 'ltr'}
      className="max-w-5xl mx-auto px-4 sm:px-6 py-10 sm:py-12 animate-fade-in transition-colors duration-500"
    >
      {/* Back breadcrumb & Title */}
      <div className="mb-8 text-start">
        <button
          type="button"
          onClick={onCancel}
          className="inline-flex items-center gap-1.5 text-xs font-bold text-slate-500 dark:text-slate-400 hover:text-brand-600 dark:hover:text-accent-400 mb-3 transition-colors cursor-pointer"
        >
          {isRtl ? (
            <ArrowRight size={14} aria-hidden="true" />
          ) : (
            <ArrowLeft size={14} aria-hidden="true" />
          )}
          <span>{isRtl ? 'العودة لتفاصيل الوحدة' : 'Back to property details'}</span>
        </button>

        <div className="flex flex-wrap items-center justify-between gap-3">
          <h1 className="text-2xl sm:text-3xl font-heading font-black text-slate-900 dark:text-white tracking-tight">
            {isRtl ? 'طلب شراء وحدة' : 'Request to Purchase'}
          </h1>
          <span className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-full bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-800 text-emerald-700 dark:text-emerald-300 text-xs font-extrabold">
            <Lock size={13} aria-hidden="true" />
            <span>
              {isRtl ? 'طلب مجاني وغير ملزم' : 'Free & Non-Binding Request'}
            </span>
          </span>
        </div>
      </div>

      {/* Architectural Two-Zone Confirmation Card */}
      <div className="grid grid-cols-1 lg:grid-cols-5 gap-6 items-start">
        {/* Zone 1: Property Summary & Frozen Price Snapshot */}
        <section
          aria-label={isRtl ? 'ملخص الوحدة والسعر المعلن' : 'Property summary and price snapshot'}
          className="lg:col-span-2 bg-white dark:bg-slate-900 rounded-3xl border border-slate-200/90 dark:border-slate-800 shadow-lg overflow-hidden"
        >
          <div className="relative h-52 bg-slate-100 dark:bg-slate-800 overflow-hidden">
            <PropertyImage
              src={property.imageUrl}
              alt={property.title || (isRtl ? 'صورة العقار' : 'Property image')}
              iconSize={36}
              priority
              className="w-full h-full object-cover"
            />
            <div className="absolute inset-0 bg-gradient-to-t from-brand-950/80 via-brand-950/20 to-transparent pointer-events-none" />
            <div className="absolute top-3 start-3 flex flex-wrap items-center gap-1.5">
              {propType && (
                <span className="px-2.5 py-1 rounded-full bg-brand-900/85 text-white text-[11px] font-bold backdrop-blur-sm">
                  {propType}
                </span>
              )}
              <span
                className={`px-2.5 py-1 rounded-full text-[11px] font-bold ${review.chip}`}
              >
                {review.label}
              </span>
            </div>
            {property.unitCode && (
              <span className="absolute bottom-3 start-3 px-2.5 py-1 rounded-lg bg-brand-950/80 border border-white/15 text-white font-mono text-[11px] font-bold backdrop-blur-md">
                {property.unitCode}
              </span>
            )}
          </div>

          <div className="p-6 text-start space-y-5">
            <div>
              {property.compound && (
                <p className="text-xs font-bold text-accent-600 dark:text-accent-400 flex items-center gap-1 mb-1">
                  <Building2 size={12} aria-hidden="true" />
                  <span>{property.compound}</span>
                </p>
              )}
              <h2 className="text-xl font-heading font-black text-slate-900 dark:text-white leading-snug">
                {property.title}
              </h2>
              <p className="text-slate-500 dark:text-slate-400 font-medium flex items-center gap-1.5 text-sm mt-1.5">
                <MapPin size={14} className="text-accent-500 shrink-0" aria-hidden="true" />
                <span>{property.location}</span>
              </p>
            </div>

            {/* Frozen Price Snapshot Badge */}
            <div className="rounded-2xl bg-brand-50 dark:bg-brand-950/50 border border-brand-100 dark:border-brand-900/70 p-4">
              <div className="flex items-center justify-between gap-2 mb-1">
                <span className="text-[11px] font-extrabold uppercase tracking-wider text-brand-700 dark:text-brand-300">
                  {isRtl ? 'لقطة السعر وقت الطلب' : 'Listed Price Snapshot'}
                </span>
                <span className="px-2 py-0.5 rounded-md bg-white dark:bg-slate-900 border border-brand-200 dark:border-brand-800 text-[10px] font-bold text-slate-600 dark:text-slate-300">
                  {isRtl ? '0 ج.م مستحقة الآن' : '0 due now'}
                </span>
              </div>
              <div className="text-2xl font-black text-brand-700 dark:text-accent-400 tabular-nums">
                {property.price ? (
                  <>
                    <span>{property.price.toLocaleString()}</span>{' '}
                    <span className="text-sm font-extrabold">
                      {property.currency || (isRtl ? 'ج.م' : 'EGP')}
                    </span>
                    {period && (
                      <span className="text-xs font-semibold text-slate-500 dark:text-slate-400">
                        {period}
                      </span>
                    )}
                  </>
                ) : (
                  <span>{priceLabel(property, isRtl)}</span>
                )}
              </div>
              {provenance && (
                <p className="mt-2 text-[11px] text-slate-600 dark:text-slate-400 flex items-start gap-1.5 leading-relaxed">
                  <Info size={13} className="shrink-0 mt-0.5 text-brand-500" aria-hidden="true" />
                  <span>{provenance}</span>
                </p>
              )}
            </div>

            {/* Key Unit Specs */}
            <div className="grid grid-cols-3 gap-2 pt-2 border-t border-slate-100 dark:border-slate-800 text-center">
              <div className="p-2.5 rounded-xl bg-slate-50 dark:bg-slate-800/60">
                <BedDouble
                  size={16}
                  className="mx-auto text-brand-600 dark:text-brand-400 mb-1"
                  aria-hidden="true"
                />
                <span className="text-xs font-extrabold text-slate-800 dark:text-slate-200 tabular-nums">
                  {property.bedrooms} {t.prop_beds || (isRtl ? 'غرف' : 'Beds')}
                </span>
              </div>
              <div className="p-2.5 rounded-xl bg-slate-50 dark:bg-slate-800/60">
                <Bath
                  size={16}
                  className="mx-auto text-brand-600 dark:text-brand-400 mb-1"
                  aria-hidden="true"
                />
                <span className="text-xs font-extrabold text-slate-800 dark:text-slate-200 tabular-nums">
                  {property.bathrooms} {t.prop_baths || (isRtl ? 'حمام' : 'Baths')}
                </span>
              </div>
              <div className="p-2.5 rounded-xl bg-slate-50 dark:bg-slate-800/60">
                <Maximize
                  size={15}
                  className="mx-auto text-brand-600 dark:text-brand-400 mb-1"
                  aria-hidden="true"
                />
                <span className="text-xs font-extrabold text-slate-800 dark:text-slate-200 tabular-nums">
                  {property.area}
                  {property.areaTo ? `–${property.areaTo}` : ''} m²
                </span>
              </div>
            </div>
          </div>
        </section>

        {/* Zone 2: Honest Non-Binding Request Confirmation & 3-Step Visual Track */}
        <section
          aria-label={isRtl ? 'خطوات طلب الشراء' : 'Purchase request steps'}
          className="lg:col-span-3 bg-white dark:bg-slate-900 p-6 sm:p-8 rounded-3xl border border-slate-200/90 dark:border-slate-800 shadow-xl text-start relative overflow-hidden"
        >
          {/* Subtle top navy accent bar */}
          <div
            aria-hidden="true"
            className="absolute top-0 inset-x-0 h-1.5 bg-gradient-to-r from-brand-600 via-accent-500 to-brand-600"
          />

          <div className="space-y-6">
            {/* No card fields: nothing here charges a card. Collecting card numbers
                that go nowhere is a liability, so this is strictly an honest enquiry. */}
            <div className="bg-brand-50/70 dark:bg-brand-950/35 border border-brand-100 dark:border-brand-900/60 rounded-2xl p-5 sm:p-6">
              <h3 className="font-heading font-black text-slate-900 dark:text-white mb-5 flex items-center gap-2.5 text-base sm:text-lg">
                <div className="p-2 rounded-xl bg-brand-600 text-white">
                  <FileCheck size={18} aria-hidden="true" />
                </div>
                <span>{isRtl ? 'إيه اللي هيحصل دلوقتي؟' : 'What happens next?'}</span>
              </h3>

              {/* Visual 3-Step Progress Track */}
              <ol className="space-y-4">
                {steps.map((step, idx) => (
                  <li key={step.num} className="relative flex items-start gap-4">
                    {idx < steps.length - 1 && (
                      <span
                        aria-hidden="true"
                        className="absolute top-9 start-[17px] bottom-[-18px] w-0.5 bg-brand-200 dark:bg-brand-800"
                      />
                    )}
                    <div
                      className={`relative z-10 w-9 h-9 rounded-xl flex items-center justify-center shrink-0 font-black text-xs shadow-sm ${
                        idx === 0
                          ? 'bg-accent-500 text-white'
                          : 'bg-white dark:bg-slate-900 text-brand-600 dark:text-brand-300 border border-brand-200 dark:border-brand-800'
                      }`}
                    >
                      {step.icon}
                    </div>
                    <div className="pt-0.5 flex-1">
                      <p className="text-xs font-extrabold uppercase tracking-wide text-brand-700 dark:text-brand-300 mb-0.5">
                        {step.num}. {step.title}
                      </p>
                      <p className="text-sm text-slate-700 dark:text-slate-300 leading-relaxed">
                        {step.desc}
                      </p>
                    </div>
                  </li>
                ))}
              </ol>
            </div>

            {/* Explicit No-Card / Non-Binding Disclosure */}
            <div className="flex items-start gap-3 p-4 rounded-2xl bg-slate-50 dark:bg-slate-800/60 border border-slate-200/80 dark:border-slate-700/80">
              <ShieldCheck
                size={18}
                className="text-emerald-600 dark:text-emerald-400 shrink-0 mt-0.5"
                aria-hidden="true"
              />
              <p className="text-xs sm:text-sm text-slate-600 dark:text-slate-300 leading-relaxed font-medium">
                {isRtl
                  ? 'إرسال الطلب مجاني ومش بيلزمك بأي حاجة، ومش بنطلب أي بيانات بنكية على الموقع.'
                  : 'Sending a request is free and non-binding. We never ask for card or bank details on the site.'}
              </p>
            </div>

            {error && (
              <div
                role="alert"
                className="text-sm font-bold text-rose-700 dark:text-rose-300 bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-800 rounded-2xl px-4 py-3.5 flex items-center gap-2.5"
              >
                <AlertCircle size={18} className="shrink-0" aria-hidden="true" />
                <span>{error}</span>
              </div>
            )}

            <div className="pt-2 flex flex-col sm:flex-row gap-3.5">
              <BrandButton
                onClick={handlePay}
                disabled={processing}
                variant="accent"
                className="flex-1 py-4 text-base sm:text-lg font-black shadow-lg shadow-accent-500/25"
              >
                {processing ? (
                  <Loader2
                    className="animate-spin mx-auto"
                    aria-label={isRtl ? 'جاري الإرسال' : 'Sending'}
                  />
                ) : isRtl ? (
                  'أرسل طلب الشراء'
                ) : (
                  'Send purchase request'
                )}
              </BrandButton>
              <button
                type="button"
                onClick={onCancel}
                disabled={processing}
                className="px-7 py-4 rounded-xl font-bold text-slate-700 dark:text-slate-300 bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 transition-colors cursor-pointer disabled:opacity-50 focus:outline-none focus:ring-2 focus:ring-slate-400"
              >
                {isRtl ? 'رجوع' : 'Cancel'}
              </button>
            </div>
          </div>
        </section>
      </div>
    </div>
  );
};

export default PaymentPage;
