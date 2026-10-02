import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { parseNaturalLanguageQuery, formatFiltersToTags } from '../../src/services/search/query-parser';
import { rankAndFilterProperties } from '../../src/services/search/ranking-engine';
import { SmartSearchBox } from '../../src/components/search/SmartSearchBox';
import { MatchExplanationCard } from '../../src/components/search/MatchExplanationCard';
import { Property, RankedPropertyResult } from '../../src/types';

const MOCK_PROPERTIES: Property[] = [
  {
    id: 'prop-nc-1',
    title: 'One90 Luxury Apartment with Terrace',
    price: 7500000,
    location: 'New Cairo',
    compound: 'One90',
    propertyType: 'Apartment',
    bedrooms: 3,
    bathrooms: 2,
    area: 175,
    status: 'For Sale',
    imageUrl: 'https://cdn.hettety.com/one90.jpg',
    amenities: ['Balcony', 'Security', 'Clubhouse'],
    view: 'Terrace & Landscaped Courtyard',
    paymentPlans: [{ downPayment: 750000, years: 7 }],
    threeDTour: {
      status: 'ready',
      provider: 'hettety',
      format: 'spz',
      assetUrl: 'https://cdn.hettety.com/tours/one90/scene.spz',
    },
    isVerified: true,
    lifecycleStatus: 'published',
    listingState: 'Live',
  },
  {
    id: 'prop-zayed-villa',
    title: 'Allegria Signature Golf Villa',
    price: 26000000,
    location: 'Sheikh Zayed',
    compound: 'Allegria',
    propertyType: 'Villa',
    bedrooms: 5,
    bathrooms: 5,
    area: 550,
    status: 'For Sale',
    imageUrl: 'https://cdn.hettety.com/allegria.jpg',
    amenities: ['Pool', 'Garden', 'Security'],
    gardenArea: 350,
    isVerified: true,
    lifecycleStatus: 'published',
    listingState: 'Live',
  },
  {
    id: 'prop-nc-expensive',
    title: 'Lake View Residence Penthouse',
    price: 16000000,
    location: 'New Cairo',
    compound: 'Lake View',
    propertyType: 'Penthouse',
    bedrooms: 4,
    bathrooms: 3,
    area: 280,
    status: 'For Sale',
    imageUrl: 'https://cdn.hettety.com/lakeview.jpg',
    amenities: ['Roof', 'Balcony'],
    isVerified: true,
    lifecycleStatus: 'published',
    listingState: 'Live',
  },
  {
    id: 'prop-sahel-chalet',
    title: 'Marassi Marina Chalet with Sea View',
    price: 11000000,
    location: 'North Coast',
    village: 'Marassi',
    propertyType: 'Chalet',
    bedrooms: 2,
    bathrooms: 2,
    area: 115,
    status: 'For Sale',
    imageUrl: 'https://cdn.hettety.com/marassi.jpg',
    amenities: ['Sea View', 'Pool', 'Beach Access'],
    isVerified: true,
    lifecycleStatus: 'published',
    listingState: 'Live',
  },
];

describe('Tier 1 — Search & Discovery Engine', () => {
  describe('Natural Language Query Parser (English & Arabic)', () => {
    it('parses English query into structured filters (3 bedroom apartment in New Cairo under 8M with balcony)', () => {
      const query = '3 bedroom apartment in New Cairo under 8M with a balcony';
      const filters = parseNaturalLanguageQuery(query);

      expect(filters.propertyType).toEqual(['Apartment']);
      expect(filters.locations).toEqual(['New Cairo']);
      expect(filters.bedroomsMin).toBe(3);
      expect(filters.priceMax).toBe(8000000);
      expect(filters.amenities).toContain('Balcony');
    });

    it('parses Arabic query with Eastern numerals and Egyptian real estate terms', () => {
      const query = 'شقة ٣ غرف في التجمع أقل من 8 مليون بتسهيلات وبلكونة';
      const filters = parseNaturalLanguageQuery(query);

      expect(filters.propertyType).toEqual(['Apartment']);
      expect(filters.locations).toEqual(['New Cairo']);
      expect(filters.bedroomsMin).toBe(3);
      expect(filters.priceMax).toBe(8000000);
      expect(filters.hasInstallments).toBe(true);
      expect(filters.amenities).toContain('Balcony');
    });

    it('parses Villa query in Sheikh Zayed with pool and garden', () => {
      const query = 'فيلا في الشيخ زايد بحمام سباحة وحديقة';
      const filters = parseNaturalLanguageQuery(query);

      expect(filters.propertyType).toEqual(['Villa']);
      expect(filters.locations).toEqual(['Sheikh Zayed']);
      expect(filters.amenities).toContain('Pool');
      expect(filters.amenities).toContain('Garden');
    });

    it('formats parsed filters into clear, user-facing UI tags', () => {
      const filters = {
        propertyType: ['Apartment'],
        locations: ['New Cairo'],
        bedroomsMin: 3,
        priceMax: 8000000,
        amenities: ['Balcony'],
        has3DTour: true,
      };

      const tagsEn = formatFiltersToTags(filters, false);
      expect(tagsEn).toContain('Apartment');
      expect(tagsEn).toContain('New Cairo');
      expect(tagsEn).toContain('3 Beds');
      expect(tagsEn).toContain('< 8M EGP');
      expect(tagsEn).toContain('Balcony');
      expect(tagsEn).toContain('3D Tour');

      const tagsAr = formatFiltersToTags(filters, true);
      expect(tagsAr).toContain('3 غرف');
      expect(tagsAr).toContain('أقل من 8 مليون ج.م');
      expect(tagsAr).toContain('جولة 3D فراغية');
    });
  });

  describe('Multi-Attribute Grounded Ranking Engine', () => {
    it('retrieves only candidate properties matching hard requirements and ranks them by score', () => {
      const filters = parseNaturalLanguageQuery('3 bedroom apartment in New Cairo under 8M with balcony');
      const ranked = rankAndFilterProperties(MOCK_PROPERTIES, filters);

      // Only prop-nc-1 should pass (prop-zayed is a villa in Zayed, prop-nc-expensive is 16M, prop-sahel is chalet in Sahel)
      expect(ranked).toHaveLength(1);
      const top = ranked[0];
      expect(top.property.id).toBe('prop-nc-1');
      expect(top.relevanceScore).toBeGreaterThanOrEqual(85);

      // Verifies grounded match reasons without AI hallucination
      const reasons = top.matchReasons.map((r) => r.criterion);
      expect(reasons).toContain('propertyType');
      expect(reasons).toContain('location');
      expect(reasons).toContain('price');
      expect(reasons).toContain('bedrooms');
      expect(reasons).toContain('amenity');
    });

    it('awards bonus score for 3D Tours and flexible installments', () => {
      const filtersWithTour = parseNaturalLanguageQuery('apartment in New Cairo under 8M with 3d tour and installments');
      const ranked = rankAndFilterProperties(MOCK_PROPERTIES, filtersWithTour);

      expect(ranked.length).toBeGreaterThan(0);
      const top = ranked[0];
      expect(top.extractedTags).toContain('3D Tour');
      expect(top.extractedTags).toContain('Installments');
      expect(top.relevanceScore).toBeGreaterThanOrEqual(95);
    });

    it('generates truthful, non-hallucinated explanations matching actual property data', () => {
      const filters = parseNaturalLanguageQuery('villa in sheikh zayed with pool');
      const ranked = rankAndFilterProperties(MOCK_PROPERTIES, filters);

      expect(ranked).toHaveLength(1);
      const villaResult = ranked[0];
      expect(villaResult.property.title).toBe('Allegria Signature Golf Villa');
      expect(villaResult.explanationEn).toContain('Allegria');
      expect(villaResult.explanationEn).toContain('26,000,000 EGP');
      expect(villaResult.explanationAr).toContain('26,000,000 ج.م');
    });
  });

  describe('Search UI Components', () => {
    it('renders SmartSearchBox and emits structured filters on submit', () => {
      const mockSearch = vi.fn();
      render(<SmartSearchBox onSearch={mockSearch} isRtl={false} />);

      const input = screen.getByPlaceholderText(/Search naturally/i);
      fireEvent.change(input, { target: { value: '3 bedroom apartment in New Cairo under 8M' } });

      // Verifies real-time tag extraction
      expect(screen.getByText('Apartment')).toBeInTheDocument();
      expect(screen.getByText('New Cairo')).toBeInTheDocument();
      expect(screen.getByText('3 Beds')).toBeInTheDocument();

      const submitBtn = screen.getByRole('button', { name: /Smart Search/i });
      fireEvent.click(submitBtn);

      expect(mockSearch).toHaveBeenCalled();
      const calledFilters = mockSearch.mock.calls[0][1];
      expect(calledFilters.propertyType).toEqual(['Apartment']);
      expect(calledFilters.locations).toEqual(['New Cairo']);
    });

    it('renders MatchExplanationCard with match percentage and criteria tags', () => {
      const sampleResult: RankedPropertyResult = {
        property: MOCK_PROPERTIES[0],
        relevanceScore: 94,
        matchReasons: [
          { criterion: 'bedrooms', en: 'Matches 3 bedrooms', ar: 'مطابق لـ 3 غرف نوم', isHardRequirement: true },
          { criterion: 'price', en: 'Within 8M budget', ar: 'ضمن ميزانية 8 مليون', isHardRequirement: true },
        ],
        extractedTags: ['Apartment', 'New Cairo', '3 Beds'],
        explanationEn: 'Matches your criteria: 3 bedrooms, under 8M EGP.',
        explanationAr: 'يطابق مواصفات بحثك: 3 غرف نوم، أقل من 8 مليون ج.م.',
      };

      render(<MatchExplanationCard result={sampleResult} isRtl={false} />);

      expect(screen.getByText('Grounded AI Match')).toBeInTheDocument();
      expect(screen.getByText('94% Match')).toBeInTheDocument();
      expect(screen.getByText('Matches your criteria: 3 bedrooms, under 8M EGP.')).toBeInTheDocument();
      expect(screen.getByText('Matches 3 bedrooms')).toBeInTheDocument();
    });
  });
});
