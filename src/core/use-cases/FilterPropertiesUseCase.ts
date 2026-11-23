/**
 * HETTETY Clean Architecture — Property Filtering & Sorting Engine
 *
 * Implements the Specification Pattern + Strategy Pattern (SOLID: SRP & OCP):
 * - Each filter facet is an isolated, pure PropertySpecification.
 * - Each sort order is an isolated, pure PropertySortComparator strategy.
 * - Extending with new filter rules or sort modes requires registering a new
 *   specification/strategy without rewriting core execution logic.
 * - Strictly truthful: ZERO demo/fallback property injection on empty inventory.
 */

import {
  Property,
  PropertyFilterCriteria,
  PropertySortOption,
  DEFAULT_PROPERTY_FILTER_CRITERIA,
} from '../domain/entities';

export interface PropertySpecification {
  readonly name: string;
  isActive(criteria: PropertyFilterCriteria): boolean;
  isSatisfiedBy(property: Property, criteria: PropertyFilterCriteria): boolean;
}

export type PropertySortComparator = (a: Property, b: Property) => number;

export interface DistrictFacet {
  name: string;
  count: number;
}

const COASTAL_REGEX =
  /ساحل|sahel|north coast|الساحل|مارينا|marina|marassi|مراسي|راس الحكمة|رأس الحكمة|ras el|hacienda|هاسيندا|العلمين|alamein|بورتو|porto|جايا|gaia|سيدي عبد|sidi abdel|فوكا|fouka|سيدي حنيش|sidi heneish|أمواج|amwaj/i;

const READY_REGEX = /ready|immediate|move[\s-]?in|فوري|جاهز/i;
const OFF_PLAN_LONG_REGEX = /3\+|off[\s-]?plan|تحت الإنشاء|2029|2030|2031|2032/i;

/** Returns true ONLY when the property has a genuine 3D reconstruction or digital twin asset URL. */
export function hasReal3DTour(property: Property): boolean {
  const assetUrl = property.threeDTour?.assetUrl?.trim();
  const twinUrl = property.digitalTwinUrl?.trim();
  return Boolean(assetUrl || twinUrl);
}

/** Returns true when a property has valid numeric price and area for price/m² calculation. */
export function getPricePerSqm(property: Property): number | null {
  if (
    typeof property.price !== 'number' ||
    !Number.isFinite(property.price) ||
    property.price <= 0 ||
    typeof property.area !== 'number' ||
    !Number.isFinite(property.area) ||
    property.area <= 0
  ) {
    return null;
  }
  return Math.round(property.price / property.area);
}

/** Parses a numeric filter string cleanly, returning null if empty or non-numeric. */
function parseNumericBound(raw: string | number | undefined | null): number | null {
  if (raw === undefined || raw === null) return null;
  const str = String(raw).trim();
  if (!str) return null;
  const num = Number(str);
  return Number.isFinite(num) ? num : null;
}

/** Extracts a 4-digit year from a delivery date string if present. */
function extractYear(value?: string): number | null {
  if (!value) return null;
  const match = value.match(/\b(20\d{2})\b/);
  return match ? Number(match[1]) : null;
}

/**
 * Built-in Specifications (SRP: one predicate responsibility per specification)
 */

export const AiFilteredIdsSpecification: PropertySpecification = {
  name: 'aiFilteredIds',
  isActive: (criteria) => Array.isArray(criteria.aiFilteredIds),
  isSatisfiedBy: (property, criteria) =>
    Array.isArray(criteria.aiFilteredIds) ? criteria.aiFilteredIds.includes(property.id) : true,
};

export const TextQuerySpecification: PropertySpecification = {
  name: 'query',
  // When AI semantic IDs are explicitly active, do not double-restrict with substring matching.
  isActive: (criteria) => criteria.aiFilteredIds === null && criteria.query.trim().length > 0,
  isSatisfiedBy: (property, criteria) => {
    const needle = criteria.query.trim().toLowerCase();
    if (!needle) return true;
    const haystack = [
      property.title,
      property.location,
      property.compound,
      property.developer,
      property.description,
      property.unitCode,
      property.village,
      property.propertyType,
      property.phase,
    ]
      .filter(Boolean)
      .join(' ')
      .toLowerCase();
    return haystack.includes(needle);
  },
};

export const PropertyTypeSpecification: PropertySpecification = {
  name: 'type',
  isActive: (criteria) => Boolean(criteria.type) && criteria.type !== 'all',
  isSatisfiedBy: (property, criteria) =>
    (property.propertyType || '').trim().toLowerCase() === criteria.type.trim().toLowerCase(),
};

export const ListingStatusSpecification: PropertySpecification = {
  name: 'listingStatus',
  isActive: (criteria) => criteria.listingStatus !== 'all',
  isSatisfiedBy: (property, criteria) => property.status === criteria.listingStatus,
};

export const MinPriceSpecification: PropertySpecification = {
  name: 'minPrice',
  isActive: (criteria) => parseNumericBound(criteria.minPrice) !== null,
  isSatisfiedBy: (property, criteria) => {
    const min = parseNumericBound(criteria.minPrice);
    if (min === null) return true;
    return property.price != null && Number.isFinite(property.price) && property.price >= min;
  },
};

export const MaxPriceSpecification: PropertySpecification = {
  name: 'maxPrice',
  isActive: (criteria) => parseNumericBound(criteria.maxPrice) !== null,
  isSatisfiedBy: (property, criteria) => {
    const max = parseNumericBound(criteria.maxPrice);
    if (max === null) return true;
    return property.price != null && Number.isFinite(property.price) && property.price <= max;
  },
};

export const MinAreaSpecification: PropertySpecification = {
  name: 'minArea',
  isActive: (criteria) => parseNumericBound(criteria.minArea) !== null,
  isSatisfiedBy: (property, criteria) => {
    const min = parseNumericBound(criteria.minArea);
    if (min === null) return true;
    const effectiveArea = property.areaTo && property.areaTo > property.area ? property.areaTo : property.area;
    return effectiveArea != null && Number.isFinite(effectiveArea) && effectiveArea >= min;
  },
};

export const MaxAreaSpecification: PropertySpecification = {
  name: 'maxArea',
  isActive: (criteria) => parseNumericBound(criteria.maxArea) !== null,
  isSatisfiedBy: (property, criteria) => {
    const max = parseNumericBound(criteria.maxArea);
    if (max === null) return true;
    return property.area != null && Number.isFinite(property.area) && property.area <= max;
  },
};

export const MinBedroomsSpecification: PropertySpecification = {
  name: 'minBedrooms',
  isActive: (criteria) => criteria.minBedrooms > 0,
  isSatisfiedBy: (property, criteria) => (property.bedrooms ?? 0) >= criteria.minBedrooms,
};

export const MinBathroomsSpecification: PropertySpecification = {
  name: 'minBathrooms',
  isActive: (criteria) => criteria.minBathrooms > 0,
  isSatisfiedBy: (property, criteria) => (property.bathrooms ?? 0) >= criteria.minBathrooms,
};

export const FinishingSpecification: PropertySpecification = {
  name: 'finishing',
  isActive: (criteria) => Boolean(criteria.finishing) && criteria.finishing !== 'all',
  isSatisfiedBy: (property, criteria) => {
    const propFinishing = (property.finishing || '').trim().toLowerCase();
    const target = criteria.finishing.trim().toLowerCase();
    if (!propFinishing) return false;
    if (target === 'fully finished') {
      return propFinishing === 'fully finished' || propFinishing === 'finished';
    }
    return propFinishing === target;
  },
};

export const DeliveryTimelineSpecification: PropertySpecification = {
  name: 'deliveryTimeline',
  isActive: (criteria) => Boolean(criteria.deliveryTimeline) && criteria.deliveryTimeline !== 'all',
  isSatisfiedBy: (property, criteria) => {
    const target = criteria.deliveryTimeline.trim().toLowerCase();
    const propTimeline = (property.deliveryTimeline || '').trim().toLowerCase();
    const deliveryDate = (property.deliveryDate || '').trim();
    const currentYear = new Date().getFullYear();
    const deliveryYear = extractYear(deliveryDate);

    if (target === 'ready') {
      return propTimeline === 'ready' || READY_REGEX.test(deliveryDate);
    }

    if (target === '1-2years') {
      if (propTimeline === '1-2years') return true;
      if (READY_REGEX.test(deliveryDate)) return false;
      if (deliveryYear !== null) {
        return deliveryYear >= currentYear && deliveryYear <= currentYear + 2;
      }
      return /1[\s-]?2/i.test(deliveryDate);
    }

    if (target === '3+years') {
      if (propTimeline === '3+years') return true;
      if (deliveryYear !== null) {
        return deliveryYear >= currentYear + 3;
      }
      return OFF_PLAN_LONG_REGEX.test(deliveryDate);
    }

    return propTimeline === target || deliveryDate.toLowerCase().includes(target);
  },
};

export const DistrictSpecification: PropertySpecification = {
  name: 'district',
  isActive: (criteria) => Boolean(criteria.district) && criteria.district !== 'all',
  isSatisfiedBy: (property, criteria) => {
    const target = criteria.district.trim().toLowerCase();
    const combined = `${property.location || ''} ${property.compound || ''} ${property.village || ''}`.toLowerCase();
    return combined.includes(target);
  },
};

export const VerifiedOnlySpecification: PropertySpecification = {
  name: 'verifiedOnly',
  isActive: (criteria) => criteria.verifiedOnly === true,
  isSatisfiedBy: (property) =>
    property.verificationStatus === 'Verified' ||
    (property.verificationStatus === undefined && property.isVerified === true),
};

export const Has3DOnlySpecification: PropertySpecification = {
  name: 'has3DOnly',
  isActive: (criteria) => criteria.has3DOnly === true,
  isSatisfiedBy: (property) => hasReal3DTour(property),
};

export const InstallmentsOnlySpecification: PropertySpecification = {
  name: 'installmentsOnly',
  isActive: (criteria) => criteria.installmentsOnly === true,
  isSatisfiedBy: (property) => {
    if (Array.isArray(property.paymentPlans) && property.paymentPlans.length > 0) {
      return true;
    }
    if (Array.isArray(property.paymentMethods)) {
      return property.paymentMethods.some((m) => /installment|تقسيط/i.test(m));
    }
    return false;
  },
};

export const YallaSahelOnlySpecification: PropertySpecification = {
  name: 'yallaSahelOnly',
  isActive: (criteria) => criteria.yallaSahelOnly === true,
  isSatisfiedBy: (property) => {
    if (property.yallaSahel === true) return true;
    if ((property.propertyType || '').toLowerCase() === 'chalet') return true;
    if (property.village && property.village.trim().length > 0) return true;
    return COASTAL_REGEX.test(`${property.location || ''} ${property.compound || ''}`);
  },
};

export const DEFAULT_SPECIFICATIONS: readonly PropertySpecification[] = [
  AiFilteredIdsSpecification,
  TextQuerySpecification,
  PropertyTypeSpecification,
  ListingStatusSpecification,
  MinPriceSpecification,
  MaxPriceSpecification,
  MinAreaSpecification,
  MaxAreaSpecification,
  MinBedroomsSpecification,
  MinBathroomsSpecification,
  FinishingSpecification,
  DeliveryTimelineSpecification,
  DistrictSpecification,
  VerifiedOnlySpecification,
  Has3DOnlySpecification,
  InstallmentsOnlySpecification,
  YallaSahelOnlySpecification,
];

/**
 * Built-in Sort Strategies (Strategy Pattern)
 */
export const DEFAULT_SORT_STRATEGIES: Record<PropertySortOption, PropertySortComparator> = {
  default: () => 0,
  newest: (a, b) => (b.publishDate || '').localeCompare(a.publishDate || ''),
  'price-asc': (a, b) => {
    const pa = a.price && a.price > 0 ? a.price : Number.POSITIVE_INFINITY;
    const pb = b.price && b.price > 0 ? b.price : Number.POSITIVE_INFINITY;
    return pa - pb;
  },
  'price-desc': (a, b) => (b.price || 0) - (a.price || 0),
  'price-per-sqm-asc': (a, b) => {
    const ppsmA = getPricePerSqm(a) ?? Number.POSITIVE_INFINITY;
    const ppsmB = getPricePerSqm(b) ?? Number.POSITIVE_INFINITY;
    return ppsmA - ppsmB;
  },
  'area-desc': (a, b) => (b.area || 0) - (a.area || 0),
  'name-asc': (a, b) => (a.title || '').localeCompare(b.title || ''),
  'name-desc': (a, b) => (b.title || '').localeCompare(a.title || ''),
};

/**
 * Use Case orchestrating composable Specifications and Sort Strategies.
 */
export class FilterPropertiesUseCase {
  private readonly specifications: PropertySpecification[];
  private readonly sortStrategies: Map<PropertySortOption, PropertySortComparator>;

  constructor(
    specifications: readonly PropertySpecification[] = DEFAULT_SPECIFICATIONS,
    sortStrategies: Partial<Record<PropertySortOption, PropertySortComparator>> = DEFAULT_SORT_STRATEGIES
  ) {
    this.specifications = [...specifications];
    this.sortStrategies = new Map<PropertySortOption, PropertySortComparator>(
      Object.entries({ ...DEFAULT_SORT_STRATEGIES, ...sortStrategies }) as Array<
        [PropertySortOption, PropertySortComparator]
      >
    );
  }

  /** OCP extension hook: add a new filter specification without modifying existing code. */
  public registerSpecification(spec: PropertySpecification): void {
    this.specifications.push(spec);
  }

  /** OCP extension hook: register or override a sort comparator strategy. */
  public registerSortStrategy(option: PropertySortOption, comparator: PropertySortComparator): void {
    this.sortStrategies.set(option, comparator);
  }

  /** Filters properties truthfully; never injects demo listings when empty. */
  public filter(properties: Property[], criteria: PropertyFilterCriteria): Property[] {
    if (!Array.isArray(properties) || properties.length === 0) {
      return [];
    }

    const activeSpecs = this.specifications.filter((spec) => spec.isActive(criteria));
    if (activeSpecs.length === 0) {
      return [...properties];
    }

    return properties.filter((property) =>
      activeSpecs.every((spec) => spec.isSatisfiedBy(property, criteria))
    );
  }

  /** Sorts a copy of the provided properties according to the selected strategy. */
  public sort(
    properties: Property[],
    sortBy: PropertySortOption,
    aiOrderIds?: string[] | null
  ): Property[] {
    if (properties.length <= 1) return [...properties];

    const result = [...properties];
    if (sortBy === 'default') {
      if (Array.isArray(aiOrderIds) && aiOrderIds.length > 0) {
        const orderIndex = new Map(aiOrderIds.map((id, idx) => [id, idx]));
        result.sort((a, b) => {
          const idxA = orderIndex.get(a.id) ?? Number.MAX_SAFE_INTEGER;
          const idxB = orderIndex.get(b.id) ?? Number.MAX_SAFE_INTEGER;
          return idxA - idxB;
        });
      }
      return result;
    }

    const comparator = this.sortStrategies.get(sortBy);
    if (comparator) {
      result.sort(comparator);
    }
    return result;
  }

  /** Executes full filter + sort pipeline truthfully. */
  public execute(properties: Property[], criteria: PropertyFilterCriteria): Property[] {
    const filtered = this.filter(properties, criteria);
    return this.sort(filtered, criteria.sortBy, criteria.aiFilteredIds);
  }
}

const defaultUseCase = new FilterPropertiesUseCase();

/** Pure convenience function for filtering and sorting properties. */
export function filterAndSortProperties(
  properties: Property[],
  criteria: PropertyFilterCriteria
): Property[] {
  return defaultUseCase.execute(properties, criteria);
}

/** Counts total active filters across primary and advanced facets (excludes sort order). */
export function countActiveFilters(criteria: PropertyFilterCriteria): number {
  let count = 0;
  if (criteria.query.trim().length > 0) count += 1;
  if (criteria.type && criteria.type !== 'all') count += 1;
  if (criteria.listingStatus && criteria.listingStatus !== 'all') count += 1;
  if (parseNumericBound(criteria.minPrice) !== null) count += 1;
  if (parseNumericBound(criteria.maxPrice) !== null) count += 1;
  if (parseNumericBound(criteria.minArea) !== null) count += 1;
  if (parseNumericBound(criteria.maxArea) !== null) count += 1;
  if (criteria.minBedrooms > 0) count += 1;
  if (criteria.minBathrooms > 0) count += 1;
  if (criteria.finishing && criteria.finishing !== 'all') count += 1;
  if (criteria.deliveryTimeline && criteria.deliveryTimeline !== 'all') count += 1;
  if (criteria.district && criteria.district !== 'all') count += 1;
  if (criteria.verifiedOnly) count += 1;
  if (criteria.has3DOnly) count += 1;
  if (criteria.installmentsOnly) count += 1;
  if (criteria.yallaSahelOnly) count += 1;
  if (criteria.aiFilteredIds !== null && criteria.query.trim().length === 0) count += 1;
  return count;
}

/** Counts only active filters belonging to the expandable Advanced Filters drawer. */
export function countAdvancedFilters(criteria: PropertyFilterCriteria): number {
  let count = 0;
  if (criteria.listingStatus && criteria.listingStatus !== 'all') count += 1;
  if (parseNumericBound(criteria.minArea) !== null) count += 1;
  if (parseNumericBound(criteria.maxArea) !== null) count += 1;
  if (criteria.minBedrooms > 0) count += 1;
  if (criteria.minBathrooms > 0) count += 1;
  if (criteria.finishing && criteria.finishing !== 'all') count += 1;
  if (criteria.deliveryTimeline && criteria.deliveryTimeline !== 'all') count += 1;
  if (criteria.district && criteria.district !== 'all') count += 1;
  if (criteria.verifiedOnly) count += 1;
  if (criteria.has3DOnly) count += 1;
  if (criteria.installmentsOnly) count += 1;
  if (criteria.yallaSahelOnly) count += 1;
  return count;
}

/** Normalizes a property's location into a clean district label for faceted navigation. */
function normalizeDistrictLabel(location?: string): string | null {
  if (!location || !location.trim()) return null;
  const primarySegment = location.split(',')[0].trim();
  if (!primarySegment) return null;
  return primarySegment;
}

/** Extracts sorted district facets with listing counts from the active inventory. */
export function extractDistrictFacets(properties: Property[]): DistrictFacet[] {
  if (!Array.isArray(properties) || properties.length === 0) {
    return [];
  }

  const bucket = new Map<string, { label: string; count: number }>();

  for (const property of properties) {
    const label = normalizeDistrictLabel(property.location);
    if (!label) continue;
    const key = label.toLowerCase();
    const existing = bucket.get(key);
    if (existing) {
      existing.count += 1;
    } else {
      bucket.set(key, { label, count: 1 });
    }
  }

  return Array.from(bucket.values())
    .map(({ label, count }) => ({ name: label, count }))
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
}

export { DEFAULT_PROPERTY_FILTER_CRITERIA };
