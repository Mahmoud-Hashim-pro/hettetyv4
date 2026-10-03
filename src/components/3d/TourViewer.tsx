import React, { useState } from 'react';
import { ThreeDTour, Room } from '../../types';
import { Vec3 } from '../../lib/3d/coordinates';
import { GaussianViewer } from './GaussianViewer';
import { MeshViewer } from './MeshViewer';
import { PanoramaViewer } from './PanoramaViewer';
import { TourControls, TourRenderMode } from './TourControls';
import { FloorPlan } from './FloorPlan';
import { MeasurementTool } from './MeasurementTool';
import { RoomNavigation } from './RoomNavigation';
import { Sparkles, Layers, Globe, Shield } from 'lucide-react';

export { TourEngineProvider, useTourEngine, useTourContext } from './TourEngine';
export { GaussianRenderer } from './GaussianRenderer';
export { MeshRenderer } from './MeshRenderer';
export { RoomNavigation } from './RoomNavigation';
export { MeasurementTool } from './MeasurementTool';

export interface TourViewerProps {
  tour?: ThreeDTour;
  title?: string;
  onClose?: () => void;
  isRtl?: boolean;
}

export const TourViewer: React.FC<TourViewerProps> = ({
  tour,
  title,
  onClose,
  isRtl = false,
}) => {
  // Determine available modes from representations
  const hasGaussian = Boolean(tour?.representation?.gaussianSplat?.url || tour?.assetUrl);
  const hasMesh = Boolean(tour?.representation?.mesh?.url);
  const hasPanorama = Boolean(tour?.representation?.panorama?.url);
  const isExternal = tour?.source === 'matterport' || tour?.source === 'polycam' || tour?.source === 'kuula';

  const availableModes: TourRenderMode[] = [];
  if (hasGaussian) availableModes.push('gaussian');
  if (hasMesh) availableModes.push('mesh');
  if (hasPanorama) availableModes.push('panorama');
  if (isExternal) availableModes.push('external');
  if (availableModes.length === 0) availableModes.push('gaussian'); // fallback demo

  const [currentMode, setCurrentMode] = useState<TourRenderMode>(availableModes[0] || 'gaussian');
  const [activeRoomId, setActiveRoomId] = useState<string | undefined>(tour?.rooms?.[0]?.id);
  const [showFloorPlan, setShowFloorPlan] = useState(false);
  const [showMeasure, setShowMeasure] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [measurementPoints, setMeasurementPoints] = useState<[Vec3 | null, Vec3 | null]>([null, null]);

  const handlePointPicked = (pt: Vec3) => {
    setMeasurementPoints(([a, b]) => {
      if (!a) return [pt, null];
      if (!b) return [a, pt];
      return [pt, null];
    });
  };

  const activeRoom = tour?.rooms?.find(r => r.id === activeRoomId) || tour?.rooms?.[0];

  return (
    <div className={`relative w-full h-full bg-slate-950 flex flex-col overflow-hidden ${isFullscreen ? 'fixed inset-0 z-50' : ''}`}>
      {/* 3D Scene Viewport */}
      <div className="flex-1 w-full h-full relative">
        {currentMode === 'gaussian' && (
          <GaussianViewer
            tour={tour || { status: 'ready' }}
            activeRoom={activeRoom}
            isRtl={isRtl}
            isMeasuring={showMeasure}
            onPointPicked={handlePointPicked}
          />
        )}
        {currentMode === 'mesh' && (
          <MeshViewer
            tour={tour || { status: 'ready' }}
            activeRoom={activeRoom}
            isRtl={isRtl}
            isMeasuring={showMeasure}
            onPointPicked={handlePointPicked}
          />
        )}
        {currentMode === 'panorama' && (
          <PanoramaViewer
            panoramaUrl={tour?.representation?.panorama?.url || 'https://images.unsplash.com/photo-1600585154340-be6161a56a0c?auto=format&fit=crop&w=2000&q=80'}
            isRtl={isRtl}
          />
        )}
        {currentMode === 'external' && tour?.assetUrl && (
          <iframe
            src={tour.assetUrl}
            title={title || '3D Virtual Tour'}
            className="w-full h-full border-0"
            allow="fullscreen; xr-spatial-tracking; accelerometer; gyroscope; magnetometer"
          />
        )}

        {/* Room Waypoint Navigator Tray (Top Center) */}
        {tour?.rooms && tour.rooms.length > 0 && (
          <div className="absolute top-4 start-1/2 -translate-x-1/2 z-20 flex items-center justify-center max-w-full px-4">
            <RoomNavigation
              rooms={tour.rooms}
              activeRoomId={activeRoomId}
              onSelectRoom={(id) => setActiveRoomId(id)}
              showFloorPlan={showFloorPlan}
              onToggleFloorPlan={() => setShowFloorPlan(!showFloorPlan)}
              showMeasure={showMeasure}
              onToggleMeasure={() => setShowMeasure(!showMeasure)}
              isRtl={isRtl}
            />
          </div>
        )}

        {/* Floating Floor Plan (Bottom Start) */}
        {showFloorPlan && tour?.rooms && tour.rooms.length > 0 && (
          <div className="absolute bottom-20 start-4 z-20 animate-fade-in">
            <FloorPlan
              rooms={tour.rooms}
              activeRoomId={activeRoomId}
              onSelectRoom={(id) => setActiveRoomId(id)}
              isRtl={isRtl}
            />
          </div>
        )}

        {/* Floating Measurement Tool (Bottom End) */}
        {showMeasure && (
          <div className="absolute bottom-20 end-4 z-20 animate-fade-in">
            <MeasurementTool
              isCalibrated={tour?.representation?.mesh?.isCalibratedMetric}
              isRtl={isRtl}
              selectedPoints={measurementPoints}
              onPointSelect={handlePointPicked}
            />
          </div>
        )}
      </div>

      {/* Bottom Control Bar */}
      <div className="absolute bottom-4 start-1/2 -translate-x-1/2 z-20 max-w-full px-4">
        <TourControls
          currentMode={currentMode}
          availableModes={availableModes}
          onModeChange={setCurrentMode}
          showFloorPlan={showFloorPlan}
          onToggleFloorPlan={() => setShowFloorPlan(!showFloorPlan)}
          showMeasure={showMeasure}
          onToggleMeasure={() => setShowMeasure(!showMeasure)}
          isFullscreen={isFullscreen}
          onToggleFullscreen={() => setIsFullscreen(!isFullscreen)}
          isRtl={isRtl}
        />
      </div>
    </div>
  );
};
