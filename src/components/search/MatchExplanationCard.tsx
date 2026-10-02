import React from 'react';
import { Sparkles, CheckCircle2 } from 'lucide-react';
import { RankedPropertyResult } from '../../types';

interface MatchExplanationCardProps {
  result: RankedPropertyResult;
  isRtl?: boolean;
}

export const MatchExplanationCard: React.FC<MatchExplanationCardProps> = ({
  result,
  isRtl = false,
}) => {
  const { relevanceScore, matchReasons, explanationEn, explanationAr } = result;

  const scoreColor =
    relevanceScore >= 85
      ? 'bg-emerald-500 text-white'
      : relevanceScore >= 70
      ? 'bg-brand-500 text-white'
      : 'bg-amber-500 text-white';

  return (
    <div className="bg-brand-50/60 dark:bg-brand-950/20 border border-brand-200/80 dark:border-brand-900/40 rounded-2xl p-3 space-y-2 text-start">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-1.5 text-xs font-bold text-brand-700 dark:text-brand-300">
          <Sparkles size={13} className="text-brand-500" />
          <span>{isRtl ? 'مطابقة ذكية للطلب' : 'Grounded AI Match'}</span>
        </div>
        <span className={`text-[11px] font-black px-2 py-0.5 rounded-full shadow-xs ${scoreColor}`}>
          {relevanceScore}% {isRtl ? 'مطابقة' : 'Match'}
        </span>
      </div>

      <p className="text-xs text-slate-700 dark:text-slate-300 leading-relaxed font-medium">
        {isRtl ? explanationAr : explanationEn}
      </p>

      {matchReasons.length > 0 && (
        <div className="flex items-center gap-1.5 flex-wrap pt-1 border-t border-brand-100 dark:border-brand-900/30">
          {matchReasons.slice(0, 4).map((reason, idx) => (
            <span
              key={idx}
              className="inline-flex items-center gap-1 text-[10px] font-semibold text-slate-600 dark:text-slate-400 bg-white/80 dark:bg-slate-900/80 px-2 py-0.5 rounded-md border border-slate-200/60 dark:border-slate-800"
            >
              <CheckCircle2 size={10} className="text-emerald-500" />
              <span>{isRtl ? reason.ar : reason.en}</span>
            </span>
          ))}
        </div>
      )}
    </div>
  );
};
