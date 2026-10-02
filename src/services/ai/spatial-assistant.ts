/**
 * HETTETY 3D Spatial Assistant
 * Interprets natural language commands to navigate 3D scenes, locate rooms,
 * inspect spatial waypoints, and answer grounded architectural questions.
 */

import { Room, Waypoint, ThreeDTour } from '../../types';

export interface SpatialNavigationResult {
  action: 'navigate_to_room' | 'list_rooms' | 'measure_hint' | 'general_answer';
  targetRoomId?: string;
  targetRoomName?: string;
  targetRoomNameAr?: string;
  cameraPosition?: [number, number, number];
  cameraTarget?: [number, number, number];
  responseTextEn: string;
  responseTextAr: string;
  suggestedWaypoints?: string[];
}

// Room synonym dictionary for Egyptian real-estate English and Arabic
const ROOM_PATTERNS: { type: string; regex: RegExp }[] = [
  { type: 'reception', regex: /ريسبشن|استقبال|صالون|معيشة|living|reception|salon/i },
  { type: 'master_bedroom', regex: /ماستر|غرفة رئيسية|نوم رئيسية|master bedroom|master suite/i },
  { type: 'bedroom', regex: /غرفة نوم|أطفال|نوم|bedroom|bed/i },
  { type: 'kitchen', regex: /مطبخ|kitchen/i },
  { type: 'bathroom', regex: /حمام|تواليت|bath|bathroom|toilet|powder room/i },
  { type: 'terrace', regex: /بلكونة|تراس|شرفة|روف|terrace|balcony|roof/i },
  { type: 'garden', regex: /حديقة|جنينة|لاندسكيب|garden/i },
  { type: 'pool', regex: /بسين|حمام سباحة|مسبح|pool/i },
];

export const parseSpatialCommand = (
  command: string,
  tour?: ThreeDTour
): SpatialNavigationResult => {
  const q = command.trim().toLowerCase();
  const rooms = tour?.rooms || [];

  if (!q) {
    return {
      action: 'general_answer',
      responseTextEn: 'How can I assist you with this 3D tour? You can ask to view any room or measure distances.',
      responseTextAr: 'كيف يمكنني مساعدتك في هذه الجولة ثلاثية الأبعاد؟ يمكنك طلب الانتقال لأي غرفة أو قياس المسافات.',
    };
  }

  // 1. Check for "List rooms" or "What rooms exist?"
  if (/إيه الغرف|ما هي الغرف|جميع الغرف|list rooms|what rooms|all rooms/i.test(q)) {
    const roomNamesEn = rooms.map(r => r.name).join(', ') || 'Reception, Bedrooms, Kitchen, Bathrooms';
    const roomNamesAr = rooms.map(r => r.nameAr || r.name).join('، ') || 'الريسبشن، غرف النوم، المطبخ، الحمامات';
    return {
      action: 'list_rooms',
      responseTextEn: `This property includes the following spaces: ${roomNamesEn}.`,
      responseTextAr: `يحتوي هذا العقار على المساحات التالية: ${roomNamesAr}.`,
      suggestedWaypoints: rooms.map(r => r.id),
    };
  }

  // 2. Check for "Measurement" command
  if (/قيس|أقيس|اقيس|قياس|مسافات|مسافة|مسطرة|كم المسافة|measure|distance|how wide|how long|dimensions/i.test(q)) {
    return {
      action: 'measure_hint',
      responseTextEn: 'You can use the 3D Measurement Tool in the top toolbar to calculate exact metric dimensions between any two points.',
      responseTextAr: 'يمكنك استخدام مسطرة القياس ثلاثية الأبعاد من الشريط العلوي لحساب الأبعاد الواقعية بالمتر بين أي نقطتين.',
    };
  }

  // 3. Match specific room target
  for (const pattern of ROOM_PATTERNS) {
    if (pattern.regex.test(q)) {
      // Find matching room in tour rooms list
      const matchedRoom = rooms.find(r => 
        r.id.toLowerCase().includes(pattern.type) ||
        r.name.toLowerCase().includes(pattern.type) ||
        (r.type && r.type.toLowerCase().includes(pattern.type))
      ) || rooms[0]; // fallback to first room if specific match not found in list

      if (matchedRoom) {
        return {
          action: 'navigate_to_room',
          targetRoomId: matchedRoom.id,
          targetRoomName: matchedRoom.name,
          targetRoomNameAr: matchedRoom.nameAr || matchedRoom.name,
          cameraPosition: matchedRoom.camera?.position || matchedRoom.position || [0, 1.6, 0],
          cameraTarget: matchedRoom.camera?.target || [0, 0, 0],
          responseTextEn: `Navigating camera to ${matchedRoom.name}.`,
          responseTextAr: `جاري توجيه الكاميرا إلى ${matchedRoom.nameAr || matchedRoom.name}.`,
        };
      }
    }
  }

  // Default response
  return {
    action: 'general_answer',
    responseTextEn: `I'm exploring the 3D model for you. Ask me to take you to the kitchen, master suite, or reception.`,
    responseTextAr: `أنا معك داخل النموذج الفراغي. اطلب مني نقلك إلى المطبخ، جناح الماستر، أو الريسبشن.`,
  };
};
