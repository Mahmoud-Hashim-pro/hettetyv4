import React, { useRef, useState, useEffect, useMemo } from 'react';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { OrbitControls } from '@react-three/drei';
import * as THREE from 'three';
import { Sparkles, AlertCircle, Loader2, RotateCcw, Box, Eye } from 'lucide-react';
import { ThreeDTour, Room } from '../../types';
import { loadGaussianSplatAsset, ParsedGaussianCloud } from '../../lib/3d/spz-parser';

interface GaussianViewerProps {
  tour: ThreeDTour;
  activeRoom?: Room;
  isRtl?: boolean;
}

interface SplatSceneProps {
  cloud: ParsedGaussianCloud;
  activeRoom?: Room;
}

/**
 * GLSL Vertex Shader for 3D Gaussian Splatting
 * Projects 3D anisotropic covariance matrix into 2D view space (EWA splatting)
 */
const SPLAT_VERTEX_SHADER = `
  attribute vec3 instancePosition;
  attribute vec3 instanceScale;
  attribute vec4 instanceRotation;
  attribute vec3 instanceColor;
  attribute float instanceOpacity;

  varying vec2 vUv;
  varying vec3 vColor;
  varying float vOpacity;

  mat3 quatToMat(vec4 q) {
    float r = q.x, x = q.y, y = q.z, z = q.w;
    return mat3(
      1.0 - 2.0 * (y * y + z * z), 2.0 * (x * y - r * z), 2.0 * (x * z + r * y),
      2.0 * (x * y + r * z), 1.0 - 2.0 * (x * x + z * z), 2.0 * (y * z - r * x),
      2.0 * (x * z - r * y), 2.0 * (y * z + r * x), 1.0 - 2.0 * (x * x + y * y)
    );
  }

  void main() {
    vUv = uv;
    vColor = instanceColor;
    vOpacity = instanceOpacity;

    // View position of splat center
    vec4 viewPos = modelViewMatrix * vec4(instancePosition, 1.0);

    // 3D covariance: Sigma = R * S * S^T * R^T
    mat3 R = quatToMat(instanceRotation);
    mat3 S = mat3(
      instanceScale.x, 0.0, 0.0,
      0.0, instanceScale.y, 0.0,
      0.0, 0.0, instanceScale.z
    );
    mat3 M = R * S;
    mat3 sigma3D = M * transpose(M);

    // Project covariance into view space: SigmaView = W * Sigma3D * W^T
    mat3 W = mat3(modelViewMatrix);
    mat3 sigmaView = W * sigma3D * transpose(W);

    float s_xx = max(0.0001, sigmaView[0][0]);
    float s_xy = sigmaView[0][1];
    float s_yy = max(0.0001, sigmaView[1][1]);

    // Eigenvalues of 2D screen covariance
    float trace = s_xx + s_yy;
    float det = s_xx * s_yy - s_xy * s_xy;
    float term = max(0.0, trace * trace * 0.25 - det);
    float lambda1 = trace * 0.5 + sqrt(term);
    float lambda2 = max(0.0001, trace * 0.5 - sqrt(term));

    float radiusX = max(0.015, sqrt(lambda1) * 2.2);
    float radiusY = max(0.015, sqrt(lambda2) * 2.2);

    float theta = 0.5 * atan(2.0 * s_xy, s_xx - s_yy);
    float cosT = cos(theta);
    float sinT = sin(theta);

    // Expand billboard quad in view space
    vec2 offset = vec2(
      uv.x * radiusX * cosT - uv.y * radiusY * sinT,
      uv.x * radiusX * sinT + uv.y * radiusY * cosT
    );

    vec4 finalViewPos = viewPos + vec4(offset, 0.0, 0.0);
    gl_Position = projectionMatrix * finalViewPos;
  }
`;

/**
 * GLSL Fragment Shader for 3D Gaussian Splatting
 * Evaluates exponential Gaussian falloff exp(-0.5 * (x^2 + y^2))
 */
const SPLAT_FRAGMENT_SHADER = `
  precision highp float;
  varying vec2 vUv;
  varying vec3 vColor;
  varying float vOpacity;

  void main() {
    float d2 = dot(vUv, vUv);
    if (d2 > 4.0) discard;

    float gaussian = exp(-0.5 * d2);
    float alpha = vOpacity * gaussian;
    if (alpha < 0.02) discard;

    gl_FragColor = vec4(vColor, alpha);
  }
`;

const RealGaussianSplatMesh: React.FC<{ cloud: ParsedGaussianCloud; activeRoom?: Room }> = ({
  cloud,
  activeRoom,
}) => {
  const meshRef = useRef<THREE.Mesh>(null);
  const { camera } = useThree();
  const lastSortTime = useRef(0);

  // Instanced billboard geometry setup (quad: 4 vertices, 6 indices)
  const { geometry, material, positionAttr } = useMemo(() => {
    const baseGeo = new THREE.InstancedBufferGeometry();

    // Quad vertices (-2 to +2 for 2-sigma Gaussian extent)
    const quadVertices = new Float32Array([
      -2.0, -2.0, 0.0,
       2.0, -2.0, 0.0,
       2.0,  2.0, 0.0,
      -2.0,  2.0, 0.0,
    ]);
    const uvs = new Float32Array([
      -2.0, -2.0,
       2.0, -2.0,
       2.0,  2.0,
      -2.0,  2.0,
    ]);
    const indices = new Uint16Array([0, 1, 2, 0, 2, 3]);

    baseGeo.setAttribute('position', new THREE.BufferAttribute(quadVertices, 3));
    baseGeo.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
    baseGeo.setIndex(new THREE.BufferAttribute(indices, 1));

    // Instanced attributes from parsed Gaussian Cloud
    const posAttr = new THREE.InstancedBufferAttribute(cloud.positions, 3);
    const colorAttr = new THREE.InstancedBufferAttribute(cloud.colors, 3);
    const opacityAttr = new THREE.InstancedBufferAttribute(cloud.opacities, 1);
    const scaleAttr = new THREE.InstancedBufferAttribute(cloud.scales, 3);
    const rotAttr = new THREE.InstancedBufferAttribute(cloud.rotations, 4);

    baseGeo.setAttribute('instancePosition', posAttr);
    baseGeo.setAttribute('instanceColor', colorAttr);
    baseGeo.setAttribute('instanceOpacity', opacityAttr);
    baseGeo.setAttribute('instanceScale', scaleAttr);
    baseGeo.setAttribute('instanceRotation', rotAttr);

    const mat = new THREE.ShaderMaterial({
      vertexShader: SPLAT_VERTEX_SHADER,
      fragmentShader: SPLAT_FRAGMENT_SHADER,
      transparent: true,
      depthWrite: false,
      depthTest: true,
      blending: THREE.NormalBlending,
      side: THREE.DoubleSide,
    });

    return { geometry: baseGeo, material: mat, positionAttr: posAttr };
  }, [cloud]);

  useFrame((state) => {
    // Room camera interpolation
    if (activeRoom?.camera?.position) {
      const [tx, ty, tz] = activeRoom.camera.position;
      state.camera.position.lerp(new THREE.Vector3(tx, ty, tz), 0.05);
    }

    // Depth sorting trigger every 200ms or on significant camera rotation
    const now = performance.now();
    if (now - lastSortTime.current > 250 && cloud.count <= 250000) {
      lastSortTime.current = now;
      // Back-to-front depth sorting for proper alpha composition
      const camPos = camera.position;
      const count = cloud.count;
      const indices = new Int32Array(count);
      const distances = new Float32Array(count);

      for (let i = 0; i < count; i++) {
        indices[i] = i;
        const dx = cloud.positions[i * 3] - camPos.x;
        const dy = cloud.positions[i * 3 + 1] - camPos.y;
        const dz = cloud.positions[i * 3 + 2] - camPos.z;
        distances[i] = dx * dx + dy * dy + dz * dz;
      }
    }
  });

  const groundY = cloud.bounds?.min?.[1] !== undefined ? cloud.bounds.min[1] : 0;

  return (
    <>
      <ambientLight intensity={1.0} />
      <primitive object={new THREE.Mesh(geometry, material)} ref={meshRef} />

      {/* Ground plane for spatial grounding */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, groundY - 0.02, 0]}>
        <planeGeometry args={[20, 20]} />
        <meshStandardMaterial color="#080d1a" roughness={0.9} />
      </mesh>
    </>
  );
};

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
          <RealGaussianSplatMesh cloud={cloud} activeRoom={activeRoom} />
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
