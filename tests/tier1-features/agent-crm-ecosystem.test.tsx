import { describe, it, expect, vi } from 'vitest';
import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import {
  assignLeadToBestAgent,
  updateLeadStatus,
  scheduleViewing,
  calculateAgentPerformanceMetrics,
  getLeadStatusLabel,
} from '../../src/services/crm/agent-crm-service';
import { AgentCrmDashboard } from '../../src/components/crm/AgentCrmDashboard';
import { ViewingScheduleModal } from '../../src/components/crm/ViewingScheduleModal';
import { Property, AgentProfile, LeadRecord } from '../../src/types';

describe('Tier 1 — Phase 8 & 9: Agent Ecosystem, Lead Assignment & Broker CRM', () => {
  const mockAgents: AgentProfile[] = [
    {
      id: 'agent-nc',
      name: 'Mostafa El-Naggar',
      nameAr: 'مصطفى النجار',
      agencyName: 'Coldwell Banker New Cairo',
      licenseNumber: 'EGY-REG-4421',
      phone: '+201011223344',
      whatsapp: '+201011223344',
      email: 'mostafa@coldwell.eg',
      rating: 4.9,
      reviewCount: 38,
      activeListingsCount: 8,
      closedDealsCount: 29,
      specializations: ['New Cairo', 'Fifth Settlement', 'Mivida', 'Villette'],
      verificationBadge: true,
      commissionRatePercent: 2.5,
    },
    {
      id: 'agent-zayed',
      name: 'Salma Mansour',
      nameAr: 'سلمى منصور',
      agencyName: 'RE/MAX Zayed Prime',
      licenseNumber: 'EGY-REG-1198',
      phone: '+201099887766',
      whatsapp: '+201099887766',
      email: 'salma@remax.eg',
      rating: 4.8,
      reviewCount: 22,
      activeListingsCount: 14,
      closedDealsCount: 18,
      specializations: ['Sheikh Zayed', 'October', 'Beverly Hills', 'Allegria'],
      verificationBadge: true,
      commissionRatePercent: 2.5,
    },
  ];

  const mockProperty: Property = {
    id: 'prop-mivida-88',
    title: 'Modern Apartment in Mivida',
    price: 9000000,
    location: 'New Cairo',
    compound: 'Mivida',
    bedrooms: 3,
    bathrooms: 3,
    area: 195,
    imageUrl: 'https://cdn.hettety.com/mivida-88.jpg',
    status: 'For Sale',
    isVerified: true,
  };

  describe('Smart Agent Dispatch & CRM Pipeline Logic', () => {
    it('intelligently assigns lead to New Cairo specialist agent based on compound match', () => {
      const lead = assignLeadToBestAgent({
        property: mockProperty,
        buyer: {
          name: 'Ahmed Fathy',
          phone: '+201234567890',
          budget: 9500000, // Budget >= Price => Hot
        },
        availableAgents: mockAgents,
      });

      expect(lead.assignedAgentId).toBe('agent-nc');
      expect(lead.assignedAgentName).toBe('Mostafa El-Naggar');
      expect(lead.priority).toBe('hot');
      expect(lead.status).toBe('new_inquiry');
      expect(lead.notes[0].text).toContain('New Cairo specialization');
    });

    it('updates lead status through pipeline stages with agent audit notes', () => {
      const lead = assignLeadToBestAgent({
        property: mockProperty,
        buyer: { name: 'Ahmed Fathy', phone: '+201234567890' },
        availableAgents: mockAgents,
      });

      const contacted = updateLeadStatus(lead, 'contacted', 'Spoke on WhatsApp, interested in viewing', 'Mostafa');
      expect(contacted.status).toBe('contacted');
      expect(contacted.notes.length).toBe(2);
      expect(contacted.notes[1].text).toContain('Spoke on WhatsApp');
    });

    it('schedules a guided 3D spatial tour and transitions status to viewing_scheduled', () => {
      const lead = assignLeadToBestAgent({
        property: mockProperty,
        buyer: { name: 'Ahmed Fathy', phone: '+201234567890' },
        availableAgents: mockAgents,
      });

      const scheduled = scheduleViewing(lead, '2026-10-15', '17:30', 'guided_3d_tour');
      expect(scheduled.status).toBe('viewing_scheduled');
      expect(scheduled.viewingAppointment?.type).toBe('guided_3d_tour');
      expect(scheduled.viewingAppointment?.date).toBe('2026-10-15');
      expect(scheduled.viewingAppointment?.time).toBe('17:30');
    });

    it('calculates agent performance metrics, conversion rate, and commission volume', () => {
      const leads: LeadRecord[] = [
        {
          id: 'l-1',
          propertyId: 'p-1',
          propertyTitle: 'Mivida Apt',
          propertyLocation: 'New Cairo',
          buyerName: 'Buyer 1',
          buyerPhone: '111',
          assignedAgentId: 'agent-nc',
          status: 'closed_won',
          priority: 'hot',
          budget: 10000000,
          currency: 'EGP',
          notes: [],
          createdAt: '',
          updatedAt: '',
        },
        {
          id: 'l-2',
          propertyId: 'p-2',
          propertyTitle: 'Villette Villa',
          propertyLocation: 'New Cairo',
          buyerName: 'Buyer 2',
          buyerPhone: '222',
          assignedAgentId: 'agent-nc',
          status: 'negotiating',
          priority: 'warm',
          budget: 18000000,
          currency: 'EGP',
          notes: [],
          createdAt: '',
          updatedAt: '',
        },
        {
          id: 'l-3',
          propertyId: 'p-3',
          propertyTitle: 'Eastown Duplex',
          propertyLocation: 'New Cairo',
          buyerName: 'Buyer 3',
          buyerPhone: '333',
          assignedAgentId: 'agent-nc',
          status: 'closed_lost',
          priority: 'cold',
          budget: 6000000,
          currency: 'EGP',
          notes: [],
          createdAt: '',
          updatedAt: '',
        },
      ];

      const metrics = calculateAgentPerformanceMetrics('agent-nc', leads);
      expect(metrics.totalLeads).toBe(3);
      expect(metrics.closedWonCount).toBe(1);
      expect(metrics.closedLostCount).toBe(1);
      expect(metrics.activeDeals).toBe(1);
      expect(metrics.conversionRatePercent).toBe(33); // 1 / 3 = 33%
      expect(metrics.pipelineVolume).toBe(18000000);
      expect(metrics.estimatedCommissions).toBe(250000); // 2.5% of 10M won
    });
  });

  describe('UI Integration — Agent CRM Dashboard & Viewing Modal', () => {
    it('renders AgentCrmDashboard with KPI metrics and Kanban columns', () => {
      const mockLead: LeadRecord = {
        id: 'l-lead-ui-1',
        propertyId: 'prop-mivida-88',
        propertyTitle: 'Modern Apartment in Mivida',
        propertyLocation: 'New Cairo',
        buyerName: 'Dr. Tarek Lotfy',
        buyerPhone: '+201001234567',
        assignedAgentId: 'agent-nc',
        assignedAgentName: 'Mostafa El-Naggar',
        status: 'new_inquiry',
        priority: 'hot',
        budget: 9000000,
        currency: 'EGP',
        notes: [],
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };

      const advanceMock = vi.fn();

      render(
        <AgentCrmDashboard
          agent={mockAgents[0]}
          leads={[mockLead]}
          onUpdateLeadStatus={advanceMock}
          isRtl={false}
        />
      );

      expect(screen.getByTestId('agent-crm-dashboard')).toBeInTheDocument();
      expect(screen.getByText('Mostafa El-Naggar')).toBeInTheDocument();
      expect(screen.getByText('Certified Advisor')).toBeInTheDocument();
      expect(screen.getByText('Dr. Tarek Lotfy')).toBeInTheDocument();

      // Click advance button
      const advanceBtn = screen.getByRole('button', { name: /Advance/i });
      fireEvent.click(advanceBtn);
      expect(advanceMock).toHaveBeenCalledWith('l-lead-ui-1', 'contacted');
    });

    it('opens and submits ViewingScheduleModal with guided 3D tour choice', () => {
      const scheduleMock = vi.fn();

      render(
        <ViewingScheduleModal
          isOpen={true}
          onClose={vi.fn()}
          propertyTitle="Modern Apartment in Mivida"
          propertyLocation="New Cairo"
          onConfirmSchedule={scheduleMock}
          isRtl={false}
        />
      );

      expect(screen.getByTestId('viewing-schedule-modal')).toBeInTheDocument();
      expect(screen.getByText('Schedule Property Viewing')).toBeInTheDocument();

      // Submit schedule
      const confirmBtn = screen.getByRole('button', { name: /Confirm Viewing Appointment/i });
      fireEvent.click(confirmBtn);

      expect(scheduleMock).toHaveBeenCalled();
      const callArg = scheduleMock.mock.calls[0][0];
      expect(callArg.type).toBe('guided_3d_tour');
    });
  });
});
