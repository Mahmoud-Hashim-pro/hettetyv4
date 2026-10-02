import React, { useState, useEffect, useRef, useMemo } from 'react';
import { Canvas, useFrame } from '@react-three/fiber';
import { OrbitControls } from '@react-three/drei';
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { Box, CheckCircle2, AlertTriangle, AlertCircle, Loader2, Ruler } from 'lucide-react';
import { ThreeDTour, Room } from '../../types';

interface MeshViewerProps {
  tour: ThreeDTour;
  activeRoom?: Room;
  isRtl?: boolean;
}

interface LoadedMeshSceneProps {
  scene: THREE.Group;
  wireframe: boolean;
  activeRoom?: Room;
  bounds: THREE.Box3;
}

const LoadedMeshScene: React.FC<LoadedMeshSceneProps> = ({ scene, wireframe, activeRoom, bounds }) => {
  const clonedScene = useMemo(() => {
    const clone = scene.clone(true);
    clone.traverse((child) => {
      if ((child as THREE.Mesh).isMesh) {
        const mesh = child as THREE.Mesh;
        if (Array.isArray(mesh.material)) {
          mesh.material = mesh.material.map((m) => {
            const mat = m.clone();
            (mat as any).wireframe = wireframe;
            return mat;
          });
        } else if (mesh.material) {
          const mat = mesh.material.clone();
          (mat as any).wireframe = wireframe;
          mesh.material = mat;
        }
      }
    });
    return clone;
  }, [scene, wireframe]);

  useFrame((state) => {
    if (activeRoom?.camera?.position) {
      const [tx, ty, tz] = activeRoom.camera.position;
      state.camera.position.lerp(new THREE.Vector3(tx, ty, tz), 0.05);
    }
  });

  return (
    <>
      <ambientLight intensity={1.2} />
      <directionalLight position={[6, 12, 6]} intensity={1.8} />
      <directionalLight position={[-6, 8, -6]} intensity={0.9} color="#94a3b8" />

      <primitive object={clonedScene} />

      {/* Active room spatial boundary box if waypoint provided */}
      {activeRoom?.position && (
        <mesh position={activeRoom.position}>
          <boxGeometry args={[activeRoom.dimensions?.width || 3, activeRoom.dimensions?.height || 2.8, activeRoom.dimensions?.length || 3]} />
          <meshStandardMaterial
            color="#10b981"
            transparent
            opacity={0.2}
            wireframe
          />
        </mesh>
      )}

      {/* Ground helper grid */}
      <gridHelper
        args={[24, 24, '#10b981', '#334155']}
        position={[0, bounds.min.y - 0.01, 0]}
      />
    </>
  );
};

export const MeshViewer: React.FC<MeshViewerProps> = ({ tour, activeRoom, isRtl = false }) => {
  const meshUrl = tour?.representation?.mesh?.url;
  const isCalibrated = Boolean(tour?.representation?.mesh?.isCalibratedMetric);

  const [wireframe, setWireframe] = useState(false);
  const [loadedScene, setLoadedScene] = useState<THREE.Group | null>(null);
  const [bounds, setBounds] = useState<THREE.Box3>(new THREE.Box3());
  const [loading, setLoading] = useState(Boolean(meshUrl));
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;

    if (!meshUrl) {
      setLoading(false);
      setError(
        isRtl
          ? 'لا يتوفر ملف مجسم هندسي متري (.glb) لهذا العقار حتى الآن.'
          : 'No Metric 3D Mesh asset (.glb) is attached to this tour.'
      );
      return;
    }

    setLoading(true);
    setError(null);

    const loader = new GLTFLoader();
    loader.load(
      meshUrl,
      (gltf) => {
        if (!active) return;
        const box = new THREE.Box3().setFromObject(gltf.scene);
        setBounds(box);
        setLoadedScene(gltf.scene);
        setLoading(false);
      },
      undefined,
      (err: any) => {
        if (!active) return;
        const msg = err && typeof err === 'object' && 'message' in err ? err.message : 'GLB parse error';
        setError(
          isRtl
            ? `تعذر تحميل المجسم المتري: ${msg}`
            : `Failed to load Metric Mesh: ${msg}`
        );
        setLoading(false);
      }
    );

    return () => {
      active = false;
    };
  }, [meshUrl, isRtl]);

  const center = useMemo(() => {
    const c = new THREE.Vector3();
    bounds.getCenter(c);
    return [c.x, c.y, c.z] as [number, number, number];
  }, [bounds]);

  return (
    <div className="w-full h-full relative bg-slate-900 flex flex-col items-center justify-center overflow-hidden">
      {/* Top HUD Controls */}
      <div className="absolute top-4 start-4 end-4 z-20 flex items-center justify-between pointer-events-none">
        {/* Metric Calibration Status Badge */}
        <div className="flex items-center gap-2 pointer-events-auto">
          {isCalibrated ? (
            <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-emerald-950/80 backdrop-blur-md border border-emerald-500/40 text-emerald-300 text-xs font-bold shadow-lg">
              <CheckCircle2 size={14} className="text-emerald-400" />
              <span>{isRtl ? 'مجسم متري معاير (مقياس 1:1)' : 'Metric Mesh (1:1 Calibrated)'}</span>
            </div>
          ) : (
            <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-amber-950/80 backdrop-blur-md border border-amber-500/40 text-amber-300 text-xs font-bold shadow-lg">
              <AlertTriangle size={14} className="text-amber-400" />
              <span>{isRtl ? 'مجسم غير معاير (أبعاد نسبية)' : 'Uncalibrated Mesh (Relative Scale)'}</span>
            </div>
          )}
        </div>

        {/* View mode toggle */}
        {loadedScene && (
          <div className="pointer-events-auto flex items-center gap-2">
            <button
              type="button"
              onClick={() => setWireframe(!wireframe)}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-black/60 hover:bg-black/80 text-white text-xs font-bold backdrop-blur-sm border border-white/20 transition-all cursor-pointer shadow-lg"
            >
              <Box size={14} />
              <span>
                {wireframe
                  ? (isRtl ? 'عرض مجسم مصمت' : 'Shaded Mode')
                  : (isRtl ? 'عرض شبكي (Wireframe)' : 'Wireframe Mode')}
              </span>
            </button>
          </div>
        )}
      </div>

      {loading && (
        <div className="absolute inset-0 z-30 flex flex-col items-center justify-center bg-slate-950/80 backdrop-blur-sm text-center p-6">
          <Loader2 className="w-10 h-10 text-emerald-500 animate-spin mb-4" />
          <p className="text-white text-sm font-semibold mb-2">
            {isRtl ? 'جاري تحميل المجسم الهندسي المتري (GLB)...' : 'Loading Calibrated Metric 3D Mesh...'}
          </p>
        </div>
      )}

      {error && !loadedScene && (
        <div className="max-w-md mx-4 p-6 rounded-2xl bg-slate-900/90 border border-slate-800 backdrop-blur-md text-center shadow-2xl z-20">
          <AlertCircle className="w-10 h-10 text-amber-400 mx-auto mb-3" />
          <h4 className="text-white font-bold text-base mb-1">
            {isRtl ? 'المجسم الهندسي غير متاح' : 'Metric Mesh Unavailable'}
          </h4>
          <p className="text-slate-400 text-xs leading-relaxed mb-4">{error}</p>
          <div className="text-[11px] text-slate-500 bg-slate-950 p-2.5 rounded-xl border border-slate-800/80">
            {isRtl
              ? 'ملاحظة: Hettety يعتمد حصرياً على الهندسة المستخرجة من إعادة البناء الحقيقية، ولا يعرض غرفاً وهمية مولدة عشوائياً.'
              : 'Notice: Hettety strictly loads genuine reconstructed geometry and rejects synthetic demo rooms.'}
          </div>
        </div>
      )}

      {loadedScene && (
        <Canvas camera={{ position: [0, 2.5, 5], fov: 60 }} className="w-full h-full">
          <LoadedMeshScene
            scene={loadedScene}
            wireframe={wireframe}
            activeRoom={activeRoom}
            bounds={bounds}
          />
          <OrbitControls
            enableDamping
            dampingFactor={0.05}
            target={new THREE.Vector3(...center)}
          />
        </Canvas>
      )}
    </div>
  );
};
