import React from 'react';
import { Sparkles, Box, Compass, Ruler, Maximize2, Minimize2, Eye } from 'lucide-react';

export type TourRenderMode = 'gaussian' | 'mesh' | 'panorama' | 'external' | 'relief';

interface TourControlsProps {
  currentMode: TourRenderMode;
  availableModes: TourRenderMode[];
  onModeChange: (mode: TourRenderMode) => void;
  showFloorPlan: boolean;
  onToggleFloorPlan: () => void;
  showMeasure: boolean;
  onToggleMeasure: () => void;
  isFullscreen: boolean;
  onToggleFullscreen: () => void;
  isRtl?: boolean;
}

export const TourControls: React.FC<TourControlsProps> = ({
  currentMode,
  availableModes,
  onModeChange,
  showFloorPlan,
  onToggleFloorPlan,
  showMeasure,
  onToggleMeasure,
  isFullscreen,
  onToggleFullscreen,
  isRtl = false,
}) => {
  return (
    <div className="flex flex-wrap items-center gap-2 bg-black/60 backdrop-blur-md border border-white/10 rounded-2xl p-2 shadow-2xl">
      {/* Mode selectors */}
      {availableModes.includes('gaussian') && (
        <button
          type="button"
          onClick={() => onModeChange('gaussian')}
          className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-bold transition-all cursor-pointer ${
            currentMode === 'gaussian'
              ? 'bg-emerald-600 text-white shadow-md'
              : 'text-white/80 hover:bg-white/10'
          }`}
        >
          <Sparkles size={13} className={currentMode === 'gaussian' ? 'animate-pulse' : ''} />
          <span>{isRtl ? 'تجوال فراغي (3DGS)' : 'Spatial 3DGS'}</span>
        </button>
      )}

      {availableModes.includes('mesh') && (
        <button
          type="button"
          onClick={() => onModeChange('mesh')}
          className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-bold transition-all cursor-pointer ${
            currentMode === 'mesh'
              ? 'bg-emerald-600 text-white shadow-md'
              : 'text-white/80 hover:bg-white/10'
          }`}
        >
          <Box size={13} />
          <span>{isRtl ? 'المجسم الهندسي' : 'Metric Mesh'}</span>
        </button>
      )}

      {availableModes.includes('panorama') && (
        <button
          type="button"
          onClick={() => onModeChange('panorama')}
          className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-bold transition-all cursor-pointer ${
            currentMode === 'panorama'
              ? 'bg-brand-600 text-white shadow-md'
              : 'text-white/80 hover:bg-white/10'
          }`}
        >
          <Compass size={13} />
          <span>360°</span>
        </button>
      )}

      <div className="w-[1px] h-5 bg-white/20 mx-1" />

      {/* Floor plan toggle */}
      <button
        type="button"
        onClick={onToggleFloorPlan}
        className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-xl text-xs font-bold transition-all cursor-pointer ${
          showFloorPlan ? 'bg-white/20 text-white' : 'text-white/70 hover:bg-white/10'
        }`}
        title={isRtl ? 'المخطط الهندسي' : 'Floor Plan'}
      >
        <Compass size={14} />
        <span className="hidden sm:inline">{isRtl ? 'المخطط' : 'Floor Plan'}</span>
      </button>

      {/* Measurement toggle */}
      <button
        type="button"
        onClick={onToggleMeasure}
        className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-xl text-xs font-bold transition-all cursor-pointer ${
          showMeasure ? 'bg-white/20 text-white' : 'text-white/70 hover:bg-white/10'
        }`}
        title={isRtl ? 'أداة القياس' : 'Measure Tool'}
      >
        <Ruler size={14} />
        <span className="hidden sm:inline">{isRtl ? 'قياس' : 'Measure'}</span>
      </button>

      {/* Fullscreen toggle */}
      <button
        type="button"
        onClick={onToggleFullscreen}
        className="p-1.5 rounded-xl text-white/70 hover:bg-white/10 hover:text-white transition-all cursor-pointer ms-auto"
        title={isFullscreen ? (isRtl ? 'تصغير' : 'Exit Fullscreen') : (isRtl ? 'ملء الشاشة' : 'Fullscreen')}
      >
        {isFullscreen ? <Minimize2 size={15} /> : <Maximize2 size={15} />}
      </button>
    </div>
  );
};
