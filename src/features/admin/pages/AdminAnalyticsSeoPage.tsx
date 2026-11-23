import React, { useCallback, useEffect, useState } from 'react';
import {
  BarChart3,
  ShieldCheck,
  Globe,
  RefreshCw,
  CheckCircle2,
  AlertTriangle,
  XCircle,
} from 'lucide-react';
import { MarketAnalyticsDashboard } from '../../../components/analytics/MarketAnalyticsDashboard';
import { PlatformSecurityCenter } from '../../../components/operations/PlatformSecurityCenter';
import { Property, SeoAuditCheckItem, SeoAuditReport } from '../types';

export interface AdminAnalyticsSeoPageProps {
  isRtl: boolean;
  properties: Property[];
}

export const AdminAnalyticsSeoPage: React.FC<AdminAnalyticsSeoPageProps> = ({
  isRtl,
  properties,
}) => {
  const [subTab, setSubTab] = useState<'seo' | 'market' | 'security'>('seo');
  const [seoReport, setSeoReport] = useState<SeoAuditReport | null>(null);
  const [auditing, setAuditing] = useState(false);

  const runLiveSeoAudit = useCallback(async () => {
    setAuditing(true);
    const checks: SeoAuditCheckItem[] = [];

    if (typeof document !== 'undefined') {
      const title = document.title?.trim() || '';
      checks.push({
        id: 'title',
        labelEn: 'Document <title> Tag',
        labelAr: 'عنوان الصفحة <title>',
        status: title.length >= 20 && title.length <= 70 ? 'pass' : title.length > 0 ? 'warn' : 'fail',
        points: title.length >= 20 && title.length <= 70 ? 15 : title.length > 0 ? 10 : 0,
        maxPoints: 15,
        currentValue: title || '(missing)',
        recommendationEn: 'Keep title between 20–70 characters including primary Egyptian real estate keywords.',
        recommendationAr: 'اجعل العنوان بين 20 و70 حرفاً متضمناً الكلمات المفتاحية للعقارات في مصر.',
      });

      const metaDesc = document.querySelector('meta[name="description"]')?.getAttribute('content')?.trim() || '';
      checks.push({
        id: 'description',
        labelEn: 'Meta Description',
        labelAr: 'الوصف التعريفي (Meta Description)',
        status: metaDesc.length >= 70 && metaDesc.length <= 165 ? 'pass' : metaDesc.length > 0 ? 'warn' : 'fail',
        points: metaDesc.length >= 70 && metaDesc.length <= 165 ? 15 : metaDesc.length > 0 ? 10 : 0,
        maxPoints: 15,
        currentValue: metaDesc ? `${metaDesc.slice(0, 90)}${metaDesc.length > 90 ? '…' : ''}` : '(missing)',
        recommendationEn: 'Aim for 120–160 compelling characters summarizing verified listings & 3D tours.',
        recommendationAr: 'اكتب وصفاً بين 120 و160 حرفاً يشرح ميزة الجولات ثلاثية الأبعاد والتوثيق.',
      });

      const canonical = document.querySelector('link[rel="canonical"]')?.getAttribute('href')?.trim() || '';
      checks.push({
        id: 'canonical',
        labelEn: 'Canonical URL Link',
        labelAr: 'الرابط الأساسي (Canonical URL)',
        status: canonical ? 'pass' : 'warn',
        points: canonical ? 15 : 5,
        maxPoints: 15,
        currentValue: canonical || '(not set in current shell)',
        recommendationEn: 'Ensure every public listing route sets an absolute <link rel="canonical"> URL.',
        recommendationAr: 'تأكد من تعيين رابط Canonical مطلق لكل صفحة عقار لمنع تكرار الفهرسة.',
      });

      const ogTitle = document.querySelector('meta[property="og:title"]')?.getAttribute('content')?.trim() || '';
      const ogDesc = document.querySelector('meta[property="og:description"]')?.getAttribute('content')?.trim() || '';
      const ogImg = document.querySelector('meta[property="og:image"]')?.getAttribute('content')?.trim() || '';
      const ogCount = [ogTitle, ogDesc, ogImg].filter(Boolean).length;
      checks.push({
        id: 'opengraph',
        labelEn: 'OpenGraph Social Tags (og:title, og:description, og:image)',
        labelAr: 'وسوم المشاركة الاجتماعية (OpenGraph)',
        status: ogCount === 3 ? 'pass' : ogCount > 0 ? 'warn' : 'fail',
        points: ogCount * 5,
        maxPoints: 15,
        currentValue: `${ogCount}/3 OpenGraph tags detected`,
        recommendationEn: 'Include og:title, og:description, and high-res og:image for WhatsApp & social previews.',
        recommendationAr: 'أضف og:title وog:description وog:image عالية الدقة لتحسين مشاركة الروابط على واتساب.',
      });

      const jsonLdScripts = Array.from(document.querySelectorAll('script[type="application/ld+json"]'));
      checks.push({
        id: 'jsonld',
        labelEn: 'JSON-LD Structured Data (Schema.org)',
        labelAr: 'البيانات المهيكلة (JSON-LD Schema.org)',
        status: jsonLdScripts.length > 0 ? 'pass' : 'warn',
        points: jsonLdScripts.length > 0 ? 15 : 5,
        maxPoints: 15,
        currentValue: `${jsonLdScripts.length} JSON-LD script block(s)`,
        recommendationEn: 'Inject Organization, RealEstateListing, and BreadcrumbList JSON-LD schemas on public pages.',
        recommendationAr: 'أدرج مخططات RealEstateListing وOrganization وBreadcrumbList لنتائج بحث غنية في جوجل.',
      });

      const htmlLang = document.documentElement.getAttribute('lang') || '';
      const htmlDir = document.documentElement.getAttribute('dir') || '';
      checks.push({
        id: 'i18n_rtl',
        labelEn: 'HTML Language & RTL/LTR Direction Attributes',
        labelAr: 'سمات اللغة والاتجاه (lang & dir)',
        status: htmlLang && htmlDir ? 'pass' : htmlLang || htmlDir ? 'warn' : 'fail',
        points: htmlLang && htmlDir ? 15 : htmlLang || htmlDir ? 10 : 0,
        maxPoints: 15,
        currentValue: `lang="${htmlLang || 'unset'}", dir="${htmlDir || 'unset'}"`,
        recommendationEn: 'Keep <html lang="ar" dir="rtl"> and <html lang="en" dir="ltr"> synced with active language.',
        recommendationAr: 'حافظ على تزامن lang وdir مع اللغة المختارة لدعم فهرسة البحث العربي والإنجليزي.',
      });
    }

    // Async robots.txt check
    let robotsOk = false;
    let robotsNote = 'Unavailable in local harness';
    try {
      if (typeof fetch === 'function') {
        const res = await fetch('/robots.txt');
        if (res.ok) {
          const text = await res.text();
          robotsOk = /user-agent/i.test(text);
          robotsNote = robotsOk ? 'HTTP 200 • Valid User-agent directive' : 'HTTP 200 • Missing User-agent rules';
        } else {
          robotsNote = `HTTP ${res.status}`;
        }
      }
    } catch {
      robotsNote = 'Probe skipped (offline/test runtime)';
    }

    checks.push({
      id: 'robots',
      labelEn: 'Crawler Policy (/robots.txt)',
      labelAr: 'ملف توجيه محركات البحث (/robots.txt)',
      status: robotsOk ? 'pass' : 'warn',
      points: robotsOk ? 10 : 4,
      maxPoints: 10,
      currentValue: robotsNote,
      recommendationEn: 'Serve /robots.txt allowing public listings while disallowing /admin and private vaults.',
      recommendationAr: 'وفّر ملف /robots.txt يسمح بفهرسة العقارات ويمنع فهرسة لوحة الإدارة والملفات الخاصة.',
    });

    const score = checks.reduce((s, c) => s + c.points, 0);
    const maxScore = checks.reduce((s, c) => s + c.maxPoints, 0);

    setSeoReport({
      score,
      maxScore,
      checks,
      auditedAt: new Date().toISOString(),
    });
    setAuditing(false);
  }, []);

  useEffect(() => {
    runLiveSeoAudit();
  }, [runLiveSeoAudit]);

  const scorePct = seoReport ? Math.round((seoReport.score / Math.max(1, seoReport.maxScore)) * 100) : 0;
  const strokeDash = 2 * Math.PI * 44;
  const strokeOffset = strokeDash - (strokeDash * scorePct) / 100;

  return (
    <div className="space-y-6 animate-fade-in" data-testid="admin-analytics-seo-page">
      {/* Header & Sub-Tabs */}
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-black text-slate-900 dark:text-white flex items-center gap-2.5">
            <BarChart3 className="text-accent-500" size={24} />
            {isRtl ? 'التحليلات السوقية، الأمن السيبراني، وفحص الـ SEO' : 'Market Intelligence, Security & Technical SEO'}
          </h1>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
            {isRtl
              ? 'فحص فوري لنتائج SEO والبيانات المهيكلة JSON-LD، مؤشرات أسعار المتر، وحوكمة الأمان'
              : 'Live Technical SEO & JSON-LD auditor, Egyptian real estate market analytics, and Zero-Trust security checks'}
          </p>
        </div>

        <div className="inline-flex flex-wrap rounded-2xl bg-white dark:bg-slate-900 p-1.5 border border-slate-200 dark:border-slate-800 shadow-xs gap-1">
          <button
            type="button"
            onClick={() => setSubTab('seo')}
            className={`px-3.5 py-2 rounded-xl text-xs font-bold inline-flex items-center gap-1.5 cursor-pointer ${
              subTab === 'seo'
                ? 'bg-brand-600 text-white'
                : 'text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800'
            }`}
          >
            <Globe size={14} />
            {isRtl ? 'فاحص الـ SEO المباشر' : 'Live SEO Auditor'}
          </button>
          <button
            type="button"
            onClick={() => setSubTab('market')}
            className={`px-3.5 py-2 rounded-xl text-xs font-bold inline-flex items-center gap-1.5 cursor-pointer ${
              subTab === 'market'
                ? 'bg-brand-600 text-white'
                : 'text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800'
            }`}
          >
            <BarChart3 size={14} />
            {isRtl ? 'تحليلات السوق' : 'Market Analytics'}
          </button>
          <button
            type="button"
            onClick={() => setSubTab('security')}
            className={`px-3.5 py-2 rounded-xl text-xs font-bold inline-flex items-center gap-1.5 cursor-pointer ${
              subTab === 'security'
                ? 'bg-brand-600 text-white'
                : 'text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800'
            }`}
          >
            <ShieldCheck size={14} />
            {isRtl ? 'مركز الأمن' : 'Security Center'}
          </button>
        </div>
      </div>

      {/* Live Technical SEO Auditor */}
      {subTab === 'seo' && (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
          {/* Score Gauge Card */}
          <div className="lg:col-span-4 bg-white dark:bg-slate-900 rounded-2xl border border-slate-200/80 dark:border-slate-800 p-6 shadow-xs flex flex-col items-center justify-between text-center space-y-5">
            <div className="space-y-1">
              <h2 className="text-base font-black text-slate-900 dark:text-white">
                {isRtl ? 'مؤشر جاهزية الـ SEO التقني' : 'Live Technical SEO Score'}
              </h2>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                {isRtl ? 'فحص مباشر للـ DOM والبيانات المهيكلة' : 'Live DOM metadata & Schema.org audit'}
              </p>
            </div>

            <div className="relative w-36 h-36 flex items-center justify-center">
              <svg className="w-36 h-36 -rotate-90" viewBox="0 0 100 100">
                <circle
                  cx="50"
                  cy="50"
                  r="44"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="8"
                  className="text-slate-100 dark:text-slate-800"
                />
                <circle
                  cx="50"
                  cy="50"
                  r="44"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="8"
                  strokeLinecap="round"
                  strokeDasharray={strokeDash}
                  strokeDashoffset={strokeOffset}
                  className={
                    scorePct >= 80
                      ? 'text-emerald-500'
                      : scorePct >= 55
                      ? 'text-amber-500'
                      : 'text-rose-500'
                  }
                />
              </svg>
              <div className="absolute inset-0 flex flex-col items-center justify-center">
                <span className="text-3xl font-black font-mono text-slate-900 dark:text-white">
                  {scorePct}
                </span>
                <span className="text-[11px] font-bold text-slate-400">/ 100</span>
              </div>
            </div>

            <button
              type="button"
              onClick={runLiveSeoAudit}
              disabled={auditing}
              className="w-full inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl bg-brand-600 hover:bg-brand-700 text-white text-xs font-bold cursor-pointer disabled:opacity-50"
            >
              <RefreshCw size={14} className={auditing ? 'animate-spin' : ''} />
              {isRtl ? 'إعادة فحص الـ SEO' : 'Re-run Live SEO Audit'}
            </button>
          </div>

          {/* Checks Breakdown */}
          <div className="lg:col-span-8 bg-white dark:bg-slate-900 rounded-2xl border border-slate-200/80 dark:border-slate-800 p-6 shadow-xs space-y-3">
            <h3 className="text-sm font-bold text-slate-900 dark:text-white mb-2">
              {isRtl ? 'تفاصيل فحص محركات البحث والبيانات المهيكلة' : 'Structured Data & Crawler Audit Checks'}
            </h3>
            {seoReport?.checks.map((item) => (
              <div
                key={item.id}
                className="p-4 rounded-xl border border-slate-100 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-800/30 flex items-start gap-3"
              >
                {item.status === 'pass' ? (
                  <CheckCircle2 size={18} className="text-emerald-500 shrink-0 mt-0.5" />
                ) : item.status === 'warn' ? (
                  <AlertTriangle size={18} className="text-amber-500 shrink-0 mt-0.5" />
                ) : (
                  <XCircle size={18} className="text-rose-500 shrink-0 mt-0.5" />
                )}
                <div className="flex-1 min-w-0 space-y-1">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-xs font-bold text-slate-900 dark:text-white">
                      {isRtl ? item.labelAr : item.labelEn}
                    </span>
                    <span className="text-[11px] font-mono font-bold text-slate-500 shrink-0">
                      {item.points}/{item.maxPoints}
                    </span>
                  </div>
                  <div className="text-[11px] font-mono text-brand-700 dark:text-accent-300 break-all">
                    {item.currentValue}
                  </div>
                  <p className="text-[11px] text-slate-500 dark:text-slate-400">
                    {isRtl ? item.recommendationAr : item.recommendationEn}
                  </p>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Market Analytics Dashboard */}
      {subTab === 'market' && (
        <MarketAnalyticsDashboard properties={properties} isRtl={isRtl} />
      )}

      {/* Platform Security Center */}
      {subTab === 'security' && (
        <PlatformSecurityCenter isRtl={isRtl} />
      )}
    </div>
  );
};
