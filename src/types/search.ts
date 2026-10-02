/**
 * HETTETY Structured Search & Discovery Engine Schemas
 */

import { Property } from '../types';

export interface StructuredSearchFilters {
  propertyType?: string[];       // e.g. ['Apartment', 'Villa', 'Duplex', 'Chalet', 'Penthouse']
  locations?: string[];          // e.g. ['New Cairo', 'Sheikh Zayed', 'North Coast', '6th of October']
  bedroomsMin?: number;
  bedroomsMax?: number;
  bathroomsMin?: number;
  priceMin?: number;
  priceMax?: number;
  areaMin?: number;
  areaMax?: number;
  finishing?: string[];          // e.g. ['Fully Finished', 'Finished', 'Semi Finished']
  amenities?: string[];          // e.g. ['Pool', 'Garden', 'Balcony', 'Clubhouse', 'Security', 'Sea View']
  has3DTour?: boolean;           // Preference for listings with 3D Tour / Spatial walkthrough
  hasInstallments?: boolean;     // Available payment plans / installments
  downPaymentMax?: number;
  deliveryTimeline?: string[];   // e.g. ['Ready', '1-2years', '3+years']
  isResale?: boolean;
  keywords?: string[];
}

export interface MatchReason {
  criterion: string;
  en: string;
  ar: string;
  isHardRequirement: boolean;
}

export interface RankedPropertyResult {
  property: Property;
  relevanceScore: number;       // 0 to 100
  matchReasons: MatchReason[];
  extractedTags: string[];
  explanationEn: string;
  explanationAr: string;
}

export interface SearchQueryResult {
  query: string;
  parsedFilters: StructuredSearchFilters;
  results: RankedPropertyResult[];
  totalMatches: number;
  processingTimeMs: number;
}
