import React from 'react';
import { Compass, MapPin, Layers, Box, Ruler, CheckCircle2, ChevronRight, ChevronLeft } from 'lucide-react';
import { Room } from '../../types';

export interface RoomNavigationProps {
  rooms: Room[];
  activeRoomId?: string;
  onSelectRoom: (roomId: string) => void;
  showFloorPlan?: boolean;
  onToggleFloorPlan?: () => void;
  showMeasure?: boolean;
  onToggleMeasure?: () => void;
  isRtl?: boolean;
}

export const RoomNavigation: React.FC<RoomNavigationProps> = ({
  rooms,
  activeRoomId,
  onSelectRoom,
  showFloorPlan = false,
  onToggleFloorPlan,
  showMeasure = false,
  onToggleMeasure,
  isRtl = false,
}) => {
  if (!rooms || rooms.length === 0) return null;

  return (
    <div
      className="flex items-center gap-1.5 p-1.5 rounded-2xl bg-black/70 backdrop-blur-md border border-white/20 shadow-2xl max-w-[94vw] overflow-x-auto scrollbar-none select-none z-20"
      dir={isRtl ? 'rtl' : 'ltr'}
    >
      <div className="flex items-center gap-1 px-2 text-[10px] font-black uppercase text-amber-400 tracking-wider shrink-0">
        <Compass size={13} className="text-amber-400 shrink-0" />
        <span>{isRtl ? 'الغرف' : 'Rooms'}</span>
      </div>

      <div className="w-[1px] h-4 bg-white/20 mx-0.5 shrink-0" />

      {/* Room Waypoint Chips */}
      <div className="flex items-center gap-1.5 overflow-x-auto scrollbar-none">
        {rooms.map((room) => {
          const isActive = room.id === activeRoomId;
          const roomLabel = isRtl ? (room.nameAr || room.name) : room.name;

          return (
            <button
              key={room.id}
              type="button"
              onClick={() => onSelectRoom(room.id)}
              aria-pressed={isActive}
              aria-label={`${isRtl ? 'الانتقال إلى' : 'Go to'} ${roomLabel}`}
              className={`min-h-[34px] px-3 py-1 rounded-xl text-xs font-bold transition-all flex items-center gap-1.5 whitespace-nowrap cursor-pointer shrink-0 focus:outline-none focus:ring-2 focus:ring-brand-400 ${
                isActive
                  ? 'bg-emerald-600 text-white shadow-md shadow-emerald-600/30 scale-[1.02]'
                  : 'bg-white/10 hover:bg-white/20 text-white/90 hover:text-white'
              }`}
            >
              <MapPin
                size={12}
                className={isActive ? 'text-amber-300' : 'text-white/60'}
                aria-hidden="true"
              />
              <span>{roomLabel}</span>
            </button>
          );
        })}
      </div>

      {(onToggleFloorPlan || onToggleMeasure) && (
        <div className="w-[1px] h-4 bg-white/20 mx-1 shrink-0" />
      )}

      {/* Floor Plan Button */}
      {onToggleFloorPlan && (
        <button
          type="button"
          onClick={onToggleFloorPlan}
          aria-pressed={showFloorPlan}
          aria-label={isRtl ? 'عرض المخطط ثنائي الأبعاد' : 'Toggle 2D Floor Plan'}
          className={`min-h-[34px] px-3 py-1 rounded-xl text-xs font-bold transition-all flex items-center gap-1.5 whitespace-nowrap cursor-pointer shrink-0 focus:outline-none focus:ring-2 focus:ring-brand-400 ${
            showFloorPlan
              ? 'bg-amber-600 text-white shadow-md'
              : 'bg-white/10 hover:bg-white/20 text-white/80 hover:text-white'
          }`}
        >
          <Layers size={13} aria-hidden="true" />
          <span>{isRtl ? 'المخطط' : 'Floor Plan'}</span>
        </button>
      )}

      {/* Measurement Tool Button */}
      {onToggleMeasure && (
        <button
          type="button"
          onClick={onToggleMeasure}
          aria-pressed={showMeasure}
          aria-label={isRtl ? 'أداة القياس المتري' : 'Toggle 3D Measurement Tool'}
          className={`min-h-[34px] px-3 py-1 rounded-xl text-xs font-bold transition-all flex items-center gap-1.5 whitespace-nowrap cursor-pointer shrink-0 focus:outline-none focus:ring-2 focus:ring-brand-400 ${
            showMeasure
              ? 'bg-emerald-600 text-white shadow-md'
              : 'bg-white/10 hover:bg-white/20 text-white/80 hover:text-white'
          }`}
        >
          <Ruler size={13} aria-hidden="true" />
          <span>{isRtl ? 'قياس' : 'Measure'}</span>
        </button>
      )}
    </div>
  );
};
