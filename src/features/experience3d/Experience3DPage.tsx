import React, { useMemo, useState } from 'react';
import {
  ArrowLeft,
  ArrowRight,
  Bath,
  BedDouble,
  Box,
  Compass,
  Images,
  Layers,
  MapPin,
  Maximize,
  PlayCircle,
  RotateCcw,
  Ruler,
  Scan,
  Sparkles,
} from 'lucide-react';
import { Property } from '../../types';
import {
  priceLabel,
  pricePeriodSuffix,
  tourKind,
  tourLabel,
} from '../../shared/utils/propertyFormatters';
import { BrandButton } from '../../shared/ui/BrandButton';
import { PropertyImage } from '../../shared/ui/PropertyImage';

export interface Experience3DPageProps {
  properties: Property[];
  loading?: boolean;
  onView3D: (id: string) => void;
  onBrowse: () => void;
  isRtl: boolean;
  limit?: number;
  onViewAll?: () => void;
}

type TourFilterKey = 'all' | 'walkthrough' | 'pano' | 'gallery';

export const Experience3DPage: React.FC<Experience3DPageProps> = ({
  properties,
  loading = false,
  onView3D,
  onBrowse,
  isRtl,
  limit,
  onViewAll,
}) => {
  const [activeFilter, setActiveFilter] = useState<TourFilterKey>('all');
  const isFullPage = !limit;

  const ready = useMemo(
    () =>
      properties.filter(
        (p) =>
          (p.images?.filter(Boolean).length ?? 0) > 0 ||
          !!p.imageUrl ||
          tourKind(p) !== 'single'
      ),
    [properties]
  );

  const counts = useMemo(() => {
    let walkthrough = 0;
    let pano = 0;
    let gallery = 0;
    for (const p of ready) {
      const kind = tourKind(p);
      if (kind === 'walkthrough') walkthrough += 1;
      else if (kind === 'pano') pano += 1;
      else gallery += 1;
    }
    return {
      all: ready.length,
      walkthrough,
      pano,
      gallery,
    };
  }, [ready]);

  const filtered = useMemo(() => {
    if (!isFullPage || activeFilter === 'all') return ready;
    return ready.filter((p) => {
      const kind = tourKind(p);
      if (activeFilter === 'walkthrough') return kind === 'walkthrough';
      if (activeFilter === 'pano') return kind === 'pano';
      return kind === 'gallery' || kind === 'single';
    });
  }, [ready, isFullPage, activeFilter]);

  const shown = limit ? filtered.slice(0, limit) : filtered;

  const filterPills: Array<{
    key: TourFilterKey;
    label: string;
    count: number;
    icon: React.ReactNode;
  }> = [
    {
      key: 'all',
      label: isRtl ? 'الكل' : 'All',
      count: counts.all,
      icon: <Layers size={15} aria-hidden="true" />,
    },
    {
      key: 'walkthrough',
      label: isRtl ? 'جولة ثلاثية الأبعاد' : '3D Walkthrough',
      count: counts.walkthrough,
      icon: <Box size={15} aria-hidden="true" />,
    },
    {
      key: 'pano',
      label: isRtl ? 'بانوراما 360°' : '360° Panorama',
      count: counts.pano,
      icon: <Compass size={15} aria-hidden="true" />,
    },
    {
      key: 'gallery',
      label: isRtl ? 'معرض صور مكاني' : 'Spatial Photo Gallery',
      count: counts.gallery,
      icon: <Images size={15} aria-hidden="true" />,
    },
  ];

  const capabilities = [
    {
      icon: <Scan size={18} aria-hidden="true" />,
      title: isRtl ? 'تجسيم ثلاثي الأبعاد (.spz)' : '3D Gaussian Splatting (.spz)',
      desc: isRtl
        ? 'مشاهد واقعية متدرجة الدقة للتجول السلس داخل الوحدات الممسوحة'
        : 'Photorealistic progressive scenes for smooth walkthroughs of scanned units',
    },
    {
      icon: <Compass size={18} aria-hidden="true" />,
      title: isRtl ? 'بانوراما 360°' : '360° Panoramas',
      desc: isRtl
        ? 'استكشاف كروي كامل للغرف والاتجاهات من أكثر من نقطة رؤية'
        : 'Full spherical inspection across connected viewpoints and rooms',
    },
    {
      icon: <Ruler size={18} aria-hidden="true" />,
      title: isRtl ? 'مخططات وقياسات مكانية' : 'Floor Plan & Spatial Measurement',
      desc: isRtl
        ? 'معاينة المخطط المعماري وقياس الأبعاد بين الجدران والأثاث'
        : 'Inspect schematic floor plans and measure distances wall to wall',
    },
    {
      icon: <Sparkles size={18} aria-hidden="true" />,
      title: isRtl ? 'مرشد مكاني بالذكاء الاصطناعي' : 'AI Spatial Guide',
      desc: isRtl
        ? 'مساعد تفاعلي يشرح تفاصيل الغرف والمواصفات أثناء جولتك'
        : 'Contextual room guidance and unit specifications while you explore',
    },
  ];

  const HeadingTag = isFullPage ? 'h1' : 'h2';

  return (
    <section
      dir={isRtl ? 'rtl' : 'ltr'}
      aria-labelledby="experience-3d-heading"
      className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-14 sm:py-16 animate-fade-in transition-colors duration-500"
    >
      {/* Editorial Header */}
      <div className="text-center mb-10 sm:mb-12 max-w-3xl mx-auto">
        <div className="inline-flex items-center gap-2 bg-brand-100/90 dark:bg-brand-900/60 border border-brand-200/70 dark:border-brand-800 text-brand-700 dark:text-brand-300 px-4 py-1.5 rounded-full text-xs font-extrabold uppercase tracking-widest mb-4">
          <Box size={14} className="text-accent-500" aria-hidden="true" />
          <span>{isRtl ? 'تجربة ثلاثية الأبعاد' : '3D Spatial Showcase'}</span>
        </div>

        <HeadingTag
          id="experience-3d-heading"
          className="text-3xl sm:text-4xl md:text-5xl font-heading font-black text-slate-900 dark:text-white mb-5 leading-tight"
        >
          {isRtl
            ? 'تجوّل داخل العقار قبل ما تزوره'
            : 'Walk through the property before you visit'}
        </HeadingTag>

        <p className="text-base sm:text-lg text-slate-600 dark:text-slate-400 leading-relaxed">
          {isRtl
            ? 'اختر أي وحدة وادخل صالة عرض تفاعلية مبنية من مسحها ثلاثي الأبعاد أو صورها البانورامية الحقيقية — لف، قرّب، واتنقل بين الغرف من مكانك.'
            : 'Select any unit and step into an interactive spatial showcase built from its real 3D scan, 360° panoramas, or photo gallery — orbit, zoom, and move across rooms from anywhere.'}
        </p>
      </div>

      {/* Full-Page Spatial Capabilities Ribbon + Interactive Filter Bar */}
      {isFullPage && (
        <div className="space-y-8 mb-12">
          {/* Spatial Capabilities Ribbon */}
          <div className="relative overflow-hidden rounded-3xl bg-gradient-to-br from-brand-950 via-brand-900 to-brand-800 border border-brand-800/80 shadow-2xl p-6 sm:p-7">
            <div
              className="pointer-events-none absolute inset-0 opacity-15"
              style={{
                backgroundImage:
                  'linear-gradient(rgba(255,255,255,0.12) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.12) 1px, transparent 1px)',
                backgroundSize: '32px 32px',
              }}
            />
            <div className="pointer-events-none absolute -top-20 -end-16 w-72 h-72 rounded-full bg-accent-500/20 blur-3xl" />

            <div className="relative z-10 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 sm:gap-5">
              {capabilities.map((cap, idx) => (
                <div
                  key={idx}
                  className="flex items-start gap-3.5 rounded-2xl bg-white/[0.06] backdrop-blur-md border border-white/10 p-4 text-start hover:bg-white/[0.1] transition-colors"
                >
                  <div className="w-10 h-10 rounded-xl bg-accent-500/20 border border-accent-400/30 text-accent-400 flex items-center justify-center shrink-0">
                    {cap.icon}
                  </div>
                  <div className="min-w-0">
                    <h2 className="text-sm font-extrabold text-white leading-snug mb-1">
                      {cap.title}
                    </h2>
                    <p className="text-xs text-brand-200/85 leading-relaxed">
                      {cap.desc}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Tour Type Filter Pills */}
          {!loading && ready.length > 0 && (
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
              <div
                role="group"
                aria-label={isRtl ? 'تصفية حسب نوع الجولة' : 'Filter by tour type'}
                className="flex items-center gap-2 flex-wrap"
              >
                {filterPills.map((pill) => {
                  const isActive = activeFilter === pill.key;
                  return (
                    <button
                      key={pill.key}
                      type="button"
                      onClick={() => setActiveFilter(pill.key)}
                      aria-pressed={isActive}
                      className={`inline-flex items-center gap-2 px-4 py-2.5 rounded-full text-xs sm:text-sm font-bold transition-all cursor-pointer focus:outline-none focus:ring-2 focus:ring-brand-500 focus:ring-offset-2 dark:focus:ring-offset-slate-950 ${
                        isActive
                          ? 'bg-brand-600 dark:bg-accent-500 text-white shadow-lg shadow-brand-600/25 dark:shadow-accent-500/25 border border-brand-500 dark:border-accent-500'
                          : 'bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-300 border border-slate-200 dark:border-slate-800 hover:border-brand-300 dark:hover:border-brand-700 hover:text-brand-700 dark:hover:text-white'
                      }`}
                    >
                      <span
                        className={
                          isActive
                            ? 'text-accent-400 dark:text-white'
                            : 'text-slate-400 dark:text-slate-500'
                        }
                      >
                        {pill.icon}
                      </span>
                      <span>{pill.label}</span>
                      <span
                        className={`px-2 py-0.5 rounded-full text-[11px] font-extrabold tabular-nums ${
                          isActive
                            ? 'bg-white/20 text-white'
                            : 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400'
                        }`}
                      >
                        {pill.count}
                      </span>
                    </button>
                  );
                })}
              </div>

              <div className="text-xs sm:text-sm font-semibold text-slate-500 dark:text-slate-400 tabular-nums">
                {isRtl
                  ? `عرض ${filtered.length} من ${ready.length} وحدة`
                  : `Showing ${filtered.length} of ${ready.length} ${ready.length === 1 ? 'unit' : 'units'}`}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Gallery States: Loading -> Truly Empty -> Filtered Empty -> Showcase Grid */}
      {loading ? (
        <div
          aria-busy="true"
          aria-label={isRtl ? 'جاري تحميل الجولات ثلاثية الأبعاد' : 'Loading 3D tours'}
          className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-7 sm:gap-8"
        >
          {[1, 2, 3].map((i) => (
            <div
              key={i}
              className="relative h-96 rounded-3xl overflow-hidden bg-slate-200 dark:bg-slate-900 border border-slate-200/80 dark:border-slate-800 animate-pulse"
            >
              <div className="absolute top-4 start-4 flex gap-2">
                <div className="h-7 w-28 rounded-full bg-slate-300 dark:bg-slate-800" />
                <div className="h-7 w-16 rounded-full bg-slate-300 dark:bg-slate-800" />
              </div>
              <div className="absolute bottom-5 inset-x-5 space-y-3">
                <div className="h-5 w-3/4 rounded-lg bg-slate-300 dark:bg-slate-800" />
                <div className="h-4 w-1/2 rounded-lg bg-slate-300 dark:bg-slate-800" />
                <div className="flex justify-between items-center pt-2">
                  <div className="h-5 w-28 rounded-lg bg-slate-300 dark:bg-slate-800" />
                  <div className="h-9 w-28 rounded-full bg-slate-300 dark:bg-slate-800" />
                </div>
              </div>
            </div>
          ))}
        </div>
      ) : ready.length === 0 ? (
        <div className="relative w-full bg-gradient-to-br from-brand-950 via-brand-900 to-slate-950 rounded-3xl overflow-hidden shadow-2xl border border-brand-800/80 py-20 sm:py-24 px-6 text-center">
          <div
            className="pointer-events-none absolute inset-0 opacity-15"
            style={{
              backgroundImage:
                'linear-gradient(rgba(255,255,255,0.12) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.12) 1px, transparent 1px)',
              backgroundSize: '40px 40px',
            }}
          />
          <div className="pointer-events-none absolute top-1/2 start-1/2 -translate-x-1/2 -translate-y-1/2 w-80 h-80 rounded-full bg-accent-500/15 blur-3xl" />

          <div className="relative z-10 flex flex-col items-center text-white max-w-lg mx-auto">
            <div className="w-20 h-20 rounded-3xl bg-white/[0.06] border border-white/15 backdrop-blur-md flex items-center justify-center mb-6 shadow-xl">
              <Box className="w-10 h-10 text-accent-400" strokeWidth={1.6} aria-hidden="true" />
            </div>
            <h3 className="text-xl sm:text-2xl font-heading font-extrabold mb-3">
              {isRtl
                ? 'لا توجد وحدات جاهزة للعرض ثلاثي الأبعاد بعد'
                : 'No 3D-ready units yet'}
            </h3>
            <p className="text-sm sm:text-base text-brand-200/85 leading-relaxed mb-8">
              {isRtl
                ? 'بمجرد نشر وحدات تحتوي على مسح ثلاثي الأبعاد أو صور بانوراما 360° أو معرض صور، ستظهر هنا تلقائياً للاستكشاف الفوري.'
                : 'As soon as listings with 3D scans, 360° panoramas, or real photo galleries are published, they will appear here automatically.'}
            </p>
            <BrandButton onClick={onBrowse} variant="accent" className="px-8 py-3.5">
              <span>{isRtl ? 'تصفح العقارات' : 'Browse Listings'}</span>
              {isRtl ? (
                <ArrowLeft size={16} aria-hidden="true" />
              ) : (
                <ArrowRight size={16} aria-hidden="true" />
              )}
            </BrandButton>
          </div>
        </div>
      ) : shown.length === 0 ? (
        <div className="rounded-3xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 py-16 px-6 text-center shadow-sm">
          <div className="w-16 h-16 rounded-2xl bg-brand-50 dark:bg-brand-900/40 text-brand-600 dark:text-brand-300 flex items-center justify-center mx-auto mb-5">
            <Compass size={28} aria-hidden="true" />
          </div>
          <h3 className="text-lg sm:text-xl font-heading font-extrabold text-slate-900 dark:text-white mb-2">
            {isRtl
              ? 'لا توجد جولات مطابقة لهذا النوع حالياً'
              : 'No tours match this category yet'}
          </h3>
          <p className="text-sm text-slate-500 dark:text-slate-400 max-w-md mx-auto mb-6">
            {isRtl
              ? 'جرّب عرض كل الجولات المتاحة لمشاهدة الوحدات الأخرى المزوّدة بمعاينة تفاعلية.'
              : 'Switch back to all tours to explore every unit available for interactive preview.'}
          </p>
          <BrandButton
            onClick={() => setActiveFilter('all')}
            variant="outline"
            className="px-6 py-2.5 text-sm"
          >
            <RotateCcw size={15} aria-hidden="true" />
            <span>{isRtl ? 'عرض كل الجولات' : 'Show all tours'}</span>
          </BrandButton>
        </div>
      ) : (
        <>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-7 sm:gap-8">
            {shown.map((p) => {
              const kind = tourKind(p);
              const badgeText = tourLabel(kind, isRtl);
              const cover = (p.images && p.images.find(Boolean)) || p.imageUrl;
              const photoCount = Math.max(
                p.images?.filter(Boolean).length ?? 0,
                cover ? 1 : 0
              );
              const panoCount = p.panoramas?.filter(Boolean).length ?? 0;

              const badgeStyle =
                kind === 'walkthrough'
                  ? 'bg-accent-500/95 text-white border-accent-300/40 shadow-accent-500/30'
                  : kind === 'pano'
                    ? 'bg-brand-600/95 text-white border-cyan-300/35 shadow-brand-950/40'
                    : 'bg-slate-900/85 text-white border-white/20 shadow-black/30';

              const badgeIcon =
                kind === 'walkthrough' ? (
                  <Box size={13} aria-hidden="true" />
                ) : kind === 'pano' ? (
                  <Compass size={13} className="text-cyan-300" aria-hidden="true" />
                ) : (
                  <Images size={13} className="text-brand-200" aria-hidden="true" />
                );

              const formattedPrice = `${priceLabel(p, isRtl)}${
                p.price ? pricePeriodSuffix(p.pricePeriod, isRtl) : ''
              }`;

              return (
                <article
                  key={p.id}
                  onClick={() => onView3D(p.id)}
                  className="group relative h-[25rem] rounded-3xl overflow-hidden bg-brand-950 border border-slate-200/80 dark:border-slate-800 shadow-lg hover:shadow-2xl hover:shadow-brand-950/30 cursor-pointer transition-all duration-500 hover:-translate-y-1.5"
                >
                  <PropertyImage
                    src={cover}
                    alt={p.title}
                    iconSize={56}
                    className="w-full h-full object-cover opacity-90 group-hover:opacity-100 group-hover:scale-105 transition-all duration-700 ease-out"
                  />

                  {/* Deep architectural vignette for high-contrast dark-glass text */}
                  <div className="pointer-events-none absolute inset-0 bg-gradient-to-t from-brand-950 via-brand-950/55 to-black/25" />

                  {/* Top Glass Badges */}
                  <div className="absolute top-4 start-4 end-4 z-10 flex items-center justify-between gap-2">
                    <span
                      className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-[11px] font-black backdrop-blur-md border shadow-lg ${badgeStyle}`}
                    >
                      {badgeIcon}
                      <span>{badgeText}</span>
                    </span>

                    <div className="flex items-center gap-1.5">
                      {panoCount > 0 && (
                        <span className="bg-brand-950/75 backdrop-blur-md border border-cyan-400/30 text-cyan-200 text-[11px] font-bold px-2.5 py-1 rounded-full tabular-nums">
                          {panoCount} × 360°
                        </span>
                      )}
                      <span className="bg-black/55 backdrop-blur-md border border-white/15 text-white text-[11px] font-bold px-2.5 py-1 rounded-full tabular-nums">
                        {photoCount}{' '}
                        {isRtl ? 'صورة' : photoCount === 1 ? 'photo' : 'photos'}
                      </span>
                    </div>
                  </div>

                  {/* Bottom Dark-Glass Info Panel */}
                  <div className="absolute bottom-3.5 inset-x-3.5 z-10 rounded-2xl bg-brand-950/75 backdrop-blur-xl border border-white/15 p-4 text-white text-start shadow-2xl">
                    <h3 className="text-lg font-heading font-extrabold mb-1 line-clamp-1 group-hover:text-accent-300 transition-colors">
                      {p.title}
                    </h3>

                    <p className="text-xs sm:text-sm text-slate-300 flex items-center gap-1.5 mb-3">
                      <MapPin
                        size={13}
                        className="text-accent-400 shrink-0"
                        aria-hidden="true"
                      />
                      <span className="line-clamp-1">{p.location}</span>
                    </p>

                    {/* Compact spatial specs row */}
                    {(p.area > 0 || p.bedrooms > 0 || p.bathrooms > 0) && (
                      <div className="flex items-center gap-3.5 text-[11px] font-semibold text-brand-200/90 mb-3.5 pb-3 border-b border-white/10">
                        {p.bedrooms > 0 && (
                          <span className="inline-flex items-center gap-1 tabular-nums">
                            <BedDouble size={13} aria-hidden="true" />
                            {p.bedrooms}
                          </span>
                        )}
                        {p.bathrooms > 0 && (
                          <span className="inline-flex items-center gap-1 tabular-nums">
                            <Bath size={13} aria-hidden="true" />
                            {p.bathrooms}
                          </span>
                        )}
                        {p.area > 0 && (
                          <span className="inline-flex items-center gap-1 tabular-nums">
                            <Maximize size={12} aria-hidden="true" />
                            {p.area} {isRtl ? 'م²' : 'm²'}
                          </span>
                        )}
                      </div>
                    )}

                    <div className="flex items-center justify-between gap-2.5">
                      <span className="font-black text-sm sm:text-base text-accent-400 truncate tabular-nums">
                        {formattedPrice}
                      </span>

                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          onView3D(p.id);
                        }}
                        aria-label={`${badgeText} — ${p.title}`}
                        className="inline-flex items-center gap-1.5 shrink-0 bg-white text-brand-900 group-hover:bg-accent-500 group-hover:text-white group-hover:shadow-lg group-hover:shadow-accent-500/40 text-xs font-black px-4 py-2 rounded-full transition-all duration-300 cursor-pointer focus:outline-none focus:ring-2 focus:ring-accent-400 focus:ring-offset-2 focus:ring-offset-brand-950"
                      >
                        <PlayCircle size={14} aria-hidden="true" />
                        <span>{isRtl ? 'ادخل الجولة' : 'Enter Tour'}</span>
                      </button>
                    </div>
                  </div>
                </article>
              );
            })}
          </div>

          {limit && onViewAll && ready.length > limit && (
            <div className="text-center mt-10">
              <BrandButton onClick={onViewAll} variant="outline" className="px-7">
                <span>
                  {isRtl
                    ? `عرض كل الجولات (${ready.length})`
                    : `View all tours (${ready.length})`}
                </span>
                {isRtl ? (
                  <ArrowLeft size={16} aria-hidden="true" />
                ) : (
                  <ArrowRight size={16} aria-hidden="true" />
                )}
              </BrandButton>
            </div>
          )}
        </>
      )}
    </section>
  );
};

export default Experience3DPage;
