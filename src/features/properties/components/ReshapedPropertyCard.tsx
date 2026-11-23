import React from 'react';
import {
  Building2,
  MapPin,
  BedDouble,
  Bath,
  Maximize,
  Heart,
  ShieldCheck,
  Box,
  Compass,
  Check,
  Plus,
  CreditCard,
  ArrowUpRight,
  Video,
  Clock,
  Sparkles,
  Waves,
} from 'lucide-react';
import { Property } from '../../../types';
import { PROPERTY_TYPES, FINISHING_OPTIONS } from '../../../components/add-listing-page';
import {
  getPricePerSqm,
  hasReal3DTour,
} from '../../../core/use-cases/FilterPropertiesUseCase';

export interface ReshapedPropertyCardProps {
  property: Property;
  variant?: 'grid' | 'list';
  onView3D?: () => void;
  onToggleFavorite?: () => void;
  isFavorited?: boolean;
  onToggleCompare?: () => void;
  isComparing?: boolean;
  onClick?: () => void;
  onOpenProject?: (compoundName: string) => void;
  t: any;
  isRtl: boolean;
}

function localizedOption(
  list: Array<{ value: string; ar: string; en: string }>,
  value: string | undefined,
  isRtl: boolean
): string {
  if (!value) return '';
  const match = list.find((o) => o.value.toLowerCase() === value.toLowerCase());
  return match ? (isRtl ? match.ar : match.en) : value;
}

function formatPriceLabel(property: Property, isRtl: boolean): string {
  const currency = property.currency || 'EGP';
  if (property.price && property.price > 0) {
    return `${property.price.toLocaleString()} ${currency}`;
  }
  if (property.projectPriceFrom && property.projectPriceFrom > 0) {
    const amount = `${property.projectPriceFrom.toLocaleString()} ${currency}`;
    return isRtl ? `يبدأ من ${amount}` : `Project from ${amount}`;
  }
  return isRtl ? 'السعر عند الطلب' : 'Price on request';
}

function periodSuffix(period: Property['pricePeriod'], isRtl: boolean): string {
  switch (period) {
    case 'night':
      return isRtl ? ' / ليلة' : ' / night';
    case 'week':
      return isRtl ? ' / أسبوع' : ' / week';
    case 'month':
      return isRtl ? ' / شهر' : ' / month';
    default:
      return '';
  }
}

function formatPaymentSnippet(property: Property, isRtl: boolean): string | null {
  if (Array.isArray(property.paymentPlans) && property.paymentPlans.length > 0) {
    const best = property.paymentPlans[0];
    const parts: string[] = [];
    if (best.downPayment && best.downPayment > 0) {
      parts.push(isRtl ? `${best.downPayment}% مقدم` : `${best.downPayment}% down`);
    }
    if (best.years && best.years > 0) {
      parts.push(isRtl ? `${best.years} سنوات` : `${best.years} yrs`);
    }
    if (parts.length > 0) return parts.join(' · ');
    if (best.note) return best.note;
  }
  if (
    Array.isArray(property.paymentMethods) &&
    property.paymentMethods.some((m) => /installment|تقسيط/i.test(m))
  ) {
    return isRtl ? 'متاح بالتقسيط' : 'Installments available';
  }
  return null;
}

function getAvailabilityBadge(
  availability: Property['availability'],
  status: Property['status'],
  isRtl: boolean
): { label: string; colorClass: string } | null {
  if (availability === 'Sold') {
    return {
      label: status === 'For Rent' ? (isRtl ? 'مؤجَّر' : 'Rented') : isRtl ? 'مباع' : 'Sold',
      colorClass: 'bg-rose-600/95',
    };
  }
  if (availability === 'Reserved') {
    return {
      label: isRtl ? 'محجوز' : 'Reserved',
      colorClass: 'bg-amber-500/95',
    };
  }
  return null;
}

export const ReshapedPropertyCard: React.FC<ReshapedPropertyCardProps> = ({
  property,
  variant = 'grid',
  onView3D,
  onToggleFavorite,
  isFavorited = false,
  onToggleCompare,
  isComparing = false,
  onClick,
  onOpenProject,
  t,
  isRtl,
}) => {
  const isList = variant === 'list';
  const hasReal3D = hasReal3DTour(property);
  const has360 = Array.isArray(property.panoramas) && property.panoramas.length > 0;
  const hasPhotoRelief = Array.isArray(property.images) && property.images.length > 1;
  const isVerified =
    property.verificationStatus === 'Verified' ||
    (property.verificationStatus === undefined && property.isVerified === true);
  const honestTourLabel = hasReal3D
    ? isRtl
      ? 'ادخل الجولة'
      : 'Walk through it'
    : has360
      ? isRtl
        ? 'جولة 360°'
        : '360° tour'
      : isRtl
        ? 'معاينة صور'
        : 'Photo preview';

  const pricePerSqm =
    property.status !== 'For Rent' ? getPricePerSqm(property) : null;
  const paymentSnippet = formatPaymentSnippet(property, isRtl);
  const availabilityBadge = getAvailabilityBadge(
    property.availability,
    property.status,
    isRtl
  );
  const propertyTypeLabel = localizedOption(PROPERTY_TYPES, property.propertyType, isRtl);
  const finishingLabel = localizedOption(FINISHING_OPTIONS, property.finishing, isRtl);
  const currency = property.currency || 'EGP';

  const schemaAvailability =
    property.availability === 'Sold'
      ? 'https://schema.org/SoldOut'
      : property.availability === 'Reserved'
        ? 'https://schema.org/LimitedAvailability'
        : 'https://schema.org/InStock';

  return (
    <article
      itemScope
      itemType="https://schema.org/RealEstateListing"
      dir={isRtl ? 'rtl' : 'ltr'}
      className={`group relative bg-white dark:bg-slate-900 rounded-3xl border border-slate-200/80 dark:border-slate-800 shadow-sm hover:shadow-2xl hover:shadow-brand-900/10 dark:hover:border-slate-700 transition-all duration-300 overflow-hidden animate-fade-in ${
        isList ? 'flex flex-col md:flex-row' : 'flex flex-col h-full'
      }`}
    >
      {/* Hidden Schema.org structured microdata */}
      <meta itemProp="url" content={`https://hettety.vercel.app/#property/${property.id}`} />
      {property.publishDate && <meta itemProp="datePosted" content={property.publishDate} />}

      {/* Media Section */}
      <div
        onClick={onClick}
        className={`relative overflow-hidden bg-slate-100 dark:bg-slate-800 shrink-0 ${
          onClick ? 'cursor-pointer' : ''
        } ${isList ? 'h-60 md:h-auto md:w-80 lg:w-96' : 'h-60 sm:h-64 w-full'}`}
      >
        {property.imageUrl ? (
          <img
            src={property.imageUrl}
            alt={property.title || (isRtl ? 'صورة العقار' : 'Property image')}
            itemProp="image"
            loading="lazy"
            className="w-full h-full object-cover transition-transform duration-700 ease-out group-hover:scale-105"
          />
        ) : (
          <div className="w-full h-full flex flex-col items-center justify-center gap-2 text-slate-400">
            <Building2 size={42} aria-hidden="true" />
            <span className="text-xs font-bold">
              {isRtl ? 'لا توجد صورة بعد' : 'No photo yet'}
            </span>
          </div>
        )}

        {/* Gradient vignette for crisp badge readability */}
        <div className="absolute inset-0 bg-gradient-to-t from-brand-950/75 via-brand-950/15 to-black/25 pointer-events-none" />

        {/* Taken / Reserved Overlay */}
        {availabilityBadge && (
          <div className="absolute inset-0 bg-brand-950/45 backdrop-blur-[1px] flex items-center justify-center z-20 pointer-events-none">
            <span
              className={`${availabilityBadge.colorClass} text-white text-sm sm:text-base font-black uppercase tracking-widest px-6 py-2 rounded-xl -rotate-6 shadow-2xl border border-white/25`}
            >
              {availabilityBadge.label}
            </span>
          </div>
        )}

        {/* Top-Start Honest Badges */}
        <div className="absolute top-3.5 start-3.5 z-10 flex flex-wrap items-center gap-1.5 max-w-[calc(100%-64px)]">
          <span
            className={`px-3 py-1 rounded-full text-[11px] font-black tracking-wide shadow-sm ${
              property.status === 'For Sale'
                ? 'bg-accent-500 text-white'
                : 'bg-brand-600 text-white'
            }`}
          >
            {property.status === 'For Sale'
              ? t.prop_forsale || (isRtl ? 'للبيع' : 'For Sale')
              : t.prop_forrent || (isRtl ? 'للإيجار' : 'For Rent')}
          </span>

          {isVerified ? (
            <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-emerald-600/95 text-white text-[11px] font-bold shadow-sm backdrop-blur-sm">
              <ShieldCheck size={12} aria-hidden="true" />
              <span>{isRtl ? 'مستندات تمت مراجعتها' : 'Documents reviewed'}</span>
            </span>
          ) : (
            <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-slate-800/90 text-slate-100 border border-white/15 text-[11px] font-bold shadow-sm backdrop-blur-sm">
              <Clock size={12} aria-hidden="true" />
              <span>{isRtl ? 'لم تتم المراجعة' : 'Not reviewed'}</span>
            </span>
          )}

          {hasReal3D && (
            <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-brand-900/90 text-white border border-white/20 text-[11px] font-black shadow-sm backdrop-blur-md">
              <Box size={12} className="text-accent-400" aria-hidden="true" />
              <span>{isRtl ? 'جولة 3D' : '3D Tour'}</span>
            </span>
          )}

          {has360 && (
            <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-slate-900/85 text-white border border-white/20 text-[11px] font-bold shadow-sm backdrop-blur-md">
              <Compass size={12} className="text-cyan-300" aria-hidden="true" />
              <span>360°</span>
            </span>
          )}

          {property.videoUrl && (
            <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-brand-700/90 text-white text-[11px] font-bold shadow-sm">
              <Video size={12} aria-hidden="true" />
              <span>{isRtl ? 'فيديو' : 'Video'}</span>
            </span>
          )}
        </div>

        {/* Top-End Favorite Toggle */}
        {onToggleFavorite && (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onToggleFavorite();
            }}
            aria-label={
              isFavorited
                ? isRtl
                  ? 'إزالة من المفضلة'
                  : 'Remove from favorites'
                : isRtl
                  ? 'إضافة إلى المفضلة'
                  : 'Add to favorites'
            }
            aria-pressed={isFavorited}
            className={`absolute top-3.5 end-3.5 z-20 w-10 h-10 rounded-full backdrop-blur-md transition-all shadow-lg flex items-center justify-center cursor-pointer focus:outline-none focus:ring-2 focus:ring-white ${
              isFavorited
                ? 'bg-rose-500 text-white scale-105'
                : 'bg-brand-950/50 hover:bg-brand-950/75 text-white border border-white/20'
            }`}
          >
            <Heart size={17} fill={isFavorited ? 'currentColor' : 'none'} aria-hidden="true" />
          </button>
        )}

        {/* Bottom Media Overlay: Price/m² pill + Quick 3D / Compare Actions */}
        <div className="absolute bottom-3 inset-x-3.5 z-10 flex items-end justify-between gap-2">
          <div className="flex flex-wrap items-center gap-1.5">
            {pricePerSqm !== null && (
              <span className="px-2.5 py-1 rounded-lg bg-brand-950/80 backdrop-blur-md border border-white/15 text-white text-[11px] font-bold tabular-nums">
                {pricePerSqm.toLocaleString()} {currency} / {isRtl ? 'م²' : 'm²'}
              </span>
            )}
            {property.yallaSahel && (
              <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-cyan-600/90 text-white text-[10px] font-bold">
                <Waves size={11} aria-hidden="true" />
                <span>{isRtl ? 'ساحل حِتّتي' : 'Sahel Hettety'}</span>
              </span>
            )}
          </div>

          <div className="flex items-center gap-1.5 shrink-0">
            {onView3D && (hasReal3D || has360 || hasPhotoRelief) && (
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  onView3D();
                }}
                aria-label={`${honestTourLabel} — ${property.title}`}
                className="px-2.5 py-1.5 rounded-xl bg-white/95 hover:bg-accent-500 text-brand-900 hover:text-white text-[11px] font-black shadow-md transition-colors flex items-center gap-1 cursor-pointer focus:outline-none focus:ring-2 focus:ring-accent-400"
              >
                {hasReal3D ? (
                  <Box size={13} aria-hidden="true" />
                ) : (
                  <Compass size={13} aria-hidden="true" />
                )}
                <span>{honestTourLabel}</span>
              </button>
            )}
            {onToggleCompare && (
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  onToggleCompare();
                }}
                aria-label={
                  isComparing
                    ? isRtl
                      ? 'إزالة من المقارنة'
                      : 'Remove from comparison'
                    : isRtl
                      ? 'إضافة للمقارنة'
                      : 'Add to comparison'
                }
                aria-pressed={isComparing}
                className={`px-2.5 py-1.5 rounded-xl text-[11px] font-bold backdrop-blur-md border transition-all flex items-center gap-1 cursor-pointer focus:outline-none focus:ring-2 focus:ring-white ${
                  isComparing
                    ? 'bg-accent-500 text-white border-accent-400 shadow-md'
                    : 'bg-brand-950/65 hover:bg-white text-white hover:text-brand-900 border-white/25'
                }`}
              >
                {isComparing ? (
                  <Check size={13} aria-hidden="true" />
                ) : (
                  <Plus size={13} aria-hidden="true" />
                )}
                <span>{isRtl ? 'قارن' : 'Compare'}</span>
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Content Section */}
      <div className={`p-5 flex-1 flex flex-col min-w-0 ${isList ? 'justify-between gap-3' : ''}`}>
        {/* Top Metadata Row: Type + Compound + Developer */}
        <div className="flex flex-wrap items-center gap-1.5 mb-2">
          {propertyTypeLabel && (
            <span className="px-2.5 py-0.5 rounded-md bg-brand-50 dark:bg-brand-900/40 text-brand-700 dark:text-brand-300 text-[11px] font-bold">
              {propertyTypeLabel}
            </span>
          )}
          {property.compound &&
            (onOpenProject ? (
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  onOpenProject(property.compound!);
                }}
                className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-md bg-slate-100 dark:bg-slate-800 hover:bg-brand-100 dark:hover:bg-brand-900/40 text-slate-700 dark:text-slate-300 text-[11px] font-bold transition-colors cursor-pointer"
              >
                <Building2 size={11} aria-hidden="true" />
                <span className="truncate max-w-[140px]">{property.compound}</span>
              </button>
            ) : (
              <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-md bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 text-[11px] font-bold">
                <Building2 size={11} aria-hidden="true" />
                <span className="truncate max-w-[140px]">{property.compound}</span>
              </span>
            ))}
          {property.developer && (
            <span className="text-[11px] font-semibold text-slate-500 dark:text-slate-400 truncate max-w-[150px]">
              · {property.developer}
            </span>
          )}
        </div>

        {/* Title (H3 required for semantic outline & test compatibility) + Price */}
        <div className="flex items-start justify-between gap-3 mb-2">
          <h3
            itemProp="name"
            onClick={onClick}
            className={`text-base sm:text-lg font-heading font-extrabold text-slate-900 dark:text-white leading-snug line-clamp-1 min-w-0 flex-1 ${
              onClick ? 'cursor-pointer hover:text-accent-600 dark:hover:text-accent-400 transition-colors' : ''
            }`}
          >
            {property.title}
          </h3>

          <div
            itemProp="offers"
            itemScope
            itemType="https://schema.org/Offer"
            className="text-end shrink-0"
          >
            <meta itemProp="price" content={String(property.price || property.projectPriceFrom || 0)} />
            <meta itemProp="priceCurrency" content={currency} />
            <link itemProp="availability" href={schemaAvailability} />
            <div className="text-base sm:text-lg font-black text-brand-700 dark:text-accent-400 whitespace-nowrap tabular-nums">
              {formatPriceLabel(property, isRtl)}
              {property.price ? (
                <span className="text-[11px] font-semibold text-slate-500 dark:text-slate-400">
                  {periodSuffix(property.pricePeriod, isRtl)}
                </span>
              ) : null}
            </div>
          </div>
        </div>

        {/* Location */}
        <div
          itemProp="address"
          itemScope
          itemType="https://schema.org/PostalAddress"
          className="flex items-center gap-1.5 text-xs sm:text-sm text-slate-600 dark:text-slate-400 mb-3"
        >
          <MapPin size={14} className="text-accent-500 shrink-0" aria-hidden="true" />
          <span itemProp="addressLocality" className="truncate font-medium">
            {property.location}
          </span>
          <meta itemProp="addressCountry" content="EG" />
        </div>

        {/* List-view description preview */}
        {isList && property.description && (
          <p className="text-xs sm:text-sm text-slate-600 dark:text-slate-400 line-clamp-2 leading-relaxed mb-2">
            {property.description}
          </p>
        )}

        {/* Payment Plan + Finishing / Delivery Highlights */}
        <div className="flex flex-wrap items-center gap-2 mb-4">
          {paymentSnippet && (
            <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-accent-50 dark:bg-accent-950/40 border border-accent-200/70 dark:border-accent-800/60 text-accent-700 dark:text-accent-300 text-[11px] font-bold">
              <CreditCard size={12} aria-hidden="true" />
              <span>{paymentSnippet}</span>
            </span>
          )}
          {finishingLabel && (
            <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 text-[11px] font-semibold">
              <Sparkles size={11} aria-hidden="true" />
              <span>{finishingLabel}</span>
            </span>
          )}
          {property.deliveryDate && (
            <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 text-[11px] font-semibold">
              <Clock size={11} aria-hidden="true" />
              <span>{property.deliveryDate}</span>
            </span>
          )}
        </div>

        {/* Bottom Specs Strip + View Details Action */}
        <div className="mt-auto pt-3.5 border-t border-slate-100 dark:border-slate-800 flex items-center justify-between gap-3">
          <div className="flex items-center gap-4 text-slate-700 dark:text-slate-300">
            <div className="flex items-center gap-1.5" title={t.prop_beds || 'Beds'}>
              <BedDouble size={16} className="text-brand-600 dark:text-brand-400" aria-hidden="true" />
              <span className="text-xs font-bold tabular-nums">
                {`${property.bedrooms} ${t.prop_beds || (isRtl ? 'غرف' : 'Beds')}`}
              </span>
            </div>
            <div className="flex items-center gap-1.5" title={t.prop_baths || 'Baths'}>
              <Bath size={16} className="text-brand-600 dark:text-brand-400" aria-hidden="true" />
              <span className="text-xs font-bold tabular-nums">
                {`${property.bathrooms} ${t.prop_baths || (isRtl ? 'حمام' : 'Baths')}`}
              </span>
            </div>
            <div
              itemProp="floorSize"
              itemScope
              itemType="https://schema.org/QuantitativeValue"
              className="flex items-center gap-1.5"
            >
              <Maximize size={15} className="text-brand-600 dark:text-brand-400" aria-hidden="true" />
              <meta itemProp="unitCode" content="MTK" />
              <span itemProp="value" className="text-xs font-bold tabular-nums">
                {property.area}
                {property.areaTo ? `–${property.areaTo}` : ''} m²
              </span>
            </div>
          </div>

          {onClick && (
            <button
              type="button"
              onClick={onClick}
              className="inline-flex items-center gap-1 px-3.5 py-2 rounded-xl bg-brand-600 hover:bg-brand-700 text-white text-xs font-bold shadow-xs transition-all cursor-pointer shrink-0 focus:outline-none focus:ring-2 focus:ring-brand-500"
            >
              <span>{isRtl ? 'التفاصيل' : 'Details'}</span>
              <ArrowUpRight size={14} className={isRtl ? '-scale-x-100' : ''} aria-hidden="true" />
            </button>
          )}
        </div>
      </div>
    </article>
  );
};

export default ReshapedPropertyCard;
