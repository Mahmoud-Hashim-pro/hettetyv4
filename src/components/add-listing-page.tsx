import React, { useState } from 'react';
import {
  CheckCircle, Loader2, PlusCircle, Upload, PlayCircle, Shield, ArrowRight, ArrowLeft, Wand2, FileText, Image as ImageIcon, X, Box, Globe
} from 'lucide-react';
import imageCompression from 'browser-image-compression';
import { generateContentResilient, aiErrorMessage } from '../ai';
import { storage, ref, uploadBytes, getDownloadURL, deleteObject, auth } from '../firebase';
import { Property } from '../types';

/**
 * Fields whose change invalidates a previous review. Mirrors materialListingKeys()
 * in firestore.rules — if these two drift apart, owner edits start failing with a
 * bare permission-denied. Keep them in step.
 */
export const MATERIAL_LISTING_FIELDS = [
  'title', 'price', 'currency', 'location', 'area', 'areaTo', 'status',
  'propertyType', 'compound', 'developer', 'contactPhone', 'legalDocs',
  'registrationNumber', 'courtSignatureValidity', 'isResale',
  'gardenArea', 'roofArea', 'maintenanceFee',
] as const;

/**
 * Collapses the several ways this form represents "empty" (undefined, '', 0,
 * false, []) so an untouched optional field never looks like an edit.
 */
/** What the edit form shows for a field the stored listing never had. */
const FIELD_DEFAULTS: Record<string, unknown> = {
  currency: 'EGP',
  propertyType: 'Apartment',
  pricePeriod: 'total',
  status: 'For Sale',
  availability: 'Available',
  bedrooms: 1,
  bathrooms: 1,
};

export const normalizeField = (v: unknown): string => {
  if (v === undefined || v === null || v === '' || v === false || v === 0) return '';
  if (Array.isArray(v)) return v.length ? JSON.stringify(v) : '';
  if (typeof v === 'object') return JSON.stringify(v);
  return String(v);
};

// Canonical payment-method values (stored in English) with bilingual labels.
export const PAYMENT_OPTIONS = [
  { value: 'Cash', ar: 'كاش', en: 'Cash' },
  { value: 'Installments', ar: 'تقسيط', en: 'Installments' },
  { value: 'Bank Transfer', ar: 'تحويل بنكي', en: 'Bank Transfer' },
  { value: 'Mortgage', ar: 'تمويل عقاري', en: 'Mortgage' },
];

export const PROPERTY_TYPES = [
  { value: 'Apartment', ar: 'شقة', en: 'Apartment' },
  { value: 'Villa', ar: 'فيلا', en: 'Villa' },
  { value: 'Duplex', ar: 'دوبلكس', en: 'Duplex' },
  { value: 'Penthouse', ar: 'بنتهاوس', en: 'Penthouse' },
  { value: 'Studio', ar: 'استوديو', en: 'Studio' },
  { value: 'Townhouse', ar: 'تاون هاوس', en: 'Townhouse' },
  { value: 'Chalet', ar: 'شاليه', en: 'Chalet' },
  { value: 'Office', ar: 'مكتب إداري', en: 'Office' },
  { value: 'Retail', ar: 'محل تجاري', en: 'Retail' },
  { value: 'Land', ar: 'أرض', en: 'Land' },
];

export const AMENITIES = [
  { value: 'Clubhouse', ar: 'كلوب هاوس', en: 'Clubhouse' },
  { value: 'Swimming Pools', ar: 'حمامات سباحة', en: 'Swimming Pools' },
  { value: 'Gym', ar: 'جيم', en: 'Gym' },
  { value: 'Lagoons', ar: 'لاجونز', en: 'Lagoons' },
  { value: 'Landscape', ar: 'لاندسكيب', en: 'Landscape' },
  { value: 'Security', ar: 'أمن 24 ساعة', en: '24/7 Security' },
  { value: 'Underground Garage', ar: 'جراج تحت الأرض', en: 'Underground Garage' },
  { value: 'EV Chargers', ar: 'شواحن سيارات كهربائية', en: 'EV Chargers' },
  { value: 'Kids Area', ar: 'منطقة أطفال', en: 'Kids Area' },
  { value: 'Commercial Area', ar: 'منطقة تجارية', en: 'Commercial Area' },
  { value: 'Mosque', ar: 'مسجد', en: 'Mosque' },
  { value: 'Hotel', ar: 'فندق', en: 'Hotel' },
  { value: 'Jogging Track', ar: 'مسار جري', en: 'Jogging Track' },
  { value: 'Cycling Track', ar: 'مسار دراجات', en: 'Cycling Track' },
  { value: 'Sports Fields', ar: 'ملاعب رياضية', en: 'Sports Fields' },
  { value: 'Medical Center', ar: 'مركز طبي', en: 'Medical Center' },
];

export const FINISHING_OPTIONS = [
  { value: '', ar: 'غير محدد', en: 'Unspecified' },
  { value: 'Not Finished', ar: 'على المحارة', en: 'Not Finished' },
  { value: 'Semi Finished', ar: 'نص تشطيب', en: 'Semi Finished' },
  { value: 'Finished', ar: 'تشطيب كامل', en: 'Finished' },
  { value: 'Fully Finished', ar: 'سوبر لوكس', en: 'Super Lux' },
];

/** Reads a File as a data URL, promisified so errors stay inside the caller's try/catch. */
const fileToDataUrl = (file: File) => new Promise<string>((resolve, reject) => {
  const reader = new FileReader();
  reader.onload = () => resolve(reader.result as string);
  reader.onerror = () => reject(reader.error ?? new Error('Failed to read file'));
  reader.readAsDataURL(file);
});

/**
 * Uploads media to Firebase Storage and returns its public URL.
 * Media used to be stored as base64 data-URLs directly inside the Firestore
 * property document, which blows past Firestore's 1MB document limit as soon
 * as a few photos are attached — the listing save would simply fail.
 */
// On the free Spark plan Storage isn't enabled and uploadBytes can hang for a
// long time before failing, so an upload is raced against a deadline. The
// deadline has to scale with the file: a flat 8s is fine for probing whether a
// bucket exists but guarantees failure for a 10MB deed on a mobile connection,
// and the base64 fallback it drops into cannot hold one anyway.
const STORAGE_PROBE_MS = 8000;                       // enough to learn the bucket is missing
const STORAGE_MS_PER_MB = 20000;                     // ~0.4 Mbps floor, generous for 3G
export const uploadDeadline = (bytes: number) =>
  STORAGE_PROBE_MS + Math.ceil(bytes / (1024 * 1024)) * STORAGE_MS_PER_MB;

const withTimeout = <T,>(promise: Promise<T>, ms: number) =>
  Promise.race([
    promise,
    new Promise<never>((_, reject) => setTimeout(() => reject(new Error('storage-timeout')), ms)),
  ]);

/** A timeout means a slow network, not a missing bucket. */
const isMissingBucket = (err: unknown) => (err as Error)?.message !== 'storage-timeout';

const uploadToStorage = async (file: Blob, originalName: string) => {
  const safeName = originalName.replace(/[^a-zA-Z0-9._-]/g, '_').slice(-80);
  // The uid segment is what lets storage.rules authorise the owner to delete this
  // object later. Objects uploaded before this existed sit at the flat prefix and
  // can only be swept with the Admin SDK.
  const uid = auth.currentUser?.uid || 'anonymous';
  const storageRef = ref(storage, `properties/${uid}/${Date.now()}_${Math.random().toString(36).slice(2, 8)}_${safeName}`);
  await withTimeout(uploadBytes(storageRef, file), uploadDeadline(file.size));
  return getDownloadURL(storageRef);
};

// Firebase Storage requires the Blaze plan on newer projects. When it isn't
// enabled the upload fails, so we fall back to the legacy approach of storing
// heavily-compressed base64 data URLs inside the Firestore document itself.
// Remembered for the session so we don't pay a failed request per file.
let storageUnavailable = false;

const isDataUrl = (s: string) => s.startsWith('data:');

// ~110KB of base64 per image; capped so the property document (which also
// duplicates the first image in imageUrl) stays under Firestore's 1MB limit.
const FALLBACK_MAX_IMAGES = 6;
// Firestore's isValidProperty caps images[] and panoramas[] at 20 each — exceeding
// it rejects the whole listing, so the UI must never let it happen.
const MAX_MEDIA_ITEMS = 20;
// Firestore's isValidProperty caps legalDocs and paymentPlans at 10 each.
const MAX_LEGAL_DOCS = 10;
const MAX_PAYMENT_PLANS = 10;
const FALLBACK_VIDEO_LIMIT = 500 * 1024;
// Must stay under storage.rules' 80MB ceiling for video/*.
const MAX_VIDEO_BYTES = 80 * 1024 * 1024;
// Vercel rejects a serverless request body over ~4.5MB at the edge, before the
// function runs — measured on production: 4.0MB passes, 4.4MB returns
// FUNCTION_PAYLOAD_TOO_LARGE. base64 costs 4/3, and the prompt rides along, so
// this is what actually fits.
const MAX_AI_FILE_BYTES = Math.floor(2.8 * 1024 * 1024);
// storage.rules accepts a PDF up to 15MB, and the function fetches it itself, so
// the inbound-body cap does not apply to anything sent this way.
const MAX_AI_VIA_STORAGE_BYTES = 15 * 1024 * 1024;

/**
 * Puts a file in Storage so the AI function can fetch it, and hands back a way to
 * remove it again. A brochure is read once and is not part of the listing.
 */
const stageForAI = async (file: File) => {
  const uid = auth.currentUser?.uid || 'anonymous';
  const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, '_').slice(-80);
  const path = `properties/${uid}/ai-${Date.now()}_${Math.random().toString(36).slice(2, 8)}_${safeName}`;
  const objectRef = ref(storage, path);
  await withTimeout(uploadBytes(objectRef, file), uploadDeadline(file.size));
  const url = await getDownloadURL(objectRef);
  return {
    url,
    discard: () => deleteObject(objectRef).catch(err => console.warn('Could not remove staged brochure:', err)),
  };
};
// A brochure is mostly text, so it has to stay legible after compression.
const BROCHURE_COMPRESSION = { maxSizeMB: 2.5, maxWidthOrHeight: 2400, useWebWorker: true };

/**
 * Shrinks an image to fit the request-body limit. PDFs cannot be compressed in
 * the browser, so those are reported to the caller instead of failing opaquely.
 */
const fitForAI = async (file: File): Promise<{ file: File } | { tooBig: number }> => {
  if (file.size <= MAX_AI_FILE_BYTES) return { file };
  if (!file.type.startsWith('image/')) return { tooBig: file.size };
  try {
    const smaller = await imageCompression(file, BROCHURE_COMPRESSION);
    if (smaller.size <= MAX_AI_FILE_BYTES) return { file: smaller as File };
    return { tooBig: smaller.size };
  } catch {
    return { tooBig: file.size };
  }
};

const mb = (bytes: number) => (bytes / 1024 / 1024).toFixed(1);

// Storage hosts the file, so quality is bounded by what a phone will download,
// not by Firestore's 1MB document limit. storage.rules allows 15MB per image.
const STORAGE_COMPRESSION = { maxSizeMB: 2.5, maxWidthOrHeight: 2560, useWebWorker: true };
// A 360 photo is stretched around a whole sphere, so 2560px across leaves only
// about seven pixels per degree — visibly soft. These get their own budget.
const PANORAMA_COMPRESSION = { maxSizeMB: 6, maxWidthOrHeight: 5120, useWebWorker: true };
// Only reachable when Storage is unavailable: base64 has to fit inside the
// Firestore document alongside everything else.
const FIRESTORE_COMPRESSION = { maxSizeMB: 0.08, maxWidthOrHeight: 800, useWebWorker: true };

/** Compresses and stores an image, preferring Storage with a base64 fallback. */
const storeImage = async (file: File, options = STORAGE_COMPRESSION): Promise<string> => {
  if (!storageUnavailable) {
    try {
      const compressed = await imageCompression(file, options);
      return await uploadToStorage(compressed, file.name);
    } catch (err) {
      console.warn('Storage upload failed — falling back to inline base64 (Storage needs the Blaze plan)', err);
      if (isMissingBucket(err)) storageUnavailable = true;
    }
  }
  const compressed = await imageCompression(file, FIRESTORE_COMPRESSION);
  return fileToDataUrl(compressed);
};

/** Stores a legal document (image or PDF) — Storage first, base64 fallback. */
const storeDocument = async (file: File): Promise<string> => {
  if (!storageUnavailable) {
    try { return await uploadToStorage(file, file.name); }
    catch (err) {
      console.warn('Storage document upload failed — base64 fallback', err);
      // A slow upload must not convince the rest of the session that Storage is
      // gone — a PDF cannot survive the base64 path.
      if (isMissingBucket(err)) storageUnavailable = true;
      else throw err;
    }
  }
  return fileToDataUrl(file);
};

/** Converts Arabic-Indic (٠-٩) and Persian (۰-۹) numerals to Latin 0-9. */
const toLatinDigits = (s: string) =>
  s.replace(/[٠-٩]/g, d => String(d.charCodeAt(0) - 0x0660))
   .replace(/[۰-۹]/g, d => String(d.charCodeAt(0) - 0x06F0));

/** True for a recognised virtual-tour link (Matterport / Polycam / Kuula). */
const isLikelyTourUrl = (raw: string) => {
  try {
    const h = new URL((raw || '').trim()).hostname.replace(/^www\./, '');
    return h.endsWith('matterport.com') || h.endsWith('poly.cam') || h.endsWith('kuula.co');
  } catch { return false; }
};

export const AddListingPage = ({ onAdd, onAddMany, onUpdate, mode = 'create', initialProperty, t, isRtl, isAdmin, isSuperAdmin, defaultYallaSahel = false }: { onAdd: (prop: Omit<Property, 'id'>) => Promise<void>, onAddMany?: (props: Omit<Property, 'id'>[]) => Promise<void>, onUpdate?: (id: string, patch: Record<string, unknown>) => Promise<void>, mode?: 'create' | 'edit', initialProperty?: Property, t: any, isRtl: boolean, isAdmin: boolean, isSuperAdmin: boolean, defaultYallaSahel?: boolean }) => {
  const isEdit = mode === 'edit' && !!initialProperty;
  const seed = initialProperty;
  const numStr = (v: number | undefined, fallback = '') => (v === undefined || v === null ? fallback : String(v));
  const [step, setStep] = useState(1);
  // In edit mode every field is seeded from the stored listing. formData keeps
  // numbers as strings, so each numeric field is converted on the way in.
  const [formData, setFormData] = useState(() => seed ? {
    title: seed.title || '', description: seed.description || '',
    price: numStr(seed.price), location: seed.location || '',
    bedrooms: numStr(seed.bedrooms, '1'), bathrooms: numStr(seed.bathrooms, '1'),
    area: numStr(seed.area), areaTo: numStr(seed.areaTo),
    currency: (seed.currency || 'EGP') as 'EGP' | 'USD',
    pricePeriod: (seed.pricePeriod || 'total') as 'total' | 'night' | 'week' | 'month',
    guests: numStr(seed.guests), village: seed.village || '', yallaSahel: !!seed.yallaSahel,
    propertyType: seed.propertyType || 'Apartment', contactPhone: seed.contactPhone || '',
    compound: seed.compound || '', developer: seed.developer || '', deliveryDate: seed.deliveryDate || '',
    finishing: seed.finishing || '', floor: seed.floor || '', view: seed.view || '', furnished: !!seed.furnished,
    imageUrl: seed.imageUrl || '', videoUrl: seed.videoUrl || '', digitalTwinUrl: seed.digitalTwinUrl || '',
    status: seed.status || 'For Sale',
    availability: (seed.availability || 'Available') as 'Available' | 'Sold' | 'Reserved',
    registrationNumber: seed.registrationNumber || '',
    courtSignatureValidity: !!seed.courtSignatureValidity, isResale: !!seed.isResale,
  } : {
    title: '', description: '', price: '', location: '', bedrooms: '1', bathrooms: '1', area: '', areaTo: '',
    currency: 'EGP' as 'EGP' | 'USD',
    pricePeriod: 'total' as 'total' | 'night' | 'week' | 'month',
    guests: '', village: '', yallaSahel: defaultYallaSahel,
    propertyType: defaultYallaSahel ? 'Chalet' : 'Apartment', contactPhone: '',
    compound: '', developer: '', deliveryDate: '', finishing: '', floor: '', view: '', furnished: false,
    imageUrl: '', videoUrl: '', digitalTwinUrl: '', status: 'For Sale',
    availability: 'Available' as 'Available' | 'Sold' | 'Reserved',
    registrationNumber: '', courtSignatureValidity: false, isResale: false
  });
  // Payment methods the buyer can use; at least one is required before publishing.
  const [paymentMethods, setPaymentMethods] = useState<string[]>(seed?.paymentMethods?.length ? seed.paymentMethods : ['Cash']);
  const togglePayment = (m: string) =>
    setPaymentMethods(prev => prev.includes(m) ? prev.filter(x => x !== m) : [...prev, m]);
  const [images, setImages] = useState<string[]>(seed?.images || []);
  const [panoramas, setPanoramas] = useState<string[]>(seed?.panoramas || []);
  const [legalDocs, setLegalDocs] = useState<string[]>(seed?.legalDocs || []);
  const [amenities, setAmenities] = useState<string[]>(seed?.amenities || []);
  const toggleAmenity = (v: string) => setAmenities(prev => prev.includes(v) ? prev.filter(x => x !== v) : [...prev, v]);
  const [paymentPlans, setPaymentPlans] = useState<{ downPayment: string; years: string; note: string }[]>(
    (seed?.paymentPlans || []).map(pp => ({ downPayment: numStr(pp.downPayment), years: numStr(pp.years), note: pp.note || '' }))
  );
  // Developer projects: one brochure → several unit types → one listing per type.
  const [unitVariants, setUnitVariants] = useState<{ title: string; propertyType: string; bedrooms: string; bathrooms: string; area: string; areaTo: string; price: string }[]>([]);
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [submitting, setSubmitting] = useState(false);
  const [successMessage, setSuccessMessage] = useState('');
  const [generatingDesc, setGeneratingDesc] = useState(false);
  const [extractingOCR, setExtractingOCR] = useState(false);
  const [importing, setImporting] = useState(false);
  const [importNote, setImportNote] = useState('');
  const [errorMsg, setErrorMsg] = useState('');

  // The four fields the property can't be saved without (Firestore rules also
  // enforce title/price/location). Returns the list of missing labels.
  const missingBasics = () => {
    const missing: string[] = [];
    if (!formData.title.trim()) missing.push(isRtl ? 'عنوان العقار' : 'Title');
    if (!formData.price || Number(formData.price) <= 0) missing.push(isRtl ? 'السعر' : 'Price');
    if (!formData.location.trim()) missing.push(isRtl ? 'الموقع' : 'Location');
    if (!formData.area || Number(formData.area) <= 0) missing.push(isRtl ? 'المساحة' : 'Area');
    return missing;
  };
  const basicsComplete = missingBasics().length === 0;

  // Advance steps, but block leaving step 1 while required basics are missing.
  const goToStep = (target: number) => {
    if (target > 1 && step === 1) {
      const missing = missingBasics();
      if (missing.length) {
        setErrorMsg((isRtl ? 'من فضلك املأ: ' : 'Please fill in: ') + missing.join('، '));
        return;
      }
    }
    setErrorMsg('');
    setStep(target);
  };

  // Pretty-print the price with thousand separators so a long number is easy to verify.
  const formattedPrice = formData.price ? Number(formData.price).toLocaleString(isRtl ? 'ar-EG' : 'en-US') : '';

  const generateDescription = async () => {
    try {
      setGeneratingDesc(true);
      const prompt = `Write a succinct, professional real estate description for a property in ${formData.location} with ${formData.bedrooms} bedrooms, ${formData.bathrooms} bathrooms, an area of ${formData.area} sqm, priced at ${formData.price} EGP. Status: ${formData.status}. ${isRtl ? 'Write it in Arabic.' : 'Write it in English.'}`;
      const response = await generateContentResilient({ task: 'describe', contents: prompt });
      setFormData(prev => ({ ...prev, description: response.text || "" }));
    } catch (e) {
      console.error("Description generation failed", e);
      alert(aiErrorMessage(e, isRtl));
    } finally {
      setGeneratingDesc(false);
    }
  };

  // AI brochure import: read a project PDF/flyer and auto-fill the form.
  const handleBrochureImport = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setImporting(true);
    let staged: { url: string; discard: () => Promise<void> } | null = null;
    try {
      // A PDF is read locally and reduced to the pages that carry unit data. On a
      // real 237-page catalogue that is 12 pages and about 1.3MB, from 39MB — so
      // size stops being the constraint, and the extraction stops competing with
      // 225 pages of brand story. Rendering the pages also avoids Arabic text
      // layers, which return digits out of order.
      let fileParts: Record<string, unknown>[];
      if (file.type === 'application/pdf') {
        const { pickBrochurePages } = await import('../lib/brochurePages');
        const picked = await pickBrochurePages(file);
        if (!picked.images.length) {
          alert(isRtl ? 'مقدرناش نقرا الـ PDF ده.' : 'That PDF could not be read.');
          setImporting(false);
          return;
        }
        setImportNote(isRtl
          ? `بنقرا ${picked.images.length} صفحة من ${picked.totalPages} — الصفحات اللي فيها الوحدات والمساحات.`
          : `Reading ${picked.images.length} of ${picked.totalPages} pages — the ones with units and areas.`);
        fileParts = picked.images.map(dataUrl => ({
          inlineData: { data: dataUrl.split(',')[1], mimeType: 'image/jpeg' },
        }));
      } else {
        const fitted = await fitForAI(file);
        if ('tooBig' in fitted) {
          staged = await stageForAI(file);
          fileParts = [{ fileUrl: { url: staged.url, mimeType: file.type } }];
        } else {
          const base64 = (await fileToDataUrl(fitted.file)).split(',')[1];
          fileParts = [{ inlineData: { data: base64, mimeType: fitted.file.type } }];
        }
      }
      const prompt = `You are a real-estate data extractor. Read this property brochure/flyer (it may be Arabic, English or Franco) and extract ONE listing as JSON.
If it lists multiple unit types, pick the entry/smallest unit as the base, and summarise ALL unit types (with their areas, starting prices and payment plans) inside "description".
Return ONLY valid JSON (no markdown), omitting any key you can't find:
{
 "title": string,
 "propertyType": one of ["Apartment","Villa","Duplex","Penthouse","Studio","Townhouse","Chalet","Office","Retail","Land"],
 "price": number (starting price, digits only),
 "currency": "EGP" or "USD",
 "area": number (m², smallest if a range),
 "areaTo": number (largest m² if a range),
 "bedrooms": number,
 "bathrooms": number,
 "location": string (area/city),
 "compound": string (project name),
 "developer": string,
 "deliveryDate": string,
 "finishing": one of ["","Not Finished","Semi Finished","Finished","Fully Finished"],
 "floor": string,
 "view": string,
 "guests": number (max guests the unit sleeps — for chalets/rentals),
 "village": string (coastal village/resort name if any),
 "pricePeriod": one of ["total","night","week","month"] (how the price is quoted; use "total" for a sale, "night"/"week" for rentals),
 "paymentMethods": array subset of ["Cash","Installments","Bank Transfer","Mortgage"],
 "amenities": array of strings, each EXACTLY one of ["Clubhouse","Swimming Pools","Gym","Lagoons","Landscape","Security","Underground Garage","EV Chargers","Kids Area","Commercial Area","Mosque","Hotel","Jogging Track","Cycling Track","Sports Fields","Medical Center"],
 "paymentPlans": array of objects {"downPayment": number (percent), "years": number, "note": string},
 "units": array — INCLUDE ONLY IF the brochure lists MULTIPLE unit types; one object per unit type: {"title": string (e.g. "1 Bedroom"), "propertyType": one of the propertyType values above, "bedrooms": number, "bathrooms": number, "area": number (from), "areaTo": number (to), "price": number (starting price)},
 "description": string (rich — EOI/maintenance, project story and any details not captured above, in the brochure's own language)
}`;
      const response = await generateContentResilient({
        task: 'brochure',
        contents: [{ role: 'user', parts: [ { text: prompt }, ...(fileParts as any[]) ] }],
        config: { responseMimeType: 'application/json' },
      });
      const raw = (response.text || '').trim().replace(/^```json\s*/i, '').replace(/```$/, '').trim();
      const parsed = JSON.parse(raw);
      // Drop prototype-polluting keys and coerce values defensively — a brochure is
      // untrusted input, and a NaN / over-long value would be rejected by the
      // security rules and lose the whole submission.
      const data: any = {};
      for (const k of Object.keys(parsed || {})) {
        if (k === '__proto__' || k === 'constructor' || k === 'prototype') continue;
        data[k] = parsed[k];
      }
      /** Finite number as string, else '' (so it never becomes NaN downstream). */
      const num = (v: any) => { const n = Number(v); return Number.isFinite(n) ? String(n) : ''; };
      /** Trimmed string capped below the matching Firestore rule limit. */
      const str = (v: any, max: number) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
      setFormData(prev => ({
        ...prev,
        title: str(data.title, 199) || prev.title,
        propertyType: PROPERTY_TYPES.some(p => p.value === data.propertyType) ? data.propertyType : prev.propertyType,
        price: data.price != null && num(data.price) ? num(data.price).replace(/[^0-9]/g, '') : prev.price,
        currency: data.currency === 'USD' ? 'USD' : (data.currency === 'EGP' ? 'EGP' : prev.currency),
        area: num(data.area) || prev.area,
        areaTo: num(data.areaTo) || prev.areaTo,
        bedrooms: num(data.bedrooms) || prev.bedrooms,
        bathrooms: num(data.bathrooms) || prev.bathrooms,
        location: str(data.location, 199) || prev.location,
        compound: str(data.compound, 119) || prev.compound,
        developer: str(data.developer, 119) || prev.developer,
        deliveryDate: str(data.deliveryDate, 49) || prev.deliveryDate,
        finishing: FINISHING_OPTIONS.some(f => f.value === data.finishing) ? data.finishing : prev.finishing,
        floor: str(data.floor, 29) || prev.floor,
        view: str(data.view, 59) || prev.view,
        guests: num(data.guests) || prev.guests,
        village: str(data.village, 119) || prev.village,
        pricePeriod: ['total', 'night', 'week', 'month'].includes(data.pricePeriod) ? data.pricePeriod : prev.pricePeriod,
        description: str(data.description, 49999) || prev.description,
      }));
      if (Array.isArray(data.paymentMethods)) {
        const valid = data.paymentMethods.filter((m: string) => PAYMENT_OPTIONS.some(p => p.value === m));
        if (valid.length) setPaymentMethods(valid);
      }
      if (Array.isArray(data.amenities)) {
        const valid = data.amenities.filter((a: string) => AMENITIES.some(x => x.value === a));
        if (valid.length) setAmenities(valid);
      }
      if (Array.isArray(data.paymentPlans)) {
        const plans = data.paymentPlans
          .filter((p: any) => p && (p.downPayment != null || p.years != null || p.note))
          .slice(0, 10)
          .map((p: any) => ({ downPayment: p.downPayment != null ? String(p.downPayment) : '', years: p.years != null ? String(p.years) : '', note: typeof p.note === 'string' ? p.note : '' }));
        if (plans.length) setPaymentPlans(plans);
      }
      let unitCount = 0;
      if (Array.isArray(data.units) && data.units.length > 1) {
        const variants = data.units.slice(0, 20).map((u: any) => ({
          title: typeof u.title === 'string' ? u.title : '',
          propertyType: PROPERTY_TYPES.some(p => p.value === u.propertyType) ? u.propertyType : (PROPERTY_TYPES.some(p => p.value === data.propertyType) ? data.propertyType : 'Apartment'),
          bedrooms: u.bedrooms != null ? String(u.bedrooms) : '',
          bathrooms: u.bathrooms != null ? String(u.bathrooms) : '',
          area: u.area != null ? String(u.area) : '',
          areaTo: u.areaTo != null ? String(u.areaTo) : '',
          price: u.price != null ? String(u.price).replace(/[^0-9]/g, '') : '',
        }));
        setUnitVariants(variants);
        unitCount = variants.length;
      }
      alert(isRtl
        ? (unitCount > 1
            ? `تم استخراج المشروع و${unitCount} أنواع وحدات ✅ راجعها — هيتنشر إعلان لكل نوع.`
            : 'تم استخراج البيانات من البروشور ✅ راجعها وعدّل أي حاجة قبل النشر.')
        : (unitCount > 1
            ? `Extracted the project and ${unitCount} unit types ✅ review — one listing will be published per type.`
            : 'Extracted from the brochure ✅ review and edit anything before publishing.'));
    } catch (err) {
      console.error('Brochure import failed', err);
      alert(aiErrorMessage(err, isRtl));
    } finally {
      // The brochure was only ever a source to read; it is not part of the listing.
      await staged?.discard();
      setImporting(false);
      setImportNote('');
    }
  };

  const handleDocumentUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = ''; // allow re-selecting the same file
    if (!file) return;
    setExtractingOCR(true);
    // 1) Persist the document itself so it's never lost (was previously discarded).
    try {
      const url = await storeDocument(file);
      // isValidProperty caps legalDocs at 10; going over makes every later save
      // fail with a generic error the user cannot act on.
      let capped = false;
      setLegalDocs(prev => {
        if (prev.length >= MAX_LEGAL_DOCS) { capped = true; return prev; }
        return [...prev, url];
      });
      if (capped) {
        alert(isRtl
          ? `الحد الأقصى ${MAX_LEGAL_DOCS} مستندات.`
          : `You can attach at most ${MAX_LEGAL_DOCS} documents.`);
      }
    } catch (docErr) {
      console.error('Failed to store legal document', docErr);
      // Carrying on would let the OCR below fill in a registry number for a
      // document that was never stored — a legal claim with nothing behind it.
      alert(isRtl
        ? 'تعذّر رفع المستند، فما اتقراش. جرّب تاني.'
        : 'The document could not be uploaded, so nothing was read from it. Please try again.');
      setExtractingOCR(false);
      return;
    }
    // 2) OCR the registry number from it — the file itself is already saved, so a
    // document too large to send is only a missed autofill, not a lost document.
    const fitted = await fitForAI(file);
    if ('tooBig' in fitted) {
      setExtractingOCR(false);
      alert(isRtl
        ? `المستند اتحفظ. بس حجمه ${mb(fitted.tooBig)} ميجا فما ينفعش نقراه آليًا — اكتب رقم الشهر العقاري بإيدك.`
        : `The document was saved. At ${mb(fitted.tooBig)}MB it is too large to read automatically — type the registry number yourself.`);
      return;
    }
    try {
      // await the read so any failure below is caught and the spinner always stops
      const base64 = (await fileToDataUrl(fitted.file)).split(',')[1];
      const response = await generateContentResilient({
        task: 'ocr',
        contents: [
          { role: 'user', parts: [
            { text: "Extract the official Registry Number (رقم المشهر او رقم الشهر العقاري) from this real estate deed/document. Return only the extracted number. If not found, return 'NOT_FOUND'." },
            { inlineData: { data: base64, mimeType: fitted.file.type } }
          ]}
        ]
      });
      const extracted = response.text?.trim();
      if(extracted && !extracted.includes('NOT_FOUND')) {
        // Cap below the Firestore rule limit (< 100) so a long OCR result can't
        // make the whole listing save fail.
        setFormData(prev => ({ ...prev, registrationNumber: extracted.slice(0, 99) }));
        alert(isRtl ? 'تم استخراج رقم الشهر العقاري بنجاح' : 'Registry Number extracted successfully');
      } else {
        alert(isRtl ? 'لم يتم العثور على رقم الشهر العقاري' : 'Registry Number not found');
      }
    } catch (err) {
      console.error("OCR failed", err);
      alert(aiErrorMessage(err, isRtl));
    } finally {
      setExtractingOCR(false);
    }
  };

  // Single pipeline for both the file picker and drag & drop:
  // compress → upload to Firebase Storage (or base64 fallback) → keep the URL.
  // Images are processed in parallel so a batch isn't bottlenecked one-by-one.
  const processImageFiles = async (files: File[]) => {
    const imageFiles = files.filter(f => f.type.startsWith('image/'));
    if (!imageFiles.length) return;

    setUploading(true);
    setUploadProgress(5);

    let done = 0;
    const tick = () => {
      done++;
      setUploadProgress(5 + Math.round((done / imageFiles.length) * 90));
    };

    const results = await Promise.all(imageFiles.map(async (file) => {
      try {
        const url = await storeImage(file);
        tick();
        return { url };
      } catch (err) {
        console.error("Image upload failed", err);
        tick();
        return { url: null };
      }
    }));

    // Enforce the base64 cap *after* the parallel work, keeping the document small.
    let base64Count = images.filter(isDataUrl).length;
    // Hard cap on total photos — the Firestore rule allows at most 20 and would
    // otherwise reject the ENTIRE listing on save.
    let total = images.length;
    const uploadedUrls: string[] = [];
    let failures = 0;
    let skippedForSize = 0;
    for (const r of results) {
      if (!r.url) { failures++; continue; }
      if (total >= MAX_MEDIA_ITEMS) { skippedForSize++; continue; }
      if (isDataUrl(r.url)) {
        if (base64Count >= FALLBACK_MAX_IMAGES) { skippedForSize++; continue; }
        base64Count++;
      }
      total++;
      uploadedUrls.push(r.url);
    }

    if (uploadedUrls.length) {
      setImages(prev => [...prev, ...uploadedUrls]);
      setFormData(prev => (prev.imageUrl ? prev : { ...prev, imageUrl: uploadedUrls[0] }));
    }
    if (failures) {
      alert(isRtl ? `تعذر رفع ${failures} من الصور` : `${failures} image(s) failed to upload`);
    }
    if (skippedForSize) {
      alert(isRtl
        ? `الحد الأقصى ${FALLBACK_MAX_IMAGES} صور للعقار الواحد حاليًا (تم تخطي ${skippedForSize}). لرفع صور أكثر وبجودة أعلى فعّل خطة Blaze في Firebase.`
        : `Max ${FALLBACK_MAX_IMAGES} photos per listing for now (${skippedForSize} skipped). Enable the Firebase Blaze plan for more photos at higher quality.`);
    }
    setUploadProgress(100);
    setTimeout(() => setUploading(false), 400);
  };

  const handleImageUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    e.target.value = ''; // allow re-selecting the same files
    processImageFiles(files);
  };

  // 360° equirectangular panoramas, stored separately so the viewer knows to
  // render them inside a sphere (look-around) rather than as a flat photo.
  const handlePanoramaUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []).filter(f => f.type.startsWith('image/'));
    e.target.value = '';
    if (!files.length) return;
    setUploading(true);
    setUploadProgress(5);
    const results: string[] = [];
    let failures = 0;
    let done = 0;
    await Promise.all(files.map(async (file) => {
      try { results.push(await storeImage(file, PANORAMA_COMPRESSION)); }
      catch (err) { failures++; console.error('Panorama upload failed', err); }
      done++; setUploadProgress(5 + Math.round((done / files.length) * 90));
    }));
    // Same base64 cap as images so panoramas can't silently blow the 1MB doc limit.
    let base64Count = [...images, ...panoramas].filter(isDataUrl).length;
    // And the same hard 20-item cap the Firestore rule enforces on panoramas[].
    let total = panoramas.length;
    const urls: string[] = [];
    let skippedForSize = 0;
    for (const url of results) {
      if (total >= MAX_MEDIA_ITEMS) { skippedForSize++; continue; }
      if (isDataUrl(url)) {
        if (base64Count >= FALLBACK_MAX_IMAGES) { skippedForSize++; continue; }
        base64Count++;
      }
      total++;
      urls.push(url);
    }
    if (urls.length) setPanoramas(prev => [...prev, ...urls]);
    if (failures) alert(isRtl ? `تعذر رفع ${failures} من صور البانوراما` : `${failures} panorama(s) failed to upload`);
    if (skippedForSize) alert(isRtl
      ? `تم تخطي ${skippedForSize} بانوراما — فعّل خطة Blaze لرفع وسائط أكثر.`
      : `${skippedForSize} panorama(s) skipped — enable the Firebase Blaze plan for more media.`);
    setUploadProgress(100);
    setTimeout(() => setUploading(false), 400);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    processImageFiles(Array.from(e.dataTransfer.files));
  };

  const handleVideoUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    // storage.rules allows 80MB for a video; anything larger is refused there
    // with an error the user cannot read, so stop it here with one they can.
    if (file.size > MAX_VIDEO_BYTES) {
      alert(isRtl ? 'حجم الفيديو لازم يكون أقل من 80 ميجابايت.' : 'Video must be under 80MB.');
      return;
    }
    setUploading(true);
    setUploadProgress(30);
    try {
      if (!storageUnavailable) {
        const url = await uploadToStorage(file, file.name);
        setFormData(prev => ({ ...prev, videoUrl: url }));
        setUploadProgress(100);
        return;
      }
      throw new Error('storage-unavailable');
    } catch (err) {
      if ((err as Error).message !== 'storage-unavailable') {
        console.warn('Storage video upload failed — trying base64 fallback', err);
        if (isMissingBucket(err)) storageUnavailable = true;
      }
      // Without Storage the video has to live inside the Firestore document,
      // which only leaves room for very small clips.
      if (file.size <= FALLBACK_VIDEO_LIMIT) {
        try {
          const dataUrl = await fileToDataUrl(file);
          setFormData(prev => ({ ...prev, videoUrl: dataUrl }));
          setUploadProgress(100);
        } catch (readErr) {
          console.error("Video upload failed", readErr);
          alert(isRtl ? 'فشل رفع الفيديو' : 'Video upload failed');
        }
      } else {
        alert(isRtl
          ? 'رفع الفيديوهات الكبيرة يتطلب تفعيل خطة Blaze في Firebase. حاليًا الحد الأقصى 500 كيلوبايت للفيديو.'
          : 'Large video uploads require the Firebase Blaze plan. The current limit is 500KB per video.');
      }
    } finally {
      setTimeout(() => setUploading(false), 400);
    }
  };

  const handleSubmit = async () => {
    const missing = missingBasics();
    if (missing.length) {
      setStep(1);
      setErrorMsg((isRtl ? 'من فضلك املأ الحقول الأساسية: ' : 'Please fill in the required basics: ') + missing.join('، '));
      return;
    }
    if (uploading) {
      setErrorMsg(isRtl ? 'انتظر لحد ما يخلص رفع الصور/الفيديو.' : 'Please wait until media finishes uploading.');
      return;
    }
    if (paymentMethods.length === 0) {
      setErrorMsg(isRtl ? 'اختر طريقة دفع واحدة على الأقل.' : 'Select at least one payment method.');
      return;
    }
    setErrorMsg('');
    setSubmitting(true);
    
    // unitCode and publishDate identify the listing; regenerating them on an edit
    // would rewrite its history, and the rules refuse them from an owner anyway.
    const unitCode = `HET-${Math.floor(10000 + Math.random() * 90000)}`;
    const publishDate = new Date().toISOString().split('T')[0];

    const newProperty: any = {
      title: formData.title,
      description: formData.description,
      price: Number(formData.price),
      location: formData.location,
      bedrooms: Number(formData.bedrooms),
      bathrooms: Number(formData.bathrooms),
      area: Number(formData.area),
      propertyType: formData.propertyType,
      currency: formData.currency,
      imageUrl: formData.imageUrl || images[0] || '',
      images: images,
      panoramas: panoramas,
      status: formData.status as 'For Sale' | 'For Rent',
      availability: formData.availability,
      paymentMethods: paymentMethods,
      legalDocs: legalDocs,
      registrationNumber: formData.registrationNumber,
      courtSignatureValidity: formData.courtSignatureValidity,
      isResale: formData.isResale
    };

    if (!isEdit) {
      newProperty.unitCode = unitCode;
      newProperty.publishDate = publishDate;
      // Every listing starts unreviewed, including an admin's own. Stamping it
      // 'Verified' at creation is the same auto-stamp that was removed from
      // documents: it puts "a reviewer read the seller's documents" on a listing
      // where no reviewer acted and there may be no documents at all. An admin
      // marks it reviewed from the Verifications queue, deliberately.
      newProperty.isVerified = false;
      newProperty.verificationStatus = 'Pending';
    }

    // On create, omitting an empty optional keeps the document small. On edit the
    // opposite is needed: updateDoc merges, so an omitted key is an unchanged key
    // and the owner could never clear a phone number or drop a payment plan.
    const optional: Record<string, unknown> = {
      videoUrl: formData.videoUrl,
      digitalTwinUrl: formData.digitalTwinUrl,
      contactPhone: formData.contactPhone.trim(),
      compound: formData.compound.trim(),
      developer: formData.developer.trim(),
      deliveryDate: formData.deliveryDate.trim(),
      finishing: formData.finishing,
      floor: formData.floor.trim(),
      view: formData.view.trim(),
      furnished: formData.furnished,
      areaTo: formData.areaTo && Number(formData.areaTo) > 0 ? Number(formData.areaTo) : 0,
      pricePeriod: formData.pricePeriod,
      guests: formData.guests && Number(formData.guests) > 0 ? Number(formData.guests) : 0,
      village: formData.village.trim(),
      yallaSahel: formData.yallaSahel,
      amenities,
      paymentPlans: paymentPlans
        .filter(pp => pp.downPayment || pp.years || pp.note.trim())
        .map(pp => ({ downPayment: Number(pp.downPayment) || 0, years: Number(pp.years) || 0, note: pp.note.trim() })),
    };
    const isEmpty = (v: unknown) =>
      v === '' || v === false || v === 0 || (Array.isArray(v) && v.length === 0) || v === 'total';
    Object.entries(optional).forEach(([k, v]) => {
      if (isEdit || !isEmpty(v)) newProperty[k] = v;
    });

    try {
      if (isEdit && onUpdate && initialProperty) {
        // Send only what actually changed. Firestore's affectedKeys() compares
        // values, and the rules key the "does this invalidate the review" decision
        // off it — so writing 0 over an absent areaTo would read as a material
        // edit and downgrade a listing nobody meaningfully touched.
        const patch: Record<string, unknown> = {};
        Object.keys(newProperty).forEach(k => {
          const before = (initialProperty as any)[k];
          const after = newProperty[k];
          if (normalizeField(before) === normalizeField(after)) return;
          // The form cannot represent "absent", so it shows a default. Writing that
          // default back over a field that was never set is not an edit — and for a
          // material field it would wrongly cost the listing its review.
          if (before === undefined && normalizeField(after) === normalizeField(FIELD_DEFAULTS[k])) return;
          patch[k] = after;
        });
        if (Object.keys(patch).length === 0) {
          setSuccessMessage(isRtl ? 'مفيش تعديلات تتحفظ.' : 'Nothing changed.');
          return;
        }
        const changedMaterial = MATERIAL_LISTING_FIELDS.some(k => k in patch);
        if (changedMaterial) {
          patch.verificationStatus = 'Pending';
          patch.isVerified = false;
        }
        await onUpdate(initialProperty.id, patch);
        setSuccessMessage(changedMaterial
          ? (isRtl
              ? 'اتحفظت التعديلات. لأنك غيّرت السعر أو الموقع أو المستندات، رجع الإعلان لحالة «لم تتم المراجعة» لحد ما حد من الفريق يراجعه تاني.'
              : "Changes saved. Because you changed the price, location or documents, this listing is back to \u201cnot reviewed\u201d until a reviewer looks at it again.")
          : (isRtl ? 'اتحفظت التعديلات.' : 'Changes saved.'));
        return;
      }
      if (unitVariants.length > 0 && onAddMany) {
        // The project page groups by compound. Without one, each unit is published
        // as an unrelated listing — which is the opposite of what this panel is for.
        if (!formData.compound.trim()) {
          setSubmitting(false);
          setStep(1);
          setErrorMsg(isRtl
            ? 'اكتب اسم الكمبوند / المشروع الأول — هو اللي بيجمع أنواع الوحدات في صفحة واحدة.'
            : 'Fill in the Compound / Project name first — it is what groups the unit types onto one page.');
          return;
        }
        // One listing per unit type, all sharing the project-level data.
        const list = unitVariants.map((v) => {
          const p: any = { ...newProperty };
          p.title = v.title.trim() ? `${newProperty.title} — ${v.title.trim()}` : newProperty.title;
          if (v.propertyType) p.propertyType = v.propertyType;
          if (v.bedrooms !== '') p.bedrooms = Number(v.bedrooms);
          if (v.bathrooms !== '') p.bathrooms = Number(v.bathrooms);
          if (v.area !== '') p.area = Number(v.area);
          if (v.areaTo !== '' && Number(v.areaTo) > 0) p.areaTo = Number(v.areaTo); else delete p.areaTo;
          if (v.price !== '') p.price = Number(v.price);
          p.unitCode = `HET-${Math.floor(10000 + Math.random() * 90000)}`;
          return p as Omit<Property, 'id'>;
        });
        await onAddMany(list);
        setSuccessMessage(isRtl ? `تم نشر ${list.length} وحدات من المشروع بنجاح.` : `Published ${list.length} project units successfully.`);
      } else {
        await onAdd(newProperty);
        setSuccessMessage(isRtl
          ? 'إعلانك منشور. لسه ما اتراجعتش مستنداته — هيفضل «لم تتم المراجعة» لحد ما حد من الفريق يراجعها.'
          : "Your listing is live. Its documents have not been reviewed yet \u2014 it stays \u201cnot reviewed\u201d until a reviewer looks at them.");
      }
      setFormData({
        title: '', description: '', price: '', location: '', bedrooms: '1', bathrooms: '1', area: '', areaTo: '',
        currency: 'EGP',
        // Keep the Yalla Sahel mode so an owner can add several chalets in a row.
        pricePeriod: 'total', guests: '', village: '', yallaSahel: formData.yallaSahel,
        propertyType: formData.yallaSahel ? 'Chalet' : 'Apartment', contactPhone: '',
        compound: '', developer: '', deliveryDate: '', finishing: '', floor: '', view: '', furnished: false,
        imageUrl: '', videoUrl: '', digitalTwinUrl: '', status: 'For Sale',
        availability: 'Available',
        registrationNumber: '', courtSignatureValidity: false, isResale: false
      });
      setPaymentMethods(['Cash']);
      setImages([]);
      setPanoramas([]);
      setLegalDocs([]);
      setAmenities([]);
      setPaymentPlans([]);
      setUnitVariants([]);
      setStep(1);
    } catch (err) {
      console.error("Failed to publish property", err);
      alert(isRtl ? 'فشل نشر العقار، حاول مرة أخرى.' : 'Failed to publish the property. Please try again.');
    } finally {
      setSubmitting(false);
    }
  };

  if (successMessage) {
    return (
      <div className="max-w-2xl mx-auto px-4 py-24 text-center animate-fade-in">
        <div className="bg-green-50 text-green-800 p-8 rounded-2xl border border-green-200 shadow-lg">
          <CheckCircle className="mx-auto h-16 w-16 mb-4 text-green-500" aria-hidden="true" />
          <h2 className="text-2xl font-heading font-black mb-2">
            {isEdit ? (isRtl ? 'تم حفظ التعديلات' : 'Changes saved') : (isRtl ? 'تم النشر' : 'Published')}
          </h2>
          <p className="text-lg font-medium">{successMessage}</p>
          {!isEdit && (
            <button onClick={() => setSuccessMessage('')} className="mt-8 px-6 py-3 bg-brand-600 text-white rounded-xl shadow-md font-bold cursor-pointer">
              {isRtl ? 'إضافة عقار آخر' : 'Add Another Property'}
            </button>
          )}
        </div>
      </div>
    );
  }

  const steps = [
    { id: 1, title: isRtl ? 'المعلومات الأساسية' : 'Basic Info', icon: FileText },
    { id: 2, title: isRtl ? 'الوسائط' : 'Media', icon: ImageIcon },
    { id: 3, title: isRtl ? 'الوثائق القانونية' : 'Legal Docs', icon: Shield }
  ];

  const labelCls = "block text-sm font-bold text-slate-700 dark:text-slate-300 mb-2";
  const inputCls = "w-full px-4 py-3 bg-slate-50 border border-slate-200 dark:bg-slate-800 dark:border-slate-700 rounded-xl focus:ring-2 focus:ring-brand-500 outline-none transition-all text-slate-900 dark:text-white";
  const selectCls = inputCls + " appearance-none bg-[url('data:image/svg+xml;charset=utf-8,%3Csvg%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%20fill%3D%22none%22%20viewBox%3D%220%200%2020%2020%22%3E%3Cpath%20stroke%3D%22%236b7280%22%20stroke-linecap%3D%22round%22%20stroke-linejoin%3D%22round%22%20stroke-width%3D%221.5%22%20d%3D%22m6%208%204%204%204-4%22%2F%3E%3C%2Fsvg%3E')] bg-[length:1.25rem_1.25rem] rtl:bg-[left_0.75rem_center] ltr:bg-[right_0.75rem_center] rtl:ps-4 rtl:pe-10 ltr:ps-4 ltr:pe-10 bg-no-repeat";

  return (
    <div className="max-w-4xl mx-auto px-4 py-12 animate-fade-in transition-colors duration-500">
      <div className="flex items-center gap-4 mb-8">
        <div className="w-12 h-12 bg-slate-900 dark:bg-black rounded-xl flex items-center justify-center shadow-lg">
          <PlusCircle className="text-accent-500" size={24} aria-hidden="true" />
        </div>
        <div>
          <h1 className="text-3xl font-heading font-black text-slate-900 dark:text-white tracking-tight">
            {isEdit ? (isRtl ? 'تعديل الإعلان' : 'Edit listing') : (isRtl ? 'إضافة عقار جديد' : 'Add New Listing')}
          </h1>
          <p className="text-slate-500 dark:text-slate-400 font-medium">
            {isEdit
              ? (isRtl
                  ? 'تعديل السعر أو الموقع أو المستندات هيرجّع الإعلان لحالة «لم تتم المراجعة».'
                  : 'Changing the price, location or documents sends this listing back to “not reviewed”.')
              : (isRtl ? 'إضافة العقار مجانية.' : 'Posting a listing is free.')}
          </p>
        </div>
      </div>

      <div className="mb-8 flex flex-col md:flex-row gap-4 justify-between relative" role="tablist" aria-label={isRtl ? 'خطوات إضافة العقار' : 'Listing creation steps'}>
         <div className="absolute top-1/2 left-0 w-full h-1 bg-slate-200 dark:bg-slate-800 -z-10 hidden md:block rounded-full"></div>
         <div className="absolute top-1/2 start-0 h-1 bg-brand-500 transition-all duration-500 -z-10 hidden md:block rounded-full" style={{ width: `${(step - 1) * 50}%`}}></div>
         {steps.map(s => (
             <div
               key={s.id}
               role="tab"
               tabIndex={0}
               aria-selected={step === s.id}
               aria-label={s.title}
               onClick={() => goToStep(s.id)}
               onKeyDown={(e) => {
                 if (e.key === 'Enter' || e.key === ' ') {
                   e.preventDefault();
                   goToStep(s.id);
                 }
               }}
               className={`flex items-center gap-3 px-6 py-3 rounded-full cursor-pointer transition-all focus:ring-2 focus:ring-brand-500 outline-none ${step === s.id ? 'bg-brand-600 text-white shadow-lg scale-105' : step > s.id ? 'bg-brand-100 dark:bg-brand-900/40 text-brand-700 dark:text-brand-300' : 'bg-slate-100 dark:bg-slate-800 text-slate-500'}`}
             >
                 <s.icon size={18} aria-hidden="true" />
                 <span className="font-bold text-sm">{s.title}</span>
                 {step > s.id && <CheckCircle size={16} className="ms-2" aria-hidden="true" />}
             </div>
         ))}
      </div>

      {errorMsg && (
        <div className="mb-6 flex items-start gap-3 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 text-red-700 dark:text-red-300 px-5 py-4 rounded-2xl animate-fade-in">
          <X size={18} className="mt-0.5 shrink-0" />
          <p className="text-sm font-bold">{errorMsg}</p>
        </div>
      )}

      <div className="bg-white dark:bg-slate-900 p-8 rounded-3xl border border-slate-200 dark:border-slate-800 shadow-xl min-h-[400px]">
        {step === 1 && (
            <div className="space-y-6 animate-fade-in">
                <div className="bg-gradient-to-br from-brand-50 to-accent-50 dark:from-brand-900/20 dark:to-accent-900/10 border border-brand-200 dark:border-brand-800 rounded-2xl p-5">
                  <div className="flex items-start gap-3">
                    <Wand2 className="text-brand-600 dark:text-brand-400 shrink-0 mt-0.5" size={22} />
                    <div className="flex-1">
                      <h3 className="font-bold text-slate-900 dark:text-white">{isRtl ? '✨ استيراد ذكي من بروشور' : '✨ AI Import from Brochure'}</h3>
                      <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5 leading-relaxed">{isRtl ? 'ارفع بروشور المشروع (PDF أو صورة) والذكاء الاصطناعي هيقرا كل حاجة ويملأ البيانات تلقائيًا — راجعها وعدّل قبل النشر.' : 'Upload the project brochure (PDF or image) and AI reads everything and auto-fills the fields — review before publishing.'}</p>
                      {importNote && <p className="text-xs font-bold text-brand-600 dark:text-brand-400 mt-2">{importNote}</p>}
                      <input type="file" accept="application/pdf,image/*" onChange={handleBrochureImport} className="hidden" id="brochure-import" disabled={importing} />
                      <label htmlFor="brochure-import" className={`inline-flex mt-3 items-center gap-2 px-4 py-2 rounded-xl font-bold text-sm transition-colors ${importing ? 'bg-slate-200 dark:bg-slate-700 text-slate-500 cursor-wait' : 'bg-brand-600 hover:bg-brand-700 text-white cursor-pointer'}`}>
                        {importing ? <Loader2 size={16} className="animate-spin" /> : <Upload size={16} />}
                        {importing ? (isRtl ? 'جاري القراءة والاستخراج...' : 'Reading & extracting...') : (isRtl ? 'ارفع بروشور' : 'Upload brochure')}
                      </label>
                    </div>
                  </div>
                </div>

                {/* Explicit destination: regular listing vs the Yalla Sahel coastal programme */}
                <div className={`rounded-2xl border p-4 transition-colors ${formData.yallaSahel ? 'bg-cyan-50 dark:bg-cyan-900/20 border-cyan-300 dark:border-cyan-700' : 'bg-slate-50 dark:bg-slate-800/40 border-slate-200 dark:border-slate-700'}`}>
                  <label className="flex items-start gap-3 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={formData.yallaSahel}
                      onChange={e => setFormData({ ...formData, yallaSahel: e.target.checked, propertyType: e.target.checked && formData.propertyType === 'Apartment' ? 'Chalet' : formData.propertyType })}
                      className="w-5 h-5 mt-0.5 rounded text-cyan-600 focus:ring-cyan-500 border-slate-300 shrink-0"
                    />
                    <span>
                      <span className="block font-bold text-slate-900 dark:text-white">🌊 {isRtl ? 'أضف العقار لـ «ساحل حتتي»' : 'List this under “Sahel Hettety”'}</span>
                      <span className="block text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                        {isRtl
                          ? 'للشاليهات ووحدات الساحل — هيظهر في صفحة «ساحل حتتي» بجانب العقارات العادية. سيب الخانة فاضية للعقارات العادية.'
                          : 'For coastal chalets & summer rentals — it will appear on the Sahel Hettety page as well as in normal listings. Leave unchecked for regular properties.'}
                      </span>
                    </span>
                  </label>
                </div>

                <div className="grid md:grid-cols-2 gap-6">
                    <div className="col-span-1 md:col-span-2">
                        <label htmlFor="listing-title" className="block text-sm font-bold text-slate-700 dark:text-slate-300 mb-2">{isRtl ? 'عنوان العقار' : 'Property Title'} <span className="text-red-500">*</span></label>
                        <input required id="listing-title" maxLength={199} value={formData.title} onChange={e => setFormData({...formData, title: e.target.value})} className="w-full px-4 py-3 bg-slate-50 border border-slate-200 dark:bg-slate-800 dark:border-slate-700 rounded-xl focus:ring-2 focus:ring-brand-500 outline-none transition-all text-slate-900 dark:text-white" placeholder={isRtl ? 'مثال: شقة 150م بالتجمع الخامس' : 'e.g. Luxury Villa in New Cairo'} />
                    </div>
                    <div>
                        <label htmlFor="listing-price" className="block text-sm font-bold text-slate-700 dark:text-slate-300 mb-2">{isRtl ? 'السعر' : 'Price'} <span className="text-red-500">*</span></label>
                        <div className="flex gap-2">
                          <input required type="text" inputMode="numeric" id="listing-price" value={formData.price} onChange={e => { const val = toLatinDigits(e.target.value).replace(/[^0-9]/g, ''); setFormData({...formData, price: val}); }} className="flex-1 px-4 py-3 bg-slate-50 border border-slate-200 dark:bg-slate-800 dark:border-slate-700 rounded-xl focus:ring-2 focus:ring-brand-500 outline-none transition-all text-slate-900 dark:text-white" placeholder="0" />
                          <select value={formData.currency} onChange={e => setFormData({...formData, currency: e.target.value as 'EGP' | 'USD'})} className="px-3 py-3 bg-slate-50 border border-slate-200 dark:bg-slate-800 dark:border-slate-700 rounded-xl focus:ring-2 focus:ring-brand-500 outline-none text-slate-900 dark:text-white font-bold">
                            <option value="EGP">{isRtl ? 'ج.م' : 'EGP'}</option>
                            <option value="USD">USD</option>
                          </select>
                        </div>
                        {formattedPrice && <p className="text-xs font-bold text-brand-600 dark:text-brand-400 mt-1.5">{formattedPrice} {formData.currency === 'USD' ? 'USD' : (isRtl ? 'جنيه' : 'EGP')}</p>}
                    </div>
                    <div>
                        <label htmlFor="listing-location" className="block text-sm font-bold text-slate-700 dark:text-slate-300 mb-2">{isRtl ? 'الموقع' : 'Location'} <span className="text-red-500">*</span></label>
                        <input required id="listing-location" value={formData.location} onChange={e => setFormData({...formData, location: e.target.value})} className="w-full px-4 py-3 bg-slate-50 border border-slate-200 dark:bg-slate-800 dark:border-slate-700 rounded-xl focus:ring-2 focus:ring-brand-500 outline-none transition-all text-slate-900 dark:text-white" placeholder={isRtl ? 'مثال: التجمع الخامس، القاهرة' : 'e.g. New Cairo, Cairo'} />
                    </div>
                </div>

                <div className="grid grid-cols-2 md:grid-cols-4 gap-6">
                    <div>
                        <label htmlFor="listing-beds" className="block text-sm font-bold text-slate-700 dark:text-slate-300 mb-2">{isRtl ? 'الغرف' : 'Beds'}</label>
                        <input required type="number" min="0" id="listing-beds" value={formData.bedrooms} onChange={e => setFormData({...formData, bedrooms: e.target.value})} className="w-full px-4 py-3 bg-slate-50 border border-slate-200 dark:bg-slate-800 dark:border-slate-700 rounded-xl focus:ring-2 focus:ring-brand-500 outline-none text-slate-900 dark:text-white" />
                    </div>
                    <div>
                        <label htmlFor="listing-baths" className="block text-sm font-bold text-slate-700 dark:text-slate-300 mb-2">{isRtl ? 'الحمامات' : 'Baths'}</label>
                        <input required type="number" min="0" id="listing-baths" value={formData.bathrooms} onChange={e => setFormData({...formData, bathrooms: e.target.value})} className="w-full px-4 py-3 bg-slate-50 border border-slate-200 dark:bg-slate-800 dark:border-slate-700 rounded-xl focus:ring-2 focus:ring-brand-500 outline-none text-slate-900 dark:text-white" />
                    </div>
                    <div>
                        <label htmlFor="listing-area" className="block text-sm font-bold text-slate-700 dark:text-slate-300 mb-2">{isRtl ? 'المساحة من (م²)' : 'Area from (m²)'} <span className="text-red-500">*</span></label>
                        <input required type="number" min="1" id="listing-area" value={formData.area} onChange={e => setFormData({...formData, area: e.target.value})} className="w-full px-4 py-3 bg-slate-50 border border-slate-200 dark:bg-slate-800 dark:border-slate-700 rounded-xl focus:ring-2 focus:ring-brand-500 outline-none text-slate-900 dark:text-white" />
                    </div>
                    <div>
                        <label htmlFor="listing-area-to" className="block text-sm font-bold text-slate-700 dark:text-slate-300 mb-2">{isRtl ? 'إلى (اختياري)' : 'to (optional)'}</label>
                        <input type="number" min="0" id="listing-area-to" value={formData.areaTo} onChange={e => setFormData({...formData, areaTo: e.target.value})} className="w-full px-4 py-3 bg-slate-50 border border-slate-200 dark:bg-slate-800 dark:border-slate-700 rounded-xl focus:ring-2 focus:ring-brand-500 outline-none text-slate-900 dark:text-white" placeholder={isRtl ? 'للمشاريع' : 'for projects'} />
                    </div>
                </div>

                {/* Multi-unit projects: one listing per unit type */}
                {/* Always available when creating: the Add button used to live inside
                    this block, so the only way to get a first unit type was the AI
                    import. Hidden while editing — one listing is being changed, not
                    fanned out into several. */}
                {!isEdit && (
                  <div className="bg-brand-50/60 dark:bg-brand-900/10 border border-brand-200 dark:border-brand-800 rounded-2xl p-5">
                    <div className="flex justify-between items-start mb-3 gap-3">
                      <div>
                        <h3 className="font-bold text-slate-900 dark:text-white flex items-center gap-2"><Box size={18} className="text-brand-500" /> {isRtl ? `أنواع الوحدات (${unitVariants.length})` : `Unit Types (${unitVariants.length})`}</h3>
                        <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">{isRtl ? 'هيتنشر إعلان منفصل لكل نوع — بنفس بيانات المشروع والصور والأمنيتيز وخطط السداد.' : 'One listing per type will be published — sharing the project data, media, amenities & payment plans.'}</p>
                      </div>
                      <button type="button" onClick={() => setUnitVariants(prev => [...prev, { title: '', propertyType: 'Apartment', bedrooms: '', bathrooms: '', area: '', areaTo: '', price: '' }])} className="shrink-0 text-xs bg-brand-600 hover:bg-brand-700 text-white px-3 py-1.5 rounded-lg font-bold flex items-center gap-1"><PlusCircle size={14} /> {isRtl ? 'أضف' : 'Add'}</button>
                    </div>
                    {unitVariants.length === 0 && (
                      <p className="text-sm text-slate-600 dark:text-slate-300 bg-white dark:bg-slate-900 border border-dashed border-brand-300 dark:border-brand-800 rounded-xl px-4 py-3">
                        {isRtl
                          ? 'عندك مشروع فيه أكتر من مساحة أو أكتر من نوع؟ دوس «أضف» وسجّل كل نوع بمساحته وسعره. هيتنشر إعلان لكل نوع، وكلهم هيتجمعوا في صفحة المشروع — الشقق مع بعض والفلل مع بعض. لازم تملا «الكمبوند / المشروع» في تبويب المعلومات الأساسية عشان يتجمعوا.'
                          : 'Project with several sizes or unit types? Press Add and enter each one with its area and price. A listing is published per type and they group on the project page — apartments together, villas together. Fill in Compound / Project on the Basic Info step so they group.'}
                      </p>
                    )}
                    <div className="space-y-2">
                      {unitVariants.map((v, i) => (
                        <div key={i} className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-6 gap-2 items-center bg-white dark:bg-slate-900 p-2.5 rounded-xl border border-slate-100 dark:border-slate-800 shadow-sm">
                          <input value={v.title} onChange={e => setUnitVariants(prev => prev.map((x, idx) => idx === i ? { ...x, title: e.target.value } : x))} placeholder={isRtl ? 'الاسم' : 'Label'} aria-label={isRtl ? `اسم النموذج ${i + 1}` : `Unit label ${i + 1}`} className="px-2 py-1.5 text-sm rounded-lg border border-slate-200 dark:border-slate-700 bg-transparent text-slate-900 dark:text-white" />
                          <select value={v.propertyType} onChange={e => setUnitVariants(prev => prev.map((x, idx) => idx === i ? { ...x, propertyType: e.target.value } : x))} aria-label={isRtl ? `نوع العقار ${i + 1}` : `Property type ${i + 1}`} className="px-2 py-1.5 text-sm rounded-lg border border-slate-200 dark:border-slate-700 bg-transparent text-slate-900 dark:text-white">
                            {PROPERTY_TYPES.map(o => <option key={o.value} value={o.value}>{isRtl ? o.ar : o.en}</option>)}
                          </select>
                          <input type="number" value={v.bedrooms} onChange={e => setUnitVariants(prev => prev.map((x, idx) => idx === i ? { ...x, bedrooms: e.target.value } : x))} placeholder={isRtl ? 'غرف' : 'Beds'} aria-label={isRtl ? `عدد الغرف ${i + 1}` : `Bedrooms ${i + 1}`} className="px-2 py-1.5 text-sm rounded-lg border border-slate-200 dark:border-slate-700 bg-transparent text-slate-900 dark:text-white" />
                          <div className="flex gap-1">
                            <input type="number" value={v.area} onChange={e => setUnitVariants(prev => prev.map((x, idx) => idx === i ? { ...x, area: e.target.value } : x))} placeholder={isRtl ? 'م²' : 'm²'} aria-label={isRtl ? `المساحة من ${i + 1}` : `Area from ${i + 1}`} className="w-full min-w-0 px-2 py-1.5 text-sm rounded-lg border border-slate-200 dark:border-slate-700 bg-transparent text-slate-900 dark:text-white" />
                            <input type="number" value={v.areaTo} onChange={e => setUnitVariants(prev => prev.map((x, idx) => idx === i ? { ...x, areaTo: e.target.value } : x))} placeholder={isRtl ? 'إلى' : 'to'} aria-label={isRtl ? `المساحة إلى ${i + 1}` : `Area to ${i + 1}`} className="w-full min-w-0 px-2 py-1.5 text-sm rounded-lg border border-slate-200 dark:border-slate-700 bg-transparent text-slate-900 dark:text-white" />
                          </div>
                          <input type="text" inputMode="numeric" value={v.price} onChange={e => setUnitVariants(prev => prev.map((x, idx) => idx === i ? { ...x, price: toLatinDigits(e.target.value).replace(/[^0-9]/g, '') } : x))} placeholder={isRtl ? 'السعر' : 'Price'} aria-label={isRtl ? `السعر ${i + 1}` : `Price ${i + 1}`} className="px-2 py-1.5 text-sm rounded-lg border border-slate-200 dark:border-slate-700 bg-transparent text-slate-900 dark:text-white" />
                          <button type="button" onClick={() => setUnitVariants(prev => prev.filter((_, idx) => idx !== i))} aria-label={isRtl ? `حذف النموذج ${i + 1}` : `Delete unit variant ${i + 1}`} className="text-red-500 hover:text-red-600 justify-self-end p-2 min-w-[36px] min-h-[36px] flex items-center justify-center cursor-pointer"><X size={16} aria-hidden="true" /></button>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                <div className="grid md:grid-cols-2 gap-6">
                    <div>
                       <label className="block text-sm font-bold text-slate-700 dark:text-slate-300 mb-2">{isRtl ? 'الحالة' : 'Status'}</label>
                       <select value={formData.status} onChange={e => setFormData({...formData, status: e.target.value})} className={selectCls}>
                         <option value="For Sale">{isRtl ? 'للبيع' : 'For Sale'}</option>
                         <option value="For Rent">{isRtl ? 'للإيجار' : 'For Rent'}</option>
                       </select>
                    </div>
                    <div>
                       <label className="block text-sm font-bold text-slate-700 dark:text-slate-300 mb-2">{isRtl ? 'حالة التوفر' : 'Availability'}</label>
                       <select value={formData.availability} onChange={e => setFormData({...formData, availability: e.target.value as 'Available' | 'Sold' | 'Reserved'})} className={selectCls}>
                         <option value="Available">{isRtl ? 'متاح' : 'Available'}</option>
                         <option value="Reserved">{isRtl ? 'محجوز' : 'Reserved'}</option>
                         <option value="Sold">{formData.status === 'For Rent' ? (isRtl ? 'مؤجَّر' : 'Rented') : (isRtl ? 'مباع' : 'Sold')}</option>
                       </select>
                    </div>
                </div>

                <div className="grid md:grid-cols-2 gap-6">
                    <div>
                       <label className={labelCls}>{isRtl ? 'نوع العقار' : 'Property Type'}</label>
                       <select value={formData.propertyType} onChange={e => setFormData({...formData, propertyType: e.target.value})} className={selectCls}>
                         {PROPERTY_TYPES.map(o => <option key={o.value} value={o.value}>{isRtl ? o.ar : o.en}</option>)}
                       </select>
                    </div>
                    <div>
                       <label className={labelCls}>{isRtl ? 'رقم التواصل (اتصال + واتساب)' : 'Contact Phone (call + WhatsApp)'}</label>
                       <input type="tel" maxLength={29} value={formData.contactPhone} onChange={e => setFormData({...formData, contactPhone: toLatinDigits(e.target.value)})} className={inputCls} placeholder="+20 1XX XXX XXXX" dir="ltr" />
                    </div>
                </div>

                <div className="pt-4 border-t border-slate-100 dark:border-slate-800">
                    <p className="text-sm font-bold text-slate-700 dark:text-slate-300 mb-3">{isRtl ? 'تفاصيل إضافية (اختياري)' : 'Extra details (optional)'}</p>
                    <div className="grid md:grid-cols-2 gap-6 mb-6">
                      <div>
                        <label htmlFor="listing-compound" className={labelCls}>{isRtl ? 'الكمبوند / المشروع' : 'Compound / Project'}</label>
                        <input id="listing-compound" maxLength={119} value={formData.compound} onChange={e => setFormData({...formData, compound: e.target.value})} className={inputCls} placeholder={isRtl ? 'مثال: ماونتن فيو iCity' : 'e.g. Mountain View iCity'} />
                      </div>
                      <div>
                        <label htmlFor="listing-developer" className={labelCls}>{isRtl ? 'المطوّر' : 'Developer'}</label>
                        <input id="listing-developer" maxLength={119} value={formData.developer} onChange={e => setFormData({...formData, developer: e.target.value})} className={inputCls} placeholder={isRtl ? 'مثال: ماونتن فيو' : 'e.g. Mountain View'} />
                      </div>
                    </div>
                    <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
                      <div>
                        <label className={labelCls}>{isRtl ? 'الاستلام' : 'Delivery'}</label>
                        <input maxLength={49} value={formData.deliveryDate} onChange={e => setFormData({...formData, deliveryDate: e.target.value})} className={inputCls} placeholder={isRtl ? 'جاهز / 2027' : 'Ready / 2027'} />
                      </div>
                      <div>
                        <label className={labelCls}>{isRtl ? 'التشطيب' : 'Finishing'}</label>
                        <select value={formData.finishing} onChange={e => setFormData({...formData, finishing: e.target.value})} className={selectCls}>
                          {FINISHING_OPTIONS.map(o => <option key={o.value} value={o.value}>{isRtl ? o.ar : o.en}</option>)}
                        </select>
                      </div>
                      <div>
                        <label className={labelCls}>{isRtl ? 'الدور' : 'Floor'}</label>
                        <input maxLength={29} value={formData.floor} onChange={e => setFormData({...formData, floor: e.target.value})} className={inputCls} placeholder={isRtl ? 'أرضي / 3' : 'Ground / 3'} />
                      </div>
                      <div>
                        <label className={labelCls}>{isRtl ? 'الفيو' : 'View'}</label>
                        <input maxLength={59} value={formData.view} onChange={e => setFormData({...formData, view: e.target.value})} className={inputCls} placeholder={isRtl ? 'حديقة / بحر' : 'Garden / Sea'} />
                      </div>
                    </div>
                    <div className="grid grid-cols-2 lg:grid-cols-3 gap-4 mt-4">
                      <div>
                        <label className={labelCls}>{isRtl ? 'نظام السعر' : 'Price basis'}</label>
                        <select value={formData.pricePeriod} onChange={e => setFormData({...formData, pricePeriod: e.target.value as any})} className={selectCls}>
                          <option value="total">{isRtl ? 'إجمالي' : 'Total'}</option>
                          <option value="night">{isRtl ? 'لليلة' : 'Per night'}</option>
                          <option value="week">{isRtl ? 'للأسبوع' : 'Per week'}</option>
                          <option value="month">{isRtl ? 'للشهر' : 'Per month'}</option>
                        </select>
                      </div>
                      <div>
                        <label className={labelCls}>{isRtl ? 'عدد الأفراد' : 'Sleeps (guests)'}</label>
                        <input type="number" min="0" value={formData.guests} onChange={e => setFormData({...formData, guests: e.target.value})} className={inputCls} placeholder={isRtl ? 'مثال: 6' : 'e.g. 6'} />
                      </div>
                      <div>
                        <label className={labelCls}>{isRtl ? 'القرية / المنتجع' : 'Village / Resort'}</label>
                        <input maxLength={119} value={formData.village} onChange={e => setFormData({...formData, village: e.target.value})} className={inputCls} placeholder={isRtl ? 'مثال: مراسي، هاسيندا' : 'e.g. Marassi, Hacienda'} />
                      </div>
                    </div>
                    <label className="flex items-center gap-3 cursor-pointer mt-4 w-fit">
                      <input type="checkbox" checked={formData.furnished} onChange={e => setFormData({...formData, furnished: e.target.checked})} className="w-5 h-5 rounded text-brand-600 focus:ring-brand-500 border-slate-300" />
                      <span className="text-sm font-bold text-slate-700 dark:text-slate-300">{isRtl ? 'مفروش' : 'Furnished'}</span>
                    </label>

                    <div className="mt-6">
                      <label className="block text-sm font-bold text-slate-700 dark:text-slate-300 mb-2">{isRtl ? 'المميزات والخدمات' : 'Amenities'}</label>
                      <div className="flex flex-wrap gap-2">
                        {AMENITIES.map(a => {
                          const on = amenities.includes(a.value);
                          return (
                            <button type="button" key={a.value} onClick={() => toggleAmenity(a.value)} className={`px-3 py-1.5 rounded-lg text-xs font-bold border transition-all ${on ? 'bg-brand-600 text-white border-brand-600 shadow-sm' : 'bg-slate-50 dark:bg-slate-800 text-slate-600 dark:text-slate-300 border-slate-200 dark:border-slate-700 hover:border-brand-400'}`}>
                              {on && '✓ '}{isRtl ? a.ar : a.en}
                            </button>
                          );
                        })}
                      </div>
                    </div>
                </div>

                <div className="pt-4 border-t border-slate-100 dark:border-slate-800">
                    <label className="block text-sm font-bold text-slate-700 dark:text-slate-300 mb-3">{isRtl ? 'طرق الدفع المتاحة' : 'Accepted Payment Methods'} <span className="text-red-500">*</span></label>
                    <div className="flex flex-wrap gap-3">
                      {PAYMENT_OPTIONS.map(opt => {
                        const active = paymentMethods.includes(opt.value);
                        return (
                          <button
                            type="button"
                            key={opt.value}
                            onClick={() => togglePayment(opt.value)}
                            className={`px-5 py-2.5 rounded-xl text-sm font-bold border transition-all flex items-center gap-2 ${active ? 'bg-brand-600 text-white border-brand-600 shadow-md' : 'bg-slate-50 dark:bg-slate-800 text-slate-600 dark:text-slate-300 border-slate-200 dark:border-slate-700 hover:border-brand-400'}`}
                          >
                            {active && <CheckCircle size={15} />}
                            {isRtl ? opt.ar : opt.en}
                          </button>
                        );
                      })}
                    </div>
                </div>

                <div className="pt-4 border-t border-slate-100 dark:border-slate-800">
                    <div className="flex justify-between items-center mb-3">
                      <label className="text-sm font-bold text-slate-700 dark:text-slate-300">{isRtl ? 'خطط السداد (اختياري)' : 'Payment Plans (optional)'}</label>
                      <button type="button" disabled={paymentPlans.length >= MAX_PAYMENT_PLANS} onClick={() => setPaymentPlans(prev => prev.length >= MAX_PAYMENT_PLANS ? prev : [...prev, { downPayment: '', years: '', note: '' }])} className="text-xs bg-brand-100 dark:bg-brand-900/30 text-brand-700 dark:text-brand-300 px-3 py-1 rounded-lg font-bold flex items-center gap-1 disabled:opacity-40 cursor-pointer"><PlusCircle size={14} aria-hidden="true" /> {isRtl ? 'أضف خطة' : 'Add plan'}</button>
                    </div>
                    {paymentPlans.length === 0 && <p className="text-xs text-slate-400 dark:text-slate-500">{isRtl ? 'مثال: 10% مقدم وتقسيط على 8 سنين مع خصم 10%.' : 'e.g. 10% down, 8 years, 10% discount.'}</p>}
                    <div className="space-y-3">
                      {paymentPlans.map((pl, i) => (
                        <div key={i} className="flex flex-wrap items-center gap-2 bg-slate-50 dark:bg-slate-800/50 p-3 rounded-xl">
                          <div className="flex items-center gap-1">
                            <input type="number" min="0" max="100" value={pl.downPayment} onChange={e => setPaymentPlans(prev => prev.map((p, idx) => idx === i ? { ...p, downPayment: e.target.value } : p))} className="w-16 px-2 py-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-center text-slate-900 dark:text-white" placeholder="10" />
                            <span className="text-sm text-slate-500">% {isRtl ? 'مقدم' : 'down'}</span>
                          </div>
                          <div className="flex items-center gap-1">
                            <input type="number" min="0" value={pl.years} onChange={e => setPaymentPlans(prev => prev.map((p, idx) => idx === i ? { ...p, years: e.target.value } : p))} className="w-16 px-2 py-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-center text-slate-900 dark:text-white" placeholder="8" />
                            <span className="text-sm text-slate-500">{isRtl ? 'سنة' : 'yrs'}</span>
                          </div>
                          <input value={pl.note} onChange={e => setPaymentPlans(prev => prev.map((p, idx) => idx === i ? { ...p, note: e.target.value } : p))} className="flex-1 min-w-[120px] px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-900 dark:text-white text-sm" placeholder={isRtl ? 'ملاحظة (مثال: خصم 10%)' : 'note (e.g. 10% discount)'} />
                          <button type="button" onClick={() => setPaymentPlans(prev => prev.filter((_, idx) => idx !== i))} aria-label={isRtl ? `حذف خطة الدفع ${i + 1}` : `Delete payment plan ${i + 1}`} className="text-red-500 hover:text-red-600 p-2 min-w-[36px] min-h-[36px] flex items-center justify-center cursor-pointer"><X size={16} aria-hidden="true" /></button>
                        </div>
                      ))}
                    </div>
                </div>

                <div className="pt-4 border-t border-slate-100 dark:border-slate-800">
                    <div className="flex justify-between items-center mb-2">
                        <label className="block text-sm font-bold text-slate-700 dark:text-slate-300">{isRtl ? 'الوصف' : 'Description'}</label>
                        <button type="button" onClick={generateDescription} disabled={generatingDesc} className="text-xs bg-brand-100 hover:bg-brand-200 text-brand-700 dark:bg-brand-900/30 dark:hover:bg-brand-900/50 dark:text-brand-300 px-3 py-1 rounded-lg font-bold flex items-center gap-1 transition-colors">
                            {generatingDesc ? <Loader2 size={12} className="animate-spin" /> : <Wand2 size={12} />}
                            {isRtl ? 'ذكاء اصطناعي' : 'Auto AI'}
                        </button>
                    </div>
                    <textarea rows={4} value={formData.description} onChange={e => setFormData({...formData, description: e.target.value})} className="w-full px-4 py-3 bg-slate-50 border border-slate-200 dark:bg-slate-800 dark:border-slate-700 rounded-xl focus:ring-2 focus:ring-brand-500 outline-none text-slate-900 dark:text-white" placeholder={isRtl ? 'وصف العقار...' : 'Property description...'}></textarea>
                </div>
            </div>
        )}

        {step === 2 && (
            <div className="space-y-6 animate-fade-in">
                <div>
                  <label className="block text-sm font-bold text-slate-700 dark:text-slate-300 mb-1">{isRtl ? 'صور العقار' : 'Property Images'}</label>
                  <p className="text-xs text-slate-500 dark:text-slate-400 mb-2">{isRtl ? 'الصور بتظهر في الجولة ثلاثية الأبعاد 360° — كل ما ترفع صور أكتر للغرف، الجولة تبقى أحلى. أول صورة هي الرئيسية.' : 'Photos power the 360° 3D tour — the more rooms you add, the better the tour. The first photo is the cover.'}</p>
                  <div 
                     onDragOver={(e) => { e.preventDefault(); e.stopPropagation(); }}
                     onDrop={handleDrop}
                     className={`relative group border-2 border-dashed rounded-3xl p-8 text-center transition-all ${uploading ? 'bg-slate-50 dark:bg-slate-800/50 border-slate-200 dark:border-slate-700' : 'bg-slate-50 dark:bg-slate-800/30 border-slate-300 dark:border-slate-700 hover:border-brand-500 hover:bg-white dark:hover:bg-slate-800'}`}
                  >
                     <input type="file" multiple accept="image/*" onChange={handleImageUpload} className="hidden" id="multi-image-upload" disabled={uploading}/>
                     <label htmlFor="multi-image-upload" className="cursor-pointer block">
                         <Upload className="text-slate-400 mx-auto mb-4 group-hover:text-brand-500 transition-colors" size={40} />
                         <h3 className="text-lg font-bold text-slate-700 dark:text-slate-300 mb-1">{isRtl ? 'اسحب وأفلت الصور هنا' : 'Drag & Drop Images here'}</h3>
                         <p className="text-sm font-medium text-slate-500 dark:text-slate-400">{isRtl ? 'أو انقر للاستعراض' : 'or click to browse'}</p>
                     </label>
                     {uploading && (
                         <div className="absolute bottom-4 left-8 right-8">
                             <div className="h-2 bg-slate-200 dark:bg-slate-700 rounded-full overflow-hidden">
                                 <div className="h-full bg-brand-600 transition-all duration-300" style={{ width: `${uploadProgress}%`}}></div>
                             </div>
                             <p className="text-xs font-bold text-slate-600 dark:text-slate-400 mt-2">{uploadProgress}%</p>
                         </div>
                     )}
                  </div>

                  {images.length > 0 && (
                      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mt-6">
                          {images.map((img, i) => (
                              <div key={i} className="relative aspect-square rounded-2xl overflow-hidden border border-slate-200 dark:border-slate-700 shadow-sm group">
                                  <img src={img} className="w-full h-full object-cover transition-transform group-hover:scale-110" alt="Preview"/>
                                  <button onClick={() => {
                                      const removed = images[i];
                                      const next = images.filter((_, idx) => idx !== i);
                                      setImages(next);
                                      // keep the main image in sync when it gets deleted
                                      if (formData.imageUrl === removed) {
                                        setFormData(prev => ({ ...prev, imageUrl: next[0] || '' }));
                                      }
                                  }} aria-label={isRtl ? `حذف الصورة ${i + 1}` : `Delete image ${i + 1}`} className="absolute top-2 end-2 bg-red-500 text-white p-1.5 rounded-full opacity-0 group-hover:opacity-100 focus:opacity-100 transition-opacity shadow-md hover:bg-red-600 min-w-[32px] min-h-[32px] flex items-center justify-center cursor-pointer">
                                      <X size={14} aria-hidden="true" />
                                  </button>
                                  {i === 0 ? (
                                    <span className="absolute bottom-2 start-2 bg-brand-600 text-white text-[10px] uppercase font-bold px-2 py-0.5 rounded shadow">{isRtl ? 'الرئيسية' : 'Main'}</span>
                                  ) : (
                                    <button
                                      onClick={() => {
                                        setImages(prev => { const arr = [...prev]; const [it] = arr.splice(i, 1); arr.unshift(it); return arr; });
                                        setFormData(prev => ({ ...prev, imageUrl: img }));
                                      }}
                                      className="absolute bottom-2 start-2 bg-black/70 hover:bg-brand-600 text-white text-[10px] font-bold px-2 py-0.5 rounded shadow opacity-0 group-hover:opacity-100 transition-opacity"
                                    >
                                      {isRtl ? 'اجعلها الرئيسية' : 'Set as cover'}
                                    </button>
                                  )}
                              </div>
                          ))}
                      </div>
                  )}
                </div>

                <div className="pt-6 border-t border-slate-100 dark:border-slate-800">
                  <label className="block text-sm font-bold text-slate-700 dark:text-slate-300 mb-2">
                    <div className="flex items-center gap-2 mb-1">
                      <PlayCircle size={18} className="text-accent-500" />
                      {isRtl ? 'فيديو العقار' : 'Property Video'}
                    </div>
                  </label>
                  <div className="relative group">
                    <input
                      type="file"
                      accept="video/*"
                      onChange={handleVideoUpload}
                      className="hidden"
                      id="video-upload"
                      disabled={uploading}
                    />
                    <label 
                      htmlFor="video-upload" 
                      className={`flex flex-col items-center justify-center w-full h-32 border-2 border-dashed rounded-2xl cursor-pointer transition-all ${
                        formData.videoUrl ? 'bg-slate-50 dark:bg-slate-800/50 border-slate-200 dark:border-slate-700' : 'bg-slate-50 dark:bg-slate-800/30 border-slate-300 dark:border-slate-700 hover:border-brand-500 hover:bg-white dark:hover:bg-slate-800'
                      }`}
                    >
                      {formData.videoUrl ? (
                         <div className="text-center">
                            <PlayCircle className="text-brand-500 mx-auto mb-2" size={32} />
                            <p className="text-sm font-bold text-brand-600 dark:text-brand-400">{isRtl ? 'تم إرفاق الفيديو بنجاح (انقر لتغيير)' : 'Video Attached Successfully (Click to Change)'}</p>
                         </div>
                      ) : (
                         <div className="text-center p-4">
                            <Upload className="text-slate-400 mx-auto mb-2 group-hover:text-brand-500 transition-colors" size={32} />
                            <p className="text-sm font-bold text-slate-700 dark:text-slate-300">{isRtl ? 'انقر لرفع فيديو' : 'Click to Upload Video'}</p>
                            <p className="text-xs text-slate-500 mt-1">{isRtl ? 'الحد الأقصى 50 ميجابايت' : 'Max size 50MB'}</p>
                         </div>
                      )}
                    </label>
                  </div>
                </div>

                {/* 360° panoramas */}
                <div className="pt-6 border-t border-slate-100 dark:border-slate-800">
                  <label className="block text-sm font-bold text-slate-700 dark:text-slate-300 mb-1">
                    <div className="flex items-center gap-2">
                      <Box size={18} className="text-brand-500" />
                      {isRtl ? 'صور بانوراما 360°' : '360° Panorama Photos'}
                    </div>
                  </label>
                  <p className="text-xs text-slate-500 dark:text-slate-400 mb-2">
                    {isRtl
                      ? 'صور بزاوية 360 (من كاميرا 360 أو وضع البانوراما) — هتظهر كجولة تلف جواها 360 درجة.'
                      : 'Equirectangular 360° shots (from a 360 camera or panorama mode) — shown as a look-around tour.'}
                  </p>
                  {/* Flat photos cannot be toured. This is the field that makes a
                      listing genuinely walkable, so say how to fill it. */}
                  <p className="text-xs text-slate-600 dark:text-slate-300 bg-white dark:bg-slate-900 border border-dashed border-brand-300 dark:border-brand-800 rounded-xl px-4 py-3 mb-3">
                    {isRtl
                      ? 'دي الحاجة الوحيدة اللي بتخلّي المشتري يلف جوّه الوحدة فعلاً. صوّرها بتطبيق مجاني زي Google Street View أو Polycam — بيلفّ حوالين نفسه ويطلّع صورة كروية. الصورة العادية مهما كانت حلوة مش بتديك جولة.'
                      : 'This is the only thing that lets a buyer actually stand inside the unit. Shoot one with a free phone app — Google Street View or Polycam — which spins around and produces a spherical photo. A flat photo, however good, cannot be toured.'}
                  </p>
                  <input type="file" multiple accept="image/*" onChange={handlePanoramaUpload} className="hidden" id="panorama-upload" disabled={uploading} />
                  <label htmlFor="panorama-upload" className="flex flex-col items-center justify-center w-full h-28 border-2 border-dashed rounded-2xl cursor-pointer transition-all bg-slate-50 dark:bg-slate-800/30 border-slate-300 dark:border-slate-700 hover:border-brand-500 hover:bg-white dark:hover:bg-slate-800 group">
                    <Box className="text-slate-400 mb-2 group-hover:text-brand-500 transition-colors" size={28} />
                    <p className="text-sm font-bold text-slate-700 dark:text-slate-300">{isRtl ? 'انقر لرفع صور 360°' : 'Click to upload 360° photos'}</p>
                  </label>
                  {panoramas.length > 0 && (
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mt-4">
                      {panoramas.map((img, i) => (
                        <div key={i} className="relative aspect-video rounded-xl overflow-hidden border border-slate-200 dark:border-slate-700 group">
                          <img src={img} className="w-full h-full object-cover" alt="Panorama" />
                          <span className="absolute top-1.5 start-1.5 bg-brand-600 text-white text-[9px] font-black px-1.5 py-0.5 rounded">360°</span>
                          <button onClick={() => setPanoramas(panoramas.filter((_, idx) => idx !== i))} aria-label={isRtl ? `حذف صورة 360 رقم ${i + 1}` : `Delete 360 photo ${i + 1}`} className="absolute top-1.5 end-1.5 bg-red-500 text-white p-1 rounded-full opacity-0 group-hover:opacity-100 focus:opacity-100 transition-opacity hover:bg-red-600 cursor-pointer">
                            <X size={14} aria-hidden="true" />
                          </button>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                {/* Real virtual tour link (Matterport / Polycam / Kuula …) */}
                <div className="pt-6 border-t border-slate-100 dark:border-slate-800">
                  <label className="block text-sm font-bold text-slate-700 dark:text-slate-300 mb-1">
                    <div className="flex items-center gap-2">
                      <Globe size={18} className="text-accent-500" />
                      {isRtl ? 'رابط الجولة الافتراضية الحقيقية' : 'Real Virtual Tour Link'}
                    </div>
                  </label>
                  <p className="text-xs text-slate-500 dark:text-slate-400 mb-2">
                    {isRtl
                      ? 'صوّر الوحدة بتطبيق Matterport أو Polycam والصق اللينك هنا — هيظهر كجولة كاملة تتمشى جواها.'
                      : 'Scan the unit with Matterport or Polycam and paste the link — shown as a full walkthrough tour.'}
                  </p>
                  <input
                    type="url"
                    value={formData.digitalTwinUrl}
                    onChange={e => setFormData({ ...formData, digitalTwinUrl: e.target.value })}
                    placeholder="https://my.matterport.com/show/?m=... | https://poly.cam/capture/..."
                    className={`w-full px-4 py-3 bg-slate-50 border rounded-xl focus:ring-2 outline-none transition-all text-slate-900 dark:text-white text-sm dark:bg-slate-800 ${
                      formData.digitalTwinUrl.trim() && !isLikelyTourUrl(formData.digitalTwinUrl)
                        ? 'border-amber-400 focus:ring-amber-400 dark:border-amber-500/60'
                        : 'border-slate-200 dark:border-slate-700 focus:ring-brand-500'
                    }`}
                  />
                  {formData.digitalTwinUrl.trim() && !isLikelyTourUrl(formData.digitalTwinUrl) && (
                    <p className="text-xs text-amber-600 dark:text-amber-400 mt-1.5">
                      {isRtl ? '⚠️ اللينك لازم يكون من Matterport أو Polycam أو Kuula علشان الجولة تشتغل.' : '⚠️ Link should be a Matterport, Polycam or Kuula URL for the tour to load.'}
                    </p>
                  )}
                </div>
            </div>
        )}

        {step === 3 && (
            <div className="space-y-6 animate-fade-in">
                <div className="bg-orange-50 dark:bg-orange-500/10 border border-orange-200 dark:border-orange-500/20 p-6 rounded-3xl mb-6">
                   <h3 className="text-orange-800 dark:text-orange-300 font-bold mb-2 flex items-center gap-2"><Shield size={18} /> {isRtl ? 'الوثائق القانونية' : 'Legal Documentation'}</h3>
                   <p className="text-sm text-orange-700 dark:text-orange-400/80 mb-4 tracking-wide leading-relaxed">
                       {isRtl ? 'ارفع صورة من العقد وسيقوم الذكاء الاصطناعي باستخراج رقم الشهر العقاري.' : 'Upload a contract image and AI will extract the Registry Number.'}
                   </p>
                   
                   <div className="relative group">
                       <input type="file" accept="image/*,application/pdf" onChange={handleDocumentUpload} className="hidden" id="legal-upload" disabled={extractingOCR}/>
                       <label htmlFor="legal-upload" className="inline-flex cursor-pointer items-center justify-center bg-white dark:bg-slate-800 px-6 py-3 rounded-xl border border-orange-200 dark:border-orange-500/30 hover:border-orange-400 text-orange-700 dark:text-orange-300 font-bold transition-all shadow-sm">
                           {extractingOCR ? <Loader2 size={18} className="animate-spin me-2" /> : <Wand2 size={18} className="me-2" />}
                           {isRtl ? 'استخراج ذكي (OCR)' : 'Smart OCR Extract'}
                       </label>
                   </div>
                   {legalDocs.length > 0 && (
                     <div className="mt-4 flex flex-wrap gap-2">
                       {legalDocs.map((_, i) => (
                         <span key={i} className="inline-flex items-center gap-2 bg-white dark:bg-slate-800 border border-orange-200 dark:border-orange-500/30 text-orange-700 dark:text-orange-300 text-xs font-bold px-3 py-1.5 rounded-lg">
                           <FileText size={14} /> {isRtl ? `مستند ${i + 1}` : `Document ${i + 1}`}
                            <button onClick={() => setLegalDocs(prev => prev.filter((_, idx) => idx !== i))} aria-label={isRtl ? `حذف المستند ${i + 1}` : `Delete document ${i + 1}`} className="hover:text-red-600 p-1 focus:outline-none focus:ring-2 focus:ring-red-400 rounded cursor-pointer"><X size={14} aria-hidden="true" /></button>
                         </span>
                       ))}
                     </div>
                   )}
                </div>

                <div className="grid md:grid-cols-2 gap-6">
                    <div>
                        <label className="block text-sm font-bold text-slate-700 dark:text-slate-300 mb-2">{isRtl ? 'رقم الشهر العقاري' : 'Registry Number'}</label>
                        <input maxLength={99} value={formData.registrationNumber} onChange={e => setFormData({...formData, registrationNumber: e.target.value})} className="w-full px-4 py-3 bg-slate-50 border border-slate-200 dark:bg-slate-800 dark:border-slate-700 rounded-xl focus:ring-2 focus:ring-brand-500 outline-none text-slate-900 dark:text-white" placeholder={isRtl ? 'اختياري' : 'Optional'} />
                    </div>
                </div>
                
                <div className="flex flex-col space-y-4 pt-4">
                    <label className="flex items-center gap-3 cursor-pointer">
                        <input type="checkbox" checked={formData.courtSignatureValidity} onChange={e => setFormData({...formData, courtSignatureValidity: e.target.checked})} className="w-5 h-5 rounded text-brand-600 focus:ring-brand-500 border-slate-300" />
                        <span className="text-sm font-bold text-slate-700 dark:text-slate-300">{isRtl ? 'صحة توقيع محكمة' : 'Court Signature Validity'}</span>
                    </label>
                    <label className="flex items-center gap-3 cursor-pointer">
                        <input type="checkbox" checked={formData.isResale} onChange={e => setFormData({...formData, isResale: e.target.checked})} className="w-5 h-5 rounded text-brand-600 focus:ring-brand-500 border-slate-300" />
                        <span className="text-sm font-bold text-slate-700 dark:text-slate-300">{isRtl ? 'إعادة بيع (Resale)' : 'Resale Property'}</span>
                    </label>
                </div>
            </div>
        )}
      </div>

      <div className="mt-8 flex justify-between items-center">
         {step > 1 ? (
             <button onClick={() => goToStep(step - 1)} className="px-6 py-3 rounded-xl font-bold bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-300 shadow-sm hover:bg-slate-50 dark:hover:bg-slate-700 flex items-center gap-2 transition-all">
                 {isRtl ? <ArrowRight size={18} aria-hidden="true" /> : <ArrowLeft size={18} aria-hidden="true" />} {isRtl ? 'السابق' : 'Back'}
             </button>
         ) : <div></div>}

         {step < 3 ? (
             <button onClick={() => goToStep(step + 1)} className="px-8 py-3 rounded-xl font-bold bg-slate-900 text-white dark:bg-slate-100 dark:text-slate-900 shadow-md hover:bg-black dark:hover:bg-white flex items-center gap-2 transition-all">
                 {isRtl ? 'التالي' : 'Next'} {isRtl ? <ArrowLeft size={18} aria-hidden="true" /> : <ArrowRight size={18} aria-hidden="true" />}
             </button>
         ) : (
             <button onClick={handleSubmit} disabled={submitting || uploading || !basicsComplete} data-testid="listing-submit" className="px-8 py-3 rounded-xl font-bold bg-gradient-to-r from-accent-600 to-accent-500 text-white shadow-xl hover:shadow-2xl hover:scale-105 disabled:opacity-50 disabled:hover:scale-100 flex items-center gap-2 transition-all">
                 {submitting ? <Loader2 size={18} className="animate-spin" aria-hidden="true" /> : <CheckCircle size={18} aria-hidden="true" />}
                 {submitting ? (isRtl ? 'جاري النشر...' : 'Publishing...') : (isRtl ? 'نشر العقار' : 'Deploy Listing')}
             </button>
         )}
      </div>
    </div>
  );
};
