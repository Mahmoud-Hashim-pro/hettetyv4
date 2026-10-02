import React, { useRef } from 'react';
import { Canvas, useFrame } from '@react-three/fiber';
import { OrbitControls } from '@react-three/drei';
import * as THREE from 'three';

interface PanoramaViewerProps {
  panoramaUrl: string;
  isRtl?: boolean;
}

const PanoSphere: React.FC<{ url: string }> = ({ url }) => {
  const meshRef = useRef<THREE.Mesh>(null);
  const texture = React.useMemo(() => {
    const loader = new THREE.TextureLoader();
    return loader.load(url);
  }, [url]);

  return (
    <mesh ref={meshRef} scale={[-1, 1, 1]}>
      <sphereGeometry args={[500, 60, 40]} />
      <meshBasicMaterial map={texture} side={THREE.BackSide} />
    </mesh>
  );
};

export const PanoramaViewer: React.FC<PanoramaViewerProps> = ({ panoramaUrl }) => {
  return (
    <div className="w-full h-full relative bg-black">
      <Canvas camera={{ position: [0, 0, 0.1], fov: 75 }}>
        <PanoSphere url={panoramaUrl} />
        <OrbitControls
          enableZoom={false}
          enablePan={false}
          rotateSpeed={-0.3}
          dampingFactor={0.05}
        />
      </Canvas>
    </div>
  );
};
