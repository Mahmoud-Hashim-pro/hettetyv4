/**
 * HETTETY Natural Language Query Parser
 * Translates English & Arabic natural language real-estate prompts into structured, validated search filters.
 */

import { StructuredSearchFilters } from '../../types';

// Arabic to Eastern Arabic numerals conversion helper
const normalizeNumerals = (str: string): string => {
  return str
    .replace(/[٠-٩]/g, (d) => '٠١٢٣٤٥٦٧٨٩'.indexOf(d).toString())
    .toLowerCase();
};

export const parseNaturalLanguageQuery = (rawQuery: string): StructuredSearchFilters => {
  const query = normalizeNumerals(rawQuery.trim());
  const filters: StructuredSearchFilters = {};

  if (!query) return filters;

  // 1. Property Type Extraction
  const types: string[] = [];
  if (/شقة|شقق|apartment|flat/i.test(query)) types.push('Apartment');
  if (/فيلا|فيلات|فلل|villa|stand-alone|standalone/i.test(query)) types.push('Villa');
  if (/شاليه|شاليهات|chalet/i.test(query)) types.push('Chalet');
  if (/دوبلكس|duplex/i.test(query)) types.push('Duplex');
  if (/تاون|تاون هاوس|townhouse/i.test(query)) types.push('Townhouse');
  if (/توين|توين هاوس|twinhouse|twin house/i.test(query)) types.push('Twinhouse');
  if (/بنتهاوس|روف|penthouse|roof/i.test(query)) types.push('Penthouse');
  if (/مكتب|إداري|اداري|office/i.test(query)) types.push('Office');
  if (/محل|تجاري|retail|shop/i.test(query)) types.push('Retail');
  if (types.length > 0) filters.propertyType = types;

  // 2. Location Extraction
  const locs: string[] = [];
  if (/تجمع|التجمع|قاهرة جديدة|القاهرة الجديدة|new cairo|tagamoa|fifth settlement/i.test(query)) {
    locs.push('New Cairo');
  }
  if (/زايد|الشيخ زايد|sheikh zayed|zayed/i.test(query)) {
    locs.push('Sheikh Zayed');
  }
  if (/ساحل|الساحل|الساحل الشمالي|north coast|sahel/i.test(query)) {
    locs.push('North Coast');
  }
  if (/أكتوبر|اكتوبر|6 اكتوبر|٦ اكتوبر|october|6th of october/i.test(query)) {
    locs.push('6th of October');
  }
  if (/معادي|المعادي|maadi/i.test(query)) {
    locs.push('Maadi');
  }
  if (/جونة|الجونة|gouna|el gouna/i.test(query)) {
    locs.push('El Gouna');
  }
  if (/عاصمة|العاصمة|new capital/i.test(query)) {
    locs.push('New Administrative Capital');
  }
  if (/شروق|الشروق|shorouk/i.test(query)) {
    locs.push('El Shorouk');
  }
  if (/مستقبل|المستقبل|mostakbal/i.test(query)) {
    locs.push('Mostakbal City');
  }
  if (locs.length > 0) filters.locations = locs;

  // 3. Bedrooms Extraction
  // Handle phrases like "3 bedrooms", "3 bedroom", "3 غرف", "غرفتين", "استوديو"
  const bedMatch = query.match(/(\d+)\s*(?:غرف|غرفة|bed|beds|bedroom|bedrooms)/i);
  if (bedMatch) {
    const beds = parseInt(bedMatch[1], 10);
    filters.bedroomsMin = beds;
    filters.bedroomsMax = beds;
  } else if (/غرفتين|غرفتان|2\s*غرف/i.test(query)) {
    filters.bedroomsMin = 2;
    filters.bedroomsMax = 2;
  } else if (/استوديو|ستوديو|studio/i.test(query)) {
    filters.bedroomsMin = 0;
    filters.bedroomsMax = 1;
  }

  // 4. Price Extraction (Million EGP parsing)
  // Matches "under 8m", "under 8 million", "less than 8m", "أقل من 8 مليون", "تحت 8 مليون", "8m", "8 مليون"
  const maxPriceMatch = query.match(/(?:under|less than|below|max|up to|أقل من|اقل من|تحت|حتى|حد أقصى)\s*(\d+(?:\.\d+)?)\s*(?:m|million|مليون|م)/i);
  if (maxPriceMatch) {
    filters.priceMax = parseFloat(maxPriceMatch[1]) * 1000000;
  } else {
    // Check for range: "between 5m and 8m" or "من 5 الى 8 مليون"
    const rangeMatch = query.match(/(?:between|من)\s*(\d+(?:\.\d+)?)\s*(?:and|to|إلى|الى)\s*(\d+(?:\.\d+)?)\s*(?:m|million|مليون)/i);
    if (rangeMatch) {
      filters.priceMin = parseFloat(rangeMatch[1]) * 1000000;
      filters.priceMax = parseFloat(rangeMatch[2]) * 1000000;
    } else {
      // Direct price with "under": "under 8000000"
      const rawNumUnder = query.match(/(?:under|less than|below|أقل من|اقل من|تحت)\s*(\d{6,10})/i);
      if (rawNumUnder) {
        filters.priceMax = parseInt(rawNumUnder[1], 10);
      }
    }
  }

  // 5. Amenities & Features Extraction
  const amenities: string[] = [];
  if (/بسين|مسبح|حمام سباحة|pool/i.test(query)) amenities.push('Pool');
  if (/حديقة|جنينة|garden/i.test(query)) amenities.push('Garden');
  if (/بلكونة|تراس|شرفة|balcony|terrace/i.test(query)) amenities.push('Balcony');
  if (/بحر|فيو بحر|شاطئ|sea view|beach/i.test(query)) amenities.push('Sea View');
  if (/كلوب هاوس|نادي|clubhouse/i.test(query)) amenities.push('Clubhouse');
  if (/أمن|حراسة|security/i.test(query)) amenities.push('Security');
  if (amenities.length > 0) filters.amenities = amenities;

  // 6. 3D Tour Preference
  if (/3d|3d tour|جولة 3d|جولة افتراضية|virtual tour|تجسيم/i.test(query)) {
    filters.has3DTour = true;
  }

  // 7. Payment Terms / Installments
  if (/تقسيط|تسهيلات|اقساط|أقساط|installment|installments|payment plan/i.test(query)) {
    filters.hasInstallments = true;
  }

  // 8. Delivery Timeline
  if (/استلام فوري|جاهز|جاهزة|تسليم فوري|ready|immediate/i.test(query)) {
    filters.deliveryTimeline = ['Ready'];
  }

  // 9. Finishing
  if (/تشطيب كامل|الترا سوبر لوكس|سوبر لوكس|fully finished|finished/i.test(query)) {
    filters.finishing = ['Fully Finished'];
  } else if (/نصف تشطيب|محارة|semi finished|core & shell/i.test(query)) {
    filters.finishing = ['Semi Finished'];
  }

  return filters;
};

/**
 * Converts structured filters into user-facing bilingual UI tags.
 */
export const formatFiltersToTags = (filters: StructuredSearchFilters, isRtl: boolean = false): string[] => {
  const tags: string[] = [];

  if (filters.propertyType && filters.propertyType.length > 0) {
    tags.push(...filters.propertyType);
  }

  if (filters.locations && filters.locations.length > 0) {
    tags.push(...filters.locations);
  }

  if (filters.bedroomsMin !== undefined) {
    tags.push(isRtl ? `${filters.bedroomsMin} غرف` : `${filters.bedroomsMin} Beds`);
  }

  if (filters.priceMax !== undefined) {
    const millions = filters.priceMax / 1000000;
    tags.push(isRtl ? `أقل من ${millions} مليون ج.م` : `< ${millions}M EGP`);
  }

  if (filters.amenities && filters.amenities.length > 0) {
    tags.push(...filters.amenities);
  }

  if (filters.has3DTour) {
    tags.push(isRtl ? 'جولة 3D فراغية' : '3D Tour');
  }

  if (filters.hasInstallments) {
    tags.push(isRtl ? 'تسهيلات وتقسيط' : 'Installments');
  }

  return tags;
};
