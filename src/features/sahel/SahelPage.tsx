import React, { useMemo, useState } from 'react';
import {
  ArrowDown,
  Box,
  Compass,
  MapPin,
  PhoneCall,
  PlusCircle,
  RotateCcw,
  Star,
  Users,
  Waves,
} from 'lucide-react';
import { Property } from '../../types';
import { ReshapedPropertyCard } from '../properties/components/ReshapedPropertyCard';
import { BrandButton } from '../../shared/ui/BrandButton';

export interface SahelPageProps {
  properties: Property[];
  userFavorites: string[];
  compareIds: string[];
  onView3D: (id: string) => void;
  onToggleFavorite: (id: string) => void;
  onToggleCompare: (id: string) => void;
  onOpenProperty: (id: string) => void;
  onOpenProject: (name: string) => void;
  onListChalet: () => void;
  onBrowseAll: () => void;
  t: any;
  isRtl: boolean;
}

const COASTAL_KEYWORDS =
  /ساحل|sahel|north coast|الساحل|مارينا|marina|marassi|مراسي|راس الحكمة|رأس الحكمة|ras el|hacienda|هاسيندا|العلمين|alamein|بورتو|porto|جايا|جاردينيا|سيدي عبد|sidi abdel|فوكا|fouka/i;

interface DestinationChip {
  key: string;
  en: string;
  ar: string;
  pattern?: RegExp;
}

const NORTH_COAST_DESTINATIONS: DestinationChip[] = [
  { key: 'all', en: 'All', ar: 'الكل' },
  { key: 'marassi', en: 'Marassi', ar: 'مراسي', pattern: /marassi|مراسي/i },
  { key: 'hacienda', en: 'Hacienda', ar: 'هاسيندا', pattern: /hacienda|هاسيندا/i },
  {
    key: 'ras-el-hekma',
    en: 'Ras El Hekma',
    ar: 'رأس الحكمة',
    pattern: /ras el[\s-]?hekma|راس الحكمة|رأس الحكمة/i,
  },
  { key: 'alamein', en: 'El Alamein', ar: 'العلمين', pattern: /alamein|العلمين/i },
  { key: 'marina', en: 'Marina', ar: 'مارينا', pattern: /marina|مارينا/i },
  { key: 'fouka', en: 'Fouka Bay', ar: 'فوكا باي', pattern: /fouka|فوكا/i },
  {
    key: 'sidi-abdelrahman',
    en: 'Sidi Abdelrahman',
    ar: 'سيدي عبد الرحمن',
    pattern: /sidi abdel|سيدي عبد/i,
  },
];

const GUEST_OPTIONS = [0, 2, 4, 6, 8];

function matchesDestination(property: Property, chip: DestinationChip): boolean {
  if (!chip.pattern) return true;
  const haystack = [
    property.village,
    property.compound,
    property.location,
    property.title,
  ]
    .filter(Boolean)
    .join(' ');
  return chip.pattern.test(haystack);
}

export const SahelPage: React.FC<SahelPageProps> = ({
  properties,
  userFavorites,
  compareIds,
  onView3D,
  onToggleFavorite,
  onToggleCompare,
  onOpenProperty,
  onOpenProject,
  onListChalet,
  onBrowseAll,
  t,
  isRtl,
}) => {
  const [selectedDestination, setSelectedDestination] = useState<string>('all');
  const [selectedVillage, setSelectedVillage] = useState<string>('all');
  const [minGuests, setMinGuests] = useState<number>(0);

  // Explicitly flagged Sahel listings + coastal heuristic for legacy/north-coast listings
  const allSahel = useMemo(
    () =>
      properties.filter(
        (p) =>
          p.yallaSahel === true ||
          p.propertyType === 'Chalet' ||
          COASTAL_KEYWORDS.test(p.location || '') ||
          COASTAL_KEYWORDS.test(p.compound || '') ||
          Boolean(p.village)
      ),
    [properties]
  );

  const villages = useMemo(
    () =>
      Array.from(
        new Set(allSahel.map((p) => p.village).filter(Boolean))
      ).sort() as string[],
    [allSahel]
  );

  const destinationCounts = useMemo(() => {
    const map: Record<string, number> = {};
    for (const dest of NORTH_COAST_DESTINATIONS) {
      map[dest.key] =
        dest.key === 'all'
          ? allSahel.length
          : allSahel.filter((p) => matchesDestination(p, dest)).length;
    }
    return map;
  }, [allSahel]);

  const sahelUnits = useMemo(() => {
    const activeChip =
      NORTH_COAST_DESTINATIONS.find((d) => d.key === selectedDestination) ||
      NORTH_COAST_DESTINATIONS[0];

    return allSahel.filter((p) => {
      const destOk = matchesDestination(p, activeChip);
      const villageOk =
        selectedVillage === 'all' || p.village === selectedVillage;
      const guestsOk = minGuests === 0 || (p.guests || 0) >= minGuests;
      return destOk && villageOk && guestsOk;
    });
  }, [allSahel, selectedDestination, selectedVillage, minGuests]);

  const hasActiveFilters =
    selectedDestination !== 'all' ||
    selectedVillage !== 'all' ||
    minGuests > 0;

  const resetFilters = () => {
    setSelectedDestination('all');
    setSelectedVillage('all');
    setMinGuests(0);
  };

  const pillars = [
    {
      icon: <Box size={22} aria-hidden="true" />,
      title: isRtl ? 'معاينة 3D قبل الحجز' : '3D Preview',
      desc: isRtl
        ? 'لف جوه الشاليه وشوف المساحات والفيو الحقيقي قبل ما تقرر'
        : 'Walk inside the chalet and inspect the real layout and view before booking',
      accent: 'from-cyan-400/25 to-brand-500/25 text-cyan-300 border-cyan-300/30',
    },
    {
      icon: <PhoneCall size={22} aria-hidden="true" />,
      title: isRtl ? 'تواصل مباشر مع المالك' : 'Direct Owner Contact',
      desc: isRtl
        ? 'تواصل فوري عبر الاتصال أو واتساب مع صاحب الشاليه بدون وسطاء إضافيين'
        : 'Reach the chalet owner directly by phone or WhatsApp for faster coordination',
      accent: 'from-accent-400/25 to-accent-600/25 text-accent-300 border-accent-300/30',
    },
    {
      icon: <Star size={22} aria-hidden="true" />,
      title: isRtl ? 'آراء المستخدمين' : 'User Reviews',
      desc: isRtl
        ? 'آراء المستخدمين على كل وحدة قبل ما تقرر'
        : 'User reviews on each chalet before you decide',
      accent: 'from-sky-400/25 to-brand-400/25 text-sky-200 border-sky-300/30',
    },
  ];

  return (
    <div dir={isRtl ? 'rtl' : 'ltr'} className="animate-fade-in">
      {/* Mediterranean Coastal Hero */}
      <section className="relative overflow-hidden bg-gradient-to-br from-brand-950 via-brand-800 to-cyan-900 text-white">
        {/* Architectural coastal grid & radial sunlight */}
        <div
          className="pointer-events-none absolute inset-0 opacity-15"
          style={{
            backgroundImage:
              'radial-gradient(circle at 20% 25%, rgba(255,255,255,0.85) 1.5px, transparent 1.5px)',
            backgroundSize: '38px 38px',
          }}
        />
        <div className="pointer-events-none absolute -top-24 -end-20 w-96 h-96 rounded-full bg-cyan-400/20 blur-3xl" />
        <div className="pointer-events-none absolute -bottom-28 -start-16 w-96 h-96 rounded-full bg-accent-500/20 blur-3xl" />

        <div className="relative max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 pt-16 pb-20 sm:pt-20 sm:pb-24 text-center">
          <div className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full bg-white/10 backdrop-blur-md border border-white/20 text-cyan-200 text-xs font-extrabold uppercase tracking-widest mb-6">
            <Waves size={15} className="text-cyan-300" aria-hidden="true" />
            <span>{isRtl ? 'الساحل الشمالي · مصر' : 'North Coast · Egypt'}</span>
          </div>

          <h1 className="text-4xl sm:text-5xl md:text-6xl font-heading font-black tracking-tight mb-5">
            {isRtl ? 'ساحل حتتي' : 'Sahel Hettety'}
          </h1>

          <p className="text-lg sm:text-xl md:text-2xl font-bold text-white/95 max-w-3xl mx-auto mb-3 leading-snug">
            {isRtl
              ? 'شاليهات الساحل الشمالي — تلف جواها 3D قبل ما تحجز.'
              : 'North Coast chalets — walk through them in 3D before you book.'}
          </p>

          <p className="text-sm sm:text-base text-cyan-100/85 max-w-2xl mx-auto mb-9 leading-relaxed">
            {isRtl
              ? 'معاينة تفاعلية وتواصل مباشر مع صاحب الوحدة. راجع شارة حالة المستندات وآراء المستخدمين على كل شاليه قبل ما تحجز.'
              : 'Interactive 3D previews and direct owner contact. Check the document review badge and user feedback on every chalet before you book.'}
          </p>

          <div className="flex flex-wrap items-center justify-center gap-3.5 mb-14">
            <button
              type="button"
              onClick={() =>
                document
                  .getElementById('sahel-units')
                  ?.scrollIntoView({ behavior: 'smooth' })
              }
              className="inline-flex items-center gap-2 bg-white text-brand-900 hover:bg-accent-50 font-black px-8 py-3.5 rounded-full shadow-xl hover:shadow-2xl transition-all hover:-translate-y-0.5 cursor-pointer focus:outline-none focus:ring-2 focus:ring-white focus:ring-offset-2 focus:ring-offset-brand-900"
            >
              <span>{isRtl ? 'تصفح الشاليهات المتاحة' : 'Browse chalets'}</span>
              <ArrowDown size={16} aria-hidden="true" />
            </button>

            <button
              type="button"
              onClick={onListChalet}
              className="inline-flex items-center gap-2 bg-accent-500 hover:bg-accent-600 text-white font-bold px-8 py-3.5 rounded-full shadow-lg shadow-accent-500/25 transition-all hover:-translate-y-0.5 cursor-pointer focus:outline-none focus:ring-2 focus:ring-accent-300 focus:ring-offset-2 focus:ring-offset-brand-900"
            >
              <PlusCircle size={17} aria-hidden="true" />
              <span>
                {isRtl ? 'عندك شاليه؟ أضفه معانا' : 'List your chalet'}
              </span>
            </button>
          </div>

          {/* Mediterranean Navy-Cyan Glassmorphism Feature Cards */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-5 text-start">
            {pillars.map((card, i) => (
              <div
                key={i}
                className="rounded-2xl bg-white/[0.08] backdrop-blur-xl border border-white/15 p-6 shadow-xl hover:bg-white/[0.12] transition-all duration-300"
              >
                <div
                  className={`w-12 h-12 rounded-xl bg-gradient-to-br border flex items-center justify-center mb-4 ${card.accent}`}
                >
                  {card.icon}
                </div>
                <h2 className="text-base sm:text-lg font-heading font-extrabold text-white mb-1.5">
                  {card.title}
                </h2>
                <p className="text-xs sm:text-sm text-cyan-100/85 leading-relaxed">
                  {card.desc}
                </p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Filters & Chalet Inventory Section */}
      <section
        id="sahel-units"
        aria-labelledby="sahel-available-heading"
        className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-12 sm:py-16"
      >
        {/* Interactive North Coast Destination Chips */}
        <div className="mb-8">
          <div className="flex items-center gap-2 text-xs font-extrabold uppercase tracking-wider text-slate-500 dark:text-slate-400 mb-3">
            <Compass size={14} className="text-cyan-600 dark:text-cyan-400" aria-hidden="true" />
            <span>
              {isRtl ? 'وجهات الساحل الشمالي' : 'North Coast Destinations'}
            </span>
          </div>

          <div
            role="group"
            aria-label={
              isRtl ? 'تصفية حسب الوجهة الساحلية' : 'Filter by coastal destination'
            }
            className="flex items-center gap-2 overflow-x-auto no-scrollbar pb-1 flex-wrap"
          >
            {NORTH_COAST_DESTINATIONS.map((dest) => {
              const isSelected = selectedDestination === dest.key;
              const count = destinationCounts[dest.key] || 0;
              return (
                <button
                  key={dest.key}
                  type="button"
                  onClick={() => setSelectedDestination(dest.key)}
                  aria-pressed={isSelected}
                  className={`inline-flex items-center gap-2 px-4 py-2 rounded-full text-xs sm:text-sm font-bold transition-all cursor-pointer shrink-0 focus:outline-none focus:ring-2 focus:ring-brand-500 focus:ring-offset-2 dark:focus:ring-offset-slate-950 ${
                    isSelected
                      ? 'bg-brand-600 dark:bg-accent-500 text-white shadow-md shadow-brand-600/20 dark:shadow-accent-500/25 border border-brand-500 dark:border-accent-500'
                      : 'bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-300 border border-slate-200 dark:border-slate-800 hover:border-cyan-400 dark:hover:border-cyan-700 hover:text-brand-700 dark:hover:text-white'
                  }`}
                >
                  <span>{isRtl ? dest.ar : dest.en}</span>
                  {count > 0 && (
                    <span
                      className={`px-1.5 py-0.5 rounded-full text-[10px] font-extrabold tabular-nums ${
                        isSelected
                          ? 'bg-white/20 text-white'
                          : 'bg-slate-100 dark:bg-slate-800 text-slate-500 dark:text-slate-400'
                      }`}
                    >
                      {count}
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        </div>

        {/* Section Header + Village & Guest Selectors */}
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 pb-6 mb-8 border-b border-slate-200 dark:border-slate-800">
          <div className="flex items-center gap-3 flex-wrap">
            <h2
              id="sahel-available-heading"
              className="text-2xl sm:text-3xl font-heading font-black text-slate-900 dark:text-white"
            >
              {isRtl ? 'الشاليهات المتاحة' : 'Available chalets'}
            </h2>
            <span className="px-3 py-1 rounded-full bg-cyan-50 dark:bg-cyan-950/60 border border-cyan-200 dark:border-cyan-800 text-cyan-800 dark:text-cyan-300 text-xs font-extrabold tabular-nums">
              {sahelUnits.length}
            </span>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            {/* Village Selector */}
            <div className="relative flex items-center">
              <MapPin
                size={15}
                className="pointer-events-none absolute start-3 text-slate-400"
                aria-hidden="true"
              />
              <label htmlFor="sahel-village-filter" className="sr-only">
                {isRtl ? 'اختر القرية' : 'Select village'}
              </label>
              <select
                id="sahel-village-filter"
                value={selectedVillage}
                onChange={(e) => setSelectedVillage(e.target.value)}
                className="ps-9 pe-4 py-2.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-sm font-semibold text-slate-800 dark:text-white focus:outline-none focus:ring-2 focus:ring-brand-500 cursor-pointer"
              >
                <option value="all">{isRtl ? 'كل القرى' : 'All villages'}</option>
                {villages.map((v) => (
                  <option key={v} value={v}>
                    {v}
                  </option>
                ))}
              </select>
            </div>

            {/* Guest Count Selector */}
            <div className="relative flex items-center">
              <Users
                size={15}
                className="pointer-events-none absolute start-3 text-slate-400"
                aria-hidden="true"
              />
              <label htmlFor="sahel-guests-filter" className="sr-only">
                {isRtl ? 'عدد الأفراد' : 'Guest capacity'}
              </label>
              <select
                id="sahel-guests-filter"
                value={minGuests}
                onChange={(e) => setMinGuests(Number(e.target.value))}
                className="ps-9 pe-4 py-2.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-sm font-semibold text-slate-800 dark:text-white focus:outline-none focus:ring-2 focus:ring-brand-500 cursor-pointer"
              >
                {GUEST_OPTIONS.map((n) => (
                  <option key={n} value={n}>
                    {n === 0
                      ? isRtl
                        ? 'أي عدد أفراد'
                        : 'Any'
                      : isRtl
                        ? `${n}+ أفراد`
                        : `${n}+ guests`}
                  </option>
                ))}
              </select>
            </div>

            {hasActiveFilters && (
              <button
                type="button"
                onClick={resetFilters}
                className="inline-flex items-center gap-1.5 px-3.5 py-2.5 rounded-xl text-xs font-bold text-brand-700 dark:text-brand-300 bg-brand-50 dark:bg-brand-900/40 hover:bg-brand-100 dark:hover:bg-brand-900/70 transition-colors cursor-pointer"
              >
                <RotateCcw size={14} aria-hidden="true" />
                <span>{isRtl ? 'مسح الفلاتر' : 'Reset'}</span>
              </button>
            )}
          </div>
        </div>

        {/* Results or Architectural Empty States */}
        {allSahel.length === 0 ? (
          <div className="relative overflow-hidden rounded-3xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 py-16 sm:py-20 px-6 text-center shadow-sm">
            <div className="w-20 h-20 rounded-3xl bg-gradient-to-br from-brand-50 to-cyan-50 dark:from-brand-900/40 dark:to-cyan-950/60 border border-cyan-200/70 dark:border-cyan-800/50 text-cyan-600 dark:text-cyan-400 flex items-center justify-center mx-auto mb-6">
              <Waves size={36} strokeWidth={1.6} aria-hidden="true" />
            </div>
            <h3 className="text-xl sm:text-2xl font-heading font-extrabold text-slate-900 dark:text-white mb-2">
              {isRtl
                ? 'لا توجد شاليهات مضافة حالياً — كن أول مالك!'
                : 'No coastal chalets listed yet — be the first owner!'}
            </h3>
            <p className="text-sm sm:text-base text-slate-500 dark:text-slate-400 max-w-lg mx-auto mb-8 leading-relaxed">
              {isRtl
                ? 'انشر شاليهك في مراسي أو هاسيندا أو رأس الحكمة مع معاينة 3D أو تصفح باقي العقارات المتاحة على حتتي.'
                : 'Publish your chalet in Marassi, Hacienda, or Ras El Hekma with a 3D preview, or explore all other listings across HETTETY.'}
            </p>
            <div className="flex flex-wrap items-center justify-center gap-3">
              <BrandButton onClick={onListChalet} variant="accent">
                <PlusCircle size={17} aria-hidden="true" />
                <span>{isRtl ? 'أضف شاليهك الآن' : 'List your chalet'}</span>
              </BrandButton>
              <BrandButton onClick={onBrowseAll} variant="outline">
                <span>{isRtl ? 'تصفح كل العقارات' : 'Browse all listings'}</span>
              </BrandButton>
            </div>
          </div>
        ) : sahelUnits.length === 0 ? (
          <div className="rounded-3xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 py-16 px-6 text-center shadow-sm">
            <div className="w-16 h-16 rounded-2xl bg-brand-50 dark:bg-brand-900/40 text-brand-600 dark:text-brand-300 flex items-center justify-center mx-auto mb-5">
              <Compass size={28} aria-hidden="true" />
            </div>
            <h3 className="text-lg sm:text-xl font-heading font-extrabold text-slate-900 dark:text-white mb-2">
              {isRtl
                ? 'لا توجد شاليهات مطابقة لهذه الفلاتر'
                : 'No chalets match your selected filters'}
            </h3>
            <p className="text-sm text-slate-500 dark:text-slate-400 max-w-md mx-auto mb-6">
              {isRtl
                ? 'جرّب تغيير الوجهة الساحلية أو تقليل عدد الأفراد لعرض الشاليهات المتاحة.'
                : 'Try clearing the destination filter or adjusting the guest capacity to view available chalets.'}
            </p>
            <div className="flex flex-wrap items-center justify-center gap-3">
              <BrandButton onClick={resetFilters} variant="primary">
                <RotateCcw size={15} aria-hidden="true" />
                <span>{isRtl ? 'عرض كل الشاليهات' : 'Reset filters'}</span>
              </BrandButton>
              <BrandButton onClick={onBrowseAll} variant="outline">
                <span>{isRtl ? 'تصفح كل العقارات' : 'Browse all listings'}</span>
              </BrandButton>
            </div>
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-7 sm:gap-8">
            {sahelUnits.map((property) => (
              <ReshapedPropertyCard
                key={property.id}
                property={property}
                variant="grid"
                onView3D={() => onView3D(property.id)}
                onToggleFavorite={() => onToggleFavorite(property.id)}
                isFavorited={userFavorites.includes(property.id)}
                onToggleCompare={() => onToggleCompare(property.id)}
                isComparing={compareIds.includes(property.id)}
                onClick={() => onOpenProperty(property.id)}
                onOpenProject={onOpenProject}
                t={t}
                isRtl={isRtl}
              />
            ))}
          </div>
        )}
      </section>
    </div>
  );
};

export default SahelPage;
