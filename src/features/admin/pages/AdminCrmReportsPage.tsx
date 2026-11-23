import React, { useMemo, useState } from 'react';
import {
  Briefcase,
  Flag,
  Mail,
  Bell,
  CheckCircle2,
  Trash2,
  Eye,
  Calendar,
  Download,
  ExternalLink,
  X,
} from 'lucide-react';
import { AgentCrmDashboard } from '../../../components/crm/AgentCrmDashboard';
import { scheduleViewing, updateLeadStatus } from '../../../services/crm/agent-crm-service';
import {
  AdminAlertSubscription,
  AdminContactMessage,
  AdminReportRecord,
  AgentProfile,
  LeadRecord,
  LeadStatus,
  Property,
} from '../types';

export interface AdminCrmReportsPageProps {
  isRtl: boolean;
  userName?: string | null;
  userEmail?: string | null;
  properties: Property[];
  reports: AdminReportRecord[];
  contactMessages: AdminContactMessage[];
  alertSubscriptions: AdminAlertSubscription[];
  busyId: string | null;
  onResolveReport: (reportId: string) => Promise<void>;
  onDeleteReport: (reportId: string) => Promise<void>;
  onOpenProperty?: (propertyId: string) => void;
}

export const AdminCrmReportsPage: React.FC<AdminCrmReportsPageProps> = ({
  isRtl,
  userName,
  userEmail,
  properties,
  reports,
  contactMessages,
  alertSubscriptions,
  busyId,
  onResolveReport,
  onDeleteReport,
  onOpenProperty,
}) => {
  const [activeTab, setActiveTab] = useState<'crm' | 'reports' | 'inquiries'>('crm');

  const agentProfile: AgentProfile = useMemo(
    () => ({
      id: 'agent_admin_desk',
      name: userName || 'HETTETY Operations Desk',
      nameAr: userName || 'مكتب عمليات حتتي العقاري',
      agencyName: 'HETTETY Premier Brokerage Network',
      licenseNumber: 'EG-RE-2026-001',
      phone: '+201000000000',
      whatsapp: '+201000000000',
      email: userEmail || 'ops@hettety.com',
      rating: 4.9,
      reviewCount: 148,
      activeListingsCount: properties.length,
      closedDealsCount: 24,
      specializations: ['New Cairo', 'Sheikh Zayed', 'North Coast', '3D Guided Tours'],
      verificationBadge: true,
      commissionRatePercent: 2.5,
    }),
    [userName, userEmail, properties.length]
  );

  // Build interactive CRM leads from contactMessages & live properties (or starter executive sample if inbox is empty)
  const initialLeads = useMemo<LeadRecord[]>(() => {
    const derivedFromContacts: LeadRecord[] = contactMessages.slice(0, 8).map((msg, idx) => {
      const sampleProp = properties[idx % Math.max(1, properties.length)];
      return {
        id: `lead_contact_${msg.id}`,
        propertyId: sampleProp?.id || 'general',
        propertyTitle: sampleProp?.title || msg.subject || (isRtl ? 'استفسار عقاري عام' : 'General Property Inquiry'),
        propertyLocation: sampleProp?.location || 'Cairo, Egypt',
        buyerName: msg.name || msg.email || 'Prospective Buyer',
        buyerPhone: msg.phone || '+201000000000',
        buyerEmail: msg.email,
        assignedAgentId: agentProfile.id,
        assignedAgentName: agentProfile.name,
        status: 'new_inquiry',
        priority: 'warm',
        budget: sampleProp?.price || 6_500_000,
        currency: sampleProp?.currency || 'EGP',
        notes: msg.message
          ? [
              {
                id: `n_${msg.id}`,
                authorId: 'inbox',
                authorName: msg.name || 'Client',
                text: msg.message,
                timestamp: msg.createdAt || new Date().toISOString(),
              },
            ]
          : [],
        createdAt: msg.createdAt || new Date().toISOString(),
        updatedAt: msg.createdAt || new Date().toISOString(),
      };
    });

    if (derivedFromContacts.length > 0) return derivedFromContacts;

    const p0 = properties[0];
    const p1 = properties[1] || p0;
    const now = new Date().toISOString();
    return [
      {
        id: 'lead_ops_1',
        propertyId: p0?.id || 'prop_1',
        propertyTitle: p0?.title || (isRtl ? 'فيلا مستقلة بالتجمع الخامس' : 'Standalone Villa — New Cairo'),
        propertyLocation: p0?.location || 'New Cairo',
        buyerName: isRtl ? 'أحمد منصور' : 'Ahmed Mansour',
        buyerPhone: '+201001234567',
        assignedAgentId: agentProfile.id,
        assignedAgentName: agentProfile.name,
        status: 'viewing_scheduled',
        priority: 'hot',
        budget: p0?.price || 14_500_000,
        currency: 'EGP',
        viewingAppointment: {
          date: new Date(Date.now() + 86400000).toISOString().slice(0, 10),
          time: '15:00',
          type: 'guided_3d_tour',
          confirmedByBuyer: true,
        },
        notes: [],
        createdAt: now,
        updatedAt: now,
      },
      {
        id: 'lead_ops_2',
        propertyId: p1?.id || 'prop_2',
        propertyTitle: p1?.title || (isRtl ? 'شقة فاخرة بالشيخ زايد' : 'Luxury Apartment — Sheikh Zayed'),
        propertyLocation: p1?.location || 'Sheikh Zayed',
        buyerName: isRtl ? 'سارة الشافعي' : 'Sara El-Shafei',
        buyerPhone: '+201112345678',
        assignedAgentId: agentProfile.id,
        assignedAgentName: agentProfile.name,
        status: 'negotiating',
        priority: 'hot',
        budget: p1?.price || 8_200_000,
        currency: 'EGP',
        notes: [],
        createdAt: now,
        updatedAt: now,
      },
    ];
  }, [contactMessages, properties, agentProfile, isRtl]);

  const [leads, setLeads] = useState<LeadRecord[]>(initialLeads);
  const [schedulingLead, setSchedulingLead] = useState<LeadRecord | null>(null);
  const [visitDate, setVisitDate] = useState(new Date(Date.now() + 86400000).toISOString().slice(0, 10));
  const [visitTime, setVisitTime] = useState('14:00');
  const [visitType, setVisitType] = useState<'physical_visit' | 'guided_3d_tour'>('guided_3d_tour');

  const handleAdvanceLead = (leadId: string, nextStatus: LeadStatus) => {
    setLeads((prev) =>
      prev.map((l) => (l.id === leadId ? updateLeadStatus(l, nextStatus, undefined, agentProfile.name) : l))
    );
  };

  const handleConfirmSchedule = () => {
    if (!schedulingLead) return;
    setLeads((prev) =>
      prev.map((l) =>
        l.id === schedulingLead.id ? scheduleViewing(l, visitDate, visitTime, visitType) : l
      )
    );
    setSchedulingLead(null);
  };

  const openReportsCount = reports.filter((r) => r.status !== 'resolved').length;

  const propTitle = (id?: string) => {
    if (!id) return isRtl ? 'بلاغ عام' : 'General Report';
    return properties.find((p) => p.id === id)?.title || `#${id.slice(0, 8)}`;
  };

  const exportSubscribersCsv = () => {
    const rows = [
      ['Email', 'Query', 'Location', 'Type', 'Created At'],
      ...alertSubscriptions.map((s) => [
        s.email,
        s.query || '',
        s.location || '',
        s.propertyType || '',
        s.createdAt || '',
      ]),
    ];
    const csv = '\uFEFF' + rows.map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(',')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `hettety-alert-subscribers-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="space-y-6 animate-fade-in" data-testid="admin-crm-reports-page">
      {/* Header & Sub-Tabs */}
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-black text-slate-900 dark:text-white flex items-center gap-2.5">
            <Briefcase className="text-accent-500" size={24} />
            {isRtl ? 'مركز عمليات الـ CRM والبلاغات والتواصل' : 'Unified CRM, Reports & Inquiries Inbox'}
          </h1>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
            {isRtl
              ? 'إدارة خط مبيعات الوسطاء وجدولة المعاينات، معالجة بلاغات الإعلانات، ورسائل التواصل والمشتركين'
              : 'Broker Kanban pipeline & viewings, abuse/listing report moderation, contact form inbox & email alerts'}
          </p>
        </div>

        <div className="inline-flex flex-wrap rounded-2xl bg-white dark:bg-slate-900 p-1.5 border border-slate-200 dark:border-slate-800 shadow-xs gap-1">
          <button
            type="button"
            onClick={() => setActiveTab('crm')}
            className={`px-3.5 py-2 rounded-xl text-xs font-bold inline-flex items-center gap-1.5 cursor-pointer ${
              activeTab === 'crm'
                ? 'bg-brand-600 text-white'
                : 'text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800'
            }`}
          >
            <Briefcase size={14} />
            {isRtl ? 'CRM والمعاينات' : 'CRM & Visits'}
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('reports')}
            className={`px-3.5 py-2 rounded-xl text-xs font-bold inline-flex items-center gap-1.5 cursor-pointer ${
              activeTab === 'reports'
                ? 'bg-brand-600 text-white'
                : 'text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800'
            }`}
          >
            <Flag size={14} />
            {isRtl ? 'البلاغات' : 'Abuse Reports'}
            <span className="px-1.5 py-0.5 rounded-full text-[10px] bg-rose-500/20 text-rose-600 dark:text-rose-300 font-mono">
              {openReportsCount}
            </span>
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('inquiries')}
            className={`px-3.5 py-2 rounded-xl text-xs font-bold inline-flex items-center gap-1.5 cursor-pointer ${
              activeTab === 'inquiries'
                ? 'bg-brand-600 text-white'
                : 'text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800'
            }`}
          >
            <Mail size={14} />
            {isRtl ? 'الرسائل والتنبيهات' : 'Inquiries & Alerts'}
            <span className="px-1.5 py-0.5 rounded-full text-[10px] bg-slate-200 dark:bg-slate-700 text-slate-700 dark:text-slate-200 font-mono">
              {contactMessages.length + alertSubscriptions.length}
            </span>
          </button>
        </div>
      </div>

      {/* Tab 1: Embedded Agent CRM Dashboard */}
      {activeTab === 'crm' && (
        <AgentCrmDashboard
          agent={agentProfile}
          leads={leads}
          isRtl={isRtl}
          onUpdateLeadStatus={handleAdvanceLead}
          onOpenScheduleViewing={(lead) => setSchedulingLead(lead)}
        />
      )}

      {/* Tab 2: Abuse & Listing Reports */}
      {activeTab === 'reports' && (
        <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200/80 dark:border-slate-800 overflow-hidden shadow-xs">
          {reports.length === 0 ? (
            <div className="py-16 text-center space-y-2">
              <CheckCircle2 size={36} className="text-emerald-500 mx-auto" />
              <h3 className="text-base font-bold text-slate-900 dark:text-white">
                {isRtl ? 'لا توجد بلاغات مفتوحة حالياً' : 'Zero active abuse or listing reports'}
              </h3>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                {isRtl ? 'جميع الإعلانات مطابقة لسياسات الثقة والسلامة.' : 'All listings currently pass trust & safety standards.'}
              </p>
            </div>
          ) : (
            <div className="divide-y divide-slate-100 dark:divide-slate-800">
              {reports.map((rep) => {
                const resolved = rep.status === 'resolved';
                const isBusy = busyId === rep.id;
                return (
                  <div key={rep.id} className="p-5 flex flex-col md:flex-row md:items-center justify-between gap-4">
                    <div className="space-y-1.5 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span
                          className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${
                            resolved
                              ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950/50 dark:text-emerald-300'
                              : 'bg-rose-100 text-rose-700 dark:bg-rose-950/50 dark:text-rose-300'
                          }`}
                        >
                          {resolved ? (isRtl ? 'تم الحل' : 'Resolved') : (isRtl ? 'بلاغ مفتوح' : 'Open Report')}
                        </span>
                        <span className="font-bold text-sm text-slate-900 dark:text-white">
                          {rep.propertyTitle || propTitle(rep.propertyId)}
                        </span>
                      </div>
                      <p className="text-xs font-semibold text-rose-700 dark:text-rose-300">
                        {rep.reason || (isRtl ? 'مخالفة شروط النشر' : 'Listing policy report')}
                      </p>
                      {rep.details && (
                        <p className="text-xs text-slate-600 dark:text-slate-400">{rep.details}</p>
                      )}
                      <div className="text-[11px] text-slate-400">
                        {isRtl ? 'المُبلّغ:' : 'Reporter:'} {rep.reporterEmail || rep.reporterUid || 'Anonymous'} •{' '}
                        {rep.createdAt ? new Date(rep.createdAt).toLocaleString(isRtl ? 'ar-EG' : 'en-US') : '—'}
                      </div>
                    </div>

                    <div className="flex items-center gap-2 shrink-0">
                      {rep.propertyId && onOpenProperty && (
                        <button
                          type="button"
                          onClick={() => onOpenProperty(rep.propertyId!)}
                          className="px-3 py-1.5 rounded-xl bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-200 text-xs font-bold inline-flex items-center gap-1 cursor-pointer"
                        >
                          <Eye size={14} />
                          {isRtl ? 'فحص العقار' : 'Inspect'}
                        </button>
                      )}
                      {!resolved && (
                        <button
                          type="button"
                          disabled={isBusy}
                          onClick={() => onResolveReport(rep.id)}
                          className="px-3 py-1.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold inline-flex items-center gap-1 cursor-pointer disabled:opacity-50"
                        >
                          <CheckCircle2 size={14} />
                          {isRtl ? 'إغلاق كمحلول' : 'Resolve'}
                        </button>
                      )}
                      <button
                        type="button"
                        disabled={isBusy}
                        onClick={() => onDeleteReport(rep.id)}
                        className="p-2 rounded-xl bg-rose-50 dark:bg-rose-950/40 text-rose-600 hover:bg-rose-100 cursor-pointer disabled:opacity-50"
                        title={isRtl ? 'حذف البلاغ' : 'Delete report'}
                      >
                        <Trash2 size={14} />
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* Tab 3: Contact Messages & Alert Subscribers */}
      {activeTab === 'inquiries' && (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
          {/* Contact Form Inquiries */}
          <section className="lg:col-span-7 bg-white dark:bg-slate-900 rounded-2xl border border-slate-200/80 dark:border-slate-800 overflow-hidden shadow-xs">
            <div className="px-5 py-4 border-b border-slate-100 dark:border-slate-800 flex items-center justify-between">
              <h2 className="text-sm font-bold text-slate-900 dark:text-white flex items-center gap-2">
                <Mail size={16} className="text-accent-500" />
                {isRtl ? `رسائل نموذج التواصل (${contactMessages.length})` : `Contact Form Inquiries (${contactMessages.length})`}
              </h2>
            </div>

            {contactMessages.length === 0 ? (
              <div className="py-12 px-6 text-center text-xs text-slate-500">
                {isRtl ? 'لا توجد رسائل تواصل واردة بعد.' : 'No contact form inquiries received yet.'}
              </div>
            ) : (
              <div className="divide-y divide-slate-100 dark:divide-slate-800 max-h-[500px] overflow-y-auto custom-scrollbar">
                {contactMessages.map((msg) => (
                  <div key={msg.id} className="p-4 space-y-2 hover:bg-slate-50/70 dark:hover:bg-slate-800/30">
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <div className="font-bold text-xs text-slate-900 dark:text-white">
                          {msg.name || (isRtl ? 'زائر' : 'Visitor')}{' '}
                          <span className="font-normal text-slate-400">({msg.email || '—'})</span>
                        </div>
                        {msg.subject && (
                          <div className="text-xs font-semibold text-accent-600 dark:text-accent-400 mt-0.5">
                            {msg.subject}
                          </div>
                        )}
                      </div>
                      {msg.email && (
                        <a
                          href={`mailto:${msg.email}?subject=Re: HETTETY Inquiry`}
                          className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-brand-600/10 text-brand-700 dark:bg-brand-500/20 dark:text-brand-200 text-[11px] font-bold shrink-0"
                        >
                          <ExternalLink size={11} />
                          {isRtl ? 'رد' : 'Reply'}
                        </a>
                      )}
                    </div>
                    <p className="text-xs text-slate-600 dark:text-slate-300 leading-relaxed">
                      {msg.message || '—'}
                    </p>
                  </div>
                ))}
              </div>
            )}
          </section>

          {/* Email Alert Subscribers */}
          <section className="lg:col-span-5 bg-white dark:bg-slate-900 rounded-2xl border border-slate-200/80 dark:border-slate-800 overflow-hidden shadow-xs">
            <div className="px-5 py-4 border-b border-slate-100 dark:border-slate-800 flex items-center justify-between gap-2">
              <h2 className="text-sm font-bold text-slate-900 dark:text-white flex items-center gap-2">
                <Bell size={16} className="text-accent-500" />
                {isRtl ? `مشتركو التنبيهات (${alertSubscriptions.length})` : `Alert Subscribers (${alertSubscriptions.length})`}
              </h2>
              {alertSubscriptions.length > 0 && (
                <button
                  type="button"
                  onClick={exportSubscribersCsv}
                  className="text-[11px] font-bold text-accent-600 dark:text-accent-400 inline-flex items-center gap-1 hover:underline cursor-pointer"
                >
                  <Download size={12} /> CSV
                </button>
              )}
            </div>

            {alertSubscriptions.length === 0 ? (
              <div className="py-12 px-6 text-center text-xs text-slate-500">
                {isRtl ? 'لا يوجد مشتركون في تنبيهات العقارات بعد.' : 'No email alert subscribers yet.'}
              </div>
            ) : (
              <div className="divide-y divide-slate-100 dark:divide-slate-800 max-h-[500px] overflow-y-auto custom-scrollbar">
                {alertSubscriptions.map((sub) => (
                  <div key={sub.id} className="p-4 flex items-center justify-between gap-2 text-xs">
                    <div className="min-w-0">
                      <div className="font-bold text-slate-900 dark:text-white truncate">{sub.email}</div>
                      <div className="text-[11px] text-slate-500 truncate mt-0.5">
                        {sub.location || sub.query || sub.propertyType || (isRtl ? 'كل العقارات الجديدة' : 'All new listings')}
                      </div>
                    </div>
                    <span className="text-[10px] font-mono text-slate-400 shrink-0">
                      {sub.createdAt ? sub.createdAt.slice(0, 10) : '—'}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </section>
        </div>
      )}

      {/* Schedule Viewing Modal */}
      {schedulingLead && (
        <div
          role="dialog"
          aria-modal="true"
          className="fixed inset-0 z-50 bg-slate-950/60 backdrop-blur-xs flex items-center justify-center p-4"
        >
          <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 max-w-md w-full p-6 shadow-2xl space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="text-base font-black text-slate-900 dark:text-white flex items-center gap-2">
                <Calendar size={18} className="text-accent-500" />
                {isRtl ? 'جدولة موعد معاينة' : 'Schedule Client Viewing'}
              </h3>
              <button
                type="button"
                onClick={() => setSchedulingLead(null)}
                className="p-1 text-slate-400 hover:text-slate-700 cursor-pointer"
              >
                <X size={18} />
              </button>
            </div>
            <p className="text-xs text-slate-500">
              {schedulingLead.buyerName} — {schedulingLead.propertyTitle}
            </p>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <label className="text-[11px] font-bold text-slate-600 dark:text-slate-300">
                  {isRtl ? 'التاريخ' : 'Date'}
                </label>
                <input
                  type="date"
                  value={visitDate}
                  onChange={(e) => setVisitDate(e.target.value)}
                  className="w-full px-3 py-2 rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-xs"
                />
              </div>
              <div className="space-y-1">
                <label className="text-[11px] font-bold text-slate-600 dark:text-slate-300">
                  {isRtl ? 'الوقت' : 'Time'}
                </label>
                <input
                  type="time"
                  value={visitTime}
                  onChange={(e) => setVisitTime(e.target.value)}
                  className="w-full px-3 py-2 rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-xs"
                />
              </div>
            </div>
            <div className="space-y-1">
              <label className="text-[11px] font-bold text-slate-600 dark:text-slate-300">
                {isRtl ? 'نوع المعاينة' : 'Viewing Mode'}
              </label>
              <select
                value={visitType}
                onChange={(e) => setVisitType(e.target.value as any)}
                className="w-full px-3 py-2 rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-xs font-semibold"
              >
                <option value="guided_3d_tour">{isRtl ? 'جولة 3D تفاعلية مع المستشار' : 'Guided 3D Spatial Walkthrough'}</option>
                <option value="physical_visit">{isRtl ? 'معاينة ميدانية في الموقع' : 'Physical On-Site Visit'}</option>
              </select>
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => setSchedulingLead(null)}
                className="px-4 py-2 rounded-xl text-xs font-bold text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 cursor-pointer"
              >
                {isRtl ? 'إلغاء' : 'Cancel'}
              </button>
              <button
                type="button"
                onClick={handleConfirmSchedule}
                className="px-4 py-2 rounded-xl bg-accent-500 hover:bg-accent-600 text-white text-xs font-bold cursor-pointer"
              >
                {isRtl ? 'تأكيد الموعد' : 'Confirm Appointment'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
