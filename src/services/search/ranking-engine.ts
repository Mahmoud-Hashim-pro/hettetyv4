/**
 * HETTETY Search Ranking & Grounded Match Engine
 * Scores candidate properties against structured criteria, generates match explanations,
 * and eliminates AI hallucinations by grounding all facts in actual property attributes.
 */

import {
  Property,
  StructuredSearchFilters,
  RankedPropertyResult,
  MatchReason,
} from '../../types';

export const rankAndFilterProperties = (
  properties: Property[],
  filters: StructuredSearchFilters
): RankedPropertyResult[] => {
  const results: RankedPropertyResult[] = [];

  for (const property of properties) {
    let score = 50; // Base score for published inventory
    const matchReasons: MatchReason[] = [];
    const extractedTags: string[] = [];
    let isDisqualified = false;

    // 1. Property Type Filter (Hard requirement)
    if (filters.propertyType && filters.propertyType.length > 0) {
      const typeMatches = filters.propertyType.some(
        (t) => t.toLowerCase() === (property.propertyType || '').toLowerCase()
      );
      if (typeMatches) {
        score += 15;
        matchReasons.push({
          criterion: 'propertyType',
          en: `Matches property type: ${property.propertyType}`,
          ar: `مطابق لنوع العقار: ${property.propertyType}`,
          isHardRequirement: true,
        });
        extractedTags.push(property.propertyType || '');
      } else {
        isDisqualified = true;
      }
    }

    // 2. Location Filter (Hard requirement)
    if (filters.locations && filters.locations.length > 0) {
      const locMatches = filters.locations.some(
        (loc) =>
          property.location.toLowerCase().includes(loc.toLowerCase()) ||
          (property.compound || '').toLowerCase().includes(loc.toLowerCase())
      );
      if (locMatches) {
        score += 15;
        matchReasons.push({
          criterion: 'location',
          en: `Located in requested destination: ${property.location}`,
          ar: `يقع في المنطقة المطلوبة: ${property.location}`,
          isHardRequirement: true,
        });
        extractedTags.push(property.location);
      } else {
        isDisqualified = true;
      }
    }

    // 3. Price Filter (Hard requirement)
    if (filters.priceMax !== undefined) {
      if (property.price <= filters.priceMax) {
        score += 10;
        const diffMillions = ((filters.priceMax - property.price) / 1000000).toFixed(1);
        matchReasons.push({
          criterion: 'price',
          en: `Within budget (${diffMillions}M EGP below max ceiling)`,
          ar: `داخل حدود الميزانية (أقل بـ ${diffMillions} مليون ج.م عن الحد الأقصى)`,
          isHardRequirement: true,
        });
      } else {
        isDisqualified = true;
      }
    }

    if (filters.priceMin !== undefined && property.price < filters.priceMin) {
      isDisqualified = true;
    }

    // 4. Bedrooms Filter (Hard requirement)
    if (filters.bedroomsMin !== undefined) {
      if (property.bedrooms >= filters.bedroomsMin) {
        score += 10;
        matchReasons.push({
          criterion: 'bedrooms',
          en: `Offers ${property.bedrooms} bedrooms (matches requirement)`,
          ar: `يحتوي على ${property.bedrooms} غرف نوم (مطابق للطلب)`,
          isHardRequirement: true,
        });
      } else {
        isDisqualified = true;
      }
    }

    // If hard requirements failed, do not present this property
    if (isDisqualified) continue;

    // 5. Amenities & Soft Features (Bonus points)
    if (filters.amenities && filters.amenities.length > 0) {
      const propAmenities = (property.amenities || []).map((a) => a.toLowerCase());
      const titleLower = property.title.toLowerCase();
      const descLower = (property.description || '').toLowerCase();

      for (const amenity of filters.amenities) {
        const aLower = amenity.toLowerCase();
        const hasAmenity =
          propAmenities.includes(aLower) ||
          titleLower.includes(aLower) ||
          descLower.includes(aLower) ||
          (aLower === 'balcony' && (property.view || '').toLowerCase().includes('terrace')) ||
          (aLower === 'garden' && (property.gardenArea || 0) > 0);

        if (hasAmenity) {
          score += 8;
          matchReasons.push({
            criterion: 'amenity',
            en: `Includes ${amenity}`,
            ar: `يشمل ميزة ${amenity}`,
            isHardRequirement: false,
          });
          extractedTags.push(amenity);
        }
      }
    }

    // 6. 3D Tour Availability Bonus
    const hasSpatialTour = Boolean(
      (property.threeDTour && property.threeDTour.status === 'ready') ||
      (property.digitalTwinUrl) ||
      (property.panoramas && property.panoramas.length > 0)
    );
    if (hasSpatialTour) {
      score += 10;
      if (filters.has3DTour) {
        matchReasons.push({
          criterion: '3dTour',
          en: 'Includes interactive 3D virtual walkthrough',
          ar: 'مزود بجولة ثلاثية الأبعاد تفاعلية',
          isHardRequirement: false,
        });
        extractedTags.push('3D Tour');
      }
    }

    // 7. Installments / Payment Plans
    const hasPaymentPlans = Boolean(property.paymentPlans && property.paymentPlans.length > 0);
    if (hasPaymentPlans && filters.hasInstallments) {
      score += 10;
      matchReasons.push({
        criterion: 'installments',
        en: 'Offers flexible installments and payment plans',
        ar: 'يتيح أنظمة سداد وتسهيلات بالتقسيط',
        isHardRequirement: false,
      });
      extractedTags.push('Installments');
    }

    // 8. Trust & Verification Bonus
    if (property.isVerified) {
      score += 5;
    }

    const finalScore = Math.min(100, Math.max(10, score));

    // 9. Grounded, Truthful Explanation (No hallucination)
    const topReasonsEn = matchReasons.map((r) => r.en).slice(0, 3).join('. ');
    const topReasonsAr = matchReasons.map((r) => r.ar).slice(0, 3).join('، ');

    const explanationEn = `Matches your criteria for ${property.title}: ${topReasonsEn}. Quoted at ${property.price.toLocaleString()} EGP in ${property.location}.`;
    const explanationAr = `يطابق مواصفات بحثك في ${property.title}: ${topReasonsAr}. بسعر ${property.price.toLocaleString()} ج.م في ${property.location}.`;

    results.push({
      property,
      relevanceScore: finalScore,
      matchReasons,
      extractedTags,
      explanationEn,
      explanationAr,
    });
  }

  // Sort results descending by relevanceScore, then price
  return results.sort((a, b) => b.relevanceScore - a.relevanceScore || a.property.price - b.property.price);
};
