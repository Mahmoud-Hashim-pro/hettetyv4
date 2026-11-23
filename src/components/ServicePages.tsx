import React from 'react';
import {
  ArrowLeft,
  ArrowRight,
  CheckCircle,
  ShieldCheck,
  Building2,
  Box,
  Clock,
  FileSearch,
  Scan,
  SlidersHorizontal,
  Info,
} from 'lucide-react';

interface ProcessStep {
  num: string;
  title: string;
  desc: string;
}

interface ServicePageProps {
  badge: string;
  title: string;
  description: string;
  features: { title: string; desc: string; icon: React.ReactNode }[];
  stepsTitle: string;
  steps: ProcessStep[];
  honestNote: string;
  ctaText: string;
  onCta: () => void;
  isRtl: boolean;
}

const ServicePage: React.FC<ServicePageProps> = ({
  badge,
  title,
  description,
  features,
  stepsTitle,
  steps,
  honestNote,
  ctaText,
  onCta,
  isRtl,
}) => {
  return (
    <div
      className={`min-h-screen bg-white dark:bg-slate-950 text-[#1b2c4d] dark:text-white font-sans animate-fade-in transition-colors duration-500 ${
        isRtl ? 'font-cairo' : ''
      }`}
      dir={isRtl ? 'rtl' : 'ltr'}
    >
      {/* Architectural Hero */}
      <section className="relative pt-24 sm:pt-32 pb-20 px-4 sm:px-6 text-center overflow-hidden border-b border-slate-200/70 dark:border-slate-800/70">
        <div
          className="absolute inset-0 pointer-events-none opacity-60 dark:opacity-35 bg-[linear-gradient(to_right,rgba(27,44,77,0.045)_1px,transparent_1px),linear-gradient(to_bottom,rgba(27,44,77,0.045)_1px,transparent_1px)] dark:bg-[linear-gradient(to_right,rgba(255,255,255,0.035)_1px,transparent_1px),linear-gradient(to_bottom,rgba(255,255,255,0.035)_1px,transparent_1px)] bg-[size:48px_48px]"
          aria-hidden="true"
        />
        <div
          className="absolute top-0 start-1/2 -translate-x-1/2 w-[48rem] h-[22rem] bg-brand-600/10 dark:bg-brand-500/20 blur-[120px] rounded-full pointer-events-none"
          aria-hidden="true"
        />

        <div className="max-w-4xl mx-auto relative z-10">
          <span
            className={`inline-flex items-center gap-2 py-1.5 px-4 rounded-full bg-brand-50 dark:bg-slate-900 border border-brand-200/80 dark:border-slate-800 text-brand-700 dark:text-accent-300 text-xs font-black mb-6 shadow-xs ${
              isRtl ? 'font-cairo' : 'uppercase tracking-[0.2em]'
            }`}
          >
            <span className="w-2 h-2 rounded-full bg-accent-500" aria-hidden="true" />
            {badge}
          </span>

          <h1
            className={`text-4xl sm:text-5xl md:text-6xl font-black mb-6 leading-tight text-[#1b2c4d] dark:text-white ${
              isRtl ? 'font-cairo leading-[1.18]' : 'font-heading tracking-tighter'
            }`}
          >
            {title}
          </h1>

          <p className="text-lg sm:text-xl text-slate-600 dark:text-slate-300 leading-relaxed max-w-2xl mx-auto mb-10 font-medium">
            {description}
          </p>

          <button
            type="button"
            onClick={onCta}
            className={`bg-accent-500 hover:bg-accent-600 active:bg-accent-700 text-white px-9 py-4 rounded-2xl font-black text-base sm:text-lg transition-all duration-300 shadow-xl shadow-accent-500/25 hover:shadow-2xl hover:shadow-accent-500/40 transform hover:-translate-y-0.5 active:scale-95 inline-flex items-center justify-center gap-3 cursor-pointer focus:outline-none focus:ring-2 focus:ring-accent-500 focus:ring-offset-2 dark:focus:ring-offset-slate-950 ${
              isRtl ? 'font-cairo' : 'uppercase tracking-wider'
            }`}
          >
            <span>{ctaText}</span>
            {isRtl ? (
              <ArrowLeft size={22} aria-hidden="true" />
            ) : (
              <ArrowRight size={22} aria-hidden="true" />
            )}
          </button>
        </div>
      </section>

      {/* Numbered Capability Cards */}
      <section className="py-16 sm:py-20 px-4 sm:px-6 bg-slate-50/80 dark:bg-slate-900/35">
        <div className="max-w-6xl mx-auto grid md:grid-cols-3 gap-7">
          {features.map((feature, index) => (
            <article
              key={index}
              className="group relative bg-white dark:bg-slate-900 p-8 rounded-3xl border border-slate-200/80 dark:border-slate-800 hover:border-brand-300 dark:hover:border-brand-700 transition-all duration-300 hover:-translate-y-1.5 shadow-sm hover:shadow-2xl hover:shadow-brand-900/10 overflow-hidden text-start"
            >
              <div
                className="absolute inset-x-0 top-0 h-1 bg-gradient-to-r from-[#1b2c4d] via-brand-500 to-accent-500 opacity-0 group-hover:opacity-100 transition-opacity duration-300"
                aria-hidden="true"
              />
              <div className="flex items-center justify-between mb-6">
                <div className="w-14 h-14 bg-brand-50 dark:bg-brand-900/60 border border-brand-100 dark:border-brand-800 rounded-2xl flex items-center justify-center text-[#1b2c4d] dark:text-accent-400 group-hover:bg-[#1b2c4d] group-hover:text-white dark:group-hover:bg-accent-500 dark:group-hover:text-white transition-all duration-300">
                  {feature.icon}
                </div>
                <span className="font-mono text-xs font-black px-2.5 py-1 rounded-lg bg-slate-100 dark:bg-slate-800 text-slate-500 dark:text-slate-400">
                  0{index + 1}
                </span>
              </div>
              <h2
                className={`text-xl font-black mb-3 text-[#1b2c4d] dark:text-white ${
                  isRtl ? 'font-cairo' : 'font-heading tracking-tight'
                }`}
              >
                {feature.title}
              </h2>
              <p className="text-sm sm:text-base text-slate-600 dark:text-slate-400 leading-relaxed font-medium">
                {feature.desc}
              </p>
            </article>
          ))}
        </div>
      </section>

      {/* Step-by-Step Practical Process Strip */}
      <section className="py-16 sm:py-20 px-4 sm:px-6 bg-white dark:bg-slate-950 border-t border-slate-200/70 dark:border-slate-800/70">
        <div className="max-w-6xl mx-auto">
          <div className="text-center mb-12">
            <h2
              className={`text-2xl sm:text-3xl font-black text-[#1b2c4d] dark:text-white ${
                isRtl ? 'font-cairo' : 'font-heading tracking-tight'
              }`}
            >
              {stepsTitle}
            </h2>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-10">
            {steps.map((step) => (
              <div
                key={step.num}
                className="p-6 rounded-2xl bg-slate-50/90 dark:bg-slate-900/70 border border-slate-200/80 dark:border-slate-800 text-start"
              >
                <span className="inline-block font-mono text-xs font-black text-accent-600 dark:text-accent-400 mb-2">
                  {isRtl ? `خطوة ${step.num}` : `STEP ${step.num}`}
                </span>
                <h3
                  className={`text-base sm:text-lg font-black text-[#1b2c4d] dark:text-white mb-2 ${
                    isRtl ? 'font-cairo' : 'font-heading'
                  }`}
                >
                  {step.title}
                </h3>
                <p className="text-sm text-slate-600 dark:text-slate-400 leading-relaxed">
                  {step.desc}
                </p>
              </div>
            ))}
          </div>

          {/* Transparent Scope Notice */}
          <div className="rounded-2xl bg-brand-50/70 dark:bg-slate-900 border border-brand-200/70 dark:border-slate-800 p-5 flex items-start gap-3.5 text-start max-w-4xl mx-auto">
            <Info
              className="w-5 h-5 text-accent-600 dark:text-accent-400 shrink-0 mt-0.5"
              aria-hidden="true"
            />
            <p className="text-xs sm:text-sm text-slate-700 dark:text-slate-300 leading-relaxed font-medium">
              {honestNote}
            </p>
          </div>
        </div>
      </section>
    </div>
  );
};

export const BuyPropertyPage = ({
  onCta,
  t,
  isRtl,
}: {
  onCta: () => void;
  t: any;
  isRtl: boolean;
}) => (
  <ServicePage
    badge={isRtl ? 'اكتشاف وشراء العقارات' : 'PROPERTY DISCOVERY'}
    title={t.buy_title}
    description={t.buy_desc}
    ctaText={t.buy_cta}
    onCta={onCta}
    isRtl={isRtl}
    features={[
      {
        title: t.buy_feat_1_title,
        desc: t.buy_feat_1_desc,
        icon: <Building2 size={26} aria-hidden="true" />,
      },
      {
        title: t.buy_feat_2_title,
        desc: t.buy_feat_2_desc,
        icon: <CheckCircle size={26} aria-hidden="true" />,
      },
      {
        title: t.buy_feat_3_title,
        desc: t.buy_feat_3_desc,
        icon: <SlidersHorizontal size={26} aria-hidden="true" />,
      },
    ]}
    stepsTitle={isRtl ? 'خطوات البحث والشراء عبر حتتي' : 'How Smart Property Search Works'}
    steps={[
      {
        num: '01',
        title: isRtl ? 'فلترة دقيقة حسب احتياجك' : 'Filter by Exact Criteria',
        desc: isRtl
          ? 'حدّد المنطقة، الميزانية، المساحة، حالة التشطيب، ووجود جولة ثلاثية الأبعاد.'
          : 'Narrow listings by district, budget, area, finishing level, and available 3D walkthroughs.',
      },
      {
        num: '02',
        title: isRtl ? 'مقارنة جنبًا إلى جنب' : 'Compare Units Side-by-Side',
        desc: isRtl
          ? 'قارن بين عدة وحدات من حيث سعر المتر، خطط السداد المعلنة، وحالة مراجعة المستندات.'
          : 'Review price per square meter, listed payment schedules, and document review badges together.',
      },
      {
        num: '03',
        title: isRtl ? 'تواصل مباشر وطلب معاينة' : 'Connect & Schedule a Visit',
        desc: isRtl
          ? 'تواصل مباشرة مع البائع أو سجّل طلب الشراء لمتابعته من ملفك الشخصي.'
          : 'Reach the lister directly or submit a purchase inquiry tracked right inside your profile.',
      },
    ]}
    honestNote={
      isRtl
        ? 'تُعرض تفاصيل الوحدات والأسعار كما نشرها الملاك أو المطورون. ننصح دائمًا بالمعاينة الميدانية ومراجعة العقود الرسمية قبل التوقيع.'
        : 'Listing details and prices are published directly by sellers and developers. We always recommend an in-person inspection and formal legal review before signing.'
    }
  />
);

export const VerificationPage = ({
  onCta,
  t,
  isRtl,
}: {
  onCta: () => void;
  t: any;
  isRtl: boolean;
}) => (
  <ServicePage
    badge={isRtl ? 'مراجعة المستندات بشفافية' : 'DOCUMENT REVIEW'}
    title={t.verify_title}
    description={t.verify_desc}
    ctaText={t.verify_cta}
    onCta={onCta}
    isRtl={isRtl}
    features={[
      {
        title: t.verify_feat_1_title,
        desc: t.verify_feat_1_desc,
        icon: <FileSearch size={26} aria-hidden="true" />,
      },
      {
        title: t.verify_feat_2_title,
        desc: t.verify_feat_2_desc,
        icon: <ShieldCheck size={26} aria-hidden="true" />,
      },
      {
        title: t.verify_feat_3_title,
        desc: t.verify_feat_3_desc,
        icon: <CheckCircle size={26} aria-hidden="true" />,
      },
    ]}
    stepsTitle={isRtl ? 'كيف تتم مراجعة المستندات في حتتي' : 'How Our Document Review Process Works'}
    steps={[
      {
        num: '01',
        title: isRtl ? 'رفع نسخ المستندات في مساحتك' : 'Upload Copies to Your Vault',
        desc: isRtl
          ? 'ارفع نسخ العقود أو الأوراق في المركز القانوني لمتابعة حالتها خطوة بخطوة.'
          : 'Upload copies of contracts or supporting papers in the Legal Center to track their queue status.',
      },
      {
        num: '02',
        title: isRtl ? 'قراءة وملاحظات مراجع بشري' : 'Human Reviewer Read-Through',
        desc: isRtl
          ? 'يقرأ أحد مراجعي الفريق النسخة المرفوعة ويشير إلى أي تعارض أو نقص ظاهر في البيانات.'
          : 'A HETTETY reviewer reads the uploaded copy and flags visible inconsistencies or missing details.',
      },
      {
        num: '03',
        title: isRtl ? 'التحقق الرسمي في الشهر العقاري' : 'Official Registry Confirmation',
        desc: isRtl
          ? 'استخدم ملاحظات المراجعة كدليل مبدئي، ثم استكمل التحقق الرسمي للتسجيل والمخالفات لدى الجهات الحكومية المختصة.'
          : 'Use our review note as a helpful check, and always confirm official registration and dues with the Real Estate Publicity Department (الشهر العقاري).',
      },
    ]}
    honestNote={
      isRtl
        ? 'مراجعة حتتي تعني أن أحد مراجعينا اطّلع على النسخة التي تم رفعها فقط؛ ولا تُعد بديلاً عن الاستعلام الرسمي في الشهر العقاري أو المحامي المختص.'
        : 'A HETTETY review indicates that a reviewer read the uploaded copy; it is not proof of authenticity or an official title search at the Real Estate Publicity Department (الشهر العقاري).'
    }
  />
);

export const Tours3DPage = ({
  onCta,
  t,
  isRtl,
}: {
  onCta: () => void;
  t: any;
  isRtl: boolean;
}) => (
  <ServicePage
    badge={isRtl ? 'التجربة المكانية 3D' : 'SPATIAL 3D SHOWROOM'}
    title={t.tours_title}
    description={t.tours_desc}
    ctaText={t.tours_cta}
    onCta={onCta}
    isRtl={isRtl}
    features={[
      {
        title: t.tours_feat_1_title,
        desc: t.tours_feat_1_desc,
        icon: <Box size={26} aria-hidden="true" />,
      },
      {
        title: t.tours_feat_2_title,
        desc: t.tours_feat_2_desc,
        icon: <Scan size={26} aria-hidden="true" />,
      },
      {
        title: t.tours_feat_3_title,
        desc: t.tours_feat_3_desc,
        icon: <Clock size={26} aria-hidden="true" />,
      },
    ]}
    stepsTitle={isRtl ? 'كيف تستفيد من الجولات ثلاثية الأبعاد' : 'How to Explore Units in 3D'}
    steps={[
      {
        num: '01',
        title: isRtl ? 'اختر وحدة مزوّدة بوسائط تفاعلية' : 'Pick a 3D or 360° Ready Unit',
        desc: isRtl
          ? 'يوضّح كل إعلان بصدق نوع المعاينة المتاحة: جولة 3DGS أو مسح رقمي أو صور بانوراما 360° أو معرض صور.'
          : 'Every listing clearly labels what is available: a 3D walkthrough, 360° panorama tour, or photo preview.',
      },
      {
        num: '02',
        title: isRtl ? 'تنقّل بين الغرف والزوايا بحرية' : 'Orbit & Inspect Space Flow',
        desc: isRtl
          ? 'حرّك الكاميرا وتصفح الإضاءة وتوزيع الغرف من الهاتف أو الحاسوب دون مغادرة منزلك.'
          : 'Inspect room proportions, natural light, and layout flow smoothly from desktop or mobile.',
      },
      {
        num: '03',
        title: isRtl ? 'اختصر قائمتك قبل الزيارة الميدانية' : 'Shortlist Before Visiting',
        desc: isRtl
          ? 'وفّر وقت التنقل وزُر الوحدات التي تناسب ذوقك ومواصفاتك بالفعل.'
          : 'Narrow down your top favorites remotely so in-person visits stay focused on the strongest matches.',
      },
    ]}
    honestNote={
      isRtl
        ? 'تعتمد دقة وتفاصيل العرض ثلاثي الأبعاد على جودة المسح أو الصور التي يرفعها صاحب الإعلان، ويُعرض نوع المعاينة الفعلي بوضوح على كل وحدة.'
        : 'Spatial preview fidelity depends on the scans or panoramas uploaded by the lister; every property card clearly labels its exact tour format.'
    }
  />
);
