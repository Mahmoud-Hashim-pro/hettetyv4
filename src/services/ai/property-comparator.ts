/**
 * HETTETY Multi-Property Comparison Engine
 * Computes objective financial & spatial metrics, analyzes tradeoffs,
 * and generates grounded comparative intelligence across 2-4 candidate properties.
 */

import { Property } from '../../types';

export interface PropertyMetricComparison {
  property: Property;
  pricePerSqm: number;
  monthlyEstimateEGP?: number;
  downPaymentEGP?: number;
  has3DTour: boolean;
  isVerified: boolean;
  strengthsEn: string[];
  strengthsAr: string[];
}

export interface ComparisonReport {
  properties: PropertyMetricComparison[];
  bestValuePropertyId: string;
  bestFamilyPropertyId: string;
  summaryEn: string;
  summaryAr: string;
}

export const compareProperties = (properties: Property[]): ComparisonReport => {
  if (properties.length === 0) {
    return {
      properties: [],
      bestValuePropertyId: '',
      bestFamilyPropertyId: '',
      summaryEn: 'No properties selected for comparison.',
      summaryAr: 'لم يتم اختيار عقارات للمقارنة.',
    };
  }

  const analyzed: PropertyMetricComparison[] = properties.map((p) => {
    const pricePerSqm = p.area > 0 ? Math.round(p.price / p.area) : 0;
    const has3D = Boolean(
      (p.threeDTour && p.threeDTour.status === 'ready') ||
      p.digitalTwinUrl ||
      (p.panoramas && p.panoramas.length > 0)
    );

    let monthlyEstimateEGP: number | undefined;
    let downPaymentEGP: number | undefined;

    if (p.paymentPlans && p.paymentPlans.length > 0) {
      const plan = p.paymentPlans[0];
      const years = plan.years || 7;
      const downPercent = plan.downPayment || 10;
      downPaymentEGP = Math.round((p.price * downPercent) / 100);
      const remaining = p.price - downPaymentEGP;
      monthlyEstimateEGP = Math.round(remaining / (years * 12));
    }

    const strengthsEn: string[] = [];
    const strengthsAr: string[] = [];

    if (p.isVerified) {
      strengthsEn.push('Verified documentation & ownership');
      strengthsAr.push('أوراق ملكية موثقة ومعتمدة');
    }
    if (has3D) {
      strengthsEn.push('Interactive 3D Virtual Tour');
      strengthsAr.push('جولة افتراضية ثلاثية الأبعاد');
    }
    if (p.paymentPlans && p.paymentPlans.length > 0) {
      strengthsEn.push(`Installments up to ${p.paymentPlans[0].years || 7} years`);
      strengthsAr.push(`تسهيلات سداد حتى ${p.paymentPlans[0].years || 7} سنوات`);
    }
    if (p.finishing === 'Fully Finished') {
      strengthsEn.push('Fully Finished — Move-in ready');
      strengthsAr.push('تشطيب كامل جاهز للسكن');
    }

    return {
      property: p,
      pricePerSqm,
      monthlyEstimateEGP,
      downPaymentEGP,
      has3DTour: has3D,
      isVerified: Boolean(p.isVerified),
      strengthsEn,
      strengthsAr,
    };
  });

  // Determine best price-per-sqm (Best Value)
  const sortedBySqm = [...analyzed].sort((a, b) => a.pricePerSqm - b.pricePerSqm);
  const bestValue = sortedBySqm[0];

  // Determine largest space / bedrooms (Best for Family)
  const sortedByFamily = [...analyzed].sort((a, b) => b.property.bedrooms - a.property.bedrooms || b.property.area - a.property.area);
  const bestFamily = sortedByFamily[0];

  const summaryEn = `Compared ${properties.length} properties. ${bestValue.property.title} offers the best price efficiency at ${bestValue.pricePerSqm.toLocaleString()} EGP/m². For larger families, ${bestFamily.property.title} provides the most spacious layout with ${bestFamily.property.bedrooms} bedrooms across ${bestFamily.property.area} m².`;

  const summaryAr = `مقارنة بين ${properties.length} عقارات. يُقدم "${bestValue.property.title}" أعلى كفاءة سعرية بمعدل ${bestValue.pricePerSqm.toLocaleString()} ج.م/م². وللعائلات الكبيرة، يتميز "${bestFamily.property.title}" بأكبر مساحة تضم ${bestFamily.property.bedrooms} غرف نوم على مساحة ${bestFamily.property.area} م².`;

  return {
    properties: analyzed,
    bestValuePropertyId: bestValue.property.id,
    bestFamilyPropertyId: bestFamily.property.id,
    summaryEn,
    summaryAr,
  };
};
