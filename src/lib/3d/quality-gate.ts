/**
 * HETTETY 3D — Multi-Stage Quality Gate & Tour Certification Engine
 * Evaluates real telemetry across Capture, Gaussian Splatting, and Metric Mesh phases.
 * Guarantees tours only reach 'READY' status when all geometric and visual invariants pass.
 */

export interface CaptureTelemetry {
  imageCount: number;
  avgResolution: [number, number];
  blurScore: number;     // 0-100 (Laplacian variance normalized)
  overlapScore: number;  // 0-100
  coverageScore: number; // 0-100
}

export interface GaussianTelemetry {
  splatCount: number;
  bounds: { min: [number, number, number]; max: [number, number, number] };
  spzSizeBytes: number;
  hasNaNOrInf: boolean;
}

export interface MeshTelemetry {
  vertexCount: number;
  faceCount: number;
  glbSizeBytes: number;
  isCalibratedMetric: boolean;
  calibrationConfidence: number;
}

export interface QualityGateEvaluation {
  passed: boolean;
  overallScore: number; // 0-100
  status: 'READY' | 'REJECTED' | 'WARNING';
  captureCheck: { passed: boolean; score: number; issues: string[]; issuesAr: string[] };
  gaussianCheck: { passed: boolean; score: number; issues: string[]; issuesAr: string[] };
  meshCheck: { passed: boolean; score: number; issues: string[]; issuesAr: string[] };
  checks?: {
    cameraAlignment?: { passed: boolean; score: number; issues: string[] };
    gaussianSplatting?: { passed: boolean; score: number; issues: string[] };
    meshGeometry?: { passed: boolean; score: number; issues: string[] };
    metricCalibration?: { passed: boolean; score: number; issues: string[] };
  };
  reasons?: string[];
  recommendations: string[];
  recommendationsAr: string[];
}

export function evaluateTourQualityGate(
  capture: CaptureTelemetry,
  gaussian: GaussianTelemetry,
  mesh: MeshTelemetry
): QualityGateEvaluation {
  const captureIssues: string[] = [];
  const captureIssuesAr: string[] = [];
  const gaussianIssues: string[] = [];
  const gaussianIssuesAr: string[] = [];
  const meshIssues: string[] = [];
  const meshIssuesAr: string[] = [];
  const recommendations: string[] = [];
  const recommendationsAr: string[] = [];

  // 1. Capture Check
  let capturePassed = true;
  if (capture.imageCount < 8) {
    capturePassed = false;
    captureIssues.push(`Insufficient capture count: ${capture.imageCount} (minimum 8 required)`);
    captureIssuesAr.push(`عدد اللقطات غير كافٍ: ${capture.imageCount} (الحد الأدنى 8 صور)`);
  }
  if (capture.blurScore < 50) {
    capturePassed = false;
    captureIssues.push(`High blur detected: sharpness score ${capture.blurScore}/100`);
    captureIssuesAr.push(`اهتزاز أو ضبابية عالية في اللقطات: نسبة الحدة ${capture.blurScore}/100`);
  }
  if (capture.overlapScore < 35) {
    captureIssues.push(`Low visual overlap between adjacent angles: ${capture.overlapScore}%`);
    captureIssuesAr.push(`نسبة تداخل منخفضة بين الزوايا: ${capture.overlapScore}%`);
  }
  const captureScore = Math.round(
    Math.min(100, (capture.imageCount / 40) * 40 + (capture.blurScore * 0.3) + (capture.overlapScore * 0.3))
  );

  // 2. Gaussian Check
  let gaussianPassed = true;
  if (gaussian.splatCount < 100) {
    gaussianPassed = false;
    gaussianIssues.push(`Zero or insufficient Gaussian primitives: ${gaussian.splatCount}`);
    gaussianIssuesAr.push(`عدد النقاط الفراغية غير كافٍ: ${gaussian.splatCount}`);
  }
  if (gaussian.hasNaNOrInf) {
    gaussianPassed = false;
    gaussianIssues.push('Corrupted coordinates detected (NaN or Infinity in point cloud)');
    gaussianIssuesAr.push('إحداثيات تالفة تحتوي على قيم غير محددة (NaN/Infinity)');
  }
  if (gaussian.spzSizeBytes < 100) {
    gaussianPassed = false;
    gaussianIssues.push(`SPZ payload is unusually small (${gaussian.spzSizeBytes} bytes)`);
    gaussianIssuesAr.push(`حجم ملف SPZ صغير بشكل غير طبيعي`);
  }
  const gaussianScore = Math.round(
    Math.min(100, Math.min(60, (gaussian.splatCount / 100000) * 60) + (gaussianPassed ? 40 : 0))
  );

  // 3. Mesh Check
  let meshPassed = true;
  if (mesh.vertexCount < 4 || mesh.faceCount < 2) {
    meshPassed = false;
    meshIssues.push(`Degenerate metric mesh: ${mesh.vertexCount} vertices, ${mesh.faceCount} faces`);
    meshIssuesAr.push(`مجسم متري غير مكتمل الأضلاع`);
  }
  if (mesh.glbSizeBytes < 100) {
    meshPassed = false;
    meshIssues.push('Invalid GLB file size (< 100 bytes)');
    meshIssuesAr.push('ملف GLB غير صالح أو فارغ');
  }
  const meshScore = Math.round(
    Math.min(100, (mesh.faceCount > 20 ? 50 : 30) + (mesh.isCalibratedMetric ? 50 : 20))
  );

  const passed = capturePassed && gaussianPassed && meshPassed;
  const overallScore = Math.round(captureScore * 0.35 + gaussianScore * 0.40 + meshScore * 0.25);
  const status = passed ? (overallScore >= 80 ? 'READY' : 'WARNING') : 'REJECTED';

  if (!mesh.isCalibratedMetric) {
    recommendations.push('Model requires physical scale anchor calibration before enabling certified contract measurements.');
    recommendationsAr.push('النموذج يتطلب معايرة مقياس حقيقي قبل تفعيل القياسات التعاقدية المعتمدة.');
  }

  return {
    passed,
    overallScore,
    status,
    captureCheck: { passed: capturePassed, score: captureScore, issues: captureIssues, issuesAr: captureIssuesAr },
    gaussianCheck: { passed: gaussianPassed, score: gaussianScore, issues: gaussianIssues, issuesAr: gaussianIssuesAr },
    meshCheck: { passed: meshPassed, score: meshScore, issues: meshIssues, issuesAr: meshIssuesAr },
    recommendations,
    recommendationsAr,
  };
}
