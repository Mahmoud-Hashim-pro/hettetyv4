import React from 'react';
import {
  Users,
  Building2,
  ShieldCheck,
  Clock,
  Box,
  Landmark,
  ShoppingBag,
  Flag,
  Activity,
  Server,
  Sparkles,
  Cpu,
  ShieldAlert,
  Database,
  Plus,
  ArrowUpRight,
  ArrowUpLeft,
  CheckCircle2,
  AlertTriangle,
  XCircle,
  PauseCircle,
  History,
  FileCheck2,
} from 'lucide-react';
import {
  AdminOverviewMetrics,
  AdminSectionId,
  AuditLogEntry,
  Property,
  ServiceHealthItem,
} from '../types';

export interface AdminOverviewPageProps {
  isRtl: boolean;
  isSuperAdmin: boolean;
  userName?: string | null;
  metrics: AdminOverviewMetrics;
  properties: Property[];
  auditLogs: AuditLogEntry[];
  onNavigate: (section: AdminSectionId) => void;
  onOpenAddListing?: () => void;
}

const SERVICE_ICONS: Record<ServiceHealthItem['id'], React.ReactNode> = {
  neon_postgres: <Database size={18} />,
  object_storage: <Server size={18} />,
  ai_advisor: <Sparkles size={18} />,
  gpu_3d_workers: <Cpu size={18} />,
  rate_limiter: <ShieldAlert size={18} />,
};

export const AdminOverviewPage: React.FC<AdminOverviewPageProps> = ({
  isRtl,
  isSuperAdmin,
  userName,
  metrics,
  properties,
  auditLogs,
  onNavigate,
  onOpenAddListing,
}) => {
  const ArrowIcon = isRtl ? ArrowUpLeft : ArrowUpRight;

  const verificationRate =
    metrics.totalProperties > 0
      ? Math.round((metrics.verifiedProperties / metrics.totalProperties) * 100)
      : 0;
  const rejectedCount = properties.filter((p) => p.verificationStatus === 'Rejected').length;
  const availableCount = properties.filter((p) => (p.availability || 'Available') === 'Available').length;
  const reservedCount = properties.filter((p) => p.availability === 'Reserved').length;
  const soldCount = properties.filter((p) => p.availability === 'Sold').length;
  const pendingTotal = metrics.pendingVerifications + metrics.pendingDocuments;

  const formatEgpCompact = (amount: number) => {
    if (amount >= 1_000_000) return `${(amount / 1_000_000).toFixed(2)}M`;
    if (amount >= 1_000) return `${(amount / 1_000).toFixed(1)}K`;
    return amount.toLocaleString();
  };

  const formatRelativeTime = (iso: string) => {
    const dt = new Date(iso);
    if (Number.isNaN(dt.getTime())) return iso;
    const diffMin = Math.max(0, Math.round((Date.now() - dt.getTime()) / 60000));
    if (diffMin < 1) return isRtl ? 'الآن' : 'Just now';
    if (diffMin < 60) return isRtl ? `منذ ${diffMin} د` : `${diffMin}m ago`;
    const diffHr = Math.round(diffMin / 60);
    if (diffHr < 24) return isRtl ? `منذ ${diffHr} س` : `${diffHr}h ago`;
    return dt.toLocaleDateString(isRtl ? 'ar-EG' : 'en-US', { month: 'short', day: 'numeric' });
  };

  const renderStatusPill = (status: ServiceHealthItem['status']) => {
    switch (status) {
      case 'healthy':
        return (
          <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[11px] font-bold bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 border border-emerald-500/30">
            <CheckCircle2 size={12} />
            {isRtl ? 'نشط وسليم' : 'Healthy'}
          </span>
        );
      case 'configured':
        return (
          <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[11px] font-bold bg-sky-500/15 text-sky-700 dark:text-sky-300 border border-sky-500/30">
            <Activity size={12} />
            {isRtl ? 'مهيأ' : 'Configured'}
          </span>
        );
      case 'standby':
        return (
          <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[11px] font-bold bg-amber-500/15 text-amber-700 dark:text-amber-300 border border-amber-500/30">
            <PauseCircle size={12} />
            {isRtl ? 'وضع الاستعداد' : 'Standby'}
          </span>
        );
      case 'degraded':
        return (
          <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[11px] font-bold bg-orange-500/15 text-orange-700 dark:text-orange-300 border border-orange-500/30">
            <AlertTriangle size={12} />
            {isRtl ? 'أداء منخفض' : 'Degraded'}
          </span>
        );
      default:
        return (
          <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[11px] font-bold bg-rose-500/15 text-rose-700 dark:text-rose-300 border border-rose-500/30">
            <XCircle size={12} />
            {isRtl ? 'غير متصل' : 'Offline'}
          </span>
        );
    }
  };

  const kpiCards = [
    {
      id: 'users',
      section: 'users' as AdminSectionId,
      label: isRtl ? 'إجمالي المستخدمين' : 'Total Users',
      value: metrics.totalUsers.toLocaleString(),
      sub: isRtl ? `${metrics.totalAdmins} مديرين وصلاحيات عليا` : `${metrics.totalAdmins} admin accounts`,
      icon: <Users size={20} />,
      accent: 'bg-brand-600/10 text-brand-700 dark:bg-brand-500/20 dark:text-brand-200',
    },
    {
      id: 'properties',
      section: 'properties' as AdminSectionId,
      label: isRtl ? 'إجمالي العقارات' : 'Total Properties',
      value: metrics.totalProperties.toLocaleString(),
      sub: isRtl ? `${metrics.liveProperties} إعلان منشور حالياً` : `${metrics.liveProperties} live on site`,
      icon: <Building2 size={20} />,
      accent: 'bg-accent-500/15 text-accent-600 dark:text-accent-400',
    },
    {
      id: 'verified',
      section: 'properties' as AdminSectionId,
      label: isRtl ? 'وحدات موثّقة' : 'Verified Units',
      value: metrics.verifiedProperties.toLocaleString(),
      sub: isRtl ? `نسبة التوثيق ${verificationRate}%` : `${verificationRate}% verification rate`,
      icon: <ShieldCheck size={20} />,
      accent: 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400',
    },
    {
      id: 'pending',
      section: 'verifications' as AdminSectionId,
      label: isRtl ? 'مراجعات بانتظار القرار' : 'Pending Reviews',
      value: pendingTotal.toLocaleString(),
      sub: isRtl
        ? `${metrics.pendingVerifications} عقار • ${metrics.pendingDocuments} مستند`
        : `${metrics.pendingVerifications} listings • ${metrics.pendingDocuments} docs`,
      icon: <Clock size={20} />,
      accent:
        pendingTotal > 0
          ? 'bg-amber-500/15 text-amber-600 dark:text-amber-400'
          : 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300',
    },
    {
      id: '3d',
      section: 'reconstruction' as AdminSectionId,
      label: isRtl ? 'جولات 3D تفاعلية' : '3D Spatial Tours',
      value: metrics.propertiesWith3D.toLocaleString(),
      sub: isRtl
        ? `${metrics.activeReconstructionJobs} مهام قيد المعالجة`
        : `${metrics.activeReconstructionJobs} active GPU jobs`,
      icon: <Box size={20} />,
      accent: 'bg-purple-500/15 text-purple-600 dark:text-purple-400',
    },
    {
      id: 'escrow',
      section: 'escrow' as AdminSectionId,
      label: isRtl ? 'حجم الضمان النشط (EGP)' : 'Active Escrow Volume',
      value: `${formatEgpCompact(metrics.activeEscrowVolumeEGP)} EGP`,
      sub: isRtl
        ? `${metrics.activeEscrowCount} صفقات ضمان جارية`
        : `${metrics.activeEscrowCount} active escrow deals`,
      icon: <Landmark size={20} />,
      accent: 'bg-teal-500/15 text-teal-600 dark:text-teal-400',
    },
    {
      id: 'purchases',
      section: 'escrow' as AdminSectionId,
      label: isRtl ? 'طلبات شراء مفتوحة' : 'Open Purchases',
      value: metrics.openPurchases.toLocaleString(),
      sub: isRtl ? 'بانتظار التسوية والتأكيد' : 'Awaiting settlement review',
      icon: <ShoppingBag size={20} />,
      accent: 'bg-sky-500/15 text-sky-600 dark:text-sky-400',
    },
    {
      id: 'reports',
      section: 'crm' as AdminSectionId,
      label: isRtl ? 'البلاغات المفتوحة' : 'Open Reports',
      value: metrics.openReports.toLocaleString(),
      sub: isRtl ? 'مراجعة البلاغات والمخالفات' : 'Trust & safety moderation',
      icon: <Flag size={20} />,
      accent:
        metrics.openReports > 0
          ? 'bg-rose-500/15 text-rose-600 dark:text-rose-400'
          : 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300',
    },
  ];

  const pipelineBars = [
    {
      label: isRtl ? 'عقارات للبيع' : 'For Sale',
      count: metrics.forSaleCount,
      total: Math.max(1, metrics.totalProperties),
      barClass: 'bg-brand-600 dark:bg-brand-400',
    },
    {
      label: isRtl ? 'عقارات للإيجار' : 'For Rent',
      count: metrics.forRentCount,
      total: Math.max(1, metrics.totalProperties),
      barClass: 'bg-accent-500',
    },
    {
      label: isRtl ? 'موثّق ومعتمد' : 'Verified',
      count: metrics.verifiedProperties,
      total: Math.max(1, metrics.totalProperties),
      barClass: 'bg-emerald-500',
    },
    {
      label: isRtl ? 'بانتظار المراجعة' : 'Pending Review',
      count: metrics.pendingVerifications,
      total: Math.max(1, metrics.totalProperties),
      barClass: 'bg-amber-500',
    },
    {
      label: isRtl ? 'مرفوض / يحتاج تعديل' : 'Needs Changes',
      count: rejectedCount,
      total: Math.max(1, metrics.totalProperties),
      barClass: 'bg-rose-500',
    },
    {
      label: isRtl ? 'يدعم جولة 3D' : 'With 3D Tour',
      count: metrics.propertiesWith3D,
      total: Math.max(1, metrics.totalProperties),
      barClass: 'bg-purple-500',
    },
  ];

  return (
    <div className="space-y-6 animate-fade-in" data-testid="admin-overview-page">
      {/* Executive Welcome Banner */}
      <div className="relative overflow-hidden rounded-3xl bg-gradient-to-br from-brand-800 via-brand-700 to-brand-900 dark:from-brand-900 dark:via-brand-950 dark:to-slate-950 text-white p-6 sm:p-8 shadow-lg border border-brand-600/30">
        <div className="absolute -end-16 -top-16 w-64 h-64 rounded-full bg-accent-500/15 blur-3xl pointer-events-none" />
        <div className="relative flex flex-col lg:flex-row lg:items-center justify-between gap-6">
          <div className="space-y-2 max-w-2xl">
            <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-white/10 border border-white/15 text-xs font-bold text-accent-300">
              <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
              {isRtl ? 'نظام التشغيل الإداري — HETTETY Admin OS v4' : 'HETTETY Enterprise Command Center v4'}
            </div>
            <h1 className="text-2xl sm:text-3xl font-black leading-tight">
              {isRtl
                ? `أهلاً بك، ${userName || 'مدير النظام'}`
                : `Welcome back, ${userName || 'Operations Lead'}`}
            </h1>
            <p className="text-sm text-brand-100/80 leading-relaxed">
              {isRtl
                ? 'تحكم لحظي كامل في مخزون العقارات، خط إنتاج الجولات ثلاثية الأبعاد، صفقات الضمان، صلاحيات RBAC، المستشار العقاري الذكي، وقاعدة بيانات Neon Postgres.'
                : 'Real-time operational command across property inventory, 3D Gaussian Splatting pipelines, escrow settlements, RBAC IAM, AI Advisor telemetry, and Neon Postgres.'}
            </p>
          </div>

          {/* Quick Actions Deck */}
          <div className="flex flex-wrap gap-2.5 shrink-0">
            {onOpenAddListing && (
              <button
                type="button"
                onClick={onOpenAddListing}
                className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-accent-500 hover:bg-accent-600 text-white font-bold text-xs shadow-lg shadow-accent-500/25 transition-all cursor-pointer"
              >
                <Plus size={16} />
                {isRtl ? 'إضافة عقار جديد' : 'Add Property'}
              </button>
            )}
            <button
              type="button"
              onClick={() => onNavigate('verifications')}
              className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-white/10 hover:bg-white/20 text-white font-bold text-xs border border-white/15 transition-all cursor-pointer"
            >
              <FileCheck2 size={16} />
              {isRtl ? `طابور المراجعة (${pendingTotal})` : `Review Queue (${pendingTotal})`}
            </button>
            <button
              type="button"
              onClick={() => onNavigate('ai-ops')}
              className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-white/10 hover:bg-white/20 text-white font-bold text-xs border border-white/15 transition-all cursor-pointer"
            >
              <Sparkles size={16} />
              {isRtl ? 'فحص المستشار الذكي' : 'AI Ops Console'}
            </button>
            {isSuperAdmin && (
              <button
                type="button"
                onClick={() => onNavigate('audit-settings')}
                className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-white/10 hover:bg-white/20 text-white font-bold text-xs border border-white/15 transition-all cursor-pointer"
              >
                <Database size={16} />
                {isRtl ? 'إدارة نيون' : 'Neon DB Ops'}
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Executive 8-Card KPI Grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
        {kpiCards.map((card) => (
          <button
            key={card.id}
            type="button"
            onClick={() => onNavigate(card.section)}
            className="group text-start bg-white dark:bg-slate-900 rounded-2xl p-5 border border-slate-200/80 dark:border-slate-800 hover:border-accent-500/50 dark:hover:border-accent-500/40 shadow-xs hover:shadow-md transition-all cursor-pointer"
          >
            <div className="flex items-start justify-between gap-3">
              <div className={`w-11 h-11 rounded-xl flex items-center justify-center shrink-0 ${card.accent}`}>
                {card.icon}
              </div>
              <ArrowIcon
                size={16}
                className="text-slate-300 dark:text-slate-600 group-hover:text-accent-500 transition-colors"
              />
            </div>
            <div className="mt-4">
              <div className="text-xs font-semibold text-slate-500 dark:text-slate-400">
                {card.label}
              </div>
              <div className="text-2xl font-black text-slate-900 dark:text-white mt-1 font-mono tracking-tight">
                {card.value}
              </div>
              <div className="text-[11px] font-medium text-slate-500 dark:text-slate-400 mt-1.5">
                {card.sub}
              </div>
            </div>
          </button>
        ))}
      </div>

      {/* Live Infrastructure Health Matrix */}
      <section className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200/80 dark:border-slate-800 shadow-xs overflow-hidden">
        <div className="px-6 py-4 border-b border-slate-100 dark:border-slate-800 flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2.5">
            <div className="w-9 h-9 rounded-xl bg-brand-600/10 dark:bg-brand-500/20 text-brand-700 dark:text-brand-200 flex items-center justify-center">
              <Activity size={18} />
            </div>
            <div>
              <h2 className="text-base font-bold text-slate-900 dark:text-white">
                {isRtl ? 'مصفوفة صحة البنية التحتية السحابية' : 'Live Infrastructure Health Matrix'}
              </h2>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                {isRtl
                  ? 'مراقبة لحظية لقاعدة البيانات نيون، التخزين، المستشار الذكي، معالجات 3D، ومحدد المعدل'
                  : 'Real-time telemetry across Neon Postgres, Object Storage, AI Advisor, 3D GPU cluster & Rate Limiter'}
              </p>
            </div>
          </div>
          <span className="text-[11px] font-mono font-bold px-2.5 py-1 rounded-lg bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300">
            5 / 5 {isRtl ? 'أنظمة مُراقبة' : 'Subsystems Monitored'}
          </span>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-5 divide-y md:divide-y-0 md:divide-x rtl:md:divide-x-reverse divide-slate-100 dark:divide-slate-800">
          {metrics.servicesHealth.map((svc) => (
            <div key={svc.id} className="p-5 flex flex-col justify-between gap-3 hover:bg-slate-50/70 dark:hover:bg-slate-800/30 transition-colors">
              <div className="space-y-3">
                <div className="flex items-center justify-between gap-2">
                  <div className="w-9 h-9 rounded-xl bg-slate-100 dark:bg-slate-800 text-brand-600 dark:text-accent-400 flex items-center justify-center shrink-0">
                    {SERVICE_ICONS[svc.id]}
                  </div>
                  {renderStatusPill(svc.status)}
                </div>
                <div>
                  <h3 className="text-xs font-bold text-slate-900 dark:text-white">
                    {isRtl ? svc.nameAr : svc.name}
                  </h3>
                  <div className="text-[11px] font-semibold text-accent-600 dark:text-accent-400 mt-0.5">
                    {svc.provider}
                  </div>
                </div>
                <p className="text-[11px] text-slate-500 dark:text-slate-400 leading-relaxed">
                  {isRtl ? svc.detailsAr : svc.details}
                </p>
              </div>
              {svc.latencyMs !== undefined && (
                <div className="pt-2 border-t border-slate-100 dark:border-slate-800 text-[11px] font-mono text-slate-500 dark:text-slate-400 flex items-center justify-between">
                  <span>{isRtl ? 'زمن الاستجابة' : 'Latency'}</span>
                  <span className="font-bold text-slate-800 dark:text-slate-200">{svc.latencyMs}ms</span>
                </div>
              )}
            </div>
          ))}
        </div>
      </section>

      {/* Bottom Split: Pipeline Breakdown + Recent Audit Feed */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* Property Pipeline Breakdown */}
        <section className="lg:col-span-7 bg-white dark:bg-slate-900 rounded-2xl border border-slate-200/80 dark:border-slate-800 p-6 shadow-xs space-y-5">
          <div className="flex items-center justify-between gap-3">
            <div>
              <h2 className="text-base font-bold text-slate-900 dark:text-white">
                {isRtl ? 'توزيع خط إنتاج العقارات والتوثيق' : 'Property Inventory & Verification Funnel'}
              </h2>
              <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                {isRtl
                  ? 'نسب البيع والإيجار وحالة التوثيق والتوافر في المخزون المباشر'
                  : 'Distribution by listing type, verification stage, spatial readiness & availability'}
              </p>
            </div>
            <button
              type="button"
              onClick={() => onNavigate('properties')}
              className="text-xs font-bold text-accent-600 dark:text-accent-400 hover:underline cursor-pointer"
            >
              {isRtl ? 'إدارة المخزون' : 'Manage CMS'}
            </button>
          </div>

          <div className="space-y-3.5">
            {pipelineBars.map((bar) => {
              const pct = metrics.totalProperties > 0 ? Math.round((bar.count / bar.total) * 100) : 0;
              return (
                <div key={bar.label} className="space-y-1.5">
                  <div className="flex items-center justify-between text-xs">
                    <span className="font-semibold text-slate-700 dark:text-slate-200">{bar.label}</span>
                    <span className="font-mono font-bold text-slate-900 dark:text-white">
                      {bar.count} <span className="text-slate-400 font-normal">({pct}%)</span>
                    </span>
                  </div>
                  <div className="h-2.5 w-full rounded-full bg-slate-100 dark:bg-slate-800 overflow-hidden">
                    <div
                      className={`h-full rounded-full transition-all duration-500 ${bar.barClass}`}
                      style={{ width: `${Math.min(100, pct)}%` }}
                    />
                  </div>
                </div>
              );
            })}
          </div>

          {/* Availability Distribution Chips */}
          <div className="pt-4 border-t border-slate-100 dark:border-slate-800 grid grid-cols-3 gap-3">
            <div className="rounded-xl bg-emerald-50/70 dark:bg-emerald-950/30 border border-emerald-200/60 dark:border-emerald-900/50 p-3 text-center">
              <div className="text-lg font-black font-mono text-emerald-700 dark:text-emerald-300">{availableCount}</div>
              <div className="text-[11px] font-bold text-emerald-600 dark:text-emerald-400">
                {isRtl ? 'متاح' : 'Available'}
              </div>
            </div>
            <div className="rounded-xl bg-amber-50/70 dark:bg-amber-950/30 border border-amber-200/60 dark:border-amber-900/50 p-3 text-center">
              <div className="text-lg font-black font-mono text-amber-700 dark:text-amber-300">{reservedCount}</div>
              <div className="text-[11px] font-bold text-amber-600 dark:text-amber-400">
                {isRtl ? 'محجوز' : 'Reserved'}
              </div>
            </div>
            <div className="rounded-xl bg-slate-100 dark:bg-slate-800/70 border border-slate-200 dark:border-slate-700 p-3 text-center">
              <div className="text-lg font-black font-mono text-slate-800 dark:text-slate-200">{soldCount}</div>
              <div className="text-[11px] font-bold text-slate-500 dark:text-slate-400">
                {isRtl ? 'مباع' : 'Sold'}
              </div>
            </div>
          </div>
        </section>

        {/* Recent Immutable Audit Feed */}
        <section className="lg:col-span-5 bg-white dark:bg-slate-900 rounded-2xl border border-slate-200/80 dark:border-slate-800 p-6 shadow-xs flex flex-col">
          <div className="flex items-center justify-between gap-2 mb-4">
            <div className="flex items-center gap-2">
              <History size={18} className="text-accent-500" />
              <h2 className="text-base font-bold text-slate-900 dark:text-white">
                {isRtl ? 'آخر عمليات سجل التدقيق' : 'Recent Audit Activity'}
              </h2>
            </div>
            <button
              type="button"
              onClick={() => onNavigate('audit-settings')}
              className="text-xs font-bold text-accent-600 dark:text-accent-400 hover:underline cursor-pointer"
            >
              {isRtl ? 'عرض السجل الكامل' : 'Full Log'}
            </button>
          </div>

          {auditLogs.length === 0 ? (
            <div className="flex-1 flex flex-col items-center justify-center py-10 text-center">
              <div className="w-12 h-12 rounded-2xl bg-slate-100 dark:bg-slate-800 text-slate-400 flex items-center justify-center mb-3">
                <History size={22} />
              </div>
              <p className="text-sm font-bold text-slate-700 dark:text-slate-200">
                {isRtl ? 'لا توجد حركات مسجّلة بعد' : 'No audit events recorded yet'}
              </p>
              <p className="text-xs text-slate-500 dark:text-slate-400 mt-1 max-w-xs">
                {isRtl
                  ? 'سيتم توثيق كل إجراء إداري هنا تلقائياً باسم المنفّذ والوقت وحالة البيانات.'
                  : 'Every admin mutation will automatically appear here with actor, timestamp, and state diff.'}
              </p>
            </div>
          ) : (
            <div className="space-y-3 overflow-y-auto max-h-[360px] pe-1 custom-scrollbar">
              {auditLogs.slice(0, 8).map((entry) => (
                <div
                  key={entry.id}
                  className="p-3.5 rounded-xl bg-slate-50/80 dark:bg-slate-800/40 border border-slate-100 dark:border-slate-800 space-y-1.5"
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-[10px] font-mono font-bold px-2 py-0.5 rounded-md bg-brand-600/10 text-brand-700 dark:bg-brand-500/20 dark:text-brand-200">
                      {entry.action}
                    </span>
                    <span className="text-[10px] text-slate-400 font-medium">
                      {formatRelativeTime(entry.createdAt)}
                    </span>
                  </div>
                  <p className="text-xs font-medium text-slate-700 dark:text-slate-200 leading-snug">
                    {entry.summary}
                  </p>
                  <div className="flex items-center justify-between text-[10px] text-slate-500 dark:text-slate-400">
                    <span className="truncate">{entry.actorEmail}</span>
                    <span className="uppercase font-bold text-slate-400">{entry.resourceType}</span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>
      </div>
    </div>
  );
};
