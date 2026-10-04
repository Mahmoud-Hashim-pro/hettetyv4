/**
 * HETTETY 3D Tour & Spatial Representation Schema
 * Defines the multi-representation 3D Tour model (Gaussian Splatting + Mesh + Panorama + External Twin).
 */

export type ThreeDTourStatus =
  | 'none'
  | 'uploading'
  | 'queued'
  | 'processing'
  | 'optimizing'
  | 'ready'
  | 'failed'
  | 'cancelled';

export type ThreeDTourSource =
  | 'hettety_capture'
  | 'matterport'
  | 'polycam'
  | 'kuula';

export type RoomType =
  | 'bedroom'
  | 'living_room'
  | 'kitchen'
  | 'bathroom'
  | 'hallway'
  | 'balcony'
  | 'terrace'
  | 'reception'
  | 'other';

export interface Room {
  id: string;
  name: string;
  nameAr?: string;
  type?: RoomType;
  center?: [number, number, number];
  position?: [number, number, number]; // spatial anchor position
  camera?: {
    position: [number, number, number];
    rotation?: [number, number, number];
    target?: [number, number, number];
  };
  dimensions?: {
    width: number;  // meters
    length: number; // meters
    height: number; // meters
  };
  waypoints?: string[]; // references Waypoint.id
}

export interface Waypoint {
  id: string;
  roomId?: string;
  label?: string;
  labelAr?: string;
  name?: string;
  nameAr?: string;
  position: [number, number, number];
  camera?: {
    position: [number, number, number];
    rotation?: [number, number, number];
    target?: [number, number, number];
  };
}

export type TourRoomWaypoint = Room;

export interface ThreeDTourQualityReport {
  coverageScore: number;     // 0-100%
  cameraMotionScore: number; // 0-100%
  blurScore: number;         // 0-100%
  lightingScore: number;     // 0-100%
  roomCompleteness: number;  // 0-100%
  warnings?: string[];
  warningsAr?: string[];
}

export interface GaussianSplatRepresentation {
  format: 'spz' | 'ply' | 'glb';
  url: string;
  sizeBytes?: number;
  lodUrls?: {
    high?: string;
    medium?: string;
    low?: string;
  };
  splatCount?: number;
  sha256?: string;
}

export interface MeshRepresentation {
  format: 'glb' | 'gltf';
  url: string;
  sizeBytes?: number;
  vertexCount?: number;
  faceCount?: number;
  isCalibratedMetric?: boolean;
  sha256?: string;
}

export interface PanoramaRepresentation {
  url?: string;
  urls?: string[];
}

export interface ThreeDTourRepresentation {
  gaussianSplat?: GaussianSplatRepresentation;
  mesh?: MeshRepresentation;
  panorama?: PanoramaRepresentation;
}

export interface ThreeDTour {
  id?: string;
  status: ThreeDTourStatus;
  source?: ThreeDTourSource;
  provider?: 'hettety' | 'matterport' | 'polycam' | 'kuula'; // backward compatibility alias
  representation?: ThreeDTourRepresentation;
  // Direct asset links for backward compatibility
  assetUrl?: string;
  format?: 'spz' | 'ply' | 'glb';
  thumbnailUrl?: string;
  duration?: number;
  processingJobId?: string;
  rooms?: Room[];
  waypoints?: Waypoint[];
  qualityReport?: ThreeDTourQualityReport;
  bounds?: {
    min: [number, number, number];
    max: [number, number, number];
  };
  pipelineVersion?: string;
  createdAt?: string;
  updatedAt?: string;
}

// Backward-compatible alias for existing code
export type ThreeDTourAsset = ThreeDTour;
