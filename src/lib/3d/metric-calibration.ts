/**
 * HETTETY 3D — Metric Calibration Engine
 * Validates spatial scale factors against architectural references (doors, ceiling heights, LiDAR benchmarks).
 * Strictly controls the `isCalibratedMetric` gate — preventing false 1:1 claims on uncalibrated models.
 */

export interface MetricScaleReference {
  type: 'door_standard' | 'ceiling_standard' | 'lidar_benchmark' | 'surveyor_marker' | 'user_dimension';
  measuredUnits: number;
  knownMeters: number;
  toleranceMeters?: number;
}

export interface MetricCalibrationReport {
  isCalibratedMetric: boolean;
  scaleMetersPerUnit: number;
  confidenceScore: number;     // 0.0 - 1.0 (requires >= 0.90 for true metric claim)
  errorMarginPercent: number;  // e.g. 1.8%
  referenceUsed: string;
  calibratedAt: string;
  disclaimer?: string;
  disclaimerAr?: string;
}

/**
 * Standard architectural reference dimensions in Egyptian / MENA luxury residential construction:
 * - Standard Door Height: 2.15 meters
 * - Standard Clear Ceiling Height: 2.90 meters
 */
export const ARCHITECTURAL_REFERENCES = {
  DOOR_HEIGHT_METERS: 2.15,
  CEILING_HEIGHT_METERS: 2.90,
  CORRIDOR_WIDTH_METERS: 1.20,
};

/**
 * Validates and calibrates model geometry against physical reference measurements.
 * Only awards `isCalibratedMetric = true` when confidence score >= 0.90.
 */
export function calibrateModelScale(
  modelHeightUnits: number,
  references: MetricScaleReference[] = []
): MetricCalibrationReport {
  const now = new Date().toISOString();

  // If no reference measurements are supplied, the model is strictly UNCALIBRATED
  if (!references || references.length === 0) {
    return {
      isCalibratedMetric: false,
      scaleMetersPerUnit: 1.0,
      confidenceScore: 0.0,
      errorMarginPercent: 25.0,
      referenceUsed: 'None — relative visual scale only',
      calibratedAt: now,
      disclaimer: 'Model geometry is not metric-calibrated. All measurements are relative approximations.',
      disclaimerAr: 'المجسم غير معاير هندسياً بمقياس متري حقيقي. جميع الأبعاد والقياسات المعروضة نسبية وتقريبية فقط.',
    };
  }

  // Calculate weighted scale factor across all reference points
  let totalWeight = 0;
  let weightedScale = 0;
  let varianceSum = 0;

  for (const ref of references) {
    if (ref.measuredUnits <= 0.01 || ref.knownMeters <= 0.01) continue;
    const currentScale = ref.knownMeters / ref.measuredUnits;
    const weight = ref.type === 'lidar_benchmark' ? 3.0 : ref.type === 'door_standard' ? 2.0 : 1.0;

    weightedScale += currentScale * weight;
    totalWeight += weight;
  }

  if (totalWeight === 0) {
    return {
      isCalibratedMetric: false,
      scaleMetersPerUnit: 1.0,
      confidenceScore: 0.0,
      errorMarginPercent: 30.0,
      referenceUsed: 'Invalid references',
      calibratedAt: now,
      disclaimer: 'Failed to extract valid metric reference anchors from the scene.',
      disclaimerAr: 'فشل استخراج نقاط مرجعية هندسية صالحة من النموذج.',
    };
  }

  const finalScale = weightedScale / totalWeight;

  // Compute variance across references to determine confidence
  for (const ref of references) {
    const currentScale = ref.knownMeters / ref.measuredUnits;
    varianceSum += Math.pow(currentScale - finalScale, 2);
  }

  const standardDeviation = Math.sqrt(varianceSum / references.length);
  const errorMargin = (standardDeviation / finalScale) * 100;

  // Confidence formula: penalizes high variance and insufficient references
  const referenceCountBonus = Math.min(0.2, references.length * 0.07);
  const baseConfidence = Math.max(0.0, 1.0 - (errorMargin / 15.0));
  const confidenceScore = Math.min(1.0, Math.max(0.0, baseConfidence + referenceCountBonus));

  // Strict Threshold Gate: >= 0.90 required for calibrated certification
  const isCalibratedMetric = confidenceScore >= 0.90 && errorMargin <= 5.0;

  return {
    isCalibratedMetric,
    scaleMetersPerUnit: Number(finalScale.toFixed(4)),
    confidenceScore: Number(confidenceScore.toFixed(2)),
    errorMarginPercent: Number(errorMargin.toFixed(1)),
    referenceUsed: `${references.length} reference anchors (${references.map(r => r.type).join(', ')})`,
    calibratedAt: now,
    disclaimer: isCalibratedMetric
      ? 'Calibrated with verified architectural reference anchors (1:1 Metric Scale).'
      : 'Uncalibrated: error margin exceeds tolerance threshold. Do not use for contract or manufacturing specs.',
    disclaimerAr: isCalibratedMetric
      ? 'معاير بمقاييس هندسية حقيقية معتمدة (مقياس 1:1 متري).'
      : 'غير معاير بدقة كافية: نسبة الخطأ تتجاوز الحد المسموح. لا تستخدم الأبعاد في التعاقدات الرسمية.',
  };
}
