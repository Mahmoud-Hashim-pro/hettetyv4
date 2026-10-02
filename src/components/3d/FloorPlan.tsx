import React from 'react';
import { MapPin, Compass } from 'lucide-react';
import { Room } from '../../types';

interface FloorPlanProps {
  rooms: Room[];
  activeRoomId?: string;
  onSelectRoom: (roomId: string) => void;
  isRtl?: boolean;
}

export const FloorPlan: React.FC<FloorPlanProps> = ({
  rooms,
  activeRoomId,
  onSelectRoom,
  isRtl = false,
}) => {
  return (
    <div className="bg-white/95 dark:bg-slate-900/95 backdrop-blur-md border border-slate-200 dark:border-slate-800 rounded-2xl p-3 shadow-xl max-w-xs text-xs">
      <div className="flex items-center justify-between mb-2">
        <span className="font-bold text-slate-800 dark:text-white flex items-center gap-1.5">
          <Compass size={14} className="text-brand-500" />
          {isRtl ? 'المخطط الهندسي للوحدة (Floor Plan)' : 'Interactive Floor Plan'}
        </span>
        <span className="text-[10px] text-slate-400">
          {rooms.length} {isRtl ? 'غرف' : 'rooms'}
        </span>
      </div>

      {/* Schematic SVG layout */}
      <div className="relative aspect-[4/3] bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-xl overflow-hidden p-2 flex flex-col justify-between">
        <div className="grid grid-cols-2 gap-1.5 h-full">
          {rooms.slice(0, 4).map(room => {
            const isActive = room.id === activeRoomId;
            return (
              <button
                key={room.id}
                type="button"
                onClick={() => onSelectRoom(room.id)}
                className={`p-2 rounded-lg border text-start flex flex-col justify-between transition-all cursor-pointer ${
                  isActive
                    ? 'bg-brand-600 text-white border-brand-600 shadow-sm'
                    : 'bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-300 border-slate-200 dark:border-slate-800 hover:border-brand-400'
                }`}
              >
                <div className="flex items-center justify-between w-full">
                  <span className="text-[9px] font-bold uppercase truncate">
                    {room.type || 'room'}
                  </span>
                  {isActive && <MapPin size={10} className="shrink-0" />}
                </div>
                <div className="font-bold text-[11px] truncate mt-1">
                  {isRtl ? (room.nameAr || room.name) : room.name}
                </div>
              </button>
            );
          })}
        </div>
      </div>
      <p className="text-[10px] text-slate-400 mt-2 text-center">
        {isRtl ? 'انقر على أي غرفة في المخطط للانتقال المباشر إليها' : 'Click any room to fly camera directly'}
      </p>
    </div>
  );
};
