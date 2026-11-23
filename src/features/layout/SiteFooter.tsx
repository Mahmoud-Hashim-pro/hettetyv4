import React from 'react';
import { ArrowUp, Mail, Layers, ArrowLeft, ArrowRight } from 'lucide-react';
import BrandLogo from '../../components/BrandLogo';
import { Page } from '../../types';

export interface SiteFooterProps {
  t: any;
  isRtl: boolean;
  onNavigate: (page: Page) => void;
}

export const SiteFooter: React.FC<SiteFooterProps> = ({ t = {}, isRtl, onNavigate }) => {
  const currentYear = new Date().getFullYear();

  const handleBackToTop = () => {
    if (typeof window !== 'undefined' && typeof window.scrollTo === 'function') {
      window.scrollTo({ top: 0, behavior: 'smooth' });
    }
  };

  return (
    <footer
      dir={isRtl ? 'rtl' : 'ltr'}
      className={`relative bg-[#0a1323] dark:bg-black text-slate-300 border-t border-slate-800/90 transition-colors duration-500 overflow-hidden ${
        isRtl ? 'font-cairo' : ''
      }`}
    >
      {/* Top Architectural Accent Hairline */}
      <div
        className="absolute inset-x-0 top-0 h-[2px] bg-gradient-to-r from-transparent via-accent-500/70 to-transparent"
        aria-hidden="true"
      />
      {/* Subtle Blueprint Grid */}
      <div
        className="absolute inset-0 opacity-20 pointer-events-none bg-[linear-gradient(to_right,rgba(255,255,255,0.04)_1px,transparent_1px),linear-gradient(to_bottom,rgba(255,255,255,0.04)_1px,transparent_1px)] bg-[size:48px_48px]"
        aria-hidden="true"
      />

      <div className="relative z-10 max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 pt-16 pb-10">
        {/* Main 4-Column Architectural Grid */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-12 gap-10 lg:gap-8 pb-12 border-b border-white/10 text-start">
          {/* Column 1: Brand & Platform Architecture */}
          <div className="lg:col-span-4 space-y-5">
            <button
              type="button"
              onClick={() => onNavigate('home')}
              aria-label="HETTETY Home"
              className="inline-flex items-center cursor-pointer focus:outline-none focus:ring-2 focus:ring-accent-400 rounded-xl"
            >
              <BrandLogo
                variant="horizontal"
                color="white"
                isDark={true}
                isRtl={isRtl}
                className="h-10 w-auto"
              />
            </button>

            <p className="text-sm text-slate-300 leading-relaxed max-w-sm">
              {t.footer_desc}
            </p>
            <p className="text-xs text-slate-400 leading-relaxed max-w-sm">
              {isRtl
                ? 'منصة عقارية تجمع بين الاستشارات الذكية، الجولات المكانية ثلاثية الأبعاد، ومراجعة المستندات بشفافية كاملة في السوق المصري.'
                : 'A modern Egyptian real estate platform uniting bilingual AI consultation, 3D spatial previews, and transparent document review tracking.'}
            </p>

            <div className="inline-flex items-center gap-2 px-3.5 py-2 rounded-xl bg-white/5 border border-white/10 text-[11px] font-bold text-slate-300">
              <Layers className="w-3.5 h-3.5 text-accent-400 shrink-0" aria-hidden="true" />
              <span>
                {isRtl
                  ? 'بنية سحابية Neon وجولات مكانية 3DGS'
                  : 'Neon Cloud & 3DGS Spatial Architecture'}
              </span>
            </div>
          </div>

          {/* Column 2: Services & Platform Discovery */}
          <div className="lg:col-span-3">
            <h3
              className={`text-white font-black text-sm mb-5 ${
                isRtl ? 'font-cairo' : 'uppercase tracking-[0.18em]'
              }`}
            >
              {t.footer_services}
            </h3>
            <ul className="space-y-3 text-sm">
              <li>
                <button
                  type="button"
                  onClick={() => onNavigate('buy')}
                  className="text-slate-300 hover:text-accent-400 transition-colors cursor-pointer focus:outline-none focus:ring-2 focus:ring-accent-400 rounded"
                >
                  {t.footer_buy}
                </button>
              </li>
              <li>
                <button
                  type="button"
                  onClick={() => onNavigate('verification')}
                  className="text-slate-300 hover:text-accent-400 transition-colors cursor-pointer focus:outline-none focus:ring-2 focus:ring-accent-400 rounded"
                >
                  {t.footer_verify}
                </button>
              </li>
              <li>
                <button
                  type="button"
                  onClick={() => onNavigate('tours')}
                  className="text-slate-300 hover:text-accent-400 transition-colors cursor-pointer focus:outline-none focus:ring-2 focus:ring-accent-400 rounded"
                >
                  {t.footer_3d}
                </button>
              </li>
              <li>
                <button
                  type="button"
                  onClick={() => onNavigate('yalla-sahel')}
                  className="text-slate-300 hover:text-cyan-300 transition-colors cursor-pointer focus:outline-none focus:ring-2 focus:ring-cyan-400 rounded"
                >
                  {isRtl ? '🌊 ساحل حتتي' : '🌊 Sahel Hettety'}
                </button>
              </li>
              <li>
                <button
                  type="button"
                  onClick={() => onNavigate('3d-experience')}
                  className="text-slate-300 hover:text-accent-400 transition-colors cursor-pointer focus:outline-none focus:ring-2 focus:ring-accent-400 rounded"
                >
                  {isRtl ? 'تجربة 3D التفاعلية' : '3D Experience'}
                </button>
              </li>
            </ul>
          </div>

          {/* Column 3: Company & Governance */}
          <div className="lg:col-span-2">
            <h3
              className={`text-white font-black text-sm mb-5 ${
                isRtl ? 'font-cairo' : 'uppercase tracking-[0.18em]'
              }`}
            >
              {t.footer_company}
            </h3>
            <ul className="space-y-3 text-sm">
              <li>
                <button
                  type="button"
                  onClick={() => onNavigate('about')}
                  className="text-slate-300 hover:text-accent-400 transition-colors cursor-pointer focus:outline-none focus:ring-2 focus:ring-accent-400 rounded"
                >
                  {t.footer_about}
                </button>
              </li>
              <li>
                <button
                  type="button"
                  onClick={() => onNavigate('contact')}
                  className="text-slate-300 hover:text-accent-400 transition-colors cursor-pointer focus:outline-none focus:ring-2 focus:ring-accent-400 rounded"
                >
                  {isRtl ? 'تواصل معنا' : 'Contact Us'}
                </button>
              </li>
              <li>
                <button
                  type="button"
                  onClick={() => onNavigate('terms')}
                  className="text-slate-300 hover:text-accent-400 transition-colors cursor-pointer focus:outline-none focus:ring-2 focus:ring-accent-400 rounded"
                >
                  {t.footer_terms}
                </button>
              </li>
              <li>
                <button
                  type="button"
                  onClick={() => onNavigate('privacy')}
                  className="text-slate-300 hover:text-accent-400 transition-colors cursor-pointer focus:outline-none focus:ring-2 focus:ring-accent-400 rounded"
                >
                  {t.nav_privacy}
                </button>
              </li>
              <li>
                <button
                  type="button"
                  onClick={() => onNavigate('cookie-policy')}
                  className="text-slate-300 hover:text-accent-400 transition-colors cursor-pointer focus:outline-none focus:ring-2 focus:ring-accent-400 rounded"
                >
                  {t.nav_cookie}
                </button>
              </li>
            </ul>
          </div>

          {/* Column 4: Connect & Direct Support */}
          <div className="lg:col-span-3 space-y-5">
            <h3
              className={`text-white font-black text-sm ${
                isRtl ? 'font-cairo' : 'uppercase tracking-[0.18em]'
              }`}
            >
              {t.footer_connect}
            </h3>

            <div className="flex flex-wrap gap-3">
              <a
                href="https://www.tiktok.com/@hettety5?_r=1&_t=ZS-95rJ2NUzN2b"
                target="_blank"
                rel="noreferrer"
                aria-label="HETTETY on TikTok (opens in new window)"
                className="w-12 h-12 min-w-[48px] min-h-[48px] bg-white/5 border border-white/10 rounded-2xl hover:bg-accent-500 hover:border-accent-500 cursor-pointer flex items-center justify-center text-white transition-all duration-200 hover:-translate-y-0.5 focus:outline-none focus:ring-2 focus:ring-accent-400"
              >
                <svg
                  aria-hidden="true"
                  viewBox="0 0 24 24"
                  width="20"
                  height="20"
                  stroke="currentColor"
                  strokeWidth="2"
                  fill="none"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <path d="M9 12a4 4 0 1 0 4 4V4a5 5 0 0 0 5 5" />
                </svg>
              </a>

              <a
                href="https://www.instagram.com/hettety_realstate?igsh=Z3Y4NXB4ZHN3cXFu"
                target="_blank"
                rel="noreferrer"
                aria-label="HETTETY on Instagram (opens in new window)"
                className="w-12 h-12 min-w-[48px] min-h-[48px] bg-white/5 border border-white/10 rounded-2xl hover:bg-accent-500 hover:border-accent-500 cursor-pointer flex items-center justify-center text-white transition-all duration-200 hover:-translate-y-0.5 focus:outline-none focus:ring-2 focus:ring-accent-400"
              >
                <svg
                  aria-hidden="true"
                  viewBox="0 0 24 24"
                  width="20"
                  height="20"
                  stroke="currentColor"
                  strokeWidth="2"
                  fill="none"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <rect x="2" y="2" width="20" height="20" rx="5" ry="5" />
                  <path d="M16 11.37A4 4 0 1 1 12.63 8 4 4 0 0 1 16 11.37z" />
                  <line x1="17.5" y1="6.5" x2="17.51" y2="6.5" />
                </svg>
              </a>

              <a
                href="https://linkedin.com"
                target="_blank"
                rel="noreferrer"
                aria-label="HETTETY on LinkedIn (opens in new window)"
                className="w-12 h-12 min-w-[48px] min-h-[48px] bg-white/5 border border-white/10 rounded-2xl hover:bg-accent-500 hover:border-accent-500 cursor-pointer flex items-center justify-center text-white transition-all duration-200 hover:-translate-y-0.5 focus:outline-none focus:ring-2 focus:ring-accent-400"
              >
                <svg
                  aria-hidden="true"
                  viewBox="0 0 24 24"
                  width="20"
                  height="20"
                  stroke="currentColor"
                  strokeWidth="2"
                  fill="none"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <path d="M16 8a6 6 0 0 1 6 6v7h-4v-7a2 2 0 0 0-2-2 2 2 0 0 0-2 2v7h-4v-7a6 6 0 0 1 6-6z" />
                  <rect x="2" y="9" width="4" height="12" />
                  <circle cx="4" cy="4" r="2" />
                </svg>
              </a>
            </div>

            <div className="p-4 rounded-2xl bg-white/[0.04] border border-white/10">
              <p className="text-xs text-slate-300 font-semibold mb-3 leading-relaxed">
                {isRtl
                  ? 'هل لديك استفسار عن وحدة أو شراكة مطورين؟'
                  : 'Have a question about a unit or developer partnership?'}
              </p>
              <button
                type="button"
                onClick={() => onNavigate('contact')}
                className="inline-flex items-center gap-2 text-xs font-black text-accent-400 hover:text-accent-300 transition-colors cursor-pointer focus:outline-none focus:ring-2 focus:ring-accent-400 rounded"
              >
                <Mail className="w-3.5 h-3.5" aria-hidden="true" />
                <span>{isRtl ? 'أرسل رسالة لفريقنا' : 'Message our team'}</span>
                {isRtl ? (
                  <ArrowLeft className="w-3.5 h-3.5" aria-hidden="true" />
                ) : (
                  <ArrowRight className="w-3.5 h-3.5" aria-hidden="true" />
                )}
              </button>
            </div>
          </div>
        </div>

        {/* Bottom Copyright & Back-to-Top Bar */}
        <div className="pt-7 flex flex-col sm:flex-row items-center justify-between gap-4 text-xs text-slate-400">
          <div className="flex flex-wrap items-center justify-center sm:justify-start gap-x-4 gap-y-1.5 text-center sm:text-start">
            <span className="font-bold text-slate-300">
              © {currentYear} HETTETY.{' '}
              {isRtl ? 'جميع الحقوق محفوظة.' : 'All rights reserved.'}
            </span>
            <span className="hidden sm:inline text-slate-600" aria-hidden="true">
              •
            </span>
            <span className="text-slate-400">
              {isRtl
                ? 'مدعوم ببنية Neon Cloud ومسح 3DGS المكاني'
                : 'Powered by Neon Cloud & 3DGS Spatial Architecture'}
            </span>
          </div>

          <button
            type="button"
            onClick={handleBackToTop}
            aria-label={isRtl ? 'العودة إلى أعلى الصفحة' : 'Back to top'}
            className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-white/5 hover:bg-white/10 border border-white/10 text-slate-200 hover:text-white font-bold transition-all cursor-pointer active:scale-95 focus:outline-none focus:ring-2 focus:ring-accent-400"
          >
            <span>{isRtl ? 'الأعلى' : 'Back to top'}</span>
            <ArrowUp className="w-4 h-4 text-accent-400" aria-hidden="true" />
          </button>
        </div>
      </div>
    </footer>
  );
};

export default SiteFooter;
