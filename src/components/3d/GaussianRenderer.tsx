import React, { useRef, useEffect, useMemo } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { Room } from '../../types';
import { ParsedGaussianCloud } from '../../lib/3d/spz-parser';
import {
  SYNC_SORT_THRESHOLD,
  applySplatOrder,
  cameraMovedSignificantly,
  computeSplatSortOrder,
  createSplatSortBuffers,
} from '../../lib/3d/splat-sort';

export const SPLAT_VERTEX_SHADER = `
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

export const SPLAT_FRAGMENT_SHADER = `
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

export interface GaussianRendererProps {
  cloud: ParsedGaussianCloud;
  activeRoom?: Room;
}

export const GaussianRenderer: React.FC<GaussianRendererProps> = ({
  cloud,
  activeRoom,
}) => {
  const meshRef = useRef<THREE.Mesh>(null);
  const { camera } = useThree();
  const lastSortTime = useRef(0);
  const lastSortPos = useRef<[number, number, number] | null>(null);
  const lastSortDir = useRef<[number, number, number] | null>(null);
  const tmpDir = useRef(new THREE.Vector3());
  const sortBuffers = useRef<ReturnType<typeof createSplatSortBuffers> | null>(null);
  const sortWorkerRef = useRef<Worker | null>(null);
  const sortInFlight = useRef(false);
  const sortRequestId = useRef(0);

  // Instanced billboard geometry setup (quad: 4 vertices, 6 indices)
  const { geometry, material, posAttr, colorAttr, opacityAttr, scaleAttr, rotAttr } = useMemo(() => {
    const baseGeo = new THREE.InstancedBufferGeometry();

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

    const posAttr = new THREE.InstancedBufferAttribute(new Float32Array(cloud.positions), 3);
    const colorAttr = new THREE.InstancedBufferAttribute(new Float32Array(cloud.colors), 3);
    const opacityAttr = new THREE.InstancedBufferAttribute(new Float32Array(cloud.opacities), 1);
    const scaleAttr = new THREE.InstancedBufferAttribute(new Float32Array(cloud.scales), 3);
    const rotAttr = new THREE.InstancedBufferAttribute(new Float32Array(cloud.rotations), 4);
    posAttr.setUsage(THREE.DynamicDrawUsage);
    colorAttr.setUsage(THREE.DynamicDrawUsage);
    opacityAttr.setUsage(THREE.DynamicDrawUsage);
    scaleAttr.setUsage(THREE.DynamicDrawUsage);
    rotAttr.setUsage(THREE.DynamicDrawUsage);

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

    return {
      geometry: baseGeo,
      material: mat,
      posAttr,
      colorAttr,
      opacityAttr,
      scaleAttr,
      rotAttr,
    };
  }, [cloud]);

  // Strict WebGL resource cleanup on unmount or geometry recreation
  useEffect(() => {
    return () => {
      geometry.dispose();
      material.dispose();
    };
  }, [geometry, material]);

  const applyOrder = (order: ArrayLike<number>) => {
    applySplatOrder(
      order,
      cloud,
      {
        positions: posAttr.array as Float32Array,
        colors: colorAttr.array as Float32Array,
        opacities: opacityAttr.array as Float32Array,
        scales: scaleAttr.array as Float32Array,
        rotations: rotAttr.array as Float32Array,
      }
    );
    posAttr.needsUpdate = true;
    colorAttr.needsUpdate = true;
    opacityAttr.needsUpdate = true;
    scaleAttr.needsUpdate = true;
    rotAttr.needsUpdate = true;
  };

  // Large scenes sort in a Web Worker so the render loop never stalls.
  useEffect(() => {
    lastSortPos.current = null;
    lastSortDir.current = null;
    sortInFlight.current = false;
    if (cloud.count <= SYNC_SORT_THRESHOLD || typeof Worker === 'undefined') {
      sortWorkerRef.current = null;
      return;
    }
    let worker: Worker | null = null;
    try {
      worker = new Worker(new URL('../../lib/3d/splat-sort.worker.ts', import.meta.url), { type: 'module' });
    } catch {
      sortWorkerRef.current = null;
      return;
    }
    worker.onmessage = (event: MessageEvent<{ type: string; requestId: number; order: Uint32Array }>) => {
      if (event.data?.type !== 'sorted') return;
      sortInFlight.current = false;
      if (event.data.requestId !== sortRequestId.current) return;
      applyOrder(event.data.order);
    };
    worker.onerror = () => {
      // Fall back to inline sorting rather than rendering unsorted.
      sortInFlight.current = false;
      sortWorkerRef.current = null;
    };
    worker.postMessage({ type: 'init', positions: new Float32Array(cloud.positions), count: cloud.count });
    sortWorkerRef.current = worker;
    return () => {
      worker?.terminate();
      if (sortWorkerRef.current === worker) sortWorkerRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cloud, posAttr]);

  useFrame((state) => {
    // Room camera interpolation
    if (activeRoom?.camera?.position) {
      const [tx, ty, tz] = activeRoom.camera.position;
      state.camera.position.lerp(new THREE.Vector3(tx, ty, tz), 0.05);
    }

    const now = performance.now();
    const minInterval = cloud.count <= SYNC_SORT_THRESHOLD ? 120 : 250;
    if (now - lastSortTime.current < minInterval) return;

    const camPos: [number, number, number] = [camera.position.x, camera.position.y, camera.position.z];
    camera.getWorldDirection(tmpDir.current);
    const camDir: [number, number, number] = [tmpDir.current.x, tmpDir.current.y, tmpDir.current.z];
    if (!cameraMovedSignificantly(lastSortPos.current, lastSortDir.current, camPos, camDir)) return;

    lastSortTime.current = now;
    lastSortPos.current = camPos;
    lastSortDir.current = camDir;

    const worker = sortWorkerRef.current;
    if (worker) {
      // Large scene: sort off the main thread; at most one request in flight.
      if (sortInFlight.current) return;
      sortInFlight.current = true;
      worker.postMessage({ type: 'sort', requestId: ++sortRequestId.current, camPos, camDir });
      return;
    }

    // Small scene (or no Worker support): O(n) counting sort inline.
    if (!sortBuffers.current || sortBuffers.current.order.length < cloud.count) {
      sortBuffers.current = createSplatSortBuffers(cloud.count);
    }
    const order = computeSplatSortOrder(cloud.positions, cloud.count, camPos, camDir, sortBuffers.current);
    applyOrder(order);
  });

  const groundY = cloud.bounds?.min?.[1] !== undefined ? cloud.bounds.min[1] : 0;

  // One stable mesh per geometry. Instanced splats extend far beyond the base
  // quad's bounds, so frustum culling against that quad would drop the scene.
  const splatMesh = useMemo(() => {
    const m = new THREE.Mesh(geometry, material);
    m.frustumCulled = false;
    return m;
  }, [geometry, material]);

  return (
    <>
      <ambientLight intensity={1.0} />
      <primitive object={splatMesh} ref={meshRef} />

      {/* Ground plane for spatial grounding */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, groundY - 0.02, 0]}>
        <planeGeometry args={[20, 20]} />
        <meshStandardMaterial color="#080d1a" roughness={0.9} />
      </mesh>
    </>
  );
};
