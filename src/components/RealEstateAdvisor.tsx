import React, { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import {
  Sparkles,
  RefreshCw,
  Send,
  User,
  Download,
  RotateCcw,
  Building2,
  Box,
  ArrowUpRight,
  History,
  X,
  CheckCircle2,
  Cpu,
  AlertCircle,
} from 'lucide-react';
import {
  Property,
  ChatMessage,
  ChatSession,
  AdvisorFinancialProfile,
  AdvisorPropertyFit,
} from '../types';
import {
  generateContent,
  AIRequestError,
  extract3DMarker,
  extractAdvisorState,
  Message as AiWireMessage,
} from '../ai';
import {
  auth,
  db,
  doc,
  updateDoc,
  addDoc,
  collection,
  query,
  where,
  onSnapshot,
} from '../firebase';
import {
  DISTRICT_BENCHMARKS,
  TOP_DEVELOPERS,
  PRIME_HUBS,
  calculateFinancialPlan,
} from '../lib/marketIntelligence';

export { DISTRICT_BENCHMARKS, TOP_DEVELOPERS, PRIME_HUBS };

interface RealEstateAdvisorProps {
  t: any;
  isRtl: boolean;
  properties: Property[];
  userName?: string | null;
  onShow3D?: (propertyId: string) => void;
  onOpenProperty?: (propertyId: string) => void;
}

interface AdvisorUiMessage extends ChatMessage {
  id?: string;
  isFallback?: boolean;
  isError?: boolean;
  retryPrompt?: string;
  matchedPropertyIds?: string[];
}

type AdvisorConnectionStatus = 'online' | 'local-engine';

const DEFAULT_ADVISOR_PROFILE: AdvisorFinancialProfile = {
  budget: 0,
  downPayment: 0,
  monthlyCapacity: 0,
  currency: 'EGP',
  purpose: 'all',
  preferredLocation: 'all',
  propertyType: 'All',
  deliveryTimeline: 'all',
  preferredPaymentPlan: 'all',
  bedrooms: 'all',
};

export const getDistrictBenchmark = (location: string, propertyType?: string) => {
  const normLoc = (location || '').toLowerCase();
  let found = DISTRICT_BENCHMARKS['Default'];

  for (const [key, val] of Object.entries(DISTRICT_BENCHMARKS)) {
    if (key !== 'Default' && normLoc.includes(key.toLowerCase())) {
      found = val;
      break;
    }
  }

  const normType = (propertyType || '').toLowerCase();
  if (
    normType.includes('office') ||
    normType.includes('مكتب') ||
    normType.includes('retail') ||
    normType.includes('محل') ||
    normType.includes('تجاري')
  ) {
    return {
      rentalYield: found.rentalYield + 3.5,
      capitalGrowth: found.capitalGrowth + 1.5,
    };
  }

  if (normType.includes('chalet') || normType.includes('شاليه')) {
    return {
      rentalYield: Math.max(found.rentalYield, 13.0),
      capitalGrowth: Math.max(found.capitalGrowth, 22.0),
    };
  }

  return found;
};

export const calculatePropertyFit = (
  property: Property,
  profile: AdvisorFinancialProfile,
  isRtl: boolean
): AdvisorPropertyFit => {
  const price = property.price || property.projectPriceFrom || 0;
  const currency = property.currency || 'EGP';

  // 1. Payment Plan details from listing
  let downPercent = 15;
  let installmentYears = 6;

  if (property.paymentPlans && property.paymentPlans.length > 0) {
    const bestPlan = property.paymentPlans[0];
    if (bestPlan.downPayment && bestPlan.downPayment > 0) {
      downPercent = bestPlan.downPayment;
    }
    if (bestPlan.years && bestPlan.years > 0) {
      installmentYears = bestPlan.years;
    }
  }

  const downPaymentRequired = Math.round(price * (downPercent / 100));
  const remainingPrincipal = Math.max(0, price - downPaymentRequired);
  const monthlyInstallment =
    installmentYears > 0 ? Math.round(remainingPrincipal / (installmentYears * 12)) : 0;

  // 2. Real Estate Benchmark Metrics
  const benchmark = getDistrictBenchmark(property.location, property.propertyType);
  const rentalYieldPercent = benchmark.rentalYield;
  const capitalAppreciationPercent = benchmark.capitalGrowth;
  const estimatedAnnualRent = Math.round(price * (rentalYieldPercent / 100));
  const totalAnnualReturnPercent =
    Math.round((rentalYieldPercent + capitalAppreciationPercent) * 10) / 10;
  const totalAnnualGain =
    estimatedAnnualRent + Math.round(price * (capitalAppreciationPercent / 100));
  const paybackYears =
    totalAnnualGain > 0 ? Math.round((price / totalAnnualGain) * 10) / 10 : 10;

  // 3. Real Estate Advisory Suitability & Scoring
  const reasons: string[] = [];
  let score = 95;

  // District / Location Evaluation
  if (
    profile.preferredLocation &&
    profile.preferredLocation !== 'all' &&
    profile.preferredLocation !== 'All'
  ) {
    const locMatch = (property.location || '')
      .toLowerCase()
      .includes(profile.preferredLocation.toLowerCase());
    if (locMatch) {
      score += 10;
      reasons.push(
        isRtl
          ? `الموقع يطابق المنطقة المستهدفة بالكامل (${property.location})`
          : `Location matches preferred target area (${property.location})`
      );
    } else {
      score -= 30;
      reasons.push(
        isRtl
          ? `يقع خارج المنطقة المستهدفة المحددة (${property.location})`
          : `Located outside target district (${property.location})`
      );
    }
  } else {
    reasons.push(
      isRtl
        ? `موقع مميز واستراتيجي في ${property.location}`
        : `Strategic prime location in ${property.location}`
    );
  }

  // Property Type Evaluation
  if (profile.propertyType && profile.propertyType !== 'All' && profile.propertyType !== 'all') {
    const typeMatch = (property.propertyType || '')
      .toLowerCase()
      .includes(profile.propertyType.toLowerCase());
    if (typeMatch) {
      score += 10;
      reasons.push(
        isRtl
          ? `نوع الوحدة يطابق اختيارك (${property.propertyType})`
          : `Property type matches specification (${property.propertyType})`
      );
    } else {
      score -= 20;
    }
  }

  // Delivery Timeline Evaluation
  if (profile.deliveryTimeline && profile.deliveryTimeline !== 'all') {
    const isReady =
      (!!property.deliveryDate && property.deliveryDate.toLowerCase().includes('ready')) ||
      (!!property.deliveryTimeline && property.deliveryTimeline.toLowerCase().includes('ready'));
    if (profile.deliveryTimeline === 'ready') {
      if (isReady) {
        score += 10;
        reasons.push(
          isRtl ? 'جاهز للاستلام الفوري بدون فترات انتظار' : 'Ready to move immediately'
        );
      } else {
        score -= 15;
      }
    } else if (profile.deliveryTimeline === '1-2years') {
      reasons.push(
        isRtl
          ? 'موعد استلام قريب مع تيسيرات سداد ممتدة'
          : 'Near-term handover with flexible payment milestones'
      );
    }
  }

  // Purpose Evaluation
  if (profile.purpose === 'coastal') {
    if (
      property.yallaSahel ||
      (property.propertyType && property.propertyType.toLowerCase().includes('chalet'))
    ) {
      score += 15;
      reasons.push(
        isRtl
          ? 'وحدة ساحلية ممتازة للمصايف والعطلات الصيفية'
          : 'Prime coastal unit for vacation and seasonal enjoyment'
      );
    }
  } else if (profile.purpose === 'investment') {
    reasons.push(
      isRtl
        ? 'عقار يتميز بطلب إيجاري قوي وموقع حيوي للمستأجرين'
        : 'High tenant demand with sustained rental appeal'
    );
  } else if (profile.purpose === 'residential') {
    reasons.push(
      isRtl
        ? 'بيئة سكنية متكاملة الخدمات مناسبة للأسرة والاستقرار'
        : 'Family-oriented community with comprehensive amenities'
    );
  }

  // Real 3D / 360 Panorama / Spatial Media Evaluation
  const hasReal3D = !!(property.threeDTour?.assetUrl || property.digitalTwinUrl);
  const has360 = !!(property.panoramas && property.panoramas.length > 0);
  const hasPhotoRelief = !!(property.images && property.images.length > 1);

  if (hasReal3D) {
    score += 6;
    reasons.push(
      isRtl
        ? 'متوفر جولة افتراضية تفاعلية ثلاثية الأبعاد (3D Walkthrough)'
        : 'Interactive 3D digital walkthrough available'
    );
  } else if (has360) {
    score += 4;
    reasons.push(
      isRtl ? 'متوفر جولة بانوراما 360° استعراضية' : '360° immersive panorama available'
    );
  } else if (hasPhotoRelief) {
    score += 2;
    reasons.push(
      isRtl ? 'معاينة مجسمة للصور متعددة الزوايا' : 'Multi-angle relief preview available'
    );
  }

  // Budget comparison (when explicitly provided)
  if (profile.budget > 0 && price > 0) {
    if (price <= profile.budget) {
      reasons.push(
        isRtl
          ? `السعر ضمن النطاق المقدر (${price.toLocaleString()} ${currency})`
          : `Price within target range (${price.toLocaleString()} ${currency})`
      );
    } else {
      const diff = price - profile.budget;
      const ratio = diff / profile.budget;
      if (ratio <= 0.15) {
        score -= 15;
        reasons.push(
          isRtl
            ? `أعلى من الميزانية بنسبة طفيفة (${Math.round(ratio * 100)}%) — يمكن تعويضها بالقسط المريح`
            : `Slightly above budget (${Math.round(ratio * 100)}%) — manageable with installments`
        );
      } else {
        score -= 35;
        reasons.push(
          isRtl
            ? `يتجاوز النطاق بـ ${diff.toLocaleString()} ${currency}`
            : `Exceeds target budget by ${diff.toLocaleString()} ${currency}`
        );
      }
    }
  }

  // Down Payment & Monthly Capacity Check (when explicitly provided)
  if (profile.downPayment > 0 && downPaymentRequired > 0) {
    if (downPaymentRequired > profile.downPayment) {
      const downDiff = downPaymentRequired - profile.downPayment;
      if (downDiff <= profile.downPayment * 0.2) {
        score -= 10;
        reasons.push(
          isRtl
            ? `المقدم المطلوب يحتاج زيادة بسيطة (${downDiff.toLocaleString()} ${currency})`
            : `Down payment requires extra ${downDiff.toLocaleString()} ${currency}`
        );
      } else {
        score -= 30;
        reasons.push(
          isRtl
            ? `المقدم المطلوب يتجاوز الكاش المتاح لديك بفارق ${downDiff.toLocaleString()} ${currency}`
            : `Required down payment exceeds available cash by ${downDiff.toLocaleString()} ${currency}`
        );
      }
    }
  }

  if (profile.monthlyCapacity > 0 && monthlyInstallment > 0) {
    if (monthlyInstallment > profile.monthlyCapacity) {
      const instDiff = monthlyInstallment - profile.monthlyCapacity;
      if (instDiff <= profile.monthlyCapacity * 0.15) {
        score -= 15;
        reasons.push(
          isRtl
            ? `القسط أعلى قليلاً من قدرتك الشهرية بفارق ${instDiff.toLocaleString()} ${currency}`
            : `Monthly payment slightly exceeds limit by ${instDiff.toLocaleString()} ${currency}`
        );
      } else {
        score -= 35;
        reasons.push(
          isRtl
            ? `القسط الشهري (${monthlyInstallment.toLocaleString()} ${currency}) يتخطى قدرتك المريحة`
            : `Monthly payment (${monthlyInstallment.toLocaleString()} ${currency}) exceeds comfortable limit`
        );
      }
    }
  }

  // Clamp score
  const finalScore = Math.max(10, Math.min(100, score));
  let category: 'perfect' | 'stretch' | 'mismatch' = 'perfect';

  const exceedsBudget = profile.budget > 0 && price > profile.budget;
  const exceedsDown = profile.downPayment > 0 && downPaymentRequired > profile.downPayment;
  const exceedsMonthly =
    profile.monthlyCapacity > 0 && monthlyInstallment > profile.monthlyCapacity;

  if (finalScore >= 80) {
    category = exceedsBudget || exceedsDown || exceedsMonthly ? 'stretch' : 'perfect';
  } else if (finalScore >= 55) {
    category = 'stretch';
  } else {
    category = 'mismatch';
  }

  return {
    property,
    matchScore: finalScore,
    category,
    reasons,
    downPaymentRequired,
    monthlyInstallment,
    yearsOfInstallments: installmentYears,
    estimatedAnnualRent,
    rentalYieldPercent,
    capitalAppreciationPercent,
    totalAnnualReturnPercent,
    paybackYears,
  };
};

/**
 * Extracts explicit budget/district/timeline signals from user text for local intelligence.
 */
function inferSignalsFromQuery(queryText: string): {
  districts: string[];
  budgetEgp: number | null;
  wantsLegal: boolean;
  wantsOffPlanComparison: boolean;
  wants3D: boolean;
  wantsReady: boolean;
  wantsInvestment: boolean;
  propertyType: string | null;
} {
  const q = queryText.toLowerCase();

  const districts: string[] = [];
  if (/new cairo|التجمع|القاهرة الجديدة|fifth settlement|المربع الذهبي|mostakbal|المستقبل/i.test(q)) {
    districts.push('New Cairo');
  }
  if (/zayed|زايد|الشيخ زايد|october|أكتوبر|اكتوبر|westown/i.test(q)) {
    districts.push('Sheikh Zayed');
  }
  if (/sahel|الساحل|north coast|ras el hekma|رأس الحكمة|راس الحكمة|marassi|مراسي|hacienda|هاسيندا|alamein|العلمين/i.test(q)) {
    districts.push('North Coast');
  }
  if (/new capital|العاصمة|العاصمه|r7|r8|cbd|iconic tower/i.test(q)) {
    districts.push('New Capital');
  }
  if (/maadi|المعادي|المعادى/i.test(q)) {
    districts.push('Maadi');
  }
  if (/shorouk|الشروق/i.test(q)) {
    districts.push('Shorouk');
  }

  // Budget extraction (supports "10 million", "8.5M", "12 مليون", "6,500,000")
  let budgetEgp: number | null = null;
  const millionMatch = queryText.match(/(\d+(?:[.,]\d+)?)\s*(?:m\b|million|مليون)/i);
  if (millionMatch) {
    const val = Number(millionMatch[1].replace(',', '.'));
    if (Number.isFinite(val) && val > 0) budgetEgp = Math.round(val * 1_000_000);
  } else {
    const rawNumMatch = queryText.match(/\b(\d{1,3}(?:,\d{3}){2}|\d{7,9})\b/);
    if (rawNumMatch) {
      const val = Number(rawNumMatch[1].replace(/,/g, ''));
      if (Number.isFinite(val) && val >= 500_000) budgetEgp = val;
    }
  }

  const wantsLegal =
    /قانون|الشهر العقاري|شهر عقاري|عقد|صحة توقيع|صحة ونفاذ|توثيق|قرار وزاري|legal|contract|deed|registration|title|due diligence/i.test(
      q
    );
  const wantsOffPlanComparison =
    /تحت الإنشاء|تحت الانشاء|off[\s-]?plan|استلام فوري.*تحت|تحت الإنشاء.*فوري|ready[\s-]?to[\s-]?move.*off/i.test(
      q
    );
  const wants3D = /3d|ثلاثي|جولة|افتراضي|virtual tour|walkthrough/i.test(q);
  const wantsReady = /فوري|جاهز|ready|immediate/i.test(q);
  const wantsInvestment = /استثمار|عائد|إيجار|ايجار|أقساط|قسط|مقدم|ميزانية|roi|yield|investment|installment|budget|down payment/i.test(
    q
  );

  let propertyType: string | null = null;
  if (/villa|فيلا/i.test(q)) propertyType = 'Villa';
  else if (/apartment|شقة|شقه|شقق/i.test(q)) propertyType = 'Apartment';
  else if (/chalet|شاليه/i.test(q)) propertyType = 'Chalet';
  else if (/townhouse|تاون/i.test(q)) propertyType = 'Townhouse';
  else if (/penthouse|بنتهاوس/i.test(q)) propertyType = 'Penthouse';
  else if (/duplex|دوبلكس/i.test(q)) propertyType = 'Duplex';
  else if (/office|مكتب|تجاري|retail/i.test(q)) propertyType = 'Office';

  return {
    districts,
    budgetEgp,
    wantsLegal,
    wantsOffPlanComparison,
    wants3D,
    wantsReady,
    wantsInvestment,
    propertyType,
  };
}

export interface LocalFallbackInput {
  query: string;
  isRtl: boolean;
  profile: AdvisorFinancialProfile;
  evaluatedProperties: AdvisorPropertyFit[];
  userName?: string | null;
}

export interface LocalFallbackResult {
  text: string;
  statePatch?: Partial<AdvisorFinancialProfile>;
  matchedPropertyIds: string[];
}

/**
 * Intelligent Egyptian Real Estate Market Fallback Engine.
 * Produces structured, data-driven real estate consultation using HETTETY's
 * verified market benchmarks, Blue-Chip developer intelligence, and live inventory
 * whenever the upstream cloud AI provider is unconfigured or temporarily unreachable.
 */
export function generateLocalAdvisoryFallback({
  query: queryText,
  isRtl,
  profile,
  evaluatedProperties,
  userName,
}: LocalFallbackInput): LocalFallbackResult {
  const useArabic = isRtl || /[\u0600-\u06FF]/.test(queryText);
  const signals = inferSignalsFromQuery(queryText);

  const statePatch: Partial<AdvisorFinancialProfile> = {};
  if (signals.budgetEgp) statePatch.budget = signals.budgetEgp;
  if (signals.districts.length === 1) statePatch.preferredLocation = signals.districts[0];
  if (signals.wantsReady) statePatch.deliveryTimeline = 'ready';
  if (signals.propertyType) statePatch.propertyType = signals.propertyType;
  if (signals.districts.includes('North Coast')) statePatch.purpose = 'coastal';
  else if (signals.wantsInvestment) statePatch.purpose = 'investment';

  const sections: string[] = [];
  const greeting = userName
    ? useArabic
      ? `أهلاً بك يا ${userName}، إليك تحليل مستشار حِتّتي المبني على بيانات السوق العقاري المصري الحالية:`
      : `Welcome ${userName} — here is a data-driven Egyptian market analysis from HETTETY's Advisory Engine:`
    : useArabic
      ? `إليك تحليل مستشار حِتّتي المبني على بيانات ومؤشرات السوق العقاري المصري:`
      : `Here is a data-driven Egyptian market analysis from HETTETY's Advisory Engine:`;
  sections.push(greeting);

  // 1. Legal Due Diligence Guidance
  if (signals.wantsLegal) {
    sections.push(
      useArabic
        ? `⚖️ **أهم المعايير القانونية والفنية قبل توقيع عقد الشراء في مصر:**\n` +
            `• **الشهر العقاري (القانون 9 لسنة 2022):** تحقق من رقم الشهر العقاري أو قابلية الوحدة للتسجيل، ولا تكتفِ بـ «صحة التوقيع» لأنها تثبت التوقيع فقط ولا تنقل الملكية (بخلاف دعوى «صحة ونفاذ» أو التسجيل الرسمي).\n` +
            `• **القرار الوزاري وتراخيص المشروع:** في الكمبوندات، راجع صدور القرار الوزاري للمطور وتخصيص الأرض من هيئة المجتمعات العمرانية (NUCA) أو شركة العاصمة (ACUD).\n` +
            `• **تسلسل الملكية والمخالصة:** في إعادة البيع (Resale)، اطلب أصل التنازل داخل مقر المطور + خطاب مخالصة للأقساط السابقة ووديعة الصيانة (عادةً 8% إلى 10%).\n` +
            `• **المعاينة الفنية والاستلام:** راجع جدول الغرامات في حالة تأخر التسليم، ومواصفات التشطيب والمرافق في ملحق العقد.`
        : `⚖️ **Essential Legal & Technical Checks Before Signing in Egypt:**\n` +
            `• **Real Estate Publicity (Law No. 9 of 2022):** Verify official registration status (الشهر العقاري). Court signature validity (صحة توقيع) only authenticates signatures — it does not transfer title, unlike full registration or a validity-and-enforcement ruling (صحة ونفاذ).\n` +
            `• **Ministerial Decree & Land Allocation:** For primary compounds, confirm the developer holds an approved Ministerial Decree (القرار الوزاري) and NUCA / ACUD land allocation.\n` +
            `• **Title Chain & Financial Clearance:** For resale units, execute the assignment directly at the developer's office with a clearance certificate covering paid installments and the maintenance deposit (typically 8–10%).\n` +
            `• **Technical Handover Clauses:** Confirm handover grace periods, delay penalty clauses, and exact finishing specifications in the contract annex.`
    );
  }

  // 2. Off-Plan vs Ready-to-Move Analysis
  if (signals.wantsOffPlanComparison) {
    const capBench = DISTRICT_BENCHMARKS['New Capital'];
    sections.push(
      useArabic
        ? `🏗️ **مقارنة الشراء تحت الإنشاء (Off-Plan) مقابل الاستلام الفوري (خاصةً في العاصمة الإدارية):**\n` +
            `• **تحت الإنشاء (3–4 سنوات):** سعر متر أقل بحوالي 20–30% عند الطرح، مقدم يبدأ من 5%–10% وتقسيط حتى ${capBench.typicalInstallmentYears} سنوات، ونمو رأسمالي سنوي متوقع ~${capBench.capitalGrowth}%، لكنه يتطلب اختيار مطور ذي ملاءة مالية قوية ومراجعة نسب التنفيذ الفعلية.\n` +
            `• **الاستلام الفوري (Ready to Move):** تشغيل وإيجار فوري (متوسط عائد إيجاري ${capBench.rentalYield}% في العاصمة خاصةً للوحدات الإدارية والتجارية)، وانعدام مخاطر التأخير، لكن بمقدم أعلى (20–30%) وفترة سداد أقصر.\n` +
            `• **نصيحة حِتّتي:** للاستثمار طويل الأجل وحماية المدخرات من التضخم، اختر تحت الإنشاء مع مطور فئة أولى؛ وللدخل الشهري الفوري أو السكن العاجل، اختر الاستلام الفوري.`
        : `🏗️ **Off-Plan vs. Ready-to-Move Comparison (New Capital & Growth Corridors):**\n` +
            `• **Off-Plan (Under Construction):** ~20–30% lower entry price per m², flexible 5–10% down payment over up to ${capBench.typicalInstallmentYears} years, and projected ~${capBench.capitalGrowth}% annual capital appreciation. Key risk: construction timelines — stick to audited developers with ACUD contracts.\n` +
            `• **Ready-to-Move:** Immediate rental cash flow (~${capBench.rentalYield}% average yield in New Capital, up to 11–14% for commercial/offices) and zero delivery risk, in exchange for a higher down payment (20–30%) and shorter installments.\n` +
            `• **Advisory Takeaway:** Choose off-plan for leveraged capital growth and inflation hedging; choose ready-to-move for immediate residency or day-one rental income.`
    );
  }

  // 3. District & Developer Benchmarks Comparison
  const targetDistricts =
    signals.districts.length > 0
      ? signals.districts
      : !signals.wantsLegal && !signals.wantsOffPlanComparison
        ? ['New Cairo', 'Sheikh Zayed']
        : [];

  if (targetDistricts.length > 0) {
    const hubLines = targetDistricts.map((dKey) => {
      const bench = DISTRICT_BENCHMARKS[dKey] || DISTRICT_BENCHMARKS['Default'];
      const hubName =
        dKey === 'New Cairo'
          ? useArabic
            ? 'القاهرة الجديدة والتجمع الخامس'
            : 'New Cairo & Fifth Settlement'
          : dKey === 'Sheikh Zayed'
            ? useArabic
              ? 'الشيخ زايد و6 أكتوبر'
              : 'Sheikh Zayed & 6th of October'
            : dKey === 'North Coast'
              ? useArabic
                ? 'الساحل الشمالي ورأس الحكمة'
                : 'North Coast & Ras El Hekma'
              : dKey === 'New Capital'
                ? useArabic
                  ? 'العاصمة الإدارية الجديدة'
                  : 'New Administrative Capital'
                : dKey;

      const subHubs = (useArabic ? bench.subHubsAr : bench.subHubs).slice(0, 3).join('، ');
      return useArabic
        ? `• **${hubName}:** متوسط المتر أولي ~${bench.avgPricePerSqmPrimary.toLocaleString()} ج.م (إعادة بيع ~${bench.avgPricePerSqmResale.toLocaleString()} ج.م) | العائد الإيجاري ~${bench.rentalYield}% | النمو الرأسمالي السنوي ~${bench.capitalGrowth}% | مقدم شائع ${bench.typicalDownPayment}% حتى ${bench.typicalInstallmentYears} سنوات | أبرز المحاور: ${subHubs}.`
        : `• **${hubName}:** Primary avg ~${bench.avgPricePerSqmPrimary.toLocaleString()} EGP/m² (Resale ~${bench.avgPricePerSqmResale.toLocaleString()} EGP/m²) | Rental Yield ~${bench.rentalYield}% | Capital Growth ~${bench.capitalGrowth}%/yr | Typical Plan: ${bench.typicalDownPayment}% down, up to ${bench.typicalInstallmentYears} yrs | Key Hubs: ${subHubs}.`;
    });

    const devPreview = Object.values(TOP_DEVELOPERS)
      .filter((d) => d.tier === 'Blue Chip')
      .slice(0, 4)
      .map((d) =>
        useArabic
          ? `${d.nameAr} (${d.flagshipProjects.slice(0, 2).join('، ')} — تقسيط حتى ${d.typicalPaymentPlan.maxYears} سنوات)`
          : `${d.name} (${d.flagshipProjects.slice(0, 2).join(', ')} — up to ${d.typicalPaymentPlan.maxYears} yrs)`
      )
      .join('\n  - ');

    sections.push(
      (useArabic ? `📊 **مؤشرات المناطق والمطورين المعتمدين:**\n` : `📊 **District Benchmarks & Blue-Chip Developers:**\n`) +
        hubLines.join('\n') +
        (useArabic
          ? `\n\n🏛️ **أبرز المطورين بسابقة أعمال موثّقة:**\n  - ${devPreview}`
          : `\n\n🏛️ **Top Blue-Chip Developers Track Record:**\n  - ${devPreview}`)
    );
  }

  // 4. Financial Plan & Installment Estimate
  const effectiveBudget = signals.budgetEgp || profile.budget;
  if (effectiveBudget > 0) {
    const targetDist = signals.districts[0] || (profile.preferredLocation !== 'all' ? profile.preferredLocation : 'New Cairo');
    const downP = profile.downPayment > 0 ? profile.downPayment : Math.round(effectiveBudget * 0.1);
    const plan = calculateFinancialPlan({
      budget: effectiveBudget,
      downPayment: downP,
      monthlyCapacity: profile.monthlyCapacity || Math.round((effectiveBudget - downP) / 96),
      targetDistrict: targetDist,
      horizonYears: 5,
    });
    const estMonthly8Yr = Math.round((effectiveBudget - downP) / (8 * 12));
    sections.push(
      useArabic
        ? `💰 **تقدير خطة التمويل والعائد لميزانية ${effectiveBudget.toLocaleString()} ج.م (${targetDist}):**\n` +
            `• مقدم استرشادي (10%): ${downP.toLocaleString()} ج.م | قسط شهري تقديري (على 8 سنوات): ~${estMonthly8Yr.toLocaleString()} ج.م.\n` +
            `• عائد إيجاري سنوي متوقع: ~${plan.annualRentalYieldEgp.toLocaleString()} ج.م (${plan.benchmark.rentalYield}%) | نمو رأسمالي متوقع خلال 5 سنوات: ~${plan.estimatedCapitalGrowthEgp.toLocaleString()} ج.م.`
        : `💰 **Financing & ROI Projection for ${effectiveBudget.toLocaleString()} EGP (${targetDist}):**\n` +
            `• Indicative 10% Down Payment: ${downP.toLocaleString()} EGP | Est. Monthly Installment (8 yrs): ~${estMonthly8Yr.toLocaleString()} EGP.\n` +
            `• Projected Annual Rent: ~${plan.annualRentalYieldEgp.toLocaleString()} EGP (${plan.benchmark.rentalYield}%) | Est. 5-Year Capital Appreciation: ~${plan.estimatedCapitalGrowthEgp.toLocaleString()} EGP.`
    );
  }

  // 5. Match Against Live Platform Inventory (Strictly truthful — never invents fake units)
  const matchingUnits = evaluatedProperties
    .filter((fit) => {
      const p = fit.property;
      if (signals.districts.length > 0) {
        const loc = `${p.location || ''} ${p.compound || ''}`.toLowerCase();
        const matchesAny = signals.districts.some((d) => loc.includes(d.toLowerCase()));
        if (!matchesAny) return false;
      }
      if (signals.propertyType) {
        if ((p.propertyType || '').toLowerCase() !== signals.propertyType.toLowerCase()) {
          return false;
        }
      }
      if (signals.wants3D && !(p.threeDTour?.assetUrl || p.digitalTwinUrl)) {
        return false;
      }
      if (signals.wantsReady) {
        const ready =
          (p.deliveryDate || '').toLowerCase().includes('ready') ||
          (p.deliveryTimeline || '').toLowerCase().includes('ready');
        if (!ready) return false;
      }
      if (effectiveBudget > 0 && p.price > effectiveBudget * 1.15) {
        return false;
      }
      return true;
    })
    .slice(0, 3);

  const fallbackUnits =
    matchingUnits.length > 0 ? matchingUnits : evaluatedProperties.slice(0, 2);
  const matchedPropertyIds = matchingUnits.map((m) => m.property.id);

  if (matchingUnits.length > 0) {
    const listText = matchingUnits
      .map((m, idx) => {
        const p = m.property;
        const priceStr = p.price
          ? `${p.price.toLocaleString()} ${p.currency || 'EGP'}`
          : useArabic
            ? 'عند الطلب'
            : 'On request';
        const has3dLabel =
          p.threeDTour?.assetUrl || p.digitalTwinUrl
            ? useArabic
              ? ' · جولة 3D متاحة'
              : ' · 3D Tour available'
            : '';
        return `${idx + 1}. **${p.title}** (${p.location}) — ${priceStr} · ${p.area} m²${has3dLabel}`;
      })
      .join('\n');
    sections.push(
      (useArabic
        ? `🏠 **أفضل الوحدات المطابقة حالياً على منصة حِتّتي:**\n`
        : `🏠 **Top Matching Live Units on HETTETY:**\n`) + listText
    );
  } else if (evaluatedProperties.length === 0) {
    sections.push(
      useArabic
        ? `ℹ️ **ملاحظة حول المعروض المباشر:** قاعدة بيانات العقارات على المنصة فارغة حالياً بانتظار إضافة وحدات جديدة موثّقة، لكن يمكنك الاستمرار في مقارنة المناطق وحساب خطط السداد والميزانية معي.`
        : `ℹ️ **Live Catalog Note:** The platform inventory currently has no published listings matching right now, so I provided verified Egyptian market benchmarks. Share your target budget, down payment, and preferred district anytime for a custom plan.`
    );
  } else if (fallbackUnits.length > 0) {
    const altText = fallbackUnits
      .map(
        (m, idx) =>
          `${idx + 1}. **${m.property.title}** (${m.property.location}) — ${m.property.price.toLocaleString()} ${m.property.currency || 'EGP'}`
      )
      .join('\n');
    sections.push(
      (useArabic
        ? `🔍 **لم نجد تطابقاً حرفياً بنسبة 100% في الوحدات المنشورة حالياً، وإليك أقرب الخيارات المتاحة:**\n`
        : `🔍 **No exact match in live inventory right now — here are the closest available options:**\n`) +
        altText
    );
  }

  return {
    text: sections.join('\n\n'),
    statePatch: Object.keys(statePatch).length > 0 ? statePatch : undefined,
    matchedPropertyIds,
  };
}

function buildSystemInstruction(
  profile: AdvisorFinancialProfile,
  properties: Property[],
  userName?: string | null
): string {
  return `You are HETTETY Smart Real Estate Advisor (المستشار العقاري الرسمي لمنصة حِتّتي).
You are a senior, unbiased real estate consultant specialized in the Egyptian real estate market.

## Core Role & Principles:
1. Pure, Unbiased Real Estate Consulting:
   - Provide comprehensive real estate guidance: project comparisons, location strategic advantages, developer track records, masterplans, and delivery timelines.
   - Evaluate properties based on actual physical features: location, finishing quality, developer reliability, amenities, layout, and payment flexibilities.
   - Proactively ask the user for their target budget, available cash/down payment, and monthly installment capacity to tailor recommendations.
   - Guide clients with realistic annual rental yields (e.g. 8-10% in New Cairo/Zayed, 12-16% seasonal summer in North Coast/Ras El Hekma, 11-14% commercial in New Capital) and capital appreciation benchmarks.
2. District & Growth Corridors Expertise:
   - New Cairo & Mostakbal City: Golden Square (المربع الذهبي), Fifth Settlement (التجمع الخامس), Beit El Watan, South & North 90th, Aliva, Bloomfields.
   - Sheikh Zayed & 6th of October: Central Zayed, New Zayed (الحزام الأخضر), Dahshur Link, October Gardens, Westown.
   - North Coast & Ras El Hekma: Ras El Hekma ($35B UAE ADQ mega-project), Sidi Abdel Rahman, New Alamein City.
   - New Administrative Capital: R7 & R8 Residential, CBD & Iconic Tower, Downtown, Green River.
3. Top Egyptian Developers Due Diligence:
   - Emaar Misr, Mountain View (DMG), Hyde Park Developments, SODIC / Aldar, Palm Hills, Tatweer Misr, Talaat Moustafa Group (TMG), Ora Developers, Al Ahly Sabbour.
4. Legal & Contract Verification (Due Diligence):
   - Guide clients on verifying official registration at the Real Estate Publicity Department (الشهر العقاري طبقاً للقانون 9 لسنة 2022).
   - Check judicial validity (دعوى صحة ونفاذ), court signature (صحة توقيع), ministerial decrees (القرار الوزاري), and maintenance deposits (وديعة صيانة 8-10%).
5. Interactive 3D Tour Launcher:
   - When the user asks to see or tour a property in 3D, append [SHOW_3D:<propertyId>] at the very end of your response.
6. Two-Way Financial & Search State Synchronization:
   - Whenever the user mentions or refines budget, down payment, monthly capacity, preferred location, property type, delivery timeline, or purchase objective, ALWAYS append:
     [ADVISOR_STATE:{"budget":<number>,"downPayment":<number>,"monthlyCapacity":<number>,"preferredLocation":"<string>","propertyType":"<string>","deliveryTimeline":"ready"|"1-2years"|"3+years"|"all","purpose":"residential"|"investment"|"resale"|"coastal"|"all"}]
     Only include keys you can determine from user input.

${userName ? `The user's name is ${userName}. Address them warmly by name.` : ''}

Current User Financial & Search Profile:
${JSON.stringify({
  budget: profile.budget,
  downPayment: profile.downPayment,
  monthlyCapacity: profile.monthlyCapacity,
  currency: profile.currency,
  location: profile.preferredLocation,
  propertyType: profile.propertyType,
  timeline: profile.deliveryTimeline,
  purpose: profile.purpose,
  paymentPlan: profile.preferredPaymentPlan,
  bedrooms: profile.bedrooms,
})}

Available Platform Inventory (${properties.length} live units):
${JSON.stringify(
  properties.slice(0, 35).map((p) => ({
    id: p.id,
    title: p.title,
    price: p.price,
    currency: p.currency || 'EGP',
    location: p.location,
    compound: p.compound,
    developer: p.developer,
    type: p.propertyType,
    status: p.status,
    delivery: p.deliveryDate || p.deliveryTimeline || p.status,
    bedrooms: p.bedrooms,
    area: p.area,
    paymentPlans: p.paymentPlans,
    hasReal3D: !!(p.threeDTour?.assetUrl || p.digitalTwinUrl),
    has360: !!(p.panoramas?.length),
  })),
  null,
  2
)}
`;
}

/** Single fast call to /api/ai with at most 1 brief retry ONLY on transient 503. */
async function requestCloudAdvisor(
  historyTurns: AiWireMessage[],
  userText: string,
  systemInstruction: string
): Promise<string> {
  const contents: AiWireMessage[] = [
    ...historyTurns.slice(-16),
    { role: 'user', parts: [{ text: userText }] },
  ];

  const execute = () =>
    generateContent({
      task: 'chat',
      contents,
      config: { systemInstruction },
    });

  try {
    const res = await execute();
    if (!res.text || !res.text.trim()) {
      throw new AIRequestError('Empty response from AI provider', 502, true);
    }
    return res.text;
  } catch (err: any) {
    // Only perform a single quick retry on true transient 503 overload — never stall for 15s!
    const isTransient503 =
      err instanceof AIRequestError && err.status === 503 && err.transient === true;
    if (isTransient503) {
      await new Promise((r) => setTimeout(r, 550));
      const retryRes = await execute();
      if (retryRes.text && retryRes.text.trim()) {
        return retryRes.text;
      }
    }
    throw err;
  }
}

export const RealEstateAdvisor: React.FC<RealEstateAdvisorProps> = ({
  t,
  isRtl,
  properties,
  userName,
  onShow3D,
  onOpenProperty,
}) => {
  const [profile, setProfile] = useState<AdvisorFinancialProfile>(DEFAULT_ADVISOR_PROFILE);
  const [messages, setMessages] = useState<AdvisorUiMessage[]>([]);
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [sessions, setSessions] = useState<ChatSession[]>([]);
  const [currentSessionId, setCurrentSessionId] = useState<string | null>(null);
  const [showSessionsDrawer, setShowSessionsDrawer] = useState(false);
  // Defaults to 'online' so initial UI renders crisp "Online & Ready" (and keeps unit tests deterministic)
  const [connectionStatus, setConnectionStatus] = useState<AdvisorConnectionStatus>('online');
  const [providerLabel, setProviderLabel] = useState<string | null>(null);

  const scrollRef = useRef<HTMLDivElement>(null);
  // Persistent refs: profile updates NEVER wipe chat conversation state!
  const messagesRef = useRef<AdvisorUiMessage[]>([]);
  const systemInstructionRef = useRef<string>('');

  useEffect(() => {
    messagesRef.current = messages;
  }, [messages]);

  // Evaluated properties
  const evaluatedProperties: AdvisorPropertyFit[] = useMemo(() => {
    return properties
      .map((p) => calculatePropertyFit(p, profile, isRtl))
      .sort((a, b) => b.matchScore - a.matchScore);
  }, [properties, profile, isRtl]);

  // Update systemInstruction ref cleanly WITHOUT resetting or wiping chat history
  useEffect(() => {
    systemInstructionRef.current = buildSystemInstruction(profile, properties, userName);
  }, [profile, properties, userName]);

  // Live non-blocking health probe against /api/ai?health=1 (gracefully ignored in tests/offline)
  useEffect(() => {
    if (typeof fetch !== 'function') return;
    const controller = new AbortController();
    let mounted = true;

    (async () => {
      try {
        const res = await fetch('/api/ai?health=1', {
          method: 'GET',
          signal: controller.signal,
          headers: { Accept: 'application/json' },
        });
        if (!mounted || !res || !res.ok) return;
        const contentType = res.headers?.get?.('content-type') || '';
        if (!contentType.includes('application/json')) return;
        const health = await res.json();
        if (!mounted || !health || typeof health !== 'object') return;
        if (health.healthy === true && health.hasApiKey !== false) {
          setConnectionStatus('online');
          if (health.provider) {
            setProviderLabel(
              health.model ? `${health.provider} · ${health.model}` : String(health.provider)
            );
          }
        } else if (health.healthy === false || health.hasApiKey === false) {
          setConnectionStatus('local-engine');
        }
      } catch {
        // Gracefully ignore in JSDOM/unit tests or transient probe issues
      }
    })();

    return () => {
      mounted = false;
      controller.abort();
    };
  }, []);

  const stats = useMemo(() => {
    const perfectCount = evaluatedProperties.filter((p) => p.category === 'perfect').length;
    const stretchCount = evaluatedProperties.filter((p) => p.category === 'stretch').length;
    const mismatchCount = evaluatedProperties.filter((p) => p.category === 'mismatch').length;

    return {
      perfectCount,
      stretchCount,
      mismatchCount,
      totalCount: evaluatedProperties.length,
    };
  }, [evaluatedProperties]);

  // Chat Sessions Persistence Listener (routes through src/firebase.ts -> Neon Postgres)
  useEffect(() => {
    if (!auth.currentUser) {
      setSessions([]);
      return;
    }
    const q = query(
      collection(db, 'chat_sessions'),
      where('userId', '==', auth.currentUser.uid)
    );
    const unsubscribe = onSnapshot(q, (snapshot) => {
      const data = snapshot.docs.map((docSnap) => {
        const d = docSnap.data();
        return {
          ...d,
          id: docSnap.id,
          messages: (d.messages || []).map((m: any) => ({
            ...m,
            timestamp: m.timestamp?.toDate ? m.timestamp.toDate() : new Date(m.timestamp),
          })),
        } as ChatSession;
      });
      setSessions(
        data.sort((a, b) => {
          const timeA = a.lastUpdatedAt ? new Date(a.lastUpdatedAt).getTime() : 0;
          const timeB = b.lastUpdatedAt ? new Date(b.lastUpdatedAt).getTime() : 0;
          return timeB - timeA;
        })
      );
    });
    return () => unsubscribe();
  }, []);

  // Load selected session into messages cleanly
  const handleSelectSession = (session: ChatSession) => {
    setCurrentSessionId(session.id);
    setMessages(session.messages);
    messagesRef.current = session.messages;
    setShowSessionsDrawer(false);
  };

  // Scroll to bottom on message update
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages, isLoading]);

  const persistSession = useCallback(
    async (allMessages: AdvisorUiMessage[], firstPrompt: string) => {
      if (!auth.currentUser) return;
      try {
        const isFirstMessage = allMessages.filter((m) => m.role === 'user').length === 1;
        const existingTitle = sessions.find((s) => s.id === currentSessionId)?.title;
        const sessionData = {
          userId: auth.currentUser.uid,
          title:
            isFirstMessage || !existingTitle
              ? firstPrompt.length > 36
                ? `${firstPrompt.substring(0, 36)}...`
                : firstPrompt
              : existingTitle,
          messages: allMessages.map((m) => ({
            role: m.role,
            text: m.text,
            timestamp:
              m.timestamp instanceof Date
                ? m.timestamp.toISOString()
                : new Date(m.timestamp).toISOString(),
          })),
          lastUpdatedAt: new Date().toISOString(),
        };

        if (currentSessionId) {
          await updateDoc(doc(db, 'chat_sessions', currentSessionId), sessionData);
        } else {
          const docRef = await addDoc(collection(db, 'chat_sessions'), sessionData);
          setCurrentSessionId(docRef.id);
        }
      } catch (persistErr) {
        console.warn('Could not persist advisor chat session:', persistErr);
      }
    },
    [currentSessionId, sessions]
  );

  // Send or Retry Message
  const handleSend = async (
    overrideText?: string,
    options?: { replaceMessageId?: string }
  ) => {
    const textToSend = (overrideText ?? input).trim();
    if (!textToSend || isLoading) return;

    const isRetryReplace = Boolean(options?.replaceMessageId);

    // Snapshot conversation history BEFORE adding this turn (excluding broken error bubbles)
    const priorMessages = isRetryReplace
      ? messagesRef.current.filter((m) => m.id !== options?.replaceMessageId)
      : messagesRef.current;

    const historyForApi: AiWireMessage[] = priorMessages
      .filter((m) => !m.isError && m.text.trim().length > 0)
      // When retrying, avoid duplicating the final user message already in priorMessages
      .slice(0, isRetryReplace ? -1 : undefined)
      .map((m) => ({
        role: m.role === 'model' ? 'model' : 'user',
        parts: [{ text: m.text }],
      }));

    let workingMessages: AdvisorUiMessage[];
    if (isRetryReplace) {
      workingMessages = priorMessages;
      setMessages(workingMessages);
      messagesRef.current = workingMessages;
    } else {
      const userMsg: AdvisorUiMessage = {
        id: `u-${Date.now()}`,
        role: 'user',
        text: textToSend,
        timestamp: new Date(),
      };
      workingMessages = [...priorMessages, userMsg];
      setMessages(workingMessages);
      messagesRef.current = workingMessages;
      if (!overrideText) setInput('');
    }

    setIsLoading(true);

    try {
      let modelMsg: AdvisorUiMessage;

      try {
        const rawAiText = await requestCloudAdvisor(
          historyForApi,
          textToSend,
          systemInstructionRef.current
        );

        setConnectionStatus('online');

        // Extract 3D tour trigger
        const { cleanText: textAfter3D, show3D, propertyId } = extract3DMarker(rawAiText);
        if (show3D && propertyId && onShow3D) {
          onShow3D(propertyId);
        }

        // Extract two-way financial/search profile sync WITHOUT wiping conversation
        const { cleanText: finalText, statePatch } = extractAdvisorState(textAfter3D);
        if (statePatch) {
          setProfile((prev) => ({ ...prev, ...statePatch }));
        }

        modelMsg = {
          id: `m-${Date.now()}`,
          role: 'model',
          text: finalText || rawAiText,
          timestamp: new Date(),
          matchedPropertyIds: propertyId ? [propertyId] : undefined,
        };
      } catch (_apiErr) {
        // Immediate intelligent Egyptian market fallback — never leave the user stranded!
        setConnectionStatus('local-engine');
        const fallback = generateLocalAdvisoryFallback({
          query: textToSend,
          isRtl,
          profile,
          evaluatedProperties,
          userName,
        });

        if (fallback.statePatch) {
          setProfile((prev) => ({ ...prev, ...fallback.statePatch }));
        }

        modelMsg = {
          id: `m-local-${Date.now()}`,
          role: 'model',
          text: fallback.text,
          timestamp: new Date(),
          isFallback: true,
          retryPrompt: textToSend,
          matchedPropertyIds: fallback.matchedPropertyIds,
        };
      }

      const finalMessages = [...workingMessages, modelMsg];
      setMessages(finalMessages);
      messagesRef.current = finalMessages;

      await persistSession(finalMessages, textToSend);
    } catch (unexpectedErr) {
      console.error('Advisor chat unexpected error:', unexpectedErr);
      const errMsg: AdvisorUiMessage = {
        id: `m-err-${Date.now()}`,
        role: 'model',
        text: isRtl
          ? 'حدث خطأ غير متوقع أثناء معالجة استشارتك العقارية. يمكنك المحاولة مرة أخرى فوراً.'
          : 'An unexpected error occurred while processing your consultation. Please try again.',
        timestamp: new Date(),
        isError: true,
        retryPrompt: textToSend,
      };
      const withError = [...workingMessages, errMsg];
      setMessages(withError);
      messagesRef.current = withError;
    } finally {
      setIsLoading(false);
    }
  };

  const handleExportReport = () => {
    const reportDate = new Date().toLocaleDateString();
    const content = `HETTETY Real Estate Advisory & Project Guide
=====================================================
Client: ${userName || 'Valued Client'}
Date: ${reportDate}

REAL ESTATE CONSULTATION PARAMETERS
-----------------------------------------------------
- Target District: ${profile.preferredLocation === 'all' ? 'All Districts' : profile.preferredLocation}
- Property Type: ${profile.propertyType === 'All' ? 'All Types' : profile.propertyType}
- Budget: ${profile.budget > 0 ? `${profile.budget.toLocaleString()} ${profile.currency}` : 'Not specified'}
- Purchase Objective: ${profile.purpose}
- Handover / Delivery Status: ${profile.deliveryTimeline}
- Preferred Payment Strategy: ${profile.preferredPaymentPlan || 'All Plans'}
- Bedrooms / Space: ${profile.bedrooms || 'All'}

STRATEGIC ADVISORY PILLARS
-----------------------------------------------------
1. Developer Track Record: Licensed projects with verified execution and delivery history.
2. Strategic Location: Direct connectivity to main transit arteries, international schools, and commercial centres.
3. Handover & Construction Status: On-site construction verification and approved architectural finishing specs.
4. Flexible Payment Terms: Multi-year developer installments, low down payment options, and transparent contracts.

EVALUATED PROPERTIES SUMMARY
-----------------------------------------------------
Total Properties Evaluated: ${evaluatedProperties.length}
* Highly Recommended Matches: ${stats.perfectCount}
* Promising Opportunities: ${stats.stretchCount}
* Alternative Options: ${stats.mismatchCount}

TOP RECOMMENDED PROPERTIES:
${evaluatedProperties
  .slice(0, 8)
  .map(
    (p, idx) => `
${idx + 1}. [${p.category.toUpperCase()}] ${p.property.title}
   - Location: ${p.property.location}
   - Property Type: ${p.property.propertyType}
   - Price: ${p.property.price ? `${p.property.price.toLocaleString()} ${p.property.currency || 'EGP'}` : 'On Request'}
   - Handover Status: ${p.property.deliveryDate || p.property.deliveryTimeline || p.property.status}
   - Match Score: ${p.matchScore}%
   - Key Advisory Factors: ${p.reasons.join(' | ')}
`
  )
  .join('')}

-----------------------------------------------------
Disclaimer: Provided by HETTETY Smart Real Estate Advisor for property selection and guidance purposes. Contract terms and property deeds must be verified through the official Real Estate Publicity Department (الشهر العقاري).
`;

    const blob = new Blob([content], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `hettety-real-estate-report-${new Date().toISOString().slice(0, 10)}.txt`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  const hasActiveProfileContext =
    profile.budget > 0 ||
    profile.preferredLocation !== 'all' ||
    profile.propertyType !== 'All' ||
    profile.deliveryTimeline !== 'all' ||
    profile.purpose !== 'all';

  return (
    <div
      dir={isRtl ? 'rtl' : 'ltr'}
      className={`flex flex-col h-[calc(100dvh-75px)] w-full bg-slate-50 dark:bg-slate-950 text-slate-900 dark:text-white transition-colors duration-500 overflow-hidden ${
        isRtl ? 'font-cairo' : ''
      }`}
    >
      {/* Top Advisor Header */}
      <header className="bg-white dark:bg-slate-900 border-b border-slate-200 dark:border-slate-800 px-4 sm:px-6 py-3.5 shrink-0 shadow-xs z-30">
        <div className="max-w-4xl mx-auto flex items-center justify-between gap-4">
          <div className="flex items-center gap-3 min-w-0">
            <div className="w-10 h-10 rounded-2xl bg-gradient-to-tr from-brand-600 to-accent-500 flex items-center justify-center text-white shadow-md shadow-brand-500/20 shrink-0">
              <Sparkles size={20} className="animate-pulse" aria-hidden="true" />
            </div>
            <div className="min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <h1 className="font-heading font-black text-base sm:text-lg tracking-tight truncate">
                  {t.advisor_title ||
                    (isRtl ? 'المستشار العقاري الذكي' : 'Smart Real Estate Advisor')}
                </h1>
                <span className="px-2 py-0.5 rounded-full text-[10px] font-black uppercase tracking-wider bg-accent-100 dark:bg-accent-900/30 text-accent-700 dark:text-accent-300 shrink-0">
                  {isRtl ? 'مستشار حِتّتي المعتمد' : 'Hettety Advisor'}
                </span>
              </div>
              <div className="flex items-center gap-2 mt-0.5 flex-wrap">
                {connectionStatus === 'online' ? (
                  <span
                    title={providerLabel || undefined}
                    className="text-[11px] text-emerald-600 dark:text-emerald-400 font-bold flex items-center gap-1.5 shrink-0"
                  >
                    <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
                    <span>{isRtl ? 'متصل ومستعد' : 'Online & Ready'}</span>
                  </span>
                ) : (
                  <span className="text-[11px] text-amber-600 dark:text-amber-400 font-bold flex items-center gap-1.5 shrink-0">
                    <Cpu size={12} aria-hidden="true" />
                    <span>
                      {isRtl ? 'وضع التحليل المحلي الذكي' : 'Smart Local Analysis Mode'}
                    </span>
                  </span>
                )}
                <span className="text-slate-300 dark:text-slate-700 text-xs hidden sm:inline">
                  •
                </span>
                <p className="text-xs text-slate-500 dark:text-slate-400 font-medium hidden sm:inline line-clamp-1">
                  {t.advisor_subtitle ||
                    (isRtl
                      ? 'استشارات عقارية محايدة، مقارنة المشروعات، وفحص سابقة أعمال المطورين والخطط الاستثمارية.'
                      : 'Unbiased property guidance, project comparisons, and developer due diligence.')}
                </p>
              </div>
            </div>
          </div>

          {/* Action Buttons: Sessions History, New Session & Export Report */}
          <div className="flex items-center gap-2 shrink-0">
            {sessions.length > 0 && (
              <button
                type="button"
                onClick={() => setShowSessionsDrawer((v) => !v)}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-bold text-slate-600 dark:text-slate-300 hover:text-brand-600 hover:bg-slate-100 dark:hover:bg-slate-800 border border-slate-200 dark:border-slate-700 transition-colors cursor-pointer"
                title={isRtl ? 'المحادثات السابقة' : 'Previous Sessions'}
              >
                <History size={13} aria-hidden="true" />
                <span className="hidden md:inline">
                  {isRtl ? `السجل (${sessions.length})` : `History (${sessions.length})`}
                </span>
              </button>
            )}

            <button
              type="button"
              onClick={() => {
                setMessages([]);
                messagesRef.current = [];
                setCurrentSessionId(null);
              }}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-bold text-slate-600 dark:text-slate-300 hover:text-brand-600 hover:bg-slate-100 dark:hover:bg-slate-800 border border-slate-200 dark:border-slate-700 transition-colors cursor-pointer"
              title={isRtl ? 'محادثة جديدة' : 'New Session'}
            >
              <RefreshCw size={13} aria-hidden="true" />
              <span className="hidden sm:inline">{isRtl ? 'محادثة جديدة' : 'New Session'}</span>
            </button>

            <button
              type="button"
              onClick={handleExportReport}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-bold transition-all cursor-pointer bg-brand-50 hover:bg-brand-100 dark:bg-brand-900/30 text-brand-700 dark:text-brand-300 border border-brand-200 dark:border-brand-800"
              title={isRtl ? 'تحميل تقرير الاستشارة العقارية' : 'Export Real Estate Report'}
            >
              <Download size={13} aria-hidden="true" />
              <span className="hidden sm:inline">
                {isRtl ? 'تصدير التقرير' : 'Export Report'}
              </span>
            </button>
          </div>
        </div>

        {/* Live Synchronized Financial / Search Context Bar */}
        {hasActiveProfileContext && (
          <div className="max-w-4xl mx-auto mt-2.5 pt-2 border-t border-slate-100 dark:border-slate-800 flex flex-wrap items-center gap-1.5 text-[11px]">
            <span className="font-bold text-slate-400">
              {isRtl ? 'ملف الاستشارة النشط:' : 'Active Consultation Profile:'}
            </span>
            {profile.budget > 0 && (
              <span className="px-2.5 py-0.5 rounded-full bg-brand-50 dark:bg-brand-900/30 text-brand-700 dark:text-brand-300 font-bold">
                {isRtl ? 'الميزانية:' : 'Budget:'} {profile.budget.toLocaleString()}{' '}
                {profile.currency}
              </span>
            )}
            {profile.preferredLocation !== 'all' && (
              <span className="px-2.5 py-0.5 rounded-full bg-brand-50 dark:bg-brand-900/30 text-brand-700 dark:text-brand-300 font-bold">
                {profile.preferredLocation}
              </span>
            )}
            {profile.propertyType !== 'All' && (
              <span className="px-2.5 py-0.5 rounded-full bg-brand-50 dark:bg-brand-900/30 text-brand-700 dark:text-brand-300 font-bold">
                {profile.propertyType}
              </span>
            )}
            {profile.deliveryTimeline !== 'all' && (
              <span className="px-2.5 py-0.5 rounded-full bg-accent-50 dark:bg-accent-900/30 text-accent-700 dark:text-accent-300 font-bold">
                {profile.deliveryTimeline}
              </span>
            )}
            <button
              type="button"
              onClick={() => setProfile(DEFAULT_ADVISOR_PROFILE)}
              className="text-slate-400 hover:text-rose-500 font-bold px-1.5 cursor-pointer"
            >
              {isRtl ? 'تصفير' : 'Reset'}
            </button>
          </div>
        )}
      </header>

      {/* Main Full-Width Chat Container */}
      <section
        aria-label={isRtl ? 'محادثة المستشار العقاري' : 'Real Estate Advisor conversation'}
        className="flex-1 flex flex-col overflow-hidden relative"
      >
        {/* Saved Sessions Popover Drawer */}
        {showSessionsDrawer && sessions.length > 0 && (
          <aside
            aria-label={isRtl ? 'سجل المحادثات السابقة' : 'Saved Consultation History'}
            className="absolute top-3 end-4 z-30 w-72 sm:w-80 max-h-80 bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-2xl overflow-hidden flex flex-col animate-fade-in"
          >
            <div className="px-4 py-3 border-b border-slate-100 dark:border-slate-800 flex items-center justify-between">
              <span className="text-xs font-black text-slate-900 dark:text-white">
                {isRtl ? 'استشاراتك المحفوظة' : 'Saved Consultations'}
              </span>
              <button
                type="button"
                onClick={() => setShowSessionsDrawer(false)}
                aria-label={isRtl ? 'إغلاق السجل' : 'Close history'}
                className="p-1 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-500 cursor-pointer"
              >
                <X size={14} aria-hidden="true" />
              </button>
            </div>
            <div className="overflow-y-auto divide-y divide-slate-100 dark:divide-slate-800">
              {sessions.map((s) => (
                <button
                  key={s.id}
                  type="button"
                  onClick={() => handleSelectSession(s)}
                  className={`w-full text-start px-4 py-3 hover:bg-slate-50 dark:hover:bg-slate-800/70 transition-colors cursor-pointer ${
                    currentSessionId === s.id ? 'bg-brand-50/70 dark:bg-brand-900/20' : ''
                  }`}
                >
                  <div className="text-xs font-bold text-slate-900 dark:text-white truncate">
                    {s.title}
                  </div>
                  <div className="text-[10px] text-slate-400 mt-0.5">
                    {s.messages.length} {isRtl ? 'رسالة' : 'messages'} ·{' '}
                    {s.lastUpdatedAt
                      ? new Date(s.lastUpdatedAt).toLocaleDateString(
                          isRtl ? 'ar-EG' : 'en-US'
                        )
                      : ''}
                  </div>
                </button>
              ))}
            </div>
          </aside>
        )}

        {/* Messages Stream */}
        <div
          ref={scrollRef}
          className="flex-1 overflow-y-auto p-4 sm:p-6 space-y-4 custom-scrollbar bg-slate-50/50 dark:bg-slate-950/50"
        >
          <div className="max-w-4xl mx-auto w-full flex flex-col space-y-4">
            {messages.length === 0 && (
              <div className="flex flex-col items-center justify-center py-8 sm:py-12 text-center space-y-6">
                <div className="w-16 h-16 rounded-3xl bg-gradient-to-tr from-brand-600 to-accent-500 text-white flex items-center justify-center shadow-lg shadow-brand-500/20">
                  <Sparkles size={32} aria-hidden="true" />
                </div>
                <div className="max-w-md">
                  <h2 className="font-heading font-black text-lg sm:text-xl text-slate-900 dark:text-white">
                    {isRtl
                      ? 'مستشارك العقاري الموثوق في خدمتك'
                      : 'Your Trusted Real Estate Advisor'}
                  </h2>
                  <p className="text-xs sm:text-sm text-slate-500 dark:text-slate-400 mt-2 leading-relaxed">
                    {isRtl
                      ? 'شاركني منطقتك المفضلة، نوع العقار، وميزانيتك، وسأقدم لك استشارة عقارية شاملة ومقارنة بين أفضل المشروعات والمطورين في السوق المصري.'
                      : 'Share your preferred district, property type, or budget, and I will guide you with comprehensive real estate advice and project comparisons across Egypt.'}
                  </p>
                </div>

                {/* Quick Consultation Chips */}
                <div className="w-full max-w-2xl grid grid-cols-1 sm:grid-cols-2 gap-2.5 pt-2">
                  {[
                    isRtl
                      ? 'قارن لي بين أفضل كمبوندات التجمع الخامس والشيخ زايد من حيث سابقة أعمال المطورين والخدمات.'
                      : 'Compare top compounds in New Cairo and Sheikh Zayed regarding developer track record and amenities.',
                    isRtl
                      ? 'عايز شقة استلام فوري في القاهرة الجديدة متوفر فيها جولة افتراضية 3D.'
                      : 'I want a ready-to-move apartment in New Cairo with an interactive 3D virtual tour.',
                    isRtl
                      ? 'ما هي مميزات وعيوب شراء وحدة تحت الإنشاء مقارنة بالاستلام الفوري في العاصمة الإدارية؟'
                      : 'What are the pros and cons of buying off-plan vs ready-to-move in the New Capital?',
                    isRtl
                      ? 'إيه هي أهم المعايير القانونية والفنية اللي لازم أتأكد منها قبل توقيع عقد الشراء في مصر؟'
                      : 'What are the essential legal and technical checks before signing a purchase contract in Egypt?',
                  ].map((chip, idx) => (
                    <button
                      key={idx}
                      type="button"
                      onClick={() => handleSend(chip)}
                      className={`text-start p-3.5 rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 hover:border-brand-500 hover:text-brand-600 dark:hover:text-accent-400 hover:shadow-sm text-xs font-bold text-slate-700 dark:text-slate-300 transition-all cursor-pointer ${
                        isRtl ? 'text-right' : 'text-left'
                      }`}
                    >
                      {chip}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {messages.map((m, i) => {
              const matchedProps =
                m.matchedPropertyIds && m.matchedPropertyIds.length > 0
                  ? properties.filter((p) => m.matchedPropertyIds!.includes(p.id))
                  : [];

              return (
                <div
                  key={m.id || i}
                  className={`flex gap-3 ${m.role === 'user' ? 'flex-row-reverse' : ''} animate-fade-in`}
                >
                  <div
                    className={`w-8 h-8 rounded-xl shrink-0 flex items-center justify-center text-xs font-bold shadow-sm ${
                      m.role === 'user'
                        ? 'bg-brand-600 text-white'
                        : m.isError
                          ? 'bg-rose-100 dark:bg-rose-900/40 text-rose-600 dark:text-rose-400'
                          : 'bg-slate-200 dark:bg-slate-800 text-brand-600 dark:text-brand-400'
                    }`}
                  >
                    {m.role === 'user' ? (
                      <User size={14} aria-hidden="true" />
                    ) : m.isError ? (
                      <AlertCircle size={14} aria-hidden="true" />
                    ) : (
                      <Sparkles size={14} aria-hidden="true" />
                    )}
                  </div>
                  <div
                    className={`flex flex-col max-w-[88%] sm:max-w-[78%] ${
                      m.role === 'user' ? 'items-end' : 'items-start'
                    }`}
                  >
                    <div
                      className={`p-4 rounded-2xl text-xs sm:text-sm font-medium leading-relaxed ${
                        m.role === 'user'
                          ? 'bg-brand-600 text-white rounded-tr-none'
                          : m.isError
                            ? 'bg-rose-50 dark:bg-rose-950/30 border border-rose-200 dark:border-rose-800 text-rose-900 dark:text-rose-200 rounded-tl-none'
                            : 'bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 text-slate-800 dark:text-slate-200 rounded-tl-none shadow-xs'
                      }`}
                    >
                      {m.isFallback && (
                        <div className="flex items-center gap-1.5 text-[10px] font-black uppercase tracking-wider text-amber-700 dark:text-amber-400 bg-amber-50 dark:bg-amber-950/40 border border-amber-200/70 dark:border-amber-800/60 rounded-lg px-2.5 py-1 mb-2.5 w-fit">
                          <CheckCircle2 size={12} aria-hidden="true" />
                          <span>
                            {isRtl
                              ? 'تحليل فوري عبر محرك السوق العقاري المصري'
                              : 'Instant Local Market Intelligence Analysis'}
                          </span>
                        </div>
                      )}

                      <p className="whitespace-pre-wrap">
                        {m.text.split(/(\*\*[^*]+\*\*)/g).map((segment, segIdx) =>
                          segment.startsWith('**') && segment.endsWith('**') && segment.length > 4 ? (
                            <strong key={segIdx} className="font-extrabold">
                              {segment.slice(2, -2)}
                            </strong>
                          ) : (
                            <React.Fragment key={segIdx}>{segment}</React.Fragment>
                          )
                        )}
                      </p>

                      {/* Interactive Property Quick-Cards when matched */}
                      {matchedProps.length > 0 && (
                        <div className="mt-3 pt-3 border-t border-slate-100 dark:border-slate-800 grid grid-cols-1 sm:grid-cols-2 gap-2">
                          {matchedProps.map((prop) => {
                            const real3d = Boolean(
                              prop.threeDTour?.assetUrl || prop.digitalTwinUrl
                            );
                            return (
                              <div
                                key={prop.id}
                                className="p-2.5 rounded-xl bg-slate-50 dark:bg-slate-800/70 border border-slate-200/80 dark:border-slate-700 flex items-center justify-between gap-2"
                              >
                                <div className="min-w-0">
                                  <div className="text-xs font-bold text-slate-900 dark:text-white truncate flex items-center gap-1">
                                    <Building2 size={12} className="text-brand-600 shrink-0" />
                                    <span className="truncate">{prop.title}</span>
                                  </div>
                                  <div className="text-[11px] text-slate-500 dark:text-slate-400 truncate">
                                    {prop.price
                                      ? `${prop.price.toLocaleString()} ${prop.currency || 'EGP'}`
                                      : prop.location}
                                  </div>
                                </div>
                                <div className="flex items-center gap-1 shrink-0">
                                  {real3d && onShow3D && (
                                    <button
                                      type="button"
                                      onClick={() => onShow3D(prop.id)}
                                      className="p-1.5 rounded-lg bg-accent-500 hover:bg-accent-600 text-white transition-colors cursor-pointer"
                                      title={isRtl ? 'فتح جولة 3D' : 'Launch 3D Tour'}
                                    >
                                      <Box size={13} aria-hidden="true" />
                                    </button>
                                  )}
                                  {onOpenProperty && (
                                    <button
                                      type="button"
                                      onClick={() => onOpenProperty(prop.id)}
                                      className="p-1.5 rounded-lg bg-brand-600 hover:bg-brand-700 text-white transition-colors cursor-pointer"
                                      title={isRtl ? 'عرض التفاصيل' : 'Open Property'}
                                    >
                                      <ArrowUpRight
                                        size={13}
                                        className={isRtl ? '-scale-x-100' : ''}
                                        aria-hidden="true"
                                      />
                                    </button>
                                  )}
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      )}

                      {/* Retry Button on Fallback or Error Bubble */}
                      {(m.isFallback || m.isError) && m.retryPrompt && (
                        <div className="mt-3 pt-2.5 border-t border-slate-100 dark:border-slate-800 flex items-center justify-between gap-2">
                          <span className="text-[11px] text-slate-400">
                            {m.isFallback
                              ? isRtl
                                ? 'الذكاء السحابي غير متاح مؤقتاً'
                                : 'Cloud AI temporarily unavailable'
                              : isRtl
                                ? 'فشل الإرسال'
                                : 'Request failed'}
                          </span>
                          <button
                            type="button"
                            disabled={isLoading}
                            onClick={() =>
                              handleSend(m.retryPrompt, { replaceMessageId: m.id })
                            }
                            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-brand-50 hover:bg-brand-100 dark:bg-brand-900/40 dark:hover:bg-brand-900/60 text-brand-700 dark:text-brand-300 text-[11px] font-bold transition-colors cursor-pointer disabled:opacity-50"
                          >
                            <RotateCcw size={12} aria-hidden="true" />
                            <span>
                              {isRtl ? 'إعادة المحاولة مع الذكاء السحابي' : 'Retry Live AI'}
                            </span>
                          </button>
                        </div>
                      )}
                    </div>
                    <span className="text-[10px] text-slate-400 mt-1 px-1">
                      {(m.timestamp instanceof Date
                        ? m.timestamp
                        : new Date(m.timestamp)
                      ).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                    </span>
                  </div>
                </div>
              );
            })}

            {isLoading && (
              <div className="flex gap-3 animate-pulse">
                <div className="w-8 h-8 rounded-xl bg-slate-200 dark:bg-slate-800 flex items-center justify-center shrink-0">
                  <Sparkles size={14} className="text-slate-400" aria-hidden="true" />
                </div>
                <div className="bg-white dark:bg-slate-900 p-4 rounded-2xl rounded-tl-none border border-slate-200 dark:border-slate-800 space-y-2 w-2/3 max-w-md">
                  <div className="h-3 bg-slate-200 dark:bg-slate-800 rounded-full w-full" />
                  <div className="h-3 bg-slate-200 dark:bg-slate-800 rounded-full w-4/5" />
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Chat Input Bar */}
        <div className="p-4 bg-white dark:bg-slate-900 border-t border-slate-200 dark:border-slate-800 shrink-0">
          <div className="max-w-4xl mx-auto w-full">
            <div
              className={`flex items-end gap-2 bg-slate-50 dark:bg-slate-800/80 border border-slate-200 dark:border-slate-700 rounded-2xl p-2.5 focus-within:ring-2 focus-within:ring-brand-500 transition-all ${
                isRtl ? 'flex-row-reverse' : ''
              }`}
            >
              <textarea
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault();
                    handleSend();
                  }
                }}
                placeholder={
                  t.advisor_chat_placeholder ||
                  (isRtl
                    ? 'اسأل مستشارك العقاري (مثال: قارن بين أفضل كمبوندات زايد، أو شقق 3 غرف استلام فوري)...'
                    : 'Ask your real estate advisor (e.g. compare top compounds in Zayed, or find 3-bedroom ready to move)...')
                }
                rows={2}
                className="w-full bg-transparent border-none outline-none text-xs sm:text-sm text-slate-900 dark:text-white resize-none p-1 placeholder:text-slate-400"
              />
              <button
                type="button"
                onClick={() => handleSend()}
                disabled={!input.trim() || isLoading}
                className="p-2.5 rounded-xl bg-brand-600 hover:bg-brand-700 disabled:opacity-40 text-white transition-all cursor-pointer shrink-0 shadow-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
                aria-label={isRtl ? 'إرسال' : 'Send'}
              >
                <Send size={16} className={isRtl ? 'rotate-180' : ''} aria-hidden="true" />
              </button>
            </div>
          </div>
        </div>
      </section>
    </div>
  );
};

export default RealEstateAdvisor;
