/**
 * HETTETY Agent Ecosystem & Broker CRM Domain Types
 * Enterprise real estate lead management, viewing dispatch, and agent performance tracking.
 */

export type LeadStatus =
  | 'new_inquiry'         // استفسار جديد
  | 'contacted'           // تم التواصل
  | 'viewing_scheduled'   // موعد معاينة محدد
  | 'viewing_completed'   // تمت المعاينة
  | 'negotiating'         // مرحلة التفاوض
  | 'closed_won'          // صفقة ناجحة (مباع)
  | 'closed_lost';        // صفقة خاسرة

export type LeadPriority = 'hot' | 'warm' | 'cold';

export type ViewingType = 'physical_visit' | 'guided_3d_tour';

export interface ViewingAppointment {
  date: string;
  time: string;
  type: ViewingType;
  meetingPoint?: string;
  notes?: string;
  confirmedByBuyer?: boolean;
}

export interface LeadNote {
  id: string;
  authorId: string;
  authorName: string;
  text: string;
  timestamp: string;
}

export interface LeadRecord {
  id: string;
  propertyId: string;
  propertyTitle: string;
  propertyLocation: string;
  buyerId?: string;
  buyerName: string;
  buyerPhone: string;
  buyerEmail?: string;
  assignedAgentId: string;
  assignedAgentName?: string;
  status: LeadStatus;
  priority: LeadPriority;
  budget: number;
  currency: 'EGP' | 'USD';
  viewingAppointment?: ViewingAppointment;
  notes: LeadNote[];
  createdAt: string;
  updatedAt: string;
}

export interface AgentProfile {
  id: string;
  name: string;
  nameAr: string;
  agencyName?: string;
  licenseNumber: string;
  phone: string;
  whatsapp: string;
  email: string;
  rating: number; // 1 to 5
  reviewCount: number;
  activeListingsCount: number;
  closedDealsCount: number;
  specializations: string[]; // ['New Cairo', 'Sheikh Zayed', 'Commercial', 'Resale']
  verificationBadge: boolean;
  commissionRatePercent: number; // default: 2.5%
}

export interface AgentPerformanceMetrics {
  totalLeads: number;
  activeDeals: number;
  closedWonCount: number;
  closedLostCount: number;
  conversionRatePercent: number;
  pipelineVolume: number;
  estimatedCommissions: number;
}
