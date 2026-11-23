import React, { useMemo, useState } from 'react';
import {
  ArrowLeft,
  ArrowRight,
  ArrowUpDown,
  Box,
  Building2,
  Calendar,
  LayoutGrid,
  List,
  MapPin,
  Maximize,
  RotateCcw,
  SearchX,
  SlidersHorizontal,
  Tag,
  Trees,
} from 'lucide-react';
import { Property } from '../../../types';
import { BrandButton } from '../../../shared/ui/BrandButton';
import { PropertyImage } from '../../../shared/ui/PropertyImage';
import {
  tourKind,
  UNIT_CATEGORIES,
} from '../../../shared/utils/propertyFormatters';
import { ReshapedPropertyCard } from '../components/ReshapedPropertyCard';

export interface ProjectPageProps {
  projectName: string;
  units: Property[];
  onBack: () => void;
  onOpenProperty: (id: string) => void;
  onView3D: (id: string) => void;
  onToggleFavorite: (id: string) => void;
  userFavorites: string[];
  onToggleCompare: (id: string) => void;
  compareIds: string[];
  t: any;
  isRtl: boolean;
}

type ProjectSortOption = 'default' | 'price-asc' | 'area-desc';

/**
 * Architectural compound / project hub page: splits all units of a compound
 * into buyer-facing categories (Apartments / Villas / Chalets / Commercial / Land)
 * with per-category filtering, sorting, KPI overview, and ReshapedPropertyCard grid.
 */
export const ProjectPage: React.FC<ProjectPageProps> = ({
  projectName,
  units,
  onBack,
  onOpenProperty,
  onView3D,
  onToggleFavorite,
  userFavorites,
  onToggleCompare,
  compareIds,
  t,
  isRtl,
}) => {
  // Only show tabs for unit categories this project actually holds.
  const categories = useMemo(() => {
    const present = UNIT_CATEGORIES.map((c) => ({
      ...c,
      units: units.filter((u) => c.types.includes(u.propertyType || '')),
    })).filter((c) => c.units.length > 0);

    const categorised = new Set(present.flatMap((c) => c.units.map((u) => u.id)));
    const rest = units.filter((u) => !categorised.has(u.id));
    if (rest.length > 0) {
      present.push({
        key: 'other',
        ar: 'وحدات أخرى',
        en: 'Other units',
        types: [],
        units: rest,
      });
    }
    return present;
  }, [units]);

  const [tabIndex, setTabIndex] = useState(0);
  const [maxPrice, setMaxPrice] = useState<number | ''>('');
  const [minArea, setMinArea] = useState<number | ''>('');
  const [minBeds, setMinBeds] = useState(0);
  const [sortBy, setSortBy] = useState<ProjectSortOption>('default');
  const [viewMode, setViewMode] = useState<'grid' | 'list'>('grid');

  const clearFilters = () => {
    setMaxPrice('');
    setMinArea('');
    setMinBeds(0);
    setSortBy('default');
  };

  const tab = Math.min(tabIndex, Math.max(categories.length - 1, 0));
  const activeUnits = categories[tab] ? categories[tab].units : [];

  const shown = useMemo(() => {
    const filtered = activeUnits.filter(
      (u) =>
        (maxPrice === '' || u.price <= Number(maxPrice)) &&
        (minArea === '' || (u.area || 0) >= Number(minArea)) &&
        (minBeds === 0 || (u.bedrooms || 0) >= minBeds)
    );

    if (sortBy === 'price-asc') {
      return [...filtered].sort((a, b) => {
        const pa = a.price && a.price > 0 ? a.price : Number.MAX_SAFE_INTEGER;
        const pb = b.price && b.price > 0 ? b.price : Number.MAX_SAFE_INTEGER;
        return pa - pb;
      });
    }

    if (sortBy === 'area-desc') {
      return [...filtered].sort((a, b) => (b.area || 0) - (a.area || 0));
    }

    return filtered;
  }, [activeUnits, maxPrice, minArea, minBeds, sortBy]);

  const lead = units[0];
  const prices = useMemo(() => units.map((u) => u.price).filter((p) => p > 0), [units]);
  const areas = useMemo(() => units.map((u) => u.area).filter((a) => a > 0), [units]);
  const toursCount = useMemo(
    () =>
      units.filter((u) => {
        const kind = tourKind(u);
        return kind === 'walkthrough' || kind === 'pano';
      }).length,
    [units]
  );

  const currency = lead?.currency || 'EGP';
  const fmt = (n: number) => n.toLocaleString();
  const hasActiveFilters = maxPrice !== '' || minArea !== '' || minBeds > 0 || sortBy !== 'default';

  const minPriceValue = prices.length > 0 ? Math.min(...prices) : lead?.projectPriceFrom || 0;
  const minAreaValue = areas.length > 0 ? Math.min(...areas) : 0;
  const maxAreaValue = areas.length > 0 ? Math.max(...areas) : 0;

  return (
    <div dir={isRtl ? 'rtl' : 'ltr'} className="animate-fade-in pb-16">
      {/* Architectural Full-Bleed Hero */}
      <header className="relative min-h-[20rem] sm:min-h-[24rem] overflow-hidden bg-brand-950">
        {lead?.imageUrl ? (
          <PropertyImage
            src={lead.imageUrl}
            alt={projectName}
            priority
            iconSize={64}
            className="absolute inset-0 w-full h-full object-cover scale-[1.01]"
          />
        ) : (
          <div className="absolute inset-0 bg-gradient-to-br from-brand-800 via-brand-900 to-brand-950" />
        )}

        {/* Multi-stop editorial Navy scrim */}
        <div className="absolute inset-0 bg-gradient-to-t from-brand-950 via-brand-950/65 to-brand-950/30" />
        <div
          className={`absolute inset-0 ${
            isRtl
              ? 'bg-gradient-to-l from-brand-950/70 via-transparent to-transparent'
              : 'bg-gradient-to-r from-brand-950/70 via-transparent to-transparent'
          }`}
        />

        <div className="relative z-10 max-w-7xl mx-auto px-4 sm:px-6 min-h-[20rem] sm:min-h-[24rem] flex flex-col justify-between pt-6 pb-16">
          {/* Top bar: Back button + optional project facts pills */}
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <button
              type="button"
              onClick={onBack}
              className="inline-flex items-center gap-2 text-white/95 hover:text-white font-bold text-sm bg-brand-950/55 hover:bg-brand-900/80 backdrop-blur-md border border-white/20 px-4 py-2 rounded-full transition-all cursor-pointer focus:outline-none focus:ring-2 focus:ring-accent-400"
            >
              {isRtl ? <ArrowRight size={17} aria-hidden="true" /> : <ArrowLeft size={17} aria-hidden="true" />}
              {isRtl ? 'رجوع' : 'Back'}
            </button>

            <div className="flex items-center gap-2 flex-wrap">
              {lead?.projectAreaFeddan ? (
                <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-white/10 backdrop-blur-md border border-white/15 text-white text-xs font-bold">
                  <Building2 size={13} className="text-accent-300" aria-hidden="true" />
                  <span>
                    {lead.projectAreaFeddan} {isRtl ? 'فدان' : 'feddan'}
                  </span>
                </span>
              ) : null}
              {lead?.greenSpacePercent ? (
                <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-emerald-500/20 backdrop-blur-md border border-emerald-300/30 text-emerald-100 text-xs font-bold">
                  <Trees size={13} aria-hidden="true" />
                  <span>
                    {lead.greenSpacePercent}% {isRtl ? 'مساحات خضراء' : 'green space'}
                  </span>
                </span>
              ) : null}
            </div>
          </div>

          {/* Compound Headline + Metadata */}
          <div className="mt-8">
            <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-accent-500/90 text-white text-[11px] font-black uppercase tracking-wider mb-3 shadow-md">
              <Building2 size={12} aria-hidden="true" />
              <span>{isRtl ? 'ملف المشروع' : 'Project Hub'}</span>
            </span>

            <h1 className="text-3xl sm:text-5xl font-heading font-black text-white tracking-tight leading-tight mb-3">
              {projectName}
            </h1>

            <div className="flex items-center gap-x-5 gap-y-2 flex-wrap text-white/85 text-sm font-medium">
              {lead?.developer && (
                <span className="inline-flex items-center gap-1.5">
                  <span className="text-white/65">{isRtl ? 'المطوّر:' : 'Developer:'}</span>
                  <strong className="text-white font-extrabold">{lead.developer}</strong>
                </span>
              )}
              {lead?.location && (
                <span className="inline-flex items-center gap-1.5">
                  <MapPin size={15} className="text-accent-400 shrink-0" aria-hidden="true" />
                  <span>{lead.location}</span>
                </span>
              )}
              {lead?.deliveryDate && (
                <span className="inline-flex items-center gap-1.5">
                  <Calendar size={14} className="text-accent-400 shrink-0" aria-hidden="true" />
                  <span className="text-white/65">{isRtl ? 'الاستلام:' : 'Delivery:'}</span>
                  <strong className="text-white font-bold">{lead.deliveryDate}</strong>
                </span>
              )}
            </div>
          </div>
        </div>
      </header>

      {/* Main Content Container */}
      <div className="max-w-7xl mx-auto px-4 sm:px-6">
        {/* Elevated 4-Tile KPI Strip */}
        <section
          aria-label={isRtl ? 'إحصائيات المشروع' : 'Project overview metrics'}
          className="-mt-10 relative z-20 grid grid-cols-2 lg:grid-cols-4 gap-3.5 sm:gap-4 mb-8"
        >
          {/* KPI 1: Units available */}
          <div className="bg-white dark:bg-slate-900 rounded-2xl p-5 border border-slate-200/90 dark:border-slate-800 shadow-lg shadow-brand-950/5 flex items-center gap-4">
            <div className="w-11 h-11 rounded-2xl bg-brand-50 dark:bg-brand-900/40 text-brand-600 dark:text-brand-300 flex items-center justify-center shrink-0">
              <Building2 size={21} aria-hidden="true" />
            </div>
            <div className="min-w-0">
              <div className="text-2xl font-black text-slate-900 dark:text-white leading-none tabular-nums">
                {units.length}
              </div>
              <div className="text-xs font-semibold text-slate-500 dark:text-slate-400 mt-1.5">
                {isRtl ? 'وحدة متاحة' : 'Units available'}
              </div>
            </div>
          </div>

          {/* KPI 2: Starting Price */}
          <div className="bg-white dark:bg-slate-900 rounded-2xl p-5 border border-slate-200/90 dark:border-slate-800 shadow-lg shadow-brand-950/5 flex items-center gap-4">
            <div className="w-11 h-11 rounded-2xl bg-accent-50 dark:bg-accent-950/40 text-accent-600 dark:text-accent-400 flex items-center justify-center shrink-0">
              <Tag size={21} aria-hidden="true" />
            </div>
            <div className="min-w-0">
              <div className="text-base sm:text-lg font-black text-brand-700 dark:text-accent-400 leading-tight truncate tabular-nums">
                {minPriceValue > 0
                  ? `${isRtl ? 'تبدأ من' : 'From'} ${fmt(minPriceValue)}`
                  : isRtl
                    ? 'السعر عند الطلب'
                    : 'Price on request'}
              </div>
              <div className="text-xs font-semibold text-slate-500 dark:text-slate-400 mt-1">
                {minPriceValue > 0 ? currency : isRtl ? 'تواصل للتسعير' : 'Contact for quote'}
              </div>
            </div>
          </div>

          {/* KPI 3: Area Range */}
          <div className="bg-white dark:bg-slate-900 rounded-2xl p-5 border border-slate-200/90 dark:border-slate-800 shadow-lg shadow-brand-950/5 flex items-center gap-4">
            <div className="w-11 h-11 rounded-2xl bg-brand-50 dark:bg-brand-900/40 text-brand-600 dark:text-brand-300 flex items-center justify-center shrink-0">
              <Maximize size={20} aria-hidden="true" />
            </div>
            <div className="min-w-0">
              <div className="text-base sm:text-lg font-black text-slate-900 dark:text-white leading-tight truncate tabular-nums">
                {areas.length > 0
                  ? minAreaValue === maxAreaValue
                    ? `${minAreaValue}`
                    : `${minAreaValue} – ${maxAreaValue}`
                  : '—'}
              </div>
              <div className="text-xs font-semibold text-slate-500 dark:text-slate-400 mt-1">
                {isRtl ? 'نطاق المساحة (م²)' : 'Area range (m²)'}
              </div>
            </div>
          </div>

          {/* KPI 4: 3D / 360° Tours Count */}
          <div className="bg-white dark:bg-slate-900 rounded-2xl p-5 border border-slate-200/90 dark:border-slate-800 shadow-lg shadow-brand-950/5 flex items-center gap-4">
            <div className="w-11 h-11 rounded-2xl bg-accent-50 dark:bg-accent-950/40 text-accent-600 dark:text-accent-400 flex items-center justify-center shrink-0">
              <Box size={21} aria-hidden="true" />
            </div>
            <div className="min-w-0">
              <div className="text-2xl font-black text-slate-900 dark:text-white leading-none tabular-nums">
                {toursCount}
              </div>
              <div className="text-xs font-semibold text-slate-500 dark:text-slate-400 mt-1.5">
                {isRtl ? 'جولات 3D / 360°' : '3D / 360° Tours'}
              </div>
            </div>
          </div>
        </section>

        {/* Category Tablist (EXACT textContent contract: `${label} (${count})`) */}
        {categories.length > 0 && (
          <div
            role="tablist"
            aria-label={isRtl ? 'أنواع الوحدات' : 'Unit types'}
            className="flex items-center gap-2 flex-wrap mb-6 border-b border-slate-200 dark:border-slate-800"
          >
            {categories.map((c, i) => {
              const selected = i === tab;
              return (
                <button
                  key={c.key}
                  type="button"
                  role="tab"
                  aria-selected={selected}
                  onClick={() => {
                    setTabIndex(i);
                    clearFilters();
                  }}
                  className={`px-5 py-3.5 font-bold text-sm transition-all border-b-2 -mb-px cursor-pointer rounded-t-xl focus:outline-none focus:ring-2 focus:ring-brand-500 ${
                    selected
                      ? 'border-accent-500 text-brand-700 dark:text-accent-400 bg-brand-50/60 dark:bg-brand-900/25'
                      : 'border-transparent text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800/50'
                  }`}
                >
                  {isRtl ? c.ar : c.en}{' '}
                  <span className="text-xs opacity-75">({c.units.length})</span>
                </button>
              );
            })}
          </div>
        )}

        {/* Pill-Style Filter & Sort Card */}
        {units.length > 0 && (
          <section
            aria-label={isRtl ? 'فلاتر وحدات المشروع' : 'Project unit filters'}
            className="bg-white dark:bg-slate-900 rounded-3xl border border-slate-200/90 dark:border-slate-800 shadow-sm p-5 mb-6"
          >
            <div className="flex items-center justify-between gap-3 mb-4">
              <div className="flex items-center gap-2 text-xs font-black uppercase tracking-wider text-slate-500 dark:text-slate-400">
                <SlidersHorizontal size={14} className="text-accent-500" aria-hidden="true" />
                <span>{isRtl ? 'تصفية وترتيب الوحدات' : 'Filter & sort units'}</span>
              </div>

              {hasActiveFilters && shown.length > 0 && (
                <button
                  type="button"
                  onClick={clearFilters}
                  className="inline-flex items-center gap-1.5 text-xs font-bold text-brand-600 dark:text-accent-400 hover:underline cursor-pointer"
                >
                  <RotateCcw size={12} aria-hidden="true" />
                  <span>{isRtl ? 'إعادة تعيين' : 'Reset'}</span>
                </button>
              )}
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
              <div>
                <label
                  htmlFor="proj-price"
                  className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-1.5"
                >
                  {isRtl ? 'أقصى سعر' : 'Max price'}
                </label>
                <input
                  id="proj-price"
                  type="number"
                  min="0"
                  value={maxPrice}
                  onChange={(e) => setMaxPrice(e.target.value === '' ? '' : Number(e.target.value))}
                  placeholder={prices.length ? fmt(Math.max(...prices)) : ''}
                  className="w-full px-4 py-2.5 rounded-full border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950/60 text-slate-900 dark:text-white text-sm outline-none focus:ring-2 focus:ring-brand-500 focus:bg-white dark:focus:bg-slate-900 transition-colors"
                />
              </div>

              <div>
                <label
                  htmlFor="proj-area"
                  className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-1.5"
                >
                  {isRtl ? 'أقل مساحة (م²)' : 'Min area (m²)'}
                </label>
                <input
                  id="proj-area"
                  type="number"
                  min="0"
                  value={minArea}
                  onChange={(e) => setMinArea(e.target.value === '' ? '' : Number(e.target.value))}
                  placeholder={areas.length ? String(minAreaValue) : ''}
                  className="w-full px-4 py-2.5 rounded-full border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950/60 text-slate-900 dark:text-white text-sm outline-none focus:ring-2 focus:ring-brand-500 focus:bg-white dark:focus:bg-slate-900 transition-colors"
                />
              </div>

              <div>
                <label
                  htmlFor="proj-beds"
                  className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-1.5"
                >
                  {isRtl ? 'عدد الغرف' : 'Bedrooms'}
                </label>
                <select
                  id="proj-beds"
                  value={minBeds}
                  onChange={(e) => setMinBeds(Number(e.target.value))}
                  className="w-full px-4 py-2.5 rounded-full border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950/60 text-slate-900 dark:text-white text-sm outline-none focus:ring-2 focus:ring-brand-500 focus:bg-white dark:focus:bg-slate-900 transition-colors cursor-pointer"
                >
                  <option value={0}>{isRtl ? 'أي عدد' : 'Any'}</option>
                  {[1, 2, 3, 4, 5].map((n) => (
                    <option key={n} value={n}>
                      {n}+
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label
                  htmlFor="proj-sort"
                  className="flex items-center gap-1.5 text-xs font-bold text-slate-700 dark:text-slate-300 mb-1.5"
                >
                  <ArrowUpDown size={12} className="text-slate-400" aria-hidden="true" />
                  <span>{isRtl ? 'الترتيب' : 'Sort by'}</span>
                </label>
                <select
                  id="proj-sort"
                  value={sortBy}
                  onChange={(e) => setSortBy(e.target.value as ProjectSortOption)}
                  className="w-full px-4 py-2.5 rounded-full border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950/60 text-slate-900 dark:text-white text-sm outline-none focus:ring-2 focus:ring-brand-500 focus:bg-white dark:focus:bg-slate-900 transition-colors cursor-pointer"
                >
                  <option value="default">{isRtl ? 'الافتراضي' : 'Default'}</option>
                  <option value="price-asc">{isRtl ? 'السعر: من الأقل للأعلى' : 'Price: Low to High'}</option>
                  <option value="area-desc">{isRtl ? 'المساحة: من الأكبر للأصغر' : 'Area: Large to Small'}</option>
                </select>
              </div>
            </div>
          </section>
        )}

        {/* Live Result Count + Layout Switcher */}
        <div className="flex items-center justify-between gap-3 mb-5 flex-wrap">
          <p className="text-sm font-semibold text-slate-600 dark:text-slate-400" aria-live="polite">
            {isRtl
              ? `${shown.length} من ${activeUnits.length} وحدة`
              : `Showing ${shown.length} of ${activeUnits.length} units`}
          </p>

          {shown.length > 0 && (
            <div
              className="inline-flex items-center p-1 rounded-full bg-slate-100 dark:bg-slate-800/80 border border-slate-200/70 dark:border-slate-700"
              role="group"
              aria-label={isRtl ? 'طريقة عرض الوحدات' : 'Unit layout mode'}
            >
              <button
                type="button"
                onClick={() => setViewMode('grid')}
                aria-pressed={viewMode === 'grid'}
                aria-label={isRtl ? 'عرض شبكي' : 'Grid view'}
                className={`p-2 rounded-full transition-colors cursor-pointer ${
                  viewMode === 'grid'
                    ? 'bg-white dark:bg-slate-900 text-brand-700 dark:text-accent-400 shadow-xs'
                    : 'text-slate-500 dark:text-slate-400 hover:text-slate-800 dark:hover:text-white'
                }`}
              >
                <LayoutGrid size={15} aria-hidden="true" />
              </button>
              <button
                type="button"
                onClick={() => setViewMode('list')}
                aria-pressed={viewMode === 'list'}
                aria-label={isRtl ? 'عرض قائمة' : 'List view'}
                className={`p-2 rounded-full transition-colors cursor-pointer ${
                  viewMode === 'list'
                    ? 'bg-white dark:bg-slate-900 text-brand-700 dark:text-accent-400 shadow-xs'
                    : 'text-slate-500 dark:text-slate-400 hover:text-slate-800 dark:hover:text-white'
                }`}
              >
                <List size={15} aria-hidden="true" />
              </button>
            </div>
          )}
        </div>

        {/* Units Grid / List or Refined Empty State */}
        {units.length === 0 ? (
          <div className="bg-slate-50/80 dark:bg-slate-900/60 border-2 border-dashed border-slate-200 dark:border-slate-800 rounded-3xl py-16 px-6 text-center max-w-2xl mx-auto">
            <div className="w-14 h-14 mx-auto rounded-2xl bg-brand-50 dark:bg-brand-900/40 text-brand-600 dark:text-accent-400 flex items-center justify-center mb-4">
              <Building2 size={26} aria-hidden="true" />
            </div>
            <p className="text-lg font-heading font-extrabold text-slate-900 dark:text-white mb-2">
              {isRtl ? 'لا توجد وحدات متاحة حالياً في هذا المشروع.' : 'No units are currently listed in this project.'}
            </p>
            <p className="text-sm text-slate-500 dark:text-slate-400">
              {isRtl
                ? 'يمكنك الرجوع لاستعراض المشروعات والعقارات المتاحة الأخرى.'
                : 'Return to browse other available compounds and listings.'}
            </p>
          </div>
        ) : shown.length === 0 ? (
          <div className="bg-slate-50/80 dark:bg-slate-900/60 border-2 border-dashed border-slate-200 dark:border-slate-800 rounded-3xl py-16 px-6 text-center max-w-2xl mx-auto">
            <div className="w-14 h-14 mx-auto rounded-2xl bg-brand-50 dark:bg-brand-900/40 text-brand-600 dark:text-accent-400 flex items-center justify-center mb-4">
              <SearchX size={26} aria-hidden="true" />
            </div>
            <p className="text-lg font-heading font-extrabold text-slate-900 dark:text-white mb-2">
              {isRtl ? 'مفيش وحدات مطابقة للاختيارات دي.' : 'No units match these filters.'}
            </p>
            <p className="text-sm text-slate-500 dark:text-slate-400 mb-6">
              {isRtl
                ? 'جرّب تعديل السعر أو المساحة أو امسح الفلاتر عشان تشوف كل وحدات الفئة دي.'
                : 'Try adjusting the price, area, or bedrooms, or clear your filters to browse every unit in this category.'}
            </p>
            <BrandButton
              variant="primary"
              onClick={clearFilters}
              className="rounded-full px-7 py-3 text-sm"
            >
              {isRtl ? 'امسح الفلاتر' : 'Clear filters'}
            </BrandButton>
          </div>
        ) : (
          <div
            className={
              viewMode === 'list'
                ? 'flex flex-col gap-5'
                : 'grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6 sm:gap-7'
            }
          >
            {shown.map((p) => (
              <ReshapedPropertyCard
                key={p.id}
                property={p}
                variant={viewMode}
                onView3D={() => onView3D(p.id)}
                onToggleFavorite={() => onToggleFavorite(p.id)}
                isFavorited={userFavorites.includes(p.id)}
                onToggleCompare={() => onToggleCompare(p.id)}
                isComparing={compareIds.includes(p.id)}
                onClick={() => onOpenProperty(p.id)}
                t={t}
                isRtl={isRtl}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
};

export default ProjectPage;
