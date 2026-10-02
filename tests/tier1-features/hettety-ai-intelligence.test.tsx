import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { parseSpatialCommand } from '../../src/services/ai/spatial-assistant';
import { compareProperties } from '../../src/services/ai/property-comparator';
import { SpatialAiAssistant } from '../../src/components/3d/SpatialAiAssistant';
import { PropertyComparisonModal } from '../../src/components/ai/PropertyComparisonModal';
import { Property, ThreeDTour } from '../../src/types';

const SAMPLE_TOUR: ThreeDTour = {
  id: 'tour-101',
  status: 'ready',
  source: 'hettety_capture',
  rooms: [
    { id: 'reception', name: 'Grand Reception Salon', nameAr: 'صالون الاستقبال', position: [0, 1.6, 0] },
    { id: 'master_bedroom', name: 'Master Suite', nameAr: 'جناح الماستر', position: [3, 1.6, -2] },
    { id: 'kitchen', name: 'Modern American Kitchen', nameAr: 'مطبخ أمريكي مفتوح', position: [-2.5, 1.6, 1.5] },
  ],
};

const COMPARE_PROPERTIES: Property[] = [
  {
    id: 'p-villa-1',
    title: 'Hyde Park Standalone Villa',
    price: 24000000,
    location: 'New Cairo',
    compound: 'Hyde Park',
    propertyType: 'Villa',
    bedrooms: 5,
    bathrooms: 5,
    area: 480, // 50,000 EGP/sqm
    status: 'For Sale',
    imageUrl: 'https://cdn.hettety.com/hydepark.jpg',
    amenities: ['Pool', 'Garden'],
    paymentPlans: [{ downPayment: 10, years: 8 }],
    threeDTour: { status: 'ready', provider: 'hettety' },
    isVerified: true,
  },
  {
    id: 'p-apt-2',
    title: 'Mivida Park Residence Apartment',
    price: 9000000,
    location: 'New Cairo',
    compound: 'Mivida',
    propertyType: 'Apartment',
    bedrooms: 3,
    bathrooms: 2,
    area: 200, // 45,000 EGP/sqm (Better value per sqm)
    status: 'For Sale',
    imageUrl: 'https://cdn.hettety.com/mivida.jpg',
    finishing: 'Fully Finished',
    isVerified: true,
  },
];

describe('Tier 1 — HETTETY AI Real Intelligence Layer', () => {
  describe('Spatial 3D Assistant — Grounded Room Navigation', () => {
    it('interprets English command to view kitchen and returns camera waypoint', () => {
      const res = parseSpatialCommand('Show me the kitchen', SAMPLE_TOUR);
      expect(res.action).toBe('navigate_to_room');
      expect(res.targetRoomId).toBe('kitchen');
      expect(res.targetRoomName).toContain('Kitchen');
      expect(res.responseTextEn.toLowerCase()).toContain('kitchen');
    });

    it('interprets Arabic command to view master suite with camera coordinates', () => {
      const res = parseSpatialCommand('خدني على جناح الماستر', SAMPLE_TOUR);
      expect(res.action).toBe('navigate_to_room');
      expect(res.targetRoomId).toBe('master_bedroom');
      expect(res.targetRoomNameAr).toContain('الماستر');
      expect(res.cameraPosition).toEqual([3, 1.6, -2]);
    });

    it('answers room listing inquiry with all available spaces in the model', () => {
      const res = parseSpatialCommand('إيه الغرف الموجودة في الشقة؟', SAMPLE_TOUR);
      expect(res.action).toBe('list_rooms');
      expect(res.responseTextAr).toContain('الاستقبال');
      expect(res.responseTextAr).toContain('الماستر');
      expect(res.responseTextAr).toContain('مطبخ');
    });

    it('provides metric measurement guidance when asked about distances', () => {
      const res = parseSpatialCommand('كيف أقيس المسافات بين الحوائط؟', SAMPLE_TOUR);
      expect(res.action).toBe('measure_hint');
      expect(res.responseTextAr).toContain('مسطرة القياس');
    });
  });

  describe('Multi-Property Comparative Analytics Engine', () => {
    it('calculates price per square meter and selects best value vs family favorite', () => {
      const report = compareProperties(COMPARE_PROPERTIES);

      expect(report.properties).toHaveLength(2);
      // Mivida is 45,000 EGP/sqm vs Hyde Park 50,000 EGP/sqm -> Best value
      expect(report.bestValuePropertyId).toBe('p-apt-2');
      // Hyde park has 5 bedrooms -> Best for families
      expect(report.bestFamilyPropertyId).toBe('p-villa-1');

      expect(report.summaryEn).toContain('45,000 EGP/m²');
      expect(report.summaryEn).toContain('5 bedrooms');
      expect(report.summaryAr).toContain('45,000 ج.م/م²');
    });

    it('computes estimated monthly installment when payment plans exist', () => {
      const report = compareProperties(COMPARE_PROPERTIES);
      const villaAnalysis = report.properties.find((p) => p.property.id === 'p-villa-1');

      expect(villaAnalysis?.downPaymentEGP).toBe(2400000); // 10% of 24M
      expect(villaAnalysis?.monthlyEstimateEGP).toBeGreaterThan(0);
      expect(villaAnalysis?.has3DTour).toBe(true);
    });
  });

  describe('Spatial AI & Comparison UI Components', () => {
    it('renders SpatialAiAssistant inside 3D viewer and navigates camera on command', () => {
      const mockNavigate = vi.fn();
      render(<SpatialAiAssistant tour={SAMPLE_TOUR} onNavigateToRoom={mockNavigate} isRtl={false} />);

      // Click trigger to expand assistant
      const openBtn = screen.getByRole('button', { name: /3D Spatial Assistant/i });
      fireEvent.click(openBtn);

      expect(screen.getByText(/Hettety 3D Navigator/i)).toBeInTheDocument();

      // Click quick command "Kitchen"
      const kitchenBtn = screen.getByRole('button', { name: 'Kitchen' });
      fireEvent.click(kitchenBtn);

      expect(mockNavigate).toHaveBeenCalledWith('kitchen', [-2.5, 1.6, 1.5], [0, 0, 0]);
    });

    it('renders PropertyComparisonModal with side-by-side specs and best value badge', () => {
      const mockSelect = vi.fn();
      render(
        <PropertyComparisonModal
          properties={COMPARE_PROPERTIES}
          isOpen={true}
          onClose={() => {}}
          onSelectProperty={mockSelect}
          isRtl={false}
        />
      );

      expect(screen.getByText(/Grounded AI Property Comparison/i)).toBeInTheDocument();
      expect(screen.getByText('Hyde Park Standalone Villa')).toBeInTheDocument();
      expect(screen.getByText('Mivida Park Residence Apartment')).toBeInTheDocument();
      expect(screen.getByText(/Best Value \/ m²/i)).toBeInTheDocument();
      expect(screen.getByText(/Family Favorite/i)).toBeInTheDocument();
    });
  });
});
