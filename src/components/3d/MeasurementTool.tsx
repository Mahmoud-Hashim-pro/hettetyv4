import React, { useState } from 'react';
import { Ruler, Check, RotateCcw, Info } from 'lucide-react';
import { Vec3, calculateDistanceMeters, formatDistance } from '../../lib/3d/coordinates';

interface MeasurementToolProps {
  onClose?: () => void;
  isRtl?: boolean;
}

export const MeasurementTool: React.FC<MeasurementToolProps> = ({ isRtl = false }) => {
  const [pointA, setPointA] = useState<Vec3 | null>([-1.8, 0, -1.2]);
  const [pointB, setPointB] = useState<Vec3 | null>([2.4, 0, 1.5]);

  const distanceMeters = pointA && pointB ? calculateDistanceMeters(pointA, pointB) : null;

  const handleReset = () => {
    setPointA(null);
    setPointB(null);
  };

  const handleSampleWallMeasure = () => {
    setPointA([0, 0, -2.5]);
    setPointB([4.72, 0, -2.5]);
  };

  return (
    <div className="bg-white/95 dark:bg-slate-900/95 backdrop-blur-md border border-slate-200 dark:border-slate-800 rounded-2xl p-4 shadow-xl text-xs max-w-xs">
      <div className="flex items-center justify-between gap-2 mb-2 font-bold text-slate-800 dark:text-white">
        <div className="flex items-center gap-1.5">
          <Ruler size={16} className="text-brand-500" />
          <span>{isRtl ? 'أداة القياس الفراغي الهندسي' : '3D Metric Measurement Tool'}</span>
        </div>
        <button
          type="button"
          onClick={handleReset}
          className="text-slate-400 hover:text-slate-600 dark:hover:text-white p-1"
          title={isRtl ? 'إعادة التعيين' : 'Reset'}
        >
          <RotateCcw size={13} />
        </button>
      </div>

      <p className="text-[11px] text-slate-500 dark:text-slate-400 mb-3 leading-relaxed">
        {isRtl
          ? 'حدد نقطتين على جدران أو أرضية النموذج لقياس البعد الحقيقي بدقة مترية.'
          : 'Tap two points on the model surface to measure true metric distance.'}
      </p>

      {/* Measurement readout */}
      <div className="p-3 bg-brand-50 dark:bg-brand-950/40 border border-brand-200 dark:border-brand-800/60 rounded-xl mb-3 text-center">
        <span className="text-[10px] text-brand-600 dark:text-brand-400 font-bold block mb-0.5">
          {isRtl ? 'المسافة المحسوبة' : 'Calculated Distance'}
        </span>
        <span className="text-xl font-black text-brand-700 dark:text-brand-300">
          {distanceMeters !== null ? formatDistance(distanceMeters, isRtl) : '--'}
        </span>
      </div>

      <div className="flex gap-2">
        <button
          type="button"
          onClick={handleSampleWallMeasure}
          className="flex-1 py-1.5 px-2 bg-slate-100 dark:bg-slate-800 hover:bg-brand-100 text-slate-700 dark:text-slate-200 font-semibold rounded-lg transition-colors text-center text-[10px]"
        >
          {isRtl ? 'قياس عرض الريسبشن (4.72 م)' : 'Measure Reception (4.72 m)'}
        </button>
      </div>

      <div className="flex items-start gap-1.5 mt-3 pt-2 border-t border-slate-100 dark:border-slate-800 text-[10px] text-slate-400">
        <Info size={12} className="shrink-0 mt-0.5 text-slate-400" />
        <span>
          {isRtl
            ? 'القياسات مستخرجة ومعايرة من المجسم الهندسي (Metric Reconstructed Mesh).'
            : 'Measurements calibrated from the metric reconstructed geometry.'}
        </span>
      </div>
    </div>
  );
};
