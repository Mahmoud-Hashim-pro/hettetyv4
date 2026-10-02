import React, { useState } from 'react';
import { Canvas } from '@react-three/fiber';
import { OrbitControls } from '@react-three/drei';
import { Box, Eye } from 'lucide-react';
import { ThreeDTour, Room } from '../../types';

interface MeshViewerProps {
  tour: ThreeDTour;
  activeRoom?: Room;
  isRtl?: boolean;
}

const RoomMeshScene: React.FC<{ activeRoom?: Room; wireframe: boolean }> = ({ activeRoom, wireframe }) => {
  return (
    <>
      <ambientLight intensity={1.0} />
      <directionalLight position={[4, 8, 4]} intensity={1.6} />

      {/* Main architectural floor */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0, 0]}>
        <planeGeometry args={[10, 8]} />
        <meshStandardMaterial
          color="#334155"
          roughness={0.7}
          wireframe={wireframe}
        />
      </mesh>

      {/* Perimeter walls */}
      <mesh position={[0, 1.5, -4]}>
        <boxGeometry args={[10, 3, 0.2]} />
        <meshStandardMaterial color="#64748b" wireframe={wireframe} />
      </mesh>
      <mesh position={[-5, 1.5, 0]} rotation={[0, Math.PI / 2, 0]}>
        <boxGeometry args={[8, 3, 0.2]} />
        <meshStandardMaterial color="#64748b" wireframe={wireframe} />
      </mesh>
      <mesh position={[5, 1.5, 0]} rotation={[0, Math.PI / 2, 0]}>
        <boxGeometry args={[8, 3, 0.2]} />
        <meshStandardMaterial color="#64748b" wireframe={wireframe} />
      </mesh>

      {/* Active room spatial bounding indicator */}
      {activeRoom?.position && (
        <mesh position={activeRoom.position}>
          <boxGeometry args={[2.5, 2.0, 2.5]} />
          <meshStandardMaterial
            color="#10b981"
            transparent
            opacity={0.25}
            wireframe
          />
        </mesh>
      )}
    </>
  );
};

export const MeshViewer: React.FC<MeshViewerProps> = ({ tour, activeRoom, isRtl = false }) => {
  const [wireframe, setWireframe] = useState(false);

  return (
    <div className="w-full h-full relative bg-slate-900">
      <Canvas camera={{ position: [0, 2.5, 5], fov: 60 }}>
        <RoomMeshScene activeRoom={activeRoom} wireframe={wireframe} />
        <OrbitControls enableDamping dampingFactor={0.05} />
      </Canvas>

      <div className="absolute top-4 end-4 z-10">
        <button
          type="button"
          onClick={() => setWireframe(!wireframe)}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-black/60 hover:bg-black/80 text-white text-xs font-bold backdrop-blur-sm border border-white/20 transition-all cursor-pointer"
        >
          <Box size={14} />
          <span>{wireframe ? (isRtl ? 'عرض مجسم مصمت' : 'Shaded Mode') : (isRtl ? 'عرض شبكي (Wireframe)' : 'Wireframe Mode')}</span>
        </button>
      </div>
    </div>
  );
};
