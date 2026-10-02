import React, { useState } from 'react';
import { LeadRecord, LeadStatus, AgentProfile } from '../../types';
import {
  calculateAgentPerformanceMetrics,
  getLeadStatusLabel,
} from '../../services/crm/agent-crm-service';
import {
  Briefcase,
  TrendingUp,
  Users,
  Calendar,
  Phone,
  MessageCircle,
  ArrowRight,
  ArrowLeft,
  CheckCircle,
  Clock,
} from 'lucide-react';

interface AgentCrmDashboardProps {
  agent: AgentProfile;
  leads: LeadRecord[];
  onUpdateLeadStatus?: (leadId: string, nextStatus: LeadStatus) => void;
  onOpenScheduleViewing?: (lead: LeadRecord) => void;
  isRtl?: boolean;
}

const KANBAN_STAGES: { id: LeadStatus; labelEn: string; labelAr: string }[] = [
  { id: 'new_inquiry', labelEn: 'New Inquiries', labelAr: 'طلبات جديدة' },
  { id: 'contacted', labelEn: 'Contacted', labelAr: 'تم التواصل' },
  { id: 'viewing_scheduled', labelEn: 'Viewings Scheduled', labelAr: 'معاينات محددة' },
  { id: 'negotiating', labelEn: 'Negotiating', labelAr: 'مفاوضات وعروض' },
  { id: 'closed_won', labelEn: 'Won Deals', labelAr: 'صفقات ناجحة' },
];

export const AgentCrmDashboard: React.FC<AgentCrmDashboardProps> = ({
  agent,
  leads,
  onUpdateLeadStatus,
  onOpenScheduleViewing,
  isRtl = false,
}) => {
  const metrics = calculateAgentPerformanceMetrics(agent.id, leads);

  const getNextStage = (current: LeadStatus): LeadStatus | null => {
    switch (current) {
      case 'new_inquiry':
        return 'contacted';
      case 'contacted':
        return 'viewing_scheduled';
      case 'viewing_scheduled':
        return 'negotiating';
      case 'negotiating':
        return 'closed_won';
      default:
        return null;
    }
  };

  return (
    <div
      data-testid="agent-crm-dashboard"
      className="space-y-6"
      dir={isRtl ? 'rtl' : 'ltr'}
    >
      {/* Top Banner & Broker Profile */}
      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-6 shadow-sm flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div className="flex items-center gap-4">
          <div className="w-14 h-14 rounded-2xl bg-amber-500/10 text-amber-600 dark:text-amber-400 flex items-center justify-center font-bold text-xl">
            {agent.name.charAt(0)}
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h2 className="text-xl font-bold text-slate-900 dark:text-white">
                {isRtl ? agent.nameAr || agent.name : agent.name}
              </h2>
              {agent.verificationBadge && (
                <span className="text-[10px] bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/30 px-2 py-0.5 rounded-full font-bold">
                  {isRtl ? 'مستشار معتمد' : 'Certified Advisor'}
                </span>
              )}
            </div>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
              {agent.agencyName || 'HETTETY Premier Broker Network'} • Lic #{agent.licenseNumber}
            </p>
          </div>
        </div>

        {/* Quick Contact & Spec Tags */}
        <div className="flex flex-wrap gap-1.5 max-w-sm">
          {agent.specializations.map((spec, i) => (
            <span
              key={i}
              className="text-[11px] px-2.5 py-1 rounded-lg bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 font-medium"
            >
              {spec}
            </span>
          ))}
        </div>
      </div>

      {/* KPI Stats Bar */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-4 shadow-sm">
          <div className="text-slate-500 dark:text-slate-400 text-xs font-semibold flex items-center gap-1.5">
            <Users size={14} className="text-blue-500" />
            <span>{isRtl ? 'إجمالي العملاء المهتمين' : 'Total Leads'}</span>
          </div>
          <div className="text-2xl font-black text-slate-900 dark:text-white mt-1">
            {metrics.totalLeads}
          </div>
        </div>

        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-4 shadow-sm">
          <div className="text-slate-500 dark:text-slate-400 text-xs font-semibold flex items-center gap-1.5">
            <Briefcase size={14} className="text-purple-500" />
            <span>{isRtl ? 'حجم الصفقات الجارية' : 'Pipeline Volume'}</span>
          </div>
          <div className="text-2xl font-black text-slate-900 dark:text-white mt-1 truncate">
            {(metrics.pipelineVolume / 1000000).toFixed(1)}M <span className="text-xs font-semibold text-slate-400">EGP</span>
          </div>
        </div>

        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-4 shadow-sm">
          <div className="text-slate-500 dark:text-slate-400 text-xs font-semibold flex items-center gap-1.5">
            <TrendingUp size={14} className="text-emerald-500" />
            <span>{isRtl ? 'نسبة إتمام الصفقات' : 'Conversion Rate'}</span>
          </div>
          <div className="text-2xl font-black text-emerald-600 dark:text-emerald-400 mt-1">
            {metrics.conversionRatePercent}%
          </div>
        </div>

        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-4 shadow-sm">
          <div className="text-slate-500 dark:text-slate-400 text-xs font-semibold flex items-center gap-1.5">
            <CheckCircle size={14} className="text-amber-500" />
            <span>{isRtl ? 'العمولات المتوقعة' : 'Estimated Commission'}</span>
          </div>
          <div className="text-2xl font-black text-amber-600 dark:text-amber-400 mt-1 truncate">
            {metrics.estimatedCommissions.toLocaleString()} <span className="text-xs font-semibold text-slate-400">EGP</span>
          </div>
        </div>
      </div>

      {/* Kanban Stages Grid */}
      <div className="grid grid-cols-1 md:grid-cols-5 gap-4 overflow-x-auto pb-4">
        {KANBAN_STAGES.map((stage) => {
          const stageLeads = leads.filter((l) => l.status === stage.id);

          return (
            <div
              key={stage.id}
              className="bg-slate-50/80 dark:bg-slate-800/30 rounded-2xl border border-slate-200/80 dark:border-slate-800/80 p-3 flex flex-col min-w-[240px]"
            >
              {/* Stage Header */}
              <div className="flex items-center justify-between pb-3 mb-2 border-b border-slate-200/60 dark:border-slate-700/60">
                <span className="font-bold text-xs text-slate-800 dark:text-slate-200">
                  {isRtl ? stage.labelAr : stage.labelEn}
                </span>
                <span className="text-[11px] font-bold px-2 py-0.5 rounded-full bg-slate-200 dark:bg-slate-700 text-slate-700 dark:text-slate-300">
                  {stageLeads.length}
                </span>
              </div>

              {/* Stage Cards */}
              <div className="space-y-3 flex-1">
                {stageLeads.length === 0 ? (
                  <div className="text-center py-6 text-slate-400 text-xs italic">
                    {isRtl ? 'لا توجد طلبات' : 'No leads'}
                  </div>
                ) : (
                  stageLeads.map((lead) => {
                    const nextStage = getNextStage(lead.status);

                    return (
                      <div
                        key={lead.id}
                        className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-3 shadow-xs space-y-2.5 transition-shadow hover:shadow-md"
                      >
                        <div className="flex items-start justify-between gap-1">
                          <div>
                            <span className="font-bold text-xs text-slate-900 dark:text-white block">
                              {lead.buyerName}
                            </span>
                            <span className="text-[10px] text-slate-500 truncate block max-w-[150px]">
                              {lead.propertyTitle}
                            </span>
                          </div>
                          <span
                            className={`text-[9px] font-bold px-1.5 py-0.5 rounded uppercase ${
                              lead.priority === 'hot'
                                ? 'bg-rose-100 text-rose-700 dark:bg-rose-900/40 dark:text-rose-300'
                                : lead.priority === 'warm'
                                ? 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300'
                                : 'bg-slate-100 text-slate-600'
                            }`}
                          >
                            {lead.priority}
                          </span>
                        </div>

                        {/* Budget */}
                        <div className="text-[11px] font-semibold text-amber-600 dark:text-amber-400">
                          {lead.budget.toLocaleString()} {lead.currency}
                        </div>

                        {/* Viewing Info if set */}
                        {lead.viewingAppointment && (
                          <div className="flex items-center gap-1 text-[10px] text-teal-600 dark:text-teal-400 bg-teal-50 dark:bg-teal-950/40 p-1.5 rounded">
                            <Clock size={11} />
                            <span>
                              {lead.viewingAppointment.date} @ {lead.viewingAppointment.time}
                            </span>
                          </div>
                        )}

                        {/* Actions */}
                        <div className="flex items-center justify-between pt-2 border-t border-slate-100 dark:border-slate-800 text-xs">
                          <a
                            href={`https://wa.me/${lead.buyerPhone.replace(/[^0-9]/g, '')}`}
                            target="_blank"
                            rel="noreferrer"
                            className="p-1 rounded text-emerald-600 hover:bg-emerald-50 dark:hover:bg-emerald-950/40"
                            title="WhatsApp Client"
                          >
                            <MessageCircle size={15} />
                          </a>

                          {onOpenScheduleViewing && (
                            <button
                              onClick={() => onOpenScheduleViewing(lead)}
                              className="p-1 rounded text-blue-600 hover:bg-blue-50 dark:hover:bg-blue-950/40"
                              title="Schedule Viewing"
                            >
                              <Calendar size={15} />
                            </button>
                          )}

                          {nextStage && onUpdateLeadStatus && (
                            <button
                              onClick={() => onUpdateLeadStatus(lead.id, nextStage)}
                              className="flex items-center gap-1 text-[11px] font-bold text-amber-600 hover:text-amber-700 hover:underline"
                            >
                              <span>{isRtl ? 'تقدم' : 'Advance'}</span>
                              {isRtl ? <ArrowLeft size={12} /> : <ArrowRight size={12} />}
                            </button>
                          )}
                        </div>
                      </div>
                    );
                  })
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};
