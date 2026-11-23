import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertCircle,
  ArrowLeft,
  ArrowRight,
  Bath,
  BedDouble,
  Box,
  Calculator,
  Calendar,
  Check,
  CheckCircle,
  ChevronLeft,
  ChevronRight,
  Compass,
  CreditCard,
  ExternalLink,
  Flag,
  Heart,
  Home,
  Info,
  Layers,
  Loader2,
  MapPin,
  Maximize,
  MessageSquare,
  Phone,
  Play,
  Plus,
  Send,
  Share2,
  Shield,
  ShieldCheck,
  Sparkles,
  Star,
  TrendingUp,
  X,
} from 'lucide-react';
import { ChatMessage, Property } from '../../../types';
import {
  addDoc,
  auth,
  collection,
  db,
  doc,
  getDocs,
  query,
  setDoc,
  where,
} from '../../../firebase';
import {
  aiErrorMessage,
  extract3DMarker,
  generateContentResilient,
} from '../../../ai';
import { lazyWithReload } from '../../../lib/lazyWithReload';
import { LoadErrorBoundary } from '../../../components/LoadErrorBoundary';
import { BrandButton } from '../../../shared/ui/BrandButton';
import { PropertyImage } from '../../../shared/ui/PropertyImage';
import {
  amenityLabel,
  availabilityInfo,
  finishingLabel,
  listingReviewInfo,
  paymentLabel,
  priceLabel,
  pricePeriodSuffix,
  pricePerSqm,
  priceProvenance,
  safeTourUrl,
  typeLabel,
} from '../../../shared/utils/propertyFormatters';

const Property3DViewer = lazyWithReload(
  () => import('../../../components/Property3DViewer'),
  'viewer3d'
);

const Loading3DFallback: React.FC<{ isRtl: boolean }> = ({ isRtl }) => (
  <div
    role="status"
    aria-live="polite"
    className="fixed inset-0 z-[70] bg-brand-950/95 backdrop-blur-md flex flex-col items-center justify-center gap-3 text-white"
  >
    <Loader2 className="w-10 h-10 text-accent-500 animate-spin" aria-hidden="true" />
    <span className="text-sm font-bold text-white/80">
      {isRtl ? 'جاري تحميل العارض ثلاثي الأبعاد...' : 'Loading 3D viewer...'}
    </span>
  </div>
);

interface ReviewEntry {
  id: string;
  propertyId: string;
  userId: string;
  userName: string;
  rating: number;
  comment: string;
  createdAt?: string;
}

export interface PropertyDetailPageProps {
  property: Property;
  onBack: () => void;
  onPurchase: (id: string) => void;
  onOpenProject?: (name: string) => void;
  onToggleFavorite?: () => void;
  isFavorited?: boolean;
  onToggleCompare?: () => void;
  isComparing?: boolean;
  t: any;
  isRtl: boolean;
}

/**
 * Generates an honest, context-aware local reply if the remote AI service is
 * unavailable, so visitors always get actionable unit facts and can still
 * trigger the 3D tour from chat.
 */
function buildLocalFallbackReply(
  userText: string,
  property: Property,
  t: any,
  isRtl: boolean,
  err: unknown
): { text: string; open3D: boolean } {
  const lower = userText.toLowerCase();
  const currency = property.currency || 'EGP';
  const ppm = pricePerSqm(property);
  const reviewInfo = listingReviewInfo(property, t);

  if (/(3d|360|tour|walkthrough|مجسم|جولة|تلاتي|ثلاثي|معاينة|warini|sha2a)/i.test(lower)) {
    return {
      open3D: true,
      text: isRtl
        ? `تم فتح العارض التفاعلي للوحدة "${property.title}" مباشرةً! يمكنك تدوير المشهد واستكشاف التفاصيل الآن.`
        : `Launching the interactive viewer for "${property.title}" right now! Feel free to orbit and explore.`,
    };
  }

  if (/(price|meter|sqm|m²|سعر|المتر|متر|قيمة|value|invest|استثمار)/i.test(lower)) {
    if (property.price > 0 && ppm !== null) {
      return {
        open3D: false,
        text: isRtl
          ? `ملخص السعر لهذه الوحدة (${property.title}):\n• السعر المعلن: ${property.price.toLocaleString()} ${currency}${pricePeriodSuffix(property.pricePeriod, true)}\n• المساحة: ${property.area} م²\n• متوسط سعر المتر: ${ppm.toLocaleString()} ${currency} / م²\n• الموقع: ${property.location}${property.compound ? ` — ${property.compound}` : ''}\n\n(الرد محسوب محلياً من بيانات الإعلان لأن خدمة الذكاء الاصطناعي مشغولة حالياً.)`
          : `Price breakdown for ${property.title}:\n• Listed price: ${property.price.toLocaleString()} ${currency}${pricePeriodSuffix(property.pricePeriod, false)}\n• Area: ${property.area} m²\n• Price per m²: ${ppm.toLocaleString()} ${currency} / m²\n• Location: ${property.location}${property.compound ? ` — ${property.compound}` : ''}\n\n(Computed directly from this listing's data while the live AI service is temporarily unavailable.)`,
      };
    }
    const prov = priceProvenance(property, isRtl);
    return {
      open3D: false,
      text: isRtl
        ? `تسعير الوحدة: ${priceLabel(property, true)}.${prov ? `\nملاحظة: ${prov}` : ''}\nالمساحة: ${property.area} م² في ${property.location}. يمكنك التواصل مع البائع للحصول على عرض السعر الدقيق لهذه الوحدة.`
        : `Unit pricing: ${priceLabel(property, false)}.${prov ? `\nNote: ${prov}` : ''}\nArea: ${property.area} m² in ${property.location}. Contact the seller directly for an exact unit quote.`,
    };
  }

  if (/(installment|payment|down|تقسيط|سداد|مقدم|دفع|قسط)/i.test(lower)) {
    const planLines = (property.paymentPlans || [])
      .map((pl) => {
        const parts: string[] = [];
        if (pl.downPayment) parts.push(isRtl ? `${pl.downPayment}% مقدم` : `${pl.downPayment}% down`);
        if (pl.years) parts.push(isRtl ? `${pl.years} سنوات` : `${pl.years} years`);
        if (pl.note) parts.push(pl.note);
        return `• ${parts.join(' · ')}`;
      })
      .join('\n');

    const methodLabels = (property.paymentMethods || []).map((m) => paymentLabel(m, isRtl)).join(', ');
    const sampleEstimate =
      property.status === 'For Sale' && property.price > 0
        ? isRtl
          ? `\nتقدير استرشادي (10% مقدم على 7 سنوات بدون فوائد): المقدم ${Math.round(property.price * 0.1).toLocaleString()} ${currency}، والقسط الشهري التقريبي ${Math.round((property.price * 0.9) / 84).toLocaleString()} ${currency} (للاسترشاد فقط، مش عرض رسمي).`
          : `\nRough guidance (10% down over 7 yrs, no interest): ${Math.round(property.price * 0.1).toLocaleString()} ${currency} down and ~${Math.round((property.price * 0.9) / 84).toLocaleString()} ${currency}/month (guidance only, not an official quote).`
        : '';

    return {
      open3D: false,
      text: isRtl
        ? `تفاصيل السداد المتاحة:\n${planLines || (methodLabels ? `• طرق الدفع: ${methodLabels}` : '• لم يذكر البائع خطة سداد محددة بعد.')}${sampleEstimate}`
        : `Available payment details:\n${planLines || (methodLabels ? `• Payment methods: ${methodLabels}` : '• No specific payment plan listed by the seller yet.')}${sampleEstimate}`,
    };
  }

  if (/(legal|registry|court|doc|paper|شهر|عقاري|قانون|توقيع|مستند|أوراق)/i.test(lower)) {
    const reg = property.registrationNumber || (isRtl ? 'غير مذكور من البائع' : 'Not provided by the seller');
    const court = property.courtSignatureValidity
      ? isRtl
        ? 'البائع بيقول: صحيح'
        : 'Seller says: valid'
      : isRtl
        ? 'غير محدد'
        : 'Not stated';
    return {
      open3D: false,
      text: isRtl
        ? `البيانات القانونية (${t.listing_seller_stated || 'إفادة من البائع'}):\n• حالة مراجعة المستندات: ${reviewInfo.label}${reviewInfo.note ? ` — ${reviewInfo.note}` : ''}\n• رقم الشهر العقاري: ${reg}\n• صحة توقيع المحكمة: ${court}\n\nتنبيه مهم: التحقق الرسمي من الملكية والتسجيل يتم دائماً في الشهر العقاري.`
        : `Legal details (${t.listing_seller_stated || 'Stated by the seller'}):\n• Document review state: ${reviewInfo.label}${reviewInfo.note ? ` — ${reviewInfo.note}` : ''}\n• Registry number: ${reg}\n• Court signature: ${court}\n\nImportant: Official ownership and title confirmation always requires a search at the Real Estate Publicity Department (الشهر العقاري).`,
    };
  }

  const baseError = aiErrorMessage(err, isRtl);
  return {
    open3D: false,
    text: isRtl
      ? `${baseError}\n\nملخص سريع للوحدة من بيانات الإعلان:\n• ${property.title} (${property.location})\n• السعر: ${priceLabel(property, true)}\n• ${property.bedrooms} غرف · ${property.bathrooms} حمام · ${property.area} م²\n• حالة المراجعة: ${reviewInfo.label}`
      : `${baseError}\n\nQuick summary from this listing:\n• ${property.title} (${property.location})\n• Price: ${priceLabel(property, false)}\n• ${property.bedrooms} beds · ${property.bathrooms} baths · ${property.area} m²\n• Review state: ${reviewInfo.label}`,
  };
}

export const PropertyDetailPage: React.FC<PropertyDetailPageProps> = ({
  property,
  onBack,
  onPurchase,
  onOpenProject,
  onToggleFavorite,
  isFavorited = false,
  onToggleCompare,
  isComparing = false,
  t,
  isRtl,
}) => {
  const [currentImageIndex, setCurrentImageIndex] = useState(0);
  const [show3D, setShow3D] = useState(false);
  const [calcDown, setCalcDown] = useState(10);
  const [calcYears, setCalcYears] = useState(7);
  const [copiedLink, setCopiedLink] = useState(false);

  // Reviews state
  const [reviews, setReviews] = useState<ReviewEntry[]>([]);
  const [reviewsLoading, setReviewsLoading] = useState(true);
  const [reviewRating, setReviewRating] = useState(5);
  const [reviewComment, setReviewComment] = useState('');
  const [submittingReview, setSubmittingReview] = useState(false);
  const [reviewNotice, setReviewNotice] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  // Report listing inline panel state
  const [reportOpen, setReportOpen] = useState(false);
  const [reportReason, setReportReason] = useState('');
  const [reporting, setReporting] = useState(false);
  const [reportNotice, setReportNotice] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  const displayImages = useMemo(
    () => (property.images && property.images.length > 0 ? property.images : [property.imageUrl]).filter(Boolean),
    [property.images, property.imageUrl]
  );

  const slides = useMemo<{ type: 'video' | 'image'; src: string }[]>(
    () => [
      ...(property.videoUrl ? [{ type: 'video' as const, src: property.videoUrl }] : []),
      ...displayImages.map((src) => ({ type: 'image' as const, src })),
    ],
    [property.videoUrl, displayImages]
  );

  const buildWelcomeMessage = (rtl: boolean): ChatMessage => ({
    role: 'model',
    text: rtl
      ? `أهلاً! أنا المساعد الذكي الخاص بهذا العقار (${property.title}). اسألني عن تحليل سعر المتر، خطط السداد، تفاصيل الأوراق المعلنة، أو اطلب فتح الجولة المجسمة.`
      : `Hello! I'm the AI assistant for ${property.title}. Ask me about price per m², payment options, seller-stated legal details, or launch a 3D tour.`,
    timestamp: new Date(),
  });

  const [messages, setMessages] = useState<ChatMessage[]>(() => [buildWelcomeMessage(isRtl)]);
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  // Reset per-property state when switching to a different listing
  useEffect(() => {
    setCurrentImageIndex(0);
    setShow3D(false);
    setCopiedLink(false);
    setReviewNotice(null);
    setReportOpen(false);
    setReportReason('');
    setReportNotice(null);
    setMessages([buildWelcomeMessage(isRtl)]);
    const initialPlan = property.paymentPlans?.[0];
    if (initialPlan?.downPayment && initialPlan.downPayment >= 0 && initialPlan.downPayment <= 50) {
      setCalcDown(Math.round(initialPlan.downPayment / 5) * 5);
    } else {
      setCalcDown(10);
    }
    if (initialPlan?.years && initialPlan.years >= 1 && initialPlan.years <= 15) {
      setCalcYears(Math.round(initialPlan.years));
    } else {
      setCalcYears(7);
    }
    if (typeof window !== 'undefined' && typeof window.scrollTo === 'function') {
      window.scrollTo(0, 0);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [property.id]);

  // Keep welcome message localized when toggling language before chatting
  useEffect(() => {
    setMessages((prev) => (prev.length === 1 && prev[0].role === 'model' ? [buildWelcomeMessage(isRtl)] : prev));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isRtl]);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages, isLoading]);

  // Per-listing Schema.org JSON-LD structured data
  useEffect(() => {
    const existing = document.getElementById('listing-jsonld');
    if (existing) existing.remove();
    const script = document.createElement('script');
    script.type = 'application/ld+json';
    script.id = 'listing-jsonld';
    script.text = JSON.stringify({
      '@context': 'https://schema.org',
      '@type': 'Residence',
      name: property.title,
      description: property.description || property.title,
      image: property.imageUrl || (property.images && property.images[0]) || undefined,
      address: {
        '@type': 'PostalAddress',
        addressLocality: property.location,
        addressCountry: 'EG',
      },
      numberOfRooms: property.bedrooms,
      floorSize: { '@type': 'QuantitativeValue', value: property.area, unitCode: 'MTK' },
      offers: {
        '@type': 'Offer',
        price: property.price,
        priceCurrency: property.currency || 'EGP',
        availability:
          property.availability === 'Sold'
            ? 'https://schema.org/SoldOut'
            : property.availability === 'Reserved'
              ? 'https://schema.org/LimitedAvailability'
              : 'https://schema.org/InStock',
      },
    });
    document.head.appendChild(script);
    return () => {
      const el = document.getElementById('listing-jsonld');
      if (el) el.remove();
    };
  }, [property]);

  // Fetch unit reviews from Firestore/Neon facade
  useEffect(() => {
    let active = true;
    setReviewsLoading(true);
    (async () => {
      try {
        const snap = await getDocs(query(collection(db, 'reviews'), where('propertyId', '==', property.id)));
        if (!active) return;
        const loaded: ReviewEntry[] = snap.docs.map((d) => ({
          id: d.id,
          ...(d.data() as Omit<ReviewEntry, 'id'>),
        }));
        loaded.sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''));
        setReviews(loaded);
      } catch (e) {
        console.error('reviews load failed', e);
      } finally {
        if (active) setReviewsLoading(false);
      }
    })();
    return () => {
      active = false;
    };
  }, [property.id]);

  const sendPrompt = async (promptText: string) => {
    const trimmed = promptText.trim();
    if (!trimmed || isLoading) return;

    const newMessages: ChatMessage[] = [...messages, { role: 'user', text: trimmed, timestamp: new Date() }];
    setMessages(newMessages);
    setInput('');
    setIsLoading(true);

    try {
      const systemPrompt = `You are a real estate broker and financial analyst for a specific property on HETTETY — Egypt's real estate platform. Guide the user through this property's data clearly and honestly.

Answer questions ONLY about this property based on the following data:
Title: ${property.title}
Price: ${property.price > 0 ? `${property.price} ${property.currency || 'EGP'}` : priceLabel(property, false)}
Location: ${property.location}
Compound: ${property.compound || 'N/A'}
Developer: ${property.developer || 'N/A'}
Area: ${property.area}${property.areaTo ? `-${property.areaTo}` : ''} sqm
Bedrooms: ${property.bedrooms}
Bathrooms: ${property.bathrooms}
Status: ${property.status}
Availability: ${property.availability || 'Available'}
Finishing: ${property.finishing || 'Not specified'}
Delivery: ${property.deliveryDate || 'Not specified'}
Payment Methods: ${property.paymentMethods?.join(', ') || 'Not specified'}
Payment Plans: ${property.paymentPlans?.length ? JSON.stringify(property.paymentPlans) : 'Not specified'}
Unit Code: ${property.unitCode || 'N/A'}
Registry Number AS TYPED BY THE SELLER, unverified by HETTETY: ${property.registrationNumber || 'Not provided'}
Court Signature — the seller ticked a checkbox, nobody checked it: ${property.courtSignatureValidity ? 'seller ticked it' : 'not ticked'}
Document review state: ${property.verificationStatus === 'Verified' ? 'a HETTETY reviewer read the documents the seller uploaded — this is NOT proof of authenticity or of registration with the Real Estate Publicity Department' : 'no reviewer has looked at this listing yet'}
Resale: ${property.isResale ? 'Yes, this is a resale property.' : 'No, direct sale.'}
Description: ${property.description || 'N/A'}
Images: ${property.images?.length ? property.images.join(', ') : property.imageUrl} (If the user asks to see the apartment / shape of the apartment / sor el shaqa, you MUST output ALL these images exactly in markdown format like this: ![Apartment](URL1) ![Apartment](URL2) etc.)

## Tone & Voice
- Professional & Insightful: Provide context like price per square meter analysis when priced.
- Clear & Grounded: Base financial breakdowns on the provided listing numbers and state clearly when figures are rough estimates.

## Interaction Rules
- Never vouch for the property's legal safety: the registry number and court-signature box are the seller's own claims. State the document review state honestly and remind the user that confirming ownership requires a search at the Real Estate Publicity Department (الشهر العقاري).
- Language: Reply in the exact language the user writes in (English, Egyptian Arabic, or Franco). Do not invent information not in the data provided.
- 3D Viewing (Special Capability): You can launch an immersive 3D viewer for this property. When the user asks to see the apartment in 3D, take a virtual tour, walk through it, or says things like "عرضلي الشقة 3D" / "عايز أشوفها مجسمة" / "افتح الجولة المجسمة" / "Launch 3D Tour", reply with a short enthusiastic confirmation in the user's language and append the exact token [SHOW_3D] at the very end of your reply.`;

      const response = await generateContentResilient({
        task: 'chat',
        contents: newMessages.map((m) => ({
          role: m.role === 'model' ? 'model' : 'user',
          parts: [{ text: m.text }],
        })),
        config: {
          systemInstruction: systemPrompt,
        },
      });

      let aiText = response.text || (isRtl ? 'عذراً، لم أتمكن من معالجة الطلب حالياً.' : "Sorry, I couldn't process that request.");
      const { cleanText, show3D: wants3D } = extract3DMarker(aiText);
      if (wants3D) {
        aiText = cleanText || (isRtl ? 'جاري فتح الجولة ثلاثية الأبعاد...' : 'Opening the 3D tour...');
        setShow3D(true);
      }

      setMessages([...newMessages, { role: 'model', text: aiText, timestamp: new Date() }]);
    } catch (err) {
      console.error(err);
      const fallback = buildLocalFallbackReply(trimmed, property, t, isRtl, err);
      if (fallback.open3D) setShow3D(true);
      setMessages([...newMessages, { role: 'model', text: fallback.text, timestamp: new Date() }]);
    } finally {
      setIsLoading(false);
    }
  };

  const handleSendMessage = (e: React.FormEvent) => {
    e.preventDefault();
    void sendPrompt(input);
  };

  const handleCopyLink = async () => {
    const shareUrl = typeof window !== 'undefined' ? window.location.href : '';
    try {
      if (navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
        await navigator.clipboard.writeText(shareUrl);
      }
      setCopiedLink(true);
      window.setTimeout(() => setCopiedLink(false), 2200);
    } catch {
      setCopiedLink(true);
      window.setTimeout(() => setCopiedLink(false), 2200);
    }
  };

  const submitReview = async () => {
    setReviewNotice(null);
    if (!auth.currentUser) {
      setReviewNotice({
        type: 'error',
        text: isRtl ? 'سجّل الدخول الأول عشان تكتب تقييم.' : 'Please sign in first to post a review.',
      });
      return;
    }
    if (!reviewComment.trim()) return;
    setSubmittingReview(true);
    try {
      const reviewDocId = `${property.id}_${auth.currentUser.uid}`;
      const rev: Omit<ReviewEntry, 'id'> = {
        propertyId: property.id,
        userId: auth.currentUser.uid,
        userName: auth.currentUser.displayName || (auth.currentUser.email || '').split('@')[0] || 'User',
        rating: reviewRating,
        comment: reviewComment.trim().slice(0, 999),
        createdAt: new Date().toISOString(),
      };
      await setDoc(doc(db, 'reviews', reviewDocId), rev);
      setReviews((prev) => [{ id: reviewDocId, ...rev }, ...prev.filter((r) => r.id !== reviewDocId)]);
      setReviewComment('');
      setReviewRating(5);
      setReviewNotice({
        type: 'success',
        text: isRtl ? 'تم حفظ تقييمك بنجاح.' : 'Your review has been saved.',
      });
    } catch (e) {
      console.error('review failed', e);
      setReviewNotice({
        type: 'error',
        text: isRtl ? 'تعذّر إرسال التقييم. حاول مرة تانية.' : 'Could not submit the review. Please try again.',
      });
    } finally {
      setSubmittingReview(false);
    }
  };

  const handleSubmitReport = async (e: React.FormEvent) => {
    e.preventDefault();
    setReportNotice(null);
    if (!auth.currentUser) {
      setReportNotice({
        type: 'error',
        text: isRtl ? 'سجّل الدخول الأول عشان تبلّغ عن الإعلان.' : 'Please sign in to report a listing.',
      });
      return;
    }
    if (!reportReason.trim()) return;
    setReporting(true);
    try {
      await addDoc(collection(db, 'reports'), {
        propertyId: property.id,
        userId: auth.currentUser.uid,
        reason: reportReason.trim().slice(0, 999),
        createdAt: new Date().toISOString(),
      });
      setReportReason('');
      setReportOpen(false);
      setReportNotice({
        type: 'success',
        text: isRtl ? 'تم إرسال البلاغ للمراجعة. شكرًا لتعاونك.' : 'Report submitted for review. Thank you.',
      });
    } catch (err) {
      console.error('Report failed', err);
      setReportNotice({
        type: 'error',
        text: isRtl ? 'تعذّر إرسال البلاغ. حاول مرة تانية.' : 'Could not submit the report. Please try again.',
      });
    } finally {
      setReporting(false);
    }
  };

  const av = availabilityInfo(property.availability, property.status, isRtl);
  const reviewState = listingReviewInfo(property, t);
  const currency = property.currency || 'EGP';
  const ppm = property.status !== 'For Rent' ? pricePerSqm(property) : null;
  const provenance = priceProvenance(property, isRtl);
  const validatedTourUrl = safeTourUrl(property.digitalTwinUrl);
  const has3DViewerMedia =
    displayImages.length > 0 ||
    (property.panoramas && property.panoramas.length > 0) ||
    Boolean(property.threeDTour) ||
    Boolean(property.digitalTwinUrl);

  const mapsQuery = encodeURIComponent([property.compound, property.location].filter(Boolean).join(', '));
  const mapsUrl =
    property.lat && property.lng
      ? `https://www.google.com/maps/search/?api=1&query=${property.lat},${property.lng}`
      : `https://www.google.com/maps/search/?api=1&query=${mapsQuery}`;

  const avgRating = reviews.length ? reviews.reduce((s, r) => s + (r.rating || 0), 0) / reviews.length : 0;

  // Safe numeric math for Installment Calculator (guarantees no NaN / Infinity)
  const safePrice = Number.isFinite(property.price) && property.price > 0 ? property.price : 0;
  const safeDownPct = Math.min(50, Math.max(0, Number.isFinite(calcDown) ? calcDown : 0));
  const safeYears = Math.min(15, Math.max(1, Number.isFinite(calcYears) ? calcYears : 1));
  const downPaymentAmount = Math.round((safePrice * safeDownPct) / 100);
  const financedBalance = Math.max(0, Math.round(safePrice - downPaymentAmount));
  const monthlyEstimate = Math.round(financedBalance / (safeYears * 12));

  // Executive Spec Strip cards
  const specCards = useMemo(() => {
    const base = [
      {
        icon: <BedDouble className="text-brand-600 dark:text-accent-400" size={22} aria-hidden="true" />,
        value: property.bedrooms,
        label: t.prop_beds || (isRtl ? 'غرف' : 'Beds'),
        accent: false,
      },
      {
        icon: <Bath className="text-brand-600 dark:text-accent-400" size={22} aria-hidden="true" />,
        value: property.bathrooms,
        label: t.prop_baths || (isRtl ? 'حمام' : 'Baths'),
        accent: false,
      },
      {
        icon: <Maximize className="text-brand-600 dark:text-accent-400" size={22} aria-hidden="true" />,
        value: `${property.area}${property.areaTo ? `–${property.areaTo}` : ''} ${isRtl ? 'م²' : 'm²'}`,
        label: isRtl ? 'المساحة' : 'Area',
        accent: false,
      },
    ];
    if (ppm !== null) {
      base.push({
        icon: <TrendingUp className="text-accent-600 dark:text-accent-400" size={22} aria-hidden="true" />,
        value: `${ppm.toLocaleString()} ${currency}`,
        label: isRtl ? 'سعر المتر' : 'Price / m²',
        accent: true,
      });
    } else if (property.deliveryDate) {
      base.push({
        icon: <Calendar className="text-accent-600 dark:text-accent-400" size={22} aria-hidden="true" />,
        value: property.deliveryDate,
        label: isRtl ? 'الاستلام' : 'Delivery',
        accent: true,
      });
    }
    return base;
  }, [property.bedrooms, property.bathrooms, property.area, property.areaTo, property.deliveryDate, ppm, currency, t, isRtl]);

  // Full specification rows (every stored field localized)
  const specRows = useMemo(() => {
    const rows: { label: string; value: React.ReactNode }[] = [];
    const add = (label: string, value: React.ReactNode) => {
      if (value !== undefined && value !== null && value !== '' && value !== 0) {
        rows.push({ label, value });
      }
    };
    add(isRtl ? 'نوع العقار' : 'Property type', typeLabel(property.propertyType, isRtl));
    add(
      isRtl ? 'الغرض' : 'Purpose',
      property.status === 'For Sale' ? (isRtl ? 'للبيع' : 'For sale') : isRtl ? 'للإيجار' : 'For rent'
    );
    add(isRtl ? 'الحالة' : 'Availability', av.label);
    add(isRtl ? 'التشطيب' : 'Finishing', finishingLabel(property.finishing, isRtl));
    add(isRtl ? 'الدور' : 'Floor', property.floor);
    add(isRtl ? 'الإطلالة' : 'View', property.view);
    add(isRtl ? 'مفروش' : 'Furnished', property.furnished ? (isRtl ? 'نعم' : 'Yes') : undefined);
    add(isRtl ? 'عدد الأفراد' : 'Sleeps', property.guests);
    add(isRtl ? 'الكمبوند' : 'Compound', property.compound);
    add(isRtl ? 'القرية' : 'Village', property.village);
    add(isRtl ? 'المطوّر' : 'Developer', property.developer);
    add(isRtl ? 'الاستلام' : 'Delivery', property.deliveryDate);
    add(isRtl ? 'نموذج الوحدة' : 'Unit model', property.unitModel);
    add(isRtl ? 'نوع المبنى' : 'Building type', property.buildingType);
    add(isRtl ? 'المرحلة' : 'Phase', property.phase);
    add(isRtl ? 'الأدوار' : 'Floors', property.floorsDescription);
    add(
      isRtl ? 'حديقة خاصة' : 'Private garden',
      property.gardenArea ? `${property.gardenArea} ${isRtl ? 'م²' : 'm²'}` : undefined
    );
    add(
      isRtl ? 'روف / تراس خاص' : 'Private roof',
      property.roofArea ? `${property.roofArea} ${isRtl ? 'م²' : 'm²'}` : undefined
    );
    add(
      isRtl ? 'وديعة الصيانة' : 'Maintenance fee',
      property.maintenanceFee ? `${property.maintenanceFee}%` : undefined
    );
    add(
      isRtl ? 'مساحة المشروع' : 'Project area',
      property.projectAreaFeddan ? `${property.projectAreaFeddan} ${isRtl ? 'فدان' : 'feddan'}` : undefined
    );
    add(
      isRtl ? 'المساحات الخضراء' : 'Green spaces',
      property.greenSpacePercent ? `${property.greenSpacePercent}%` : undefined
    );
    return rows;
  }, [property, av.label, isRtl]);

  const quickPrompts = useMemo(
    () => [
      {
        label: isRtl ? 'تحليل سعر المتر' : 'Price / m² analysis',
        prompt: isRtl
          ? 'حلل لي سعر المتر والقيمة مقابل المواصفات في هذه الوحدة.'
          : 'Analyze the price per square meter and overall value for this unit.',
      },
      {
        label: isRtl ? 'تفاصيل التقسيط' : 'Payment breakdown',
        prompt: isRtl
          ? 'ما هي خطط السداد والمقدم والأقساط المتاحة لهذه الوحدة؟'
          : 'Break down the down payment and installment options for this property.',
      },
      {
        label: isRtl ? 'افتح الجولة المجسمة' : 'Launch 3D Tour',
        prompt: isRtl ? 'عرضلي الشقة 3D' : 'Show me this property in a 3D virtual tour',
      },
    ],
    [isRtl]
  );

  const safeSlideIndex = Math.min(currentImageIndex, Math.max(slides.length - 1, 0));
  const activeSlide = slides[safeSlideIndex];

  return (
    <div dir={isRtl ? 'rtl' : 'ltr'} className="max-w-7xl mx-auto px-4 sm:px-6 py-6 sm:py-8 animate-fade-in">
      {/* Action Header Toolbar */}
      <div className="flex flex-wrap items-center justify-between gap-3 pb-5 mb-6 border-b border-slate-200/80 dark:border-slate-800">
        <div className="flex items-center gap-3 min-w-0 flex-wrap">
          <button
            type="button"
            onClick={onBack}
            className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-slate-100 dark:bg-slate-800/90 hover:bg-brand-600 hover:text-white dark:hover:bg-brand-600 text-slate-700 dark:text-slate-200 font-bold text-sm transition-colors cursor-pointer focus:outline-none focus:ring-2 focus:ring-brand-500 shrink-0"
          >
            {isRtl ? <ArrowRight size={17} aria-hidden="true" /> : <ArrowLeft size={17} aria-hidden="true" />}
            {isRtl ? 'رجوع' : 'Back'}
          </button>

          <nav
            aria-label={isRtl ? 'مسار التصفح' : 'Breadcrumb'}
            className="hidden sm:flex items-center gap-1.5 text-xs font-semibold text-slate-500 dark:text-slate-400 min-w-0"
          >
            <span className="inline-flex items-center gap-1 text-slate-500 dark:text-slate-400">
              <Home size={13} aria-hidden="true" />
              <span>{isRtl ? 'الرئيسية' : 'Home'}</span>
            </span>
            <ChevronRight size={13} className={`shrink-0 opacity-60 ${isRtl ? 'rotate-180' : ''}`} aria-hidden="true" />
            {property.compound ? (
              onOpenProject ? (
                <button
                  type="button"
                  onClick={() => onOpenProject(property.compound!)}
                  className="text-brand-600 dark:text-brand-400 hover:underline truncate max-w-[160px] cursor-pointer"
                >
                  {property.compound}
                </button>
              ) : (
                <span className="truncate max-w-[160px]">{property.compound}</span>
              )
            ) : (
              <span className="truncate max-w-[160px]">{property.location}</span>
            )}
            <ChevronRight size={13} className={`shrink-0 opacity-60 ${isRtl ? 'rotate-180' : ''}`} aria-hidden="true" />
            <span aria-current="page" className="text-slate-800 dark:text-slate-200 font-bold truncate max-w-[160px]">
              {property.unitCode || typeLabel(property.propertyType, isRtl) || (isRtl ? 'الوحدة' : 'Unit')}
            </span>
          </nav>
        </div>

        {/* Share / Favorite / Compare quick actions */}
        <div className="flex items-center gap-2 shrink-0">
          <button
            type="button"
            onClick={handleCopyLink}
            aria-live="polite"
            className={`inline-flex items-center gap-1.5 px-3.5 py-2 rounded-full text-xs font-bold border transition-all cursor-pointer focus:outline-none focus:ring-2 focus:ring-brand-500 ${
              copiedLink
                ? 'bg-emerald-50 dark:bg-emerald-950/50 border-emerald-300 dark:border-emerald-700 text-emerald-700 dark:text-emerald-300'
                : 'bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-200 hover:border-brand-400 dark:hover:border-brand-500'
            }`}
          >
            {copiedLink ? <Check size={14} aria-hidden="true" /> : <Share2 size={14} aria-hidden="true" />}
            <span>{copiedLink ? (isRtl ? 'تم النسخ!' : 'Copied!') : isRtl ? 'مشاركة' : 'Share'}</span>
          </button>

          {onToggleFavorite && (
            <button
              type="button"
              onClick={onToggleFavorite}
              aria-pressed={isFavorited}
              aria-label={
                isFavorited
                  ? isRtl
                    ? 'إزالة من المفضلة'
                    : 'Remove from favorites'
                  : isRtl
                    ? 'إضافة إلى المفضلة'
                    : 'Add to favorites'
              }
              className={`inline-flex items-center gap-1.5 px-3.5 py-2 rounded-full text-xs font-bold border transition-all cursor-pointer focus:outline-none focus:ring-2 focus:ring-brand-500 ${
                isFavorited
                  ? 'bg-rose-500 border-rose-500 text-white shadow-sm'
                  : 'bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-200 hover:border-rose-400 hover:text-rose-600 dark:hover:text-rose-400'
              }`}
            >
              <Heart size={14} fill={isFavorited ? 'currentColor' : 'none'} aria-hidden="true" />
              <span className="hidden sm:inline">{isRtl ? 'المفضلة' : 'Save'}</span>
            </button>
          )}

          {onToggleCompare && (
            <button
              type="button"
              onClick={onToggleCompare}
              aria-pressed={isComparing}
              aria-label={
                isComparing
                  ? isRtl
                    ? 'إزالة من المقارنة'
                    : 'Remove from comparison'
                  : isRtl
                    ? 'إضافة للمقارنة'
                    : 'Add to comparison'
              }
              className={`inline-flex items-center gap-1.5 px-3.5 py-2 rounded-full text-xs font-bold border transition-all cursor-pointer focus:outline-none focus:ring-2 focus:ring-brand-500 ${
                isComparing
                  ? 'bg-accent-500 border-accent-500 text-white shadow-sm'
                  : 'bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-200 hover:border-accent-400 hover:text-accent-600 dark:hover:text-accent-400'
              }`}
            >
              {isComparing ? <Check size={14} aria-hidden="true" /> : <Plus size={14} aria-hidden="true" />}
              <span className="hidden sm:inline">{isRtl ? 'قارن' : 'Compare'}</span>
            </button>
          )}
        </div>
      </div>

      {/* Main 2-column layout (Details + Sticky AI Assistant) */}
      <div className="grid lg:grid-cols-3 gap-8 items-start">
        {/* Details column */}
        <div className="lg:col-span-2 space-y-8 min-w-0">
          {/* Studio Media Gallery */}
          <div className="space-y-3">
            <div className="relative h-80 sm:h-[28rem] group rounded-3xl overflow-hidden border border-slate-200/90 dark:border-slate-800 shadow-xl bg-slate-100 dark:bg-slate-900">
              {activeSlide?.type === 'video' ? (
                <video
                  key={activeSlide.src}
                  src={activeSlide.src}
                  className="w-full h-full object-cover"
                  controls
                  playsInline
                />
              ) : (
                <PropertyImage
                  src={activeSlide?.src}
                  alt={property.title}
                  iconSize={56}
                  priority
                  className="w-full h-full object-cover transition-transform duration-500"
                />
              )}

              {/* Subtle top/bottom gradient scrim for readable badges */}
              <div className="absolute inset-x-0 top-0 h-24 bg-gradient-to-b from-brand-950/55 to-transparent pointer-events-none" />
              <div className="absolute inset-x-0 bottom-0 h-20 bg-gradient-to-t from-brand-950/60 to-transparent pointer-events-none" />

              {/* Availability Stamp when Sold/Reserved */}
              {av.taken && (
                <div className="absolute inset-0 bg-brand-950/50 backdrop-blur-[1px] flex items-center justify-center z-10 pointer-events-none">
                  <span
                    className={`${av.color} text-white text-xl sm:text-2xl font-black uppercase tracking-widest px-8 py-3 rounded-2xl -rotate-6 shadow-2xl border border-white/25`}
                  >
                    {av.label}
                  </span>
                </div>
              )}

              {/* Top-Start Glassmorphic 3D / 360° Tour Launch Button */}
              {has3DViewerMedia && (
                <button
                  type="button"
                  onClick={() => setShow3D(true)}
                  className="absolute top-4 start-4 z-20 inline-flex items-center gap-2 px-4 py-2.5 rounded-full bg-brand-950/75 hover:bg-accent-500 text-white backdrop-blur-md border border-white/25 text-sm font-black shadow-lg transition-all cursor-pointer focus:outline-none focus:ring-2 focus:ring-accent-400"
                >
                  {property.panoramas && property.panoramas.length > 0 ? (
                    <Compass size={16} className="text-accent-300" aria-hidden="true" />
                  ) : (
                    <Box size={16} className="text-accent-300" aria-hidden="true" />
                  )}
                  <span>
                    {property.panoramas && property.panoramas.length > 0
                      ? isRtl
                        ? 'جولة 360°'
                        : '360° Tour'
                      : isRtl
                        ? 'جولة 3D'
                        : 'View in 3D'}
                  </span>
                </button>
              )}

              {/* Top-End Slide Counter Badge */}
              {slides.length > 0 && (
                <div className="absolute top-4 end-4 z-20 px-3 py-1.5 rounded-full bg-brand-950/70 backdrop-blur-md border border-white/20 text-white text-xs font-bold tabular-nums shadow-md">
                  {safeSlideIndex + 1} / {slides.length}
                </div>
              )}

              {/* Prev / Next Controls + Accessible Tablist Dots */}
              {slides.length > 1 && (
                <>
                  <button
                    type="button"
                    aria-label={isRtl ? 'الصورة السابقة' : 'Previous image'}
                    onClick={() => setCurrentImageIndex((i) => (i === 0 ? slides.length - 1 : i - 1))}
                    className="absolute start-4 top-1/2 -translate-y-1/2 min-w-[44px] min-h-[44px] p-2 bg-brand-950/60 text-white rounded-full hover:bg-brand-950/85 backdrop-blur-md border border-white/20 cursor-pointer transition-all opacity-100 sm:opacity-0 sm:group-hover:opacity-100 focus:opacity-100 focus:outline-none focus:ring-2 focus:ring-accent-400 z-20 flex items-center justify-center shadow-lg"
                  >
                    {isRtl ? <ChevronRight size={20} aria-hidden="true" /> : <ChevronLeft size={20} aria-hidden="true" />}
                  </button>
                  <button
                    type="button"
                    aria-label={isRtl ? 'الصورة التالية' : 'Next image'}
                    onClick={() => setCurrentImageIndex((i) => (i + 1) % slides.length)}
                    className="absolute end-4 top-1/2 -translate-y-1/2 min-w-[44px] min-h-[44px] p-2 bg-brand-950/60 text-white rounded-full hover:bg-brand-950/85 backdrop-blur-md border border-white/20 cursor-pointer transition-all opacity-100 sm:opacity-0 sm:group-hover:opacity-100 focus:opacity-100 focus:outline-none focus:ring-2 focus:ring-accent-400 z-20 flex items-center justify-center shadow-lg"
                  >
                    {isRtl ? <ChevronLeft size={20} aria-hidden="true" /> : <ChevronRight size={20} aria-hidden="true" />}
                  </button>

                  <div
                    className="absolute bottom-4 inset-x-0 flex justify-center gap-1.5 z-20 px-4"
                    role="tablist"
                    aria-label={isRtl ? 'صور المعرض' : 'Gallery slides'}
                  >
                    {slides.map((_, idx) => (
                      <button
                        key={idx}
                        type="button"
                        role="tab"
                        aria-selected={idx === safeSlideIndex}
                        aria-label={
                          isRtl
                            ? `الصورة ${idx + 1} من ${slides.length}`
                            : `Slide ${idx + 1} of ${slides.length}`
                        }
                        onClick={() => setCurrentImageIndex(idx)}
                        className="min-w-[24px] min-h-[24px] flex items-center justify-center p-1 rounded-full transition-all focus:outline-none focus:ring-2 focus:ring-accent-400 cursor-pointer"
                      >
                        <span
                          className={`h-2 rounded-full transition-all block ${
                            idx === safeSlideIndex
                              ? 'w-6 bg-accent-400 shadow-sm'
                              : 'w-2 bg-white/55 hover:bg-white/85'
                          }`}
                        />
                      </button>
                    ))}
                  </div>
                </>
              )}
            </div>

            {/* Interactive Horizontal Thumbnail Filmstrip */}
            {slides.length > 1 && (
              <div
                aria-label={isRtl ? 'معاينة مصغرة للصور' : 'Media thumbnails'}
                className="flex items-center gap-2.5 overflow-x-auto pb-1 no-scrollbar"
              >
                {slides.map((slide, idx) => {
                  const isActive = idx === safeSlideIndex;
                  return (
                    <button
                      key={`${slide.type}-${idx}`}
                      type="button"
                      onClick={() => setCurrentImageIndex(idx)}
                      aria-current={isActive ? 'true' : undefined}
                      aria-label={
                        isRtl
                          ? `عرض ${slide.type === 'video' ? 'الفيديو' : `الصورة ${idx + 1}`}`
                          : `Show ${slide.type === 'video' ? 'video' : `image ${idx + 1}`}`
                      }
                      className={`relative w-24 h-16 sm:w-28 sm:h-20 rounded-2xl overflow-hidden shrink-0 border-2 transition-all cursor-pointer focus:outline-none focus:ring-2 focus:ring-brand-500 ${
                        isActive
                          ? 'border-accent-500 ring-2 ring-accent-500/30 opacity-100 scale-[1.02]'
                          : 'border-slate-200 dark:border-slate-800 opacity-70 hover:opacity-100'
                      }`}
                    >
                      {slide.type === 'video' ? (
                        <div className="w-full h-full bg-brand-900 text-white flex flex-col items-center justify-center gap-1">
                          <Play size={18} aria-hidden="true" />
                          <span className="text-[10px] font-bold">{isRtl ? 'فيديو' : 'Video'}</span>
                        </div>
                      ) : (
                        <PropertyImage
                          src={slide.src}
                          alt={`${property.title} — ${idx + 1}`}
                          iconSize={20}
                          className="w-full h-full object-cover"
                        />
                      )}
                    </button>
                  );
                })}
              </div>
            )}
          </div>

          {/* Listing Header + Price Card */}
          <div className="bg-white dark:bg-slate-900 rounded-3xl border border-slate-200/80 dark:border-slate-800 p-6 shadow-sm">
            <div className="flex flex-col sm:flex-row justify-between items-start gap-5">
              <div className="flex-1 min-w-0">
                {/* Honest Review & Availability Chips */}
                <div className="flex items-center gap-2 mb-3 flex-wrap">
                  <span
                    className={`px-3 py-1 rounded-full text-[11px] font-black tracking-wide ${
                      property.status === 'For Sale' ? 'bg-accent-500 text-white' : 'bg-brand-600 text-white'
                    }`}
                  >
                    {property.status === 'For Sale'
                      ? isRtl
                        ? 'للبيع'
                        : 'For Sale'
                      : isRtl
                        ? 'للإيجار'
                        : 'For Rent'}
                  </span>

                  <span
                    className={`${reviewState.chip} text-[11px] px-3 py-1 rounded-full font-bold inline-flex items-center gap-1`}
                  >
                    {property.verificationStatus === 'Verified' && <ShieldCheck size={13} aria-hidden="true" />}
                    <span>{reviewState.label}</span>
                  </span>

                  <span className={`${av.color} text-white text-[11px] px-3 py-1 rounded-full font-bold`}>
                    {av.label}
                  </span>

                  {property.propertyType && (
                    <span className="px-3 py-1 rounded-full bg-brand-50 dark:bg-brand-900/40 text-brand-700 dark:text-brand-300 text-[11px] font-bold">
                      {typeLabel(property.propertyType, isRtl)}
                    </span>
                  )}
                </div>

                {/* Primary Listing Title */}
                <h1 className="text-2xl sm:text-3xl font-heading font-black text-slate-900 dark:text-white tracking-tight leading-snug mb-2">
                  {property.title}
                </h1>

                {/* Honest review caveat note (الشهر العقاري) */}
                {reviewState.note && (
                  <p className="text-xs text-slate-500 dark:text-slate-400 bg-slate-50 dark:bg-slate-800/60 border border-slate-200/70 dark:border-slate-700/70 rounded-xl px-3.5 py-2 mb-3 leading-relaxed max-w-2xl">
                    {reviewState.note}
                  </p>
                )}

                {/* Location + Compound + Maps link */}
                <p className="text-slate-600 dark:text-slate-300 flex items-center gap-1.5 mb-2 font-medium flex-wrap text-sm">
                  <MapPin size={16} className="text-accent-500 shrink-0" aria-hidden="true" />
                  <span>{property.location}</span>
                  {property.compound &&
                    (onOpenProject ? (
                      <>
                        <span className="text-slate-400">—</span>
                        <button
                          type="button"
                          onClick={() => onOpenProject(property.compound!)}
                          className="text-brand-600 dark:text-accent-400 font-bold hover:underline cursor-pointer"
                        >
                          {property.compound}
                        </button>
                      </>
                    ) : (
                      <span> — {property.compound}</span>
                    ))}
                  <a
                    href={mapsUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-brand-600 dark:text-brand-300 font-bold hover:underline text-xs ms-1"
                  >
                    {isRtl ? '· عرض على الخريطة' : '· View on map'}
                  </a>
                </p>

                {/* Unit Metadata Row */}
                <div className="flex items-center gap-x-4 gap-y-1 text-xs text-slate-500 dark:text-slate-400 flex-wrap">
                  {property.developer && (
                    <span>
                      {isRtl ? 'المطوّر:' : 'Developer:'}{' '}
                      <strong className="text-slate-800 dark:text-slate-200">{property.developer}</strong>
                    </span>
                  )}
                  {property.unitCode && (
                    <span>
                      {isRtl ? 'كود الوحدة:' : 'Unit code:'}{' '}
                      <strong className="text-slate-800 dark:text-slate-200">{property.unitCode}</strong>
                    </span>
                  )}
                  {property.publishDate && (
                    <span>
                      {isRtl ? 'نُشر:' : 'Published:'}{' '}
                      <strong className="text-slate-800 dark:text-slate-200">{property.publishDate}</strong>
                    </span>
                  )}
                </div>
              </div>

              {/* Price Summary Box */}
              <div className="bg-brand-50/70 dark:bg-slate-800/80 p-4 sm:p-5 rounded-2xl border border-brand-100 dark:border-slate-700 flex sm:flex-col justify-between items-center sm:items-end gap-1.5 w-full sm:w-auto shrink-0">
                <div className="text-end">
                  <div
                    className={`font-black text-brand-700 dark:text-accent-400 tabular-nums ${
                      property.price ? 'text-2xl sm:text-3xl' : 'text-lg sm:text-xl'
                    }`}
                  >
                    {priceLabel(property, isRtl)}
                    {property.price ? (
                      <span className="text-xs text-slate-500 dark:text-slate-400 font-bold">
                        {pricePeriodSuffix(property.pricePeriod, isRtl)}
                      </span>
                    ) : null}
                  </div>
                  {provenance && (
                    <p className="text-[11px] leading-snug text-slate-500 dark:text-slate-400 max-w-[16rem] mt-1 sm:text-end">
                      {provenance}
                    </p>
                  )}
                </div>
              </div>
            </div>
          </div>

          {/* Executive Spec Strip */}
          <div
            className={`grid gap-4 ${
              specCards.length === 4 ? 'grid-cols-2 sm:grid-cols-4' : 'grid-cols-3'
            }`}
          >
            {specCards.map((card, i) => (
              <div
                key={i}
                className={`flex flex-col items-center justify-center p-5 rounded-2xl border transition-shadow hover:shadow-md ${
                  card.accent
                    ? 'bg-accent-50/70 dark:bg-accent-950/25 border-accent-200/70 dark:border-accent-800/50'
                    : 'bg-white dark:bg-slate-900 border-slate-200/80 dark:border-slate-800'
                }`}
              >
                <div
                  className={`w-10 h-10 rounded-xl flex items-center justify-center mb-2.5 ${
                    card.accent
                      ? 'bg-accent-100 dark:bg-accent-900/40'
                      : 'bg-brand-50 dark:bg-brand-900/40'
                  }`}
                >
                  {card.icon}
                </div>
                <span className="text-lg sm:text-xl font-black text-slate-900 dark:text-white leading-tight text-center tabular-nums">
                  {card.value}
                </span>
                <span className="text-xs font-semibold text-slate-500 dark:text-slate-400 mt-1 text-center">
                  {card.label}
                </span>
              </div>
            ))}
          </div>

          {/* Full Specification Matrix */}
          {specRows.length > 0 && (
            <section className="bg-white dark:bg-slate-900 rounded-3xl border border-slate-200/80 dark:border-slate-800 p-6 shadow-sm">
              <h3 className="font-heading font-extrabold text-lg text-slate-900 dark:text-white mb-4 flex items-center gap-2">
                <Layers size={18} className="text-accent-500" aria-hidden="true" />
                <span>{isRtl ? 'تفاصيل الوحدة' : 'Property details'}</span>
              </h3>
              <dl className="grid sm:grid-cols-2 gap-x-8 gap-y-0">
                {specRows.map((row, idx) => (
                  <div
                    key={idx}
                    className="flex items-baseline justify-between gap-4 py-3 border-b border-slate-100 dark:border-slate-800/80"
                  >
                    <dt className="text-sm text-slate-500 dark:text-slate-400 shrink-0">{row.label}</dt>
                    <dd className="text-sm sm:text-base font-bold text-slate-900 dark:text-white text-end">
                      {row.value}
                    </dd>
                  </div>
                ))}
              </dl>
            </section>
          )}

          {/* Description */}
          {property.description && (
            <section className="bg-white dark:bg-slate-900 rounded-3xl border border-slate-200/80 dark:border-slate-800 p-6 shadow-sm">
              <h3 className="font-heading font-extrabold text-lg text-slate-900 dark:text-white mb-3">
                {isRtl ? 'الوصف' : 'Description'}
              </h3>
              <p className="text-slate-600 dark:text-slate-300 whitespace-pre-wrap leading-relaxed text-sm sm:text-base">
                {property.description}
              </p>
            </section>
          )}

          {/* Location Map (Exact heading text preserved for E2E & RTL tests) */}
          <section className="bg-white dark:bg-slate-900 rounded-3xl border border-slate-200/80 dark:border-slate-800 p-6 shadow-sm">
            <div className="flex items-center justify-between gap-3 mb-4 flex-wrap">
              <h3 className="font-heading font-extrabold text-lg text-slate-900 dark:text-white flex items-center gap-2">
                <MapPin size={18} className="text-accent-500" aria-hidden="true" />
                {isRtl ? 'الموقع على الخريطة' : 'Location'}
              </h3>
              <a
                href={mapsUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1.5 text-xs sm:text-sm font-bold text-brand-600 dark:text-accent-400 hover:underline"
              >
                <span>{isRtl ? 'افتح في خرائط جوجل' : 'Open in Google Maps'}</span>
                <ExternalLink size={14} aria-hidden="true" />
              </a>
            </div>
            <div
              className="relative w-full rounded-2xl overflow-hidden border border-slate-200 dark:border-slate-800 bg-slate-100 dark:bg-slate-800"
              style={{ aspectRatio: '16 / 9' }}
            >
              <iframe
                title={isRtl ? 'خريطة الموقع' : 'Location map'}
                className="absolute inset-0 w-full h-full"
                loading="lazy"
                referrerPolicy="no-referrer-when-downgrade"
                src={
                  property.lat && property.lng
                    ? `https://maps.google.com/maps?q=${property.lat},${property.lng}&z=14&output=embed`
                    : `https://maps.google.com/maps?q=${mapsQuery}&z=13&output=embed`
                }
              />
            </div>
          </section>

          {/* Allowlisted Real Virtual Tour (Matterport / Polycam / Kuula) */}
          {validatedTourUrl && (
            <section className="bg-white dark:bg-slate-900 rounded-3xl border border-slate-200/80 dark:border-slate-800 p-6 shadow-sm">
              <div className="flex items-center justify-between gap-3 mb-4 flex-wrap">
                <h3 className="font-heading font-extrabold text-lg text-slate-900 dark:text-white flex items-center gap-2">
                  <Box size={18} className="text-accent-500" aria-hidden="true" />
                  <span>{isRtl ? 'الجولة الافتراضية الحقيقية' : 'Real Virtual Tour'}</span>
                </h3>
                <a
                  href={validatedTourUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1.5 text-xs sm:text-sm font-bold text-brand-600 dark:text-accent-400 hover:underline"
                >
                  <span>{isRtl ? 'افتح الجولة في نافذة كاملة' : 'Open tour in full window'}</span>
                  <ExternalLink size={14} aria-hidden="true" />
                </a>
              </div>
              <div
                className="relative w-full rounded-2xl overflow-hidden border border-slate-200 dark:border-slate-800 bg-slate-100 dark:bg-slate-800"
                style={{ aspectRatio: '16 / 10' }}
              >
                <iframe
                  src={validatedTourUrl}
                  title={isRtl ? 'جولة افتراضية' : 'Virtual Tour'}
                  className="absolute inset-0 w-full h-full"
                  sandbox="allow-scripts allow-same-origin allow-popups"
                  allow="xr-spatial-tracking; gyroscope; accelerometer; fullscreen"
                  allowFullScreen
                  loading="lazy"
                />
              </div>
            </section>
          )}

          {/* Seller-Stated Legal Details (STRICT copy honesty) */}
          <section className="bg-white dark:bg-slate-900 rounded-3xl border border-slate-200/80 dark:border-slate-800 p-6 shadow-sm">
            <h3 className="font-heading font-extrabold text-lg text-slate-900 dark:text-white mb-1 flex items-center gap-2">
              <Shield size={18} className="text-brand-600 dark:text-brand-400" aria-hidden="true" />
              <span>{isRtl ? 'التفاصيل القانونية' : 'Legal Details'}</span>
            </h3>
            <p className="text-xs font-medium text-slate-500 dark:text-slate-400 mb-4 flex items-center gap-1.5">
              <Info size={13} className="shrink-0 text-slate-400" aria-hidden="true" />
              <span>{t.listing_seller_stated}</span>
            </p>
            <div className="grid sm:grid-cols-2 gap-3">
              <div className="flex justify-between items-center gap-3 bg-slate-50 dark:bg-slate-800/70 px-4 py-3.5 rounded-xl border border-slate-100 dark:border-slate-700/70 text-sm">
                <span className="text-slate-500 dark:text-slate-400">
                  {isRtl ? 'رقم الشهر العقاري' : 'Registry Number'}
                </span>
                <span className="font-bold text-slate-900 dark:text-white text-end">
                  {property.registrationNumber || (isRtl ? 'غير متاح' : 'N/A')}
                </span>
              </div>
              <div className="flex justify-between items-center gap-3 bg-slate-50 dark:bg-slate-800/70 px-4 py-3.5 rounded-xl border border-slate-100 dark:border-slate-700/70 text-sm">
                <span className="text-slate-500 dark:text-slate-400">
                  {isRtl ? 'صحة توقيع المحكمة' : 'Court Signature'}
                </span>
                <span className="font-bold text-slate-900 dark:text-white text-end">
                  {property.courtSignatureValidity
                    ? isRtl
                      ? 'البائع بيقول: صحيح'
                      : 'Seller says: valid'
                    : isRtl
                      ? 'غير محدد'
                      : 'Not stated'}
                </span>
              </div>
              <div className="flex justify-between items-center gap-3 bg-slate-50 dark:bg-slate-800/70 px-4 py-3.5 rounded-xl border border-slate-100 dark:border-slate-700/70 text-sm">
                <span className="text-slate-500 dark:text-slate-400">{isRtl ? 'نوع البيع' : 'Sale Type'}</span>
                <span className="font-bold text-slate-900 dark:text-white text-end">
                  {property.isResale ? (isRtl ? 'إعادة بيع' : 'Resale') : isRtl ? 'بيع مباشر' : 'Direct'}
                </span>
              </div>
              <div className="flex justify-between items-center gap-3 bg-slate-50 dark:bg-slate-800/70 px-4 py-3.5 rounded-xl border border-slate-100 dark:border-slate-700/70 text-sm">
                <span className="text-slate-500 dark:text-slate-400">{isRtl ? 'حالة التوفر' : 'Availability'}</span>
                <span className="font-bold text-slate-900 dark:text-white text-end">{av.label}</span>
              </div>
            </div>
          </section>

          {/* Amenities */}
          {property.amenities && property.amenities.length > 0 && (
            <section className="bg-white dark:bg-slate-900 rounded-3xl border border-slate-200/80 dark:border-slate-800 p-6 shadow-sm">
              <h3 className="font-heading font-extrabold text-lg text-slate-900 dark:text-white mb-4">
                {isRtl ? 'المميزات والخدمات' : 'Amenities'}
              </h3>
              <div className="flex flex-wrap gap-2.5">
                {property.amenities.map((a) => (
                  <span
                    key={a}
                    className="inline-flex items-center gap-1.5 px-3.5 py-2 bg-slate-50 dark:bg-slate-800 text-slate-700 dark:text-slate-200 rounded-xl text-sm font-semibold border border-slate-200/70 dark:border-slate-700"
                  >
                    <CheckCircle size={14} className="text-accent-500 shrink-0" aria-hidden="true" />
                    <span>{amenityLabel(a, isRtl)}</span>
                  </span>
                ))}
              </div>
            </section>
          )}

          {/* Structured Payment Plans & Available Payment Methods */}
          <section className="bg-white dark:bg-slate-900 rounded-3xl border border-slate-200/80 dark:border-slate-800 p-6 shadow-sm space-y-6">
            {property.paymentPlans && property.paymentPlans.length > 0 && (
              <div>
                <h3 className="font-heading font-extrabold text-lg text-slate-900 dark:text-white mb-3 flex items-center gap-2">
                  <CreditCard size={18} className="text-accent-500" aria-hidden="true" />
                  <span>{isRtl ? 'خطط السداد' : 'Payment Plans'}</span>
                </h3>
                <div className="grid sm:grid-cols-2 gap-3">
                  {property.paymentPlans.map((pl, idx) => (
                    <div
                      key={idx}
                      className="bg-accent-50/60 dark:bg-accent-950/25 rounded-2xl p-4 border border-accent-200/70 dark:border-accent-800/50"
                    >
                      <div className="flex items-baseline gap-2 flex-wrap">
                        {pl.downPayment ? (
                          <span className="text-xl font-black text-brand-700 dark:text-accent-400 tabular-nums">
                            {pl.downPayment}%
                          </span>
                        ) : null}
                        <span className="text-sm font-semibold text-slate-600 dark:text-slate-300">
                          {isRtl ? 'مقدم' : 'down'}
                        </span>
                        {pl.years ? (
                          <span className="text-sm font-bold text-slate-800 dark:text-slate-200 tabular-nums">
                            · {pl.years} {isRtl ? 'سنة' : 'yrs'}
                          </span>
                        ) : null}
                      </div>
                      {pl.note && <p className="text-xs text-slate-500 dark:text-slate-400 mt-1.5">{pl.note}</p>}
                    </div>
                  ))}
                </div>
              </div>
            )}

            <div>
              <h3 className="font-heading font-extrabold text-base sm:text-lg text-slate-900 dark:text-white mb-3">
                {isRtl ? 'طرق الدفع المتاحة' : 'Available Payment Methods'}
              </h3>
              <div className="flex flex-wrap gap-2">
                {property.paymentMethods?.map((m) => (
                  <span
                    key={m}
                    className="px-3.5 py-1.5 bg-brand-50 dark:bg-brand-900/40 text-brand-700 dark:text-brand-200 rounded-xl text-sm font-bold border border-brand-100 dark:border-brand-800"
                  >
                    {paymentLabel(m, isRtl)}
                  </span>
                ))}
                {(!property.paymentMethods || property.paymentMethods.length === 0) && (
                  <span className="text-slate-500 dark:text-slate-400 text-sm">
                    {isRtl ? 'غير محدد' : 'Not specified'}
                  </span>
                )}
              </div>
            </div>
          </section>

          {/* Upgraded Installment Calculator */}
          {property.status === 'For Sale' && safePrice > 0 && (
            <section className="bg-gradient-to-br from-brand-50/80 via-white to-accent-50/50 dark:from-slate-900 dark:via-slate-900 dark:to-brand-950/40 rounded-3xl border border-slate-200/90 dark:border-slate-800 p-6 shadow-sm">
              <div className="flex flex-wrap items-start justify-between gap-3 mb-2">
                <div>
                  <h3 className="font-heading font-extrabold text-lg text-slate-900 dark:text-white flex items-center gap-2">
                    <Calculator size={18} className="text-accent-500" aria-hidden="true" />
                    <span>{isRtl ? 'حاسبة التقسيط (تقديرية)' : 'Installment Estimate'}</span>
                  </h3>
                  <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
                    {isRtl
                      ? 'تقدير بأقساط متساوية بدون فوائد — للاسترشاد فقط، مش سعر رسمي.'
                      : 'Rough equal-installment estimate (no interest) — guidance only, not an official quote.'}
                  </p>
                </div>

                {/* Quick Year Presets */}
                <div className="flex items-center gap-1.5" role="group" aria-label={isRtl ? 'مدد تقسيط سريعة' : 'Quick year presets'}>
                  {[5, 7, 10].map((yr) => (
                    <button
                      key={yr}
                      type="button"
                      onClick={() => setCalcYears(yr)}
                      aria-pressed={safeYears === yr}
                      className={`px-3 py-1.5 rounded-full text-xs font-bold transition-all cursor-pointer focus:outline-none focus:ring-2 focus:ring-brand-500 ${
                        safeYears === yr
                          ? 'bg-brand-600 dark:bg-accent-500 text-white shadow-sm'
                          : 'bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-300 border border-slate-200 dark:border-slate-700 hover:border-brand-400'
                      }`}
                    >
                      {isRtl ? `${yr} سنوات` : `${yr} yrs`}
                    </button>
                  ))}
                </div>
              </div>

              <div className="grid sm:grid-cols-2 gap-5 my-5">
                <div className="bg-white/80 dark:bg-slate-900/70 rounded-2xl p-4 border border-slate-200/70 dark:border-slate-800">
                  <label
                    htmlFor="calc-down-slider"
                    className="text-xs font-bold text-slate-600 dark:text-slate-300 flex justify-between items-center mb-2"
                  >
                    <span>{isRtl ? 'المقدم' : 'Down payment'}</span>
                    <span className="px-2 py-0.5 rounded-md bg-brand-100 dark:bg-brand-900/60 text-brand-700 dark:text-brand-200 tabular-nums">
                      {safeDownPct}%
                    </span>
                  </label>
                  <input
                    id="calc-down-slider"
                    type="range"
                    min="0"
                    max="50"
                    step="5"
                    value={safeDownPct}
                    onChange={(e) => setCalcDown(Number(e.target.value))}
                    className="w-full accent-brand-600 cursor-pointer"
                  />
                  <div className="flex justify-between text-[10px] text-slate-400 mt-1 tabular-nums">
                    <span>0%</span>
                    <span>25%</span>
                    <span>50%</span>
                  </div>
                </div>

                <div className="bg-white/80 dark:bg-slate-900/70 rounded-2xl p-4 border border-slate-200/70 dark:border-slate-800">
                  <label
                    htmlFor="calc-years-slider"
                    className="text-xs font-bold text-slate-600 dark:text-slate-300 flex justify-between items-center mb-2"
                  >
                    <span>{isRtl ? 'عدد السنين' : 'Years'}</span>
                    <span className="px-2 py-0.5 rounded-md bg-accent-100 dark:bg-accent-900/50 text-accent-700 dark:text-accent-300 tabular-nums">
                      {safeYears} {isRtl ? 'سنة' : 'yrs'}
                    </span>
                  </label>
                  <input
                    id="calc-years-slider"
                    type="range"
                    min="1"
                    max="15"
                    step="1"
                    value={safeYears}
                    onChange={(e) => setCalcYears(Number(e.target.value))}
                    className="w-full accent-accent-500 cursor-pointer"
                  />
                  <div className="flex justify-between text-[10px] text-slate-400 mt-1 tabular-nums">
                    <span>1</span>
                    <span>7</span>
                    <span>15</span>
                  </div>
                </div>
              </div>

              {/* 3 KPI Result Tiles */}
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-center">
                <div className="bg-white dark:bg-slate-900 rounded-2xl p-4 border border-slate-200/70 dark:border-slate-800">
                  <div className="text-[11px] font-semibold text-slate-500 dark:text-slate-400">
                    {isRtl ? 'المقدم' : 'Down payment'}
                  </div>
                  <div className="text-lg font-black text-brand-700 dark:text-brand-300 mt-1 tabular-nums">
                    {downPaymentAmount.toLocaleString()} {currency}
                  </div>
                </div>

                <div className="bg-brand-600 dark:bg-accent-500 text-white rounded-2xl p-4 shadow-md shadow-brand-600/15 dark:shadow-accent-500/25">
                  <div className="text-[11px] font-semibold text-white/80">
                    {isRtl ? 'القسط الشهري التقديري' : 'Monthly estimate'}
                  </div>
                  <div className="text-lg font-black text-white mt-1 tabular-nums">
                    {monthlyEstimate.toLocaleString()} {currency}
                  </div>
                </div>

                <div className="bg-white dark:bg-slate-900 rounded-2xl p-4 border border-slate-200/70 dark:border-slate-800">
                  <div className="text-[11px] font-semibold text-slate-500 dark:text-slate-400">
                    {isRtl ? 'المتبقي للتقسيط' : 'Financed balance'}
                  </div>
                  <div className="text-lg font-black text-slate-900 dark:text-white mt-1 tabular-nums">
                    {financedBalance.toLocaleString()} {currency}
                  </div>
                </div>
              </div>
            </section>
          )}

          {/* Seller Contact + Primary CTA */}
          <section className="space-y-4">
            {property.contactPhone && (
              <div className="bg-white dark:bg-slate-900 rounded-3xl border border-slate-200/80 dark:border-slate-800 p-6 shadow-sm">
                <h3 className="font-heading font-extrabold text-base sm:text-lg text-slate-900 dark:text-white mb-3">
                  {isRtl ? 'تواصل مع البائع' : 'Contact the seller'}
                </h3>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <a
                    href={`https://wa.me/${(property.contactPhone || '').replace(/\D/g, '')}?text=${encodeURIComponent(
                      isRtl
                        ? `مرحبًا، مهتم بالعقار ${property.unitCode || property.title}`
                        : `Hi, I'm interested in ${property.unitCode || property.title}`
                    )}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-center justify-center gap-2 py-3.5 px-5 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white font-bold transition-colors shadow-sm"
                  >
                    <MessageSquare size={18} aria-hidden="true" />
                    <span>{isRtl ? 'واتساب' : 'WhatsApp'}</span>
                  </a>
                  <a
                    href={`tel:${property.contactPhone}`}
                    className="flex items-center justify-center gap-2 py-3.5 px-5 rounded-xl bg-brand-600 dark:bg-accent-500 hover:bg-brand-700 dark:hover:bg-accent-600 text-white font-bold transition-colors shadow-sm"
                  >
                    <Phone size={18} aria-hidden="true" />
                    <span>{isRtl ? 'اتصال' : 'Call'}</span>
                  </a>
                </div>
              </div>
            )}

            {av.taken ? (
              <div className="w-full py-4 px-6 text-base sm:text-lg text-center font-bold rounded-2xl bg-slate-100 dark:bg-slate-800 text-slate-500 dark:text-slate-400 border border-slate-200 dark:border-slate-700">
                {isRtl ? `هذا العقار ${av.label} حاليًا` : `This property is ${av.label}`}
              </div>
            ) : (
              <BrandButton
                variant="accent"
                onClick={() => onPurchase(property.id)}
                className="w-full py-4 text-base sm:text-lg rounded-2xl"
              >
                {isRtl ? 'اطلب الوحدة دي' : 'Request this property'}
              </BrandButton>
            )}
          </section>

          {/* Community Reviews */}
          <section className="bg-white dark:bg-slate-900 rounded-3xl border border-slate-200/80 dark:border-slate-800 p-6 shadow-sm">
            <div className="flex items-center justify-between gap-3 mb-4 flex-wrap">
              <div className="flex items-center gap-2.5">
                <h3 className="font-heading font-extrabold text-lg text-slate-900 dark:text-white">
                  {isRtl ? 'التقييمات' : 'Reviews'}
                </h3>
                {reviews.length > 0 && (
                  <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-amber-50 dark:bg-amber-950/40 text-amber-600 dark:text-amber-400 text-xs font-black">
                    <Star size={14} fill="currentColor" aria-hidden="true" />
                    <span className="tabular-nums">{avgRating.toFixed(1)}</span>
                    <span className="text-slate-500 dark:text-slate-400 font-semibold">({reviews.length})</span>
                  </span>
                )}
              </div>
            </div>

            <div className="bg-slate-50 dark:bg-slate-800/60 rounded-2xl p-4 mb-5 border border-slate-200/70 dark:border-slate-700/70">
              <div
                className="flex items-center gap-1 mb-2"
                role="radiogroup"
                aria-label={isRtl ? 'التقييم بالنجوم' : 'Rating stars'}
              >
                {[1, 2, 3, 4, 5].map((n) => (
                  <button
                    key={n}
                    type="button"
                    onClick={() => setReviewRating(n)}
                    aria-label={isRtl ? `${n} نجوم من 5` : `${n} stars out of 5`}
                    aria-pressed={reviewRating === n}
                    className="min-w-[44px] min-h-[44px] p-2 flex items-center justify-center cursor-pointer focus:outline-none focus:ring-2 focus:ring-amber-400 rounded-xl transition-transform active:scale-95"
                  >
                    <Star
                      size={22}
                      className={n <= reviewRating ? 'text-amber-500' : 'text-slate-300 dark:text-slate-600'}
                      fill={n <= reviewRating ? 'currentColor' : 'none'}
                      aria-hidden="true"
                    />
                  </button>
                ))}
              </div>
              <textarea
                value={reviewComment}
                onChange={(e) => setReviewComment(e.target.value)}
                rows={2}
                placeholder={isRtl ? 'اكتب تعليقك عن الإعلان...' : 'Write your review...'}
                className="w-full px-3.5 py-2.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-900 dark:text-white text-sm outline-none focus:ring-2 focus:ring-brand-500"
              />
              <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
                <button
                  type="button"
                  onClick={submitReview}
                  disabled={submittingReview || !reviewComment.trim()}
                  className="bg-brand-600 hover:bg-brand-700 disabled:opacity-50 text-white px-5 py-2.5 rounded-xl text-sm font-bold transition-colors cursor-pointer disabled:cursor-not-allowed focus:outline-none focus:ring-2 focus:ring-brand-500"
                >
                  {submittingReview
                    ? isRtl
                      ? 'جاري الإرسال...'
                      : 'Submitting...'
                    : isRtl
                      ? 'إرسال التقييم'
                      : 'Submit review'}
                </button>

                {reviewNotice && (
                  <p
                    role="status"
                    aria-live="polite"
                    className={`text-xs font-bold ${
                      reviewNotice.type === 'success'
                        ? 'text-emerald-600 dark:text-emerald-400'
                        : 'text-rose-600 dark:text-rose-400'
                    }`}
                  >
                    {reviewNotice.text}
                  </p>
                )}
              </div>
            </div>

            {reviewsLoading ? (
              <div className="space-y-3" aria-busy="true" aria-label={isRtl ? 'جاري تحميل التقييمات' : 'Loading reviews'}>
                {[0, 1].map((sk) => (
                  <div
                    key={sk}
                    className="h-16 rounded-2xl bg-slate-100 dark:bg-slate-800 animate-pulse"
                  />
                ))}
              </div>
            ) : reviews.length > 0 ? (
              <div className="space-y-3">
                {reviews.map((r) => (
                  <div
                    key={r.id}
                    className="bg-slate-50/70 dark:bg-slate-800/40 border border-slate-100 dark:border-slate-800 rounded-2xl p-4"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-bold text-sm text-slate-900 dark:text-white">{r.userName}</span>
                      <span className="flex items-center gap-0.5" aria-label={`${r.rating} / 5`}>
                        {Array.from({ length: 5 }).map((_, i) => (
                          <Star
                            key={i}
                            size={13}
                            fill={i < r.rating ? 'currentColor' : 'none'}
                            className={i < r.rating ? 'text-amber-500' : 'text-slate-300 dark:text-slate-600'}
                            aria-hidden="true"
                          />
                        ))}
                      </span>
                    </div>
                    <p className="text-sm text-slate-600 dark:text-slate-300 mt-1.5 whitespace-pre-wrap leading-relaxed">
                      {r.comment}
                    </p>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-sm text-slate-500 dark:text-slate-400 text-center py-4">
                {isRtl ? 'مفيش تقييمات لسه — كن أول واحد.' : 'No reviews yet — be the first.'}
              </p>
            )}
          </section>

          {/* Report Listing */}
          <div className="pt-1">
            {!reportOpen ? (
              <button
                type="button"
                onClick={() => {
                  setReportNotice(null);
                  setReportOpen(true);
                }}
                disabled={reporting}
                className="w-full text-center text-xs font-bold text-slate-400 hover:text-rose-500 transition-colors py-2 flex items-center justify-center gap-1.5 disabled:opacity-50 cursor-pointer"
              >
                <Flag size={13} aria-hidden="true" />
                <span>{isRtl ? 'بلّغ عن هذا الإعلان' : 'Report this listing'}</span>
              </button>
            ) : (
              <form
                onSubmit={handleSubmitReport}
                className="bg-rose-50/60 dark:bg-rose-950/20 border border-rose-200 dark:border-rose-900/60 rounded-2xl p-4 space-y-3"
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="text-sm font-bold text-rose-800 dark:text-rose-300 flex items-center gap-1.5">
                    <AlertCircle size={15} aria-hidden="true" />
                    <span>{isRtl ? 'سبب البلاغ عن الإعلان' : 'Reason for reporting this listing'}</span>
                  </span>
                  <button
                    type="button"
                    onClick={() => setReportOpen(false)}
                    aria-label={isRtl ? 'إلغاء البلاغ' : 'Cancel report'}
                    className="p-1 rounded-lg text-slate-500 hover:text-slate-800 dark:hover:text-white cursor-pointer"
                  >
                    <X size={16} aria-hidden="true" />
                  </button>
                </div>
                <textarea
                  value={reportReason}
                  onChange={(e) => setReportReason(e.target.value)}
                  rows={2}
                  required
                  placeholder={
                    isRtl
                      ? 'اكتب سبب البلاغ (معلومات خاطئة، سعر غير دقيق، إعلان مكرر...)'
                      : 'Describe the issue (inaccurate info, duplicate listing, etc.)'
                  }
                  className="w-full px-3 py-2 rounded-xl border border-rose-200 dark:border-rose-800 bg-white dark:bg-slate-900 text-slate-900 dark:text-white text-sm outline-none focus:ring-2 focus:ring-rose-500"
                />
                <div className="flex items-center gap-2">
                  <button
                    type="submit"
                    disabled={reporting || !reportReason.trim()}
                    className="px-4 py-2 rounded-xl bg-rose-600 hover:bg-rose-700 disabled:opacity-50 text-white text-xs font-bold cursor-pointer"
                  >
                    {reporting ? (isRtl ? 'جاري الإرسال...' : 'Sending...') : isRtl ? 'إرسال البلاغ' : 'Submit report'}
                  </button>
                  <button
                    type="button"
                    onClick={() => setReportOpen(false)}
                    className="px-4 py-2 rounded-xl bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 text-xs font-bold cursor-pointer"
                  >
                    {isRtl ? 'إلغاء' : 'Cancel'}
                  </button>
                </div>
              </form>
            )}

            {reportNotice && (
              <p
                role="status"
                aria-live="polite"
                className={`mt-2 text-center text-xs font-bold ${
                  reportNotice.type === 'success'
                    ? 'text-emerald-600 dark:text-emerald-400'
                    : 'text-rose-600 dark:text-rose-400'
                }`}
              >
                {reportNotice.text}
              </p>
            )}
          </div>
        </div>

        {/* Sticky Unit AI Assistant Column */}
        <aside className="lg:col-span-1">
          <div className="lg:sticky lg:top-24 bg-white dark:bg-slate-900 rounded-3xl border border-slate-200/90 dark:border-slate-800 shadow-xl overflow-hidden flex flex-col h-[34rem] lg:h-[calc(100dvh-7.5rem)]">
            {/* Branded Assistant Header */}
            <div className="p-4 border-b border-brand-800/20 bg-gradient-to-r from-brand-700 via-brand-600 to-brand-700 text-white flex items-center gap-3 shrink-0">
              <div className="w-10 h-10 rounded-2xl bg-accent-500/20 border border-accent-400/40 text-accent-300 flex items-center justify-center shrink-0">
                <Sparkles size={18} aria-hidden="true" />
              </div>
              <div className="min-w-0">
                <h2 className="font-heading font-black text-sm leading-tight truncate">
                  {isRtl ? 'المساعد الذكي للوحدة' : 'Unit AI Assistant'}
                </h2>
                <p className="text-[11px] text-white/75 truncate">
                  {isRtl ? 'اسأل أي حاجة عن العقار ده' : 'Ask anything about this property'}
                </p>
              </div>
            </div>

            {/* Messages Feed */}
            <div
              ref={scrollRef}
              className="flex-1 overflow-y-auto p-4 space-y-3.5 bg-slate-50/70 dark:bg-slate-950/40 custom-scrollbar"
            >
              {messages.map((msg, i) => {
                const isUser = msg.role === 'user';
                const imgMatches = msg.text.match(/!\[.*?\]\((.*?)\)/g);
                return (
                  <div
                    key={i}
                    className={`flex ${isUser ? 'justify-end' : 'justify-start'} animate-fade-in`}
                  >
                    <div
                      className={`max-w-[90%] p-3.5 rounded-2xl shadow-xs text-[13.5px] leading-relaxed ${
                        isUser
                          ? 'bg-brand-600 dark:bg-accent-500 text-white rounded-ee-none'
                          : 'bg-white dark:bg-slate-800 text-slate-800 dark:text-slate-100 rounded-es-none border border-slate-200/70 dark:border-slate-700'
                      }`}
                    >
                      {imgMatches ? (
                        <>
                          <p className="whitespace-pre-wrap">{msg.text.replace(/!\[.*?\]\((.*?)\)/g, '').trim()}</p>
                          {imgMatches.map((imgMatch, idx) => {
                            const url = imgMatch.match(/\((.*?)\)/)?.[1];
                            return url ? (
                              <img
                                key={idx}
                                src={url}
                                alt={property.title}
                                className="mt-2 rounded-xl border border-slate-200 dark:border-slate-700 w-full object-cover"
                              />
                            ) : null;
                          })}
                        </>
                      ) : (
                        <p className="whitespace-pre-wrap">{msg.text}</p>
                      )}
                    </div>
                  </div>
                );
              })}

              {isLoading && (
                <div className="flex justify-start animate-fade-in">
                  <div className="bg-white dark:bg-slate-800 px-4 py-3 rounded-2xl rounded-es-none border border-slate-200/70 dark:border-slate-700 flex items-center gap-2 text-xs font-semibold text-slate-500 dark:text-slate-400">
                    <Loader2 className="w-4 h-4 text-accent-500 animate-spin" aria-hidden="true" />
                    <span>{t.ai_thinking || (isRtl ? 'يفكر...' : 'Thinking...')}</span>
                  </div>
                </div>
              )}
            </div>

            {/* One-Click Quick Prompt Chips + Input Composer */}
            <div className="p-3 bg-white dark:bg-slate-900 border-t border-slate-200/80 dark:border-slate-800 shrink-0 space-y-2.5">
              <div className="flex items-center gap-1.5 overflow-x-auto no-scrollbar pb-0.5">
                {quickPrompts.map((qp, idx) => (
                  <button
                    key={idx}
                    type="button"
                    disabled={isLoading}
                    onClick={() => void sendPrompt(qp.prompt)}
                    className="px-3 py-1.5 rounded-full bg-brand-50 dark:bg-slate-800 hover:bg-accent-50 dark:hover:bg-accent-950/40 text-brand-700 dark:text-slate-200 hover:text-accent-700 dark:hover:text-accent-300 border border-brand-100 dark:border-slate-700 text-[11px] font-bold whitespace-nowrap transition-colors cursor-pointer disabled:opacity-50"
                  >
                    {qp.label}
                  </button>
                ))}
              </div>

              <form onSubmit={handleSendMessage} className="relative flex items-center">
                <input
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  placeholder={isRtl ? 'اسأل عن العقار...' : 'Ask about this property...'}
                  aria-label={isRtl ? 'اسأل المساعد الذكي عن العقار' : 'Ask the AI assistant about this property'}
                  className="w-full bg-slate-50 dark:bg-slate-950/60 border border-slate-200 dark:border-slate-700 rounded-xl py-3 ps-4 pe-12 text-sm focus:outline-none focus:ring-2 focus:ring-accent-500 text-slate-900 dark:text-white"
                />
                <button
                  type="submit"
                  disabled={!input.trim() || isLoading}
                  aria-label={isRtl ? 'إرسال السؤال' : 'Send message'}
                  className="absolute end-2 p-2 bg-brand-600 dark:bg-accent-500 hover:bg-brand-700 dark:hover:bg-accent-600 text-white rounded-lg disabled:opacity-50 transition-colors cursor-pointer"
                >
                  <Send size={16} className={isRtl ? 'rotate-180' : ''} aria-hidden="true" />
                </button>
              </form>
            </div>
          </div>
        </aside>
      </div>

      {/* Lazy-Loaded 3D / 360° Viewer Modal */}
      {show3D && (
        <LoadErrorBoundary onClose={() => setShow3D(false)} isRtl={isRtl}>
          <React.Suspense fallback={<Loading3DFallback isRtl={isRtl} />}>
            <Property3DViewer
              images={displayImages}
              depthMaps={property.depthMaps}
              panoramas={property.panoramas}
              tourUrl={validatedTourUrl}
              threeDTour={property.threeDTour}
              title={property.title}
              propertyId={property.id}
              onClose={() => setShow3D(false)}
              isRtl={isRtl}
            />
          </React.Suspense>
        </LoadErrorBoundary>
      )}
    </div>
  );
};

export default PropertyDetailPage;
