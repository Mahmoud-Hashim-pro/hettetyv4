import React, { useState } from 'react';
import {
  AlertCircle,
  ArrowLeft,
  ArrowRight,
  Box,
  Building2,
  CheckCircle2,
  Clock,
  Home,
  LifeBuoy,
  Loader2,
  Mail,
  MapPin,
  MessageSquare,
  Send,
  Sparkles,
  User,
} from 'lucide-react';
import { addDoc, auth, collection, db } from '../../firebase';
import { BrandLogo } from '../../components/BrandLogo';
import { BrandButton } from '../../shared/ui/BrandButton';

export interface ContactPageProps {
  t: any;
  isRtl: boolean;
  onOpenAdvisor?: () => void;
}

type ContactTopic = 'buying' | 'listing' | 'scan3d' | 'support';

export const ContactPage: React.FC<ContactPageProps> = ({
  t,
  isRtl,
  onOpenAdvisor,
}) => {
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [topic, setTopic] = useState<ContactTopic>('buying');
  const [message, setMessage] = useState('');
  const [status, setStatus] = useState<'idle' | 'sending' | 'sent' | 'error'>(
    'idle'
  );
  const [error, setError] = useState('');

  const topics: Array<{
    key: ContactTopic;
    label: string;
    icon: React.ReactNode;
  }> = [
    {
      key: 'buying',
      label: isRtl ? 'استفسار شراء' : 'Buying Inquiry',
      icon: <Home size={14} aria-hidden="true" />,
    },
    {
      key: 'listing',
      label: isRtl ? 'إضافة عقار' : 'List a Property',
      icon: <Building2 size={14} aria-hidden="true" />,
    },
    {
      key: 'scan3d',
      label: isRtl ? 'طلب مسح 3D' : '3D Scan Request',
      icon: <Box size={14} aria-hidden="true" />,
    },
    {
      key: 'support',
      label: isRtl ? 'دعم فني' : 'Technical Support',
      icon: <LifeBuoy size={14} aria-hidden="true" />,
    },
  ];

  const clearStatusIfNeeded = () => {
    if (status !== 'idle') {
      setStatus('idle');
      setError('');
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (status === 'sending') return;

    const trimmedEmail = email.trim();
    const trimmedMessage = message.trim();
    const trimmedName = name.trim();

    if (!/.+@.+\..+/.test(trimmedEmail)) {
      setStatus('error');
      setError(
        isRtl
          ? 'من فضلك اكتب بريد إلكتروني صحيح.'
          : 'Please enter a valid email address.'
      );
      return;
    }

    if (!trimmedMessage) {
      setStatus('error');
      setError(
        isRtl ? 'من فضلك اكتب رسالتك.' : 'Please write your message.'
      );
      return;
    }

    setStatus('sending');
    setError('');

    try {
      await addDoc(collection(db, 'contact_messages'), {
        name: trimmedName.slice(0, 120),
        email: trimmedEmail.slice(0, 199),
        topic,
        message: trimmedMessage.slice(0, 4999),
        userId: auth.currentUser?.uid || '',
        createdAt: new Date().toISOString(),
      });

      setStatus('sent');
      setName('');
      setEmail('');
      setMessage('');
    } catch (err) {
      console.error('Contact message failed:', err);
      setStatus('error');
      setError(
        isRtl
          ? 'تعذّر إرسال رسالتك حالياً. يرجى المحاولة مرة أخرى.'
          : 'Could not send your message right now. Please try again.'
      );
    }
  };

  return (
    <section
      dir={isRtl ? 'rtl' : 'ltr'}
      aria-labelledby="contact-page-heading"
      className="min-h-[80vh] bg-slate-50 dark:bg-slate-950 px-4 sm:px-6 py-12 sm:py-16 animate-fade-in transition-colors duration-500"
    >
      <div className="max-w-5xl mx-auto">
        <div className="bg-white dark:bg-slate-900 rounded-3xl shadow-2xl border border-slate-200/80 dark:border-slate-800 overflow-hidden grid grid-cols-1 lg:grid-cols-12">
          {/* Architectural Navy Sidebar */}
          <aside className="lg:col-span-5 relative overflow-hidden bg-gradient-to-br from-brand-950 via-brand-700 to-brand-600 text-white p-8 sm:p-10 flex flex-col justify-between text-start">
            <div
              className="pointer-events-none absolute inset-0 opacity-15"
              style={{
                backgroundImage:
                  'linear-gradient(rgba(255,255,255,0.14) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.14) 1px, transparent 1px)',
                backgroundSize: '34px 34px',
              }}
            />
            <div className="pointer-events-none absolute -bottom-20 -end-16 w-64 h-64 rounded-full bg-accent-500/25 blur-3xl" />

            <div className="relative z-10 space-y-7">
              <div>
                <span className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-white/10 border border-white/15 text-accent-300 text-[11px] font-extrabold uppercase tracking-widest mb-4">
                  <MessageSquare size={12} aria-hidden="true" />
                  <span>{isRtl ? 'تواصل مباشر' : 'Direct Support'}</span>
                </span>
                <h1
                  id="contact-page-heading"
                  className="text-3xl sm:text-4xl font-heading font-black mb-3 leading-tight"
                >
                  {t.contact_title}
                </h1>
                <p className="text-sm sm:text-base text-brand-200/90 leading-relaxed">
                  {t.contact_desc}
                </p>
              </div>

              {/* Cairo Office Hours & Coverage Info */}
              <div className="space-y-4">
                <div className="flex items-start gap-3.5">
                  <div className="w-10 h-10 rounded-xl bg-white/10 border border-white/15 flex items-center justify-center text-accent-300 shrink-0">
                    <Clock size={18} aria-hidden="true" />
                  </div>
                  <div>
                    <h2 className="text-xs font-extrabold uppercase tracking-wider text-brand-200 mb-0.5">
                      {isRtl ? 'ساعات العمل بتوقيت القاهرة' : 'Cairo Support Hours'}
                    </h2>
                    <p className="text-sm font-semibold text-white">
                      {isRtl
                        ? 'الأحد – الخميس، 9:00 صباحاً – 8:00 مساءً'
                        : 'Sun – Thu, 9:00 AM – 8:00 PM EET'}
                    </p>
                  </div>
                </div>

                <div className="flex items-start gap-3.5">
                  <div className="w-10 h-10 rounded-xl bg-white/10 border border-white/15 flex items-center justify-center text-accent-300 shrink-0">
                    <MapPin size={18} aria-hidden="true" />
                  </div>
                  <div>
                    <h2 className="text-xs font-extrabold uppercase tracking-wider text-brand-200 mb-0.5">
                      {isRtl ? 'نطاق التغطية' : 'Coverage Regions'}
                    </h2>
                    <p className="text-sm font-semibold text-white">
                      {isRtl
                        ? 'القاهرة الجديدة · الشيخ زايد · العاصمة · الساحل الشمالي'
                        : 'New Cairo · Sheikh Zayed · New Capital · North Coast'}
                    </p>
                  </div>
                </div>

                <div className="flex items-start gap-3.5">
                  <div className="w-10 h-10 rounded-xl bg-white/10 border border-white/15 flex items-center justify-center text-accent-300 shrink-0">
                    <Mail size={18} aria-hidden="true" />
                  </div>
                  <div>
                    <h2 className="text-xs font-extrabold uppercase tracking-wider text-brand-200 mb-0.5">
                      {isRtl ? 'البريد الإلكتروني' : 'Email Desk'}
                    </h2>
                    <p className="text-sm font-semibold text-white" dir="ltr">
                      support@hettety.com
                    </p>
                  </div>
                </div>
              </div>

              {/* Direct AI Advisor Quick-Launch Card */}
              {onOpenAdvisor && (
                <div className="rounded-2xl bg-white/[0.08] backdrop-blur-md border border-white/15 p-5">
                  <div className="flex items-center gap-2 text-accent-300 text-xs font-extrabold mb-1.5">
                    <Sparkles size={15} aria-hidden="true" />
                    <span>
                      {isRtl ? 'إجابة فورية 24/7' : 'Instant 24/7 Answers'}
                    </span>
                  </div>
                  <p className="text-xs sm:text-sm text-brand-100/90 leading-relaxed mb-4">
                    {isRtl
                      ? 'محتاج مقارنة سريعة بين الكمبوندات أو أنظمة السداد؟ جرّب المستشار العقاري الذكي الآن.'
                      : 'Need a quick comparison of compounds, districts, or payment plans? Launch the AI Advisor right away.'}
                  </p>
                  <button
                    type="button"
                    onClick={onOpenAdvisor}
                    className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-accent-500 hover:bg-accent-600 text-white text-xs font-extrabold shadow-lg shadow-accent-500/25 transition-all cursor-pointer focus:outline-none focus:ring-2 focus:ring-accent-300"
                  >
                    <span>
                      {isRtl
                        ? 'افتح المستشار الذكي'
                        : 'Launch AI Advisor'}
                    </span>
                    {isRtl ? (
                      <ArrowLeft size={14} aria-hidden="true" />
                    ) : (
                      <ArrowRight size={14} aria-hidden="true" />
                    )}
                  </button>
                </div>
              )}
            </div>

            <div className="relative z-10 pt-8 mt-8 border-t border-white/15">
              <BrandLogo
                variant="horizontal"
                color="white"
                isRtl={isRtl}
                className="h-9"
              />
            </div>
          </aside>

          {/* Contact Form Panel */}
          <div className="lg:col-span-7 p-7 sm:p-10 lg:p-12 text-start">
            <form className="space-y-5" onSubmit={handleSubmit} noValidate>
              {/* Topic Selector Chips */}
              <div>
                <span className="block text-sm font-bold text-slate-700 dark:text-slate-300 mb-2.5">
                  {isRtl ? 'موضوع الرسالة' : 'What can we help you with?'}
                </span>
                <div
                  role="group"
                  aria-label={isRtl ? 'اختر موضوع الرسالة' : 'Select contact topic'}
                  className="grid grid-cols-2 gap-2.5"
                >
                  {topics.map((item) => {
                    const isSelected = topic === item.key;
                    return (
                      <button
                        key={item.key}
                        type="button"
                        onClick={() => {
                          setTopic(item.key);
                          clearStatusIfNeeded();
                        }}
                        aria-pressed={isSelected}
                        className={`inline-flex items-center justify-center sm:justify-start gap-2 px-3.5 py-2.5 rounded-xl text-xs sm:text-sm font-bold border transition-all cursor-pointer focus:outline-none focus:ring-2 focus:ring-brand-500 ${
                          isSelected
                            ? 'bg-brand-600 dark:bg-accent-500 text-white border-brand-600 dark:border-accent-500 shadow-md shadow-brand-600/20 dark:shadow-accent-500/25'
                            : 'bg-slate-50 dark:bg-slate-800/70 text-slate-700 dark:text-slate-300 border-slate-200 dark:border-slate-700 hover:border-brand-300 dark:hover:border-accent-500'
                        }`}
                      >
                        <span
                          className={
                            isSelected ? 'text-accent-300 dark:text-white' : 'text-brand-500 dark:text-brand-400'
                          }
                        >
                          {item.icon}
                        </span>
                        <span className="truncate">{item.label}</span>
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Optional Name + Required Email Row */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label
                    htmlFor="contact-name"
                    className="block text-sm font-bold text-slate-700 dark:text-slate-300 mb-1.5"
                  >
                    {t.auth_name || (isRtl ? 'الاسم الكامل' : 'Full Name')}{' '}
                    <span className="text-xs font-normal text-slate-400">
                      ({isRtl ? 'اختياري' : 'optional'})
                    </span>
                  </label>
                  <div className="relative">
                    <User
                      size={16}
                      className="pointer-events-none absolute top-1/2 -translate-y-1/2 start-3.5 text-slate-400"
                      aria-hidden="true"
                    />
                    <input
                      id="contact-name"
                      name="name"
                      type="text"
                      autoComplete="name"
                      value={name}
                      onChange={(e) => {
                        setName(e.target.value);
                        clearStatusIfNeeded();
                      }}
                      className="w-full ps-10 pe-4 py-2.5 rounded-xl border border-slate-300 dark:border-slate-700 bg-slate-50/70 dark:bg-slate-800/80 focus:bg-white dark:focus:bg-slate-800 focus:ring-2 focus:ring-brand-500 focus:border-brand-500 outline-none transition-all text-slate-900 dark:text-white placeholder:text-slate-400"
                      placeholder={isRtl ? 'اسمك' : 'Your name'}
                    />
                  </div>
                </div>

                <div>
                  <label
                    htmlFor="contact-email"
                    className="block text-sm font-bold text-slate-700 dark:text-slate-300 mb-1.5"
                  >
                    {t.auth_email}
                  </label>
                  <div className="relative">
                    <Mail
                      size={16}
                      className="pointer-events-none absolute top-1/2 -translate-y-1/2 start-3.5 text-slate-400"
                      aria-hidden="true"
                    />
                    <input
                      id="contact-email"
                      name="email"
                      type="email"
                      required
                      autoComplete="email"
                      value={email}
                      onChange={(e) => {
                        setEmail(e.target.value);
                        clearStatusIfNeeded();
                      }}
                      className="w-full ps-10 pe-4 py-2.5 rounded-xl border border-slate-300 dark:border-slate-700 bg-slate-50/70 dark:bg-slate-800/80 focus:bg-white dark:focus:bg-slate-800 focus:ring-2 focus:ring-brand-500 focus:border-brand-500 outline-none transition-all text-slate-900 dark:text-white placeholder:text-slate-400"
                      placeholder="you@example.com"
                      dir="ltr"
                    />
                  </div>
                </div>
              </div>

              {/* Message Textarea */}
              <div>
                <div className="flex items-center justify-between gap-2 mb-1.5">
                  <label
                    htmlFor="contact-message"
                    className="block text-sm font-bold text-slate-700 dark:text-slate-300"
                  >
                    {t.contact_msg}
                  </label>
                  <span className="text-[11px] font-medium text-slate-400 tabular-nums">
                    {message.length} / 4999
                  </span>
                </div>
                <textarea
                  id="contact-message"
                  name="message"
                  rows={5}
                  required
                  maxLength={4999}
                  value={message}
                  onChange={(e) => {
                    setMessage(e.target.value);
                    clearStatusIfNeeded();
                  }}
                  className="w-full px-4 py-3 rounded-xl border border-slate-300 dark:border-slate-700 bg-slate-50/70 dark:bg-slate-800/80 focus:bg-white dark:focus:bg-slate-800 focus:ring-2 focus:ring-brand-500 focus:border-brand-500 outline-none transition-all text-slate-900 dark:text-white placeholder:text-slate-400 resize-y"
                  placeholder={
                    isRtl
                      ? 'اكتب تفاصيل استفسارك، المنطقة أو نوع الوحدة المهتم بها...'
                      : "Tell us what you're looking for — area, unit type, or how we can help..."
                  }
                />
              </div>

              {/* Screen-reader & visual submission status */}
              <div aria-live="polite" role="status">
                {status === 'sent' && (
                  <p className="flex items-center gap-2.5 rounded-xl bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-800/60 px-4 py-3 text-sm font-bold text-emerald-700 dark:text-emerald-300">
                    <CheckCircle2
                      size={17}
                      className="shrink-0"
                      aria-hidden="true"
                    />
                    <span>
                      {isRtl
                        ? 'تم إرسال رسالتك ✅ هنرد عليك في أقرب وقت.'
                        : "Message sent ✅ we'll get back to you shortly."}
                    </span>
                  </p>
                )}
                {status === 'error' && (
                  <p className="flex items-center gap-2.5 rounded-xl bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-800/60 px-4 py-3 text-sm font-bold text-rose-700 dark:text-rose-300">
                    <AlertCircle
                      size={17}
                      className="shrink-0"
                      aria-hidden="true"
                    />
                    <span>{error}</span>
                  </p>
                )}
              </div>

              <BrandButton
                type="submit"
                variant="primary"
                disabled={status === 'sending'}
                className="w-full py-3.5 text-base"
              >
                {status === 'sending' ? (
                  <>
                    <Loader2
                      size={18}
                      className="animate-spin"
                      aria-hidden="true"
                    />
                    <span>{isRtl ? 'جاري الإرسال...' : 'Sending...'}</span>
                  </>
                ) : (
                  <>
                    <Send size={16} aria-hidden="true" />
                    <span>{t.contact_btn}</span>
                  </>
                )}
              </BrandButton>
            </form>
          </div>
        </div>
      </div>
    </section>
  );
};

export default ContactPage;
