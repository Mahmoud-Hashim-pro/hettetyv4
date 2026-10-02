import React, { useState } from 'react';
import { ThreeDTour, Room } from '../../types';
import { GaussianViewer } from './GaussianViewer';
import { MeshViewer } from './MeshViewer';
import { PanoramaViewer } from './PanoramaViewer';
import { TourControls, TourRenderMode } from './TourControls';
import { FloorPlan } from './FloorPlan';
import { MeasurementTool } from './MeasurementTool';
import { Sparkles, Layers, Globe, Shield } from 'lucide-react';

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

  const activeRoom = tour?.rooms?.find(r => r.id === activeRoomId) || tour?.rooms?.[0];

  return (
    <div className={`relative w-full h-full bg-slate-950 flex flex-col overflow-hidden ${isFullscreen ? 'fixed inset-0 z-50' : ''}`}>
      {/* 3D Scene Viewport */}
      <div className="flex-1 w-full h-full relative">
        {currentMode === 'gaussian' && (
          <GaussianViewer tour={tour || { status: 'ready' }} activeRoom={activeRoom} isRtl={isRtl} />
        )}
        {currentMode === 'mesh' && (
          <MeshViewer tour={tour || { status: 'ready' }} activeRoom={activeRoom} isRtl={isRtl} />
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
          <div className="absolute top-4 start-1/2 -translate-x-1/2 z-20 flex flex-wrap items-center justify-center gap-2 max-w-full px-4">
            <div className="flex flex-wrap items-center gap-1.5 p-1.5 rounded-2xl bg-black/60 backdrop-blur-md border border-white/10 shadow-xl">
              {tour.rooms.map(room => {
                const isActive = room.id === activeRoomId;
                return (
                  <button
                    key={room.id}
                    type="button"
                    onClick={() => setActiveRoomId(room.id)}
                    className={`px-3 py-1.5 rounded-xl text-xs font-bold transition-all flex items-center gap-1.5 cursor-pointer ${
                      isActive
                        ? 'bg-emerald-600 text-white shadow-md'
                        : 'bg-white/10 hover:bg-white/20 text-white/80'
                    }`}
                  >
                    <span>{isRtl ? (room.nameAr || room.name) : room.name}</span>
                  </button>
                );
              })}
            </div>
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
            <MeasurementTool isCalibrated={tour?.representation?.mesh?.isCalibratedMetric} isRtl={isRtl} />
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
