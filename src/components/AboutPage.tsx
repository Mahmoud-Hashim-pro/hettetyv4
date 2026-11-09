import React from 'react';
import { 
  BrainCircuit, 
  ShieldCheck, 
  Box, 
  Lock as LockIcon, 
  ArrowLeft,
  ArrowRight
} from 'lucide-react';

const AboutPage = ({ onCta, t, isRtl }: { onCta: () => void, t: any, isRtl: boolean }) => {
  return (
    <div className="min-h-screen bg-white dark:bg-slate-950 text-slate-900 dark:text-white font-sans w-full max-w-full overflow-x-hidden animate-fade-in transition-colors duration-500" dir={isRtl ? "rtl" : "ltr"}>
      
      {/* Hero Section */}
      <section className="relative pt-32 pb-20 px-6 text-center overflow-hidden">
        <div className="absolute top-0 left-1/2 -translate-x-1/2 w-full h-full bg-[radial-gradient(ellipse_at_top,_var(--tw-gradient-stops))] from-brand-500/10 dark:from-brand-500/20 via-transparent to-transparent pointer-events-none"></div>
        
        <div className="max-w-4xl mx-auto relative z-10">
          <span className={`inline-block py-1 px-3 rounded-full bg-brand-500/10 dark:bg-brand-500/20 text-brand-600 dark:text-brand-300 text-sm font-bold mb-6 border border-brand-500/20 dark:border-brand-500/30 ${isRtl ? 'font-cairo' : 'uppercase tracking-widest'}`}>
            {t.about_badge}
          </span>
          <h1 className={`text-3xl sm:text-5xl md:text-6xl lg:text-7xl font-black mb-6 sm:mb-8 leading-tight break-words text-slate-900 dark:text-white ${isRtl ? 'font-cairo' : 'tracking-tighter'}`}>
            {t.about_title_start} <span className="text-accent-500 dark:text-accent-400">{t.about_title_end}</span>
          </h1>
          <p className="text-xl text-slate-600 dark:text-slate-300 leading-relaxed max-w-2xl mx-auto font-medium">
            {t.about_desc}
          </p>
        </div>
      </section>

      {/* Vision & Mission */}
      <section className="py-16 px-6">
        <div className="max-w-6xl mx-auto grid md:grid-cols-2 gap-8">
          {/* Vision */}
          <div className="bg-slate-50 dark:bg-slate-900/50 backdrop-blur-sm p-8 rounded-3xl border border-slate-200 dark:border-slate-800/50 hover:border-brand-500/30 dark:hover:border-brand-500/40 transition-all duration-300 shadow-sm hover:shadow-xl">
            <div className="w-14 h-14 bg-brand-100 dark:bg-brand-900/60 rounded-2xl flex items-center justify-center mb-6 text-brand-600 dark:text-accent-400">
              <BrainCircuit size={32} />
            </div>
            <h2 className={`text-2xl font-black mb-4 text-slate-900 dark:text-white ${isRtl ? 'font-cairo' : 'uppercase tracking-tight'}`}>{t.about_vision_title}</h2>
            <p className="text-slate-600 dark:text-slate-300 leading-relaxed font-medium">
              {t.about_vision_desc}
            </p>
          </div>

          {/* Mission */}
          <div className="bg-slate-50 dark:bg-slate-900/50 backdrop-blur-sm p-8 rounded-3xl border border-slate-200 dark:border-slate-800/50 hover:border-brand-500/30 dark:hover:border-brand-500/40 transition-all duration-300 shadow-sm hover:shadow-xl">
            <div className="w-14 h-14 bg-brand-100 dark:bg-brand-900/60 rounded-2xl flex items-center justify-center mb-6 text-brand-600 dark:text-accent-400">
              <ShieldCheck size={32} />
            </div>
            <h2 className={`text-2xl font-black mb-4 text-slate-900 dark:text-white ${isRtl ? 'font-cairo' : 'uppercase tracking-tight'}`}>{t.about_mission_title}</h2>
            <p className="text-slate-600 dark:text-slate-300 leading-relaxed font-medium">
              {t.about_mission_desc}
            </p>
          </div>
        </div>
      </section>

      {/* Why HETTETY */}
      <section className="py-20 px-6 bg-slate-50 dark:bg-slate-900/30">
        <div className="max-w-7xl mx-auto">
          <div className="text-center mb-16">
            <h2 className={`text-3xl md:text-5xl font-black mb-4 text-slate-900 dark:text-white ${isRtl ? 'font-cairo' : 'uppercase tracking-tighter'}`}>{t.about_why_title}</h2>
            <p className={`text-slate-500 dark:text-slate-400 font-bold text-sm ${isRtl ? 'font-cairo' : 'uppercase tracking-widest'}`}>{t.about_why_subtitle}</p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-8">
            {[
              { icon: <BrainCircuit />, title: t.about_feat_1 },
              { icon: <ShieldCheck />, title: t.about_feat_2 },
              { icon: <Box />, title: t.about_feat_3 },
              { icon: <LockIcon />, title: t.about_feat_4 }
            ].map((item, index) => (
              <div key={index} className="group p-8 rounded-3xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 hover:bg-slate-50 dark:hover:bg-slate-800/80 hover:-translate-y-2 transition-all duration-500 text-center shadow-sm hover:shadow-2xl">
                <div className="w-20 h-20 mx-auto bg-brand-50 dark:bg-slate-800 rounded-2xl flex items-center justify-center mb-6 text-brand-600 dark:text-accent-400 group-hover:scale-110 group-hover:rotate-6 transition-all duration-500">
                  {item.icon}
                </div>
                <h3 className={`font-black text-lg text-slate-900 dark:text-white ${isRtl ? 'font-cairo' : 'uppercase tracking-tight'}`}>{item.title}</h3>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* CTA Section */}
      <section className="py-16 sm:py-24 px-4 sm:px-6 text-center">
        <div className="max-w-4xl mx-auto bg-slate-900 dark:bg-slate-900 p-8 sm:p-12 md:p-20 rounded-3xl sm:rounded-[3rem] border border-slate-800 dark:border-brand-500/30 relative overflow-hidden shadow-2xl">
          <div className="absolute top-0 right-0 w-96 h-96 bg-brand-500/20 dark:bg-brand-500/20 blur-[100px] rounded-full -translate-y-1/2 translate-x-1/2"></div>
          <div className="absolute bottom-0 left-0 w-64 h-64 bg-accent-500/10 dark:bg-accent-500/15 blur-[80px] rounded-full translate-y-1/2 -translate-x-1/2"></div>
          
          <h2 className={`text-3xl sm:text-4xl md:text-6xl font-black mb-8 sm:mb-10 relative z-10 text-white leading-tight ${isRtl ? 'font-cairo' : 'uppercase tracking-tighter'}`}>
            {t.about_cta_title}
          </h2>
          
          <button 
            onClick={onCta}
            className={`relative z-10 bg-accent-500 hover:bg-accent-600 active:bg-accent-700 text-white px-8 sm:px-12 py-4 sm:py-5 rounded-2xl font-black text-base sm:text-xl transition-all duration-300 shadow-2xl shadow-accent-500/20 hover:shadow-accent-500/40 transform hover:scale-105 active:scale-95 flex items-center justify-center gap-3 mx-auto ${isRtl ? 'font-cairo' : 'uppercase tracking-widest'}`}
          >
            {t.about_cta_btn} {isRtl ? <ArrowLeft size={24} /> : <ArrowRight size={24} />}
          </button>
        </div>
      </section>

    </div>
  );
};

export default AboutPage;
