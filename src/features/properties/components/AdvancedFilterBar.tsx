import React, { useMemo, useState } from 'react';
import {
  Search,
  Sparkles,
  Loader2,
  DollarSign,
  SlidersHorizontal,
  X,
  Save,
  Bell,
  LayoutGrid,
  List,
  Building2,
  ShieldCheck,
  Box,
  CreditCard,
  Waves,
  RotateCcw,
  ChevronDown,
  ChevronUp,
  Maximize2,
} from 'lucide-react';
import {
  PropertyFilterCriteria,
  PropertyDisplayMode,
  PropertySortOption,
} from '../../../core/domain/entities';
import {
  countActiveFilters,
  countAdvancedFilters,
  DistrictFacet,
} from '../../../core/use-cases/FilterPropertiesUseCase';
import { PROPERTY_TYPES } from '../../../components/add-listing-page';

export interface SavedSearchItem {
  id: string;
  q?: string;
  typeFilter?: string;
  minPrice?: string | number;
  maxPrice?: string | number;
  sortBy?: PropertySortOption;
  criteria?: Partial<PropertyFilterCriteria>;
}

export interface AdvancedFilterBarProps {
  criteria: PropertyFilterCriteria;
  onChange: (next: PropertyFilterCriteria) => void;
  onReset: () => void;
  onAiSearch?: () => void;
  isAiSearching?: boolean;
  displayMode: PropertyDisplayMode;
  onDisplayModeChange: (mode: PropertyDisplayMode) => void;
  totalCount: number;
  filteredCount: number;
  districtFacets?: DistrictFacet[];
  savedSearches?: SavedSearchItem[];
  onSaveSearch?: () => void;
  onApplySavedSearch?: (item: SavedSearchItem) => void;
  onRemoveSavedSearch?: (id: string) => void;
  onSubscribeAlert?: () => void;
  t: any;
  isRtl: boolean;
}

const FALLBACK_DISTRICTS = [
  { value: 'New Cairo', en: 'New Cairo', ar: 'القاهرة الجديدة' },
  { value: 'Sheikh Zayed', en: 'Sheikh Zayed', ar: 'الشيخ زايد' },
  { value: '6th of October', en: '6th of October', ar: '6 أكتوبر' },
  { value: 'North Coast', en: 'North Coast', ar: 'الساحل الشمالي' },
  { value: 'New Capital', en: 'New Capital', ar: 'العاصمة الإدارية' },
  { value: 'Maadi', en: 'Maadi', ar: 'المعادي' },
  { value: 'Shorouk', en: 'Shorouk', ar: 'الشروق' },
];

const BEDROOM_OPTIONS = [0, 1, 2, 3, 4, 5] as const;
const BATHROOM_OPTIONS = [0, 1, 2, 3, 4] as const;

export const AdvancedFilterBar: React.FC<AdvancedFilterBarProps> = ({
  criteria,
  onChange,
  onReset,
  onAiSearch,
  isAiSearching = false,
  displayMode,
  onDisplayModeChange,
  totalCount,
  filteredCount,
  districtFacets = [],
  savedSearches = [],
  onSaveSearch,
  onApplySavedSearch,
  onRemoveSavedSearch,
  onSubscribeAlert,
  t,
  isRtl,
}) => {
  const [isExpanded, setIsExpanded] = useState(false);
  const [lastUnitsLayout, setLastUnitsLayout] = useState<'grid' | 'list'>(
    displayMode === 'list' ? 'list' : 'grid'
  );

  const totalActiveCount = useMemo(() => countActiveFilters(criteria), [criteria]);
  const advancedActiveCount = useMemo(() => countAdvancedFilters(criteria), [criteria]);

  const patch = (partial: Partial<PropertyFilterCriteria>) => {
    onChange({ ...criteria, ...partial });
  };

  const handleUnitsTabClick = () => {
    onDisplayModeChange(lastUnitsLayout);
  };

  const handleLayoutClick = (layout: 'grid' | 'list') => {
    setLastUnitsLayout(layout);
    onDisplayModeChange(layout);
  };

  const districtOptions = useMemo(() => {
    if (districtFacets.length > 0) {
      return districtFacets.map((f) => ({
        value: f.name,
        label: `${f.name} (${f.count})`,
      }));
    }
    return FALLBACK_DISTRICTS.map((d) => ({
      value: d.value,
      label: isRtl ? d.ar : d.en,
    }));
  }, [districtFacets, isRtl]);

  const activeChips = useMemo(() => {
    const chips: Array<{ key: string; label: string; onRemove: () => void }> = [];

    if (criteria.query.trim()) {
      chips.push({
        key: 'query',
        label: isRtl ? `بحث: "${criteria.query.trim()}"` : `Search: "${criteria.query.trim()}"`,
        onRemove: () => patch({ query: '', aiFilteredIds: null }),
      });
    }
    if (criteria.aiFilteredIds !== null) {
      chips.push({
        key: 'ai',
        label: isRtl ? 'تطابق ذكي بالذكاء الاصطناعي' : 'AI Smart Match',
        onRemove: () => patch({ aiFilteredIds: null }),
      });
    }
    if (criteria.type !== 'all') {
      const opt = PROPERTY_TYPES.find((o) => o.value === criteria.type);
      chips.push({
        key: 'type',
        label: opt ? (isRtl ? opt.ar : opt.en) : criteria.type,
        onRemove: () => patch({ type: 'all' }),
      });
    }
    if (criteria.listingStatus !== 'all') {
      chips.push({
        key: 'status',
        label:
          criteria.listingStatus === 'For Sale'
            ? t.prop_forsale || (isRtl ? 'للبيع' : 'For Sale')
            : t.prop_forrent || (isRtl ? 'للإيجار' : 'For Rent'),
        onRemove: () => patch({ listingStatus: 'all' }),
      });
    }
    if (criteria.minPrice.trim()) {
      chips.push({
        key: 'minPrice',
        label: isRtl
          ? `أقل سعر: ${Number(criteria.minPrice).toLocaleString()}`
          : `Min: ${Number(criteria.minPrice).toLocaleString()}`,
        onRemove: () => patch({ minPrice: '' }),
      });
    }
    if (criteria.maxPrice.trim()) {
      chips.push({
        key: 'maxPrice',
        label: isRtl
          ? `أعلى سعر: ${Number(criteria.maxPrice).toLocaleString()}`
          : `Max: ${Number(criteria.maxPrice).toLocaleString()}`,
        onRemove: () => patch({ maxPrice: '' }),
      });
    }
    if (criteria.minArea.trim()) {
      chips.push({
        key: 'minArea',
        label: isRtl ? `المساحة من ${criteria.minArea} م²` : `Min ${criteria.minArea} m²`,
        onRemove: () => patch({ minArea: '' }),
      });
    }
    if (criteria.maxArea.trim()) {
      chips.push({
        key: 'maxArea',
        label: isRtl ? `المساحة حتى ${criteria.maxArea} م²` : `Max ${criteria.maxArea} m²`,
        onRemove: () => patch({ maxArea: '' }),
      });
    }
    if (criteria.minBedrooms > 0) {
      chips.push({
        key: 'beds',
        label: isRtl ? `${criteria.minBedrooms}+ غرف نوم` : `${criteria.minBedrooms}+ Beds`,
        onRemove: () => patch({ minBedrooms: 0 }),
      });
    }
    if (criteria.minBathrooms > 0) {
      chips.push({
        key: 'baths',
        label: isRtl ? `${criteria.minBathrooms}+ حمام` : `${criteria.minBathrooms}+ Baths`,
        onRemove: () => patch({ minBathrooms: 0 }),
      });
    }
    if (criteria.finishing !== 'all') {
      const finLabels: Record<string, { ar: string; en: string }> = {
        'Fully Finished': { ar: 'تشطيب كامل / سوبر لوكس', en: 'Fully Finished' },
        'Semi Finished': { ar: 'نصف تشطيب', en: 'Semi Finished' },
        'Not Finished': { ar: 'على المحارة', en: 'Not Finished' },
      };
      const lbl = finLabels[criteria.finishing];
      chips.push({
        key: 'finishing',
        label: lbl ? (isRtl ? lbl.ar : lbl.en) : criteria.finishing,
        onRemove: () => patch({ finishing: 'all' }),
      });
    }
    if (criteria.deliveryTimeline !== 'all') {
      const delLabels: Record<string, { ar: string; en: string }> = {
        ready: { ar: 'استلام فوري', en: 'Ready to Move' },
        '1-2years': { ar: 'استلام خلال 1-2 سنة', en: '1–2 Years Delivery' },
        '3+years': { ar: 'تحت الإنشاء (+3 سنوات)', en: '3+ Years Delivery' },
      };
      const lbl = delLabels[criteria.deliveryTimeline];
      chips.push({
        key: 'delivery',
        label: lbl ? (isRtl ? lbl.ar : lbl.en) : criteria.deliveryTimeline,
        onRemove: () => patch({ deliveryTimeline: 'all' }),
      });
    }
    if (criteria.district !== 'all') {
      chips.push({
        key: 'district',
        label: isRtl ? `المنطقة: ${criteria.district}` : `District: ${criteria.district}`,
        onRemove: () => patch({ district: 'all' }),
      });
    }
    if (criteria.verifiedOnly) {
      chips.push({
        key: 'verifiedOnly',
        label: isRtl ? 'مستندات مُراجعة فقط' : 'Verified Only',
        onRemove: () => patch({ verifiedOnly: false }),
      });
    }
    if (criteria.has3DOnly) {
      chips.push({
        key: 'has3DOnly',
        label: isRtl ? 'جولة 3D حقيقية فقط' : 'Real 3D Tour Only',
        onRemove: () => patch({ has3DOnly: false }),
      });
    }
    if (criteria.installmentsOnly) {
      chips.push({
        key: 'installmentsOnly',
        label: isRtl ? 'متاح بالتقسيط' : 'Installments Available',
        onRemove: () => patch({ installmentsOnly: false }),
      });
    }
    if (criteria.yallaSahelOnly) {
      chips.push({
        key: 'yallaSahelOnly',
        label: isRtl ? 'ساحل حِتّتي' : 'Sahel Hettety',
        onRemove: () => patch({ yallaSahelOnly: false }),
      });
    }

    return chips;
  }, [criteria, isRtl, t]);

  return (
    <section
      aria-label={isRtl ? 'شريط البحث والفلاتر العقارية' : 'Property Search & Filters'}
      className="w-full space-y-4 mb-8"
      dir={isRtl ? 'rtl' : 'ltr'}
    >
      {/* Main Elevated Luxury Filter Container */}
      <div className="bg-white dark:bg-slate-900 rounded-3xl border border-slate-200/80 dark:border-slate-800 shadow-lg shadow-brand-900/5 dark:shadow-none p-4 sm:p-5 space-y-4">
        {/* Primary Filter Row — IMPORTANT: Property Type select MUST remain the first combobox */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-12 gap-3 items-stretch">
          {/* Search Input + AI Search Trigger */}
          <div className="sm:col-span-2 lg:col-span-4 flex gap-2 min-w-0">
            <div className="relative flex-1 min-w-0">
              <Search
                size={16}
                aria-hidden="true"
                className="absolute top-1/2 -translate-y-1/2 start-3.5 text-slate-400 pointer-events-none"
              />
              <input
                type="text"
                value={criteria.query}
                onChange={(e) => patch({ query: e.target.value, aiFilteredIds: null })}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && onAiSearch) {
                    onAiSearch();
                  }
                }}
                placeholder={t.prop_search}
                aria-label={t.prop_search}
                className="w-full h-11 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50/70 dark:bg-slate-800/70 focus:bg-white dark:focus:bg-slate-900 focus:ring-2 focus:ring-brand-500 focus:border-brand-500 outline-none text-slate-900 dark:text-white ps-10 pe-8 text-xs sm:text-sm font-medium transition-all placeholder:text-slate-400"
              />
              {criteria.query && (
                <button
                  type="button"
                  onClick={() => patch({ query: '', aiFilteredIds: null })}
                  aria-label={isRtl ? 'مسح نص البحث' : 'Clear search query'}
                  className="absolute top-1/2 -translate-y-1/2 end-2.5 p-1 text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 rounded-full transition-colors cursor-pointer"
                >
                  <X size={14} aria-hidden="true" />
                </button>
              )}
            </div>
            {onAiSearch && (
              <button
                type="button"
                onClick={onAiSearch}
                disabled={isAiSearching || !criteria.query.trim()}
                title={isRtl ? 'بحث ذكي بالذكاء الاصطناعي' : 'AI Smart Search'}
                aria-label={isRtl ? 'بحث ذكي بالذكاء الاصطناعي' : 'AI Smart Search'}
                className="h-11 px-3.5 rounded-xl bg-brand-600 hover:bg-brand-700 text-white font-bold text-xs flex items-center justify-center gap-1.5 shadow-sm shadow-brand-600/20 disabled:opacity-45 disabled:cursor-not-allowed transition-all cursor-pointer shrink-0 focus:outline-none focus:ring-2 focus:ring-brand-500"
              >
                {isAiSearching ? (
                  <Loader2 size={16} className="animate-spin" aria-hidden="true" />
                ) : (
                  <Sparkles size={16} aria-hidden="true" />
                )}
                <span className="hidden xl:inline">{isRtl ? 'ذكي' : 'AI'}</span>
              </button>
            )}
          </div>

          {/* FIRST Combobox: Property Type Filter */}
          <div className="lg:col-span-2">
            <select
              value={criteria.type}
              onChange={(e) => patch({ type: e.target.value })}
              aria-label={isRtl ? 'نوع العقار' : 'Property Type'}
              className="w-full h-11 px-3.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50/70 dark:bg-slate-800/70 focus:bg-white dark:focus:bg-slate-900 focus:ring-2 focus:ring-brand-500 outline-none text-slate-900 dark:text-white text-xs sm:text-sm font-semibold transition-all cursor-pointer"
            >
              <option value="all">{isRtl ? 'كل الأنواع' : 'All Types'}</option>
              {PROPERTY_TYPES.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {isRtl ? opt.ar : opt.en}
                </option>
              ))}
            </select>
          </div>

          {/* Min & Max Price Inputs */}
          <div className="relative lg:col-span-2">
            <div className="grid grid-cols-2 gap-2">
              <div className="relative">
                <DollarSign
                  size={13}
                  aria-hidden="true"
                  className="absolute top-1/2 -translate-y-1/2 start-2.5 text-slate-400 pointer-events-none"
                />
                <input
                  type="number"
                  min="0"
                  value={criteria.minPrice}
                  onChange={(e) => {
                    const val = e.target.value;
                    if (val === '' || Number(val) >= 0) patch({ minPrice: val });
                  }}
                  placeholder={isRtl ? 'أقل سعر' : 'Min Price'}
                  aria-label={isRtl ? 'أقل سعر' : 'Min Price'}
                  className="w-full h-11 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50/70 dark:bg-slate-800/70 focus:bg-white dark:focus:bg-slate-900 focus:ring-2 focus:ring-brand-500 outline-none text-slate-900 dark:text-white ps-7 pe-2 text-xs font-medium [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                />
              </div>
              <div className="relative">
                <DollarSign
                  size={13}
                  aria-hidden="true"
                  className="absolute top-1/2 -translate-y-1/2 start-2.5 text-slate-400 pointer-events-none"
                />
                <input
                  type="number"
                  min="0"
                  value={criteria.maxPrice}
                  onChange={(e) => {
                    const val = e.target.value;
                    if (val === '' || Number(val) >= 0) patch({ maxPrice: val });
                  }}
                  placeholder={isRtl ? 'أعلى سعر' : 'Max Price'}
                  aria-label={isRtl ? 'أعلى سعر' : 'Max Price'}
                  className="w-full h-11 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50/70 dark:bg-slate-800/70 focus:bg-white dark:focus:bg-slate-900 focus:ring-2 focus:ring-brand-500 outline-none text-slate-900 dark:text-white ps-7 pe-2 text-xs font-medium [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                />
              </div>
            </div>
          </div>

          {/* Sort Select Dropdown */}
          <div className="lg:col-span-2">
            <select
              value={criteria.sortBy}
              onChange={(e) => patch({ sortBy: e.target.value as PropertySortOption })}
              aria-label={isRtl ? 'ترتيب النتائج' : 'Sort Properties'}
              className="w-full h-11 px-3 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50/70 dark:bg-slate-800/70 focus:bg-white dark:focus:bg-slate-900 focus:ring-2 focus:ring-brand-500 outline-none text-slate-900 dark:text-white text-xs sm:text-sm font-semibold transition-all cursor-pointer"
            >
              <option value="default">{isRtl ? 'الترتيب الافتراضي' : 'Default Sort'}</option>
              <option value="newest">{isRtl ? 'الأحدث إضافة' : 'Newest First'}</option>
              <option value="price-asc">{isRtl ? 'السعر: من الأقل للأعلى' : 'Price: Low to High'}</option>
              <option value="price-desc">{isRtl ? 'السعر: من الأعلى للأقل' : 'Price: High to Low'}</option>
              <option value="price-per-sqm-asc">{isRtl ? 'أفضل سعر للمتر' : 'Best Price / m²'}</option>
              <option value="area-desc">{isRtl ? 'الأكبر مساحة' : 'Largest Area'}</option>
              <option value="name-asc">{isRtl ? 'الاسم: أ إلى ي' : 'Name: A to Z'}</option>
              <option value="name-desc">{isRtl ? 'الاسم: ي إلى أ' : 'Name: Z to A'}</option>
            </select>
          </div>

          {/* Expandable Advanced Filters Toggle */}
          <div className="lg:col-span-2">
            <button
              type="button"
              onClick={() => setIsExpanded((prev) => !prev)}
              aria-expanded={isExpanded}
              aria-controls="advanced-filters-panel"
              className={`w-full h-11 px-3.5 rounded-xl border font-bold text-xs sm:text-sm flex items-center justify-center gap-2 transition-all cursor-pointer focus:outline-none focus:ring-2 focus:ring-brand-500 ${
                isExpanded || advancedActiveCount > 0
                  ? 'bg-brand-600 text-white border-brand-600 shadow-md shadow-brand-600/20'
                  : 'bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-200 border-slate-200 dark:border-slate-700 hover:border-brand-400 hover:text-brand-600 dark:hover:text-brand-400'
              }`}
            >
              <SlidersHorizontal size={15} aria-hidden="true" />
              <span className="truncate">{isRtl ? 'فلاتر متقدمة' : 'Advanced Filters'}</span>
              {advancedActiveCount > 0 && (
                <span className="inline-flex items-center justify-center min-w-[20px] h-5 px-1.5 rounded-full bg-accent-500 text-white text-[10px] font-black">
                  {advancedActiveCount}
                </span>
              )}
              {isExpanded ? (
                <ChevronUp size={14} aria-hidden="true" className="shrink-0" />
              ) : (
                <ChevronDown size={14} aria-hidden="true" className="shrink-0" />
              )}
            </button>
          </div>
        </div>

        {/* Expandable Advanced Filters Panel */}
        {isExpanded && (
          <div
            id="advanced-filters-panel"
            className="pt-4 border-t border-slate-100 dark:border-slate-800 space-y-5 animate-fade-in"
          >
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
              {/* Listing Status Segmented Control */}
              <div className="space-y-1.5">
                <span className="block text-[11px] font-black uppercase tracking-wider text-slate-500 dark:text-slate-400">
                  {isRtl ? 'غرض الإعلان' : 'Listing Status'}
                </span>
                <div className="grid grid-cols-3 gap-1 p-1 rounded-xl bg-slate-100 dark:bg-slate-800">
                  {(
                    [
                      { value: 'all', ar: 'الكل', en: 'All' },
                      { value: 'For Sale', ar: 'للبيع', en: 'For Sale' },
                      { value: 'For Rent', ar: 'للإيجار', en: 'For Rent' },
                    ] as const
                  ).map((item) => {
                    const active = criteria.listingStatus === item.value;
                    return (
                      <button
                        key={item.value}
                        type="button"
                        aria-pressed={active}
                        onClick={() => patch({ listingStatus: item.value })}
                        className={`py-2 px-2 rounded-lg text-xs font-bold transition-all cursor-pointer ${
                          active
                            ? 'bg-brand-600 text-white shadow-sm'
                            : 'text-slate-600 dark:text-slate-300 hover:text-brand-600'
                        }`}
                      >
                        {isRtl ? item.ar : item.en}
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Area Range (m²) */}
              <div className="space-y-1.5">
                <span className="block text-[11px] font-black uppercase tracking-wider text-slate-500 dark:text-slate-400">
                  {isRtl ? 'المساحة (م²)' : 'Area Range (m²)'}
                </span>
                <div className="grid grid-cols-2 gap-2">
                  <div className="relative">
                    <Maximize2
                      size={12}
                      aria-hidden="true"
                      className="absolute top-1/2 -translate-y-1/2 start-2.5 text-slate-400 pointer-events-none"
                    />
                    <input
                      type="number"
                      min="0"
                      value={criteria.minArea}
                      onChange={(e) => {
                        const val = e.target.value;
                        if (val === '' || Number(val) >= 0) patch({ minArea: val });
                      }}
                      placeholder={isRtl ? 'أقل مساحة' : 'Min m²'}
                      aria-label={isRtl ? 'أقل مساحة بالمتر' : 'Minimum area in square meters'}
                      className="w-full h-10 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50/70 dark:bg-slate-800/70 focus:ring-2 focus:ring-brand-500 outline-none text-slate-900 dark:text-white ps-7 pe-2 text-xs font-medium [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                    />
                  </div>
                  <div className="relative">
                    <Maximize2
                      size={12}
                      aria-hidden="true"
                      className="absolute top-1/2 -translate-y-1/2 start-2.5 text-slate-400 pointer-events-none"
                    />
                    <input
                      type="number"
                      min="0"
                      value={criteria.maxArea}
                      onChange={(e) => {
                        const val = e.target.value;
                        if (val === '' || Number(val) >= 0) patch({ maxArea: val });
                      }}
                      placeholder={isRtl ? 'أكبر مساحة' : 'Max m²'}
                      aria-label={isRtl ? 'أكبر مساحة بالمتر' : 'Maximum area in square meters'}
                      className="w-full h-10 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50/70 dark:bg-slate-800/70 focus:ring-2 focus:ring-brand-500 outline-none text-slate-900 dark:text-white ps-7 pe-2 text-xs font-medium [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                    />
                  </div>
                </div>
              </div>

              {/* Finishing Selector */}
              <div className="space-y-1.5">
                <label
                  htmlFor="filter-finishing"
                  className="block text-[11px] font-black uppercase tracking-wider text-slate-500 dark:text-slate-400"
                >
                  {isRtl ? 'حالة التشطيب' : 'Finishing'}
                </label>
                <select
                  id="filter-finishing"
                  value={criteria.finishing}
                  onChange={(e) => patch({ finishing: e.target.value })}
                  className="w-full h-10 px-3 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50/70 dark:bg-slate-800/70 focus:ring-2 focus:ring-brand-500 outline-none text-slate-900 dark:text-white text-xs font-semibold cursor-pointer"
                >
                  <option value="all">{isRtl ? 'كل التشطيبات' : 'Any Finishing'}</option>
                  <option value="Fully Finished">{isRtl ? 'تشطيب كامل / سوبر لوكس' : 'Fully Finished'}</option>
                  <option value="Semi Finished">{isRtl ? 'نصف تشطيب' : 'Semi Finished'}</option>
                  <option value="Not Finished">{isRtl ? 'على المحارة (بدون تشطيب)' : 'Not Finished'}</option>
                </select>
              </div>

              {/* Delivery Timeline & District */}
              <div className="space-y-1.5">
                <label
                  htmlFor="filter-delivery"
                  className="block text-[11px] font-black uppercase tracking-wider text-slate-500 dark:text-slate-400"
                >
                  {isRtl ? 'موعد الاستلام' : 'Delivery Timeline'}
                </label>
                <select
                  id="filter-delivery"
                  value={criteria.deliveryTimeline}
                  onChange={(e) => patch({ deliveryTimeline: e.target.value })}
                  className="w-full h-10 px-3 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50/70 dark:bg-slate-800/70 focus:ring-2 focus:ring-brand-500 outline-none text-slate-900 dark:text-white text-xs font-semibold cursor-pointer"
                >
                  <option value="all">{isRtl ? 'أي موعد استلام' : 'Any Delivery'}</option>
                  <option value="ready">{isRtl ? 'استلام فوري' : 'Ready'}</option>
                  <option value="1-2years">{isRtl ? 'خلال 1 - 2 سنة' : '1-2 Years'}</option>
                  <option value="3+years">{isRtl ? '3+ سنوات (تحت الإنشاء)' : '3+ Years'}</option>
                </select>
              </div>
            </div>

            {/* Bedrooms, Bathrooms & District Row */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              {/* Bedrooms Pills */}
              <div className="space-y-1.5">
                <span className="block text-[11px] font-black uppercase tracking-wider text-slate-500 dark:text-slate-400">
                  {isRtl ? 'غرف النوم' : 'Bedrooms'}
                </span>
                <div className="flex flex-wrap gap-1.5">
                  {BEDROOM_OPTIONS.map((count) => {
                    const active = criteria.minBedrooms === count;
                    return (
                      <button
                        key={count}
                        type="button"
                        aria-pressed={active}
                        onClick={() => patch({ minBedrooms: count })}
                        className={`px-3 py-1.5 rounded-xl text-xs font-bold border transition-all cursor-pointer ${
                          active
                            ? 'bg-brand-600 text-white border-brand-600 shadow-xs'
                            : 'bg-slate-50 dark:bg-slate-800 text-slate-700 dark:text-slate-300 border-slate-200 dark:border-slate-700 hover:border-brand-400'
                        }`}
                      >
                        {count === 0 ? (isRtl ? 'الكل' : 'Any') : `${count}+`}
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Bathrooms Pills */}
              <div className="space-y-1.5">
                <span className="block text-[11px] font-black uppercase tracking-wider text-slate-500 dark:text-slate-400">
                  {isRtl ? 'الحمامات' : 'Bathrooms'}
                </span>
                <div className="flex flex-wrap gap-1.5">
                  {BATHROOM_OPTIONS.map((count) => {
                    const active = criteria.minBathrooms === count;
                    return (
                      <button
                        key={count}
                        type="button"
                        aria-pressed={active}
                        onClick={() => patch({ minBathrooms: count })}
                        className={`px-3 py-1.5 rounded-xl text-xs font-bold border transition-all cursor-pointer ${
                          active
                            ? 'bg-brand-600 text-white border-brand-600 shadow-xs'
                            : 'bg-slate-50 dark:bg-slate-800 text-slate-700 dark:text-slate-300 border-slate-200 dark:border-slate-700 hover:border-brand-400'
                        }`}
                      >
                        {count === 0 ? (isRtl ? 'الكل' : 'Any') : `${count}+`}
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* District Selector */}
              <div className="space-y-1.5">
                <label
                  htmlFor="filter-district"
                  className="block text-[11px] font-black uppercase tracking-wider text-slate-500 dark:text-slate-400"
                >
                  {isRtl ? 'المنطقة / المحور' : 'District / Hub'}
                </label>
                <select
                  id="filter-district"
                  value={criteria.district}
                  onChange={(e) => patch({ district: e.target.value })}
                  className="w-full h-10 px-3 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50/70 dark:bg-slate-800/70 focus:ring-2 focus:ring-brand-500 outline-none text-slate-900 dark:text-white text-xs font-semibold cursor-pointer"
                >
                  <option value="all">{isRtl ? 'جميع المناطق في مصر' : 'All Egyptian Districts'}</option>
                  {districtOptions.map((d) => (
                    <option key={d.value} value={d.value}>
                      {d.label}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            {/* Quick Feature Toggles */}
            <div className="flex flex-wrap items-center gap-2.5 pt-2 border-t border-slate-100 dark:border-slate-800">
              <button
                type="button"
                aria-pressed={criteria.verifiedOnly}
                onClick={() => patch({ verifiedOnly: !criteria.verifiedOnly })}
                className={`inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl text-xs font-bold border transition-all cursor-pointer ${
                  criteria.verifiedOnly
                    ? 'bg-emerald-600 text-white border-emerald-600 shadow-sm'
                    : 'bg-slate-50 dark:bg-slate-800 text-slate-700 dark:text-slate-300 border-slate-200 dark:border-slate-700 hover:border-emerald-400'
                }`}
              >
                <ShieldCheck size={14} aria-hidden="true" />
                <span>{isRtl ? 'مستندات مُراجعة فقط' : 'Verified Only'}</span>
              </button>

              <button
                type="button"
                aria-pressed={criteria.has3DOnly}
                onClick={() => patch({ has3DOnly: !criteria.has3DOnly })}
                className={`inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl text-xs font-bold border transition-all cursor-pointer ${
                  criteria.has3DOnly
                    ? 'bg-brand-600 text-white border-brand-600 shadow-sm'
                    : 'bg-slate-50 dark:bg-slate-800 text-slate-700 dark:text-slate-300 border-slate-200 dark:border-slate-700 hover:border-brand-400'
                }`}
              >
                <Box size={14} aria-hidden="true" />
                <span>{isRtl ? 'جولة 3D حقيقية فقط' : 'Real 3D Tour Only'}</span>
              </button>

              <button
                type="button"
                aria-pressed={criteria.installmentsOnly}
                onClick={() => patch({ installmentsOnly: !criteria.installmentsOnly })}
                className={`inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl text-xs font-bold border transition-all cursor-pointer ${
                  criteria.installmentsOnly
                    ? 'bg-accent-500 text-white border-accent-500 shadow-sm'
                    : 'bg-slate-50 dark:bg-slate-800 text-slate-700 dark:text-slate-300 border-slate-200 dark:border-slate-700 hover:border-accent-400'
                }`}
              >
                <CreditCard size={14} aria-hidden="true" />
                <span>{isRtl ? 'متاح بالتقسيط' : 'Installments Available'}</span>
              </button>

              <button
                type="button"
                aria-pressed={criteria.yallaSahelOnly}
                onClick={() => patch({ yallaSahelOnly: !criteria.yallaSahelOnly })}
                className={`inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl text-xs font-bold border transition-all cursor-pointer ${
                  criteria.yallaSahelOnly
                    ? 'bg-cyan-600 text-white border-cyan-600 shadow-sm'
                    : 'bg-slate-50 dark:bg-slate-800 text-slate-700 dark:text-slate-300 border-slate-200 dark:border-slate-700 hover:border-cyan-400'
                }`}
              >
                <Waves size={14} aria-hidden="true" />
                <span>{isRtl ? 'ساحل حِتّتي' : 'Sahel Hettety'}</span>
              </button>

              {totalActiveCount > 0 && (
                <button
                  type="button"
                  onClick={onReset}
                  className="ms-auto inline-flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-bold text-rose-600 dark:text-rose-400 hover:bg-rose-50 dark:hover:bg-rose-950/40 transition-colors cursor-pointer"
                >
                  <RotateCcw size={13} aria-hidden="true" />
                  <span>{isRtl ? 'إعادة ضبط الكل' : 'Reset All'}</span>
                </button>
              )}
            </div>
          </div>
        )}

        {/* Active Filter Removable Chips */}
        {activeChips.length > 0 && (
          <div className="flex flex-wrap items-center gap-2 pt-3 border-t border-slate-100 dark:border-slate-800">
            <span className="text-[11px] font-bold text-slate-400">
              {isRtl ? 'الفلاتر النشطة:' : 'Active:'}
            </span>
            {activeChips.map((chip) => (
              <span
                key={chip.key}
                className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-brand-50 dark:bg-brand-900/30 border border-brand-200/80 dark:border-brand-800 text-brand-700 dark:text-brand-300 text-xs font-bold"
              >
                <span>{chip.label}</span>
                <button
                  type="button"
                  onClick={chip.onRemove}
                  aria-label={isRtl ? `إزالة فلتر ${chip.label}` : `Remove filter ${chip.label}`}
                  className="p-0.5 rounded-full hover:bg-brand-200/70 dark:hover:bg-brand-800 transition-colors cursor-pointer"
                >
                  <X size={12} aria-hidden="true" />
                </button>
              </span>
            ))}
            <button
              type="button"
              onClick={onReset}
              className="text-xs font-bold text-accent-600 dark:text-accent-400 hover:underline px-1.5 py-0.5 cursor-pointer"
            >
              {isRtl ? 'مسح الكل' : 'Clear all'}
            </button>
          </div>
        )}
      </div>

      {/* Saved Searches Strip */}
      {savedSearches.length > 0 && (
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs font-bold text-slate-500 dark:text-slate-400">
            {isRtl ? 'عمليات البحث المحفوظة:' : 'Saved searches:'}
          </span>
          {savedSearches.map((s) => (
            <span
              key={s.id}
              className="inline-flex items-center gap-1.5 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 text-slate-700 dark:text-slate-300 text-xs font-bold px-3 py-1.5 rounded-full shadow-2xs"
            >
              <button
                type="button"
                onClick={() => onApplySavedSearch?.(s)}
                className="hover:text-brand-600 dark:hover:text-brand-400 cursor-pointer"
              >
                {s.q ||
                  (s.typeFilter && s.typeFilter !== 'all'
                    ? s.typeFilter
                    : isRtl
                      ? 'بحث محفوظ'
                      : 'Saved search')}
              </button>
              {onRemoveSavedSearch && (
                <button
                  type="button"
                  onClick={() => onRemoveSavedSearch(s.id)}
                  aria-label={
                    isRtl
                      ? `حذف البحث المحفوظ ${s.q || 'بحث'}`
                      : `Delete saved search ${s.q || 'search'}`
                  }
                  className="text-slate-400 hover:text-rose-500 p-0.5 rounded-full cursor-pointer"
                >
                  <X size={12} aria-hidden="true" />
                </button>
              )}
            </span>
          ))}
        </div>
      )}

      {/* Utility Footer: Count + Save/Alert + View Switcher (Units/Projects tabs + Grid/List) */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-3">
          {/* Units vs Projects Tablist (Preserves exact accessible role="tab" names for tests) */}
          <div
            className="inline-flex gap-1 bg-slate-100 dark:bg-slate-800 p-1 rounded-xl border border-slate-200/70 dark:border-slate-700/60"
            role="tablist"
            aria-label={isRtl ? 'طريقة العرض' : 'Listing view'}
          >
            <button
              type="button"
              role="tab"
              aria-selected={displayMode !== 'projects'}
              onClick={handleUnitsTabClick}
              className={`px-4 py-1.5 rounded-lg text-xs sm:text-sm font-bold transition-all whitespace-nowrap cursor-pointer focus:outline-none focus:ring-2 focus:ring-brand-500 ${
                displayMode !== 'projects'
                  ? 'bg-white dark:bg-slate-900 text-brand-600 dark:text-brand-400 shadow-xs'
                  : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
              }`}
            >
              {isRtl ? 'الوحدات' : 'Units'}
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={displayMode === 'projects'}
              onClick={() => onDisplayModeChange('projects')}
              className={`px-4 py-1.5 rounded-lg text-xs sm:text-sm font-bold transition-all whitespace-nowrap cursor-pointer focus:outline-none focus:ring-2 focus:ring-brand-500 flex items-center gap-1.5 ${
                displayMode === 'projects'
                  ? 'bg-white dark:bg-slate-900 text-brand-600 dark:text-brand-400 shadow-xs'
                  : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
              }`}
            >
              <Building2 size={14} aria-hidden="true" className="hidden sm:inline" />
              <span>{isRtl ? 'المشاريع' : 'Projects'}</span>
            </button>
          </div>

          {/* Grid vs List Layout Toggle */}
          {displayMode !== 'projects' && (
            <div
              className="inline-flex gap-1 bg-slate-100 dark:bg-slate-800 p-1 rounded-xl border border-slate-200/70 dark:border-slate-700/60"
              role="group"
              aria-label={isRtl ? 'تخطيط العرض' : 'Card Layout'}
            >
              <button
                type="button"
                aria-pressed={displayMode === 'grid'}
                aria-label={isRtl ? 'عرض شبكي' : 'Grid view'}
                title={isRtl ? 'عرض شبكي' : 'Grid view'}
                onClick={() => handleLayoutClick('grid')}
                className={`p-1.5 rounded-lg transition-all cursor-pointer ${
                  displayMode === 'grid'
                    ? 'bg-white dark:bg-slate-900 text-brand-600 dark:text-brand-400 shadow-xs'
                    : 'text-slate-500 hover:text-slate-800 dark:hover:text-slate-200'
                }`}
              >
                <LayoutGrid size={16} aria-hidden="true" />
              </button>
              <button
                type="button"
                aria-pressed={displayMode === 'list'}
                aria-label={isRtl ? 'عرض قائمة' : 'List view'}
                title={isRtl ? 'عرض قائمة' : 'List view'}
                onClick={() => handleLayoutClick('list')}
                className={`p-1.5 rounded-lg transition-all cursor-pointer ${
                  displayMode === 'list'
                    ? 'bg-white dark:bg-slate-900 text-brand-600 dark:text-brand-400 shadow-xs'
                    : 'text-slate-500 hover:text-slate-800 dark:hover:text-slate-200'
                }`}
              >
                <List size={16} aria-hidden="true" />
              </button>
            </div>
          )}

          {/* Results Summary Pill */}
          <p className="text-xs sm:text-sm font-semibold text-slate-500 dark:text-slate-400">
            {isRtl
              ? `عرض ${filteredCount.toLocaleString('ar-EG')} من ${totalCount.toLocaleString('ar-EG')} عقار`
              : `Showing ${filteredCount.toLocaleString()} of ${totalCount.toLocaleString()} ${totalCount === 1 ? 'property' : 'properties'}`}
          </p>
        </div>

        {/* Save Search & Email Alerts */}
        <div className="flex items-center gap-2 flex-wrap">
          {onSaveSearch && (
            <button
              type="button"
              onClick={onSaveSearch}
              className="py-2 px-3.5 rounded-xl border border-brand-200 dark:border-brand-800 bg-brand-50/80 dark:bg-brand-900/20 text-brand-700 dark:text-brand-300 font-bold text-xs sm:text-sm flex items-center gap-1.5 hover:bg-brand-100 dark:hover:bg-brand-900/40 transition-colors whitespace-nowrap cursor-pointer focus:outline-none focus:ring-2 focus:ring-brand-500"
            >
              <Save size={14} aria-hidden="true" />
              <span>{isRtl ? 'احفظ البحث' : 'Save Search'}</span>
            </button>
          )}
          {onSubscribeAlert && (
            <button
              type="button"
              onClick={onSubscribeAlert}
              className="py-2 px-3.5 rounded-xl border border-accent-200 dark:border-accent-800 bg-accent-50/80 dark:bg-accent-900/20 text-accent-700 dark:text-accent-300 font-bold text-xs sm:text-sm flex items-center gap-1.5 hover:bg-accent-100 dark:hover:bg-accent-900/40 transition-colors whitespace-nowrap cursor-pointer focus:outline-none focus:ring-2 focus:ring-accent-500"
            >
              <Bell size={14} aria-hidden="true" />
              <span>{isRtl ? 'نبّهني بالإيميل' : 'Email Alert'}</span>
            </button>
          )}
        </div>
      </div>
    </section>
  );
};

export default AdvancedFilterBar;
