import React from 'react';
import {
  BrainCircuit,
  ShieldCheck,
  Box,
  Lock as LockIcon,
  ArrowLeft,
  ArrowRight,
  Compass,
  Sparkles,
  FileSearch,
} from 'lucide-react';
import { BrandMonogram } from './BrandLogo';

export interface AboutPageProps {
  onCta: () => void;
  t: any;
  isRtl: boolean;
}

const AboutPage: React.FC<AboutPageProps> = ({ onCta, t = {}, isRtl }) => {
  const workflowSteps = [
    {
      step: '01',
      icon: <Compass className="w-6 h-6" aria-hidden="true" />,
      title: isRtl ? 'استكشف وعاين بتقنية 3D' : 'Discover & Preview in 3D',
      desc: isRtl
        ? 'ابحث بين الإعلانات المتاحة حسب المنطقة والميزانية والتشطيب، وعاين الوحدات المزودة بجولات 3D أو صور 360° قبل الزيارة الميدانية.'
        : 'Filter real listings by corridor, budget, and finishing, then explore 3D walkthroughs and 360° previews before scheduling site visits.',
    },
    {
      step: '02',
      icon: <Sparkles className="w-6 h-6" aria-hidden="true" />,
      title: isRtl ? 'قارن بدعم المستشار الذكي' : 'Compare with Bilingual AI Guidance',
      desc: isRtl
        ? 'استخدم المستشار العقاري لمقارنة المشروعات والأسعار الاسترشادية وأنظمة السداد بالعربية أو الإنجليزية لاتخاذ قرار مدروس.'
        : 'Use our bilingual AI Advisor to compare compounds, square-meter benchmarks, and indicative payment plans before committing.',
    },
    {
      step: '03',
      icon: <FileSearch className="w-6 h-6" aria-hidden="true" />,
      title: isRtl ? 'تابع مراجعة المستندات بوضوح' : 'Track Document Review Transparently',
      desc: isRtl
        ? 'اطلع على حالة مراجعة المستندات المرفوعة لكل إعلان، مع التذكير بأن التحقق الرسمي من التسجيل يتم لدى الشهر العقاري.'
        : 'See clear review status badges on uploaded documents, while completing official title registration checks at the Real Estate Publicity Department.',
    },
  ];

  return (
    <div
      className={`min-h-screen bg-white dark:bg-slate-950 text-[#1b2c4d] dark:text-white font-sans w-full max-w-full overflow-x-hidden animate-fade-in transition-colors duration-500 ${
        isRtl ? 'font-cairo' : ''
      }`}
      dir={isRtl ? 'rtl' : 'ltr'}
    >
      {/* Architectural Hero Section */}
      <section className="relative pt-24 sm:pt-32 pb-20 px-4 sm:px-6 text-center overflow-hidden border-b border-slate-200/70 dark:border-slate-800/70">
        {/* Blueprint Grid + Radial Glows */}
        <div
          className="absolute inset-0 pointer-events-none opacity-60 dark:opacity-35 bg-[linear-gradient(to_right,rgba(27,44,77,0.045)_1px,transparent_1px),linear-gradient(to_bottom,rgba(27,44,77,0.045)_1px,transparent_1px)] dark:bg-[linear-gradient(to_right,rgba(255,255,255,0.035)_1px,transparent_1px),linear-gradient(to_bottom,rgba(255,255,255,0.035)_1px,transparent_1px)] bg-[size:48px_48px]"
          aria-hidden="true"
        />
        <div
          className="absolute top-0 start-1/2 -translate-x-1/2 w-[50rem] h-[22rem] bg-brand-600/10 dark:bg-brand-500/20 blur-[120px] rounded-full pointer-events-none"
          aria-hidden="true"
        />
        <div
          className="absolute bottom-0 end-10 w-72 h-72 bg-accent-500/10 dark:bg-accent-500/15 blur-[100px] rounded-full pointer-events-none"
          aria-hidden="true"
        />

        <div className="max-w-4xl mx-auto relative z-10">
          <div className="inline-flex items-center gap-2.5 py-1.5 px-4 rounded-full bg-brand-50 dark:bg-slate-900 border border-brand-200/80 dark:border-slate-800 text-brand-700 dark:text-accent-300 text-xs sm:text-sm font-black mb-7 shadow-xs">
            <BrandMonogram className="h-4 w-auto text-[#1b2c4d] dark:text-white" />
            <span className={isRtl ? 'font-cairo' : 'uppercase tracking-[0.2em]'}>
              {t.about_badge}
            </span>
          </div>

          <h1
            className={`text-4xl sm:text-5xl md:text-6xl lg:text-7xl font-black mb-6 sm:mb-8 leading-[1.08] break-words text-[#1b2c4d] dark:text-white ${
              isRtl ? 'font-cairo leading-[1.18]' : 'font-heading tracking-tighter'
            }`}
          >
            {t.about_title_start}{' '}
            <span className="text-transparent bg-clip-text bg-gradient-to-r from-[#e67e22] to-accent-400">
              {t.about_title_end}
            </span>
          </h1>

          <p className="text-lg sm:text-xl text-slate-600 dark:text-slate-300 leading-relaxed max-w-2xl mx-auto font-medium">
            {t.about_desc}
          </p>
        </div>
      </section>

      {/* Editorial Vision & Mission Duo */}
      <section className="py-16 sm:py-20 px-4 sm:px-6">
        <div className="max-w-6xl mx-auto grid md:grid-cols-2 gap-7">
          {/* Vision */}
          <article className="group relative bg-slate-50/90 dark:bg-slate-900/70 backdrop-blur-sm p-8 sm:p-10 rounded-3xl border border-slate-200/80 dark:border-slate-800 hover:border-brand-300 dark:hover:border-brand-700 transition-all duration-300 shadow-sm hover:shadow-2xl hover:shadow-brand-900/10 overflow-hidden text-start">
            <div
              className="absolute inset-x-0 top-0 h-1 bg-gradient-to-r from-[#1b2c4d] to-accent-500 opacity-70 group-hover:opacity-100 transition-opacity"
              aria-hidden="true"
            />
            <div className="flex items-center justify-between mb-6">
              <div className="w-14 h-14 bg-white dark:bg-brand-900/60 border border-slate-200/80 dark:border-brand-800/80 rounded-2xl flex items-center justify-center text-[#1b2c4d] dark:text-accent-400 shadow-xs">
                <BrainCircuit size={30} aria-hidden="true" />
              </div>
              <span className="font-mono text-xs font-black text-slate-400 dark:text-slate-500">
                01 / {isRtl ? 'الرؤية' : 'VISION'}
              </span>
            </div>
            <h2
              className={`text-2xl sm:text-3xl font-black mb-4 text-[#1b2c4d] dark:text-white ${
                isRtl ? 'font-cairo' : 'font-heading tracking-tight'
              }`}
            >
              {t.about_vision_title}
            </h2>
            <p className="text-slate-600 dark:text-slate-300 leading-relaxed font-medium text-base">
              {t.about_vision_desc}
            </p>
          </article>

          {/* Mission */}
          <article className="group relative bg-slate-50/90 dark:bg-slate-900/70 backdrop-blur-sm p-8 sm:p-10 rounded-3xl border border-slate-200/80 dark:border-slate-800 hover:border-accent-400/60 dark:hover:border-accent-500/50 transition-all duration-300 shadow-sm hover:shadow-2xl hover:shadow-brand-900/10 overflow-hidden text-start">
            <div
              className="absolute inset-x-0 top-0 h-1 bg-gradient-to-r from-accent-500 to-[#1b2c4d] opacity-70 group-hover:opacity-100 transition-opacity"
              aria-hidden="true"
            />
            <div className="flex items-center justify-between mb-6">
              <div className="w-14 h-14 bg-white dark:bg-brand-900/60 border border-slate-200/80 dark:border-brand-800/80 rounded-2xl flex items-center justify-center text-accent-600 dark:text-accent-400 shadow-xs">
                <ShieldCheck size={30} aria-hidden="true" />
              </div>
              <span className="font-mono text-xs font-black text-slate-400 dark:text-slate-500">
                02 / {isRtl ? 'المهمة' : 'MISSION'}
              </span>
            </div>
            <h2
              className={`text-2xl sm:text-3xl font-black mb-4 text-[#1b2c4d] dark:text-white ${
                isRtl ? 'font-cairo' : 'font-heading tracking-tight'
              }`}
            >
              {t.about_mission_title}
            </h2>
            <p className="text-slate-600 dark:text-slate-300 leading-relaxed font-medium text-base">
              {t.about_mission_desc}
            </p>
          </article>
        </div>
      </section>

      {/* How HETTETY Works — 3-Step Transparent Workflow Strip */}
      <section
        aria-labelledby="how-hettety-works-heading"
        className="py-16 sm:py-20 px-4 sm:px-6 bg-slate-50 dark:bg-slate-900/40 border-y border-slate-200/70 dark:border-slate-800/70"
      >
        <div className="max-w-6xl mx-auto">
          <div className="text-center mb-14 max-w-2xl mx-auto">
            <span
              className={`inline-flex items-center gap-2 text-xs font-black text-accent-600 dark:text-accent-400 mb-3 ${
                isRtl ? '' : 'uppercase tracking-[0.2em]'
              }`}
            >
              {isRtl ? 'رحلة شفافة خطوة بخطوة' : 'TRANSPARENT WORKFLOW'}
            </span>
            <h2
              id="how-hettety-works-heading"
              className={`text-3xl sm:text-4xl font-black text-[#1b2c4d] dark:text-white mb-3 ${
                isRtl ? 'font-cairo' : 'font-heading tracking-tight'
              }`}
            >
              {isRtl ? 'كيف تعمل منصة HETTETY؟' : 'How HETTETY Works'}
            </h2>
            <p className="text-slate-600 dark:text-slate-400 text-sm sm:text-base leading-relaxed">
              {isRtl
                ? 'ثلاث خطوات عملية واضحة من اكتشاف الوحدة حتى متابعة مراجعة مستنداتها.'
                : 'Three clear, practical steps from discovering a property to reviewing uploaded paperwork.'}
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            {workflowSteps.map((s) => (
              <article
                key={s.step}
                className="relative p-7 rounded-3xl bg-white dark:bg-slate-900 border border-slate-200/80 dark:border-slate-800 shadow-sm hover:shadow-xl transition-all duration-300 hover:-translate-y-1 text-start"
              >
                <div className="flex items-center justify-between mb-6">
                  <div className="w-12 h-12 rounded-2xl bg-brand-50 dark:bg-brand-900/50 text-[#1b2c4d] dark:text-accent-400 flex items-center justify-center">
                    {s.icon}
                  </div>
                  <span className="font-mono text-2xl font-black text-slate-200 dark:text-slate-800 select-none">
                    {s.step}
                  </span>
                </div>
                <h3
                  className={`text-lg font-black text-[#1b2c4d] dark:text-white mb-2.5 ${
                    isRtl ? 'font-cairo' : 'font-heading'
                  }`}
                >
                  {s.title}
                </h3>
                <p className="text-sm text-slate-600 dark:text-slate-400 leading-relaxed">
                  {s.desc}
                </p>
              </article>
            ))}
          </div>
        </div>
      </section>

      {/* Why HETTETY Pillars */}
      <section className="py-20 px-4 sm:px-6 bg-white dark:bg-slate-950">
        <div className="max-w-7xl mx-auto">
          <div className="text-center mb-14">
            <h2
              className={`text-3xl md:text-5xl font-black mb-4 text-[#1b2c4d] dark:text-white ${
                isRtl ? 'font-cairo' : 'font-heading tracking-tight'
              }`}
            >
              {t.about_why_title}
            </h2>
            <p
              className={`text-slate-500 dark:text-slate-400 font-bold text-sm ${
                isRtl ? 'font-cairo' : 'uppercase tracking-[0.2em]'
              }`}
            >
              {t.about_why_subtitle}
            </p>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
            {[
              { num: '01', icon: <BrainCircuit aria-hidden="true" />, title: t.about_feat_1 },
              { num: '02', icon: <ShieldCheck aria-hidden="true" />, title: t.about_feat_2 },
              { num: '03', icon: <Box aria-hidden="true" />, title: t.about_feat_3 },
              { num: '04', icon: <LockIcon aria-hidden="true" />, title: t.about_feat_4 },
            ].map((item) => (
              <article
                key={item.num}
                className="group relative p-8 rounded-3xl bg-slate-50/80 dark:bg-slate-900 border border-slate-200/80 dark:border-slate-800 hover:bg-white dark:hover:bg-slate-800/80 hover:border-brand-300 dark:hover:border-brand-700 hover:-translate-y-1.5 transition-all duration-300 text-center shadow-sm hover:shadow-2xl"
              >
                <span className="absolute top-4 end-5 font-mono text-xs font-black text-slate-300 dark:text-slate-700">
                  {item.num}
                </span>
                <div className="w-16 h-16 mx-auto bg-white dark:bg-slate-800 border border-slate-200/80 dark:border-slate-700 rounded-2xl flex items-center justify-center mb-6 text-[#1b2c4d] dark:text-accent-400 shadow-xs group-hover:bg-[#1b2c4d] group-hover:text-white dark:group-hover:bg-accent-500 dark:group-hover:text-white group-hover:scale-105 transition-all duration-300">
                  {item.icon}
                </div>
                <h3
                  className={`font-black text-lg text-[#1b2c4d] dark:text-white ${
                    isRtl ? 'font-cairo' : 'font-heading tracking-tight'
                  }`}
                >
                  {item.title}
                </h3>
              </article>
            ))}
          </div>
        </div>
      </section>

      {/* Architectural Dark-Navy Closing CTA */}
      <section className="py-16 sm:py-24 px-4 sm:px-6 text-center">
        <div className="max-w-5xl mx-auto bg-[#1b2c4d] dark:bg-slate-900 p-8 sm:p-14 md:p-20 rounded-[2rem] sm:rounded-[3rem] border border-brand-700/60 dark:border-brand-500/30 relative overflow-hidden shadow-2xl">
          <div
            className="absolute inset-0 opacity-20 pointer-events-none bg-[linear-gradient(to_right,rgba(255,255,255,0.06)_1px,transparent_1px),linear-gradient(to_bottom,rgba(255,255,255,0.06)_1px,transparent_1px)] bg-[size:44px_44px]"
            aria-hidden="true"
          />
          <div
            className="absolute top-0 end-0 w-96 h-96 bg-brand-400/20 blur-[110px] rounded-full -translate-y-1/2 translate-x-1/2 pointer-events-none"
            aria-hidden="true"
          />
          <div
            className="absolute bottom-0 start-0 w-72 h-72 bg-accent-500/20 blur-[90px] rounded-full translate-y-1/2 -translate-x-1/2 pointer-events-none"
            aria-hidden="true"
          />

          <h2
            className={`text-3xl sm:text-4xl md:text-5xl font-black mb-8 sm:mb-10 relative z-10 text-white leading-tight max-w-3xl mx-auto ${
              isRtl ? 'font-cairo leading-[1.2]' : 'font-heading tracking-tight'
            }`}
          >
            {t.about_cta_title}
          </h2>

          <button
            type="button"
            onClick={onCta}
            className={`relative z-10 bg-accent-500 hover:bg-accent-600 active:bg-accent-700 text-white px-8 sm:px-12 py-4 sm:py-5 rounded-2xl font-black text-base sm:text-lg transition-all duration-300 shadow-2xl shadow-accent-500/30 hover:shadow-accent-500/50 transform hover:-translate-y-0.5 active:scale-95 inline-flex items-center justify-center gap-3 cursor-pointer focus:outline-none focus:ring-2 focus:ring-accent-300 focus:ring-offset-2 focus:ring-offset-[#1b2c4d] ${
              isRtl ? 'font-cairo' : 'uppercase tracking-widest'
            }`}
          >
            <span>{t.about_cta_btn}</span>
            {isRtl ? (
              <ArrowLeft size={22} aria-hidden="true" />
            ) : (
              <ArrowRight size={22} aria-hidden="true" />
            )}
          </button>
        </div>
      </section>
    </div>
  );
};

export default AboutPage;
