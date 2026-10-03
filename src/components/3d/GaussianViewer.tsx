import React, { useState, useEffect, useMemo } from 'react';
import { Canvas } from '@react-three/fiber';
import { OrbitControls } from '@react-three/drei';
import * as THREE from 'three';
import { Sparkles, AlertCircle, Loader2 } from 'lucide-react';
import { ThreeDTour, Room } from '../../types';
import { loadGaussianSplatAsset, ParsedGaussianCloud } from '../../lib/3d/spz-parser';
import { GaussianRenderer } from './GaussianRenderer';

export { GaussianRenderer } from './GaussianRenderer';

interface GaussianViewerProps {
  tour: ThreeDTour;
  activeRoom?: Room;
  isRtl?: boolean;
}

export const GaussianViewer: React.FC<GaussianViewerProps> = ({ tour, activeRoom, isRtl = false }) => {
  const splatUrl = tour?.representation?.gaussianSplat?.url || tour?.assetUrl;
  const [cloud, setCloud] = useState<ParsedGaussianCloud | null>(null);
  const [loading, setLoading] = useState(Boolean(splatUrl));
  const [loadProgress, setLoadProgress] = useState(0);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  useEffect(() => {
    let active = true;

    if (!splatUrl) {
      setLoading(false);
      setErrorMessage(
        isRtl
          ? 'لا يتوفر ملف 3D Gaussian Splatting (.spz / .ply) لهذا العقار حتى الآن.'
          : 'No 3D Gaussian Splatting asset (.spz / .ply) is attached to this tour.'
      );
      return;
    }

    setLoading(true);
    setErrorMessage(null);
    setLoadProgress(15);

    loadGaussianSplatAsset(splatUrl, (percent) => {
      if (active) setLoadProgress(percent);
    })
      .then((parsedCloud) => {
        if (!active) return;
        if (!parsedCloud || parsedCloud.count === 0) {
          setErrorMessage(
            isRtl
              ? 'الملف المُحمل لا يحتوي على نقاط Gaussian حقيقية (0 Gaussians).'
              : 'The loaded 3DGS asset contains zero Gaussian primitives.'
          );
          setLoading(false);
          return;
        }
        setCloud(parsedCloud);
        setLoading(false);
      })
      .catch((err) => {
        if (!active) return;
        setErrorMessage(
          isRtl
            ? `تعذر تحميل ومعالجة نموذج الـ3DGS: ${err.message}`
            : `Failed to parse Gaussian Splatting asset: ${err.message}`
        );
        setLoading(false);
      });

    return () => {
      active = false;
    };
  }, [splatUrl, isRtl]);

  const centerTarget = useMemo(() => {
    if (!cloud) return [0, 1.2, 0] as [number, number, number];
    return [
      (cloud.bounds.min[0] + cloud.bounds.max[0]) / 2,
      (cloud.bounds.min[1] + cloud.bounds.max[1]) / 2,
      (cloud.bounds.min[2] + cloud.bounds.max[2]) / 2,
    ] as [number, number, number];
  }, [cloud]);

  return (
    <div className="w-full h-full relative bg-slate-950 flex flex-col items-center justify-center overflow-hidden">
      {/* HUD Header */}
      <div className="absolute top-4 start-4 z-20 flex items-center gap-2 pointer-events-none">
        <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-slate-900/90 backdrop-blur-md border border-brand-500/40 text-white text-xs font-bold shadow-lg">
          <Sparkles size={14} className="text-brand-400 animate-pulse" />
          <span>{isRtl ? 'عرض مجسمات الـ 3D Gaussian Splats الحقيقية' : 'Real 3D Gaussian Splats (Level 2)'}</span>
        </div>
        {cloud && (
          <div className="px-2.5 py-1 rounded-full bg-black/70 backdrop-blur-md border border-white/10 text-slate-300 text-[11px] font-mono">
            {cloud.count.toLocaleString()} {isRtl ? 'مجسم Gaussian' : 'Gaussians'}
          </div>
        )}
      </div>

      {loading && (
        <div className="absolute inset-0 z-30 flex flex-col items-center justify-center bg-slate-950/85 backdrop-blur-md text-center p-6">
          <Loader2 className="w-10 h-10 text-brand-500 animate-spin mb-4" />
          <p className="text-white text-sm font-semibold mb-2">
            {isRtl ? 'جاري فك ضغط وتحميل مجسمات 3DGS الفراغية...' : 'Streaming & Decoding 3D Gaussian Splats...'}
          </p>
          <div className="w-48 h-1.5 bg-slate-800 rounded-full overflow-hidden">
            <div
              className="h-full bg-brand-500 transition-all duration-300 rounded-full"
              style={{ width: `${Math.max(15, loadProgress)}%` }}
            />
          </div>
          <span className="text-[11px] text-slate-400 mt-2 font-mono">{loadProgress}%</span>
        </div>
      )}

      {errorMessage && !cloud && (
        <div className="max-w-md mx-4 p-6 rounded-2xl bg-slate-900/90 border border-slate-800 backdrop-blur-md text-center shadow-2xl z-20">
          <AlertCircle className="w-10 h-10 text-amber-400 mx-auto mb-3" />
          <h4 className="text-white font-bold text-base mb-1">
            {isRtl ? 'تعذر عرض مجسمات الـ3DGS الحقيقية' : '3DGS Spatial Asset Unavailable'}
          </h4>
          <p className="text-slate-400 text-xs leading-relaxed mb-4">{errorMessage}</p>
          <div className="text-[11px] text-slate-500 bg-slate-950 p-2.5 rounded-xl border border-slate-800/80">
            {isRtl
              ? 'ملاحظة: Hettety لا يعرض نقاطاً عشوائية وهمية عند غياب النموذج الحقيقي لضمان مصداقية العقار.'
              : 'Notice: Hettety strictly avoids rendering synthetic mock points when genuine 3DGS data is absent.'}
          </div>
        </div>
      )}

      {cloud && (
        <Canvas
          camera={{ position: [0, 1.8, 4.0], fov: 60 }}
          gl={{ antialias: true, alpha: false }}
          className="w-full h-full"
        >
          <GaussianRenderer cloud={cloud} activeRoom={activeRoom} />
          <OrbitControls
            enableDamping
            dampingFactor={0.05}
            target={new THREE.Vector3(...centerTarget)}
            maxPolarAngle={Math.PI / 2 - 0.05}
            minDistance={0.5}
            maxDistance={14}
          />
        </Canvas>
      )}
    </div>
  );
};
