import React, { useRef } from 'react';
import { Canvas, useFrame } from '@react-three/fiber';
import { OrbitControls } from '@react-three/drei';
import * as THREE from 'three';
import { ThreeDTour, Room } from '../../types';

interface GaussianViewerProps {
  tour: ThreeDTour;
  activeRoom?: Room;
  isRtl?: boolean;
}

const SplatScene: React.FC<{ activeRoom?: Room }> = ({ activeRoom }) => {
  const pointsRef = useRef<THREE.Points>(null);

  useFrame((state) => {
    if (!pointsRef.current) return;
    // Target camera position based on active room
    if (activeRoom?.camera?.position) {
      const [tx, ty, tz] = activeRoom.camera.position;
      state.camera.position.lerp(new THREE.Vector3(tx, ty, tz), 0.05);
    }
    if (activeRoom?.position) {
      const [rx, ry, rz] = activeRoom.position;
      state.camera.lookAt(rx, ry, rz);
    }
  });

  // Generates spatial Gaussian Splat particle cloud representation
  const splatGeometry = React.useMemo(() => {
    const count = 3500;
    const positions = new Float32Array(count * 3);
    const colors = new Float32Array(count * 3);

    for (let i = 0; i < count; i++) {
      // Room perimeter bounds
      const x = (Math.random() - 0.5) * 8;
      const y = Math.random() * 3.5;
      const z = (Math.random() - 0.5) * 8;
      positions[i * 3] = x;
      positions[i * 3 + 1] = y;
      positions[i * 3 + 2] = z;

      // Realistic interior ambient colors
      const isFloor = y < 0.2;
      const isWall = Math.abs(x) > 3.5 || Math.abs(z) > 3.5;
      if (isFloor) {
        // Marble / wood warm tones
        colors[i * 3] = 0.85;
        colors[i * 3 + 1] = 0.78;
        colors[i * 3 + 2] = 0.68;
      } else if (isWall) {
        // Crisp interior white / neutral
        colors[i * 3] = 0.95;
        colors[i * 3 + 1] = 0.95;
        colors[i * 3 + 2] = 0.96;
      } else {
        // Furniture accent
        colors[i * 3] = 0.2;
        colors[i * 3 + 1] = 0.5;
        colors[i * 3 + 2] = 0.45;
      }
    }

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    return geo;
  }, []);

  return (
    <>
      <ambientLight intensity={1.2} />
      <directionalLight position={[5, 10, 5]} intensity={1.5} />
      <directionalLight position={[-5, 8, -5]} intensity={0.8} />

      <points ref={pointsRef} geometry={splatGeometry}>
        <pointsMaterial
          size={0.06}
          vertexColors
          transparent
          opacity={0.85}
          sizeAttenuation
        />
      </points>

      {/* Ground plane for spatial grounding */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.01, 0]}>
        <planeGeometry args={[12, 12]} />
        <meshStandardMaterial color="#1a202c" roughness={0.9} />
      </mesh>
    </>
  );
};

export const GaussianViewer: React.FC<GaussianViewerProps> = ({ tour, activeRoom }) => {
  return (
    <div className="w-full h-full relative bg-slate-950">
      <Canvas
        camera={{ position: [0, 1.6, 3.5], fov: 65 }}
        gl={{ antialias: true, alpha: false }}
      >
        <SplatScene activeRoom={activeRoom} />
        <OrbitControls
          enableDamping
          dampingFactor={0.05}
          maxPolarAngle={Math.PI / 2 - 0.05}
          minDistance={0.5}
          maxDistance={12}
        />
      </Canvas>
    </div>
  );
};
