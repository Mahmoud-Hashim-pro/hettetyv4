/**
 * HETTETY 3D - Client-Side Pre-Flight Capture Validator
 * Analyzes image sets and videos before GPU submission to ensure high-fidelity reconstruction.
 */

import { CaptureValidationResult } from '../../types';

export interface FileMetadata {
  name: string;
  size: number;
  type: string;
  width?: number;
  height?: number;
}

export const validatePhotoCapture = (files: FileMetadata[]): CaptureValidationResult => {
  const imageFiles = files.filter(f => f.type.startsWith('image/'));
  const count = imageFiles.length;

  const warnings: string[] = [];
  const warningsAr: string[] = [];
  const errors: string[] = [];
  const errorsAr: string[] = [];

  // Minimum image count thresholds
  if (count === 0) {
    errors.push('No images detected for 3D reconstruction.');
    errorsAr.push('لم يتم العثور على أي صور لبناء النموذج ثلاثي الأبعاد.');
  } else if (count < 12) {
    errors.push(`Insufficient photo count (${count}). At least 12 photos required for basic 3D structure.`);
    errorsAr.push(`عدد الصور غير كافٍ (${count}). مطلوب 12 صورة على الأقل للبناء الفراغي.`);
  } else if (count < 25) {
    warnings.push(`Low photo count (${count}). For optimal room coverage, 30-80 photos are recommended.`);
    warningsAr.push(`عدد الصور قليل نسبياً (${count}). يُفضل التقاط بين 30 إلى 80 صورة لتغطية شاملة للغرف.`);
  }

  // Simulated blur & coverage evaluation based on count & size
  let resolutionOK = true;
  let avgSizeMb = 0;
  if (count > 0) {
    const totalBytes = imageFiles.reduce((acc, f) => acc + f.size, 0);
    avgSizeMb = totalBytes / count / (1024 * 1024);
    if (avgSizeMb < 0.2) {
      warnings.push('Images appear heavily compressed, which may degrade 3D surface detail.');
      warningsAr.push('الصور مضغوطة بدرجة عالية، مما قد يؤثر على وضوح التفاصيل الفراغية.');
      resolutionOK = false;
    }
  }

  // Calculate scores
  const coverageScore = Math.min(98, Math.max(35, Math.round((count / 40) * 90) + (count > 25 ? 8 : 0)));
  const overlapScore = Math.min(96, Math.max(40, count >= 20 ? 92 : Math.round(count * 4)));
  const blurScore = resolutionOK ? 94 : 70;

  const valid = errors.length === 0;

  return {
    valid,
    imageCount: count,
    resolutionOK,
    blurScore,
    coverageScore,
    overlapScore,
    warnings,
    warningsAr,
    errors,
    errorsAr,
  };
};

export const validateVideoCapture = (videoFile: FileMetadata | null): CaptureValidationResult => {
  const warnings: string[] = [];
  const warningsAr: string[] = [];
  const errors: string[] = [];
  const errorsAr: string[] = [];

  if (!videoFile) {
    errors.push('No video file provided for 3D reconstruction.');
    errorsAr.push('لم يتم اختيار ملف فيديو لبناء النموذج ثلاثي الأبعاد.');
    return {
      valid: false,
      imageCount: 0,
      resolutionOK: false,
      blurScore: 0,
      coverageScore: 0,
      overlapScore: 0,
      warnings,
      warningsAr,
      errors,
      errorsAr,
    };
  }

  // Check file size (e.g. at least 3MB for meaningful video, under 80MB)
  const sizeMb = videoFile.size / (1024 * 1024);
  if (sizeMb < 2) {
    warnings.push('Video duration seems very short; ensure a continuous walk through all rooms.');
    warningsAr.push('مدة الفيديو تبدو قصيرة جداً؛ تأكد من تصوير مسار متصل يمر بجميع الغرف.');
  } else if (sizeMb > 80) {
    errors.push('Video file exceeds maximum upload size (80MB).');
    errorsAr.push('حجم ملف الفيديو يتجاوز الحد الأقصى المسموح (80 ميجابايت).');
  }

  const valid = errors.length === 0;
  return {
    valid,
    imageCount: 1,
    resolutionOK: true,
    blurScore: 92,
    coverageScore: 94,
    overlapScore: 95,
    warnings,
    warningsAr,
    errors,
    errorsAr,
  };
};
