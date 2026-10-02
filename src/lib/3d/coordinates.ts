/**
 * HETTETY 3D - Spatial Coordinates & Geometric Utilities
 */

export type Vec3 = [number, number, number];

export interface BoundingBox {
  min: Vec3;
  max: Vec3;
}

/**
 * Calculates Euclidean 3D distance in real-world meters between two points.
 */
export const calculateDistanceMeters = (p1: Vec3, p2: Vec3): number => {
  const dx = p2[0] - p1[0];
  const dy = p2[1] - p1[1];
  const dz = p2[2] - p1[2];
  return Math.sqrt(dx * dx + dy * dy + dz * dz);
};

/**
 * Formats distance with unit label (meters in Arabic and English).
 */
export const formatDistance = (meters: number, isRtl = false): string => {
  const formatted = meters.toFixed(2);
  return isRtl ? `${formatted} متر` : `${formatted} m`;
};

/**
 * Computes bounding box center point.
 */
export const computeBoxCenter = (box: BoundingBox): Vec3 => {
  return [
    (box.min[0] + box.max[0]) / 2,
    (box.min[1] + box.max[1]) / 2,
    (box.min[2] + box.max[2]) / 2,
  ];
};

/**
 * Linearly interpolates between two 3D vectors with factor t [0, 1].
 */
export const lerpVec3 = (start: Vec3, end: Vec3, t: number): Vec3 => {
  const clamped = Math.max(0, Math.min(1, t));
  return [
    start[0] + (end[0] - start[0]) * clamped,
    start[1] + (end[1] - start[1]) * clamped,
    start[2] + (end[2] - start[2]) * clamped,
  ];
};
