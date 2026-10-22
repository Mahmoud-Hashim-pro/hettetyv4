/**
 * HETTETY 3D — Virtual Staging Service
 * Inspired by Microsoft TRELLIS.2 (single-image to 3D PBR asset generation & virtual room staging).
 *
 * Allows real estate agents and buyers to anchor 3D furniture and decorative objects
 * (generated from images via models like TRELLIS.2 or pre-built catalogs)
 * into a property's 3D Gaussian Splatting / GLB tour.
 */

import { ThreeDTour, VirtualStagedObject } from '../../types/three-d-tour';

export interface CreateStagedObjectParams {
  name: string;
  nameAr?: string;
  category: VirtualStagedObject['category'];
  glbUrl: string;
  sourceImageUrl?: string;
  roomId?: string;
  position: [number, number, number];
  rotation?: [number, number, number];
  scale?: [number, number, number];
}

/**
 * Creates and validates a new VirtualStagedObject.
 */
export const createVirtualStagedObject = (
  params: CreateStagedObjectParams
): VirtualStagedObject => {
  if (!params.name || params.name.trim().length === 0) {
    throw new Error('STAGING_INVALID_NAME: Object name is required.');
  }
  if (!params.glbUrl || (!params.glbUrl.startsWith('http://') && !params.glbUrl.startsWith('https://') && !params.glbUrl.startsWith('/'))) {
    throw new Error('STAGING_INVALID_GLB_URL: A valid GLB asset URL is required.');
  }
  if (!params.position || params.position.length !== 3 || params.position.some((c) => !Number.isFinite(c))) {
    throw new Error('STAGING_INVALID_COORDINATES: Position must be 3 finite coordinates [x, y, z].');
  }

  const id = `stage_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

  return {
    id,
    name: params.name.trim(),
    nameAr: params.nameAr?.trim(),
    category: params.category,
    glbUrl: params.glbUrl,
    sourceImageUrl: params.sourceImageUrl,
    roomId: params.roomId,
    position: params.position,
    rotation: params.rotation || [0, 0, 0],
    scale: params.scale || [1, 1, 1],
    isAnchored: true,
    createdAt: new Date().toISOString(),
  };
};

/**
 * Immutably adds a virtual staged object to a property tour.
 */
export const addVirtualStagedObject = (
  tour: ThreeDTour,
  stagedObject: VirtualStagedObject
): ThreeDTour => {
  const currentObjects = tour.virtualStagedObjects || [];
  return {
    ...tour,
    virtualStagedObjects: [...currentObjects, stagedObject],
    updatedAt: new Date().toISOString(),
  };
};

/**
 * Immutably removes a virtual staged object from a property tour.
 */
export const removeVirtualStagedObject = (
  tour: ThreeDTour,
  objectId: string
): ThreeDTour => {
  const currentObjects = tour.virtualStagedObjects || [];
  return {
    ...tour,
    virtualStagedObjects: currentObjects.filter((o) => o.id !== objectId),
    updatedAt: new Date().toISOString(),
  };
};

/**
 * Immutably updates the spatial transform (position, rotation, scale) of a staged object.
 */
export const updateVirtualStagedObject = (
  tour: ThreeDTour,
  objectId: string,
  updates: Partial<Pick<VirtualStagedObject, 'position' | 'rotation' | 'scale' | 'isAnchored' | 'roomId'>>
): ThreeDTour => {
  const currentObjects = tour.virtualStagedObjects || [];
  return {
    ...tour,
    virtualStagedObjects: currentObjects.map((o) => {
      if (o.id !== objectId) return o;
      return {
        ...o,
        ...updates,
      };
    }),
    updatedAt: new Date().toISOString(),
  };
};

/**
 * Filters virtual staged objects assigned to a specific room.
 */
export const getStagedObjectsForRoom = (
  tour: ThreeDTour,
  roomId: string
): VirtualStagedObject[] => {
  if (!tour.virtualStagedObjects) return [];
  return tour.virtualStagedObjects.filter((o) => o.roomId === roomId);
};

/**
 * Validates whether a staged object's position falls within the property's physical spatial bounds.
 */
export const isObjectWithinPropertyBounds = (
  position: [number, number, number],
  bounds?: { min: [number, number, number]; max: [number, number, number] }
): boolean => {
  if (!bounds) return true; // Unbounded if no calibration
  const [x, y, z] = position;
  const [minX, minY, minZ] = bounds.min;
  const [maxX, maxY, maxZ] = bounds.max;

  // Add 0.5m tolerance
  return (
    x >= minX - 0.5 &&
    x <= maxX + 0.5 &&
    y >= minY - 0.5 &&
    y <= maxY + 0.5 &&
    z >= minZ - 0.5 &&
    z <= maxZ + 0.5
  );
};
