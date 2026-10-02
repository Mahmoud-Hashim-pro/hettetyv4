import React from 'react';
import { Loader2, CheckCircle2, AlertCircle, Sparkles, Layers, Cpu, Compass, HardDrive } from 'lucide-react';
import { ReconstructionJob, ReconstructionJobStatus } from '../../types';

interface ReconstructionProgressProps {
  job: ReconstructionJob;
  isRtl?: boolean;
}

const STAGES: Array<{ status: ReconstructionJobStatus; labelEn: string; labelAr: string; icon: React.ComponentType<{ size?: number; className?: string }> }> = [
  { status: 'VALIDATING', labelEn: 'Validating Quality', labelAr: 'فحص جودة اللقطات', icon: Compass },
  { status: 'UPLOADING', labelEn: 'Uploading Media', labelAr: 'رفع الوسائط', icon: HardDrive },
  { status: 'RECONSTRUCTING', labelEn: 'COLMAP Scene Alignment', labelAr: 'محاذاة المشهد الفراغي', icon: Layers },
  { status: 'TRAINING', labelEn: 'Training 3D Gaussians', labelAr: 'تدريب النموذج ثلاثي الأبعاد', icon: Cpu },
  { status: 'OPTIMIZING', labelEn: 'SPZ Progressive Compression', labelAr: 'الضغط والتحسين الفائق', icon: Sparkles },
  { status: 'PUBLISHING', labelEn: 'Publishing Spatial Tour', labelAr: 'نشر التجوال الفراغي', icon: CheckCircle2 },
];

export const ReconstructionProgress: React.FC<ReconstructionProgressProps> = ({ job, isRtl = false }) => {
  const isFailed = job.status === 'FAILED';
  const isReady = job.status === 'READY';
  const currentStageIndex = STAGES.findIndex(s => s.status === job.status);

  return (
    <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-3xl p-6 shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
        <div>
          <span className="text-[10px] font-black uppercase tracking-wider px-2.5 py-0.5 rounded-full bg-brand-100 text-brand-700 dark:bg-brand-900/40 dark:text-brand-300">
            {isRtl ? 'معالجة النموذج الفراغي' : '3D Reconstruction Pipeline'}
          </span>
          <h3 className="text-base font-bold text-slate-900 dark:text-white mt-1">
            {isReady
              ? (isRtl ? 'اكتمل بناء النموذج ثلاثي الأبعاد بنجاح!' : '3D Spatial Reconstruction Ready!')
              : isFailed
              ? (isRtl ? 'تعذر إكمال المعالجة الفراغية' : 'Reconstruction Failed')
              : (isRtl ? 'جاري بناء وتدريب النموذج الفراغي...' : 'Building & Optimizing 3D Scene...')}
          </h3>
        </div>
        <div className="text-end">
          <span className="text-2xl font-black text-brand-600 dark:text-brand-400">
            {job.progress}%
          </span>
        </div>
      </div>

      {/* Progress Bar */}
      <div className="w-full h-2.5 bg-slate-100 dark:bg-slate-800 rounded-full overflow-hidden mb-6">
        <div
          className={`h-full transition-all duration-500 rounded-full ${
            isFailed
              ? 'bg-red-500'
              : isReady
              ? 'bg-emerald-500'
              : 'bg-gradient-to-r from-brand-500 to-emerald-500'
          }`}
          style={{ width: `${Math.max(5, job.progress)}%` }}
        />
      </div>

      {/* Stages list */}
      <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-3 mb-4">
        {STAGES.map((s, index) => {
          const Icon = s.icon;
          const isCurrent = job.status === s.status;
          const isPast = isReady || (currentStageIndex > index);

          return (
            <div
              key={s.status}
              className={`p-3 rounded-2xl border text-xs flex items-center gap-2.5 transition-all ${
                isCurrent
                  ? 'bg-brand-50 dark:bg-brand-900/20 border-brand-300 dark:border-brand-700 shadow-sm'
                  : isPast
                  ? 'bg-slate-50 dark:bg-slate-800/40 border-slate-200 dark:border-slate-800 text-slate-600 dark:text-slate-400'
                  : 'bg-transparent border-slate-100 dark:border-slate-800 text-slate-400 opacity-60'
              }`}
            >
              <div
                className={`p-1.5 rounded-xl ${
                  isCurrent
                    ? 'bg-brand-600 text-white'
                    : isPast
                    ? 'bg-emerald-500 text-white'
                    : 'bg-slate-200 dark:bg-slate-800 text-slate-400'
                }`}
              >
                {isCurrent ? <Loader2 size={13} className="animate-spin" /> : isPast ? <CheckCircle2 size={13} /> : <Icon size={13} />}
              </div>
              <span className={`font-semibold ${isCurrent ? 'text-brand-900 dark:text-white font-bold' : ''}`}>
                {isRtl ? s.labelAr : s.labelEn}
              </span>
            </div>
          );
        })}
      </div>

      {/* Error state */}
      {isFailed && (
        <div className="flex items-start gap-2.5 p-3.5 bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-800/50 rounded-2xl text-xs text-red-700 dark:text-red-300">
          <AlertCircle size={16} className="shrink-0 mt-0.5 text-red-600" />
          <div>
            <p className="font-bold mb-0.5">
              {job.errorCode ? `[${job.errorCode}] ` : ''}
              {isRtl ? (job.errorMessageAr || job.errorMessage || 'حدث خطأ أثناء معالجة النموذج') : (job.errorMessage || 'An error occurred during reconstruction')}
            </p>
            <p className="text-[11px] text-red-600 dark:text-red-400">
              {isRtl
                ? 'يرجى التأكد من تصوير لقطات إضافية مع تداخل 70%+ وإعادة المحاولة.'
                : 'Please ensure additional overlapping photos (70%+) and try again.'}
            </p>
          </div>
        </div>
      )}
    </div>
  );
};
