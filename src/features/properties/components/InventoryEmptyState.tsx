import React from 'react';
import {
  Building2,
  PlusCircle,
  Shield,
  SearchX,
  RotateCcw,
  Sparkles,
  CheckCircle2,
  Box,
  FileCheck,
} from 'lucide-react';

export interface InventoryEmptyStateProps {
  mode: 'clean-database' | 'no-matches';
  isRtl: boolean;
  isAdmin?: boolean;
  activeFilterCount?: number;
  totalInventoryCount?: number;
  onAddProperty?: () => void;
  onOpenAdmin?: () => void;
  onClearFilters?: () => void;
  onOpenAdvisor?: () => void;
}

export const InventoryEmptyState: React.FC<InventoryEmptyStateProps> = ({
  mode,
  isRtl,
  isAdmin = false,
  activeFilterCount = 0,
  totalInventoryCount = 0,
  onAddProperty,
  onOpenAdmin,
  onClearFilters,
  onOpenAdvisor,
}) => {
  if (mode === 'clean-database') {
    return (
      <section
        aria-label={isRtl ? 'قاعدة العقارات جاهزة للإعلانات الموثقة' : 'Inventory Ready for Verified Listings'}
        dir={isRtl ? 'rtl' : 'ltr'}
        className="relative overflow-hidden rounded-3xl bg-white dark:bg-slate-900 border border-slate-200/90 dark:border-slate-800 shadow-xl shadow-brand-900/5 px-6 sm:px-10 py-14 sm:py-16 text-center animate-fade-in"
      >
        {/* Subtle Architectural Blueprint Grid */}
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-0 opacity-[0.04] dark:opacity-[0.07] bg-[linear-gradient(to_right,#1b2c4d_1px,transparent_1px),linear-gradient(to_bottom,#1b2c4d_1px,transparent_1px)] dark:bg-[linear-gradient(to_right,#94a3b8_1px,transparent_1px),linear-gradient(to_bottom,#94a3b8_1px,transparent_1px)] bg-[size:36px_36px]"
        />
        <div
          aria-hidden="true"
          className="pointer-events-none absolute -top-24 inset-x-0 mx-auto w-96 h-48 rounded-full bg-accent-500/10 blur-3xl"
        />

        <div className="relative z-10 max-w-2xl mx-auto flex flex-col items-center">
          {/* Architectural Emblem */}
          <div className="relative mb-6">
            <div className="w-20 h-20 rounded-3xl bg-gradient-to-br from-brand-600 to-brand-800 text-white flex items-center justify-center shadow-xl shadow-brand-600/25 border border-brand-500/40">
              <Building2 size={36} strokeWidth={1.6} aria-hidden="true" />
            </div>
            <div className="absolute -bottom-1.5 -end-1.5 w-8 h-8 rounded-xl bg-accent-500 text-white flex items-center justify-center shadow-md border-2 border-white dark:border-slate-900">
              <Sparkles size={15} aria-hidden="true" />
            </div>
          </div>

          <span className="inline-flex items-center gap-1.5 px-3.5 py-1 rounded-full bg-brand-50 dark:bg-brand-900/40 border border-brand-200/70 dark:border-brand-800 text-brand-700 dark:text-brand-300 text-xs font-black tracking-wide mb-4">
            <CheckCircle2 size={13} aria-hidden="true" />
            <span>
              {isRtl ? 'قاعدة بيانات نظيفة ومستعدة للنشر الحقيقي' : 'Clean Inventory · Verified Listings Only'}
            </span>
          </span>

          <h2 className="text-2xl sm:text-3xl font-heading font-black text-slate-900 dark:text-white mb-3 leading-tight">
            {isRtl
              ? 'قائمة العقارات جاهزة لأول وحدة حقيقية موثّقة'
              : 'Property Inventory Is Freshly Reset & Ready'}
          </h2>

          <p className="text-sm sm:text-base text-slate-600 dark:text-slate-400 leading-relaxed max-w-xl mb-8 font-medium">
            {isRtl
              ? 'لا نعرض أي إعلانات وهمية أو تجريبية. تم تهيئة قاعدة البيانات لاستقبال الوحدات الحقيقية فقط مع مراجعة المستندات وجولات 3D الفعلية.'
              : 'HETTETY displays strictly real, verified listings with zero demo placeholders. Our catalog is freshly reset and ready for your first published property.'}
          </p>

          {/* Primary & Admin CTAs */}
          <div className="flex flex-wrap items-center justify-center gap-3 mb-10">
            {onAddProperty && (
              <button
                type="button"
                onClick={onAddProperty}
                className="inline-flex items-center gap-2 px-6 py-3.5 rounded-2xl bg-accent-500 hover:bg-accent-600 text-white font-black text-sm shadow-lg shadow-accent-500/25 hover:-translate-y-0.5 transition-all cursor-pointer focus:outline-none focus:ring-2 focus:ring-accent-400"
              >
                <PlusCircle size={18} aria-hidden="true" />
                <span>{isRtl ? 'أضف عقارك الآن' : 'Add Your Property'}</span>
              </button>
            )}

            {isAdmin && onOpenAdmin && (
              <button
                type="button"
                onClick={onOpenAdmin}
                className="inline-flex items-center gap-2 px-6 py-3.5 rounded-2xl bg-brand-600 hover:bg-brand-700 text-white font-bold text-sm shadow-lg shadow-brand-600/20 hover:-translate-y-0.5 transition-all cursor-pointer focus:outline-none focus:ring-2 focus:ring-brand-400"
              >
                <Shield size={17} aria-hidden="true" />
                <span>{isRtl ? 'فتح لوحة التحكم الإدارية' : 'Open Admin Command Center'}</span>
              </button>
            )}
          </div>

          {/* 3-Step Launch Highlights */}
          <div className="w-full grid grid-cols-1 sm:grid-cols-3 gap-3 text-start">
            {[
              {
                icon: <PlusCircle size={16} className="text-accent-500" aria-hidden="true" />,
                title: isRtl ? '1. أضف بيانات الوحدة' : '1. Submit Unit Specs',
                desc: isRtl
                  ? 'السعر، المساحة، خطة السداد، والموقع الدقيق.'
                  : 'Exact price, area, payment plan, and location.',
              },
              {
                icon: <FileCheck size={16} className="text-emerald-500" aria-hidden="true" />,
                title: isRtl ? '2. توثيق المستندات' : '2. Document Review',
                desc: isRtl
                  ? 'فريقنا يراجع العقود ويضيف شارة التحقق.'
                  : 'Our team reviews deeds and stamps verification.',
              },
              {
                icon: <Box size={16} className="text-brand-500" aria-hidden="true" />,
                title: isRtl ? '3. جولة 3D حقيقية' : '3. Real 3D Showcase',
                desc: isRtl
                  ? 'ارفع مسح 3D أو صور 360° لمعاينة غامرة.'
                  : 'Attach a 3D scan or 360° panorama for buyers.',
              },
            ].map((step, i) => (
              <div
                key={i}
                className="p-4 rounded-2xl bg-slate-50/90 dark:bg-slate-800/60 border border-slate-100 dark:border-slate-800"
              >
                <div className="flex items-center gap-2 font-bold text-xs text-slate-900 dark:text-white mb-1">
                  {step.icon}
                  <span>{step.title}</span>
                </div>
                <p className="text-xs text-slate-500 dark:text-slate-400 leading-relaxed">
                  {step.desc}
                </p>
              </div>
            ))}
          </div>
        </div>
      </section>
    );
  }

  // mode === 'no-matches'
  return (
    <section
      aria-label={isRtl ? 'لا توجد عقارات مطابقة للفلاتر' : 'No Matching Properties'}
      dir={isRtl ? 'rtl' : 'ltr'}
      className="rounded-3xl bg-white dark:bg-slate-900 border border-slate-200/80 dark:border-slate-800 shadow-sm px-6 sm:px-10 py-14 text-center animate-fade-in"
    >
      <div className="max-w-lg mx-auto flex flex-col items-center">
        <div className="w-18 h-18 rounded-3xl bg-accent-50 dark:bg-accent-950/40 border border-accent-200/70 dark:border-accent-800/60 text-accent-600 dark:text-accent-400 flex items-center justify-center mb-5 shadow-sm">
          <SearchX size={34} strokeWidth={1.7} aria-hidden="true" />
        </div>

        <h2 className="text-xl sm:text-2xl font-heading font-black text-slate-900 dark:text-white mb-2.5">
          {isRtl ? 'لم نجد وحدات تطابق معايير البحث الحالية' : 'No Units Match Your Current Filters'}
        </h2>

        <p className="text-sm text-slate-600 dark:text-slate-400 leading-relaxed mb-7 font-medium">
          {isRtl
            ? `جرّب توسيع نطاق السعر أو المساحة، أو إلغاء ${activeFilterCount > 0 ? `${activeFilterCount} فلاتر نشطة` : 'الفلاتر المحددة'}${totalInventoryCount > 0 ? ` لاستعراض جميع الوحدات المتاحة (${totalInventoryCount})` : ''}.`
            : `Try widening your price or area range, or clear ${activeFilterCount > 0 ? `${activeFilterCount} active ${activeFilterCount === 1 ? 'filter' : 'filters'}` : 'your current filters'}${totalInventoryCount > 0 ? ` to explore all ${totalInventoryCount} available listings` : ''}.`}
        </p>

        <div className="flex flex-wrap items-center justify-center gap-3">
          {onClearFilters && (
            <button
              type="button"
              onClick={onClearFilters}
              className="inline-flex items-center gap-2 px-6 py-3 rounded-2xl bg-brand-600 hover:bg-brand-700 text-white font-bold text-sm shadow-md shadow-brand-600/20 hover:-translate-y-0.5 transition-all cursor-pointer focus:outline-none focus:ring-2 focus:ring-brand-500"
            >
              <RotateCcw size={16} aria-hidden="true" />
              <span>{isRtl ? 'إعادة ضبط جميع الفلاتر' : 'Clear All Filters'}</span>
            </button>
          )}

          {onOpenAdvisor && (
            <button
              type="button"
              onClick={onOpenAdvisor}
              className="inline-flex items-center gap-2 px-5 py-3 rounded-2xl bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-800 dark:text-slate-200 font-bold text-sm border border-slate-200 dark:border-slate-700 transition-all cursor-pointer focus:outline-none focus:ring-2 focus:ring-brand-500"
            >
              <Sparkles size={15} className="text-accent-500" aria-hidden="true" />
              <span>{isRtl ? 'استشر المستشار الذكي' : 'Ask Smart Advisor'}</span>
            </button>
          )}
        </div>
      </div>
    </section>
  );
};

export default InventoryEmptyState;
