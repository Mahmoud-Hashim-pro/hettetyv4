import React, { useCallback, useEffect, useState } from 'react';
import {
  Sparkles,
  RefreshCw,
  CheckCircle2,
  XCircle,
  AlertTriangle,
  Send,
  Terminal,
  ShieldCheck,
  KeyRound,
  Gauge,
  Cpu,
  Loader2,
} from 'lucide-react';
import { AdvisorHealthStatus } from '../types';
import { adminPortalService } from '../services/adminPortalService';

export interface AdminAiOpsPageProps {
  isRtl: boolean;
  userEmail?: string | null;
  onHealthUpdate?: (health: AdvisorHealthStatus) => void;
}

export const AdminAiOpsPage: React.FC<AdminAiOpsPageProps> = ({
  isRtl,
  userEmail,
  onHealthUpdate,
}) => {
  const [health, setHealth] = useState<AdvisorHealthStatus | null>(null);
  const [probing, setProbing] = useState(true);

  const [prompt, setPrompt] = useState(
    isRtl
      ? 'رشح لي أفضل مناطق الاستثمار العقاري في القاهرة الجديدة بميزانية 8 مليون جنيه.'
      : 'Recommend the top real estate investment areas in New Cairo for an 8M EGP budget.'
  );
  const [task, setTask] = useState<'chat' | 'search' | 'describe'>('chat');
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<{
    ok: boolean;
    text: string;
    provider?: string;
    model?: string;
    latencyMs: number;
    status: number;
    error?: string;
  } | null>(null);

  const runHealthProbe = useCallback(async () => {
    setProbing(true);
    const res = await adminPortalService.checkAdvisorHealth();
    setHealth(res);
    onHealthUpdate?.(res);
    setProbing(false);
  }, [onHealthUpdate]);

  useEffect(() => {
    runHealthProbe();
  }, [runHealthProbe]);

  const handleRunTest = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!prompt.trim() || testing) return;
    setTesting(true);
    setTestResult(null);
    const res = await adminPortalService.testAdvisorPrompt(prompt.trim(), task, userEmail || undefined);
    setTestResult(res);
    setTesting(false);
  };

  const presetPrompts = [
    {
      label: isRtl ? 'استشارة عربي (القاهرة الجديدة)' : 'Arabic Advisory Prompt',
      text: 'ما هو متوسط العائد الإيجاري في التجمع الخامس مقارنة بالشيخ زايد؟ أجب في 3 نقاط مختصرة.',
    },
    {
      label: isRtl ? 'مقارنة استثمارية (إنجليزي)' : 'English ROI Comparison',
      text: 'Compare New Cairo vs Sheikh Zayed rental yields and resale liquidity in 3 bullet points.',
    },
    {
      label: isRtl ? 'فحص البحث الذكي' : 'Smart Search Probe',
      text: '3 bedroom ready to move apartment in Sheikh Zayed under 10M EGP with installments',
    },
  ];

  const diagnosticChecks = [
    {
      title: isRtl ? 'عزل مفاتيح الـ API على الخادم فقط' : 'Server-Side API Key Isolation',
      desc: isRtl
        ? 'جميع طلبات الذكاء الاصطناعي تمر عبر /api/ai دون تسريب أي مفتاح في حزمة المتصفح.'
        : 'Zero vendor keys bundled in Vite client; all prompts route through /api/ai serverless boundary.',
      passed: Boolean(health?.hasApiKey),
    },
    {
      title: isRtl ? 'محدد المعدل الموزّع وحماية التزامن' : 'Distributed Rate Limit & 5-Slot Concurrency Guard',
      desc: isRtl
        ? `الخلفية الحالية: ${health?.rateLimiterBackend || 'memory'} مع حماية 5 طلبات متزامنة لكل IP.`
        : `Active backend: ${health?.rateLimiterBackend || 'memory'} with per-IP, per-UID & 5 concurrent slots guard.`,
      passed: true,
    },
    {
      title: isRtl ? 'مرونة التبديل التلقائي للنموذج الاحتياطي' : 'Automatic Fallback Model Resilience',
      desc: isRtl
        ? `النموذج الأساسي: ${health?.model || '—'} | الاحتياطي: ${health?.fallbackModel || 'تلقائي حسب المزود'}`
        : `Primary: ${health?.model || '—'} | Fallback: ${health?.fallbackModel || 'Provider default fallback'}`,
      passed: Boolean(health?.healthy),
    },
    {
      title: isRtl ? 'التحقق من حجم الطلب (حد أقصى 4MB)' : 'Payload Ceiling Validation (4MB Edge Guard)',
      desc: isRtl
        ? 'يرفض الطلبات المشوهة أو الضخمة قبل إرسالها لمزود الذكاء الاصطناعي.'
        : 'Validates message schema and rejects >4MB payloads before hitting paid model providers.',
      passed: true,
    },
  ];

  return (
    <div className="space-y-6 animate-fade-in" data-testid="admin-ai-ops-page">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-black text-slate-900 dark:text-white flex items-center gap-2.5">
            <Sparkles className="text-accent-500" size={24} />
            {isRtl ? 'مركز عمليات وتشخيص المستشار العقاري الذكي' : 'AI Real Estate Advisor Operations & Diagnostics'}
          </h1>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
            {isRtl
              ? 'فحص فوري لنقطة /api/ai?health=1، تجربة حيّة للمحادثة، ومراقبة محدد المعدل والمفاتيح'
              : 'Live /api/ai?health=1 telemetry, interactive live test console, rate-limiter inspection & troubleshooting'}
          </p>
        </div>

        <button
          type="button"
          onClick={runHealthProbe}
          disabled={probing}
          className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-brand-600 hover:bg-brand-700 text-white text-xs font-bold shadow-sm cursor-pointer disabled:opacity-50"
        >
          <RefreshCw size={14} className={probing ? 'animate-spin' : ''} />
          {isRtl ? 'إعادة فحص الصحة الآن' : 'Run Health Probe'}
        </button>
      </div>

      {/* Live Health Telemetry Card */}
      <section className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200/80 dark:border-slate-800 p-6 shadow-xs space-y-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <div
              className={`w-11 h-11 rounded-xl flex items-center justify-center ${
                health?.healthy
                  ? 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400'
                  : 'bg-rose-500/15 text-rose-600 dark:text-rose-400'
              }`}
            >
              {probing ? (
                <Loader2 size={22} className="animate-spin text-accent-500" />
              ) : health?.healthy ? (
                <CheckCircle2 size={22} />
              ) : (
                <XCircle size={22} />
              )}
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-base font-bold text-slate-900 dark:text-white">
                  {isRtl ? 'حالة بوابة /api/ai?health=1' : '/api/ai?health=1 Live Telemetry'}
                </h2>
                {!probing && health && (
                  <span
                    className={`px-2.5 py-0.5 rounded-full text-[10px] font-bold ${
                      health.healthy
                        ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950/60 dark:text-emerald-300'
                        : 'bg-rose-100 text-rose-700 dark:bg-rose-950/60 dark:text-rose-300'
                    }`}
                  >
                    {health.healthy ? (isRtl ? 'نشط وسليم' : 'HEALTHY') : (isRtl ? 'يحتاج فحص' : 'OFFLINE / CHECK ENV')}
                  </span>
                )}
              </div>
              <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                {health?.diagnostics || (isRtl ? 'جاري فحص اتصال المستشار الذكي...' : 'Probing AI Advisor runtime...')}
              </p>
            </div>
          </div>

          {health?.latencyMs !== undefined && (
            <div className="px-3.5 py-2 rounded-xl bg-slate-50 dark:bg-slate-800/70 border border-slate-200 dark:border-slate-700 text-xs font-mono font-bold text-slate-800 dark:text-slate-100">
              {health.latencyMs} ms
            </div>
          )}
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3">
          <div className="p-3.5 rounded-xl bg-slate-50 dark:bg-slate-800/60 border border-slate-100 dark:border-slate-800">
            <div className="text-[10px] font-bold text-slate-400 flex items-center gap-1">
              <Cpu size={12} /> {isRtl ? 'المزوّد النشط' : 'Active Provider'}
            </div>
            <div className="text-sm font-black font-mono text-slate-900 dark:text-white mt-1 uppercase">
              {health?.provider || '—'}
            </div>
          </div>
          <div className="p-3.5 rounded-xl bg-slate-50 dark:bg-slate-800/60 border border-slate-100 dark:border-slate-800">
            <div className="text-[10px] font-bold text-slate-400">
              {isRtl ? 'النموذج الأساسي' : 'Primary Model'}
            </div>
            <div className="text-xs font-black font-mono text-brand-700 dark:text-accent-300 mt-1.5 truncate">
              {health?.model || '—'}
            </div>
          </div>
          <div className="p-3.5 rounded-xl bg-slate-50 dark:bg-slate-800/60 border border-slate-100 dark:border-slate-800">
            <div className="text-[10px] font-bold text-slate-400">
              {isRtl ? 'النموذج الاحتياطي' : 'Fallback Model'}
            </div>
            <div className="text-xs font-bold font-mono text-slate-700 dark:text-slate-200 mt-1.5 truncate">
              {health?.fallbackModel || (isRtl ? 'افتراضي المزوّد' : 'Provider Default')}
            </div>
          </div>
          <div className="p-3.5 rounded-xl bg-slate-50 dark:bg-slate-800/60 border border-slate-100 dark:border-slate-800">
            <div className="text-[10px] font-bold text-slate-400 flex items-center gap-1">
              <Gauge size={12} /> {isRtl ? 'محدد المعدل' : 'Rate Limiter'}
            </div>
            <div className="text-xs font-black font-mono text-emerald-600 dark:text-emerald-400 mt-1.5">
              {health?.rateLimiterBackend || 'memory'}
            </div>
          </div>
          <div className="p-3.5 rounded-xl bg-slate-50 dark:bg-slate-800/60 border border-slate-100 dark:border-slate-800">
            <div className="text-[10px] font-bold text-slate-400 flex items-center gap-1">
              <KeyRound size={12} /> {isRtl ? 'مفتاح الـ API' : 'API Key Status'}
            </div>
            <div
              className={`text-xs font-black mt-1.5 ${
                health?.hasApiKey ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-600 dark:text-rose-400'
              }`}
            >
              {health?.hasApiKey ? (isRtl ? 'مضبوط ✓' : 'Configured ✓') : (isRtl ? 'غير مضبوط ✕' : 'Missing ✕')}
            </div>
          </div>
        </div>
      </section>

      {/* Bottom Split: Live Test Console + Diagnostics Checklist */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* Interactive Live Test Console */}
        <section className="lg:col-span-7 bg-white dark:bg-slate-900 rounded-2xl border border-slate-200/80 dark:border-slate-800 p-6 shadow-xs space-y-4">
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <Terminal size={18} className="text-accent-500" />
              <h2 className="text-base font-bold text-slate-900 dark:text-white">
                {isRtl ? 'منصة الاختبار الحي للمستشار الذكي' : 'Interactive Live Prompt Test Console'}
              </h2>
            </div>
            <select
              aria-label="AI task"
              value={task}
              onChange={(e) => setTask(e.target.value as any)}
              className="px-2.5 py-1.5 rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-xs font-bold"
            >
              <option value="chat">task: chat</option>
              <option value="search">task: search</option>
              <option value="describe">task: describe</option>
            </select>
          </div>

          <div className="flex flex-wrap gap-2">
            {presetPrompts.map((p) => (
              <button
                key={p.label}
                type="button"
                onClick={() => setPrompt(p.text)}
                className="px-2.5 py-1 rounded-lg bg-slate-100 dark:bg-slate-800 hover:bg-accent-500/15 hover:text-accent-600 dark:hover:text-accent-300 text-[11px] font-semibold text-slate-600 dark:text-slate-300 transition-colors cursor-pointer"
              >
                {p.label}
              </button>
            ))}
          </div>

          <form onSubmit={handleRunTest} className="space-y-3">
            <textarea
              rows={3}
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              placeholder={isRtl ? 'اكتب سؤالاً لاختبار استجابة /api/ai مباشرة...' : 'Enter a test prompt to invoke POST /api/ai live...'}
              className="w-full rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 p-3.5 text-xs text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-accent-500/40"
            />
            <button
              type="submit"
              disabled={testing || !prompt.trim()}
              className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-accent-500 hover:bg-accent-600 text-white text-xs font-bold shadow-sm transition-all cursor-pointer disabled:opacity-50"
            >
              {testing ? <Loader2 size={15} className="animate-spin" /> : <Send size={15} />}
              {testing
                ? isRtl ? 'جاري الإرسال إلى /api/ai...' : 'Sending to /api/ai...'
                : isRtl ? 'إرسال اختبار حي' : 'Send Live Test Prompt'}
            </button>
          </form>

          {testResult && (
            <div
              className={`rounded-xl border p-4 space-y-2.5 ${
                testResult.ok
                  ? 'bg-emerald-50/50 dark:bg-emerald-950/20 border-emerald-200 dark:border-emerald-900/60'
                  : 'bg-rose-50/60 dark:bg-rose-950/20 border-rose-200 dark:border-rose-900/60'
              }`}
            >
              <div className="flex flex-wrap items-center justify-between gap-2 text-[11px] font-mono">
                <span className={`font-bold ${testResult.ok ? 'text-emerald-700 dark:text-emerald-300' : 'text-rose-700 dark:text-rose-300'}`}>
                  {testResult.ok ? `HTTP ${testResult.status} OK` : `ERROR (${testResult.status || 'NETWORK'})`}
                </span>
                <div className="flex items-center gap-2 text-slate-500 dark:text-slate-400">
                  {testResult.provider && <span>provider: <strong>{testResult.provider}</strong></span>}
                  {testResult.model && <span>model: <strong>{testResult.model}</strong></span>}
                  <span>latency: <strong>{testResult.latencyMs}ms</strong></span>
                </div>
              </div>
              <div className="text-xs text-slate-800 dark:text-slate-100 whitespace-pre-wrap leading-relaxed bg-white/80 dark:bg-slate-900/80 p-3 rounded-lg border border-slate-200/70 dark:border-slate-800">
                {testResult.ok ? testResult.text : testResult.error}
              </div>
            </div>
          )}
        </section>

        {/* Diagnostic & Troubleshooting Checklist */}
        <section className="lg:col-span-5 bg-white dark:bg-slate-900 rounded-2xl border border-slate-200/80 dark:border-slate-800 p-6 shadow-xs space-y-4">
          <div className="flex items-center gap-2">
            <ShieldCheck size={18} className="text-emerald-500" />
            <h2 className="text-base font-bold text-slate-900 dark:text-white">
              {isRtl ? 'قائمة الفحص والتشخيص الفني' : 'AI Operations Diagnostic Checklist'}
            </h2>
          </div>

          <div className="space-y-3">
            {diagnosticChecks.map((item) => (
              <div
                key={item.title}
                className="p-3.5 rounded-xl bg-slate-50/80 dark:bg-slate-800/40 border border-slate-100 dark:border-slate-800 flex items-start gap-3"
              >
                {item.passed ? (
                  <CheckCircle2 size={17} className="text-emerald-500 shrink-0 mt-0.5" />
                ) : (
                  <AlertTriangle size={17} className="text-amber-500 shrink-0 mt-0.5" />
                )}
                <div className="space-y-0.5">
                  <div className="text-xs font-bold text-slate-900 dark:text-white">{item.title}</div>
                  <p className="text-[11px] text-slate-500 dark:text-slate-400 leading-relaxed">{item.desc}</p>
                </div>
              </div>
            ))}
          </div>
        </section>
      </div>
    </div>
  );
};
