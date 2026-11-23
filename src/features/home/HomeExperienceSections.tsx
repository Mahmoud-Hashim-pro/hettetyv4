import React, { useMemo, useState } from 'react';
import {
  ShieldCheck,
  FileCheck,
  Box,
  Users,
  MapPin,
  ArrowLeft,
  ArrowRight,
  ArrowUpRight,
  Calculator,
  Sparkles,
  Waves,
  FileSearch,
  Info,
  SlidersHorizontal,
} from 'lucide-react';

/* ============================================================================
 * 1. HomeFeaturesSection — Luxury Architectural 4-Column Capability Cards
 * ========================================================================== */

export interface HomeFeaturesSectionProps {
  t: any;
  isRtl: boolean;
}

export const HomeFeaturesSection: React.FC<HomeFeaturesSectionProps> = ({ t = {}, isRtl }) => {
  const features = [
    {
      num: '01',
      icon: <ShieldCheck className="w-6 h-6" aria-hidden="true" />,
      title: t.feat_1_title,
      desc: t.feat_1_desc,
    },
    {
      num: '02',
      icon: <FileCheck className="w-6 h-6" aria-hidden="true" />,
      title: t.feat_2_title,
      desc: t.feat_2_desc,
    },
    {
      num: '03',
      icon: <Box className="w-6 h-6" aria-hidden="true" />,
      title: t.feat_3_title,
      desc: t.feat_3_desc,
    },
    {
      num: '04',
      icon: <Users className="w-6 h-6" aria-hidden="true" />,
      title: t.feat_4_title,
      desc: t.feat_4_desc,
    },
  ];

  return (
    <section
      aria-labelledby="home-features-heading"
      dir={isRtl ? 'rtl' : 'ltr'}
      className={`relative py-20 sm:py-24 bg-white dark:bg-slate-950 transition-colors duration-500 overflow-hidden ${
        isRtl ? 'font-cairo' : ''
      }`}
    >
      <div
        className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-slate-200 dark:via-slate-800 to-transparent"
        aria-hidden="true"
      />
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 relative z-10">
        {/* Section Header */}
        <div className="flex flex-col lg:flex-row lg:items-end justify-between gap-6 mb-14">
          <div className="max-w-2xl text-start">
            <span
              className={`inline-flex items-center gap-2 text-xs font-black text-accent-600 dark:text-accent-400 mb-3 ${
                isRtl ? '' : 'uppercase tracking-[0.2em]'
              }`}
            >
              <span className="w-6 h-0.5 bg-accent-500 rounded-full" aria-hidden="true" />
              {isRtl ? 'معيار حتتي المعماري' : 'THE HETTETY STANDARD'}
            </span>
            <h2
              id="home-features-heading"
              className={`text-3xl sm:text-4xl lg:text-5xl font-black text-[#1b2c4d] dark:text-white leading-tight ${
                isRtl ? 'font-cairo' : 'font-heading tracking-tight'
              }`}
            >
              {t.feat_title}
            </h2>
          </div>
          <p className="text-base sm:text-lg text-slate-600 dark:text-slate-400 max-w-xl leading-relaxed text-start">
            {t.feat_desc}
          </p>
        </div>

        {/* 4-Column Elevated Cards */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
          {features.map((item) => (
            <article
              key={item.num}
              className="group relative flex flex-col justify-between p-7 rounded-3xl bg-slate-50/80 dark:bg-slate-900/90 border border-slate-200/80 dark:border-slate-800 hover:border-brand-300 dark:hover:border-brand-700 hover:bg-white dark:hover:bg-slate-900 shadow-sm hover:shadow-2xl hover:shadow-brand-900/10 transition-all duration-300 hover:-translate-y-1.5 overflow-hidden text-start"
            >
              {/* Top hover hairline accent */}
              <div
                className="absolute inset-x-0 top-0 h-1 bg-gradient-to-r from-[#1b2c4d] via-brand-500 to-accent-500 opacity-0 group-hover:opacity-100 transition-opacity duration-300"
                aria-hidden="true"
              />

              <div>
                <div className="flex items-center justify-between mb-6">
                  <div className="w-13 h-13 rounded-2xl bg-white dark:bg-slate-800 border border-slate-200/80 dark:border-slate-700/80 text-[#1b2c4d] dark:text-accent-400 flex items-center justify-center shadow-sm group-hover:bg-[#1b2c4d] group-hover:text-white dark:group-hover:bg-accent-500 dark:group-hover:text-white transition-colors duration-300">
                    {item.icon}
                  </div>
                  <span className="font-mono text-xs font-black px-2.5 py-1 rounded-lg bg-brand-100/80 dark:bg-slate-800 text-brand-700 dark:text-slate-300">
                    {item.num}
                  </span>
                </div>

                <h3
                  className={`text-lg font-black text-[#1b2c4d] dark:text-white mb-2.5 leading-snug ${
                    isRtl ? 'font-cairo' : 'font-heading tracking-tight'
                  }`}
                >
                  {item.title}
                </h3>
                <p className="text-sm text-slate-600 dark:text-slate-400 leading-relaxed">
                  {item.desc}
                </p>
              </div>
            </article>
          ))}
        </div>
      </div>
    </section>
  );
};

/* ============================================================================
 * 2. EgyptCorridorsSection — Editorial Premier Real Estate Corridors
 * ========================================================================== */

export interface EgyptCorridorsSectionProps {
  isRtl: boolean;
  onExploreLocation: (location: string) => void;
  onOpenSahel: () => void;
}

interface CorridorItem {
  id: string;
  query: string;
  isSahel?: boolean;
  nameEn: string;
  nameAr: string;
  tagEn: string;
  tagAr: string;
  highlightEn: string;
  highlightAr: string;
  imageUrl: string;
  fallbackGradient: string;
}

const EGYPT_CORRIDORS: CorridorItem[] = [
  {
    id: 'new-cairo',
    query: 'New Cairo',
    nameEn: 'New Cairo & Fifth Settlement',
    nameAr: 'القاهرة الجديدة والتجمع الخامس',
    tagEn: 'East Cairo Flagship',
    tagAr: 'قلب شرق القاهرة',
    highlightEn: 'Golden Square, gated compounds, international campuses & retail boulevards.',
    highlightAr: 'المربع الذهبي، كمبوندات متكاملة، جامعات دولية ومحاور تجارية راقية.',
    imageUrl:
      'https://images.unsplash.com/photo-1600585154340-be6161a56a0c?auto=format&fit=crop&q=80&w=1200',
    fallbackGradient: 'from-[#1b2c4d] via-brand-700 to-slate-900',
  },
  {
    id: 'sheikh-zayed',
    query: 'Sheikh Zayed',
    nameEn: 'Sheikh Zayed & 6th October',
    nameAr: 'الشيخ زايد و6 أكتوبر',
    tagEn: 'West Cairo Parks',
    tagAr: 'حدائق غرب القاهرة',
    highlightEn: 'Low-density villas, central parks, contemporary residential plazas & clubs.',
    highlightAr: 'فيلات منخفضة الكثافة، حدائق مركزية ومجتمعات سكنية عصرية.',
    imageUrl:
      'https://images.unsplash.com/photo-1613977257363-707ba9348227?auto=format&fit=crop&q=80&w=1200',
    fallbackGradient: 'from-brand-800 via-[#1b2c4d] to-slate-900',
  },
  {
    id: 'north-coast',
    query: 'North Coast',
    isSahel: true,
    nameEn: 'North Coast / Sahel',
    nameAr: 'الساحل الشمالي — ساحل حتتي',
    tagEn: 'Mediterranean Escapes',
    tagAr: 'واجهات البحر المتوسط',
    highlightEn: 'Ras El Hekma, Sidi Abdel Rahman & Alamein chalets with 3D previews.',
    highlightAr: 'شاليهات رأس الحكمة وسيدي عبد الرحمن والعلمين بمعاينة ثلاثية الأبعاد.',
    imageUrl:
      'https://images.unsplash.com/photo-1507525428034-b723cf961d3e?auto=format&fit=crop&q=80&w=1200',
    fallbackGradient: 'from-cyan-700 via-brand-700 to-slate-950',
  },
  {
    id: 'new-capital',
    query: 'New Capital',
    nameEn: 'New Administrative Capital',
    nameAr: 'العاصمة الإدارية الجديدة',
    tagEn: 'Smart Urban Core',
    tagAr: 'المدينة الذكية الجديدة',
    highlightEn: 'R7 & R8 districts, Green River views, business towers & modern infrastructure.',
    highlightAr: 'أحياء R7 وR8، إطلالات النهر الأخضر وأبراج الأعمال الحديثة.',
    imageUrl:
      'https://images.unsplash.com/photo-1545324418-cc1a3fa10c00?auto=format&fit=crop&q=80&w=1200',
    fallbackGradient: 'from-slate-800 via-[#1b2c4d] to-accent-900',
  },
  {
    id: 'mostakbal-city',
    query: 'Mostakbal City',
    nameEn: 'Mostakbal City',
    nameAr: 'مدينة المستقبل',
    tagEn: 'Master-Planned Green Living',
    tagAr: 'مجتمعات خضراء مخططة',
    highlightEn: 'Direct link between New Cairo and the Capital with expansive green belts.',
    highlightAr: 'نقطة الربط بين القاهرة الجديدة والعاصمة بمساحات خضراء واسعة.',
    imageUrl:
      'https://images.unsplash.com/photo-1600596542815-ffad4c1539a9?auto=format&fit=crop&q=80&w=1200',
    fallbackGradient: 'from-brand-700 via-slate-800 to-brand-950',
  },
  {
    id: 'maadi-zamalek',
    query: 'Maadi',
    nameEn: 'Maadi & Zamalek',
    nameAr: 'المعادي والزمالك',
    tagEn: 'Heritage & Nile Living',
    tagAr: 'عراقة النيل والأحياء الهادئة',
    highlightEn: 'Tree-lined avenues, boutique residences & timeless central Cairo addresses.',
    highlightAr: 'شوارع مشجّرة، شقق بوتيك وعناوين عريقة في قلب القاهرة.',
    imageUrl:
      'https://images.unsplash.com/photo-1600607687939-ce8a6c25118c?auto=format&fit=crop&q=80&w=1200',
    fallbackGradient: 'from-slate-900 via-[#1b2c4d] to-brand-800',
  },
];

export const EgyptCorridorsSection: React.FC<EgyptCorridorsSectionProps> = ({
  isRtl,
  onExploreLocation,
  onOpenSahel,
}) => {
  const [failedImages, setFailedImages] = useState<Record<string, boolean>>({});

  return (
    <section
      aria-labelledby="egypt-corridors-heading"
      dir={isRtl ? 'rtl' : 'ltr'}
      className={`py-20 sm:py-24 bg-slate-50 dark:bg-slate-900/40 border-y border-slate-200/70 dark:border-slate-800/70 transition-colors duration-500 ${
        isRtl ? 'font-cairo' : ''
      }`}
    >
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        {/* Header */}
        <div className="flex flex-col md:flex-row md:items-end justify-between gap-6 mb-12">
          <div className="text-start max-w-2xl">
            <span
              className={`inline-flex items-center gap-2 text-xs font-black text-accent-600 dark:text-accent-400 mb-3 ${
                isRtl ? '' : 'uppercase tracking-[0.2em]'
              }`}
            >
              <MapPin className="w-3.5 h-3.5" aria-hidden="true" />
              {isRtl ? 'خريطة الوجهات العقارية في مصر' : 'EGYPT PREMIER CORRIDORS'}
            </span>
            <h2
              id="egypt-corridors-heading"
              className={`text-3xl sm:text-4xl lg:text-5xl font-black text-[#1b2c4d] dark:text-white leading-tight ${
                isRtl ? 'font-cairo' : 'font-heading tracking-tight'
              }`}
            >
              {isRtl ? 'استكشف أبرز المناطق العقارية' : 'Explore Egypt’s Signature Destinations'}
            </h2>
          </div>
          <p className="text-sm sm:text-base text-slate-600 dark:text-slate-400 max-w-md text-start leading-relaxed">
            {isRtl
              ? 'اختر أي منطقة للانتقال مباشرة إلى الوحدات المعروضة فيها أو ادخل دليل الساحل الشمالي.'
              : 'Select any destination corridor to jump directly into filtered inventory or explore our North Coast hub.'}
          </p>
        </div>

        {/* 6 Editorial Cards Grid */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6 lg:gap-7">
          {EGYPT_CORRIDORS.map((corridor) => {
            const title = isRtl ? corridor.nameAr : corridor.nameEn;
            const tag = isRtl ? corridor.tagAr : corridor.tagEn;
            const highlight = isRtl ? corridor.highlightAr : corridor.highlightEn;
            const hasFailed = Boolean(failedImages[corridor.id]);

            return (
              <button
                key={corridor.id}
                type="button"
                onClick={() =>
                  corridor.isSahel ? onOpenSahel() : onExploreLocation(corridor.query)
                }
                aria-label={
                  isRtl ? `استكشف عقارات ${title}` : `Explore properties in ${title}`
                }
                className="group relative h-80 sm:h-[21rem] rounded-3xl overflow-hidden text-start border border-slate-200/80 dark:border-slate-800 shadow-sm hover:shadow-2xl hover:shadow-brand-900/20 transition-all duration-500 hover:-translate-y-1.5 cursor-pointer focus:outline-none focus:ring-2 focus:ring-accent-500 focus:ring-offset-2 dark:focus:ring-offset-slate-950"
              >
                {/* Curated Photo with Graceful Gradient Fallback */}
                <div
                  className={`absolute inset-0 bg-gradient-to-br ${corridor.fallbackGradient}`}
                  aria-hidden="true"
                />
                {!hasFailed && (
                  <img
                    src={corridor.imageUrl}
                    alt=""
                    aria-hidden="true"
                    loading="lazy"
                    onError={() =>
                      setFailedImages((prev) => ({ ...prev, [corridor.id]: true }))
                    }
                    className="absolute inset-0 w-full h-full object-cover transition-transform duration-700 ease-out group-hover:scale-110"
                  />
                )}

                {/* Deep Architectural Scrim */}
                <div
                  className="absolute inset-0 bg-gradient-to-t from-brand-950/95 via-brand-950/45 to-brand-950/20 group-hover:via-brand-950/55 transition-colors duration-300"
                  aria-hidden="true"
                />

                {/* Top Badge Row */}
                <div className="relative z-10 h-full flex flex-col justify-between p-6">
                  <div className="flex items-center justify-between gap-2">
                    <span
                      className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-[11px] font-black backdrop-blur-md border ${
                        corridor.isSahel
                          ? 'bg-cyan-500/25 border-cyan-300/40 text-cyan-100'
                          : 'bg-white/15 border-white/25 text-white'
                      }`}
                    >
                      {corridor.isSahel ? (
                        <Waves className="w-3.5 h-3.5" aria-hidden="true" />
                      ) : (
                        <MapPin className="w-3.5 h-3.5 text-accent-400" aria-hidden="true" />
                      )}
                      <span>{tag}</span>
                    </span>

                    <span className="w-9 h-9 rounded-full bg-white/15 border border-white/25 backdrop-blur-md text-white flex items-center justify-center group-hover:bg-accent-500 group-hover:border-accent-500 transition-all duration-300">
                      <ArrowUpRight
                        className={`w-4 h-4 transition-transform duration-300 group-hover:scale-110 ${
                          isRtl ? '-scale-x-100' : ''
                        }`}
                        aria-hidden="true"
                      />
                    </span>
                  </div>

                  {/* Bottom Title & Highlights */}
                  <div>
                    <h3
                      className={`text-xl sm:text-2xl font-black text-white mb-2 leading-snug ${
                        isRtl ? 'font-cairo' : 'font-heading tracking-tight'
                      }`}
                    >
                      {title}
                    </h3>
                    <p className="text-xs sm:text-sm text-slate-200/90 leading-relaxed line-clamp-2 mb-3">
                      {highlight}
                    </p>
                    <span className="inline-flex items-center gap-1.5 text-xs font-black text-accent-300 group-hover:text-accent-200 transition-colors">
                      <span>
                        {corridor.isSahel
                          ? isRtl
                            ? 'افتح دليل الساحل'
                            : 'Open Coastal Hub'
                          : isRtl
                            ? 'تصفح وحدات المنطقة'
                            : 'Browse Area Units'}
                      </span>
                      {isRtl ? (
                        <ArrowLeft className="w-3.5 h-3.5" aria-hidden="true" />
                      ) : (
                        <ArrowRight className="w-3.5 h-3.5" aria-hidden="true" />
                      )}
                    </span>
                  </div>
                </div>
              </button>
            );
          })}
        </div>
      </div>
    </section>
  );
};

/* ============================================================================
 * 3. HomeInstallmentEstimatorSection — Interactive Affordability & Payment Planner
 * ========================================================================== */

export interface HomeInstallmentEstimatorSectionProps {
  isRtl: boolean;
  onBrowseListings: () => void;
  onOpenAdvisor: () => void;
}

const BUDGET_PRESETS = [4_000_000, 8_500_000, 15_000_000, 30_000_000];

export const HomeInstallmentEstimatorSection: React.FC<
  HomeInstallmentEstimatorSectionProps
> = ({ isRtl, onBrowseListings, onOpenAdvisor }) => {
  const [budget, setBudget] = useState<number>(8_500_000);
  const [downPaymentPct, setDownPaymentPct] = useState<number>(10);
  const [years, setYears] = useState<number>(8);

  const calc = useMemo(() => {
    const downPaymentAmount = Math.round((budget * downPaymentPct) / 100);
    const financedAmount = Math.max(0, budget - downPaymentAmount);
    const totalMonths = Math.max(1, years * 12);
    const monthlyInstallment = Math.round(financedAmount / totalMonths);
    const quarterlyInstallment = monthlyInstallment * 3;
    return {
      downPaymentAmount,
      financedAmount,
      monthlyInstallment,
      quarterlyInstallment,
      totalMonths,
    };
  }, [budget, downPaymentPct, years]);

  const formatEgp = (val: number) =>
    `${val.toLocaleString(isRtl ? 'ar-EG' : 'en-US')} ${isRtl ? 'ج.م' : 'EGP'}`;

  const formatCompactBudget = (val: number) => {
    const m = val / 1_000_000;
    return isRtl ? `${m} مليون` : `${m}M EGP`;
  };

  return (
    <section
      aria-labelledby="installment-estimator-heading"
      dir={isRtl ? 'rtl' : 'ltr'}
      className={`py-20 sm:py-24 bg-white dark:bg-slate-950 transition-colors duration-500 ${
        isRtl ? 'font-cairo' : ''
      }`}
    >
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="rounded-[2rem] border border-slate-200/80 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-900/50 p-6 sm:p-10 lg:p-12 shadow-xl shadow-brand-900/5">
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-10 lg:gap-12 items-center">
            {/* Interactive Sliders Column */}
            <div className="lg:col-span-7 text-start space-y-7">
              <div>
                <span
                  className={`inline-flex items-center gap-2 text-xs font-black text-accent-600 dark:text-accent-400 mb-3 ${
                    isRtl ? '' : 'uppercase tracking-[0.2em]'
                  }`}
                >
                  <Calculator className="w-3.5 h-3.5" aria-hidden="true" />
                  {isRtl ? 'مخطط القدرة الشرائية والأقساط' : 'AFFORDABILITY & INSTALLMENT PLANNER'}
                </span>
                <h2
                  id="installment-estimator-heading"
                  className={`text-3xl sm:text-4xl font-black text-[#1b2c4d] dark:text-white leading-tight mb-3 ${
                    isRtl ? 'font-cairo' : 'font-heading tracking-tight'
                  }`}
                >
                  {isRtl
                    ? 'احسب قسطك التقديري قبل ما تختار وحدتك'
                    : 'Estimate Your Monthly Installment in Seconds'}
                </h2>
                <p className="text-sm sm:text-base text-slate-600 dark:text-slate-400 leading-relaxed">
                  {isRtl
                    ? 'حرّك المؤشرات لتجربة ميزانيات ونسب مقدم وسنوات سداد مختلفة لتكوين تصور مبدئي لخطة الشراء.'
                    : 'Adjust target budget, down payment percentage, and installment horizon to model a quick planning estimate.'}
                </p>
              </div>

              {/* Quick Budget Presets */}
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-xs font-bold text-slate-500 dark:text-slate-400 me-1 inline-flex items-center gap-1">
                  <SlidersHorizontal className="w-3.5 h-3.5" aria-hidden="true" />
                  {isRtl ? 'ميزانيات سريعة:' : 'Quick budgets:'}
                </span>
                {BUDGET_PRESETS.map((preset) => {
                  const active = budget === preset;
                  return (
                    <button
                      key={preset}
                      type="button"
                      onClick={() => setBudget(preset)}
                      className={`px-3.5 py-1.5 rounded-full text-xs font-black transition-all cursor-pointer focus:outline-none focus:ring-2 focus:ring-accent-500 ${
                        active
                          ? 'bg-[#1b2c4d] dark:bg-accent-500 text-white shadow-sm'
                          : 'bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-300 border border-slate-200 dark:border-slate-700 hover:border-brand-400'
                      }`}
                    >
                      {formatCompactBudget(preset)}
                    </button>
                  );
                })}
              </div>

              {/* Slider 1: Property Budget */}
              <div className="space-y-2.5 bg-white dark:bg-slate-900 p-5 rounded-2xl border border-slate-200/80 dark:border-slate-800">
                <div className="flex items-center justify-between gap-2">
                  <label
                    htmlFor="estimator-budget-slider"
                    className="text-sm font-black text-[#1b2c4d] dark:text-white"
                  >
                    {isRtl ? 'ميزانية العقار' : 'Property Budget'}
                  </label>
                  <span className="font-mono text-sm sm:text-base font-black text-accent-600 dark:text-accent-400 tabular-nums">
                    {formatEgp(budget)}
                  </span>
                </div>
                <input
                  id="estimator-budget-slider"
                  type="range"
                  min={2_000_000}
                  max={50_000_000}
                  step={500_000}
                  value={budget}
                  onChange={(e) => setBudget(Number(e.target.value))}
                  className="w-full h-2 rounded-lg accent-[#e67e22] cursor-pointer"
                />
                <div className="flex justify-between text-[11px] font-bold text-slate-400 dark:text-slate-500">
                  <span>{isRtl ? '2 مليون ج.م' : '2M EGP'}</span>
                  <span>{isRtl ? '50 مليون ج.م' : '50M EGP'}</span>
                </div>
              </div>

              {/* Sliders 2 & 3 side-by-side */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                {/* Down Payment % */}
                <div className="space-y-2.5 bg-white dark:bg-slate-900 p-5 rounded-2xl border border-slate-200/80 dark:border-slate-800">
                  <div className="flex items-center justify-between gap-2">
                    <label
                      htmlFor="estimator-downpayment-slider"
                      className="text-sm font-black text-[#1b2c4d] dark:text-white"
                    >
                      {isRtl ? 'نسبة المقدم' : 'Down Payment'}
                    </label>
                    <span className="font-mono text-sm font-black text-brand-600 dark:text-accent-400 tabular-nums">
                      {downPaymentPct}%
                    </span>
                  </div>
                  <input
                    id="estimator-downpayment-slider"
                    type="range"
                    min={5}
                    max={40}
                    step={1}
                    value={downPaymentPct}
                    onChange={(e) => setDownPaymentPct(Number(e.target.value))}
                    className="w-full h-2 rounded-lg accent-[#1b2c4d] dark:accent-[#e67e22] cursor-pointer"
                  />
                  <div className="flex justify-between text-[11px] font-bold text-slate-400 dark:text-slate-500">
                    <span>5%</span>
                    <span>40%</span>
                  </div>
                </div>

                {/* Years */}
                <div className="space-y-2.5 bg-white dark:bg-slate-900 p-5 rounded-2xl border border-slate-200/80 dark:border-slate-800">
                  <div className="flex items-center justify-between gap-2">
                    <label
                      htmlFor="estimator-years-slider"
                      className="text-sm font-black text-[#1b2c4d] dark:text-white"
                    >
                      {isRtl ? 'مدة التقسيط' : 'Installment Years'}
                    </label>
                    <span className="font-mono text-sm font-black text-brand-600 dark:text-accent-400 tabular-nums">
                      {years} {isRtl ? (years === 1 ? 'سنة' : 'سنوات') : years === 1 ? 'yr' : 'yrs'}
                    </span>
                  </div>
                  <input
                    id="estimator-years-slider"
                    type="range"
                    min={1}
                    max={12}
                    step={1}
                    value={years}
                    onChange={(e) => setYears(Number(e.target.value))}
                    className="w-full h-2 rounded-lg accent-[#1b2c4d] dark:accent-[#e67e22] cursor-pointer"
                  />
                  <div className="flex justify-between text-[11px] font-bold text-slate-400 dark:text-slate-500">
                    <span>{isRtl ? 'سنة واحدة' : '1 yr'}</span>
                    <span>{isRtl ? '12 سنة' : '12 yrs'}</span>
                  </div>
                </div>
              </div>
            </div>

            {/* Live Breakdown Summary Card */}
            <div className="lg:col-span-5">
              <div className="relative rounded-3xl bg-[#1b2c4d] dark:bg-slate-900 text-white p-6 sm:p-8 border border-brand-700/80 dark:border-slate-800 shadow-2xl overflow-hidden text-start">
                {/* Ambient glow */}
                <div
                  className="absolute -top-20 -end-20 w-56 h-56 rounded-full bg-accent-500/20 blur-[80px] pointer-events-none"
                  aria-hidden="true"
                />

                <div className="relative z-10">
                  <div className="flex items-center justify-between gap-2 mb-2">
                    <span className="text-xs font-bold text-brand-200 dark:text-slate-400">
                      {isRtl ? 'القسط الشهري التقديري' : 'Estimated Monthly Installment'}
                    </span>
                    <span className="text-[10px] font-black px-2.5 py-1 rounded-full bg-white/10 border border-white/15 text-accent-300">
                      {isRtl ? 'تقدير إرشادي' : 'Estimate Only'}
                    </span>
                  </div>

                  <div
                    className="font-mono text-3xl sm:text-4xl font-black text-white tracking-tight tabular-nums mb-6"
                    aria-live="polite"
                  >
                    {formatEgp(calc.monthlyInstallment)}
                    <span className="text-xs font-sans font-semibold text-brand-200 dark:text-slate-400 ms-1.5">
                      {isRtl ? '/ شهر' : '/ mo'}
                    </span>
                  </div>

                  {/* Proportion Bar */}
                  <div className="mb-6">
                    <div className="h-2.5 w-full rounded-full bg-white/15 overflow-hidden flex">
                      <div
                        className="bg-accent-500 h-full transition-all duration-300"
                        style={{ width: `${downPaymentPct}%` }}
                      />
                      <div
                        className="bg-brand-300/70 h-full transition-all duration-300"
                        style={{ width: `${100 - downPaymentPct}%` }}
                      />
                    </div>
                    <div className="flex justify-between text-[11px] font-bold text-brand-200 dark:text-slate-400 mt-2">
                      <span>
                        {isRtl ? `مقدم (${downPaymentPct}%)` : `Down (${downPaymentPct}%)`}
                      </span>
                      <span>
                        {isRtl
                          ? `متبقي (${100 - downPaymentPct}%)`
                          : `Financed (${100 - downPaymentPct}%)`}
                      </span>
                    </div>
                  </div>

                  {/* Detailed Metrics */}
                  <div className="space-y-3 py-4 border-y border-white/10 mb-5 text-sm">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-brand-200 dark:text-slate-400">
                        {isRtl ? 'قيمة المقدم' : 'Down Payment Amount'}
                      </span>
                      <span className="font-mono font-bold text-white tabular-nums">
                        {formatEgp(calc.downPaymentAmount)}
                      </span>
                    </div>
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-brand-200 dark:text-slate-400">
                        {isRtl ? 'المبلغ المتبقي للتقسيط' : 'Financed Balance'}
                      </span>
                      <span className="font-mono font-bold text-white tabular-nums">
                        {formatEgp(calc.financedAmount)}
                      </span>
                    </div>
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-brand-200 dark:text-slate-400">
                        {isRtl ? 'المكافئ الربع سنوي' : 'Quarterly Equivalent'}
                      </span>
                      <span className="font-mono font-bold text-accent-300 tabular-nums">
                        {formatEgp(calc.quarterlyInstallment)}
                      </span>
                    </div>
                  </div>

                  {/* Honest Transparency Disclaimer */}
                  <div className="flex items-start gap-2.5 p-3.5 rounded-2xl bg-white/5 border border-white/10 text-[11px] text-brand-100/90 dark:text-slate-300 leading-relaxed mb-6">
                    <Info className="w-4 h-4 text-accent-400 shrink-0 mt-0.5" aria-hidden="true" />
                    <p>
                      {isRtl
                        ? 'أرقام إرشادية فقط محسوبة كأقساط متساوية بدون فوائد بنكية أو دفعات استلام أو وديعة صيانة. تختلف الجداول الفعلية حسب كل مطور أو عقد.'
                        : 'Guidance estimate only, modeled as equal principal installments excluding maintenance fees, delivery payments, or bank financing interest. Actual schedules depend on each developer contract.'}
                    </p>
                  </div>

                  {/* Action CTAs */}
                  <div className="flex flex-col gap-3">
                    <button
                      type="button"
                      onClick={onBrowseListings}
                      className="w-full py-3.5 px-5 rounded-xl bg-accent-500 hover:bg-accent-600 text-white font-black text-sm shadow-lg shadow-accent-500/25 transition-all flex items-center justify-center gap-2 cursor-pointer active:scale-[0.98] focus:outline-none focus:ring-2 focus:ring-accent-400"
                    >
                      <span>
                        {isRtl ? 'تصفح العقارات المتاحة' : 'Browse Matching Properties'}
                      </span>
                      {isRtl ? (
                        <ArrowLeft className="w-4 h-4" aria-hidden="true" />
                      ) : (
                        <ArrowRight className="w-4 h-4" aria-hidden="true" />
                      )}
                    </button>
                    <button
                      type="button"
                      onClick={onOpenAdvisor}
                      className="w-full py-3 px-5 rounded-xl bg-white/10 hover:bg-white/15 border border-white/15 text-white font-bold text-sm transition-all flex items-center justify-center gap-2 cursor-pointer focus:outline-none focus:ring-2 focus:ring-white/60"
                    >
                      <Sparkles className="w-4 h-4 text-accent-300" aria-hidden="true" />
                      <span>
                        {isRtl ? 'اسأل المستشار الذكي عن الخطط' : 'Ask the AI Advisor'}
                      </span>
                    </button>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
};

/* ============================================================================
 * 4. HomeSpotlightBannerSection — Dual Editorial Bento + Legal Vault Callout
 * ========================================================================== */

export interface HomeSpotlightBannerSectionProps {
  isRtl: boolean;
  onOpenSahel: () => void;
  onOpenAdvisor: () => void;
  onOpenLegal: () => void;
}

export const HomeSpotlightBannerSection: React.FC<HomeSpotlightBannerSectionProps> = ({
  isRtl,
  onOpenSahel,
  onOpenAdvisor,
  onOpenLegal,
}) => {
  return (
    <section
      aria-label={isRtl ? 'أبرز تجارب حتتي' : 'HETTETY Platform Spotlights'}
      dir={isRtl ? 'rtl' : 'ltr'}
      className={`py-16 sm:py-20 bg-slate-50 dark:bg-slate-900/40 transition-colors duration-500 ${
        isRtl ? 'font-cairo' : ''
      }`}
    >
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 space-y-6">
        {/* Dual Editorial Bento Grid */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Bento 1: Sahel Hettety 3D Coastal Discovery */}
          <article className="relative rounded-[2rem] overflow-hidden bg-gradient-to-br from-[#0e3a5c] via-[#1b2c4d] to-brand-950 text-white p-8 sm:p-10 border border-cyan-400/20 shadow-xl flex flex-col justify-between min-h-[21rem] text-start">
            <div
              className="absolute inset-0 opacity-20 bg-[radial-gradient(circle_at_80%_20%,rgba(56,189,248,0.45),transparent_55%)] pointer-events-none"
              aria-hidden="true"
            />
            <div className="relative z-10">
              <span className="inline-flex items-center gap-2 px-3.5 py-1.5 rounded-full bg-cyan-400/15 border border-cyan-300/30 text-cyan-200 text-xs font-black mb-5">
                <Waves className="w-3.5 h-3.5" aria-hidden="true" />
                {isRtl ? 'دليل الساحل الشمالي التفاعلي' : '3D COASTAL DISCOVERY'}
              </span>
              <h3
                className={`text-2xl sm:text-3xl font-black text-white mb-3 leading-tight ${
                  isRtl ? 'font-cairo' : 'font-heading tracking-tight'
                }`}
              >
                {isRtl
                  ? 'ساحل حتتي — عاين شاليهك ثلاثي الأبعاد قبل الصيف'
                  : 'Sahel Hettety — Walk Through North Coast Chalets in 3D'}
              </h3>
              <p className="text-sm sm:text-base text-slate-200/90 leading-relaxed max-w-lg mb-8">
                {isRtl
                  ? 'استكشف وحدات مراسي وهاسيندا ورأس الحكمة والعلمين، وتواصل مباشرة مع المالك مع وضوح كامل لحالة مراجعة الإعلان.'
                  : 'Preview chalets across Marassi, Hacienda, Ras El Hekma, and Alamein with interactive walkthroughs and direct owner contact.'}
              </p>
            </div>
            <div className="relative z-10">
              <button
                type="button"
                onClick={onOpenSahel}
                className="inline-flex items-center gap-2.5 px-6 py-3.5 rounded-xl bg-white text-[#1b2c4d] hover:bg-cyan-50 font-black text-sm shadow-lg transition-all cursor-pointer active:scale-[0.98] focus:outline-none focus:ring-2 focus:ring-cyan-300"
              >
                <span>{isRtl ? 'استكشف شاليهات الساحل' : 'Explore Coastal Chalets'}</span>
                {isRtl ? (
                  <ArrowLeft className="w-4 h-4" aria-hidden="true" />
                ) : (
                  <ArrowRight className="w-4 h-4" aria-hidden="true" />
                )}
              </button>
            </div>
          </article>

          {/* Bento 2: HETTETY AI Real Estate Advisor */}
          <article className="relative rounded-[2rem] overflow-hidden bg-gradient-to-br from-[#1b2c4d] via-brand-900 to-slate-950 text-white p-8 sm:p-10 border border-accent-500/25 shadow-xl flex flex-col justify-between min-h-[21rem] text-start">
            <div
              className="absolute inset-0 opacity-30 bg-[radial-gradient(circle_at_85%_15%,rgba(230,126,34,0.45),transparent_55%)] pointer-events-none"
              aria-hidden="true"
            />
            <div className="relative z-10">
              <span className="inline-flex items-center gap-2 px-3.5 py-1.5 rounded-full bg-accent-500/20 border border-accent-400/35 text-accent-200 text-xs font-black mb-5">
                <Sparkles className="w-3.5 h-3.5" aria-hidden="true" />
                {isRtl ? 'استشارة ذكية بالعربية والإنجليزية' : 'BILINGUAL AI GUIDANCE'}
              </span>
              <h3
                className={`text-2xl sm:text-3xl font-black text-white mb-3 leading-tight ${
                  isRtl ? 'font-cairo' : 'font-heading tracking-tight'
                }`}
              >
                {isRtl
                  ? 'مستشار حتتي العقاري الذكي لاختيار أنسب وحدة'
                  : 'HETTETY AI Real Estate Advisor at Your Side'}
              </h3>
              <p className="text-sm sm:text-base text-slate-200/90 leading-relaxed max-w-lg mb-8">
                {isRtl
                  ? 'قارن بين الكمبوندات، راجع مواعيد الاستلام والتشطيبات، واطلب ترشيحات متوافقة مع ميزانيتك وهدفك السكني أو الاستثماري.'
                  : 'Compare compounds side-by-side, weigh finishing & delivery timelines, and receive tailored unit matches in English or Arabic.'}
              </p>
            </div>
            <div className="relative z-10">
              <button
                type="button"
                onClick={onOpenAdvisor}
                className="inline-flex items-center gap-2.5 px-6 py-3.5 rounded-xl bg-accent-500 hover:bg-accent-600 text-white font-black text-sm shadow-lg shadow-accent-500/25 transition-all cursor-pointer active:scale-[0.98] focus:outline-none focus:ring-2 focus:ring-accent-300"
              >
                <span>{isRtl ? 'ابدأ المحادثة الاستشارية' : 'Start AI Consultation'}</span>
                {isRtl ? (
                  <ArrowLeft className="w-4 h-4" aria-hidden="true" />
                ) : (
                  <ArrowRight className="w-4 h-4" aria-hidden="true" />
                )}
              </button>
            </div>
          </article>
        </div>

        {/* Compact Legal Document Review Vault Callout */}
        <div className="rounded-3xl bg-white dark:bg-slate-900 border border-slate-200/80 dark:border-slate-800 p-6 sm:p-7 shadow-sm flex flex-col md:flex-row items-start md:items-center justify-between gap-5 text-start">
          <div className="flex items-start gap-4 max-w-3xl">
            <div className="w-12 h-12 rounded-2xl bg-brand-50 dark:bg-brand-900/50 border border-brand-100 dark:border-brand-800 text-[#1b2c4d] dark:text-accent-400 flex items-center justify-center shrink-0">
              <FileSearch className="w-6 h-6" aria-hidden="true" />
            </div>
            <div>
              <h3
                className={`text-base sm:text-lg font-black text-[#1b2c4d] dark:text-white mb-1 ${
                  isRtl ? 'font-cairo' : 'font-heading'
                }`}
              >
                {isRtl ? 'مساحة مراجعة المستندات العقارية' : 'Legal Document Review Workspace'}
              </h3>
              <p className="text-xs sm:text-sm text-slate-600 dark:text-slate-400 leading-relaxed">
                {isRtl
                  ? 'ارفع صور عقودك ومستنداتك لمتابعة حالة مراجعتها من فريقنا بوضوح — مع التذكير بأن التحقق الرسمي من التسجيل يتم لدى الشهر العقاري.'
                  : 'Upload ownership copies to track human review status clearly in your workspace — official title registration always remains confirmed through the Real Estate Publicity Department.'}
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={onOpenLegal}
            className="inline-flex items-center gap-2 px-5 py-3 rounded-xl bg-slate-100 dark:bg-slate-800 hover:bg-[#1b2c4d] hover:text-white dark:hover:bg-accent-500 text-[#1b2c4d] dark:text-white font-black text-xs sm:text-sm transition-all shrink-0 cursor-pointer focus:outline-none focus:ring-2 focus:ring-brand-500"
          >
            <span>{isRtl ? 'افتح المركز القانوني' : 'Open Legal Workspace'}</span>
            {isRtl ? (
              <ArrowLeft className="w-4 h-4" aria-hidden="true" />
            ) : (
              <ArrowRight className="w-4 h-4" aria-hidden="true" />
            )}
          </button>
        </div>
      </div>
    </section>
  );
};
