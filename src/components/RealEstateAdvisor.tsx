import React, { useState, useEffect, useMemo, useRef } from 'react';
import { Sparkles, RefreshCw, Send, User, Download } from 'lucide-react';
import { Property, ChatMessage, ChatSession, AdvisorFinancialProfile, AdvisorPropertyFit, InvestmentPurpose } from '../types';
import { createChat, extract3DMarker, extractAdvisorState, withRetry, isOverloadedError, aiErrorMessage } from '../ai';
import { auth, db, doc, updateDoc, addDoc, collection, query, where, onSnapshot } from '../firebase';

interface RealEstateAdvisorProps {
  t: any;
  isRtl: boolean;
  properties: Property[];
  userName?: string | null;
  onShow3D?: (propertyId: string) => void;
  onOpenProperty?: (propertyId: string) => void;
}

import { DISTRICT_BENCHMARKS, TOP_DEVELOPERS, PRIME_HUBS } from '../lib/marketIntelligence';
export { DISTRICT_BENCHMARKS, TOP_DEVELOPERS, PRIME_HUBS };

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
  if (normType.includes('office') || normType.includes('مكتب') || normType.includes('retail') || normType.includes('محل') || normType.includes('تجاري')) {
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
  const monthlyInstallment = installmentYears > 0 ? Math.round(remainingPrincipal / (installmentYears * 12)) : 0;

  // 2. Real Estate Benchmark Metrics
  const benchmark = getDistrictBenchmark(property.location, property.propertyType);
  const rentalYieldPercent = benchmark.rentalYield;
  const capitalAppreciationPercent = benchmark.capitalGrowth;
  const estimatedAnnualRent = Math.round(price * (rentalYieldPercent / 100));
  const totalAnnualReturnPercent = Math.round((rentalYieldPercent + capitalAppreciationPercent) * 10) / 10;
  const totalAnnualGain = estimatedAnnualRent + Math.round(price * (capitalAppreciationPercent / 100));
  const paybackYears = totalAnnualGain > 0 ? Math.round((price / totalAnnualGain) * 10) / 10 : 10;

  // 3. Real Estate Advisory Suitability & Scoring
  const reasons: string[] = [];
  let score = 95;

  // District / Location Evaluation
  if (profile.preferredLocation && profile.preferredLocation !== 'all' && profile.preferredLocation !== 'All') {
    const locMatch = (property.location || '').toLowerCase().includes(profile.preferredLocation.toLowerCase());
    if (locMatch) {
      score += 10;
      reasons.push(isRtl ? `الموقع يطابق المنطقة المستهدفة بالكامل (${property.location})` : `Location matches preferred target area (${property.location})`);
    } else {
      score -= 30;
      reasons.push(isRtl ? `يقع خارج المنطقة المستهدفة المحددة (${property.location})` : `Located outside target district (${property.location})`);
    }
  } else {
    reasons.push(isRtl ? `موقع مميز واستراتيجي في ${property.location}` : `Strategic prime location in ${property.location}`);
  }

  // Property Type Evaluation
  if (profile.propertyType && profile.propertyType !== 'All' && profile.propertyType !== 'all') {
    const typeMatch = (property.propertyType || '').toLowerCase().includes(profile.propertyType.toLowerCase());
    if (typeMatch) {
      score += 10;
      reasons.push(isRtl ? `نوع الوحدة يطابق اختيارك (${property.propertyType})` : `Property type matches specification (${property.propertyType})`);
    } else {
      score -= 20;
    }
  }

  // Delivery Timeline Evaluation
  if (profile.deliveryTimeline && profile.deliveryTimeline !== 'all') {
    const isReady = (!!property.deliveryDate && property.deliveryDate.toLowerCase().includes('ready')) ||
                    (!!property.deliveryTimeline && property.deliveryTimeline.toLowerCase().includes('ready'));
    if (profile.deliveryTimeline === 'ready') {
      if (isReady) {
        score += 10;
        reasons.push(isRtl ? 'جاهز للاستلام الفوري بدون فترات انتظار' : 'Ready to move immediately');
      } else {
        score -= 15;
      }
    } else if (profile.deliveryTimeline === '1-2years') {
      reasons.push(isRtl ? 'موعد استلام قريب مع تيسيرات سداد ممتدة' : 'Near-term handover with flexible payment milestones');
    }
  }

  // Purpose Evaluation
  if (profile.purpose === 'coastal') {
    if (property.yallaSahel || (property.propertyType && property.propertyType.toLowerCase().includes('chalet'))) {
      score += 15;
      reasons.push(isRtl ? 'وحدة ساحلية ممتازة للمصايف والعطلات الصيفية' : 'Prime coastal unit for vacation and seasonal enjoyment');
    }
  } else if (profile.purpose === 'investment') {
    reasons.push(isRtl ? 'عقار يتميز بطلب إيجاري قوي وموقع حيوي للمستأجرين' : 'High tenant demand with sustained rental appeal');
  } else if (profile.purpose === 'residential') {
    reasons.push(isRtl ? 'بيئة سكنية متكاملة الخدمات مناسبة للأسرة والاستقرار' : 'Family-oriented community with comprehensive amenities');
  }

  // Real 3D / 360 Panorama / Spatial Media Evaluation
  const hasReal3D = !!(property.threeDTour?.assetUrl || property.digitalTwinUrl);
  const has360 = !!(property.panoramas && property.panoramas.length > 0);
  const hasPhotoRelief = !!(property.images && property.images.length > 1);

  if (hasReal3D) {
    score += 6;
    reasons.push(isRtl ? 'متوفر جولة افتراضية تفاعلية ثلاثية الأبعاد (3D Walkthrough)' : 'Interactive 3D digital walkthrough available');
  } else if (has360) {
    score += 4;
    reasons.push(isRtl ? 'متوفر جولة بانوراما 360° استعراضية' : '360° immersive panorama available');
  } else if (hasPhotoRelief) {
    score += 2;
    reasons.push(isRtl ? 'معاينة مجسمة للصور متعددة الزوايا' : 'Multi-angle relief preview available');
  }

  // Budget comparison (when explicitly provided)
  if (profile.budget > 0 && price > 0) {
    if (price <= profile.budget) {
      reasons.push(isRtl ? `السعر ضمن النطاق المقدر (${price.toLocaleString()} ${currency})` : `Price within target range (${price.toLocaleString()} ${currency})`);
    } else {
      const diff = price - profile.budget;
      const ratio = diff / profile.budget;
      if (ratio <= 0.15) {
        score -= 15;
        reasons.push(isRtl ? `أعلى من الميزانية بنسبة طفيفة (${Math.round(ratio * 100)}%) — يمكن تعويضها بالقسط المريح` : `Slightly above budget (${Math.round(ratio * 100)}%) — manageable with installments`);
      } else {
        score -= 35;
        reasons.push(isRtl ? `يتجاوز النطاق بـ ${diff.toLocaleString()} ${currency}` : `Exceeds target budget by ${diff.toLocaleString()} ${currency}`);
      }
    }
  }

  // Down Payment & Monthly Capacity Check (when explicitly provided)
  if (profile.downPayment > 0 && downPaymentRequired > 0) {
    if (downPaymentRequired > profile.downPayment) {
      const downDiff = downPaymentRequired - profile.downPayment;
      if (downDiff <= profile.downPayment * 0.2) {
        score -= 10;
        reasons.push(isRtl ? `المقدم المطلوب يحتاج زيادة بسيطة (${downDiff.toLocaleString()} ${currency})` : `Down payment requires extra ${downDiff.toLocaleString()} ${currency}`);
      } else {
        score -= 30;
        reasons.push(isRtl ? `المقدم المطلوب يتجاوز الكاش المتاح لديك بفارق ${downDiff.toLocaleString()} ${currency}` : `Required down payment exceeds available cash by ${downDiff.toLocaleString()} ${currency}`);
      }
    }
  }

  if (profile.monthlyCapacity > 0 && monthlyInstallment > 0) {
    if (monthlyInstallment > profile.monthlyCapacity) {
      const instDiff = monthlyInstallment - profile.monthlyCapacity;
      if (instDiff <= profile.monthlyCapacity * 0.15) {
        score -= 15;
        reasons.push(isRtl ? `القسط أعلى قليلاً من قدرتك الشهرية بفارق ${instDiff.toLocaleString()} ${currency}` : `Monthly payment slightly exceeds limit by ${instDiff.toLocaleString()} ${currency}`);
      } else {
        score -= 35;
        reasons.push(isRtl ? `القسط الشهري (${monthlyInstallment.toLocaleString()} ${currency}) يتخطى قدرتك المريحة` : `Monthly payment (${monthlyInstallment.toLocaleString()} ${currency}) exceeds comfortable limit`);
      }
    }
  }

  // Clamp score
  const finalScore = Math.max(10, Math.min(100, score));
  let category: 'perfect' | 'stretch' | 'mismatch' = 'perfect';

  const exceedsBudget = profile.budget > 0 && price > profile.budget;
  const exceedsDown = profile.downPayment > 0 && downPaymentRequired > profile.downPayment;
  const exceedsMonthly = profile.monthlyCapacity > 0 && monthlyInstallment > profile.monthlyCapacity;

  if (finalScore >= 80) {
    category = (exceedsBudget || exceedsDown || exceedsMonthly) ? 'stretch' : 'perfect';
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

export const RealEstateAdvisor: React.FC<RealEstateAdvisorProps> = ({
  t,
  isRtl,
  properties,
  userName,
  onShow3D,
  onOpenProperty,
}) => {
  // Real estate search & consultation profile (zero hardcoded numbers)
  const [profile, setProfile] = useState<AdvisorFinancialProfile>({
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
  });

  // Chat State
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [sessions, setSessions] = useState<ChatSession[]>([]);
  const [currentSessionId, setCurrentSessionId] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const chatRef = useRef<any>(null);
  const chatConfigRef = useRef<{ systemInstruction: string } | null>(null);

  // Evaluated properties
  const evaluatedProperties: AdvisorPropertyFit[] = useMemo(() => {
    return properties
      .map(p => calculatePropertyFit(p, profile, isRtl))
      .sort((a, b) => b.matchScore - a.matchScore);
  }, [properties, profile, isRtl]);

  const stats = useMemo(() => {
    const perfectCount = evaluatedProperties.filter(p => p.category === 'perfect').length;
    const stretchCount = evaluatedProperties.filter(p => p.category === 'stretch').length;
    const mismatchCount = evaluatedProperties.filter(p => p.category === 'mismatch').length;

    return {
      perfectCount,
      stretchCount,
      mismatchCount,
      totalCount: evaluatedProperties.length,
    };
  }, [evaluatedProperties]);

  // Firestore Chat Sessions Listener
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
      const data = snapshot.docs.map(docSnap => {
        const d = docSnap.data();
        return {
          ...d,
          id: docSnap.id,
          messages: (d.messages || []).map((m: any) => ({
            ...m,
            timestamp: m.timestamp?.toDate ? m.timestamp.toDate() : new Date(m.timestamp)
          }))
        } as ChatSession;
      });
      setSessions(data.sort((a, b) => {
        const timeA = a.lastUpdatedAt ? new Date(a.lastUpdatedAt).getTime() : 0;
        const timeB = b.lastUpdatedAt ? new Date(b.lastUpdatedAt).getTime() : 0;
        return timeB - timeA;
      }));
    });
    return () => unsubscribe();
  }, []);

  // Update messages when switching sessions
  useEffect(() => {
    if (currentSessionId) {
      const session = sessions.find(s => s.id === currentSessionId);
      if (session) {
        setMessages(session.messages);
      }
    } else {
      setMessages([]);
    }
  }, [currentSessionId, sessions]);

  // Scroll to bottom on message update
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages]);

  // Initialize Real Estate Advisor System Instruction
  useEffect(() => {
    const systemInstruction = `You are HETTETY Smart Real Estate Advisor (المستشار العقاري الرسمي لمنصة حِتّتي).
You are a senior, unbiased real estate consultant specialized in the Egyptian real estate market.

## Core Role & Principles:
1. Pure, Unbiased Real Estate Consulting:
   - Provide comprehensive real estate guidance: project comparisons, location strategic advantages, developer track records, masterplans, and delivery timelines.
   - You evaluate properties based on actual physical features: location, finishing quality, developer reliability, amenities, layout, and payment flexibilities.
   - Proactively ask the user for their target budget, available cash/down payment, and monthly installment capacity to tailor recommendations.
   - Guide clients with realistic annual rental yields (e.g. 8-10% in New Cairo/Zayed, 12-16% seasonal summer in North Coast/Ras El Hekma, 11-14% commercial in New Capital) and capital appreciation benchmarks.
2. District & Growth Corridors Expertise:
   - New Cairo & Mostakbal City: Golden Square (المربع الذهبي), Fifth Settlement (التجمع الخامس), Beit El Watan, South & North 90th, Aliva, Bloomfields.
   - Sheikh Zayed & 6th of October: Central Zayed, New Zayed (الحزام الأخضر), Dahshur Link, October Gardens, Westown.
   - North Coast & Ras El Hekma: Ras El Hekma ($35B UAE ADQ mega-project), Sidi Abdel Rahman, New Alamein City.
   - New Administrative Capital: R7 & R8 Residential, CBD & Iconic Tower, Downtown, Green River.
3. Top Egyptian Developers Due Diligence:
   - Emaar Misr (Marassi, Cairo Gate, Belle Vie, Uptown Cairo, Mivida - Blue Chip expat yields, 5-8 yr plans).
   - Mountain View / DMG (iCity New Cairo & October, LVLS & Mountain View Ras El Hekma, Plage, Aliva - 4D island living, lagoons, 8-9 yr plans).
   - Hyde Park Developments (One Hyde Park, Hyde Park Golden Square, Tawny, Seashore - 141-feddan park, bank backing, 8 yr plans).
   - SODIC / Aldar (Villette New Cairo, Eastown, October Plaza, Karmell, June - European landscaping, EDNC/Club S hubs, 7-8 yr plans).
   - Palm Hills (Badya, Palm Hills October & New Cairo, Hacienda Bay/Waters - 8-10 yr plans).
   - Tatweer Misr, Talaat Moustafa Group (TMG - Madinaty, Noor, SouthMED), Ora Developers (Zed Towers, Solana), Al Ahly Sabbour.
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
  bedrooms: profile.bedrooms
})}

Available Platform Inventory:
${JSON.stringify(properties.map(p => ({
  id: p.id,
  title: p.title,
  price: p.price,
  currency: p.currency || 'EGP',
  location: p.location,
  type: p.propertyType,
  status: p.status,
  delivery: p.deliveryDate || p.deliveryTimeline || p.status,
  bedrooms: p.bedrooms,
  area: p.area,
  paymentPlans: p.paymentPlans,
  hasReal3D: !!(p.threeDTour?.assetUrl || p.digitalTwinUrl),
  has360: !!(p.panoramas?.length),
  hasPhotoRelief: !!(p.images && p.images.length > 1),
  has3D: !!(p.threeDTour?.assetUrl || p.digitalTwinUrl || p.panoramas?.length || (p.images && p.images.length > 1))
})), null, 2)}
`;

    chatConfigRef.current = { systemInstruction };
    chatRef.current = createChat({ task: 'chat', config: { systemInstruction } });
  }, [properties, userName, profile]);

  // Handle User Message Sending
  const handleSend = async (overrideText?: string) => {
    const textToSend = (overrideText || input).trim();
    if (!textToSend) return;

    const userMsg: ChatMessage = { role: 'user', text: textToSend, timestamp: new Date() };
    const newMessages = [...messages, userMsg];
    setMessages(newMessages);
    if (!overrideText) setInput('');
    setIsLoading(true);

    try {
      let aiText = "";
      if (chatRef.current) {
        try {
          const response: any = await withRetry(() => chatRef.current.sendMessage({ message: userMsg.text }));
          aiText = response.text;
        } catch (apiError: any) {
          if (isOverloadedError(apiError) && chatConfigRef.current) {
            try {
              const history = messages.map(m => ({ role: (m.role === 'model' ? 'model' : 'user') as 'model' | 'user', parts: [{ text: m.text }] }));
              chatRef.current = createChat({
                task: 'chat',
                history,
                config: { systemInstruction: chatConfigRef.current.systemInstruction },
              });
              const response: any = await withRetry(() => chatRef.current.sendMessage({ message: userMsg.text }), 2);
              aiText = response.text;
            } catch (fallbackErr: any) {
              aiText = aiErrorMessage(fallbackErr, isRtl);
            }
          } else {
            aiText = aiErrorMessage(apiError, isRtl);
          }
        }
      } else {
        aiText = isRtl
          ? 'المستشار الذكي غير متصل حالياً، يرجى المحاولة مرة أخرى أو مراجعة الاتصال بالإنترنت.'
          : 'The smart real estate advisor is currently unavailable. Please check your connection and try again.';
      }

      // Check for 3D marker
      const { cleanText: textAfter3D, show3D, propertyId } = extract3DMarker(aiText || '');
      if (show3D && propertyId && onShow3D) {
        onShow3D(propertyId);
      }

      // Check for Advisor State Sync
      const { cleanText: finalText, statePatch } = extractAdvisorState(textAfter3D);
      if (statePatch) {
        setProfile(prev => ({ ...prev, ...statePatch }));
      }

      const modelMsg: ChatMessage = { role: 'model', text: finalText, timestamp: new Date() };
      const finalMessages = [...newMessages, modelMsg];
      setMessages(finalMessages);

      // Persist to Firestore
      if (auth.currentUser) {
        const isFirstMessage = newMessages.length === 1;
        const sessionData = {
          userId: auth.currentUser.uid,
          title: isFirstMessage ? (textToSend.length > 32 ? textToSend.substring(0, 32) + '...' : textToSend) : (sessions.find(s => s.id === currentSessionId)?.title || textToSend),
          messages: finalMessages.map(m => ({
            role: m.role,
            text: m.text,
            timestamp: m.timestamp.toISOString()
          })),
          lastUpdatedAt: new Date().toISOString()
        };

        if (currentSessionId) {
          await updateDoc(doc(db, 'chat_sessions', currentSessionId), sessionData);
        } else {
          const docRef = await addDoc(collection(db, 'chat_sessions'), sessionData);
          setCurrentSessionId(docRef.id);
        }
      }
    } catch (error: any) {
      console.error("Advisor chat error:", error);
      setMessages(prev => [...prev, {
        role: 'model',
        text: isRtl ? 'حدث خطأ أثناء معالجة استشارتك العقارية. يرجى المحاولة مرة أخرى.' : 'An error occurred while processing your real estate consultation. Please try again.',
        timestamp: new Date()
      }]);
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
${evaluatedProperties.slice(0, 8).map((p, idx) => `
${idx + 1}. [${p.category.toUpperCase()}] ${p.property.title}
   - Location: ${p.property.location}
   - Property Type: ${p.property.propertyType}
   - Price: ${p.property.price ? `${p.property.price.toLocaleString()} ${p.property.currency || 'EGP'}` : 'On Request'}
   - Handover Status: ${p.property.deliveryDate || p.property.deliveryTimeline || p.property.status}
   - Match Score: ${p.matchScore}%
   - Key Advisory Factors: ${p.reasons.join(' | ')}
`).join('')}

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

  return (
    <div className={`flex flex-col h-[calc(100dvh-75px)] w-full bg-slate-50 dark:bg-slate-950 text-slate-900 dark:text-white transition-colors duration-500 overflow-hidden ${isRtl ? 'font-cairo' : ''}`}>
      {/* Top Advisor Header */}
      <header className="bg-white dark:bg-slate-900 border-b border-slate-200 dark:border-slate-800 px-4 sm:px-6 py-3.5 shrink-0 shadow-xs z-30">
        <div className="max-w-4xl mx-auto flex items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-2xl bg-gradient-to-tr from-brand-600 to-accent-500 flex items-center justify-center text-white shadow-md shadow-brand-500/20 shrink-0">
              <Sparkles size={20} className="animate-pulse" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h1 className="font-heading font-black text-base sm:text-lg tracking-tight">
                  {t.advisor_title || (isRtl ? 'المستشار العقاري الذكي' : 'Smart Real Estate Advisor')}
                </h1>
                <span className="px-2 py-0.5 rounded-full text-[10px] font-black uppercase tracking-wider bg-accent-100 dark:bg-accent-900/30 text-accent-700 dark:text-accent-300">
                  {isRtl ? 'مستشار حِتّتي المعتمد' : 'Hettety Advisor'}
                </span>
              </div>
              <div className="flex items-center gap-2 mt-0.5">
                <span className="text-[11px] text-emerald-600 dark:text-emerald-400 font-bold flex items-center gap-1">
                  <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse"></span>
                  {isRtl ? 'متصل وجاهز للاستشارة' : 'Online & Ready'}
                </span>
                <span className="text-slate-300 dark:text-slate-700 text-xs hidden sm:inline">•</span>
                <p className="text-xs text-slate-500 dark:text-slate-400 font-medium hidden sm:inline line-clamp-1">
                  {t.advisor_subtitle || (isRtl ? 'استشارات عقارية محايدة، مقارنة المشروعات، وفحص سابقة أعمال المطورين والخطط الاستثمارية.' : 'Unbiased property guidance, project comparisons, and developer due diligence.')}
                </p>
              </div>
            </div>
          </div>

          {/* Action Buttons: New Session & Export Report */}
          <div className="flex items-center gap-2 shrink-0">
            <button
              type="button"
              onClick={() => {
                setMessages([]);
                setCurrentSessionId(null);
              }}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-bold text-slate-600 dark:text-slate-300 hover:text-brand-600 hover:bg-slate-100 dark:hover:bg-slate-800 border border-slate-200 dark:border-slate-700 transition-colors cursor-pointer"
              title={isRtl ? 'محادثة جديدة' : 'New Session'}
            >
              <RefreshCw size={13} />
              <span className="hidden sm:inline">{isRtl ? 'محادثة جديدة' : 'New Session'}</span>
            </button>

            <button
              type="button"
              onClick={handleExportReport}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-bold transition-all cursor-pointer bg-brand-50 hover:bg-brand-100 dark:bg-brand-900/30 text-brand-700 dark:text-brand-300 border border-brand-200 dark:border-brand-800"
              title={isRtl ? 'تحميل تقرير الاستشارة العقارية' : 'Export Real Estate Report'}
            >
              <Download size={13} />
              <span className="hidden sm:inline">{isRtl ? 'تصدير التقرير' : 'Export Report'}</span>
            </button>
          </div>
        </div>
      </header>

      {/* Main Full-Width Chat Container */}
      <main className="flex-1 flex flex-col overflow-hidden relative">
        {/* Messages Stream */}
        <div ref={scrollRef} className="flex-1 overflow-y-auto p-4 sm:p-6 space-y-4 custom-scrollbar bg-slate-50/50 dark:bg-slate-950/50">
          <div className="max-w-4xl mx-auto w-full flex flex-col space-y-4">
            {messages.length === 0 && (
              <div className="flex flex-col items-center justify-center py-8 sm:py-12 text-center space-y-6">
                <div className="w-16 h-16 rounded-3xl bg-gradient-to-tr from-brand-600 to-accent-500 text-white flex items-center justify-center shadow-lg shadow-brand-500/20">
                  <Sparkles size={32} />
                </div>
                <div className="max-w-md">
                  <h2 className="font-heading font-black text-lg sm:text-xl text-slate-900 dark:text-white">
                    {isRtl ? 'مستشارك العقاري الموثوق في خدمتك' : 'Your Trusted Real Estate Advisor'}
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
                    isRtl ? 'قارن لي بين أفضل كمبوندات التجمع الخامس والشيخ زايد من حيث سابقة أعمال المطورين والخدمات.' : 'Compare top compounds in New Cairo and Sheikh Zayed regarding developer track record and amenities.',
                    isRtl ? 'عايز شقة استلام فوري في القاهرة الجديدة متوفر فيها جولة افتراضية 3D.' : 'I want a ready-to-move apartment in New Cairo with an interactive 3D virtual tour.',
                    isRtl ? 'ما هي مميزات وعيوب شراء وحدة تحت الإنشاء مقارنة بالاستلام الفوري في العاصمة الإدارية؟' : 'What are the pros and cons of buying off-plan vs ready-to-move in the New Capital?',
                    isRtl ? 'إيه هي أهم المعايير القانونية والفنية اللي لازم أتأكد منها قبل توقيع عقد الشراء في مصر؟' : 'What are the essential legal and technical checks before signing a purchase contract in Egypt?',
                  ].map((chip, idx) => (
                    <button
                      key={idx}
                      type="button"
                      onClick={() => handleSend(chip)}
                      className={`text-start p-3 rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 hover:border-brand-500 hover:text-brand-600 hover:shadow-xs text-xs font-bold text-slate-700 dark:text-slate-300 transition-all cursor-pointer ${isRtl ? 'text-right' : 'text-left'}`}
                    >
                      {chip}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {messages.map((m, i) => (
              <div key={i} className={`flex gap-3 ${m.role === 'user' ? 'flex-row-reverse' : ''} animate-fade-in`}>
                <div className={`w-8 h-8 rounded-xl shrink-0 flex items-center justify-center text-xs font-bold shadow-sm ${m.role === 'user' ? 'bg-brand-600 text-white' : 'bg-slate-200 dark:bg-slate-800 text-brand-600 dark:text-brand-400'}`}>
                  {m.role === 'user' ? <User size={14} /> : <Sparkles size={14} />}
                </div>
                <div className={`flex flex-col max-w-[85%] sm:max-w-[75%] ${m.role === 'user' ? 'items-end' : 'items-start'}`}>
                  <div className={`p-4 rounded-2xl text-xs sm:text-sm font-medium leading-relaxed ${m.role === 'user' ? 'bg-brand-600 text-white rounded-tr-none' : 'bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 text-slate-800 dark:text-slate-200 rounded-tl-none shadow-xs'}`}>
                    <p className="whitespace-pre-wrap">{m.text}</p>
                  </div>
                  <span className="text-[10px] text-slate-400 mt-1 px-1">
                    {m.timestamp.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                  </span>
                </div>
              </div>
            ))}

            {isLoading && (
              <div className="flex gap-3 animate-pulse">
                <div className="w-8 h-8 rounded-xl bg-slate-200 dark:bg-slate-800 flex items-center justify-center shrink-0">
                  <Sparkles size={14} className="text-slate-400" />
                </div>
                <div className="bg-white dark:bg-slate-900 p-4 rounded-2xl rounded-tl-none border border-slate-200 dark:border-slate-800 space-y-2 w-2/3 max-w-md">
                  <div className="h-3 bg-slate-200 dark:bg-slate-800 rounded-full w-full"></div>
                  <div className="h-3 bg-slate-200 dark:bg-slate-800 rounded-full w-4/5"></div>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Chat Input Bar */}
        <div className="p-4 bg-white dark:bg-slate-900 border-t border-slate-200 dark:border-slate-800 shrink-0">
          <div className="max-w-4xl mx-auto w-full">
            <div className={`flex items-end gap-2 bg-slate-50 dark:bg-slate-800/80 border border-slate-200 dark:border-slate-700 rounded-2xl p-2.5 focus-within:ring-2 focus-within:ring-brand-500 transition-all ${isRtl ? 'flex-row-reverse' : ''}`}>
              <textarea
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault();
                    handleSend();
                  }
                }}
                placeholder={t.advisor_chat_placeholder || (isRtl ? 'اسأل مستشارك العقاري (مثال: قارن بين أفضل كمبوندات زايد، أو شقق 3 غرف استلام فوري)...' : 'Ask your real estate advisor (e.g. compare top compounds in Zayed, or find 3-bedroom ready to move)...')}
                rows={2}
                className="w-full bg-transparent border-none outline-none text-xs sm:text-sm text-slate-900 dark:text-white resize-none p-1 placeholder:text-slate-400"
              />
              <button
                type="button"
                onClick={() => handleSend()}
                disabled={!input.trim() || isLoading}
                className="p-2.5 rounded-xl bg-brand-600 hover:bg-brand-700 disabled:opacity-40 text-white transition-all cursor-pointer shrink-0 shadow-sm"
                aria-label={isRtl ? 'إرسال' : 'Send'}
              >
                <Send size={16} className={isRtl ? 'rotate-180' : ''} />
              </button>
            </div>
          </div>
        </div>
      </main>
    </div>
  );
};

export default RealEstateAdvisor;
