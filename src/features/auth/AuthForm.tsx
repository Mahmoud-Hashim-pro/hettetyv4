import React, { useEffect, useState } from 'react';
import {
  AlertCircle,
  Box,
  CheckCircle2,
  Eye,
  EyeOff,
  Loader2,
  Lock,
  Mail,
  ShieldCheck,
  Sparkles,
  User,
} from 'lucide-react';
import {
  auth,
  createUserWithEmailAndPassword,
  db,
  doc,
  getDoc,
  googleProvider,
  setDoc,
  signInWithEmailAndPassword,
  signInWithPopup,
  signOut,
} from '../../firebase';
import { SUPER_ADMIN_EMAILS } from '../../constants';
import { BrandLogo } from '../../components/BrandLogo';
import { BrandButton } from '../../shared/ui/BrandButton';

export interface AuthFormProps {
  type: 'login' | 'register';
  onSwitch: () => void;
  onSubmit: (email: string) => void;
  t: any;
  isRtl: boolean;
}

function calculatePasswordStrength(pass: string): number {
  let score = 0;
  if (pass.length > 0) score += 1;
  if (pass.length >= 8) score += 1;
  if (/[A-Za-z]/.test(pass) && /[0-9]/.test(pass)) score += 1;
  if (/[^A-Za-z0-9]/.test(pass)) score += 1;
  return score;
}

function formatCleanAuthError(
  err: any,
  isRtl: boolean,
  channel: 'email' | 'google'
): string {
  const code = String(err?.code || '');
  const rawMessage = String(err?.message || '');

  if (code === 'auth/user-not-found') {
    return isRtl
      ? 'هذا الحساب غير موجود، يرجى التسجيل أولاً.'
      : 'This account does not exist. Please register first.';
  }

  if (code === 'auth/wrong-password' || code === 'auth/invalid-credential') {
    return isRtl
      ? 'البريد الإلكتروني أو كلمة المرور غير صحيحة. يرجى التحقق والمحاولة مجدداً.'
      : 'Invalid email or password. Please check your credentials and try again.';
  }

  if (code === 'auth/email-already-in-use') {
    return isRtl
      ? 'هذا البريد الإلكتروني مسجل بالفعل. يمكنك تسجيل الدخول مباشرة.'
      : 'An account with this email already exists. Try signing in instead.';
  }

  if (code === 'auth/invalid-email') {
    return isRtl
      ? 'يرجى إدخال بريد إلكتروني صحيح.'
      : 'Please enter a valid email address.';
  }

  if (code === 'auth/too-many-requests') {
    return isRtl
      ? 'تم تسجيل محاولات كثيرة متتالية. يرجى الانتظار قليلاً ثم المحاولة مجدداً.'
      : 'Too many attempts. Please wait a moment and try again.';
  }

  if (code === 'auth/operation-not-allowed') {
    if (channel === 'google') {
      return isRtl
        ? 'تسجيل الدخول السريع عبر Google غير متاح حالياً على منصة حتتي. يرجى استخدام البريد الإلكتروني وكلمة المرور.'
        : 'Google popup sign-in is currently unavailable on HETTETY Neon Auth. Please sign in with your email and password.';
    }
    return isRtl
      ? 'تعذّر إتمام التسجيل بالبريد الإلكتروني حالياً. يرجى المحاولة مجدداً.'
      : 'Email/password sign-in is currently unavailable. Please try again.';
  }

  if (code === 'auth/unauthorized-domain') {
    return isRtl
      ? 'هذا النطاق غير مفعّل للمصادقة حالياً على منصة حتتي. يرجى التواصل مع الدعم.'
      : 'This domain is not currently authorized on HETTETY Auth. Please contact support.';
  }

  // Never leak any legacy third-party console/provider strings to users
  if (rawMessage && !/firebase/i.test(rawMessage)) {
    return rawMessage;
  }

  return isRtl
    ? 'تعذّر إتمام التسجيل بالبريد الإلكتروني حالياً. يرجى المحاولة مجدداً.'
    : 'Email/password sign-in is currently unavailable. Please try again.';
}

export const AuthForm: React.FC<AuthFormProps> = ({
  type,
  onSwitch,
  onSubmit,
  t,
  isRtl,
}) => {
  const isLogin = type === 'login';
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    setError('');
  }, [type]);

  const strength = calculatePasswordStrength(password);
  const strengthLabels = [
    '',
    t.auth_pass_weak || (isRtl ? 'ضعيف' : 'Weak'),
    t.auth_pass_fair || (isRtl ? 'مقبول' : 'Fair'),
    t.auth_pass_good || (isRtl ? 'جيد' : 'Good'),
    t.auth_pass_strong || (isRtl ? 'قوي' : 'Strong'),
  ];
  const strengthBarColors = [
    'bg-slate-200 dark:bg-slate-800',
    'bg-rose-500',
    'bg-amber-500',
    'bg-brand-500',
    'bg-emerald-500',
  ];
  const strengthTextColors = [
    'text-slate-400',
    'text-rose-600 dark:text-rose-400',
    'text-amber-600 dark:text-amber-400',
    'text-brand-600 dark:text-brand-400',
    'text-emerald-600 dark:text-emerald-400',
  ];

  const handleGoogleSignIn = async () => {
    setLoading(true);
    setError('');
    try {
      const result = await signInWithPopup(auth, googleProvider);
      const user = result.user;

      const userDoc = await getDoc(doc(db, 'users', user.uid));

      if (!userDoc.exists()) {
        if (isLogin) {
          await signOut(auth);
          setError(
            isRtl
              ? 'هذا الحساب غير موجود، يرجى التسجيل أولاً.'
              : 'This account does not exist. Please register first.'
          );
          setLoading(false);
          return;
        }

        await setDoc(doc(db, 'users', user.uid), {
          uid: user.uid,
          name: user.displayName || '',
          email: user.email || '',
          role: SUPER_ADMIN_EMAILS.includes((user.email || '').toLowerCase())
            ? 'admin'
            : 'user',
          createdAt: new Date().toISOString(),
        });
      }

      onSubmit(user.email || '');
    } catch (err: any) {
      setLoading(false);
      if (
        err?.code === 'auth/popup-closed-by-user' ||
        err?.code === 'auth/cancelled-popup-request'
      ) {
        setError('');
      } else {
        setError(formatCleanAuthError(err, isRtl, 'google'));
      }
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);

    try {
      if (isLogin) {
        const result = await signInWithEmailAndPassword(auth, email, password);
        const userDoc = await getDoc(doc(db, 'users', result.user.uid));
        if (!userDoc.exists()) {
          await signOut(auth);
          setError(
            isRtl
              ? 'هذا الحساب غير موجود، يرجى التسجيل أولاً.'
              : 'This account does not exist. Please register first.'
          );
          setLoading(false);
          return;
        }
        onSubmit(email);
      } else {
        // Strict registration password policy
        if (password.length < 8 || !/[^A-Za-z0-9]/.test(password)) {
          setError(
            t.auth_pass_req ||
              (isRtl
                ? 'كلمة المرور يجب أن تكون 8 أحرف على الأقل وتتضمن رمزاً خاصاً.'
                : 'Password must be at least 8 characters and include a special character.')
          );
          setLoading(false);
          return;
        }

        const result = await createUserWithEmailAndPassword(
          auth,
          email,
          password
        );
        await setDoc(doc(db, 'users', result.user.uid), {
          uid: result.user.uid,
          name,
          email,
          role: SUPER_ADMIN_EMAILS.includes(email.toLowerCase())
            ? 'admin'
            : 'user',
          createdAt: new Date().toISOString(),
        });
        onSubmit(email);
      }
    } catch (err: any) {
      setError(formatCleanAuthError(err, isRtl, 'email'));
    } finally {
      setLoading(false);
    }
  };

  const pillars = [
    {
      icon: <Box size={18} aria-hidden="true" />,
      title: isRtl ? 'جولات مكانية ثلاثية الأبعاد' : '3D Spatial Tours',
      desc: isRtl
        ? 'استكشف الغرف والأبعاد بمسح ثلاثي الأبعاد وبانوراما 360° قبل الزيارة.'
        : 'Explore rooms and layouts through 3D scans and 360° panoramas before you visit.',
    },
    {
      icon: <ShieldCheck size={18} aria-hidden="true" />,
      title: isRtl ? 'جلسات محمية عبر Neon' : 'Neon-Secured Sessions',
      desc: isRtl
        ? 'مصادقة مشفّرة لحفظ مفضلاتك، مقارنة الوحدات، وإدارة مساحتك الخاصة بأمان.'
        : 'Encrypted token sessions protecting your saved homes, comparisons, and workspace.',
    },
    {
      icon: <Sparkles size={18} aria-hidden="true" />,
      title: isRtl ? 'مستشار عقاري ذكي ثنائي اللغة' : 'Bilingual AI Advisor',
      desc: isRtl
        ? 'قارن المشروعات وأنظمة السداد بالعربية والإنجليزية في لحظات.'
        : 'Compare compounds, districts, and payment plans in Arabic and English.',
    },
  ];

  return (
    <section
      dir={isRtl ? 'rtl' : 'ltr'}
      aria-labelledby="auth-page-heading"
      className="min-h-[82vh] flex items-center justify-center bg-slate-50 dark:bg-slate-950 px-4 py-10 sm:py-16 animate-fade-in relative overflow-hidden transition-colors duration-500"
    >
      {/* Subtle architectural ambient glow */}
      <div className="pointer-events-none absolute -top-24 -start-24 w-96 h-96 rounded-full bg-brand-200/40 dark:bg-brand-900/20 blur-3xl" />
      <div className="pointer-events-none absolute -bottom-24 -end-24 w-96 h-96 rounded-full bg-accent-200/35 dark:bg-accent-900/15 blur-3xl" />

      <div className="relative z-10 max-w-5xl w-full bg-white dark:bg-slate-900 rounded-3xl shadow-2xl border border-slate-200/80 dark:border-slate-800 overflow-hidden grid grid-cols-1 lg:grid-cols-12">
        {/* Start Architectural Editorial Showcase Panel */}
        <aside className="hidden lg:flex lg:col-span-5 flex-col justify-between relative overflow-hidden bg-gradient-to-br from-brand-950 via-brand-700 to-brand-600 text-white p-10 text-start">
          {/* Decorative blueprint grid & warm amber glow */}
          <div
            className="pointer-events-none absolute inset-0 opacity-15"
            style={{
              backgroundImage:
                'linear-gradient(rgba(255,255,255,0.14) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.14) 1px, transparent 1px)',
              backgroundSize: '34px 34px',
            }}
          />
          <div className="pointer-events-none absolute -bottom-16 -end-16 w-64 h-64 rounded-full bg-accent-500/25 blur-3xl" />
          <div className="pointer-events-none absolute top-16 -end-12 w-36 h-36 rounded-3xl border border-white/15 rotate-12" />

          <div className="relative z-10">
            <BrandLogo variant="horizontal" color="white" isRtl={isRtl} className="h-11 mb-9" />

            <p className="inline-flex items-center gap-2 text-[11px] font-extrabold uppercase tracking-widest text-accent-300 mb-3">
              <span>{isRtl ? 'ابحث. ثق. امتلك.' : 'FIND. TRUST. OWN.'}</span>
            </p>

            <h2 className="text-2xl xl:text-3xl font-heading font-black leading-snug mb-3">
              {isRtl
                ? 'بوابتك الذكية لاستكشاف العقارات في مصر'
                : 'Your spatial gateway to Egyptian real estate'}
            </h2>

            <p className="text-sm text-brand-200/90 leading-relaxed mb-8">
              {isRtl
                ? 'احتفظ بالوحدات المفضلة لديك، قارن بين المشروعات، وأدر إعلاناتك ومستنداتك من مكان واحد.'
                : 'Save favorite homes, compare developments side by side, and manage your listings and workspace in one place.'}
            </p>

            <div className="space-y-4">
              {pillars.map((pillar, idx) => (
                <div
                  key={idx}
                  className="flex items-start gap-3.5 rounded-2xl bg-white/[0.07] backdrop-blur-md border border-white/10 p-3.5"
                >
                  <div className="w-9 h-9 rounded-xl bg-accent-500/20 border border-accent-400/30 text-accent-300 flex items-center justify-center shrink-0">
                    {pillar.icon}
                  </div>
                  <div className="min-w-0">
                    <h3 className="text-sm font-extrabold text-white leading-tight mb-0.5">
                      {pillar.title}
                    </h3>
                    <p className="text-xs text-brand-200/85 leading-relaxed">
                      {pillar.desc}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div className="relative z-10 pt-8 mt-8 border-t border-white/15 flex items-center justify-between text-[11px] font-semibold text-brand-200/80">
            <span>{isRtl ? 'القاهرة · الشيخ زايد · الساحل' : 'Cairo · Zayed · North Coast'}</span>
            <span>HETTETY Platform</span>
          </div>
        </aside>

        {/* End Form Panel */}
        <div className="lg:col-span-7 p-7 sm:p-10 lg:p-12 flex flex-col justify-center text-start">
          {/* Mobile Brand Header */}
          <div className="mb-6 lg:hidden text-brand-600 dark:text-white">
            <BrandLogo variant="horizontal" color="currentColor" isRtl={isRtl} className="h-9" />
          </div>

          <div className="mb-7">
            <div className="inline-flex items-center justify-center w-11 h-11 rounded-2xl bg-brand-50 dark:bg-brand-900/50 border border-brand-100 dark:border-brand-800 text-brand-600 dark:text-brand-300 mb-4">
              <User size={20} aria-hidden="true" />
            </div>
            <h1
              id="auth-page-heading"
              className="text-2xl sm:text-3xl font-heading font-black text-slate-900 dark:text-white"
            >
              {isLogin ? t.auth_welcome : t.auth_create}
            </h1>
            <p className="text-slate-500 dark:text-slate-400 text-sm mt-1.5 leading-relaxed">
              {isLogin ? t.auth_login_desc : t.auth_reg_desc}
            </p>
          </div>

          <form className="space-y-4" onSubmit={handleSubmit}>
            {!isLogin && (
              <div>
                <label
                  htmlFor="auth-name"
                  className="block text-sm font-bold text-slate-700 dark:text-slate-300 mb-1.5"
                >
                  {t.auth_name}
                </label>
                <div className="relative">
                  <User
                    size={17}
                    className="pointer-events-none absolute top-1/2 -translate-y-1/2 start-3.5 text-slate-400"
                    aria-hidden="true"
                  />
                  <input
                    id="auth-name"
                    name="name"
                    type="text"
                    required
                    autoComplete="name"
                    value={name}
                    onChange={(e) => {
                      setName(e.target.value);
                      if (error) setError('');
                    }}
                    className="w-full ps-11 pe-4 py-3 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50/70 dark:bg-slate-800/80 focus:bg-white dark:focus:bg-slate-800 focus:ring-2 focus:ring-brand-500 focus:border-brand-500 outline-none transition-all text-slate-900 dark:text-white placeholder:text-slate-400"
                    placeholder={isRtl ? 'الاسم بالكامل' : 'John Doe'}
                  />
                </div>
              </div>
            )}

            <div>
              <label
                htmlFor="auth-email"
                className="block text-sm font-bold text-slate-700 dark:text-slate-300 mb-1.5"
              >
                {t.auth_email}
              </label>
              <div className="relative">
                <Mail
                  size={17}
                  className="pointer-events-none absolute top-1/2 -translate-y-1/2 start-3.5 text-slate-400"
                  aria-hidden="true"
                />
                <input
                  id="auth-email"
                  name="email"
                  type="email"
                  required
                  autoComplete="email"
                  dir="ltr"
                  value={email}
                  onChange={(e) => {
                    setEmail(e.target.value);
                    if (error) setError('');
                  }}
                  className="w-full ps-11 pe-4 py-3 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50/70 dark:bg-slate-800/80 focus:bg-white dark:focus:bg-slate-800 focus:ring-2 focus:ring-brand-500 focus:border-brand-500 outline-none transition-all text-slate-900 dark:text-white placeholder:text-slate-400 text-start"
                  placeholder="you@example.com"
                />
              </div>
            </div>

            <div>
              <label
                htmlFor="auth-password"
                className="block text-sm font-bold text-slate-700 dark:text-slate-300 mb-1.5"
              >
                {t.auth_pass}
              </label>
              <div className="relative">
                <Lock
                  size={17}
                  className="pointer-events-none absolute top-1/2 -translate-y-1/2 start-3.5 text-slate-400"
                  aria-hidden="true"
                />
                <input
                  id="auth-password"
                  name="password"
                  type={showPassword ? 'text' : 'password'}
                  required
                  autoComplete={isLogin ? 'current-password' : 'new-password'}
                  value={password}
                  onChange={(e) => {
                    setPassword(e.target.value);
                    if (error) setError('');
                  }}
                  className="w-full ps-11 pe-12 py-3 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50/70 dark:bg-slate-800/80 focus:bg-white dark:focus:bg-slate-800 focus:ring-2 focus:ring-brand-500 focus:border-brand-500 outline-none transition-all text-slate-900 dark:text-white placeholder:text-slate-400"
                  placeholder="••••••••"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword((prev) => !prev)}
                  aria-label={
                    showPassword
                      ? isRtl
                        ? 'إخفاء كلمة المرور'
                        : 'Hide password'
                      : isRtl
                        ? 'إظهار كلمة المرور'
                        : 'Show password'
                  }
                  aria-pressed={showPassword}
                  className="absolute top-1/2 -translate-y-1/2 end-2.5 p-2 rounded-lg text-slate-400 hover:text-brand-600 dark:hover:text-white hover:bg-slate-200/60 dark:hover:bg-slate-700/60 transition-colors cursor-pointer focus:outline-none focus:ring-2 focus:ring-brand-500"
                >
                  {showPassword ? (
                    <EyeOff size={17} aria-hidden="true" />
                  ) : (
                    <Eye size={17} aria-hidden="true" />
                  )}
                </button>
              </div>

              {/* 4-Bar Password Strength Meter */}
              {password.length > 0 && (
                <div className="mt-2.5 space-y-1.5">
                  <div
                    className="flex gap-1.5"
                    role="progressbar"
                    aria-valuenow={strength}
                    aria-valuemin={0}
                    aria-valuemax={4}
                    aria-label={
                      isRtl ? 'قوة كلمة المرور' : 'Password strength'
                    }
                  >
                    {[1, 2, 3, 4].map((level) => (
                      <div
                        key={level}
                        className={`h-1.5 flex-1 rounded-full transition-colors duration-300 ${
                          strength >= level
                            ? strengthBarColors[strength]
                            : 'bg-slate-100 dark:bg-slate-800'
                        }`}
                      />
                    ))}
                  </div>
                  <div className="flex items-center justify-between gap-2 text-xs">
                    <span className={`font-bold ${strengthTextColors[strength]}`}>
                      {strengthLabels[strength]}
                    </span>
                    <span className="text-slate-500 dark:text-slate-400 flex items-center gap-1">
                      {!isLogin &&
                        password.length >= 8 &&
                        /[^A-Za-z0-9]/.test(password) && (
                          <CheckCircle2
                            size={12}
                            className="text-emerald-500 shrink-0"
                            aria-hidden="true"
                          />
                        )}
                      <span>{t.auth_pass_req}</span>
                    </span>
                  </div>
                </div>
              )}
            </div>

            {error && (
              <div
                role="alert"
                aria-live="assertive"
                className="flex items-start gap-2.5 rounded-xl bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-800/60 px-3.5 py-3 text-sm font-semibold text-rose-700 dark:text-rose-300"
              >
                <AlertCircle
                  size={17}
                  className="shrink-0 mt-0.5"
                  aria-hidden="true"
                />
                <span>{error}</span>
              </div>
            )}

            <BrandButton
              type="submit"
              variant="primary"
              disabled={loading}
              className="w-full py-3.5 text-base mt-2"
            >
              {loading ? (
                <Loader2 size={18} className="animate-spin" aria-hidden="true" />
              ) : isLogin ? (
                t.auth_signin_btn
              ) : (
                t.auth_signup_btn
              )}
            </BrandButton>
          </form>

          {/* OAuth Divider + Google Sign-In */}
          <div className="mt-7">
            <div className="relative">
              <div className="absolute inset-0 flex items-center">
                <div className="w-full border-t border-slate-200 dark:border-slate-800" />
              </div>
              <div className="relative flex justify-center text-xs font-semibold">
                <span className="px-3 bg-white dark:bg-slate-900 text-slate-500 dark:text-slate-400">
                  {t.auth_or_continue ||
                    (isRtl ? 'أو المتابعة باستخدام' : 'Or continue with')}
                </span>
              </div>
            </div>

            <div className="mt-5">
              <button
                type="button"
                onClick={handleGoogleSignIn}
                disabled={loading}
                className="flex items-center justify-center gap-2.5 w-full px-4 py-3 border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 rounded-xl hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors text-slate-700 dark:text-slate-200 font-bold text-sm cursor-pointer disabled:opacity-50 focus:outline-none focus:ring-2 focus:ring-brand-500"
              >
                <svg className="w-5 h-5" viewBox="0 0 24 24" aria-hidden="true">
                  <path
                    d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
                    fill="#4285F4"
                  />
                  <path
                    d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
                    fill="#34A853"
                  />
                  <path
                    d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"
                    fill="#FBBC05"
                  />
                  <path
                    d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
                    fill="#EA4335"
                  />
                </svg>
                <span>{t.auth_google || 'Google'}</span>
              </button>
            </div>
          </div>

          {/* Mode Switch Footer */}
          <div className="mt-7 text-center text-sm">
            <span className="text-slate-500 dark:text-slate-400">
              {isLogin ? t.auth_no_account : t.auth_has_account}
            </span>
            <button
              type="button"
              onClick={onSwitch}
              className="font-extrabold text-brand-600 dark:text-accent-400 hover:text-brand-700 dark:hover:text-accent-300 cursor-pointer ms-1.5 underline-offset-4 hover:underline focus:outline-none focus:ring-2 focus:ring-brand-500 rounded px-1"
            >
              {isLogin ? t.nav_register : t.nav_login_short}
            </button>
          </div>
        </div>
      </div>
    </section>
  );
};

export default AuthForm;
