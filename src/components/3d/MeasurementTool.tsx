import React, { useState } from 'react';
import { Ruler, RotateCcw, Info, AlertTriangle, Crosshair, MapPin } from 'lucide-react';
import { Vec3, calculateDistanceMeters, formatDistance } from '../../lib/3d/coordinates';

interface MeasurementToolProps {
  onClose?: () => void;
  isCalibrated?: boolean;
  isRtl?: boolean;
  selectedPoints?: [Vec3 | null, Vec3 | null];
  onPointSelect?: (point: Vec3) => void;
}

export const MeasurementTool: React.FC<MeasurementToolProps> = ({
  isCalibrated = true,
  isRtl = false,
  selectedPoints: controlledPoints,
  onPointSelect,
}) => {
  const [internalPointA, setInternalPointA] = useState<Vec3 | null>([-1.8, 0, -1.2]);
  const [internalPointB, setInternalPointB] = useState<Vec3 | null>([2.4, 0, 1.5]);

  const pointA = controlledPoints ? controlledPoints[0] : internalPointA;
  const pointB = controlledPoints ? controlledPoints[1] : internalPointB;

  const distanceMeters = pointA && pointB ? calculateDistanceMeters(pointA, pointB) : null;

  const handleReset = () => {
    setInternalPointA(null);
    setInternalPointB(null);
  };

  const handleSampleWallMeasure = () => {
    const p1: Vec3 = [0, 0, -2.5];
    const p2: Vec3 = [4.72, 0, -2.5];
    setInternalPointA(p1);
    setInternalPointB(p2);
    if (onPointSelect) {
      onPointSelect(p1);
      onPointSelect(p2);
    }
  };

  const handleSampleDoorMeasure = () => {
    const p1: Vec3 = [1.2, 0, 0];
    const p2: Vec3 = [2.1, 0, 0];
    setInternalPointA(p1);
    setInternalPointB(p2);
    if (onPointSelect) {
      onPointSelect(p1);
      onPointSelect(p2);
    }
  };

  const formatCoord = (p: Vec3 | null) => {
    if (!p) return '--';
    return `[${p[0].toFixed(2)}, ${p[1].toFixed(2)}, ${p[2].toFixed(2)}]`;
  };

  const pickingStep = !pointA ? 1 : !pointB ? 2 : 0;

  return (
    <div className="bg-white/95 dark:bg-slate-900/95 backdrop-blur-md border border-slate-200 dark:border-slate-800 rounded-2xl p-4 shadow-xl text-xs max-w-xs select-none">
      <div className="flex items-center justify-between gap-2 mb-2 font-bold text-slate-800 dark:text-white">
        <div className="flex items-center gap-1.5">
          <Ruler size={16} className="text-brand-500" />
          <span>{isRtl ? 'أداة القياس الفراغي الهندسي' : '3D Metric Measurement Tool'}</span>
        </div>
        <button
          type="button"
          onClick={handleReset}
          className="text-slate-400 hover:text-slate-600 dark:hover:text-white p-1 cursor-pointer"
          title={isRtl ? 'إعادة التعيين' : 'Reset'}
        >
          <RotateCcw size={13} />
        </button>
      </div>

      {!isCalibrated && (
        <div className="flex items-start gap-1.5 p-2 bg-amber-500/10 border border-amber-500/30 rounded-xl mb-3 text-[10px] text-amber-600 dark:text-amber-400 leading-normal">
          <AlertTriangle size={13} className="shrink-0 mt-0.5 text-amber-500" />
          <span>
            {isRtl
              ? 'تنبيه: النموذج غير معاير هندسياً بمقياس متري حقيقي (1:1). القياسات المعروضة نسبية وتقريبية فقط.'
              : 'Notice: Model geometry is not metric-calibrated (1:1). Measurements are relative and approximate.'}
          </span>
        </div>
      )}

      {/* Picking status badge */}
      <div className="flex items-center gap-1.5 mb-2.5 px-2 py-1 bg-slate-100 dark:bg-slate-800/70 rounded-lg text-[10px] text-slate-600 dark:text-slate-300">
        <Crosshair size={12} className={pickingStep > 0 ? 'text-brand-500 animate-pulse' : 'text-slate-400'} />
        <span>
          {pickingStep === 1
            ? isRtl ? 'بانتظار تحديد النقطة الأولى (أ)...' : 'Select starting point (A)...'
            : pickingStep === 2
            ? isRtl ? 'تم تحديد (أ). حدد النقطة الثانية (ب)...' : 'Point (A) set. Select target point (B)...'
            : isRtl ? 'تم القياس بنجاح بين النقطتين' : 'Measured between selected points'}
        </span>
      </div>

      {/* Coordinate inspection */}
      <div className="grid grid-cols-2 gap-1.5 mb-3 text-[10px] font-mono">
        <div className={`p-1.5 rounded-lg border ${pointA ? 'bg-brand-50/50 dark:bg-brand-950/20 border-brand-200 dark:border-brand-900/50 text-brand-700 dark:text-brand-300' : 'bg-slate-50 dark:bg-slate-800/40 border-slate-200 dark:border-slate-800 text-slate-400'}`}>
          <div className="flex items-center gap-1 mb-0.5 font-bold">
            <MapPin size={10} className="text-brand-500" />
            <span>{isRtl ? 'نقطة أ' : 'Point A'}</span>
          </div>
          <div className="truncate">{formatCoord(pointA)}</div>
        </div>
        <div className={`p-1.5 rounded-lg border ${pointB ? 'bg-brand-50/50 dark:bg-brand-950/20 border-brand-200 dark:border-brand-900/50 text-brand-700 dark:text-brand-300' : 'bg-slate-50 dark:bg-slate-800/40 border-slate-200 dark:border-slate-800 text-slate-400'}`}>
          <div className="flex items-center gap-1 mb-0.5 font-bold">
            <MapPin size={10} className="text-emerald-500" />
            <span>{isRtl ? 'نقطة ب' : 'Point B'}</span>
          </div>
          <div className="truncate">{formatCoord(pointB)}</div>
        </div>
      </div>

      {/* Measurement readout */}
      <div className="p-3 bg-brand-50 dark:bg-brand-950/40 border border-brand-200 dark:border-brand-800/60 rounded-xl mb-3 text-center">
        <span className="text-[10px] text-brand-600 dark:text-brand-400 font-bold block mb-0.5">
          {isRtl ? 'المسافة المحسوبة' : 'Calculated Distance'}
          {!isCalibrated && (
            <span className="ms-1 text-[9px] text-amber-500 font-normal">
              {isRtl ? '(تقريبي)' : '(approx.)'}
            </span>
          )}
        </span>
        <span className="text-xl font-black text-brand-700 dark:text-brand-300">
          {distanceMeters !== null ? formatDistance(distanceMeters, isRtl) : '--'}
        </span>
      </div>

      <div className="flex gap-2 mb-2">
        <button
          type="button"
          onClick={handleSampleWallMeasure}
          className="flex-1 py-1.5 px-2 bg-slate-100 dark:bg-slate-800 hover:bg-brand-100 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 font-semibold rounded-lg transition-colors text-center text-[10px] cursor-pointer"
        >
          {isRtl ? 'قياس عرض الريسبشن (4.72 م)' : 'Measure Reception (4.72 m)'}
        </button>
        <button
          type="button"
          onClick={handleSampleDoorMeasure}
          className="flex-1 py-1.5 px-2 bg-slate-100 dark:bg-slate-800 hover:bg-brand-100 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 font-semibold rounded-lg transition-colors text-center text-[10px] cursor-pointer"
        >
          {isRtl ? 'قياس فتحة الباب (0.90 م)' : 'Measure Door (0.90 m)'}
        </button>
      </div>

      <div className="flex items-start gap-1.5 mt-2.5 pt-2 border-t border-slate-100 dark:border-slate-800 text-[10px] text-slate-400">
        <Info size={12} className="shrink-0 mt-0.5 text-slate-400" />
        <span>
          {isCalibrated
            ? isRtl
              ? 'القياسات مستخرجة ومعايرة من المجسم الهندسي (Metric Reconstructed Geometry).'
              : 'Measurements calibrated from the verified metric reconstructed geometry.'
            : isRtl
            ? 'غير معايرة: لا تستخدم هذه الأبعاد في التعاقدات الرسمية أو التصنيع.'
            : 'Uncalibrated: do not use for architectural contracting or construction specs.'}
        </span>
      </div>
    </div>
  );
};
