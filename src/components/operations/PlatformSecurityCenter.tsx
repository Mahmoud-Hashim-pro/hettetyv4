import React from 'react';
import { evaluatePlatformSecurityHealth } from '../../services/analytics/market-intelligence-service';
import { ShieldCheck, Lock, Activity, Server, Cpu, CheckCircle2, AlertTriangle } from 'lucide-react';

interface PlatformSecurityCenterProps {
  isRtl?: boolean;
}

export const PlatformSecurityCenter: React.FC<PlatformSecurityCenterProps> = ({
  isRtl = false,
}) => {
  const health = evaluatePlatformSecurityHealth();

  return (
    <div
      data-testid="platform-security-center"
      className="space-y-6"
      dir={isRtl ? 'rtl' : 'ltr'}
    >
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 bg-white dark:bg-slate-900 p-6 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-sm">
        <div className="flex items-center gap-3">
          <div className="w-12 h-12 rounded-xl bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 flex items-center justify-center">
            <ShieldCheck size={28} />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h2 className="text-xl font-bold text-slate-900 dark:text-white">
                {isRtl ? 'مركز الأمن السيبراني وحوكمة المنصة' : 'HETTETY Security & Governance Center'}
              </h2>
              <span className="text-xs bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-400 border border-emerald-500/30 px-2 py-0.5 rounded-full font-bold">
                {isRtl ? 'حماية مشددة نشطة' : 'SOC-2 / Zero Trust Active'}
              </span>
            </div>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
              {isRtl
                ? 'مراقبة فورية لعزل البيانات المشفرة، حماية حسابات الضمان، ونزاهة سجلات التدقيق'
                : 'Real-time telemetry for cryptographic isolation, escrow guarantees, and immutable audits.'}
            </p>
          </div>
        </div>

        {/* Uptime Badge */}
        <div className="flex items-center gap-3 bg-slate-50 dark:bg-slate-800/60 px-4 py-2.5 rounded-xl border border-slate-200/60 dark:border-slate-700/60">
          <Activity size={20} className="text-emerald-500 animate-pulse" />
          <div>
            <div className="text-xs font-bold text-slate-900 dark:text-white">
              {health.uptimePercent}% Uptime
            </div>
            <div className="text-[10px] text-slate-400">
              {isRtl ? 'كفاءة تشغيلية مستمرة' : 'High Availability SLA'}
            </div>
          </div>
        </div>
      </div>

      {/* Operational Infrastructure Stats */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="bg-white dark:bg-slate-900 p-4 rounded-xl border border-slate-200 dark:border-slate-800 flex items-center gap-3">
          <Cpu className="text-purple-500 shrink-0" size={24} />
          <div>
            <div className="text-xs text-slate-500 dark:text-slate-400 font-semibold">
              {isRtl ? 'طابور معالجة نماذج 3D' : 'GPU Worker Queue Depth'}
            </div>
            <div className="text-lg font-bold text-slate-900 dark:text-white">
              {health.gpuWorkerQueueDepth} {isRtl ? 'مهام قيد المعالجة' : 'active jobs'}
            </div>
          </div>
        </div>

        <div className="bg-white dark:bg-slate-900 p-4 rounded-xl border border-slate-200 dark:border-slate-800 flex items-center gap-3">
          <Server className="text-blue-500 shrink-0" size={24} />
          <div>
            <div className="text-xs text-slate-500 dark:text-slate-400 font-semibold">
              {isRtl ? 'زمن إعادة البناء الفراغي (P95)' : '3D Reconstruction Latency (P95)'}
            </div>
            <div className="text-lg font-bold text-slate-900 dark:text-white">
              {health.p95ReconstructionMinutes} {isRtl ? 'دقائق' : 'minutes'}
            </div>
          </div>
        </div>

        <div className="bg-white dark:bg-slate-900 p-4 rounded-xl border border-slate-200 dark:border-slate-800 flex items-center gap-3">
          <Lock className="text-amber-500 shrink-0" size={24} />
          <div>
            <div className="text-xs text-slate-500 dark:text-slate-400 font-semibold">
              {isRtl ? 'أموال الضمان المحتجزة (Escrow)' : 'Active Escrow Liquidity'}
            </div>
            <div className="text-lg font-bold text-amber-600 dark:text-amber-400">
              {(health.activeEscrowVolumeEGP / 1000000).toFixed(1)}M EGP
            </div>
          </div>
        </div>
      </div>

      {/* Security Audit Checks Grid */}
      <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 p-6 shadow-sm space-y-4">
        <h3 className="font-bold text-sm text-slate-900 dark:text-white">
          {isRtl ? 'سجل الامتثال والتحقق الأمني الآلي' : 'Automated Security Invariant Checks'}
        </h3>

        <div className="space-y-3">
          {health.securityChecks.map((check) => (
            <div
              key={check.id}
              className="p-4 rounded-xl border border-slate-100 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-800/30 flex items-start gap-3"
            >
              <CheckCircle2 className="text-emerald-500 shrink-0 mt-0.5" size={18} />
              <div className="flex-1">
                <div className="flex items-center justify-between">
                  <span className="font-bold text-xs text-slate-900 dark:text-white">
                    [{check.id}] {isRtl ? check.titleAr : check.title}
                  </span>
                  <span className="text-[10px] font-bold px-2 py-0.5 rounded bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300">
                    PASSED
                  </span>
                </div>
                <p className="text-xs text-slate-600 dark:text-slate-400 mt-1">
                  {isRtl ? check.detailsAr : check.details}
                </p>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};
