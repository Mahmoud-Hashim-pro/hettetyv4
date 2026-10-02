import React, { useState, useEffect } from 'react';
import { Shield, Check, Settings } from 'lucide-react';
import { api } from '../mockApi';
import { useFocusTrap } from '../hooks/useFocusTrap';

interface CookieConsentProps {
  t: any;
  isRtl: boolean;
  onNavigateToLegal: (page: 'terms' | 'privacy' | 'cookie-policy') => void;
}

const CookieConsent: React.FC<CookieConsentProps> = ({ t, isRtl, onNavigateToLegal }) => {
  const [isVisible, setIsVisible] = useState(false);
  const [view, setView] = useState<'main' | 'preferences'>('main');
  const [agreedToTerms, setAgreedToTerms] = useState(false);
  const [preferences, setPreferences] = useState({
    necessary: true, // Always true
    analytics: false,
    marketing: false
  });

  const modalRef = useFocusTrap<HTMLDivElement>(isVisible, () => {
    if (view === 'preferences') {
      setView('main');
    }
  });

  useEffect(() => {
    const consent = localStorage.getItem('hettety_consent');
    if (!consent) {
      setIsVisible(true);
      document.body.style.overflow = 'hidden'; // Prevent scrolling
    }
    // Always restore scrolling on unmount — otherwise navigating away while the
    // banner is open (e.g. to the Terms page) leaves the whole site frozen.
    return () => { document.body.style.overflow = 'auto'; };
  }, []);

  const handleAcceptAll = async () => {
    if (!agreedToTerms) return;

    const allPrefs = { necessary: true, analytics: true, marketing: true };
    await saveConsent(allPrefs);
  };

  const handleSavePreferences = async () => {
    if (!agreedToTerms) return;
    await saveConsent(preferences);
  };

  const saveConsent = async (prefs: any) => {
    // 1. Save to LocalStorage
    localStorage.setItem('hettety_consent', JSON.stringify(prefs));

    // 2. Save to Cookies (valid for 1 year)
    document.cookie = `hettety_consent=true; max-age=${60 * 60 * 24 * 365}; path=/`;

    // 3. Dismiss UI immediately for instant responsiveness
    setIsVisible(false);
    document.body.style.overflow = 'auto'; // Restore scrolling

    // 4. Save to Backend Database — background persist
    try {
      await api.saveConsent(prefs);
    } catch (err) {
      console.error('Failed to persist consent to backend:', err);
    }
  };

  if (!isVisible) return null;

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-slate-900/80 dark:bg-[#0F172A]/90 backdrop-blur-sm p-4"
      dir={isRtl ? 'rtl' : 'ltr'}
    >
      <div
        ref={modalRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="consent-title"
        className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-white/10 rounded-2xl shadow-2xl w-full max-w-2xl overflow-hidden animate-fade-in text-slate-900 dark:text-white"
      >
        <div className="p-6 sm:p-8">
          <div className="flex items-center gap-4 mb-6">
            <div className="w-12 h-12 rounded-full bg-[#047857]/10 dark:bg-[#10B981]/20 flex items-center justify-center flex-shrink-0">
              <Shield className="w-6 h-6 text-[#047857] dark:text-[#10B981]" aria-hidden="true" />
            </div>
            <h2 id="consent-title" className="text-2xl font-bold text-slate-900 dark:text-white">
              {t.consent_title}
            </h2>
          </div>

          {view === 'main' ? (
            <div className="space-y-6 animate-fade-in">
              <p className="text-slate-600 dark:text-slate-300 leading-relaxed text-sm sm:text-base">
                {t.consent_desc}
              </p>

              <div className="bg-slate-50 dark:bg-white/5 rounded-xl p-4 border border-slate-200 dark:border-white/10">
                <div className="flex items-start gap-3">
                  <div className="relative flex items-center justify-center mt-1 flex-shrink-0">
                    <input
                      id="cookie-consent-terms"
                      type="checkbox"
                      className="peer sr-only"
                      checked={agreedToTerms}
                      onChange={(e) => setAgreedToTerms(e.target.checked)}
                    />
                    <label
                      htmlFor="cookie-consent-terms"
                      className="w-5 h-5 border-2 border-slate-400 dark:border-slate-500 rounded bg-transparent peer-checked:bg-[#047857] dark:peer-checked:bg-[#10B981] peer-checked:border-[#047857] dark:peer-checked:border-[#10B981] transition-all cursor-pointer flex items-center justify-center focus-within:ring-2 focus-within:ring-[#047857] dark:focus-within:ring-[#10B981]"
                    >
                      <Check className="w-3 h-3 text-white opacity-0 peer-checked:opacity-100 transition-opacity" aria-hidden="true" />
                    </label>
                  </div>
                  <div className="text-sm text-slate-700 dark:text-slate-300 leading-normal">
                    {isRtl ? (
                      <>
                        <label htmlFor="cookie-consent-terms" className="cursor-pointer">
                          لقد قرأت وأوافق على
                        </label>
                        <button
                          type="button"
                          onClick={() => onNavigateToLegal('terms')}
                          className="text-[#047857] dark:text-[#10B981] font-semibold hover:underline mx-1 focus:outline-none focus:ring-2 focus:ring-[#047857] dark:focus:ring-[#10B981] rounded px-0.5"
                        >
                          الشروط والأحكام
                        </button>
                        <label htmlFor="cookie-consent-terms" className="cursor-pointer">
                          و
                        </label>
                        <button
                          type="button"
                          onClick={() => onNavigateToLegal('privacy')}
                          className="text-[#047857] dark:text-[#10B981] font-semibold hover:underline mx-1 focus:outline-none focus:ring-2 focus:ring-[#047857] dark:focus:ring-[#10B981] rounded px-0.5"
                        >
                          سياسة الخصوصية
                        </button>
                      </>
                    ) : (
                      <>
                        <label htmlFor="cookie-consent-terms" className="cursor-pointer">
                          I have read and agree to the
                        </label>
                        <button
                          type="button"
                          onClick={() => onNavigateToLegal('terms')}
                          className="text-[#047857] dark:text-[#10B981] font-semibold hover:underline mx-1 focus:outline-none focus:ring-2 focus:ring-[#047857] dark:focus:ring-[#10B981] rounded px-0.5"
                        >
                          Terms & Conditions
                        </button>
                        <label htmlFor="cookie-consent-terms" className="cursor-pointer">
                          and
                        </label>
                        <button
                          type="button"
                          onClick={() => onNavigateToLegal('privacy')}
                          className="text-[#047857] dark:text-[#10B981] font-semibold hover:underline mx-1 focus:outline-none focus:ring-2 focus:ring-[#047857] dark:focus:ring-[#10B981] rounded px-0.5"
                        >
                          Privacy Policy
                        </button>
                      </>
                    )}
                  </div>
                </div>
              </div>

              <div className="flex flex-col sm:flex-row gap-4 pt-4">
                <button
                  type="button"
                  onClick={handleAcceptAll}
                  disabled={!agreedToTerms}
                  className={`min-h-[48px] flex-1 py-3 px-6 rounded-xl font-semibold transition-all flex items-center justify-center text-center cursor-pointer ${
                    agreedToTerms
                      ? 'bg-[#047857] hover:bg-[#065f46] dark:bg-[#10B981] dark:hover:bg-[#059669] text-white shadow-lg shadow-[#047857]/20 dark:shadow-[#10B981]/20'
                      : 'bg-slate-200 dark:bg-slate-800 text-slate-400 dark:text-slate-500 cursor-not-allowed'
                  }`}
                >
                  {t.consent_accept}
                </button>
                <button
                  type="button"
                  onClick={() => setView('preferences')}
                  className="min-h-[48px] flex-1 py-3 px-6 bg-slate-100 hover:bg-slate-200 dark:bg-white/5 dark:hover:bg-white/10 text-slate-800 dark:text-white rounded-xl font-semibold transition-all border border-slate-200 dark:border-white/10 flex items-center justify-center gap-2 cursor-pointer"
                >
                  <Settings className="w-4 h-4 text-slate-600 dark:text-slate-300" aria-hidden="true" />
                  {t.consent_manage}
                </button>
              </div>
            </div>
          ) : (
            <div className="space-y-6 animate-fade-in">
              <div className="space-y-4">
                {/* Necessary Cookies */}
                <div className="flex items-start justify-between p-4 bg-slate-50 dark:bg-white/5 rounded-xl border border-slate-200 dark:border-white/10">
                  <div>
                    <h3 className="text-slate-900 dark:text-white font-semibold mb-1">{t.consent_necessary}</h3>
                    <p className="text-sm text-slate-600 dark:text-slate-400">{t.consent_necessary_desc}</p>
                  </div>
                  <div className="flex items-center gap-2 flex-shrink-0">
                    <input
                      type="checkbox"
                      checked={true}
                      disabled={true}
                      className="sr-only"
                      aria-label={t.consent_necessary}
                    />
                    <span className="text-[#047857] dark:text-[#10B981] text-xs sm:text-sm font-semibold px-3 py-1 bg-[#047857]/10 dark:bg-[#10B981]/10 rounded-full">
                      Always Active
                    </span>
                  </div>
                </div>

                {/* Analytics Cookies */}
                <label className="flex items-start justify-between p-4 bg-slate-50 dark:bg-white/5 rounded-xl border border-slate-200 dark:border-white/10 cursor-pointer hover:bg-slate-100 dark:hover:bg-white/10 transition-colors">
                  <div>
                    <h3 className="text-slate-900 dark:text-white font-semibold mb-1">{t.consent_analytics}</h3>
                    <p className="text-sm text-slate-600 dark:text-slate-400">{t.consent_analytics_desc}</p>
                  </div>
                  <div className="relative flex items-center justify-center mt-1 ms-4 flex-shrink-0">
                    <input
                      type="checkbox"
                      className="peer sr-only"
                      checked={preferences.analytics}
                      onChange={(e) => setPreferences({ ...preferences, analytics: e.target.checked })}
                    />
                    <div className="w-12 h-6 bg-slate-300 dark:bg-slate-600 rounded-full peer-checked:bg-[#047857] dark:peer-checked:bg-[#10B981] transition-colors relative">
                      <div
                        className={`absolute top-1 start-1 bg-white w-4 h-4 rounded-full transition-transform ${
                          preferences.analytics ? (isRtl ? '-translate-x-6' : 'translate-x-6') : ''
                        }`}
                      ></div>
                    </div>
                  </div>
                </label>

                {/* Marketing Cookies */}
                <label className="flex items-start justify-between p-4 bg-slate-50 dark:bg-white/5 rounded-xl border border-slate-200 dark:border-white/10 cursor-pointer hover:bg-slate-100 dark:hover:bg-white/10 transition-colors">
                  <div>
                    <h3 className="text-slate-900 dark:text-white font-semibold mb-1">{t.consent_marketing}</h3>
                    <p className="text-sm text-slate-600 dark:text-slate-400">{t.consent_marketing_desc}</p>
                  </div>
                  <div className="relative flex items-center justify-center mt-1 ms-4 flex-shrink-0">
                    <input
                      type="checkbox"
                      className="peer sr-only"
                      checked={preferences.marketing}
                      onChange={(e) => setPreferences({ ...preferences, marketing: e.target.checked })}
                    />
                    <div className="w-12 h-6 bg-slate-300 dark:bg-slate-600 rounded-full peer-checked:bg-[#047857] dark:peer-checked:bg-[#10B981] transition-colors relative">
                      <div
                        className={`absolute top-1 start-1 bg-white w-4 h-4 rounded-full transition-transform ${
                          preferences.marketing ? (isRtl ? '-translate-x-6' : 'translate-x-6') : ''
                        }`}
                      ></div>
                    </div>
                  </div>
                </label>
              </div>

              <div className="bg-slate-50 dark:bg-white/5 rounded-xl p-4 border border-slate-200 dark:border-white/10">
                <div className="flex items-start gap-3">
                  <div className="relative flex items-center justify-center mt-1 flex-shrink-0">
                    <input
                      id="cookie-consent-terms-pref"
                      type="checkbox"
                      className="peer sr-only"
                      checked={agreedToTerms}
                      onChange={(e) => setAgreedToTerms(e.target.checked)}
                    />
                    <label
                      htmlFor="cookie-consent-terms-pref"
                      className="w-5 h-5 border-2 border-slate-400 dark:border-slate-500 rounded bg-transparent peer-checked:bg-[#047857] dark:peer-checked:bg-[#10B981] peer-checked:border-[#047857] dark:peer-checked:border-[#10B981] transition-all cursor-pointer flex items-center justify-center focus-within:ring-2 focus-within:ring-[#047857] dark:focus-within:ring-[#10B981]"
                    >
                      <Check className="w-3 h-3 text-white opacity-0 peer-checked:opacity-100 transition-opacity" aria-hidden="true" />
                    </label>
                  </div>
                  <div className="text-sm text-slate-700 dark:text-slate-300 leading-normal">
                    {isRtl ? (
                      <>
                        <label htmlFor="cookie-consent-terms-pref" className="cursor-pointer">
                          لقد قرأت وأوافق على
                        </label>
                        <button
                          type="button"
                          onClick={() => onNavigateToLegal('terms')}
                          className="text-[#047857] dark:text-[#10B981] font-semibold hover:underline mx-1 focus:outline-none focus:ring-2 focus:ring-[#047857] dark:focus:ring-[#10B981] rounded px-0.5"
                        >
                          الشروط والأحكام
                        </button>
                        <label htmlFor="cookie-consent-terms-pref" className="cursor-pointer">
                          و
                        </label>
                        <button
                          type="button"
                          onClick={() => onNavigateToLegal('privacy')}
                          className="text-[#047857] dark:text-[#10B981] font-semibold hover:underline mx-1 focus:outline-none focus:ring-2 focus:ring-[#047857] dark:focus:ring-[#10B981] rounded px-0.5"
                        >
                          سياسة الخصوصية
                        </button>
                      </>
                    ) : (
                      <>
                        <label htmlFor="cookie-consent-terms-pref" className="cursor-pointer">
                          I have read and agree to the
                        </label>
                        <button
                          type="button"
                          onClick={() => onNavigateToLegal('terms')}
                          className="text-[#047857] dark:text-[#10B981] font-semibold hover:underline mx-1 focus:outline-none focus:ring-2 focus:ring-[#047857] dark:focus:ring-[#10B981] rounded px-0.5"
                        >
                          Terms & Conditions
                        </button>
                        <label htmlFor="cookie-consent-terms-pref" className="cursor-pointer">
                          and
                        </label>
                        <button
                          type="button"
                          onClick={() => onNavigateToLegal('privacy')}
                          className="text-[#047857] dark:text-[#10B981] font-semibold hover:underline mx-1 focus:outline-none focus:ring-2 focus:ring-[#047857] dark:focus:ring-[#10B981] rounded px-0.5"
                        >
                          Privacy Policy
                        </button>
                      </>
                    )}
                  </div>
                </div>
              </div>

              <div className="flex flex-col sm:flex-row gap-4 pt-4">
                <button
                  type="button"
                  onClick={handleSavePreferences}
                  disabled={!agreedToTerms}
                  className={`min-h-[48px] flex-1 py-3 px-6 rounded-xl font-semibold transition-all flex items-center justify-center text-center cursor-pointer ${
                    agreedToTerms
                      ? 'bg-[#047857] hover:bg-[#065f46] dark:bg-[#10B981] dark:hover:bg-[#059669] text-white shadow-lg shadow-[#047857]/20 dark:shadow-[#10B981]/20'
                      : 'bg-slate-200 dark:bg-slate-800 text-slate-400 dark:text-slate-500 cursor-not-allowed'
                  }`}
                >
                  {t.consent_save}
                </button>
                <button
                  type="button"
                  onClick={() => setView('main')}
                  className="min-h-[48px] py-3 px-6 bg-transparent hover:bg-slate-100 dark:hover:bg-white/5 text-slate-700 dark:text-slate-300 rounded-xl font-semibold transition-all cursor-pointer"
                >
                  {isRtl ? 'رجوع' : 'Back'}
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default CookieConsent;
