import React, { useState, useEffect, useMemo, useRef } from 'react';
import { 
  Sparkles, Building2, MapPin, Sliders, RefreshCw, Send, User, Layers,
  Check, Landmark, PieChart, MessageSquare, Box, Download,
  Compass, ShieldCheck, KeyRound, Clock, Bed, CheckCircle2, AlertTriangle, XCircle, FileText
} from 'lucide-react';
import { Property, ChatMessage, ChatSession, AdvisorFinancialProfile, AdvisorPropertyFit, InvestmentPurpose } from '../types';
import { createChat, extract3DMarker, extractAdvisorState, withRetry, isOverloadedError, aiErrorMessage } from '../ai';
import { auth, db, doc, updateDoc, addDoc, collection, query, where, onSnapshot } from '../firebase';
import { api } from '../mockApi';

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
  // Navigation tabs within the Advisor
  const [activeView, setActiveView] = useState<'split' | 'dashboard' | 'chat'>('split');
  const [fitCategoryFilter, setFitCategoryFilter] = useState<'all' | 'perfect' | 'stretch' | 'mismatch'>('all');

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

  const filteredProperties = useMemo(() => {
    if (fitCategoryFilter === 'all') return evaluatedProperties;
    return evaluatedProperties.filter(item => item.category === fitCategoryFilter);
  }, [evaluatedProperties, fitCategoryFilter]);

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

  const handleAskAboutUnit = (propFit: AdvisorPropertyFit) => {
    const prompt = isRtl
      ? `أريد استشارتك العقارية بخصوص وحدة "${propFit.property.title}" في ${propFit.property.location}. ما هو تقييمك لموقعها، سابقة أعمال المطور، ومطابقتها لمتطلباتي؟`
      : `I need your real estate consultation regarding "${propFit.property.title}" in ${propFit.property.location}. What is your assessment of its location, developer credibility, and fit for my needs?`;
    
    if (activeView === 'dashboard') {
      setActiveView(window.innerWidth >= 1024 ? 'split' : 'chat');
    }
    handleSend(prompt);
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
      {/* Top Advisory Bar */}
      <div className="bg-white dark:bg-slate-900 border-b border-slate-200 dark:border-slate-800 px-4 py-3 shrink-0 shadow-sm z-30">
        <div className="max-w-7xl mx-auto flex flex-col md:flex-row items-center justify-between gap-3">
          <div className="flex items-center gap-3 w-full md:w-auto">
            <div className="w-10 h-10 rounded-2xl bg-gradient-to-tr from-brand-600 to-accent-500 flex items-center justify-center text-white shadow-md shadow-brand-500/20">
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
              <p className="text-xs text-slate-500 dark:text-slate-400 font-medium line-clamp-1">
                {t.advisor_subtitle || (isRtl ? 'مستشارك العقاري الموثوق لاختيار أفضل العقارات، مقارنة المشروعات، وفحص خطط السداد وتاريخ المطورين.' : 'Your dedicated real estate consultant for choosing ideal properties, comparing projects, and evaluating payment plans.')}
              </p>
            </div>
          </div>

          {/* Real Estate Indicators Capsule */}
          <div className="flex items-center gap-2 sm:gap-3 overflow-x-auto w-full md:w-auto pb-1 md:pb-0 text-xs">
            <div className="bg-slate-100 dark:bg-slate-800/70 px-3 py-1.5 rounded-xl border border-slate-200/60 dark:border-slate-700 flex items-center gap-2 shrink-0">
              <Compass size={14} className="text-brand-500" />
              <div>
                <span className="text-slate-400 block text-[9px] font-bold">{isRtl ? 'المنطقة المستهدفة' : 'Target District'}</span>
                <span className="font-black text-brand-600 dark:text-brand-400">
                  {profile.preferredLocation === 'all' ? (isRtl ? 'كافة المناطق' : 'All Districts') : profile.preferredLocation}
                </span>
              </div>
            </div>

            <div className="bg-slate-100 dark:bg-slate-800/70 px-3 py-1.5 rounded-xl border border-slate-200/60 dark:border-slate-700 flex items-center gap-2 shrink-0">
              <Building2 size={14} className="text-blue-500" />
              <div>
                <span className="text-slate-400 block text-[9px] font-bold">{isRtl ? 'نوع العقار' : 'Property Type'}</span>
                <span className="font-black text-blue-600 dark:text-blue-400">
                  {profile.propertyType === 'All' ? (isRtl ? 'كافة الأنواع' : 'All Types') : profile.propertyType}
                </span>
              </div>
            </div>

            <div className="bg-slate-100 dark:bg-slate-800/70 px-3 py-1.5 rounded-xl border border-slate-200/60 dark:border-slate-700 flex items-center gap-2 shrink-0">
              <CheckCircle2 size={14} className="text-emerald-500" />
              <div>
                <span className="text-slate-400 block text-[9px] font-bold">{isRtl ? 'عقارات مطابقة' : 'Matching Units'}</span>
                <span className="font-black text-emerald-600 dark:text-emerald-400">
                  {filteredProperties.length} {isRtl ? 'عقار متاح' : 'units'}
                </span>
              </div>
            </div>

            {/* View Mode Switcher */}
            <div className="bg-slate-200 dark:bg-slate-800 p-1 rounded-xl flex items-center gap-1 shrink-0 ms-auto md:ms-0">
              <button
                type="button"
                onClick={() => setActiveView('split')}
                className={`hidden lg:flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs font-bold transition-all cursor-pointer ${activeView === 'split' ? 'bg-white dark:bg-slate-900 text-brand-600 dark:text-brand-400 shadow-sm' : 'text-slate-600 dark:text-slate-400 hover:text-slate-900'}`}
              >
                <Layers size={13} /> {t.advisor_tab_split || (isRtl ? 'عرض منقسم' : 'Split View')}
              </button>
              <button
                type="button"
                onClick={() => setActiveView('dashboard')}
                className={`flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs font-bold transition-all cursor-pointer ${activeView === 'dashboard' ? 'bg-white dark:bg-slate-900 text-brand-600 dark:text-brand-400 shadow-sm' : 'text-slate-600 dark:text-slate-400 hover:text-slate-900'}`}
              >
                <PieChart size={13} /> {t.advisor_tab_dashboard || (isRtl ? 'دليل العقارات' : 'Projects Guide')}
              </button>
              <button
                type="button"
                onClick={() => setActiveView('chat')}
                className={`flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs font-bold transition-all cursor-pointer ${activeView === 'chat' ? 'bg-white dark:bg-slate-900 text-brand-600 dark:text-brand-400 shadow-sm' : 'text-slate-600 dark:text-slate-400 hover:text-slate-900'}`}
              >
                <MessageSquare size={13} /> {t.advisor_tab_chat || (isRtl ? 'المحادثة' : 'Chat')}
              </button>
            </div>

            {/* Export Report Button */}
            <button
              type="button"
              onClick={handleExportReport}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-bold transition-all cursor-pointer bg-brand-50 hover:bg-brand-100 dark:bg-brand-900/30 text-brand-700 dark:text-brand-300 border border-brand-200 dark:border-brand-800 shrink-0"
              title={isRtl ? 'تحميل تقرير الاستشارة العقارية' : 'Export Real Estate Report'}
            >
              <Download size={13} />
              <span className="hidden sm:inline">{isRtl ? 'تصدير التقرير' : 'Export Report'}</span>
            </button>
          </div>
        </div>
      </div>

      {/* Main Container */}
      <div className="flex-1 flex overflow-hidden relative">
        {/* LEFT / MAIN: Real Estate Advisory Dashboard */}
        <div className={`flex-1 flex-col overflow-y-auto custom-scrollbar p-4 sm:p-6 lg:p-8 space-y-8 ${activeView === 'chat' ? 'hidden' : 'flex'} ${activeView === 'split' ? 'lg:w-[55%] xl:w-[60%]' : 'w-full'}`}>
          {/* Section 1: Real Estate Search & Advisory Criteria */}
          <div className="bg-white dark:bg-slate-900 rounded-3xl p-6 border border-slate-200 dark:border-slate-800 shadow-sm space-y-6">
            <div className="flex items-center justify-between border-b border-slate-100 dark:border-slate-800 pb-4">
              <div className="flex items-center gap-2.5">
                <div className="p-2 rounded-xl bg-brand-50 dark:bg-brand-900/30 text-brand-600 dark:text-brand-400">
                  <Compass size={18} />
                </div>
                <div>
                  <h2 className="font-heading font-bold text-base text-slate-900 dark:text-white">
                    {isRtl ? 'محددات البحث والاستشارة العقارية' : 'Real Estate Search & Advisory Criteria'}
                  </h2>
                  <p className="text-xs text-slate-500 dark:text-slate-400">
                    {isRtl ? 'حدد متطلباتك العقارية لتحليل ومقارنة أفضل المشروعات والمطورين المتاحين' : 'Specify your property preferences to evaluate and compare top projects and developers'}
                  </p>
                </div>
              </div>

              <button
                type="button"
                onClick={() => setProfile({
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
                })}
                className="text-xs font-bold text-slate-400 hover:text-brand-600 flex items-center gap-1 cursor-pointer transition-colors"
                title={isRtl ? 'إعادة ضبط' : 'Reset'}
              >
                <RefreshCw size={13} /> {isRtl ? 'إعادة ضبط' : 'Reset'}
              </button>
            </div>

            {/* Interactive Financial & Investment Sliders Deck */}
            <div className="bg-slate-50 dark:bg-slate-900/60 p-5 rounded-2xl border border-slate-200/80 dark:border-slate-800 space-y-5">
              <div className="flex items-center justify-between border-b border-slate-200/60 dark:border-slate-800/80 pb-3">
                <div className="flex items-center gap-2">
                  <Sliders size={18} className="text-brand-600 dark:text-brand-400" />
                  <span className="text-sm font-black text-slate-900 dark:text-white">
                    {isRtl ? 'المحددات المالية والقدرة الاستثمارية المباشرة' : 'Financial Budget & Investment Sliders'}
                  </span>
                </div>
                <span className="text-[11px] font-bold text-slate-500 dark:text-slate-400">
                  {profile.currency || 'EGP'}
                </span>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                {/* 1. Target Budget Slider */}
                <div className="space-y-2">
                  <div className="flex justify-between items-center text-xs font-bold">
                    <label className="text-slate-700 dark:text-slate-300 flex items-center gap-1.5">
                      <Landmark size={14} className="text-emerald-500" />
                      {t.advisor_budget_label || (isRtl ? 'الميزانية الإجمالية المستهدفة' : 'Target Budget')}
                    </label>
                    <span className="text-emerald-600 dark:text-emerald-400 font-black">
                      {profile.budget > 0 ? `${profile.budget.toLocaleString()} ${profile.currency || 'EGP'}` : (isRtl ? 'مرن / غير محدد' : 'Flexible')}
                    </span>
                  </div>
                  <input
                    type="range"
                    min={0}
                    max={40000000}
                    step={250000}
                    value={profile.budget}
                    onChange={(e) => setProfile(prev => ({ ...prev, budget: Number(e.target.value) }))}
                    className="w-full accent-emerald-500 cursor-pointer h-2 bg-slate-200 dark:bg-slate-700 rounded-lg appearance-none"
                    aria-label={t.advisor_budget_label || 'Target Budget'}
                  />
                  <div className="flex gap-1.5 flex-wrap pt-1">
                    {[3000000, 6000000, 10000000, 18000000, 30000000].map(val => (
                      <button
                        key={val}
                        type="button"
                        onClick={() => setProfile(prev => ({ ...prev, budget: val }))}
                        className={`px-2 py-0.5 text-[10px] font-bold rounded-md transition-all cursor-pointer ${profile.budget === val ? 'bg-emerald-600 text-white' : 'bg-white dark:bg-slate-800 text-slate-600 dark:text-slate-300 border border-slate-200 dark:border-slate-700 hover:border-emerald-400'}`}
                      >
                        {val >= 1000000 ? `${val / 1000000}M` : `${val / 1000}k`}
                      </button>
                    ))}
                  </div>
                </div>

                {/* 2. Available Cash / Down Payment Slider */}
                <div className="space-y-2">
                  <div className="flex justify-between items-center text-xs font-bold">
                    <label className="text-slate-700 dark:text-slate-300 flex items-center gap-1.5">
                      <KeyRound size={14} className="text-brand-500" />
                      {t.advisor_down_payment_label || (isRtl ? 'السيولة المتاحة (المقدم)' : 'Available Cash (Down Payment)')}
                    </label>
                    <span className="text-brand-600 dark:text-brand-400 font-black">
                      {profile.downPayment > 0 ? `${profile.downPayment.toLocaleString()} ${profile.currency || 'EGP'}` : (isRtl ? 'مرن / غير محدد' : 'Flexible')}
                    </span>
                  </div>
                  <input
                    type="range"
                    min={0}
                    max={10000000}
                    step={100000}
                    value={profile.downPayment}
                    onChange={(e) => setProfile(prev => ({ ...prev, downPayment: Number(e.target.value) }))}
                    className="w-full accent-brand-500 cursor-pointer h-2 bg-slate-200 dark:bg-slate-700 rounded-lg appearance-none"
                    aria-label={t.advisor_down_payment_label || 'Available Cash (Down Payment)'}
                  />
                  <div className="flex gap-1.5 flex-wrap pt-1">
                    {[500000, 1000000, 2000000, 3500000, 6000000].map(val => (
                      <button
                        key={val}
                        type="button"
                        onClick={() => setProfile(prev => ({ ...prev, downPayment: val }))}
                        className={`px-2 py-0.5 text-[10px] font-bold rounded-md transition-all cursor-pointer ${profile.downPayment === val ? 'bg-brand-600 text-white' : 'bg-white dark:bg-slate-800 text-slate-600 dark:text-slate-300 border border-slate-200 dark:border-slate-700 hover:border-brand-400'}`}
                      >
                        {val >= 1000000 ? `${val / 1000000}M` : `${val / 1000}k`}
                      </button>
                    ))}
                  </div>
                </div>

                {/* 3. Monthly Capacity Slider */}
                <div className="space-y-2">
                  <div className="flex justify-between items-center text-xs font-bold">
                    <label className="text-slate-700 dark:text-slate-300 flex items-center gap-1.5">
                      <Clock size={14} className="text-purple-500" />
                      {t.advisor_monthly_capacity_label || (isRtl ? 'القدرة على القسط الشهري' : 'Max Monthly Installment Capacity')}
                    </label>
                    <span className="text-purple-600 dark:text-purple-400 font-black">
                      {profile.monthlyCapacity > 0 ? `${profile.monthlyCapacity.toLocaleString()} ${profile.currency || 'EGP'}/ش` : (isRtl ? 'مرن / غير محدد' : 'Flexible')}
                    </span>
                  </div>
                  <input
                    type="range"
                    min={0}
                    max={250000}
                    step={10000}
                    value={profile.monthlyCapacity}
                    onChange={(e) => setProfile(prev => ({ ...prev, monthlyCapacity: Number(e.target.value) }))}
                    className="w-full accent-purple-500 cursor-pointer h-2 bg-slate-200 dark:bg-slate-700 rounded-lg appearance-none"
                    aria-label={t.advisor_monthly_capacity_label || 'Max Monthly Installment Capacity'}
                  />
                  <div className="flex gap-1.5 flex-wrap pt-1">
                    {[25000, 50000, 80000, 120000, 200000].map(val => (
                      <button
                        key={val}
                        type="button"
                        onClick={() => setProfile(prev => ({ ...prev, monthlyCapacity: val }))}
                        className={`px-2 py-0.5 text-[10px] font-bold rounded-md transition-all cursor-pointer ${profile.monthlyCapacity === val ? 'bg-purple-600 text-white' : 'bg-white dark:bg-slate-800 text-slate-600 dark:text-slate-300 border border-slate-200 dark:border-slate-700 hover:border-purple-400'}`}
                      >
                        {val >= 1000 ? `${val / 1000}k` : val}
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5">
              {/* Target District */}
              <div>
                <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-1.5 flex items-center gap-1.5">
                  <MapPin size={13} className="text-brand-500" />
                  {isRtl ? 'المنطقة المستهدفة' : 'Target District'}
                </label>
                <select
                  value={profile.preferredLocation}
                  onChange={(e) => setProfile(prev => ({ ...prev, preferredLocation: e.target.value }))}
                  className="w-full px-3 py-2.5 rounded-xl text-xs font-bold border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-white outline-none focus:ring-2 focus:ring-brand-500 transition-all cursor-pointer"
                >
                  <option value="all">{isRtl ? 'كافة المناطق' : 'All Districts'}</option>
                  <option value="New Cairo">{isRtl ? 'التجمع الخامس والقاهرة الجديدة' : 'New Cairo'}</option>
                  <option value="Sheikh Zayed">{isRtl ? 'الشيخ زايد و6 أكتوبر' : 'Sheikh Zayed & 6th Oct'}</option>
                  <option value="North Coast">{isRtl ? 'الساحل الشمالي' : 'North Coast (Sahel)'}</option>
                  <option value="New Capital">{isRtl ? 'العاصمة الإدارية الجديدة' : 'New Administrative Capital'}</option>
                  <option value="Maadi">{isRtl ? 'المعادي' : 'Maadi'}</option>
                  <option value="Shorouk">{isRtl ? 'الشروق ومدينتي والمستقبل' : 'Shorouk & Madinaty'}</option>
                </select>
              </div>

              {/* Property Type */}
              <div>
                <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-1.5 flex items-center gap-1.5">
                  <Building2 size={13} className="text-blue-500" />
                  {isRtl ? 'نوع العقار' : 'Property Type'}
                </label>
                <select
                  value={profile.propertyType}
                  onChange={(e) => setProfile(prev => ({ ...prev, propertyType: e.target.value }))}
                  className="w-full px-3 py-2.5 rounded-xl text-xs font-bold border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-white outline-none focus:ring-2 focus:ring-brand-500 transition-all cursor-pointer"
                >
                  <option value="All">{isRtl ? 'كافة الأنواع' : 'All Types'}</option>
                  <option value="Apartment">{isRtl ? 'شقق سكنية' : 'Apartments'}</option>
                  <option value="Penthouse">{isRtl ? 'بنتهاوس ودوبلكس' : 'Penthouses & Duplexes'}</option>
                  <option value="Villa">{isRtl ? 'فيلات وتاون هاوس' : 'Villas & Townhouses'}</option>
                  <option value="Commercial">{isRtl ? 'تجاري وإداري وعيادات' : 'Commercial & Administrative'}</option>
                  <option value="Chalet">{isRtl ? 'شاليهات ساحلية' : 'Coastal Chalets'}</option>
                </select>
              </div>

              {/* Purchase Objective */}
              <div>
                <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-1.5 flex items-center gap-1.5">
                  <ShieldCheck size={13} className="text-emerald-500" />
                  {t.advisor_purpose_label || (isRtl ? 'الهدف العقاري' : 'Purchase Objective')}
                </label>
                <select
                  value={profile.purpose}
                  onChange={(e) => setProfile(prev => ({ ...prev, purpose: e.target.value as InvestmentPurpose }))}
                  className="w-full px-3 py-2.5 rounded-xl text-xs font-bold border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-white outline-none focus:ring-2 focus:ring-brand-500 transition-all cursor-pointer"
                >
                  <option value="all">{t.advisor_purpose_all || (isRtl ? 'كافة الأهداف' : 'All Objectives')}</option>
                  <option value="residential">{t.advisor_purpose_residential || (isRtl ? 'سكن عائلي واستقرار' : 'Family Home / Residence')}</option>
                  <option value="investment">{t.advisor_purpose_investment || (isRtl ? 'استثمار وتأجير سنوي' : 'Rental Income Investment')}</option>
                  <option value="resale">{t.advisor_purpose_resale || (isRtl ? 'إعادة بيع ونمو رأسمالي' : 'Capital Appreciation / Resale')}</option>
                  <option value="coastal">{t.advisor_purpose_coastal || (isRtl ? 'مصيف وتأجير سياحي' : 'Summer / Coastal Vacation')}</option>
                </select>
              </div>

              {/* Delivery Timeline */}
              <div>
                <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-1.5 flex items-center gap-1.5">
                  <Clock size={13} className="text-amber-500" />
                  {t.advisor_timeline_label || (isRtl ? 'موعد وجاهزية الاستلام' : 'Delivery Status')}
                </label>
                <select
                  value={profile.deliveryTimeline}
                  onChange={(e) => setProfile(prev => ({ ...prev, deliveryTimeline: e.target.value as any }))}
                  className="w-full px-3 py-2.5 rounded-xl text-xs font-bold border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-white outline-none focus:ring-2 focus:ring-brand-500 transition-all cursor-pointer"
                >
                  <option value="all">{t.advisor_timeline_all || (isRtl ? 'أي موعد استلام' : 'Any Delivery Date')}</option>
                  <option value="ready">{t.advisor_timeline_ready || (isRtl ? 'استلام فوري جاهز' : 'Immediate Delivery (Ready to Move)')}</option>
                  <option value="1-2years">{t.advisor_timeline_1_2 || (isRtl ? 'خلال 1 - 2 سنة' : 'Within 1 - 2 Years')}</option>
                  <option value="3+years">{t.advisor_timeline_3_plus || (isRtl ? 'تحت الإنشاء (3 سنوات فأكثر)' : 'Under Construction (3+ Years)')}</option>
                </select>
              </div>

              {/* Preferred Payment Strategy */}
              <div>
                <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-1.5 flex items-center gap-1.5">
                  <KeyRound size={13} className="text-purple-500" />
                  {isRtl ? 'خطة ونظام السداد المفضل' : 'Preferred Payment Strategy'}
                </label>
                <select
                  value={profile.preferredPaymentPlan || 'all'}
                  onChange={(e) => setProfile(prev => ({ ...prev, preferredPaymentPlan: e.target.value }))}
                  className="w-full px-3 py-2.5 rounded-xl text-xs font-bold border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-white outline-none focus:ring-2 focus:ring-brand-500 transition-all cursor-pointer"
                >
                  <option value="all">{isRtl ? 'كافة خطط السداد' : 'All Payment Plans'}</option>
                  <option value="cash">{isRtl ? 'كاش مع خصم فوري' : 'Cash (With Immediate Discount)'}</option>
                  <option value="installments">{isRtl ? 'أقساط مريحة طويلة الأجل' : 'Long-Term Installments'}</option>
                  <option value="lowDown">{isRtl ? 'أقل مقدم حجز ممكن' : 'Low Down Payment'}</option>
                  <option value="readyInstallments">{isRtl ? 'استلام فوري مع تقسيط' : 'Ready to Move with Installments'}</option>
                </select>
              </div>

              {/* Bedrooms & Space */}
              <div>
                <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-1.5 flex items-center gap-1.5">
                  <Bed size={13} className="text-cyan-500" />
                  {isRtl ? 'عدد الغرف والمساحة' : 'Bedrooms & Space'}
                </label>
                <select
                  value={profile.bedrooms || 'all'}
                  onChange={(e) => setProfile(prev => ({ ...prev, bedrooms: e.target.value }))}
                  className="w-full px-3 py-2.5 rounded-xl text-xs font-bold border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-white outline-none focus:ring-2 focus:ring-brand-500 transition-all cursor-pointer"
                >
                  <option value="all">{isRtl ? 'أي عدد غرف' : 'Any Bedrooms'}</option>
                  <option value="1">{isRtl ? 'استوديو / غرفة واحدة' : '1 Bedroom / Studio'}</option>
                  <option value="2">{isRtl ? 'غرفتين نوم' : '2 Bedrooms'}</option>
                  <option value="3">{isRtl ? '3 غرف نوم' : '3 Bedrooms'}</option>
                  <option value="4+">{isRtl ? '4 غرف فأكثر / فيلا' : '4+ Bedrooms / Villa'}</option>
                </select>
              </div>
            </div>

            {/* Real Estate Advisory Guidance & Quality Pillars Banner */}
            <div className="bg-gradient-to-r from-slate-900 via-brand-950 to-slate-900 text-white p-5 rounded-2xl border border-brand-800/40 shadow-md">
              <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 border-b border-white/10 pb-3 mb-4">
                <div className="flex items-center gap-2.5">
                  <div className="p-2 rounded-xl bg-brand-500/20 text-brand-300">
                    <ShieldCheck size={20} />
                  </div>
                  <div>
                    <h3 className="font-heading font-black text-sm sm:text-base text-white">
                      {isRtl ? 'دعائم الاستشارة والتقييم العقاري الشامل' : 'Comprehensive Real Estate Advisory & Due Diligence'}
                    </h3>
                    <p className="text-[11px] text-slate-300">
                      {isRtl ? 'منهجية حِتّتي لمساعدتك في اختيار أنسب قرار عقاري بأعلى معايير الأمان والشفافية' : 'HETTETY advisory methodology for informed, secure real estate acquisition'}
                    </p>
                  </div>
                </div>
                <span className="px-2.5 py-1 rounded-full text-[10px] font-black uppercase tracking-wider bg-emerald-500/20 text-emerald-300 border border-emerald-500/30">
                  {isRtl ? 'استشارة مستقلة 100%' : '100% Unbiased Advisory'}
                </span>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-xs">
                <div className="bg-white/5 p-3 rounded-xl border border-white/5 space-y-1">
                  <div className="flex items-center gap-1.5 font-bold text-white text-xs">
                    <Building2 size={14} className="text-brand-400" />
                    <span>{isRtl ? 'سابقة أعمال المطور' : 'Developer Track Record'}</span>
                  </div>
                  <p className="text-[11px] text-slate-300 leading-relaxed">
                    {isRtl ? 'فحص تاريخ المشروعات المسلمة ومعدل إنجاز الأعمال الإنشائية بالموقع الفعلي.' : 'Review of delivered projects, construction pace, and verified on-site milestones.'}
                  </p>
                </div>

                <div className="bg-white/5 p-3 rounded-xl border border-white/5 space-y-1">
                  <div className="flex items-center gap-1.5 font-bold text-white text-xs">
                    <MapPin size={14} className="text-emerald-400" />
                    <span>{isRtl ? 'الموقع والمحاور الحيوية' : 'Strategic Location'}</span>
                  </div>
                  <p className="text-[11px] text-slate-300 leading-relaxed">
                    {isRtl ? 'تقييم سهولة الوصول، القرب من المدارس والجامعات، ومحاور الطرق الرئيسية.' : 'Proximity to primary transit corridors, lifestyle hubs, and essential infrastructure.'}
                  </p>
                </div>

                <div className="bg-white/5 p-3 rounded-xl border border-white/5 space-y-1">
                  <div className="flex items-center gap-1.5 font-bold text-white text-xs">
                    <FileText size={14} className="text-cyan-400" />
                    <span>{isRtl ? 'فحص العقود والشهر العقاري' : 'Legal & Contract Audit'}</span>
                  </div>
                  <p className="text-[11px] text-slate-300 leading-relaxed">
                    {isRtl ? 'التأكد من سلامة التراخيص وتوافق بنود السداد دون أي أعباء خفية.' : 'Verification of land licenses, title validity, and payment terms without hidden clauses.'}
                  </p>
                </div>
              </div>
            </div>
          </div>

          {/* Section 2: Strategic Real Estate Advisory Indicators */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
            <div className="bg-gradient-to-br from-emerald-50 to-emerald-100/50 dark:from-emerald-950/40 dark:to-emerald-900/20 border border-emerald-200/80 dark:border-emerald-800/60 p-4 rounded-2xl flex flex-col justify-between">
              <span className="text-[11px] font-bold text-emerald-800 dark:text-emerald-300 flex items-center gap-1.5">
                <MapPin size={14} /> {t.advisor_metric_yield || (isRtl ? 'الموقع والوصول الاستراتيجي' : 'Location & Strategic Advantage')}
              </span>
              <div className="mt-2">
                <div className="text-lg sm:text-xl font-black text-emerald-600 dark:text-emerald-400 truncate">
                  {profile.preferredLocation === 'all' ? (isRtl ? 'كافة المناطق' : 'All Hubs') : profile.preferredLocation}
                </div>
                <span className="text-[10px] text-emerald-700/80 dark:text-emerald-400/80 font-medium">
                  {isRtl ? 'قرب مباشر من المحاور الرئيسية' : 'Direct access to main corridors'}
                </span>
              </div>
            </div>

            <div className="bg-gradient-to-br from-blue-50 to-blue-100/50 dark:from-blue-950/40 dark:to-blue-900/20 border border-blue-200/80 dark:border-blue-800/60 p-4 rounded-2xl flex flex-col justify-between">
              <span className="text-[11px] font-bold text-blue-800 dark:text-blue-300 flex items-center gap-1.5">
                <Building2 size={14} /> {t.advisor_metric_growth || (isRtl ? 'جودة التشطيب وجاهزية الاستلام' : 'Finishing & Delivery Quality')}
              </span>
              <div className="mt-2">
                <div className="text-lg sm:text-xl font-black text-blue-600 dark:text-blue-400 truncate">
                  {profile.deliveryTimeline === 'ready' 
                    ? (isRtl ? 'استلام فوري جاهز' : 'Ready to Move') 
                    : profile.deliveryTimeline === '1-2years' 
                    ? (isRtl ? 'تسليم 1 - 2 سنة' : '1 - 2 Years')
                    : profile.deliveryTimeline === '3+years'
                    ? (isRtl ? 'تحت الإنشاء' : 'Under Construction')
                    : (isRtl ? 'خيارات متعددة' : 'Diverse Options')}
                </div>
                <span className="text-[10px] text-blue-700/80 dark:text-blue-400/80 font-medium">
                  {isRtl ? 'فحص دقيق لمواصفات التسليم' : 'Verified handover specs'}
                </span>
              </div>
            </div>

            <div className="bg-gradient-to-br from-brand-50 to-brand-100/50 dark:from-brand-950/40 dark:to-brand-900/20 border border-brand-200/80 dark:border-brand-800/60 p-4 rounded-2xl flex flex-col justify-between">
              <span className="text-[11px] font-bold text-brand-800 dark:text-brand-300 flex items-center gap-1.5">
                <ShieldCheck size={14} /> {t.advisor_metric_total_return || (isRtl ? 'سمعة المطور وسابقة الأعمال' : 'Developer Track Record')}
              </span>
              <div className="mt-2">
                <div className="text-lg sm:text-xl font-black text-brand-600 dark:text-brand-400 truncate">
                  {isRtl ? 'مطورون معتمدون' : 'Verified Developers'}
                </div>
                <span className="text-[10px] text-brand-700/80 dark:text-brand-400/80 font-medium">
                  {isRtl ? 'فحص التراخيص وسجل الإنجاز' : 'Licensed with proven completion'}
                </span>
              </div>
            </div>

            <div className="bg-gradient-to-br from-purple-50 to-purple-100/50 dark:from-purple-950/40 dark:to-purple-900/20 border border-purple-200/80 dark:border-purple-800/60 p-4 rounded-2xl flex flex-col justify-between">
              <span className="text-[11px] font-bold text-purple-800 dark:text-purple-300 flex items-center gap-1.5">
                <KeyRound size={14} /> {t.advisor_metric_payback || (isRtl ? 'مرونة خطط وأقساط السداد' : 'Payment Plan Flexibility')}
              </span>
              <div className="mt-2">
                <div className="text-lg sm:text-xl font-black text-purple-600 dark:text-purple-400 truncate">
                  {profile.preferredPaymentPlan === 'cash' 
                    ? (isRtl ? 'كاش مع خصم' : 'Cash Discount')
                    : profile.preferredPaymentPlan === 'installments'
                    ? (isRtl ? 'أقساط ممتدة' : 'Extended Years')
                    : (isRtl ? 'أنظمة متعددة' : 'Multiple Plans')}
                </div>
                <span className="text-[10px] text-purple-700/80 dark:text-purple-400/80 font-medium">
                  {isRtl ? 'خطط دفع مريحة بدون فوائد' : 'Interest-free flexible plans'}
                </span>
              </div>
            </div>
          </div>

          {/* Section 2.5: Dedicated User Budget, ROI & Annual Yield Dashboard */}
          <div className="bg-gradient-to-br from-slate-900 via-brand-950 to-slate-900 text-white rounded-2xl p-6 border border-brand-800/40 shadow-xl space-y-6">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-white/10 pb-4">
              <div>
                <div className="flex items-center gap-2">
                  <span className="p-1.5 rounded-lg bg-emerald-500/20 text-emerald-400">
                    <PieChart size={18} />
                  </span>
                  <h3 className="font-heading font-black text-base sm:text-lg">
                    {isRtl ? 'لوحة التقييم المالي والعائد الاستثماري لميزانيتك' : 'Personalized Budget & Investment Yield Dashboard'}
                  </h3>
                </div>
                <p className="text-xs text-slate-300 mt-1">
                  {isRtl ? 'تحليل مباشر لمدى توافق قدرتك الشرائية وحساب العائد السنوي المتوقع' : 'Live analysis of your financial capacity, projected annual yield, and portfolio fit'}
                </p>
              </div>

              <div className="flex items-center gap-2">
                <span className="px-3 py-1 rounded-full text-xs font-black bg-brand-500/20 text-brand-300 border border-brand-500/30">
                  {profile.preferredLocation === 'all' ? (isRtl ? 'عموم السوق المصري' : 'Market-wide') : profile.preferredLocation}
                </span>
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
              {/* Metric 1: Budget Allocation */}
              <div className="bg-white/5 rounded-xl p-4 border border-white/5">
                <span className="text-[11px] font-bold text-slate-400 block mb-1 flex items-center gap-1.5">
                  <Landmark size={13} className="text-emerald-400" />
                  {isRtl ? 'الميزانية المعتمدة' : 'Allocated Budget'}
                </span>
                <div className="text-xl font-black text-emerald-400">
                  {profile.budget > 0 ? `${profile.budget.toLocaleString()} ${profile.currency || 'EGP'}` : (isRtl ? 'مرن / غير محدد' : 'Flexible')}
                </div>
                <div className="text-[10px] text-slate-300 mt-1.5 space-y-0.5">
                  <div>{isRtl ? 'المقدم المتاح:' : 'Down payment:'} <span className="font-bold text-white">{profile.downPayment > 0 ? `${profile.downPayment.toLocaleString()} ${profile.currency || 'EGP'}` : (isRtl ? 'مرن' : 'Flexible')}</span></div>
                  <div>{isRtl ? 'القسط الشهري:' : 'Monthly:'} <span className="font-bold text-white">{profile.monthlyCapacity > 0 ? `${profile.monthlyCapacity.toLocaleString()} ${profile.currency || 'EGP'}` : (isRtl ? 'مرن' : 'Flexible')}</span></div>
                </div>
              </div>

              {/* Metric 2: Annual Rental Yield */}
              <div className="bg-white/5 rounded-xl p-4 border border-white/5">
                <span className="text-[11px] font-bold text-slate-400 block mb-1 flex items-center gap-1.5">
                  <PieChart size={13} className="text-cyan-400" />
                  {isRtl ? 'العائد الإيجاري السنوي' : 'Annual Rental Yield'}
                </span>
                <div className="text-xl font-black text-cyan-400">
                  {getDistrictBenchmark(profile.preferredLocation, profile.propertyType).rentalYield}%
                </div>
                <p className="text-[10px] text-slate-300 mt-1.5">
                  {profile.budget > 0 
                    ? (isRtl 
                        ? `دخل إيجاري تقديري ~${Math.round((profile.budget * getDistrictBenchmark(profile.preferredLocation, profile.propertyType).rentalYield) / 100).toLocaleString()} ${profile.currency || 'EGP'} سنوياً`
                        : `Estimated ~${Math.round((profile.budget * getDistrictBenchmark(profile.preferredLocation, profile.propertyType).rentalYield) / 100).toLocaleString()} ${profile.currency || 'EGP'}/year`)
                    : (isRtl ? 'متوسط العائد الإيجاري بالمنطقة' : 'Average area rental return')}
                </p>
              </div>

              {/* Metric 3: Capital Appreciation */}
              <div className="bg-white/5 rounded-xl p-4 border border-white/5">
                <span className="text-[11px] font-bold text-slate-400 block mb-1 flex items-center gap-1.5">
                  <Sparkles size={13} className="text-amber-400" />
                  {isRtl ? 'النمو الرأسمالي السنوي' : 'Annual Capital Growth'}
                </span>
                <div className="text-xl font-black text-amber-400">
                  +{getDistrictBenchmark(profile.preferredLocation, profile.propertyType).capitalGrowth}%
                </div>
                <p className="text-[10px] text-slate-300 mt-1.5">
                  {isRtl 
                    ? `إجمالي العائد المركب: ${(getDistrictBenchmark(profile.preferredLocation, profile.propertyType).rentalYield + getDistrictBenchmark(profile.preferredLocation, profile.propertyType).capitalGrowth)}% سنوياً`
                    : `Total combined return: ${(getDistrictBenchmark(profile.preferredLocation, profile.propertyType).rentalYield + getDistrictBenchmark(profile.preferredLocation, profile.propertyType).capitalGrowth)}%/year`}
                </p>
              </div>

              {/* Metric 4: Fit Breakdown */}
              <div className="bg-white/5 rounded-xl p-4 border border-white/5">
                <span className="text-[11px] font-bold text-slate-400 block mb-1 flex items-center gap-1.5">
                  <CheckCircle2 size={13} className="text-emerald-400" />
                  {isRtl ? 'تطابق العقارات مع ميزانيتك' : 'Property Budget Fit'}
                </span>
                <div className="text-xl font-black text-emerald-400 flex items-center gap-2">
                  <span>{stats.perfectCount}</span>
                  <span className="text-xs font-normal text-slate-400">
                    {isRtl ? `من أصل ${evaluatedProperties.length}` : `of ${evaluatedProperties.length}`}
                  </span>
                </div>
                <div className="text-[10px] text-slate-300 mt-1.5 flex items-center gap-2 flex-wrap">
                  <span className="text-emerald-400 font-bold">{stats.perfectCount} {isRtl ? 'مناسب' : 'Perfect'}</span>
                  <span>•</span>
                  <span className="text-amber-400 font-bold">{stats.stretchCount} {isRtl ? 'فرص قريبة' : 'Stretch'}</span>
                  <span>•</span>
                  <span className="text-red-400 font-bold">{stats.mismatchCount} {isRtl ? 'أعلى من الميزانية' : 'Mismatch'}</span>
                </div>
              </div>
            </div>

            {/* Top Developers Matching */}
            <div className="pt-2 border-t border-white/10 flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-xs">
              <span className="text-slate-400 font-bold flex items-center gap-1.5">
                <Building2 size={13} className="text-brand-400" />
                {isRtl ? 'أبرز المطورين المتوافقين مع معاييرك:' : 'Top Compatible Developers:'}
              </span>
              <div className="flex items-center gap-2 flex-wrap">
                {['Hyde Park Developments', 'Mountain View', 'SODIC', 'Emaar Misr'].map(dev => (
                  <span key={dev} className="px-2.5 py-1 rounded-lg bg-white/10 text-white font-bold text-[11px] border border-white/10">
                    {dev}
                  </span>
                ))}
              </div>
            </div>
          </div>

          {/* Section 3: Property Matching & Due Diligence Review */}
          <div className="space-y-4">
            <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
              <div>
                <h2 className="font-heading font-black text-lg text-slate-900 dark:text-white flex items-center gap-2">
                  <Building2 className="text-brand-500" size={20} />
                  {isRtl ? 'العقارات والمشروعات المفحوصة' : 'Properties Evaluated for You'}
                  <span className="text-xs bg-slate-200 dark:bg-slate-800 px-2 py-0.5 rounded-full font-bold">
                    {filteredProperties.length}
                  </span>
                </h2>
                <p className="text-xs text-slate-500 dark:text-slate-400">
                  {isRtl ? 'فحص شامل لمواصفات كل عقار، موقعه، جاهزية الاستلام، ومطابقته لمتطلباتك' : 'Comprehensive analysis of each property, location, delivery timeline, and feature fit'}
                </p>
              </div>

              {/* Match Category Filters */}
              <div className="flex items-center gap-1.5 bg-white dark:bg-slate-900 p-1 rounded-xl border border-slate-200 dark:border-slate-800 text-xs font-bold shrink-0">
                <button
                  type="button"
                  onClick={() => setFitCategoryFilter('all')}
                  className={`px-3 py-1.5 rounded-lg transition-all cursor-pointer ${fitCategoryFilter === 'all' ? 'bg-brand-600 text-white shadow-sm' : 'text-slate-600 dark:text-slate-400 hover:text-slate-900'}`}
                >
                  {isRtl ? 'الكل' : 'All'} ({stats.totalCount})
                </button>
                <button
                  type="button"
                  onClick={() => setFitCategoryFilter('perfect')}
                  className={`px-3 py-1.5 rounded-lg transition-all cursor-pointer flex items-center gap-1 ${fitCategoryFilter === 'perfect' ? 'bg-green-600 text-white shadow-sm' : 'text-green-700 dark:text-green-400 hover:bg-green-50 dark:hover:bg-green-950/40'}`}
                >
                  <CheckCircle2 size={13} /> {t.advisor_perfect_title || (isRtl ? 'مناسب تماماً' : 'Perfect Match')} ({stats.perfectCount})
                </button>
                <button
                  type="button"
                  onClick={() => setFitCategoryFilter('stretch')}
                  className={`px-3 py-1.5 rounded-lg transition-all cursor-pointer flex items-center gap-1 ${fitCategoryFilter === 'stretch' ? 'bg-amber-600 text-white shadow-sm' : 'text-amber-700 dark:text-amber-400 hover:bg-amber-50 dark:hover:bg-amber-950/40'}`}
                >
                  <AlertTriangle size={13} /> {t.advisor_stretch_title || (isRtl ? 'فرص مميزة' : 'Recommended Opportunities')} ({stats.stretchCount})
                </button>
                <button
                  type="button"
                  onClick={() => setFitCategoryFilter('mismatch')}
                  className={`px-3 py-1.5 rounded-lg transition-all cursor-pointer flex items-center gap-1 ${fitCategoryFilter === 'mismatch' ? 'bg-red-600 text-white shadow-sm' : 'text-red-700 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-950/40'}`}
                >
                  <XCircle size={13} /> {t.advisor_mismatch_title || (isRtl ? 'خيارات بديلة' : 'Alternative Options')} ({stats.mismatchCount})
                </button>
              </div>
            </div>

            {/* Property Cards Grid */}
            {filteredProperties.length === 0 ? (
              <div className="bg-white dark:bg-slate-900 rounded-3xl p-12 text-center border border-slate-200 dark:border-slate-800 space-y-3">
                <Building2 size={40} className="mx-auto text-slate-300 dark:text-slate-700" />
                <h3 className="font-bold text-slate-700 dark:text-slate-300">
                  {isRtl ? 'لا توجد عقارات تطابق هذا الفلتر حالياً' : 'No properties match this filter currently'}
                </h3>
                <p className="text-xs text-slate-400 max-w-md mx-auto">
                  {isRtl ? 'يمكنك اختيار مناطق أو أنواع عقارات إضافية في محددات البحث بالأعلى.' : 'Try selecting additional districts or property types in the search criteria above.'}
                </p>
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {filteredProperties.map(fit => {
                  const { property, matchScore, category, reasons } = fit;
                  const hasReal3D = !!(property.threeDTour?.assetUrl || property.digitalTwinUrl);
                  const has360 = !!(property.panoramas && property.panoramas.length > 0);
                  const hasPhotoRelief = !!(property.images && property.images.length > 1);
                  const canOpenSpatialViewer = hasReal3D || has360 || hasPhotoRelief;

                  return (
                    <div
                      key={property.id}
                      className={`bg-white dark:bg-slate-900 rounded-2xl border p-5 transition-all hover:shadow-lg flex flex-col justify-between space-y-4 ${
                        category === 'perfect'
                          ? 'border-green-300 dark:border-green-800/60 shadow-green-500/5'
                          : category === 'stretch'
                          ? 'border-amber-300 dark:border-amber-800/60 shadow-amber-500/5'
                          : 'border-slate-200 dark:border-slate-800 opacity-80'
                      }`}
                    >
                      {/* Header with status badge */}
                      <div>
                        <div className="flex items-start justify-between gap-3 mb-2">
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2 mb-1 flex-wrap">
                              {category === 'perfect' && (
                                <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[10px] font-black bg-green-100 dark:bg-green-900/40 text-green-700 dark:text-green-300 border border-green-200 dark:border-green-800">
                                  <CheckCircle2 size={12} /> {t.advisor_perfect_title || (isRtl ? 'مناسب تماماً' : 'Perfect Match')} ({matchScore}%)
                                </span>
                              )}
                              {category === 'stretch' && (
                                <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[10px] font-black bg-amber-100 dark:bg-amber-900/40 text-amber-700 dark:text-amber-300 border border-amber-200 dark:border-amber-800">
                                  <AlertTriangle size={12} /> {t.advisor_stretch_title || (isRtl ? 'فرصة مميزة' : 'Recommended')} ({matchScore}%)
                                </span>
                              )}
                              {category === 'mismatch' && (
                                <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[10px] font-black bg-red-100 dark:bg-red-900/40 text-red-700 dark:text-red-300 border border-red-200 dark:border-red-800">
                                  <XCircle size={12} /> {t.advisor_mismatch_title || (isRtl ? 'خيار بديل' : 'Alternative')} ({matchScore}%)
                                </span>
                              )}

                              {property.yallaSahel && (
                                <span className="text-[10px] font-bold bg-cyan-50 dark:bg-cyan-900/30 text-cyan-700 dark:text-cyan-300 px-2 py-0.5 rounded">
                                  🌊 {isRtl ? 'ساحل حِتّتي' : 'Sahel'}
                                </span>
                              )}

                              {hasReal3D ? (
                                <span className="text-[10px] font-bold bg-emerald-50 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-300 px-2 py-0.5 rounded flex items-center gap-1">
                                  <Box size={10} /> 3D Tour
                                </span>
                              ) : has360 ? (
                                <span className="text-[10px] font-bold bg-blue-50 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300 px-2 py-0.5 rounded flex items-center gap-1">
                                  <Box size={10} /> 360°
                                </span>
                              ) : hasPhotoRelief ? (
                                <span className="text-[10px] font-bold bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400 px-2 py-0.5 rounded flex items-center gap-1">
                                  <Box size={10} /> {isRtl ? 'مجسم' : 'Relief'}
                                </span>
                              ) : null}
                            </div>

                            <h3 
                              onClick={() => onOpenProperty && onOpenProperty(property.id)}
                              className="font-heading font-bold text-base text-slate-900 dark:text-white line-clamp-1 hover:text-brand-600 transition-colors cursor-pointer"
                            >
                              {property.title}
                            </h3>
                            <div className="flex items-center text-xs text-slate-500 dark:text-slate-400 gap-1 mt-0.5">
                              <MapPin size={12} />
                              <span className="truncate">{property.location}</span>
                            </div>
                          </div>

                          <div className="text-end shrink-0">
                            <div className="text-base font-black text-brand-600 dark:text-brand-400">
                              {property.price ? `${property.price.toLocaleString()} ${property.currency || 'EGP'}` : (isRtl ? 'عند الطلب' : 'On Request')}
                            </div>
                            <span className="text-[10px] font-bold text-slate-500 dark:text-slate-400 block">
                              {property.propertyType || (isRtl ? 'وحدة سكنية' : 'Property')}
                            </span>
                          </div>
                        </div>

                        {/* Real Estate Specifications Grid */}
                        <div className="grid grid-cols-3 gap-2 bg-slate-50 dark:bg-slate-800/50 p-2.5 rounded-xl text-center border border-slate-100 dark:border-slate-800 my-3">
                          <div>
                            <span className="block text-[9px] text-slate-400 font-bold">{isRtl ? 'نوع العقار' : 'Type'}</span>
                            <span className="text-xs font-black text-slate-800 dark:text-slate-200 truncate block">
                              {property.propertyType || (isRtl ? 'سكني' : 'Residential')}
                            </span>
                          </div>
                          <div>
                            <span className="block text-[9px] text-slate-400 font-bold">{isRtl ? 'الغرف والمساحة' : 'Bedrooms & Area'}</span>
                            <span className="text-xs font-black text-slate-800 dark:text-slate-200 block">
                              {property.bedrooms ? `${property.bedrooms} ${isRtl ? 'غرف' : 'beds'}` : '-'} • {property.area ? `${property.area} م²` : '-'}
                            </span>
                          </div>
                          <div>
                            <span className="block text-[9px] text-slate-400 font-bold">{isRtl ? 'جاهزية الاستلام' : 'Handover'}</span>
                            <span className="text-xs font-black text-emerald-600 dark:text-emerald-400 block truncate">
                              {property.deliveryDate || property.deliveryTimeline || (isRtl ? 'غير محدد' : 'Not stated')}
                            </span>
                          </div>
                        </div>

                        {/* Payment Plan & Features Line */}
                        <div className="flex items-center justify-between text-[11px] text-slate-600 dark:text-slate-300 px-1 font-semibold mb-2">
                          <span className="flex items-center gap-1">
                            <KeyRound size={12} className="text-purple-500" />
                            {property.paymentPlans && property.paymentPlans.length > 0 ? (
                              <span>{property.paymentPlans[0].downPayment}% {isRtl ? 'مقدم' : 'down'} • {property.paymentPlans[0].years} {isRtl ? 'سنوات تقسيط' : 'yrs'}</span>
                            ) : (
                              <span>{isRtl ? 'أنظمة سداد مرنة متاحة' : 'Flexible Payment Plans'}</span>
                            )}
                          </span>
                          {hasReal3D ? (
                            <span className="text-emerald-600 dark:text-emerald-400 flex items-center gap-1 text-[10px] font-bold">
                              <Box size={12} /> {isRtl ? 'جولة 3D تفاعلية' : '3D Walkthrough'}
                            </span>
                          ) : has360 ? (
                            <span className="text-blue-600 dark:text-blue-400 flex items-center gap-1 text-[10px] font-semibold">
                              <Box size={12} /> {isRtl ? 'بانوراما 360°' : '360° Tour'}
                            </span>
                          ) : hasPhotoRelief ? (
                            <span className="text-slate-500 dark:text-slate-400 flex items-center gap-1 text-[10px]">
                              <Box size={12} /> {isRtl ? 'معاينة مجسمة للصورة' : 'Photo Relief'}
                            </span>
                          ) : null}
                        </div>

                        {/* Evaluation Reasons Checklist */}
                        <div className="space-y-1 my-2">
                          {reasons.slice(0, 3).map((r, rIdx) => (
                            <div key={rIdx} className="flex items-start gap-1.5 text-xs text-slate-600 dark:text-slate-300">
                              {category === 'mismatch' ? (
                                <XCircle size={13} className="text-red-500 shrink-0 mt-0.5" />
                              ) : category === 'stretch' ? (
                                <AlertTriangle size={13} className="text-amber-500 shrink-0 mt-0.5" />
                              ) : (
                                <Check size={13} className="text-green-500 shrink-0 mt-0.5" />
                              )}
                              <span className="leading-tight">{r}</span>
                            </div>
                          ))}
                        </div>
                      </div>

                      {/* Action buttons */}
                      <div className="flex items-center gap-2 pt-3 border-t border-slate-100 dark:border-slate-800">
                        <button
                          type="button"
                          onClick={() => handleAskAboutUnit(fit)}
                          className="flex-1 py-2 px-3 rounded-xl bg-brand-50 hover:bg-brand-100 dark:bg-brand-900/30 dark:hover:bg-brand-900/50 text-brand-700 dark:text-brand-300 text-xs font-bold transition-all flex items-center justify-center gap-1.5 cursor-pointer"
                        >
                          <Sparkles size={14} />
                          {t.advisor_ask_ai_unit || (isRtl ? 'استشر المستشار العقاري' : 'Ask Advisor')}
                        </button>

                        {onShow3D && canOpenSpatialViewer && (
                          <button
                            type="button"
                            onClick={() => onShow3D(property.id)}
                            className="p-2 rounded-xl bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 transition-colors cursor-pointer shrink-0"
                            title="3D Tour"
                          >
                            <Box size={16} />
                          </button>
                        )}

                        {onOpenProperty && (
                          <button
                            type="button"
                            onClick={() => onOpenProperty(property.id)}
                            className="py-2 px-3 rounded-xl bg-slate-900 hover:bg-black dark:bg-slate-100 dark:hover:bg-white text-white dark:text-slate-900 text-xs font-bold transition-all shrink-0 cursor-pointer"
                          >
                            {isRtl ? 'التفاصيل' : 'Details'}
                          </button>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>

        {/* RIGHT / CHAT: Conversational Real Estate Advisor */}
        <div className={`flex-col h-full bg-white dark:bg-slate-900 border-s border-slate-200 dark:border-slate-800 z-20 ${activeView === 'dashboard' ? 'hidden' : 'flex'} ${activeView === 'split' ? 'lg:w-[45%] xl:w-[40%]' : 'w-full'}`}>
          {/* Chat Header */}
          <div className="p-4 border-b border-slate-100 dark:border-slate-800 flex items-center justify-between shrink-0">
            <div className="flex items-center gap-2.5">
              <div className="w-8 h-8 rounded-xl bg-brand-600 flex items-center justify-center text-white shadow-sm">
                <Sparkles size={16} />
              </div>
              <div>
                <h3 className="font-heading font-bold text-sm text-slate-900 dark:text-white">
                  {isRtl ? 'محادثة المستشار العقاري' : 'Real Estate Consultation Chat'}
                </h3>
                <span className="text-[10px] text-emerald-500 font-bold flex items-center gap-1">
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse"></span>
                  {isRtl ? 'متصل وجاهز للاستشارة' : 'Online & Ready'}
                </span>
              </div>
            </div>

            <button
              type="button"
              onClick={() => {
                setMessages([]);
                setCurrentSessionId(null);
              }}
              className="text-xs text-slate-400 hover:text-brand-600 font-bold cursor-pointer transition-colors"
            >
              {isRtl ? 'محادثة جديدة' : 'New Session'}
            </button>
          </div>

          {/* Messages Container */}
          <div ref={scrollRef} className="flex-1 overflow-y-auto p-4 space-y-4 custom-scrollbar bg-slate-50/50 dark:bg-slate-950/50">
            {messages.length === 0 && (
              <div className="flex flex-col items-center justify-center h-full text-center p-4 space-y-4">
                <div className="w-14 h-14 rounded-2xl bg-brand-100 dark:bg-brand-900/30 text-brand-600 dark:text-brand-400 flex items-center justify-center shadow-inner">
                  <Sparkles size={28} />
                </div>
                <div>
                  <h4 className="font-heading font-black text-base text-slate-900 dark:text-white">
                    {isRtl ? 'مستشارك العقاري الموثوق في خدمتك' : 'Your Trusted Real Estate Advisor'}
                  </h4>
                  <p className="text-xs text-slate-500 dark:text-slate-400 mt-1 max-w-xs leading-relaxed">
                    {isRtl
                      ? 'شاركني منطقتك المفضلة، نوع العقار، وموعد الاستلام المناسب، وسأقدم لك استشارة عقارية شاملة ومقارنة بين أفضل المشروعات والمطورين.'
                      : 'Share your preferred district, property type, and delivery timeline, and I will guide you with comprehensive real estate advice and project comparisons.'}
                  </p>
                </div>

                {/* Quick Consultation Chips (No Hardcoded Numbers) */}
                <div className="w-full space-y-2 pt-2">
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
                      className={`w-full text-start p-2.5 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 hover:border-brand-500 hover:text-brand-600 text-xs font-bold text-slate-700 dark:text-slate-300 transition-all shadow-2xs cursor-pointer ${isRtl ? 'text-right' : 'text-left'}`}
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
                <div className={`flex flex-col max-w-[85%] ${m.role === 'user' ? 'items-end' : 'items-start'}`}>
                  <div className={`p-3.5 rounded-2xl text-xs sm:text-sm font-medium leading-relaxed ${m.role === 'user' ? 'bg-brand-600 text-white rounded-tr-none' : 'bg-white dark:bg-slate-800 border border-slate-100 dark:border-slate-700 text-slate-800 dark:text-slate-200 rounded-tl-none shadow-sm'}`}>
                    <p className="whitespace-pre-wrap">{m.text}</p>
                  </div>
                  <span className="text-[9px] text-slate-400 mt-1 px-1">
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
                <div className="bg-white dark:bg-slate-800 p-3.5 rounded-2xl rounded-tl-none border border-slate-100 dark:border-slate-700 space-y-2 w-2/3">
                  <div className="h-3 bg-slate-200 dark:bg-slate-700 rounded-full w-full"></div>
                  <div className="h-3 bg-slate-200 dark:bg-slate-700 rounded-full w-4/5"></div>
                </div>
              </div>
            )}
          </div>

          {/* Chat Input Bar */}
          <div className="p-3 sm:p-4 bg-white dark:bg-slate-900 border-t border-slate-100 dark:border-slate-800 shrink-0">
            <div className={`flex items-end gap-2 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-2xl p-2 focus-within:ring-2 focus-within:ring-brand-500 transition-all ${isRtl ? 'flex-row-reverse' : ''}`}>
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
                className="w-full bg-transparent border-none outline-none text-xs sm:text-sm text-slate-900 dark:text-white resize-none p-1"
              />
              <button
                type="button"
                onClick={() => handleSend()}
                disabled={!input.trim() || isLoading}
                className="p-2.5 rounded-xl bg-brand-600 hover:bg-brand-700 disabled:opacity-40 text-white transition-all cursor-pointer shrink-0 shadow-sm"
                aria-label={isRtl ? 'إرسال' : 'Send'}
              >
                <Send size={15} className={isRtl ? 'rotate-180' : ''} />
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default RealEstateAdvisor;
