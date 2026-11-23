import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  History,
  Settings,
  Database,
  Search,
  ChevronDown,
  ChevronUp,
  Save,
  RefreshCw,
  AlertTriangle,
  ShieldAlert,
  CheckCircle2,
  Download,
  Trash2,
  Loader2,
  Lock,
} from 'lucide-react';
import {
  AdminNeonConnectionStatus,
  AuditLogEntry,
  ResetPropertiesResult,
  SystemSettings,
} from '../types';
import { adminPortalService } from '../services/adminPortalService';

export interface AdminAuditSettingsPageProps {
  isRtl: boolean;
  isSuperAdmin: boolean;
  userEmail?: string | null;
  auditLogs: AuditLogEntry[];
  settings: SystemSettings;
  counts: {
    users: number;
    properties: number;
    transactions: number;
    jobs: number;
  };
  onSaveSettings: (patch: Partial<SystemSettings>) => Promise<SystemSettings>;
  onResetPropertiesKeepUsers: () => Promise<ResetPropertiesResult>;
}

const RESOURCE_FILTERS: Array<'all' | AuditLogEntry['resourceType']> = [
  'all',
  'property',
  'user',
  'document',
  'transaction',
  'purchase',
  'reconstruction',
  'report',
  'ai',
  'system',
];

export const AdminAuditSettingsPage: React.FC<AdminAuditSettingsPageProps> = ({
  isRtl,
  isSuperAdmin,
  auditLogs,
  settings,
  counts,
  onSaveSettings,
  onResetPropertiesKeepUsers,
}) => {
  const [subTab, setSubTab] = useState<'audit' | 'settings' | 'neon'>('audit');

  // Audit state
  const [auditSearch, setAuditSearch] = useState('');
  const [resourceFilter, setResourceFilter] = useState<'all' | AuditLogEntry['resourceType']>('all');
  const [expandedId, setExpandedId] = useState<string | null>(null);

  // Settings form state
  const [draft, setDraft] = useState<SystemSettings>(settings);
  const [savingSettings, setSavingSettings] = useState(false);

  useEffect(() => {
    setDraft(settings);
  }, [settings]);

  // Neon DB Health & Danger Zone state
  const [neonStatus, setNeonStatus] = useState<AdminNeonConnectionStatus | null>(null);
  const [checkingNeon, setCheckingNeon] = useState(false);
  const [confirmText, setConfirmText] = useState('');
  const [resetting, setResetting] = useState(false);
  const [resetResult, setResetResult] = useState<ResetPropertiesResult | null>(null);
  const [resetError, setResetError] = useState<string | null>(null);

  const checkNeon = useCallback(async () => {
    setCheckingNeon(true);
    const res = await adminPortalService.checkNeonHealth({
      users: counts.users,
      properties: counts.properties,
      transactions: counts.transactions,
      auditLogs: auditLogs.length,
      jobs: counts.jobs,
    });
    setNeonStatus(res);
    setCheckingNeon(false);
  }, [counts.users, counts.properties, counts.transactions, counts.jobs, auditLogs.length]);

  useEffect(() => {
    checkNeon();
  }, [checkNeon]);

  const filteredLogs = useMemo(() => {
    const q = auditSearch.trim().toLowerCase();
    return auditLogs.filter((entry) => {
      if (resourceFilter !== 'all' && entry.resourceType !== resourceFilter) return false;
      if (q) {
        const hay = `${entry.action} ${entry.summary} ${entry.actorEmail} ${entry.resourceId} ${entry.resourceType}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [auditLogs, auditSearch, resourceFilter]);

  const handleSaveSettings = async (e: React.FormEvent) => {
    e.preventDefault();
    setSavingSettings(true);
    try {
      await onSaveSettings(draft);
    } finally {
      setSavingSettings(false);
    }
  };

  const handleExecuteReset = async () => {
    if (confirmText.trim() !== 'RESET' || !isSuperAdmin || resetting) return;
    setResetting(true);
    setResetError(null);
    try {
      const res = await onResetPropertiesKeepUsers();
      setResetResult(res);
      setConfirmText('');
      await checkNeon();
    } catch (err: any) {
      setResetError(err?.message || (isRtl ? 'تعذّر تنفيذ عملية التصفير.' : 'Reset operation failed.'));
    } finally {
      setResetting(false);
    }
  };

  const exportAuditJson = () => {
    const blob = new Blob([JSON.stringify(filteredLogs, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `hettety-audit-logs-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const toggleFlags: Array<{
    key: keyof Pick<
      SystemSettings,
      | 'maintenanceMode'
      | 'allowPublicRegistration'
      | 'requireAdminApprovalForListings'
      | 'enable3DReconstructionPipeline'
      | 'enableAiAdvisor'
    >;
    labelEn: string;
    labelAr: string;
    descEn: string;
    descAr: string;
    warn?: boolean;
  }> = [
    {
      key: 'maintenanceMode',
      labelEn: 'Maintenance Mode',
      labelAr: 'وضع الصيانة الشامل',
      descEn: 'Temporarily pause public traffic while keeping Admin OS accessible.',
      descAr: 'إيقاف واجهة الموقع العام مؤقتاً مع إبقاء لوحة الإدارة متاحة.',
      warn: true,
    },
    {
      key: 'allowPublicRegistration',
      labelEn: 'Public User Registration',
      labelAr: 'السماح بتسجيل حسابات جديدة',
      descEn: 'Allow new buyers, sellers, and brokers to create accounts.',
      descAr: 'تمكين المشترين والبائعين والوسطاء الجدد من إنشاء حسابات.',
    },
    {
      key: 'requireAdminApprovalForListings',
      labelEn: 'Require Verification Before Badge',
      labelAr: 'اشتراط مراجعة الإدارة للتوثيق',
      descEn: 'New listings enter the Verification Queue before receiving Verified status.',
      descAr: 'تدخل الإعلانات الجديدة طابور المراجعة قبل منح شارة التوثيق.',
    },
    {
      key: 'enable3DReconstructionPipeline',
      labelEn: '3D Photogrammetry & 3DGS Pipeline',
      labelAr: 'خط إنتاج الجولات ثلاثية الأبعاد (3DGS)',
      descEn: 'Enable GPU capture uploads and automatic SPZ/GLB spatial generation.',
      descAr: 'تفعيل رفع الوسائط ومعالجة نماذج 3D على عقد الـ GPU.',
    },
    {
      key: 'enableAiAdvisor',
      labelEn: 'AI Real Estate Advisor',
      labelAr: 'المستشار العقاري الذكي (AI)',
      descEn: 'Enable conversational AI recommendations & smart search across the platform.',
      descAr: 'تفعيل المحادثة الاستشارية والبحث الذكي عبر المنصة.',
    },
  ];

  return (
    <div className="space-y-6 animate-fade-in" data-testid="admin-audit-settings-page">
      {/* Header & Sub-Tabs */}
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-black text-slate-900 dark:text-white flex items-center gap-2.5">
            <Settings className="text-accent-500" size={24} />
            {isRtl ? 'سجلات التدقيق، إعدادات النظام، وعمليات نيون' : 'Audit Logs, System Settings & Neon DB Ops'}
          </h1>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
            {isRtl
              ? 'سجل تدقيق غير قابل للتعديل مع مقارنة JSON، أعلام المزايا، وإدارة قاعدة بيانات Neon Postgres'
              : 'Immutable mutation ledger with JSON diffs, platform feature flags, and safeguarded Neon Postgres database operations'}
          </p>
        </div>

        <div className="inline-flex flex-wrap rounded-2xl bg-white dark:bg-slate-900 p-1.5 border border-slate-200 dark:border-slate-800 shadow-xs gap-1">
          <button
            type="button"
            onClick={() => setSubTab('audit')}
            className={`px-3.5 py-2 rounded-xl text-xs font-bold inline-flex items-center gap-1.5 cursor-pointer ${
              subTab === 'audit'
                ? 'bg-brand-600 text-white'
                : 'text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800'
            }`}
          >
            <History size={14} />
            {isRtl ? `سجل التدقيق (${auditLogs.length})` : `Audit Logs (${auditLogs.length})`}
          </button>
          <button
            type="button"
            onClick={() => setSubTab('settings')}
            className={`px-3.5 py-2 rounded-xl text-xs font-bold inline-flex items-center gap-1.5 cursor-pointer ${
              subTab === 'settings'
                ? 'bg-brand-600 text-white'
                : 'text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800'
            }`}
          >
            <Settings size={14} />
            {isRtl ? 'الإعدادات والمزايا' : 'Settings & Flags'}
          </button>
          <button
            type="button"
            onClick={() => setSubTab('neon')}
            className={`px-3.5 py-2 rounded-xl text-xs font-bold inline-flex items-center gap-1.5 cursor-pointer ${
              subTab === 'neon'
                ? 'bg-brand-600 text-white'
                : 'text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800'
            }`}
          >
            <Database size={14} />
            {isRtl ? 'نيون والمنطقة الخطرة' : 'Neon DB & Danger Zone'}
          </button>
        </div>
      </div>

      {/* Tab 1: Immutable Audit Logs */}
      {subTab === 'audit' && (
        <div className="space-y-4">
          <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200/80 dark:border-slate-800 p-4 shadow-xs flex flex-col md:flex-row md:items-center justify-between gap-3">
            <div className="flex flex-1 flex-wrap items-center gap-2.5">
              <div className="relative flex-1 min-w-[200px]">
                <Search size={15} className="absolute start-3 top-1/2 -translate-y-1/2 text-slate-400" />
                <input
                  type="text"
                  value={auditSearch}
                  onChange={(e) => setAuditSearch(e.target.value)}
                  placeholder={isRtl ? 'ابحث في سجل التدقيق بالمنفّذ أو الإجراء...' : 'Search by actor, action, resource ID, or summary...'}
                  className="w-full ps-9 pe-3 py-2 rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-xs"
                />
              </div>
              <select
                aria-label={isRtl ? 'نوع المورد' : 'Filter by resource type'}
                value={resourceFilter}
                onChange={(e) => setResourceFilter(e.target.value as any)}
                className="px-3 py-2 rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-xs font-semibold"
              >
                {RESOURCE_FILTERS.map((rf) => (
                  <option key={rf} value={rf}>
                    {rf === 'all' ? (isRtl ? 'كل الموارد' : 'All Resources') : rf}
                  </option>
                ))}
              </select>
            </div>
            <button
              type="button"
              onClick={exportAuditJson}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-xs font-bold text-slate-700 dark:text-slate-200 cursor-pointer"
            >
              <Download size={14} />
              {isRtl ? 'تصدير JSON' : 'Export JSON'}
            </button>
          </div>

          <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200/80 dark:border-slate-800 overflow-hidden shadow-xs">
            {filteredLogs.length === 0 ? (
              <div className="py-16 text-center space-y-2">
                <History size={34} className="text-slate-300 dark:text-slate-700 mx-auto" />
                <p className="text-sm font-bold text-slate-700 dark:text-slate-200">
                  {isRtl ? 'لا توجد سجلات تدقيق مطابقة' : 'No audit logs matching your filter'}
                </p>
              </div>
            ) : (
              <div className="divide-y divide-slate-100 dark:divide-slate-800">
                {filteredLogs.map((entry) => {
                  const isExpanded = expandedId === entry.id;
                  return (
                    <div key={entry.id} className="p-4 hover:bg-slate-50/70 dark:hover:bg-slate-800/20">
                      <button
                        type="button"
                        onClick={() => setExpandedId(isExpanded ? null : entry.id)}
                        className="w-full text-start flex items-start justify-between gap-3 cursor-pointer"
                      >
                        <div className="space-y-1 min-w-0">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="text-[10px] font-mono font-bold px-2 py-0.5 rounded bg-brand-600/10 text-brand-700 dark:bg-brand-500/20 dark:text-brand-200">
                              {entry.action}
                            </span>
                            <span className="text-[10px] font-mono uppercase px-2 py-0.5 rounded bg-slate-100 dark:bg-slate-800 text-slate-500">
                              {entry.resourceType}:{entry.resourceId}
                            </span>
                            <span className="text-[11px] font-semibold text-slate-500">
                              {entry.actorEmail} ({entry.actorRole})
                            </span>
                          </div>
                          <p className="text-xs font-semibold text-slate-800 dark:text-slate-100">
                            {entry.summary}
                          </p>
                        </div>

                        <div className="flex items-center gap-2 shrink-0 text-[11px] font-mono text-slate-400">
                          <span>{new Date(entry.createdAt).toLocaleString(isRtl ? 'ar-EG' : 'en-US')}</span>
                          {isExpanded ? <ChevronUp size={15} /> : <ChevronDown size={15} />}
                        </div>
                      </button>

                      {isExpanded && (
                        <div className="mt-3 pt-3 border-t border-slate-100 dark:border-slate-800 grid grid-cols-1 md:grid-cols-2 gap-3">
                          <div className="rounded-xl bg-slate-950 text-slate-200 p-3 font-mono text-[11px] overflow-x-auto">
                            <div className="text-rose-400 font-bold mb-1.5">BEFORE STATE</div>
                            <pre>{JSON.stringify(entry.beforeState ?? null, null, 2)}</pre>
                          </div>
                          <div className="rounded-xl bg-slate-950 text-slate-200 p-3 font-mono text-[11px] overflow-x-auto">
                            <div className="text-emerald-400 font-bold mb-1.5">AFTER STATE</div>
                            <pre>{JSON.stringify(entry.afterState ?? null, null, 2)}</pre>
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Tab 2: System Settings & Feature Flags */}
      {subTab === 'settings' && (
        <form onSubmit={handleSaveSettings} className="space-y-6">
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
            {/* Feature Flags */}
            <section className="lg:col-span-6 bg-white dark:bg-slate-900 rounded-2xl border border-slate-200/80 dark:border-slate-800 p-6 shadow-xs space-y-4">
              <h2 className="text-base font-bold text-slate-900 dark:text-white">
                {isRtl ? 'مفاتيح التشغيل والمزايا (Feature Flags)' : 'Platform Feature Flags'}
              </h2>
              <div className="space-y-3">
                {toggleFlags.map((flag) => {
                  const checked = Boolean(draft[flag.key]);
                  return (
                    <label
                      key={flag.key}
                      className={`flex items-start justify-between gap-4 p-3.5 rounded-xl border cursor-pointer transition-colors ${
                        flag.warn && checked
                          ? 'bg-amber-50/70 dark:bg-amber-950/30 border-amber-300 dark:border-amber-800'
                          : 'bg-slate-50/70 dark:bg-slate-800/40 border-slate-100 dark:border-slate-800'
                      }`}
                    >
                      <div className="space-y-0.5">
                        <div className="text-xs font-bold text-slate-900 dark:text-white">
                          {isRtl ? flag.labelAr : flag.labelEn}
                        </div>
                        <p className="text-[11px] text-slate-500 dark:text-slate-400">
                          {isRtl ? flag.descAr : flag.descEn}
                        </p>
                      </div>
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={(e) => setDraft((prev) => ({ ...prev, [flag.key]: e.target.checked }))}
                        className="mt-1 w-4 h-4 accent-accent-500 cursor-pointer shrink-0"
                      />
                    </label>
                  );
                })}
              </div>
            </section>

            {/* Storage, Currency & SEO Defaults */}
            <section className="lg:col-span-6 bg-white dark:bg-slate-900 rounded-2xl border border-slate-200/80 dark:border-slate-800 p-6 shadow-xs space-y-4">
              <h2 className="text-base font-bold text-slate-900 dark:text-white">
                {isRtl ? 'التخزين السحابي، العملة، وإعدادات الـ SEO' : 'Storage, Currency & Global SEO Defaults'}
              </h2>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <label className="text-xs font-bold text-slate-700 dark:text-slate-200 block">
                    {isRtl ? 'العملة الافتراضية' : 'Default Currency'}
                  </label>
                  <select
                    value={draft.defaultCurrency}
                    onChange={(e) => setDraft((prev) => ({ ...prev, defaultCurrency: e.target.value as 'EGP' | 'USD' }))}
                    className="w-full px-3 py-2.5 rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-xs font-bold"
                  >
                    <option value="EGP">EGP (Egyptian Pound)</option>
                    <option value="USD">USD (US Dollar)</option>
                  </select>
                </div>

                <div className="space-y-1.5">
                  <label className="text-xs font-bold text-slate-700 dark:text-slate-200 block">
                    {isRtl ? 'مزوّد التخزين السحابي' : 'Object Storage Provider'}
                  </label>
                  <select
                    value={draft.storageProvider}
                    onChange={(e) =>
                      setDraft((prev) => ({
                        ...prev,
                        storageProvider: e.target.value as SystemSettings['storageProvider'],
                      }))
                    }
                    className="w-full px-3 py-2.5 rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-xs font-bold"
                  >
                    <option value="neon_storage">Neon Object Storage (S3 — assets)</option>
                    <option value="cloudflare_r2">Cloudflare R2</option>
                    <option value="gcs">Google Cloud Storage (GCS)</option>
                    <option value="aws_s3">AWS S3</option>
                    <option value="vercel_blob">Vercel Blob</option>
                  </select>
                </div>
              </div>

              <div className="space-y-1.5">
                <label className="text-xs font-bold text-slate-700 dark:text-slate-200 block">
                  {isRtl ? 'الحد الأقصى للصور لكل عقار' : 'Max Upload Images per Property'}
                </label>
                <input
                  type="number"
                  min={1}
                  max={50}
                  value={draft.maxUploadImagesPerProperty}
                  onChange={(e) =>
                    setDraft((prev) => ({
                      ...prev,
                      maxUploadImagesPerProperty: Math.max(1, Math.min(50, Number(e.target.value) || 1)),
                    }))
                  }
                  className="w-full px-3 py-2.5 rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-xs font-mono font-bold"
                />
              </div>

              <div className="space-y-1.5">
                <label className="text-xs font-bold text-slate-700 dark:text-slate-200 block">
                  {isRtl ? 'عنوان الـ SEO الافتراضي للموقع' : 'Default Site SEO Title'}
                </label>
                <input
                  type="text"
                  value={draft.seoSiteTitle}
                  onChange={(e) => setDraft((prev) => ({ ...prev, seoSiteTitle: e.target.value }))}
                  className="w-full px-3 py-2.5 rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-xs"
                />
              </div>

              <div className="space-y-1.5">
                <label className="text-xs font-bold text-slate-700 dark:text-slate-200 block">
                  {isRtl ? 'وصف الـ SEO الافتراضي' : 'Default SEO Meta Description'}
                </label>
                <textarea
                  rows={3}
                  value={draft.seoDefaultDescription}
                  onChange={(e) => setDraft((prev) => ({ ...prev, seoDefaultDescription: e.target.value }))}
                  className="w-full px-3 py-2.5 rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-xs"
                />
              </div>

              <div className="pt-2 flex flex-wrap items-center justify-between gap-3 border-t border-slate-100 dark:border-slate-800">
                <span className="text-[11px] text-slate-400">
                  {settings.updatedAt
                    ? `${isRtl ? 'آخر تحديث:' : 'Last saved:'} ${new Date(settings.updatedAt).toLocaleString(isRtl ? 'ar-EG' : 'en-US')}`
                    : ''}
                </span>
                <button
                  type="submit"
                  disabled={savingSettings}
                  className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-accent-500 hover:bg-accent-600 text-white text-xs font-bold shadow-sm cursor-pointer disabled:opacity-50"
                >
                  {savingSettings ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}
                  {isRtl ? 'حفظ كافة الإعدادات' : 'Save Platform Settings'}
                </button>
              </div>
            </section>
          </div>
        </form>
      )}

      {/* Tab 3: Neon Database Operations & Danger Zone */}
      {subTab === 'neon' && (
        <div className="space-y-6">
          {/* Live Neon Connection Status */}
          <section className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200/80 dark:border-slate-800 p-6 shadow-xs space-y-5">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-center gap-3">
                <div
                  className={`w-11 h-11 rounded-xl flex items-center justify-center ${
                    neonStatus?.connected
                      ? 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400'
                      : 'bg-sky-500/15 text-sky-600 dark:text-sky-400'
                  }`}
                >
                  <Database size={22} />
                </div>
                <div>
                  <div className="flex items-center gap-2">
                    <h2 className="text-base font-bold text-slate-900 dark:text-white">
                      {isRtl ? 'حالة اتصال Neon Serverless Postgres' : 'Neon Serverless Postgres Health'}
                    </h2>
                    <span
                      className={`px-2.5 py-0.5 rounded-full text-[10px] font-bold ${
                        neonStatus?.connected
                          ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950/60 dark:text-emerald-300'
                          : 'bg-sky-100 text-sky-700 dark:bg-sky-950/60 dark:text-sky-300'
                      }`}
                    >
                      {neonStatus?.connected
                        ? isRtl ? 'متصل مباشر' : 'CONNECTED'
                        : isRtl ? 'محول هجين نشط' : 'HYBRID ADAPTER'}
                    </span>
                  </div>
                  <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                    {neonStatus ? (isRtl ? neonStatus.detailsAr : neonStatus.details) : 'Checking database...'}
                  </p>
                </div>
              </div>

              <button
                type="button"
                onClick={checkNeon}
                disabled={checkingNeon}
                className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-brand-600 hover:bg-brand-700 text-white text-xs font-bold cursor-pointer disabled:opacity-50"
              >
                <RefreshCw size={14} className={checkingNeon ? 'animate-spin' : ''} />
                {isRtl ? 'اختبار الاتصال' : 'Test Connection'}
              </button>
            </div>

            {neonStatus && (
              <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
                {neonStatus.tables.map((t) => (
                  <div
                    key={t.name}
                    className="p-3 rounded-xl bg-slate-50 dark:bg-slate-800/60 border border-slate-100 dark:border-slate-800"
                  >
                    <div className="text-[11px] font-mono font-bold text-slate-800 dark:text-slate-200 truncate">
                      {t.name}
                    </div>
                    <div className="flex items-center justify-between mt-1.5">
                      <span className="text-sm font-black font-mono text-brand-700 dark:text-accent-400">
                        {t.rowCount ?? '—'}
                      </span>
                      <span className="text-[10px] font-bold text-emerald-600 dark:text-emerald-400">
                        {t.status}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            )}

            <div className="text-[11px] font-mono text-slate-400 flex flex-wrap gap-4 pt-2 border-t border-slate-100 dark:border-slate-800">
              <span>Schema: <strong>{neonStatus?.schemaVersion || 'v4.0-enterprise'}</strong></span>
              <span>Latency: <strong>{neonStatus?.latencyMs ?? 0}ms</strong></span>
              <span>Backend: <strong>{neonStatus?.backend || 'adapter_fallback'}</strong></span>
            </div>
          </section>

          {/* Safeguarded Danger Zone */}
          <section
            data-testid="neon-danger-zone"
            className="bg-white dark:bg-slate-900 rounded-2xl border-2 border-rose-300 dark:border-rose-900/70 p-6 shadow-xs space-y-5"
          >
            <div className="flex items-start gap-3">
              <div className="w-11 h-11 rounded-xl bg-rose-500/15 text-rose-600 flex items-center justify-center shrink-0">
                <ShieldAlert size={24} />
              </div>
              <div className="space-y-1">
                <h2 className="text-base font-black text-rose-700 dark:text-rose-400 flex items-center gap-2">
                  {isRtl ? 'المنطقة الخطرة — تصفير جميع العقارات مع الاحتفاظ بالمستخدمين' : 'Danger Zone — Reset All Properties (Keep Users)'}
                </h2>
                <p className="text-xs text-slate-600 dark:text-slate-300 leading-relaxed">
                  {isRtl
                    ? 'ستقوم هذه العملية بحذف كافة إعلانات العقارات من قاعدة البيانات بشكل نهائي لتبدأ بمخزون نظيف تماماً (0 عقار)، بينما يتم الحفاظ على 100% من حسابات المستخدمين والسوبر أدمن دون أي مساس.'
                    : 'This operation permanently deletes ALL property listings from the database so you start from a clean slate (0 properties), while preserving 100% of user and Super Admin accounts untouched.'}
                </p>
              </div>
            </div>

            {/* Pre-flight Impact Preview */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="p-4 rounded-xl bg-rose-50/70 dark:bg-rose-950/30 border border-rose-200 dark:border-rose-900/60">
                <div className="text-xs font-bold text-rose-700 dark:text-rose-300 flex items-center gap-1.5">
                  <AlertTriangle size={14} />
                  {isRtl ? 'سيتم حذفه نهائياً' : 'Will Be Permanently Deleted'}
                </div>
                <div className="text-2xl font-black font-mono text-rose-600 dark:text-rose-400 mt-1">
                  {counts.properties} {isRtl ? 'عقار' : 'Properties'}
                </div>
              </div>
              <div className="p-4 rounded-xl bg-emerald-50/70 dark:bg-emerald-950/30 border border-emerald-200 dark:border-emerald-900/60">
                <div className="text-xs font-bold text-emerald-700 dark:text-emerald-300 flex items-center gap-1.5">
                  <CheckCircle2 size={14} />
                  {isRtl ? 'سيتم الحفاظ عليه بنسبة 100%' : '100% Preserved & Protected'}
                </div>
                <div className="text-2xl font-black font-mono text-emerald-600 dark:text-emerald-400 mt-1">
                  {counts.users} {isRtl ? 'مستخدم وأدمن' : 'Users & Admins'}
                </div>
              </div>
            </div>

            {!isSuperAdmin ? (
              <div className="p-4 rounded-xl bg-slate-100 dark:bg-slate-800 text-xs font-bold text-slate-600 dark:text-slate-300 flex items-center gap-2">
                <Lock size={15} />
                {isRtl
                  ? 'هذه العملية الحساسة مقصورة على حسابات السوبر أدمن فقط.'
                  : 'This destructive database operation is restricted to Super Admin accounts only.'}
              </div>
            ) : (
              <div className="space-y-3 pt-2 border-t border-rose-100 dark:border-rose-900/50">
                <label className="text-xs font-bold text-slate-700 dark:text-slate-200 block">
                  {isRtl
                    ? 'للتأكيد، اكتب كلمة RESET بالإنجليزية في المربع أدناه:'
                    : 'To unlock this action, type RESET in all caps below:'}
                </label>
                <div className="flex flex-col sm:flex-row gap-3">
                  <input
                    type="text"
                    value={confirmText}
                    onChange={(e) => setConfirmText(e.target.value)}
                    placeholder="RESET"
                    data-testid="reset-confirmation-input"
                    className="sm:w-64 px-3.5 py-2.5 rounded-xl bg-slate-50 dark:bg-slate-800 border border-rose-300 dark:border-rose-800 text-xs font-mono font-bold tracking-wider uppercase text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-rose-500/40"
                  />
                  <button
                    type="button"
                    data-testid="execute-reset-properties-btn"
                    disabled={confirmText.trim() !== 'RESET' || resetting}
                    onClick={handleExecuteReset}
                    className="inline-flex items-center justify-center gap-2 px-5 py-2.5 rounded-xl bg-rose-600 hover:bg-rose-700 text-white text-xs font-bold shadow-sm transition-all cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
                  >
                    {resetting ? <Loader2 size={15} className="animate-spin" /> : <Trash2 size={15} />}
                    {isRtl ? 'تصفير جميع العقارات (مع بقاء المستخدمين)' : 'Reset All Properties (Keep Users)'}
                  </button>
                </div>
              </div>
            )}

            {resetError && (
              <div className="p-3.5 rounded-xl bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-900 text-xs font-semibold text-rose-700 dark:text-rose-300">
                {resetError}
              </div>
            )}

            {resetResult && (
              <div
                data-testid="reset-properties-receipt"
                className="p-4 rounded-xl bg-emerald-50/80 dark:bg-emerald-950/30 border border-emerald-300 dark:border-emerald-800 space-y-2"
              >
                <div className="flex items-center gap-2 text-xs font-black text-emerald-700 dark:text-emerald-300">
                  <CheckCircle2 size={16} />
                  {isRtl ? 'تم تنفيذ التصفير بنجاح وتوثيقه في سجل التدقيق' : 'Properties Reset Completed & Audited'}
                </div>
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 text-xs font-mono text-slate-700 dark:text-slate-200">
                  <div>
                    {isRtl ? 'عقارات محذوفة:' : 'Deleted Properties:'} <strong>{resetResult.deletedProperties}</strong>
                  </div>
                  <div>
                    {isRtl ? 'مستخدمون محفوظون:' : 'Preserved Users:'} <strong>{resetResult.preservedUsers}</strong>
                  </div>
                  <div>
                    {isRtl ? 'القاعدة:' : 'Backend:'} <strong>{resetResult.backend}</strong>
                  </div>
                </div>
              </div>
            )}
          </section>
        </div>
      )}
    </div>
  );
};
