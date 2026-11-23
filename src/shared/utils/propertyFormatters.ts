/**
 * HETTETY — Shared Property, Tour, Document & Localization Formatters
 * Single-Responsibility pure domain utilities shared across all pages & components.
 */

import { Property, UserDocument } from '../../types';
import {
  PAYMENT_OPTIONS,
  PROPERTY_TYPES,
  FINISHING_OPTIONS,
  AMENITIES,
} from '../../components/add-listing-page';

/** Exports an array of objects to a downloaded CSV file. */
export const downloadCsv = (filename: string, rows: Record<string, any>[]) => {
  if (!rows.length) return;
  const headerSet = new Set<string>();
  rows.forEach((r) => Object.keys(r).forEach((k) => headerSet.add(k)));
  const headers: string[] = Array.from(headerSet);
  const esc = (v: any) => {
    const s = v == null ? '' : typeof v === 'object' ? JSON.stringify(v) : String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const csv = [headers.join(','), ...rows.map((r) => headers.map((h) => esc(r[h])).join(','))].join('\n');
  const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
};

/**
 * Returns the URL only if it's a safe https Matterport/Polycam/Kuula tour link, else null.
 * Prevents a malicious lister storing a javascript:/data: URL that would execute in the iframe.
 */
export const safeTourUrl = (raw: string | undefined): string | null => {
  if (!raw) return null;
  try {
    const u = new URL(raw.trim());
    const host = u.hostname.replace(/^www\./, '');
    const ok =
      u.protocol === 'https:' &&
      (host === 'matterport.com' ||
        host.endsWith('.matterport.com') ||
        host === 'poly.cam' ||
        host.endsWith('.poly.cam') ||
        host === 'kuula.co' ||
        host.endsWith('.kuula.co'));
    return ok ? u.href : null;
  } catch {
    return null;
  }
};

/**
 * What stands where a price would go.
 * Where the developer has published what the project starts at, show that as the
 * project's floor — never as this unit's price.
 */
export const priceLabel = (p: Property, isRtl: boolean) => {
  if (p.price) return `${p.price.toLocaleString()} ${p.currency || 'EGP'}`;
  if (p.projectPriceFrom) {
    const amount = `${p.projectPriceFrom.toLocaleString()} ${p.currency || 'EGP'}`;
    return isRtl ? `المشروع يبدأ من ${amount}` : `Project from ${amount}`;
  }
  return isRtl ? 'السعر عند الطلب' : 'Price on request';
};

/**
 * Keeps project-starting figures honest: whose number it is, when they published it,
 * and that it is not this unit's price.
 */
export const priceProvenance = (p: Property, isRtl: boolean): string | null => {
  if (p.price || !p.projectPriceFrom || !p.priceSource) return null;
  const when = p.priceAsOf ? ` — ${p.priceAsOf}` : '';
  return isRtl
    ? `أقل سعر معلن في المشروع، مش سعر الوحدة دي. المصدر: ${p.priceSource}${when}`
    : `Lowest advertised price in the project, not this unit's. Source: ${p.priceSource}${when}`;
};

export const pricePeriodSuffix = (period: string | undefined, isRtl: boolean) => {
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
};

/** Price per square meter helper when both price and area are positive. */
export const pricePerSqm = (p: Property): number | null => {
  if (!p.price || p.price <= 0 || !p.area || p.area <= 0) return null;
  return Math.round(p.price / p.area);
};

export const optionLabel = (
  options: { value: string; ar: string; en: string }[],
  value: string | undefined,
  isRtl: boolean
) => {
  if (!value) return '';
  const hit = options.find((o) => o.value === value);
  return hit ? (isRtl ? hit.ar : hit.en) : value;
};

export const typeLabel = (v: string | undefined, isRtl: boolean) =>
  optionLabel(PROPERTY_TYPES, v, isRtl);

export const finishingLabel = (v: string | undefined, isRtl: boolean) =>
  optionLabel(FINISHING_OPTIONS, v, isRtl);

export const amenityLabel = (v: string, isRtl: boolean) =>
  optionLabel(AMENITIES, v, isRtl);

export const paymentLabel = (value: string, isRtl: boolean) => {
  const opt = PAYMENT_OPTIONS.find((o) => o.value === value);
  return opt ? (isRtl ? opt.ar : opt.en) : value;
};

export const availabilityInfo = (
  availability: Property['availability'],
  status: Property['status'],
  isRtl: boolean
) => {
  switch (availability) {
    case 'Sold':
      return {
        label: status === 'For Rent' ? (isRtl ? 'مؤجَّر' : 'Rented') : isRtl ? 'مباع' : 'Sold',
        color: 'bg-red-500',
        taken: true,
      };
    case 'Reserved':
      return {
        label: isRtl ? 'محجوز' : 'Reserved',
        color: 'bg-amber-500',
        taken: true,
      };
    default:
      return {
        label: isRtl ? 'متاح' : 'Available',
        color: 'bg-emerald-600',
        taken: false,
      };
  }
};

/**
 * Classifies what a listing can actually show a buyer, in descending order of spatial fidelity.
 *  walkthrough — 3DGS/mesh asset or safe Matterport/Polycam/Kuula scan
 *  pano        — equirectangular 360° panoramas
 *  gallery     — multiple flat photos shown as spatial relief
 *  single      — single photo; nothing to tour
 */
export const tourKind = (p: Property): 'walkthrough' | 'pano' | 'gallery' | 'single' => {
  if (p.threeDTour?.assetUrl || (p.digitalTwinUrl && safeTourUrl(p.digitalTwinUrl))) return 'walkthrough';
  if ((p.panoramas || []).length > 0) return 'pano';
  const shots = (p.images || []).filter(Boolean);
  return shots.length > 1 ? 'gallery' : 'single';
};

export const tourLabel = (kind: ReturnType<typeof tourKind>, isRtl: boolean) => {
  switch (kind) {
    case 'walkthrough':
      return isRtl ? 'جولة داخل الوحدة' : 'Walk through it';
    case 'pano':
      return isRtl ? 'جولة 360°' : '360° tour';
    default:
      return isRtl ? 'معاينة الصور' : 'Photo preview';
  }
};

/** Extracts legacy Firebase Storage path from download URL if present (used during cleanup). */
export const storagePathFromUrl = (url?: string): string | null => {
  if (!url || !url.startsWith('https://firebasestorage.googleapis.com/')) return null;
  const m = url.match(/\/o\/([^?]+)/);
  if (!m) return null;
  try {
    return decodeURIComponent(m[1]);
  } catch {
    return null;
  }
};

/** Honest review state presentation for a listing. */
export const listingReviewInfo = (p: Property, t: any) => {
  if (p.verificationStatus === 'Verified') {
    return {
      label: t.listing_review_done,
      note: t.listing_review_note,
      chip: 'bg-emerald-600 text-white',
    };
  }
  if (p.verificationStatus === 'Rejected') {
    return {
      label: t.listing_review_rejected,
      note: p.reviewNote || '',
      chip: 'bg-red-500 text-white',
    };
  }
  return {
    label: t.listing_review_pending,
    note: '',
    chip: 'bg-slate-600/90 text-white',
  };
};

/** Honest review state presentation for a user legal document. */
export const docReviewInfo = (doc: UserDocument, t: any) => {
  switch (doc.reviewStatus) {
    case 'InReview':
      return {
        label: t.doc_status_inreview,
        desc: t.doc_status_inreview_desc,
        chip: 'bg-amber-50 dark:bg-amber-900/20 text-amber-700 dark:text-amber-400 border-amber-200 dark:border-amber-800',
        icon: 'bg-amber-100 dark:bg-amber-900/30 text-amber-600 dark:text-amber-400',
      };
    case 'Checked':
      return {
        label: t.doc_status_checked,
        desc: t.doc_status_checked_desc,
        chip: 'bg-emerald-50 dark:bg-emerald-900/20 text-emerald-700 dark:text-emerald-400 border-emerald-200 dark:border-emerald-800',
        icon: 'bg-emerald-100 dark:bg-emerald-900/30 text-emerald-600 dark:text-emerald-400',
      };
    case 'NeedsAttention':
      return {
        label: t.doc_status_attention,
        desc: t.doc_status_attention_desc,
        chip: 'bg-red-50 dark:bg-red-900/20 text-red-700 dark:text-red-400 border-red-200 dark:border-red-800',
        icon: 'bg-red-100 dark:bg-red-900/30 text-red-600 dark:text-red-400',
      };
    default:
      return {
        label: t.doc_status_uploaded,
        desc: t.doc_status_uploaded_desc,
        chip: 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 border-slate-200 dark:border-slate-700',
        icon: 'bg-slate-100 dark:bg-slate-800 text-slate-500 dark:text-slate-400',
      };
  }
};

/** Unit types grouped into the categories a buyer actually shops by. */
export const UNIT_CATEGORIES: { key: string; ar: string; en: string; types: string[] }[] = [
  { key: 'apartments', ar: 'شقق', en: 'Apartments', types: ['Apartment', 'Duplex', 'Penthouse', 'Studio'] },
  { key: 'villas', ar: 'فلل', en: 'Villas', types: ['Villa', 'Townhouse'] },
  { key: 'chalets', ar: 'شاليهات', en: 'Chalets', types: ['Chalet'] },
  { key: 'commercial', ar: 'تجاري وإداري', en: 'Commercial', types: ['Office', 'Retail'] },
  { key: 'land', ar: 'أراضي', en: 'Land', types: ['Land'] },
];
