import React, { createContext, useContext, useState, useMemo, useCallback } from 'react';
import { ThreeDTour, Room } from '../../types';
import { Vec3, calculateDistanceMeters } from '../../lib/3d/coordinates';

export type TourMode = 'gaussian' | 'mesh' | 'panorama' | 'external' | 'depth';

export interface TourEngineState {
  currentMode: TourMode;
  availableModes: TourMode[];
  activeRoomId: string | null;
  activeRoom: Room | null;
  showFloorPlan: boolean;
  showMeasure: boolean;
  isFullscreen: boolean;
  isCalibrated: boolean;
  scaleFactor: number;
}

export interface TourEngineActions {
  setMode: (mode: TourMode) => void;
  selectRoom: (roomId: string) => void;
  toggleFloorPlan: () => void;
  toggleMeasure: () => void;
  toggleFullscreen: () => void;
  calculateSpatialDistance: (a: Vec3, b: Vec3) => number;
  toMeters: (units: number) => number;
}

export interface TourEngineHookReturn extends TourEngineState, TourEngineActions {}

/**
 * useTourEngine: The central state machine and coordinator for 3D walkthroughs.
 * Controls representations (3DGS, Mesh, Panorama, External, Photo Relief),
 * manages smooth room transitions, and coordinates physical metric units.
 */
export function useTourEngine(tour?: ThreeDTour, fallbackImagesCount = 0): TourEngineHookReturn {
  const rooms = useMemo(() => tour?.rooms || [], [tour]);

  // Determine available representations
  const hasGaussian = Boolean(tour?.representation?.gaussianSplat?.url || tour?.assetUrl);
  const hasMesh = Boolean(tour?.representation?.mesh?.url);
  const hasPanorama = Boolean(tour?.representation?.panorama?.url);
  const isExternal = tour?.source === 'matterport' || tour?.source === 'polycam' || tour?.source === 'kuula';
  const hasPhotos = fallbackImagesCount > 0;

  const availableModes = useMemo(() => {
    const modes: TourMode[] = [];
    if (hasGaussian) modes.push('gaussian');
    if (hasMesh) modes.push('mesh');
    if (hasPanorama) modes.push('panorama');
    if (isExternal) modes.push('external');
    if (hasPhotos || modes.length === 0) modes.push('depth');
    return modes;
  }, [hasGaussian, hasMesh, hasPanorama, isExternal, hasPhotos]);

  const [currentMode, setCurrentMode] = useState<TourMode>(availableModes[0] || 'gaussian');
  const [activeRoomId, setActiveRoomId] = useState<string | null>(rooms[0]?.id || null);
  const [showFloorPlan, setShowFloorPlan] = useState(false);
  const [showMeasure, setShowMeasure] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);

  const activeRoom = useMemo(
    () => rooms.find((r) => r.id === activeRoomId) || rooms[0] || null,
    [rooms, activeRoomId]
  );

  const isCalibrated = Boolean(tour?.representation?.mesh?.isCalibratedMetric);
  const scaleFactor = 1.0; // 1:1 metric scale when calibrated

  const setMode = useCallback(
    (mode: TourMode) => {
      if (availableModes.includes(mode)) {
        setCurrentMode(mode);
      } else {
        // Fallback cascade: gaussian -> mesh -> panorama -> depth
        const fallback =
          availableModes.find((m) => m === 'gaussian') ||
          availableModes.find((m) => m === 'mesh') ||
          availableModes.find((m) => m === 'panorama') ||
          'depth';
        setCurrentMode(fallback);
      }
    },
    [availableModes]
  );

  const selectRoom = useCallback((roomId: string) => {
    setActiveRoomId(roomId);
  }, []);

  const toggleFloorPlan = useCallback(() => {
    setShowFloorPlan((prev) => !prev);
  }, []);

  const toggleMeasure = useCallback(() => {
    setShowMeasure((prev) => !prev);
  }, []);

  const toggleFullscreen = useCallback(() => {
    setIsFullscreen((prev) => !prev);
  }, []);

  const calculateSpatialDistance = useCallback(
    (a: Vec3, b: Vec3) => {
      const rawDistance = calculateDistanceMeters(a, b);
      return isCalibrated ? rawDistance * scaleFactor : rawDistance;
    },
    [isCalibrated, scaleFactor]
  );

  const toMeters = useCallback(
    (units: number) => {
      return isCalibrated ? units * scaleFactor : units;
    },
    [isCalibrated, scaleFactor]
  );

  return {
    currentMode,
    availableModes,
    activeRoomId,
    activeRoom,
    showFloorPlan,
    showMeasure,
    isFullscreen,
    isCalibrated,
    scaleFactor,
    setMode,
    selectRoom,
    toggleFloorPlan,
    toggleMeasure,
    toggleFullscreen,
    calculateSpatialDistance,
    toMeters,
  };
}

const TourEngineContext = createContext<TourEngineHookReturn | null>(null);

export const TourEngineProvider: React.FC<{
  tour?: ThreeDTour;
  fallbackImagesCount?: number;
  children: React.ReactNode;
}> = ({ tour, fallbackImagesCount, children }) => {
  const engine = useTourEngine(tour, fallbackImagesCount);
  return <TourEngineContext.Provider value={engine}>{children}</TourEngineContext.Provider>;
};

export function useTourContext(): TourEngineHookReturn {
  const ctx = useContext(TourEngineContext);
  if (!ctx) {
    throw new Error('useTourContext must be used within a TourEngineProvider');
  }
  return ctx;
}
