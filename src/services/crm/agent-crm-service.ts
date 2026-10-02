/**
 * HETTETY Agent Ecosystem & Broker CRM Service
 * Intelligently matches prospective buyers with top verified Egyptian real estate advisors,
 * orchestrates viewing appointments (physical & 3D), and tracks pipeline conversion.
 */

import {
  Property,
  LeadRecord,
  LeadStatus,
  LeadPriority,
  AgentProfile,
  ViewingType,
  AgentPerformanceMetrics,
} from '../../types';

export interface CreateInquiryParams {
  property: Property;
  buyer: {
    id?: string;
    name: string;
    phone: string;
    email?: string;
    budget?: number;
  };
  availableAgents: AgentProfile[];
}

/**
 * Smart matching algorithm: selects the best suited broker based on
 * geographic expertise, track record rating, and active workload balance.
 */
export const assignLeadToBestAgent = (params: CreateInquiryParams): LeadRecord => {
  const { property, buyer, availableAgents } = params;

  if (availableAgents.length === 0) {
    throw new Error('No certified agents available for dispatch in this territory.');
  }

  const propLocation = (property.location || '').toLowerCase();
  const propCompound = (property.compound || '').toLowerCase();

  // Score each candidate agent
  const scoredAgents = availableAgents.map((agent) => {
    let score = 0;

    // Location & specialization match (+30 pts)
    const matchesLocation = agent.specializations.some((spec) => {
      const s = spec.toLowerCase();
      return propLocation.includes(s) || propCompound.includes(s) || s.includes(propLocation);
    });
    if (matchesLocation) score += 30;

    // Verified badge (+20 pts)
    if (agent.verificationBadge) score += 20;

    // Rating score (up to +25 pts)
    score += (agent.rating || 4.5) * 5;

    // Workload penalty (prefer brokers with capacity)
    score -= Math.min(20, (agent.activeListingsCount || 0) * 0.5);

    return { agent, score };
  });

  scoredAgents.sort((a, b) => b.score - a.score);
  const bestAgent = scoredAgents[0].agent;

  // Determine buyer priority
  const buyerBudget = buyer.budget || property.price;
  let priority: LeadPriority = 'warm';
  if (buyerBudget >= property.price) {
    priority = 'hot';
  } else if (buyerBudget < property.price * 0.8) {
    priority = 'cold';
  }

  const now = new Date().toISOString();
  const leadId = `lead_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;

  return {
    id: leadId,
    propertyId: property.id,
    propertyTitle: property.title,
    propertyLocation: property.location,
    buyerId: buyer.id,
    buyerName: buyer.name,
    buyerPhone: buyer.phone,
    buyerEmail: buyer.email,
    assignedAgentId: bestAgent.id,
    assignedAgentName: bestAgent.name,
    status: 'new_inquiry',
    priority,
    budget: buyerBudget,
    currency: property.currency || 'EGP',
    notes: [
      {
        id: `note_${Date.now()}`,
        authorId: 'system',
        authorName: 'HETTETY Matchmaker',
        text: `Lead automatically matched to ${bestAgent.name} based on ${property.location} specialization.`,
        timestamp: now,
      },
    ],
    createdAt: now,
    updatedAt: now,
  };
};

/**
 * Transitions lead through the CRM sales pipeline
 */
export const updateLeadStatus = (
  lead: LeadRecord,
  nextStatus: LeadStatus,
  noteText?: string,
  authorName: string = 'Agent'
): LeadRecord => {
  const now = new Date().toISOString();
  const updatedNotes = [...lead.notes];

  if (noteText) {
    updatedNotes.push({
      id: `note_${Date.now()}`,
      authorId: lead.assignedAgentId,
      authorName,
      text: noteText,
      timestamp: now,
    });
  }

  return {
    ...lead,
    status: nextStatus,
    notes: updatedNotes,
    updatedAt: now,
  };
};

/**
 * Schedules a viewing appointment (physical site visit or 3D Spatial Walkthrough)
 */
export const scheduleViewing = (
  lead: LeadRecord,
  date: string,
  time: string,
  type: ViewingType = 'physical_visit',
  notes?: string
): LeadRecord => {
  const now = new Date().toISOString();

  return {
    ...lead,
    status: 'viewing_scheduled',
    viewingAppointment: {
      date,
      time,
      type,
      notes,
      confirmedByBuyer: true,
    },
    notes: [
      ...lead.notes,
      {
        id: `note_${Date.now()}`,
        authorId: lead.assignedAgentId,
        authorName: lead.assignedAgentName || 'Agent',
        text: `Scheduled ${type === 'guided_3d_tour' ? 'Guided 3D Spatial Tour' : 'Physical On-Site Visit'} on ${date} at ${time}.`,
        timestamp: now,
      },
    ],
    updatedAt: now,
  };
};

/**
 * Calculates agent performance analytics and conversion metrics
 */
export const calculateAgentPerformanceMetrics = (
  agentId: string,
  leads: LeadRecord[]
): AgentPerformanceMetrics => {
  const agentLeads = leads.filter((l) => l.assignedAgentId === agentId);
  const totalLeads = agentLeads.length;

  const closedWon = agentLeads.filter((l) => l.status === 'closed_won');
  const closedLost = agentLeads.filter((l) => l.status === 'closed_lost');
  const activeDeals = agentLeads.filter(
    (l) => l.status !== 'closed_won' && l.status !== 'closed_lost'
  );

  const conversionRatePercent =
    totalLeads > 0 ? Math.round((closedWon.length / totalLeads) * 100) : 0;

  const pipelineVolume = activeDeals.reduce((sum, l) => sum + (l.budget || 0), 0);
  const totalWonVolume = closedWon.reduce((sum, l) => sum + (l.budget || 0), 0);
  const estimatedCommissions = Math.round(totalWonVolume * 0.025); // 2.5% standard fee

  return {
    totalLeads,
    activeDeals: activeDeals.length,
    closedWonCount: closedWon.length,
    closedLostCount: closedLost.length,
    conversionRatePercent,
    pipelineVolume,
    estimatedCommissions,
  };
};

/**
 * Bilingual status presentation and colors
 */
export const getLeadStatusLabel = (status: LeadStatus, isRtl: boolean = false) => {
  const labels: Record<LeadStatus, { en: string; ar: string; color: string }> = {
    new_inquiry: { en: 'New Inquiry', ar: 'طلب جديد', color: 'bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300' },
    contacted: { en: 'Contacted', ar: 'تم التواصل', color: 'bg-purple-100 text-purple-700 dark:bg-purple-900/40 dark:text-purple-300' },
    viewing_scheduled: { en: 'Viewing Scheduled', ar: 'موعد معاينة محدد', color: 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300' },
    viewing_completed: { en: 'Viewing Completed', ar: 'تمت المعاينة', color: 'bg-cyan-100 text-cyan-700 dark:bg-cyan-900/40 dark:text-cyan-300' },
    negotiating: { en: 'Negotiating', ar: 'مرحلة التفاوض', color: 'bg-indigo-100 text-indigo-700 dark:bg-indigo-900/40 dark:text-indigo-300' },
    closed_won: { en: 'Closed (Won)', ar: 'تمت الصفقة (ناجحة)', color: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300' },
    closed_lost: { en: 'Closed (Lost)', ar: 'مغلقة (غير موفق)', color: 'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-400' },
  };

  const item = labels[status] || { en: status, ar: status, color: 'bg-slate-100 text-slate-700' };
  return {
    label: isRtl ? item.ar : item.en,
    color: item.color,
  };
};
