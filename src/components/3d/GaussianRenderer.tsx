import React, { useRef, useEffect, useMemo } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { Room } from '../../types';
import { ParsedGaussianCloud } from '../../lib/3d/spz-parser';

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

  useFrame((state) => {
    // Room camera interpolation
    if (activeRoom?.camera?.position) {
      const [tx, ty, tz] = activeRoom.camera.position;
      state.camera.position.lerp(new THREE.Vector3(tx, ty, tz), 0.05);
    }

    // Depth sorting trigger every 200ms: back-to-front ordering for proper alpha composition
    const now = performance.now();
    if (now - lastSortTime.current > 200 && cloud.count <= 100000) {
      lastSortTime.current = now;
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

      // Sort descending: largest distance first (back to front)
      indices.sort((a, b) => distances[b] - distances[a]);

      const curPos = posAttr.array as Float32Array;
      const curCol = colorAttr.array as Float32Array;
      const curOp = opacityAttr.array as Float32Array;
      const curSc = scaleAttr.array as Float32Array;
      const curRot = rotAttr.array as Float32Array;

      const srcPos = cloud.positions;
      const srcCol = cloud.colors;
      const srcOp = cloud.opacities;
      const srcSc = cloud.scales;
      const srcRot = cloud.rotations;

      for (let i = 0; i < count; i++) {
        const orig = indices[i];
        curPos[i * 3] = srcPos[orig * 3];
        curPos[i * 3 + 1] = srcPos[orig * 3 + 1];
        curPos[i * 3 + 2] = srcPos[orig * 3 + 2];

        curCol[i * 3] = srcCol[orig * 3];
        curCol[i * 3 + 1] = srcCol[orig * 3 + 1];
        curCol[i * 3 + 2] = srcCol[orig * 3 + 2];

        curOp[i] = srcOp[orig];

        curSc[i * 3] = srcSc[orig * 3];
        curSc[i * 3 + 1] = srcSc[orig * 3 + 1];
        curSc[i * 3 + 2] = srcSc[orig * 3 + 2];

        curRot[i * 4] = srcRot[orig * 4];
        curRot[i * 4 + 1] = srcRot[orig * 4 + 1];
        curRot[i * 4 + 2] = srcRot[orig * 4 + 2];
        curRot[i * 4 + 3] = srcRot[orig * 4 + 3];
      }

      posAttr.needsUpdate = true;
      colorAttr.needsUpdate = true;
      opacityAttr.needsUpdate = true;
      scaleAttr.needsUpdate = true;
      rotAttr.needsUpdate = true;
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
