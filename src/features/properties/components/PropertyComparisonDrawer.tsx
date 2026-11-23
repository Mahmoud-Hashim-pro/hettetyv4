import React, { useMemo } from 'react';
import {
  X,
  Scale,
  Building2,
  ShieldCheck,
  Clock,
  Box,
  Compass,
  Award,
  Trash2,
  ArrowUpRight,
  CheckCircle2,
  AlertCircle,
} from 'lucide-react';
import { Property } from '../../../types';
import { useFocusTrap } from '../../../hooks/useFocusTrap';
import { FINISHING_OPTIONS, PAYMENT_OPTIONS } from '../../../components/add-listing-page';
import {
  getPricePerSqm,
  hasReal3DTour,
} from '../../../core/use-cases/FilterPropertiesUseCase';

export interface PropertyComparisonDrawerProps {
  properties: Property[];
  isOpen: boolean;
  onOpen: () => void;
  onClose: () => void;
  onRemove: (propertyId: string) => void;
  onClearAll: () => void;
  onSelectProperty?: (propertyId: string) => void;
  onView3D?: (propertyId: string) => void;
  maxItems?: number;
  isRtl: boolean;
  t?: any;
}

function localizedFinishing(value: string | undefined, isRtl: boolean): string {
  if (!value) return isRtl ? 'غير محدد' : 'Unspecified';
  const match = FINISHING_OPTIONS.find((o) => o.value.toLowerCase() === value.toLowerCase());
  return match ? (isRtl ? match.ar : match.en) : value;
}

function localizedPaymentSummary(property: Property, isRtl: boolean): string {
  if (Array.isArray(property.paymentPlans) && property.paymentPlans.length > 0) {
    const plan = property.paymentPlans[0];
    const parts: string[] = [];
    if (plan.downPayment) parts.push(isRtl ? `مقدم ${plan.downPayment}%` : `${plan.downPayment}% Down`);
    if (plan.years) parts.push(isRtl ? `حتى ${plan.years} سنوات` : `Up to ${plan.years} yrs`);
    if (parts.length > 0) return parts.join(' • ');
    if (plan.note) return plan.note;
  }
  if (Array.isArray(property.paymentMethods) && property.paymentMethods.length > 0) {
    return property.paymentMethods
      .map((m) => {
        const hit = PAYMENT_OPTIONS.find((o) => o.value === m);
        return hit ? (isRtl ? hit.ar : hit.en) : m;
      })
      .join(' · ');
  }
  return isRtl ? 'حسب الاتفاق' : 'On request';
}

export const PropertyComparisonDrawer: React.FC<PropertyComparisonDrawerProps> = ({
  properties,
  isOpen,
  onOpen,
  onClose,
  onRemove,
  onClearAll,
  onSelectProperty,
  onView3D,
  maxItems = 3,
  isRtl,
}) => {
  const modalRef = useFocusTrap<HTMLDivElement>(isOpen, onClose);
  const displayed = useMemo(() => properties.slice(0, maxItems), [properties, maxItems]);

  const highlights = useMemo(() => {
    const validPrices = displayed.filter((p) => p.price && p.price > 0);
    const sameStatus =
      validPrices.length >= 2 &&
      validPrices.every((p) => p.status === validPrices[0].status);

    const lowestPriceId = sameStatus
      ? validPrices.reduce((best, p) => (p.price < best.price ? p : best), validPrices[0]).id
      : null;

    const withPpsm = displayed
      .map((p) => ({ id: p.id, ppsm: getPricePerSqm(p) }))
      .filter((x): x is { id: string; ppsm: number } => x.ppsm !== null);

    const bestValueId =
      withPpsm.length >= 2
        ? withPpsm.reduce((best, x) => (x.ppsm < best.ppsm ? x : best), withPpsm[0]).id
        : null;

    const validAreas = displayed.filter((p) => p.area && p.area > 0);
    const largestAreaId =
      validAreas.length >= 2
        ? validAreas.reduce((best, p) => (p.area > best.area ? p : best), validAreas[0]).id
        : null;

    return { lowestPriceId, bestValueId, largestAreaId };
  }, [displayed]);

  if (displayed.length === 0) {
    return null;
  }

  const emptySlotsCount = Math.max(0, maxItems - displayed.length);

  return (
    <>
      {/* Sticky Floating Comparison Bar */}
      <aside
        aria-label={isRtl ? 'شريط مقارنة العقارات' : 'Property Comparison Bar'}
        dir={isRtl ? 'rtl' : 'ltr'}
        className="fixed bottom-4 inset-x-3 sm:inset-x-6 z-40 max-w-5xl mx-auto animate-slide-up"
      >
        <div className="bg-brand-900/95 dark:bg-slate-900/95 backdrop-blur-xl text-white rounded-2xl sm:rounded-3xl border border-white/15 shadow-2xl shadow-brand-950/40 p-3 sm:p-4 flex flex-col md:flex-row items-stretch md:items-center justify-between gap-3">
          {/* Selected Units Mini Strip */}
          <div className="flex items-center gap-2.5 overflow-x-auto no-scrollbar flex-1 min-w-0">
            <div className="hidden sm:flex items-center gap-2 pe-2 border-e border-white/15 shrink-0">
              <div className="w-9 h-9 rounded-xl bg-accent-500/20 border border-accent-400/30 flex items-center justify-center text-accent-400">
                <Scale size={18} aria-hidden="true" />
              </div>
              <div>
                <div className="text-xs font-black tracking-wide">
                  {isRtl ? `مقارنة ${displayed.length}` : `Compare ${displayed.length}`}
                </div>
                <div className="text-[10px] text-slate-300 font-semibold">
                  {displayed.length} / {maxItems}
                </div>
              </div>
            </div>

            {displayed.map((prop) => (
              <div
                key={prop.id}
                className="flex items-center gap-2 bg-white/10 border border-white/15 rounded-xl px-2.5 py-1.5 min-w-[155px] max-w-[210px] shrink-0"
              >
                {prop.imageUrl ? (
                  <img
                    src={prop.imageUrl}
                    alt={prop.title}
                    className="w-9 h-9 rounded-lg object-cover shrink-0"
                  />
                ) : (
                  <div className="w-9 h-9 rounded-lg bg-white/10 flex items-center justify-center shrink-0">
                    <Building2 size={15} aria-hidden="true" />
                  </div>
                )}
                <div className="min-w-0 flex-1">
                  <div className="text-xs font-bold truncate">{prop.title}</div>
                  <div className="text-[10px] text-accent-300 font-semibold truncate tabular-nums">
                    {prop.price
                      ? `${prop.price.toLocaleString()} ${prop.currency || 'EGP'}`
                      : isRtl
                        ? 'عند الطلب'
                        : 'On request'}
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => onRemove(prop.id)}
                  aria-label={isRtl ? `إزالة ${prop.title} من المقارنة` : `Remove ${prop.title} from comparison`}
                  className="p-1 rounded-full hover:bg-white/20 text-slate-300 hover:text-white transition-colors cursor-pointer shrink-0"
                >
                  <X size={13} aria-hidden="true" />
                </button>
              </div>
            ))}

            {Array.from({ length: emptySlotsCount }).map((_, idx) => (
              <div
                key={`slot-${idx}`}
                className="hidden lg:flex items-center justify-center h-12 px-4 rounded-xl border border-dashed border-white/20 text-[11px] text-slate-400 font-medium shrink-0"
              >
                {isRtl ? 'اختر عقاراً آخر' : 'Add unit'}
              </div>
            ))}
          </div>

          {/* Bar Actions */}
          <div className="flex items-center justify-end gap-2 shrink-0">
            <button
              type="button"
              onClick={onClearAll}
              className="px-3 py-2 rounded-xl text-xs font-bold text-slate-300 hover:text-white hover:bg-white/10 transition-colors flex items-center gap-1 cursor-pointer"
            >
              <Trash2 size={14} aria-hidden="true" />
              <span>{isRtl ? 'مسح' : 'Clear'}</span>
            </button>
            <button
              type="button"
              onClick={onOpen}
              disabled={displayed.length < 2}
              className="px-4 sm:px-5 py-2.5 rounded-xl bg-accent-500 hover:bg-accent-600 disabled:opacity-45 disabled:cursor-not-allowed text-white text-xs sm:text-sm font-black shadow-lg shadow-accent-500/25 transition-all flex items-center gap-1.5 cursor-pointer focus:outline-none focus:ring-2 focus:ring-white"
            >
              <Scale size={15} aria-hidden="true" />
              <span>{isRtl ? 'قارن الآن' : 'Compare now'}</span>
            </button>
          </div>
        </div>
      </aside>

      {/* Full Side-by-Side Comparison Modal */}
      {isOpen && (
        <div
          className="fixed inset-0 z-[80] bg-brand-950/70 backdrop-blur-sm flex items-center justify-center p-3 sm:p-6 animate-fade-in"
          onClick={onClose}
        >
          <div
            ref={modalRef}
            role="dialog"
            aria-modal="true"
            aria-labelledby="property-comparison-modal-title"
            dir={isRtl ? 'rtl' : 'ltr'}
            onClick={(e) => e.stopPropagation()}
            className="bg-white dark:bg-slate-900 rounded-3xl border border-slate-200 dark:border-slate-800 shadow-2xl w-full max-w-6xl max-h-[90vh] flex flex-col overflow-hidden"
          >
            {/* Modal Header */}
            <div className="px-5 sm:px-7 py-4 sm:py-5 border-b border-slate-100 dark:border-slate-800 flex items-center justify-between gap-4 bg-slate-50/70 dark:bg-slate-950/60">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-2xl bg-brand-600 text-white flex items-center justify-center shadow-sm">
                  <Scale size={20} aria-hidden="true" />
                </div>
                <div>
                  <h2
                    id="property-comparison-modal-title"
                    className="text-lg sm:text-xl font-heading font-black text-slate-900 dark:text-white"
                  >
                    {isRtl ? 'مقارنة العقارات' : 'Compare Properties'}
                  </h2>
                  <p className="text-xs text-slate-500 dark:text-slate-400 font-medium">
                    {isRtl
                      ? 'نقارن الأسعار، سعر المتر، المساحة، أنظمة السداد، وحالة التوثيق بدقة.'
                      : 'Compare pricing, value per m², payment plans, 3D tours, and verification status.'}
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={onClose}
                aria-label={isRtl ? 'إغلاق نافذة المقارنة' : 'Close comparison modal'}
                className="w-10 h-10 rounded-xl bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 flex items-center justify-center transition-colors cursor-pointer focus:outline-none focus:ring-2 focus:ring-brand-500"
              >
                <X size={20} aria-hidden="true" />
              </button>
            </div>

            {/* Responsive Comparison Table */}
            <div className="flex-1 overflow-auto custom-scrollbar p-4 sm:p-6">
              <table className="w-full min-w-[640px] border-separate border-spacing-0 text-start">
                <thead>
                  <tr>
                    <th className="w-44 p-3 align-bottom text-xs font-black uppercase tracking-wider text-slate-500 dark:text-slate-400 border-b border-slate-200 dark:border-slate-800">
                      {isRtl ? 'المعيار' : 'Specification'}
                    </th>
                    {displayed.map((prop) => {
                      const isBestVal = highlights.bestValueId === prop.id;
                      return (
                        <th
                          key={prop.id}
                          className={`p-3 align-top border-b border-slate-200 dark:border-slate-800 min-w-[210px] ${
                            isBestVal ? 'bg-emerald-50/40 dark:bg-emerald-950/20 rounded-t-2xl' : ''
                          }`}
                        >
                          <div className="relative rounded-2xl overflow-hidden h-36 mb-3 bg-slate-100 dark:bg-slate-800">
                            {prop.imageUrl ? (
                              <img
                                src={prop.imageUrl}
                                alt={prop.title}
                                className="w-full h-full object-cover"
                              />
                            ) : (
                              <div className="w-full h-full flex items-center justify-center text-slate-400">
                                <Building2 size={32} aria-hidden="true" />
                              </div>
                            )}
                            <button
                              type="button"
                              onClick={() => onRemove(prop.id)}
                              aria-label={isRtl ? `حذف ${prop.title}` : `Remove ${prop.title}`}
                              className="absolute top-2 end-2 w-7 h-7 rounded-full bg-brand-950/70 hover:bg-rose-600 text-white flex items-center justify-center transition-colors cursor-pointer"
                            >
                              <X size={14} aria-hidden="true" />
                            </button>
                            {isBestVal && (
                              <span className="absolute bottom-2 start-2 inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-emerald-600 text-white text-[10px] font-black shadow-md">
                                <Award size={11} aria-hidden="true" />
                                <span>{isRtl ? 'أفضل قيمة للمتر' : 'Best Value / m²'}</span>
                              </span>
                            )}
                          </div>
                          <div className="text-sm font-black text-slate-900 dark:text-white line-clamp-2 mb-2">
                            {prop.title}
                          </div>
                          {onSelectProperty && (
                            <button
                              type="button"
                              onClick={() => {
                                onClose();
                                onSelectProperty(prop.id);
                              }}
                              className="inline-flex items-center gap-1 text-xs font-bold text-brand-600 dark:text-accent-400 hover:underline cursor-pointer"
                            >
                              <span>{isRtl ? 'عرض صفحة العقار' : 'View Property'}</span>
                              <ArrowUpRight size={13} className={isRtl ? '-scale-x-100' : ''} aria-hidden="true" />
                            </button>
                          )}
                        </th>
                      );
                    })}
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-800 text-xs sm:text-sm">
                  {/* Price */}
                  <tr>
                    <td className="p-3.5 font-bold text-slate-500 dark:text-slate-400">
                      {isRtl ? 'السعر' : 'Price'}
                    </td>
                    {displayed.map((p) => (
                      <td key={p.id} className="p-3.5 font-black text-brand-700 dark:text-accent-400 tabular-nums">
                        <div className="flex flex-wrap items-center gap-1.5">
                          <span>
                            {p.price
                              ? `${p.price.toLocaleString()} ${p.currency || 'EGP'}`
                              : isRtl
                                ? 'السعر عند الطلب'
                                : 'Price on request'}
                          </span>
                          {highlights.lowestPriceId === p.id && (
                            <span className="px-2 py-0.5 rounded-full bg-emerald-100 dark:bg-emerald-900/40 text-emerald-700 dark:text-emerald-300 text-[10px] font-black">
                              {isRtl ? 'أقل سعر' : 'Lowest'}
                            </span>
                          )}
                        </div>
                      </td>
                    ))}
                  </tr>

                  {/* Price per m² */}
                  <tr className="bg-slate-50/60 dark:bg-slate-800/30">
                    <td className="p-3.5 font-bold text-slate-500 dark:text-slate-400">
                      {isRtl ? 'سعر المتر المربع' : 'Price / m²'}
                    </td>
                    {displayed.map((p) => {
                      const ppsm = getPricePerSqm(p);
                      const isBest = highlights.bestValueId === p.id;
                      return (
                        <td key={p.id} className="p-3.5 font-bold text-slate-900 dark:text-white tabular-nums">
                          {ppsm !== null ? (
                            <div className="flex flex-wrap items-center gap-1.5">
                              <span>
                                {ppsm.toLocaleString()} {p.currency || 'EGP'} / {isRtl ? 'م²' : 'm²'}
                              </span>
                              {isBest && (
                                <span className="px-2 py-0.5 rounded-full bg-emerald-600 text-white text-[10px] font-black">
                                  {isRtl ? 'الأفضل قيمة' : 'Best Value'}
                                </span>
                              )}
                            </div>
                          ) : (
                            <span className="text-slate-400">—</span>
                          )}
                        </td>
                      );
                    })}
                  </tr>

                  {/* Location */}
                  <tr>
                    <td className="p-3.5 font-bold text-slate-500 dark:text-slate-400">
                      {isRtl ? 'الموقع' : 'Location'}
                    </td>
                    {displayed.map((p) => (
                      <td key={p.id} className="p-3.5 font-semibold text-slate-800 dark:text-slate-200">
                        {p.location}
                      </td>
                    ))}
                  </tr>

                  {/* Compound & Developer */}
                  <tr className="bg-slate-50/60 dark:bg-slate-800/30">
                    <td className="p-3.5 font-bold text-slate-500 dark:text-slate-400">
                      {isRtl ? 'الكمبوند / المطور' : 'Compound & Developer'}
                    </td>
                    {displayed.map((p) => (
                      <td key={p.id} className="p-3.5 text-slate-800 dark:text-slate-200">
                        <div className="font-bold">{p.compound || '—'}</div>
                        {p.developer && (
                          <div className="text-xs text-slate-500 dark:text-slate-400">{p.developer}</div>
                        )}
                      </td>
                    ))}
                  </tr>

                  {/* Area */}
                  <tr>
                    <td className="p-3.5 font-bold text-slate-500 dark:text-slate-400">
                      {isRtl ? 'المساحة' : 'Area'}
                    </td>
                    {displayed.map((p) => (
                      <td key={p.id} className="p-3.5 font-bold text-slate-900 dark:text-white tabular-nums">
                        <div className="flex items-center gap-1.5">
                          <span>
                            {p.area}
                            {p.areaTo ? `–${p.areaTo}` : ''} m²
                          </span>
                          {highlights.largestAreaId === p.id && (
                            <span className="px-2 py-0.5 rounded-full bg-brand-100 dark:bg-brand-900/40 text-brand-700 dark:text-brand-300 text-[10px] font-black">
                              {isRtl ? 'الأكبر' : 'Largest'}
                            </span>
                          )}
                        </div>
                      </td>
                    ))}
                  </tr>

                  {/* Bedrooms */}
                  <tr className="bg-slate-50/60 dark:bg-slate-800/30">
                    <td className="p-3.5 font-bold text-slate-500 dark:text-slate-400">
                      {isRtl ? 'غرف النوم' : 'Bedrooms'}
                    </td>
                    {displayed.map((p) => (
                      <td key={p.id} className="p-3.5 font-semibold text-slate-800 dark:text-slate-200 tabular-nums">
                        {p.bedrooms}
                      </td>
                    ))}
                  </tr>

                  {/* Bathrooms */}
                  <tr>
                    <td className="p-3.5 font-bold text-slate-500 dark:text-slate-400">
                      {isRtl ? 'الحمامات' : 'Bathrooms'}
                    </td>
                    {displayed.map((p) => (
                      <td key={p.id} className="p-3.5 font-semibold text-slate-800 dark:text-slate-200 tabular-nums">
                        {p.bathrooms}
                      </td>
                    ))}
                  </tr>

                  {/* Finishing */}
                  <tr className="bg-slate-50/60 dark:bg-slate-800/30">
                    <td className="p-3.5 font-bold text-slate-500 dark:text-slate-400">
                      {isRtl ? 'التشطيب' : 'Finishing'}
                    </td>
                    {displayed.map((p) => (
                      <td key={p.id} className="p-3.5 font-semibold text-slate-800 dark:text-slate-200">
                        {localizedFinishing(p.finishing, isRtl)}
                      </td>
                    ))}
                  </tr>

                  {/* Delivery */}
                  <tr>
                    <td className="p-3.5 font-bold text-slate-500 dark:text-slate-400">
                      {isRtl ? 'موعد الاستلام' : 'Delivery'}
                    </td>
                    {displayed.map((p) => (
                      <td key={p.id} className="p-3.5 font-semibold text-slate-800 dark:text-slate-200">
                        <span className="inline-flex items-center gap-1.5">
                          <Clock size={13} className="text-slate-400" aria-hidden="true" />
                          <span>{p.deliveryDate || p.deliveryTimeline || (isRtl ? 'غير محدد' : 'TBD')}</span>
                        </span>
                      </td>
                    ))}
                  </tr>

                  {/* Payment Plans */}
                  <tr className="bg-slate-50/60 dark:bg-slate-800/30">
                    <td className="p-3.5 font-bold text-slate-500 dark:text-slate-400">
                      {isRtl ? 'أنظمة السداد' : 'Payment Plans'}
                    </td>
                    {displayed.map((p) => (
                      <td key={p.id} className="p-3.5 font-semibold text-slate-800 dark:text-slate-200">
                        {localizedPaymentSummary(p, isRtl)}
                      </td>
                    ))}
                  </tr>

                  {/* 3D Tour Availability */}
                  <tr>
                    <td className="p-3.5 font-bold text-slate-500 dark:text-slate-400">
                      {isRtl ? 'جولة 3D الافتراضية' : '3D Tour Availability'}
                    </td>
                    {displayed.map((p) => {
                      const real3D = hasReal3DTour(p);
                      const pano = Array.isArray(p.panoramas) && p.panoramas.length > 0;
                      return (
                        <td key={p.id} className="p-3.5">
                          {real3D ? (
                            <div className="flex flex-wrap items-center gap-2">
                              <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-brand-50 dark:bg-brand-900/40 text-brand-700 dark:text-brand-300 text-xs font-bold">
                                <Box size={13} aria-hidden="true" />
                                <span>{isRtl ? 'جولة 3D حقيقية' : 'Real 3D Tour'}</span>
                              </span>
                              {onView3D && (
                                <button
                                  type="button"
                                  onClick={() => {
                                    onClose();
                                    onView3D(p.id);
                                  }}
                                  className="text-xs font-bold text-accent-600 dark:text-accent-400 hover:underline cursor-pointer"
                                >
                                  {isRtl ? 'افتح' : 'Launch'}
                                </button>
                              )}
                            </div>
                          ) : pano ? (
                            <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-cyan-50 dark:bg-cyan-900/30 text-cyan-700 dark:text-cyan-300 text-xs font-bold">
                              <Compass size={13} aria-hidden="true" />
                              <span>{isRtl ? 'بانوراما 360°' : '360° Panorama'}</span>
                            </span>
                          ) : (
                            <span className="text-xs text-slate-400 font-medium">
                              {isRtl ? 'صور فقط' : 'Photos only'}
                            </span>
                          )}
                        </td>
                      );
                    })}
                  </tr>

                  {/* Verification Status */}
                  <tr className="bg-slate-50/60 dark:bg-slate-800/30">
                    <td className="p-3.5 font-bold text-slate-500 dark:text-slate-400">
                      {isRtl ? 'حالة مراجعة المستندات' : 'Verification Status'}
                    </td>
                    {displayed.map((p) => {
                      const verified =
                        p.verificationStatus === 'Verified' ||
                        (p.verificationStatus === undefined && p.isVerified);
                      return (
                        <td key={p.id} className="p-3.5">
                          {verified ? (
                            <span className="inline-flex items-center gap-1.5 text-emerald-700 dark:text-emerald-400 font-bold text-xs">
                              <ShieldCheck size={15} aria-hidden="true" />
                              <span>{isRtl ? 'مستندات مُراجعة' : 'Documents Reviewed'}</span>
                            </span>
                          ) : p.verificationStatus === 'Rejected' ? (
                            <span className="inline-flex items-center gap-1.5 text-rose-600 dark:text-rose-400 font-bold text-xs">
                              <AlertCircle size={15} aria-hidden="true" />
                              <span>{isRtl ? 'يحتاج تعديلات' : 'Needs Changes'}</span>
                            </span>
                          ) : (
                            <span className="inline-flex items-center gap-1.5 text-amber-600 dark:text-amber-400 font-bold text-xs">
                              <CheckCircle2 size={15} aria-hidden="true" />
                              <span>{isRtl ? 'قيد المراجعة' : 'Pending Review'}</span>
                            </span>
                          )}
                        </td>
                      );
                    })}
                  </tr>
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}
    </>
  );
};

export default PropertyComparisonDrawer;
