import React, { useMemo, useEffect } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { Room } from '../../types';

export interface MeshRendererProps {
  scene: THREE.Group;
  wireframe: boolean;
  activeRoom?: Room;
  bounds: THREE.Box3;
}

export const MeshRenderer: React.FC<MeshRendererProps> = ({
  scene,
  wireframe,
  activeRoom,
  bounds,
}) => {
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

  // Strict Three.js resource disposal on unmount or scene replacement
  useEffect(() => {
    return () => {
      clonedScene.traverse((child) => {
        if ((child as THREE.Mesh).isMesh) {
          const mesh = child as THREE.Mesh;
          mesh.geometry?.dispose();
          if (Array.isArray(mesh.material)) {
            mesh.material.forEach((mat) => {
              if ((mat as any).map) (mat as any).map.dispose();
              mat.dispose();
            });
          } else if (mesh.material) {
            if ((mesh.material as any).map) (mesh.material as any).map.dispose();
            mesh.material.dispose();
          }
        }
      });
    };
  }, [clonedScene]);

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
          <boxGeometry
            args={[
              activeRoom.dimensions?.width || 3,
              activeRoom.dimensions?.height || 2.8,
              activeRoom.dimensions?.length || 3,
            ]}
          />
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
