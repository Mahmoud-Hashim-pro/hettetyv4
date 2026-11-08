import React, { useState, useEffect, useMemo } from 'react';
import { Canvas } from '@react-three/fiber';
import { OrbitControls } from '@react-three/drei';
import * as THREE from 'three';
import { Sparkles, AlertCircle, Loader2 } from 'lucide-react';
import { ThreeDTour, Room } from '../../types';
import {
  loadGaussianSplatAsset,
  ParsedGaussianCloud,
  GaussianLoadStage,
  isExternalTourUrl,
  isGaussianSplatUrl,
} from '../../lib/3d/spz-parser';
import { GaussianRenderer } from './GaussianRenderer';
import { MAX_RENDERABLE_SPLATS } from '../../lib/3d/splat-sort';

export { GaussianRenderer } from './GaussianRenderer';

interface GaussianViewerProps {
  tour: ThreeDTour;
  activeRoom?: Room;
  isRtl?: boolean;
  isMeasuring?: boolean;
  onPointPicked?: (pt: [number, number, number]) => void;
}

export const GaussianViewer: React.FC<GaussianViewerProps> = ({
  tour,
  activeRoom,
  isRtl = false,
  isMeasuring = false,
  onPointPicked,
}) => {
  const isExternal = isExternalTourUrl(tour?.assetUrl, tour?.source);
  const splatUrl =
    tour?.representation?.gaussianSplat?.url ||
    (!isExternal && isGaussianSplatUrl(tour?.assetUrl) ? tour?.assetUrl : undefined);

  const [cloud, setCloud] = useState<ParsedGaussianCloud | null>(null);
  const [loading, setLoading] = useState(Boolean(splatUrl));
  const [loadProgress, setLoadProgress] = useState<number | null>(null);
  const [loadStage, setLoadStage] = useState<GaussianLoadStage>('downloading');
  const [loadedBytes, setLoadedBytes] = useState<number>(0);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    const abortController = new AbortController();

    if (!splatUrl) {
      setCloud(null);
      setLoading(false);
      setErrorMessage(
        isExternal
          ? isRtl
            ? 'هذا الرابط يخص جولة خارجية (Matterport / Polycam) وليس ملف 3D Gaussian Splatting (.spz / .ply). يرجى استخدام وضع العرض الخارجي.'
            : 'This tour uses an external walkthrough URL (Matterport / Polycam) rather than a binary 3D Gaussian Splatting (.spz / .ply) asset.'
          : isRtl
          ? 'لا يتوفر ملف 3D Gaussian Splatting (.spz / .ply) لهذا العقار حتى الآن.'
          : 'No 3D Gaussian Splatting asset (.spz / .ply) is attached to this tour.'
      );
      return () => {
        active = false;
        abortController.abort();
      };
    }

    setCloud(null);
    setLoading(true);
    setErrorMessage(null);
    setLoadProgress(null);
    setLoadStage('downloading');
    setLoadedBytes(0);

    loadGaussianSplatAsset(
      splatUrl,
      (percent) => {
        if (active) setLoadProgress(percent);
      },
      {
        signal: abortController.signal,
        onStageChange: (detail) => {
          if (!active) return;
          setLoadStage(detail.stage);
          setLoadedBytes(detail.loadedBytes);
          setLoadProgress(detail.percent);
        },
      }
    )
      .then((parsedCloud) => {
        if (!active || abortController.signal.aborted) return;
        if (!parsedCloud || parsedCloud.count === 0) {
          setErrorMessage(
            isRtl
              ? 'الملف المُحمل لا يحتوي على نقاط Gaussian حقيقية (0 Gaussians).'
              : 'The loaded 3DGS asset contains zero Gaussian primitives.'
          );
          setLoading(false);
          return;
        }
        if (parsedCloud.count > MAX_RENDERABLE_SPLATS) {
          setErrorMessage(
            isRtl
              ? `المشهد كبير جداً للعرض في المتصفح (${parsedCloud.count.toLocaleString()} مجسم). الحد الأقصى ${MAX_RENDERABLE_SPLATS.toLocaleString()}. يرجى استخدام نسخة LOD أقل.`
              : `Scene too large to render in the browser (${parsedCloud.count.toLocaleString()} Gaussians; limit ${MAX_RENDERABLE_SPLATS.toLocaleString()}). Publish a lower LOD.`
          );
          setLoading(false);
          return;
        }
        setCloud(parsedCloud);
        setLoading(false);
      })
      .catch((err) => {
        if (!active || abortController.signal.aborted || err?.name === 'AbortError') return;
        setErrorMessage(
          isRtl
            ? `تعذر تحميل ومعالجة نموذج الـ3DGS: ${err.message}`
            : `Failed to parse Gaussian Splatting asset: ${err.message}`
        );
        setLoading(false);
      });

    return () => {
      active = false;
      abortController.abort();
    };
  }, [splatUrl, isExternal, isRtl]);

  const stageLabel = useMemo(() => {
    switch (loadStage) {
      case 'downloading':
        return isRtl ? 'Downloading — جاري تنزيل ملف الـ3DGS...' : 'Downloading 3D Gaussian Splat asset...';
      case 'decoding':
        return isRtl ? 'Decoding — جاري فك ضغط ومعالجة مجسمات الـSPZ...' : 'Decoding SPZ / PLY Gaussian primitives...';
      case 'uploading':
        return isRtl ? 'Uploading to GPU — جاري رفع البيانات لمعالج الرسوميات...' : 'Uploading Gaussian buffers to GPU...';
      case 'ready':
        return isRtl ? 'Ready — جاهز للعرض' : 'Ready';
    }
  }, [loadStage, isRtl]);

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
          <p className="text-white text-sm font-semibold mb-2" data-testid="gaussian-load-stage">
            {stageLabel}
          </p>
          <div className="w-48 h-1.5 bg-slate-800 rounded-full overflow-hidden">
            {loadProgress !== null ? (
              <div
                className="h-full bg-brand-500 transition-all duration-300 rounded-full"
                style={{ width: `${Math.max(0, Math.min(100, loadProgress))}%` }}
              />
            ) : (
              <div className="h-full w-1/3 bg-brand-500 rounded-full animate-pulse" />
            )}
          </div>
          <span className="text-[11px] text-slate-400 mt-2 font-mono" data-testid="gaussian-load-progress">
            {loadProgress !== null
              ? `${loadProgress}%`
              : `${(loadedBytes / (1024 * 1024)).toFixed(1)} MB`}
          </span>
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
          <group
            onPointerDown={(e) => {
              if (isMeasuring && onPointPicked) {
                e.stopPropagation();
                onPointPicked([e.point.x, e.point.y, e.point.z]);
              }
            }}
          >
            <GaussianRenderer cloud={cloud} activeRoom={activeRoom} />
          </group>
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
