import React, { useState } from 'react';
import {
  ArrowLeft,
  ArrowRight,
  Sparkles,
  PlayCircle,
  Search,
  MapPin,
  Box,
  Building2,
  FileCheck,
  X,
} from 'lucide-react';

export interface PremiumHeroProps {
  onPrimaryCta?: () => void;
  onSecondaryCta?: () => void;
  onQuickSearch?: (query: string) => void;
  onSelectLocation?: (location: string) => void;
  onOpen3D?: () => void;
  onOpenAdvisor?: () => void;
  t: any;
  isRtl: boolean;
}

interface QuickDestination {
  key: string;
  en: string;
  ar: string;
}

const QUICK_DESTINATIONS: QuickDestination[] = [
  { key: 'New Cairo', en: 'New Cairo', ar: 'القاهرة الجديدة' },
  { key: 'Sheikh Zayed', en: 'Sheikh Zayed', ar: 'الشيخ زايد' },
  { key: 'North Coast', en: 'North Coast', ar: 'الساحل الشمالي' },
  { key: 'New Capital', en: 'New Capital', ar: 'العاصمة الإدارية' },
];

export const PremiumHero: React.FC<PremiumHeroProps> = ({
  onPrimaryCta = () => {},
  onSecondaryCta = () => {},
  onQuickSearch,
  onSelectLocation,
  onOpen3D,
  onOpenAdvisor,
  t = {},
  isRtl,
}) => {
  const [searchQuery, setSearchQuery] = useState('');

  const handleQuickSearchSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = searchQuery.trim();
    if (onQuickSearch) {
      onQuickSearch(trimmed);
    } else {
      onSecondaryCta();
    }
  };

  const handleLocationPick = (loc: QuickDestination) => {
    if (onSelectLocation) {
      onSelectLocation(loc.key);
    } else if (onQuickSearch) {
      onQuickSearch(loc.key);
    } else {
      onSecondaryCta();
    }
  };

  const capabilityPillars = [
    {
      id: '3dgs',
      icon: <Box className="w-5 h-5" aria-hidden="true" />,
      title: isRtl ? 'جولات ثلاثية الأبعاد 3DGS' : '3D Gaussian Splatting Tours',
      desc: isRtl
        ? 'معاينة مكانية تفاعلية و360° للوحدات قبل الزيارة'
        : 'Interactive spatial walkthroughs & 360° previews',
      onClick: onOpen3D,
    },
    {
      id: 'advisor',
      icon: <Sparkles className="w-5 h-5" aria-hidden="true" />,
      title: isRtl ? 'مستشار عقاري ذكي ثنائي اللغة' : 'Bilingual AI Advisor',
      desc: isRtl
        ? 'مقارنة ذكية للمشروعات وخطط السداد بالعربية والإنجليزية'
        : 'Arabic & English project comparisons and guidance',
      onClick: onOpenAdvisor,
    },
    {
      id: 'direct',
      icon: <Building2 className="w-5 h-5" aria-hidden="true" />,
      title: isRtl ? 'إعلانات مباشرة من الملاك والمطورين' : 'Direct Owner & Developer Listings',
      desc: isRtl
        ? 'مواصفات وأسعار معلنة مباشرة من أصحاب الوحدات'
        : 'Transparent unit specs and pricing posted directly',
      onClick: onSecondaryCta,
    },
    {
      id: 'review',
      icon: <FileCheck className="w-5 h-5" aria-hidden="true" />,
      title: isRtl ? 'تتبع مراجعة المستندات' : 'Document Review Tracking',
      desc: isRtl
        ? 'شارات واضحة توضّح ما راجعه فريقنا من مستندات مرفوعة'
        : 'Clear status labels showing what our team reviewed',
      onClick: undefined,
    },
  ];

  return (
    <section
      aria-label={isRtl ? 'القسم الترحيبي' : 'Hero'}
      className={`relative min-h-[92vh] flex flex-col justify-between overflow-hidden bg-white dark:bg-slate-950 font-sans transition-colors duration-500 ${
        isRtl ? 'font-cairo' : ''
      }`}
      dir={isRtl ? 'rtl' : 'ltr'}
    >
      {/* Layered Architectural Backdrop */}
      <div className="absolute inset-0 z-0 pointer-events-none">
        <img
          src="https://images.unsplash.com/photo-1486406146926-c627a92ad1ab?auto=format&fit=crop&q=80&w=2000"
          alt=""
          aria-hidden="true"
          className="w-full h-full object-cover opacity-[0.14] dark:opacity-[0.22] scale-105 transition-opacity duration-500"
        />
        {/* Layered Light / Dark Gradient Vignettes */}
        <div className="absolute inset-0 bg-gradient-to-b from-brand-50/75 via-white/85 to-white dark:from-brand-950/80 dark:via-slate-950/90 dark:to-slate-950" />
        {/* Subtle Architectural Blueprint Grid */}
        <div
          className="absolute inset-0 opacity-60 dark:opacity-40 bg-[linear-gradient(to_right,rgba(27,44,77,0.045)_1px,transparent_1px),linear-gradient(to_bottom,rgba(27,44,77,0.045)_1px,transparent_1px)] dark:bg-[linear-gradient(to_right,rgba(255,255,255,0.035)_1px,transparent_1px),linear-gradient(to_bottom,rgba(255,255,255,0.035)_1px,transparent_1px)] bg-[size:52px_52px]"
          aria-hidden="true"
        />
        {/* Ambient Navy & Amber Radial Auras */}
        <div className="absolute -top-32 start-1/2 -translate-x-1/2 w-[56rem] h-[28rem] rounded-full bg-brand-600/10 dark:bg-brand-500/20 blur-[120px]" />
        <div className="absolute bottom-20 end-10 w-[26rem] h-[26rem] rounded-full bg-accent-500/10 dark:bg-accent-500/15 blur-[110px]" />
      </div>

      {/* Main Centered Editorial Stage */}
      <div className="relative z-10 max-w-6xl mx-auto w-full px-4 sm:px-6 lg:px-8 pt-16 sm:pt-20 lg:pt-24 pb-10 text-center flex-1 flex flex-col items-center justify-center">
        {/* Refined Pill Badge */}
        {t.hero_badge && (
          <div className="inline-flex items-center gap-2.5 bg-white/85 dark:bg-slate-900/80 backdrop-blur-md border border-brand-200/80 dark:border-slate-700/80 rounded-full px-5 py-2 mb-7 animate-slide-up shadow-sm shadow-brand-900/5">
            <span className="w-2 h-2 rounded-full bg-accent-500 animate-pulse" aria-hidden="true" />
            <Sparkles className="w-3.5 h-3.5 text-brand-600 dark:text-accent-400" aria-hidden="true" />
            <span
              className={`text-brand-700 dark:text-accent-300 text-xs font-black ${
                isRtl ? 'font-cairo' : 'tracking-[0.2em] uppercase'
              }`}
            >
              {t.hero_badge}
            </span>
          </div>
        )}

        {/* Monumental Architectural Headline */}
        <h1
          className={`text-4xl sm:text-6xl md:text-7xl lg:text-[5.25rem] font-black text-[#1b2c4d] dark:text-white mb-6 leading-[1.04] max-w-5xl animate-fade-in ${
            isRtl ? 'font-cairo leading-[1.15]' : 'font-heading tracking-tighter'
          }`}
        >
          <span>{t.hero_title_start}</span>{' '}
          <span className="block mt-1 sm:mt-2 text-transparent bg-clip-text bg-gradient-to-r from-[#1b2c4d] via-brand-500 to-[#e67e22] dark:from-white dark:via-accent-200 dark:to-accent-400">
            {t.hero_title_end}
          </span>
        </h1>

        {/* Subtitle */}
        <p
          className={`text-base sm:text-xl md:text-2xl text-slate-600 dark:text-slate-300 mb-9 max-w-3xl mx-auto leading-relaxed font-semibold animate-slide-up ${
            isRtl ? 'font-cairo' : ''
          }`}
        >
          {t.hero_subtitle}
        </p>

        {/* Floating Luxury Quick-Discovery Bar */}
        <div className="w-full max-w-3xl mx-auto mb-9 animate-slide-up">
          <form
            onSubmit={handleQuickSearchSubmit}
            role="search"
            aria-label={isRtl ? 'بحث سريع عن العقارات' : 'Quick property discovery'}
            className="bg-white/95 dark:bg-slate-900/90 backdrop-blur-xl rounded-3xl p-2.5 sm:p-3 border border-slate-200/90 dark:border-slate-800 shadow-[0_20px_60px_-15px_rgba(27,44,77,0.14)] dark:shadow-[0_24px_64px_-12px_rgba(0,0,0,0.55)] transition-all focus-within:border-accent-500/60 focus-within:ring-4 focus-within:ring-accent-500/10"
          >
            <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2">
              <div className="relative flex-1 flex items-center">
                <Search
                  className="w-5 h-5 text-brand-500 dark:text-slate-400 absolute start-4 pointer-events-none"
                  aria-hidden="true"
                />
                <input
                  type="text"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder={
                    isRtl
                      ? 'ابحث بالمنطقة أو اسم الكمبوند أو نوع الوحدة (مثال: فيلا التجمع)...'
                      : 'Search by district, compound, or unit type (e.g. New Cairo villa)...'
                  }
                  aria-label={isRtl ? 'كلمة البحث عن العقار' : 'Search properties by keyword'}
                  className="w-full ps-12 pe-10 py-3.5 sm:py-4 rounded-2xl bg-slate-50/80 dark:bg-slate-950/70 border border-transparent focus:border-brand-300 dark:focus:border-slate-700 text-sm sm:text-base font-medium text-[#1b2c4d] dark:text-white placeholder:text-slate-400 dark:placeholder:text-slate-500 outline-none transition-colors"
                />
                {searchQuery && (
                  <button
                    type="button"
                    onClick={() => setSearchQuery('')}
                    aria-label={isRtl ? 'مسح نص البحث' : 'Clear search input'}
                    className="absolute end-3 p-1.5 rounded-full text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 hover:bg-slate-200/70 dark:hover:bg-slate-800 transition-colors cursor-pointer"
                  >
                    <X className="w-4 h-4" aria-hidden="true" />
                  </button>
                )}
              </div>

              <button
                type="submit"
                className="px-7 py-3.5 sm:py-4 rounded-2xl bg-[#1b2c4d] hover:bg-brand-700 dark:bg-accent-500 dark:hover:bg-accent-600 text-white font-black text-sm sm:text-base shadow-lg shadow-brand-900/15 dark:shadow-accent-500/25 transition-all duration-300 flex items-center justify-center gap-2 shrink-0 cursor-pointer active:scale-[0.98] focus:outline-none focus:ring-2 focus:ring-accent-500 focus:ring-offset-2 dark:focus:ring-offset-slate-900"
              >
                <Search className="w-4 h-4" aria-hidden="true" />
                <span>{isRtl ? 'ابحث الآن' : 'Quick Search'}</span>
              </button>
            </div>

            {/* Quick-Destination Pills */}
            <div className="flex flex-wrap items-center justify-center sm:justify-start gap-2 pt-3 px-1.5 pb-0.5">
              <span className="text-[11px] font-bold text-slate-500 dark:text-slate-400 me-1">
                {isRtl ? 'أبرز المناطق:' : 'Popular corridors:'}
              </span>
              {QUICK_DESTINATIONS.map((dest) => (
                <button
                  key={dest.key}
                  type="button"
                  onClick={() => handleLocationPick(dest)}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-bold bg-slate-100/90 dark:bg-slate-800/90 text-[#1b2c4d] dark:text-slate-200 border border-slate-200/70 dark:border-slate-700/80 hover:border-accent-500/70 hover:bg-accent-50 dark:hover:bg-accent-500/15 hover:text-accent-700 dark:hover:text-accent-300 transition-all cursor-pointer focus:outline-none focus:ring-2 focus:ring-accent-500"
                >
                  <MapPin className="w-3 h-3 text-accent-500 shrink-0" aria-hidden="true" />
                  <span>{isRtl ? dest.ar : dest.en}</span>
                </button>
              ))}
            </div>
          </form>
        </div>

        {/* Primary & Secondary Action CTAs */}
        <div className="flex flex-col sm:flex-row gap-4 justify-center items-center w-full sm:w-auto animate-slide-up">
          <button
            type="button"
            onClick={onPrimaryCta}
            className={`group relative px-9 py-4 bg-accent-500 hover:bg-accent-600 active:bg-accent-700 text-white text-base sm:text-lg font-black rounded-2xl transition-all duration-300 shadow-xl shadow-accent-500/25 hover:shadow-2xl hover:shadow-accent-500/40 transform hover:-translate-y-0.5 w-full sm:w-auto flex items-center justify-center gap-2.5 overflow-hidden cursor-pointer focus:outline-none focus:ring-2 focus:ring-accent-500 focus:ring-offset-2 dark:focus:ring-offset-slate-950 ${
              isRtl ? 'font-cairo' : 'uppercase tracking-wider'
            }`}
          >
            <span className="relative z-10">{t.hero_cta_primary}</span>
            {isRtl ? (
              <ArrowLeft
                className="w-5 h-5 relative z-10 group-hover:-translate-x-1 transition-transform"
                aria-hidden="true"
              />
            ) : (
              <ArrowRight
                className="w-5 h-5 relative z-10 group-hover:translate-x-1 transition-transform"
                aria-hidden="true"
              />
            )}
            <span
              className="absolute inset-0 bg-white/15 translate-y-full group-hover:translate-y-0 transition-transform duration-300"
              aria-hidden="true"
            />
          </button>

          <button
            type="button"
            onClick={onSecondaryCta}
            className={`group px-9 py-4 bg-white/85 dark:bg-slate-900/75 hover:bg-brand-50 dark:hover:bg-slate-800 text-[#1b2c4d] dark:text-white text-base sm:text-lg font-black rounded-2xl border border-brand-200 dark:border-slate-700 backdrop-blur-md transition-all duration-300 hover:border-brand-400 dark:hover:border-slate-500 w-full sm:w-auto flex items-center justify-center gap-2.5 transform hover:-translate-y-0.5 shadow-sm hover:shadow-lg cursor-pointer focus:outline-none focus:ring-2 focus:ring-brand-500 focus:ring-offset-2 dark:focus:ring-offset-slate-950 ${
              isRtl ? 'font-cairo' : 'uppercase tracking-wider'
            }`}
          >
            <PlayCircle
              className="w-5 h-5 text-accent-500 group-hover:scale-110 transition-transform"
              aria-hidden="true"
            />
            <span>{t.hero_cta_secondary}</span>
          </button>
        </div>

        {/* Optional Secondary Platform Shortcuts */}
        {(onOpen3D || onOpenAdvisor) && (
          <div className="flex flex-wrap items-center justify-center gap-3 mt-5">
            {onOpen3D && (
              <button
                type="button"
                onClick={onOpen3D}
                className="inline-flex items-center gap-2 text-xs sm:text-sm font-bold text-slate-600 dark:text-slate-300 hover:text-accent-600 dark:hover:text-accent-400 px-3.5 py-1.5 rounded-full hover:bg-slate-100/80 dark:hover:bg-slate-800/70 transition-colors cursor-pointer focus:outline-none focus:ring-2 focus:ring-brand-500"
              >
                <Box className="w-4 h-4 text-brand-600 dark:text-accent-400" aria-hidden="true" />
                <span>{isRtl ? 'ادخل صالة العرض 3D' : 'Launch 3D Showroom'}</span>
              </button>
            )}
            {onOpen3D && onOpenAdvisor && (
              <span className="text-slate-300 dark:text-slate-700" aria-hidden="true">
                •
              </span>
            )}
            {onOpenAdvisor && (
              <button
                type="button"
                onClick={onOpenAdvisor}
                className="inline-flex items-center gap-2 text-xs sm:text-sm font-bold text-slate-600 dark:text-slate-300 hover:text-accent-600 dark:hover:text-accent-400 px-3.5 py-1.5 rounded-full hover:bg-slate-100/80 dark:hover:bg-slate-800/70 transition-colors cursor-pointer focus:outline-none focus:ring-2 focus:ring-brand-500"
              >
                <Sparkles className="w-4 h-4 text-accent-500" aria-hidden="true" />
                <span>{isRtl ? 'استشر المستشار العقاري الذكي' : 'Consult AI Property Advisor'}</span>
              </button>
            )}
          </div>
        )}
      </div>

      {/* Bottom 4-Pillar Honest Capability Strip */}
      <div className="relative z-10 w-full border-t border-slate-200/80 dark:border-slate-800/80 bg-white/80 dark:bg-slate-900/60 backdrop-blur-md">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 lg:gap-6">
            {capabilityPillars.map((pillar) => {
              const cardContent = (
                <div className="flex items-start gap-3.5 text-start">
                  <div className="w-10 h-10 rounded-xl bg-brand-50 dark:bg-brand-900/50 border border-brand-100 dark:border-brand-800/70 text-[#1b2c4d] dark:text-accent-400 flex items-center justify-center shrink-0 transition-transform duration-300 group-hover:scale-105">
                    {pillar.icon}
                  </div>
                  <div className="min-w-0">
                    <h2 className="text-sm font-black text-[#1b2c4d] dark:text-white leading-snug">
                      {pillar.title}
                    </h2>
                    <p className="text-xs text-slate-500 dark:text-slate-400 mt-1 leading-relaxed">
                      {pillar.desc}
                    </p>
                  </div>
                </div>
              );

              if (pillar.onClick) {
                return (
                  <button
                    key={pillar.id}
                    type="button"
                    onClick={pillar.onClick}
                    className="group p-3.5 rounded-2xl border border-transparent hover:border-slate-200 dark:hover:border-slate-800 hover:bg-slate-50/80 dark:hover:bg-slate-800/40 transition-all text-start cursor-pointer focus:outline-none focus:ring-2 focus:ring-brand-500"
                  >
                    {cardContent}
                  </button>
                );
              }

              return (
                <div key={pillar.id} className="group p-3.5 rounded-2xl">
                  {cardContent}
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </section>
  );
};

export default PremiumHero;
