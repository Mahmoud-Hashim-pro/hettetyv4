import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  LayoutDashboard,
  Building2,
  FileCheck2,
  Box,
  Landmark,
  Users,
  Briefcase,
  Sparkles,
  BarChart3,
  Settings,
  Search,
  Plus,
  RefreshCw,
  Sun,
  Moon,
  Globe,
  LogOut,
  Menu,
  X,
  PanelLeftClose,
  PanelLeftOpen,
  Shield,
  Database,
  ChevronRight,
  ChevronLeft,
  CheckCircle2,
  AlertTriangle,
  XCircle,
  Command,
  ArrowRight,
  ArrowLeft,
} from 'lucide-react';
import { BrandMonogram } from '../../components/BrandLogo';
import {
  AdminPortalAppProps,
  AdminRole,
  AdminSectionId,
  AdminSnapshotData,
  AdminToastMessage,
  AdvisorHealthStatus,
  Property,
  SystemSettings,
  TransactionRecord,
  UserAccountRecord,
  UserDocument,
} from './types';
import { adminPortalService, computeOverviewMetrics } from './services/adminPortalService';
import { AdminOverviewPage } from './pages/AdminOverviewPage';
import { AdminPropertiesPage } from './pages/AdminPropertiesPage';
import { AdminVerificationQueuePage } from './pages/AdminVerificationQueuePage';
import { AdminReconstructionOpsPage } from './pages/AdminReconstructionOpsPage';
import { AdminEscrowPage } from './pages/AdminEscrowPage';
import { AdminUsersRbacPage } from './pages/AdminUsersRbacPage';
import { AdminCrmReportsPage } from './pages/AdminCrmReportsPage';
import { AdminAiOpsPage } from './pages/AdminAiOpsPage';
import { AdminAnalyticsSeoPage } from './pages/AdminAnalyticsSeoPage';
import { AdminAuditSettingsPage } from './pages/AdminAuditSettingsPage';

export type { AdminPortalAppProps };

interface NavItemConfig {
  id: AdminSectionId;
  labelEn: string;
  labelAr: string;
  icon: React.ReactNode;
  badge?: number;
  badgeAlert?: boolean;
}

interface NavGroupConfig {
  groupEn: string;
  groupAr: string;
  items: NavItemConfig[];
}

export const AdminPortalApp: React.FC<AdminPortalAppProps> = ({
  isRtl,
  isSuperAdmin,
  userEmail,
  userName,
  darkMode = false,
  onToggleDarkMode,
  onToggleLanguage,
  onExitAdmin,
  onOpenAddListing,
  onOpenEditListing,
  onOpenProperty,
  onOpen3D,
  onPropertiesChanged,
}) => {
  const [activeSection, setActiveSection] = useState<AdminSectionId>('overview');
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const [commandOpen, setCommandOpen] = useState(false);
  const [commandQuery, setCommandQuery] = useState('');

  const [snapshot, setSnapshot] = useState<AdminSnapshotData | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [toasts, setToasts] = useState<AdminToastMessage[]>([]);
  const [aiHealthCache, setAiHealthCache] = useState<AdvisorHealthStatus | null>(null);

  // Search handoff from Ctrl+K Command Palette to target pages
  const [propertySearchSeed, setPropertySearchSeed] = useState('');
  const [userSearchSeed, setUserSearchSeed] = useState('');

  const commandInputRef = useRef<HTMLInputElement | null>(null);

  const pushToast = useCallback((type: AdminToastMessage['type'], message: string) => {
    const id = `t_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
    setToasts((prev) => [...prev.slice(-3), { id, type, message }]);
    setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id));
    }, 4500);
  }, []);

  const loadSnapshot = useCallback(
    async (isManualRefresh = false) => {
      if (isManualRefresh) setRefreshing(true);
      else setLoading(true);
      setLoadError(null);
      try {
        const data = await adminPortalService.loadDashboardSnapshot();
        setSnapshot(data);
      } catch (err: any) {
        setLoadError(
          err?.message ||
            (isRtl ? 'تعذّر تحميل بيانات لوحة التحكم.' : 'Failed to load Admin Command Center data.')
        );
      } finally {
        setLoading(false);
        setRefreshing(false);
      }
    },
    [isRtl]
  );

  useEffect(() => {
    loadSnapshot(false);
  }, [loadSnapshot]);

  // Global keyboard shortcuts: Ctrl+K / Cmd+K for Command Palette, Escape to dismiss overlays
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setCommandOpen((open) => !open);
        setCommandQuery('');
      } else if (e.key === 'Escape') {
        setCommandOpen(false);
        setMobileNavOpen(false);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  useEffect(() => {
    if (commandOpen) {
      setTimeout(() => commandInputRef.current?.focus(), 30);
    }
  }, [commandOpen]);

  // Helper to recompute metrics & refresh local audit log mirror after any optimistic state update
  const updateSnapshotState = useCallback(
    (updater: (prev: AdminSnapshotData) => AdminSnapshotData) => {
      setSnapshot((prev) => {
        if (!prev) return prev;
        const next = updater(prev);
        const neonService = prev.metrics.servicesHealth.find((s) => s.id === 'neon_postgres');
        const nextMetrics = computeOverviewMetrics({
          users: next.users,
          properties: next.properties,
          purchases: next.purchases,
          transactions: next.transactions,
          reports: next.reports,
          reviewDocs: next.reviewDocs,
          reconstructionJobs: next.reconstructionJobs,
          settings: next.settings,
          neonOnline: neonService?.status === 'healthy',
          neonLatencyMs: neonService?.latencyMs,
          aiHealth: aiHealthCache,
        });
        return { ...next, metrics: nextMetrics };
      });
    },
    [aiHealthCache]
  );

  // --- Admin Mutation Handlers ---
  const handleVerifyProperty = async (
    property: Property,
    status: 'Verified' | 'Rejected' | 'Pending',
    note?: string
  ) => {
    setBusyId(property.id);
    try {
      await adminPortalService.verifyProperty(property.id, status, note, userEmail || undefined, property);
      updateSnapshotState((prev) => ({
        ...prev,
        properties: prev.properties.map((p) =>
          p.id === property.id
            ? {
                ...p,
                verificationStatus: status,
                isVerified: status === 'Verified',
                reviewNote: note !== undefined ? note : p.reviewNote,
                verifiedAt: new Date().toISOString(),
              }
            : p
        ),
      }));
      onPropertiesChanged?.();
      pushToast(
        'success',
        isRtl ? `تم تحديث حالة توثيق «${property.title}» إلى ${status}` : `Updated "${property.title}" verification -> ${status}`
      );
      loadSnapshot(true);
    } catch {
      pushToast('error', isRtl ? 'تعذّر حفظ قرار المراجعة.' : 'Could not save verification verdict.');
    } finally {
      setBusyId(null);
    }
  };

  const handlePropertyState = async (property: Property, state: 'Live' | 'Draft' | 'Removed') => {
    setBusyId(property.id);
    try {
      await adminPortalService.setPropertyListingState(property.id, state, userEmail || undefined, property.listingState);
      updateSnapshotState((prev) => ({
        ...prev,
        properties: prev.properties.map((p) => (p.id === property.id ? { ...p, listingState: state } : p)),
      }));
      onPropertiesChanged?.();
      pushToast('success', isRtl ? `تم تغيير حالة النشر إلى ${state}` : `Listing visibility set to ${state}`);
    } catch {
      pushToast('error', isRtl ? 'فشل تغيير حالة النشر.' : 'Failed to update listing state.');
    } finally {
      setBusyId(null);
    }
  };

  const handlePropertyAvailability = async (
    property: Property,
    availability: 'Available' | 'Sold' | 'Reserved'
  ) => {
    setBusyId(property.id);
    try {
      await adminPortalService.setPropertyAvailability(property.id, availability, userEmail || undefined, property.availability);
      updateSnapshotState((prev) => ({
        ...prev,
        properties: prev.properties.map((p) => (p.id === property.id ? { ...p, availability } : p)),
      }));
      onPropertiesChanged?.();
      pushToast('success', isRtl ? `تم تحديث التوافر إلى ${availability}` : `Availability updated to ${availability}`);
    } catch {
      pushToast('error', isRtl ? 'فشل تحديث حالة التوافر.' : 'Failed to update availability.');
    } finally {
      setBusyId(null);
    }
  };

  const handleDeleteProperty = async (property: Property) => {
    setBusyId(property.id);
    try {
      await adminPortalService.deleteProperty(property.id, property.title, userEmail || undefined);
      updateSnapshotState((prev) => ({
        ...prev,
        properties: prev.properties.filter((p) => p.id !== property.id),
      }));
      onPropertiesChanged?.();
      pushToast('success', isRtl ? `تم حذف «${property.title}» نهائياً` : `Deleted "${property.title}"`);
      loadSnapshot(true);
    } catch {
      pushToast('error', isRtl ? 'فشل حذف العقار.' : 'Failed to delete property.');
    } finally {
      setBusyId(null);
    }
  };

  const handleBulkProperties = async (selected: Property[], action: 'verify' | 'hide' | 'live' | 'delete') => {
    try {
      const count = await adminPortalService.bulkPropertyAction(selected, action, userEmail || undefined);
      onPropertiesChanged?.();
      pushToast(
        'success',
        isRtl ? `تم تطبيق الإجراء على ${count} عقار بنجاح` : `Bulk action "${action}" applied to ${count} properties`
      );
      await loadSnapshot(true);
    } catch {
      pushToast('error', isRtl ? 'تعذّر تنفيذ الإجراء الجماعي بالكامل.' : 'Bulk property action encountered an error.');
    }
  };

  const handleReviewDocument = async (
    targetDoc: UserDocument,
    nextStatus: 'InReview' | 'Checked' | 'NeedsAttention',
    note: string
  ) => {
    setBusyId(targetDoc.id);
    try {
      await adminPortalService.reviewDocument(targetDoc, nextStatus, note, userEmail || undefined);
      updateSnapshotState((prev) => ({
        ...prev,
        reviewDocs: prev.reviewDocs.map((d) =>
          d.id === targetDoc.id
            ? { ...d, reviewStatus: nextStatus, reviewNote: note || d.reviewNote, reviewedAt: new Date().toISOString() }
            : d
        ),
      }));
      pushToast('success', isRtl ? `تم تحديث حالة المستند إلى ${nextStatus}` : `Document "${targetDoc.name}" -> ${nextStatus}`);
      loadSnapshot(true);
    } catch (err: any) {
      pushToast('error', err?.message || (isRtl ? 'فشل مراجعة المستند.' : 'Failed to review document.'));
    } finally {
      setBusyId(null);
    }
  };

  const handleControlJob = async (jobId: string, action: 'retry' | 'cancel') => {
    setBusyId(jobId);
    try {
      await adminPortalService.controlReconstructionJob(jobId, action, userEmail || undefined);
      updateSnapshotState((prev) => ({
        ...prev,
        reconstructionJobs: prev.reconstructionJobs.map((j) =>
          j.id === jobId ? { ...j, status: action === 'retry' ? 'QUEUED' : 'CANCELLED' } : j
        ),
      }));
      pushToast('success', isRtl ? 'تم إرسال أمر التحكم لمهمة الـ 3D' : `3D job ${jobId} ${action} command sent`);
    } catch {
      pushToast('error', isRtl ? 'فشل إرسال أمر التحكم.' : 'Failed to send 3D job command.');
    } finally {
      setBusyId(null);
    }
  };

  const handleUpdatePurchase = async (purchaseId: string, status: 'completed' | 'cancelled' | 'processing') => {
    setBusyId(purchaseId);
    try {
      await adminPortalService.updatePurchaseStatus(purchaseId, status, userEmail || undefined);
      updateSnapshotState((prev) => ({
        ...prev,
        purchases: prev.purchases.map((p) => (p.id === purchaseId ? { ...p, status } : p)),
      }));
      pushToast('success', isRtl ? `تم تحديث طلب الشراء إلى ${status}` : `Purchase updated to ${status}`);
    } catch {
      pushToast('error', isRtl ? 'تعذّر تحديث طلب الشراء.' : 'Failed to update purchase request.');
    } finally {
      setBusyId(null);
    }
  };

  const handleUpdateTransaction = async (
    tx: TransactionRecord,
    nextStatus: TransactionRecord['status'],
    nextDepositStatus?: TransactionRecord['depositStatus'],
    escrowRef?: string
  ) => {
    setBusyId(tx.id);
    try {
      const updated = await adminPortalService.updateTransactionStatus(
        tx,
        nextStatus,
        nextDepositStatus,
        escrowRef,
        userEmail || undefined
      );
      updateSnapshotState((prev) => ({
        ...prev,
        transactions: prev.transactions.map((t) => (t.id === tx.id ? updated : t)),
      }));
      pushToast('success', isRtl ? `تم تحديث صفقة الضمان إلى ${nextStatus}` : `Escrow transaction updated -> ${nextStatus}`);
    } catch {
      pushToast('error', isRtl ? 'تعذّر تحديث صفقة الضمان.' : 'Failed to update escrow transaction.');
    } finally {
      setBusyId(null);
    }
  };

  const handleUpdateUserRole = async (user: UserAccountRecord, role: AdminRole) => {
    setBusyId(user.id);
    try {
      await adminPortalService.updateUserRole(user, role, userEmail || undefined);
      updateSnapshotState((prev) => ({
        ...prev,
        users: prev.users.map((u) => (u.id === user.id ? { ...u, role } : u)),
      }));
      pushToast('success', isRtl ? `تم تعيين دور ${role} لـ ${user.email}` : `Assigned role "${role}" to ${user.email}`);
    } catch {
      pushToast('error', isRtl ? 'فشل تحديث صلاحيات المستخدم.' : 'Failed to update user role.');
    } finally {
      setBusyId(null);
    }
  };

  const handleUpdateUserKyc = async (
    user: UserAccountRecord,
    status: NonNullable<UserAccountRecord['kycStatus']>
  ) => {
    setBusyId(user.id);
    try {
      await adminPortalService.updateUserKyc(user, status, userEmail || undefined);
      updateSnapshotState((prev) => ({
        ...prev,
        users: prev.users.map((u) => (u.id === user.id ? { ...u, kycStatus: status } : u)),
      }));
      pushToast('success', isRtl ? `تم تحديث KYC إلى ${status}` : `Updated KYC status to ${status}`);
    } catch {
      pushToast('error', isRtl ? 'فشل تحديث حالة KYC.' : 'Failed to update KYC status.');
    } finally {
      setBusyId(null);
    }
  };

  const handleToggleUserSuspended = async (user: UserAccountRecord, suspended: boolean) => {
    setBusyId(user.id);
    try {
      await adminPortalService.setUserSuspended(user, suspended, userEmail || undefined);
      updateSnapshotState((prev) => ({
        ...prev,
        users: prev.users.map((u) => (u.id === user.id ? { ...u, isSuspended: suspended } : u)),
      }));
      pushToast(
        'success',
        suspended
          ? isRtl ? `تم تعليق حساب ${user.email}` : `Suspended ${user.email}`
          : isRtl ? `تم تفعيل حساب ${user.email}` : `Reactivated ${user.email}`
      );
    } catch {
      pushToast('error', isRtl ? 'فشل تغيير حالة الحساب.' : 'Failed to update suspension status.');
    } finally {
      setBusyId(null);
    }
  };

  const handleDeleteUser = async (user: UserAccountRecord) => {
    setBusyId(user.id);
    try {
      await adminPortalService.deleteUserAccount(user, userEmail || undefined);
      updateSnapshotState((prev) => ({
        ...prev,
        users: prev.users.filter((u) => u.id !== user.id),
      }));
      pushToast('success', isRtl ? `تم حذف المستخدم ${user.email}` : `Deleted user ${user.email}`);
    } catch {
      pushToast('error', isRtl ? 'فشل حذف المستخدم.' : 'Failed to delete user.');
    } finally {
      setBusyId(null);
    }
  };

  const handleResolveReport = async (reportId: string) => {
    setBusyId(reportId);
    try {
      await adminPortalService.resolveReport(reportId, userEmail || undefined);
      updateSnapshotState((prev) => ({
        ...prev,
        reports: prev.reports.map((r) => (r.id === reportId ? { ...r, status: 'resolved' } : r)),
      }));
      pushToast('success', isRtl ? 'تم إغلاق البلاغ كمحلول' : 'Report marked as resolved');
    } catch {
      pushToast('error', isRtl ? 'فشل تحديث البلاغ.' : 'Failed to resolve report.');
    } finally {
      setBusyId(null);
    }
  };

  const handleDeleteReport = async (reportId: string) => {
    setBusyId(reportId);
    try {
      await adminPortalService.deleteReport(reportId, userEmail || undefined);
      updateSnapshotState((prev) => ({
        ...prev,
        reports: prev.reports.filter((r) => r.id !== reportId),
      }));
      pushToast('success', isRtl ? 'تم حذف البلاغ' : 'Report deleted');
    } catch {
      pushToast('error', isRtl ? 'فشل حذف البلاغ.' : 'Failed to delete report.');
    } finally {
      setBusyId(null);
    }
  };

  const handleSaveSettings = async (patch: Partial<SystemSettings>) => {
    const saved = await adminPortalService.saveSystemSettings(patch, userEmail || undefined);
    updateSnapshotState((prev) => ({ ...prev, settings: saved }));
    pushToast('success', isRtl ? 'تم حفظ إعدادات المنصة بنجاح' : 'Platform settings saved & audited');
    loadSnapshot(true);
    return saved;
  };

  const handleResetPropertiesKeepUsers = async () => {
    const res = await adminPortalService.resetPropertiesKeepUsers(userEmail || undefined);
    updateSnapshotState((prev) => ({ ...prev, properties: [] }));
    onPropertiesChanged?.();
    pushToast(
      'success',
      isRtl
        ? `تم حذف ${res.deletedProperties} عقار والاحتفاظ بـ ${res.preservedUsers} مستخدم بنجاح`
        : `Reset complete: deleted ${res.deletedProperties} properties, preserved ${res.preservedUsers} users`
    );
    await loadSnapshot(true);
    return res;
  };

  // Navigation Groups across all 10 Enterprise Modules
  const navGroups: NavGroupConfig[] = useMemo(() => {
    const m = snapshot?.metrics;
    const pendingReviews = (m?.pendingVerifications || 0) + (m?.pendingDocuments || 0);
    const activeDeals = (m?.openPurchases || 0) + (m?.activeEscrowCount || 0);
    return [
      {
        groupEn: 'Command',
        groupAr: 'القيادة',
        items: [
          {
            id: 'overview',
            labelEn: 'Executive Overview',
            labelAr: 'النظرة التنفيذية',
            icon: <LayoutDashboard size={18} />,
          },
        ],
      },
      {
        groupEn: 'Inventory & Spatial',
        groupAr: 'العقارات والـ 3D',
        items: [
          {
            id: 'properties',
            labelEn: 'Properties CMS',
            labelAr: 'إدارة العقارات',
            icon: <Building2 size={18} />,
            badge: m?.totalProperties,
          },
          {
            id: 'verifications',
            labelEn: 'Verification Queue',
            labelAr: 'المراجعة والتوثيق',
            icon: <FileCheck2 size={18} />,
            badge: pendingReviews,
            badgeAlert: pendingReviews > 0,
          },
          {
            id: 'reconstruction',
            labelEn: '3D Pipeline Ops',
            labelAr: 'عمليات المسح 3D',
            icon: <Box size={18} />,
            badge: m?.activeReconstructionJobs || undefined,
          },
        ],
      },
      {
        groupEn: 'Finance & Identity',
        groupAr: 'الضمان والمستخدمون',
        items: [
          {
            id: 'escrow',
            labelEn: 'Escrow & Deals',
            labelAr: 'الضمان والصفقات',
            icon: <Landmark size={18} />,
            badge: activeDeals || undefined,
          },
          {
            id: 'users',
            labelEn: 'Users & RBAC',
            labelAr: 'المستخدمون والصلاحيات',
            icon: <Users size={18} />,
            badge: m?.totalUsers,
          },
          {
            id: 'crm',
            labelEn: 'CRM & Reports',
            labelAr: 'الـ CRM والبلاغات',
            icon: <Briefcase size={18} />,
            badge: m?.openReports || undefined,
            badgeAlert: (m?.openReports || 0) > 0,
          },
        ],
      },
      {
        groupEn: 'Intelligence & Ops',
        groupAr: 'الذكاء والحوكمة',
        items: [
          {
            id: 'ai-ops',
            labelEn: 'AI Advisor Ops',
            labelAr: 'عمليات المستشار الذكي',
            icon: <Sparkles size={18} />,
          },
          {
            id: 'analytics-seo',
            labelEn: 'Analytics & SEO',
            labelAr: 'التحليلات والـ SEO',
            icon: <BarChart3 size={18} />,
          },
          {
            id: 'audit-settings',
            labelEn: 'Audit & Neon DB',
            labelAr: 'التدقيق وإعدادات نيون',
            icon: <Settings size={18} />,
          },
        ],
      },
    ];
  }, [snapshot?.metrics]);

  const allNavItems = useMemo(() => navGroups.flatMap((g) => g.items), [navGroups]);
  const currentNav = allNavItems.find((i) => i.id === activeSection) || allNavItems[0];
  const neonHealthy = snapshot?.metrics.servicesHealth.find((s) => s.id === 'neon_postgres')?.status === 'healthy';

  // Command Palette Search Results
  const commandResults = useMemo(() => {
    const q = commandQuery.trim().toLowerCase();
    const modules = allNavItems.filter(
      (item) => !q || item.labelEn.toLowerCase().includes(q) || item.labelAr.includes(q) || item.id.includes(q)
    );
    const props = (snapshot?.properties || [])
      .filter((p) => !q || `${p.title} ${p.location} ${p.compound || ''} ${p.id}`.toLowerCase().includes(q))
      .slice(0, 5);
    const matchedUsers = (snapshot?.users || [])
      .filter((u) => !q || `${u.name} ${u.email} ${u.role}`.toLowerCase().includes(q))
      .slice(0, 4);
    return { modules, props, matchedUsers };
  }, [commandQuery, allNavItems, snapshot]);

  const navigateTo = (section: AdminSectionId) => {
    setActiveSection(section);
    setMobileNavOpen(false);
    setCommandOpen(false);
  };

  const BreadcrumbChevron = isRtl ? ChevronLeft : ChevronRight;
  const ExitArrow = isRtl ? ArrowRight : ArrowLeft;

  const renderSidebarContent = (isMobile = false) => (
    <div className="flex flex-col h-full bg-brand-900 dark:bg-brand-950 text-white select-none">
      {/* Brand Header */}
      <div className="h-16 px-4 flex items-center justify-between border-b border-white/10 shrink-0">
        <div className="flex items-center gap-2.5 min-w-0">
          <div className="w-9 h-9 rounded-xl bg-white/10 border border-white/15 flex items-center justify-center shrink-0 p-1.5">
            <BrandMonogram className="w-full h-auto" isWhite />
          </div>
          {(!sidebarCollapsed || isMobile) && (
            <div className="min-w-0">
              <div className="text-sm font-black tracking-wider leading-none truncate">HETTETY</div>
              <div className="text-[10px] font-extrabold text-accent-400 mt-0.5 tracking-wider">
                ADMIN OS v4
              </div>
            </div>
          )}
        </div>

        {isMobile ? (
          <button
            type="button"
            onClick={() => setMobileNavOpen(false)}
            aria-label={isRtl ? 'إغلاق القائمة' : 'Close sidebar'}
            className="p-1.5 rounded-lg text-brand-200 hover:bg-white/10 cursor-pointer"
          >
            <X size={18} />
          </button>
        ) : (
          <button
            type="button"
            onClick={() => setSidebarCollapsed((c) => !c)}
            aria-label={sidebarCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
            className="p-1.5 rounded-lg text-brand-200 hover:bg-white/10 cursor-pointer"
          >
            {sidebarCollapsed ? <PanelLeftOpen size={17} /> : <PanelLeftClose size={17} />}
          </button>
        )}
      </div>

      {/* Role Badge & Live Neon Status Pill */}
      {(!sidebarCollapsed || isMobile) && (
        <div className="p-4 border-b border-white/10 space-y-2.5 shrink-0">
          <div className="flex items-center gap-2.5">
            <div className="w-9 h-9 rounded-xl bg-accent-500/20 border border-accent-400/30 text-accent-300 flex items-center justify-center shrink-0">
              <Shield size={18} />
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-1.5">
                <span className="text-xs font-bold text-white truncate">
                  {userName || (isRtl ? 'مدير النظام' : 'Administrator')}
                </span>
              </div>
              <span
                className={`inline-block mt-0.5 px-2 py-0.5 rounded-md text-[10px] font-bold ${
                  isSuperAdmin
                    ? 'bg-accent-500 text-white'
                    : 'bg-brand-600 text-brand-100 border border-white/15'
                }`}
              >
                {isSuperAdmin
                  ? isRtl ? 'سوبر أدمن' : 'Super Admin'
                  : isRtl ? 'أدمن العمليات' : 'Admin'}
              </span>
            </div>
          </div>

          <button
            type="button"
            onClick={() => navigateTo('audit-settings')}
            className="w-full flex items-center justify-between gap-2 px-3 py-1.5 rounded-xl bg-white/5 hover:bg-white/10 border border-white/10 text-[11px] transition-colors cursor-pointer"
          >
            <span className="inline-flex items-center gap-1.5 font-semibold text-brand-100 truncate">
              <Database size={13} className="text-accent-400 shrink-0" />
              <span className="truncate">Neon Postgres</span>
            </span>
            <span className="inline-flex items-center gap-1 font-mono font-bold text-[10px] text-emerald-300 shrink-0">
              <span
                className={`w-2 h-2 rounded-full ${
                  neonHealthy ? 'bg-emerald-400 animate-pulse' : 'bg-sky-400'
                }`}
              />
              {neonHealthy ? (isRtl ? 'مباشر' : 'LIVE') : (isRtl ? 'مرن' : 'SYNC')}
            </span>
          </button>
        </div>
      )}

      {/* Navigation Groups */}
      <nav
        role="navigation"
        aria-label={isRtl ? 'قائمة بوابة الإدارة' : 'Admin Portal Navigation'}
        className="flex-1 overflow-y-auto py-4 px-3 space-y-5 custom-scrollbar"
      >
        {navGroups.map((group) => (
          <div key={group.groupEn} className="space-y-1">
            {(!sidebarCollapsed || isMobile) && (
              <div className="px-3 pb-1 text-[10px] font-extrabold uppercase text-brand-300/70">
                {isRtl ? group.groupAr : group.groupEn}
              </div>
            )}
            {group.items.map((item) => {
              const isActive = activeSection === item.id;
              return (
                <button
                  key={item.id}
                  type="button"
                  aria-current={isActive ? 'page' : undefined}
                  title={sidebarCollapsed && !isMobile ? (isRtl ? item.labelAr : item.labelEn) : undefined}
                  onClick={() => navigateTo(item.id)}
                  className={`w-full flex items-center justify-between gap-2.5 px-3 py-2.5 rounded-xl text-xs font-bold transition-all cursor-pointer ${
                    isActive
                      ? 'bg-accent-500 text-white shadow-md shadow-accent-500/25'
                      : 'text-brand-100/85 hover:bg-white/10 hover:text-white'
                  }`}
                >
                  <span className="flex items-center gap-2.5 min-w-0">
                    <span className="shrink-0">{item.icon}</span>
                    {(!sidebarCollapsed || isMobile) && (
                      <span className="truncate">{isRtl ? item.labelAr : item.labelEn}</span>
                    )}
                  </span>
                  {(!sidebarCollapsed || isMobile) && item.badge !== undefined && (
                    <span
                      className={`px-2 py-0.5 rounded-full text-[10px] font-mono font-bold shrink-0 ${
                        isActive
                          ? 'bg-white/25 text-white'
                          : item.badgeAlert
                          ? 'bg-amber-400 text-brand-950'
                          : 'bg-white/10 text-brand-100'
                      }`}
                    >
                      {item.badge}
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        ))}
      </nav>

      {/* Sidebar Footer — Return to Public Site */}
      {onExitAdmin && (
        <div className="p-3 border-t border-white/10 shrink-0">
          <button
            type="button"
            onClick={onExitAdmin}
            className="w-full flex items-center justify-center gap-2 px-3 py-2.5 rounded-xl bg-white/10 hover:bg-white/20 text-white text-xs font-bold transition-all cursor-pointer"
          >
            <LogOut size={15} />
            {(!sidebarCollapsed || isMobile) && (
              <span>{isRtl ? 'العودة للموقع العام' : 'Return to Public Site'}</span>
            )}
          </button>
        </div>
      )}
    </div>
  );

  return (
    <div
      dir={isRtl ? 'rtl' : 'ltr'}
      data-testid="hettety-admin-portal"
      className={`min-h-screen w-full flex bg-slate-50 dark:bg-slate-950 text-slate-900 dark:text-slate-100 ${
        isRtl ? 'font-cairo' : 'font-sans'
      }`}
    >
      {/* Desktop Collapsible Sidebar */}
      <aside
        className={`hidden lg:flex flex-col shrink-0 sticky top-0 h-screen border-e border-brand-800/50 transition-all duration-300 z-30 ${
          sidebarCollapsed ? 'w-20' : 'w-72'
        }`}
      >
        {renderSidebarContent(false)}
      </aside>

      {/* Mobile Drawer Sidebar */}
      {mobileNavOpen && (
        <div className="fixed inset-0 z-50 lg:hidden flex">
          <div
            className="fixed inset-0 bg-slate-950/60 backdrop-blur-xs"
            onClick={() => setMobileNavOpen(false)}
          />
          <aside className="relative w-72 max-w-[85vw] h-full shadow-2xl z-10">
            {renderSidebarContent(true)}
          </aside>
        </div>
      )}

      {/* Main Portal Viewport */}
      <div className="flex-1 flex flex-col min-w-0 min-h-screen">
        {/* Top Command Bar */}
        <header className="sticky top-0 z-20 h-16 bg-white/90 dark:bg-slate-900/90 backdrop-blur-md border-b border-slate-200/80 dark:border-slate-800 px-4 sm:px-6 flex items-center justify-between gap-3">
          {/* Start: Mobile Menu + Breadcrumb */}
          <div className="flex items-center gap-3 min-w-0">
            <button
              type="button"
              onClick={() => setMobileNavOpen(true)}
              aria-label={isRtl ? 'فتح القائمة الجانبية' : 'Open navigation menu'}
              className="lg:hidden p-2 rounded-xl bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-200 cursor-pointer"
            >
              <Menu size={18} />
            </button>

            <div className="flex items-center gap-1.5 text-xs min-w-0">
              <span className="hidden sm:inline font-bold text-slate-400">HETTETY Admin OS</span>
              <BreadcrumbChevron size={14} className="hidden sm:inline text-slate-300 dark:text-slate-600 shrink-0" />
              <span className="font-black text-slate-900 dark:text-white truncate">
                {isRtl ? currentNav.labelAr : currentNav.labelEn}
              </span>
            </div>
          </div>

          {/* Center: Ctrl+K Command Palette Trigger */}
          <button
            type="button"
            onClick={() => {
              setCommandOpen(true);
              setCommandQuery('');
            }}
            data-testid="admin-command-palette-trigger"
            aria-label={isRtl ? 'البحث السريع والأوامر' : 'Open Quick Search & Command Palette'}
            className="hidden md:flex items-center justify-between gap-4 w-72 lg:w-80 px-3.5 py-2 rounded-xl bg-slate-100/90 dark:bg-slate-800/80 hover:bg-slate-200/70 dark:hover:bg-slate-800 border border-slate-200/80 dark:border-slate-700 text-xs text-slate-500 dark:text-slate-400 transition-colors cursor-pointer"
          >
            <span className="inline-flex items-center gap-2 truncate">
              <Search size={14} />
              <span className="truncate">
                {isRtl ? 'انتقل لأي وحدة، عقار، أو مستخدم...' : 'Jump to module, property, or user...'}
              </span>
            </span>
            <kbd className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded-md bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 text-[10px] font-mono font-bold text-slate-600 dark:text-slate-300 shrink-0">
              <Command size={10} />K
            </kbd>
          </button>

          {/* End: Global Actions */}
          <div className="flex items-center gap-1.5 sm:gap-2 shrink-0">
            <button
              type="button"
              onClick={() => {
                setCommandOpen(true);
                setCommandQuery('');
              }}
              aria-label={isRtl ? 'بحث سريع' : 'Quick Search'}
              className="md:hidden p-2 rounded-xl bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 cursor-pointer"
            >
              <Search size={16} />
            </button>

            {onOpenAddListing && (
              <button
                type="button"
                onClick={onOpenAddListing}
                className="hidden sm:inline-flex items-center gap-1.5 px-3 py-2 rounded-xl bg-accent-500 hover:bg-accent-600 text-white text-xs font-bold shadow-xs transition-all cursor-pointer"
              >
                <Plus size={15} />
                <span className="hidden xl:inline">{isRtl ? 'إضافة عقار' : 'Add Property'}</span>
              </button>
            )}

            <button
              type="button"
              onClick={() => loadSnapshot(true)}
              disabled={refreshing}
              title={isRtl ? 'تحديث كافة البيانات' : 'Refresh All Data'}
              aria-label={isRtl ? 'تحديث كافة البيانات' : 'Refresh All'}
              className="p-2 rounded-xl bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 transition-colors cursor-pointer disabled:opacity-50"
            >
              <RefreshCw size={16} className={refreshing ? 'animate-spin text-accent-500' : ''} />
            </button>

            {onToggleLanguage && (
              <button
                type="button"
                onClick={onToggleLanguage}
                title={isRtl ? 'Switch to English' : 'التبديل للعربية'}
                className="px-2.5 py-2 rounded-xl bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-xs font-bold text-slate-700 dark:text-slate-200 inline-flex items-center gap-1 cursor-pointer"
              >
                <Globe size={14} />
                <span>{isRtl ? 'EN' : 'AR'}</span>
              </button>
            )}

            {onToggleDarkMode && (
              <button
                type="button"
                onClick={onToggleDarkMode}
                aria-label={isRtl ? 'تبديل المظهر' : 'Toggle theme'}
                className="p-2 rounded-xl bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 cursor-pointer"
              >
                {darkMode ? <Sun size={16} className="text-amber-400" /> : <Moon size={16} />}
              </button>
            )}

            {onExitAdmin && (
              <button
                type="button"
                onClick={onExitAdmin}
                data-testid="admin-return-public-btn"
                className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl bg-brand-600 hover:bg-brand-700 text-white text-xs font-bold shadow-xs transition-all cursor-pointer"
              >
                <ExitArrow size={14} />
                <span className="hidden sm:inline">{isRtl ? 'العودة للموقع' : 'Return to Public Site'}</span>
              </button>
            )}
          </div>
        </header>

        {/* Main Workspace Canvas */}
        <main
          role="main"
          aria-label={isRtl ? currentNav.labelAr : currentNav.labelEn}
          className="flex-1 p-4 sm:p-6 lg:p-8 max-w-[1600px] w-full mx-auto"
        >
          {loadError && (
            <div className="mb-6 rounded-2xl bg-rose-50 dark:bg-rose-950/30 border border-rose-200 dark:border-rose-900 p-4 flex items-center justify-between gap-3">
              <div className="flex items-center gap-2.5 text-xs font-semibold text-rose-700 dark:text-rose-300">
                <AlertTriangle size={18} className="shrink-0" />
                <span>{loadError}</span>
              </div>
              <button
                type="button"
                onClick={() => loadSnapshot(false)}
                className="px-3 py-1.5 rounded-lg bg-rose-600 text-white text-xs font-bold cursor-pointer shrink-0"
              >
                {isRtl ? 'إعادة المحاولة' : 'Retry'}
              </button>
            </div>
          )}

          {loading || !snapshot ? (
            /* Shimmer Loading Skeleton */
            <div className="space-y-6 animate-pulse" data-testid="admin-loading-skeleton">
              <div className="h-36 rounded-3xl bg-slate-200 dark:bg-slate-800/80" />
              <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
                {[1, 2, 3, 4, 5, 6, 7, 8].map((i) => (
                  <div key={i} className="h-32 rounded-2xl bg-slate-200 dark:bg-slate-800/70" />
                ))}
              </div>
              <div className="h-56 rounded-2xl bg-slate-200 dark:bg-slate-800/70" />
            </div>
          ) : (
            <>
              {activeSection === 'overview' && (
                <AdminOverviewPage
                  isRtl={isRtl}
                  isSuperAdmin={isSuperAdmin}
                  userName={userName}
                  metrics={snapshot.metrics}
                  properties={snapshot.properties}
                  auditLogs={snapshot.auditLogs}
                  onNavigate={navigateTo}
                  onOpenAddListing={onOpenAddListing}
                />
              )}

              {activeSection === 'properties' && (
                <AdminPropertiesPage
                  isRtl={isRtl}
                  properties={snapshot.properties}
                  busyId={busyId}
                  initialSearch={propertySearchSeed}
                  onVerify={handleVerifyProperty}
                  onChangeListingState={handlePropertyState}
                  onChangeAvailability={handlePropertyAvailability}
                  onDelete={handleDeleteProperty}
                  onBulkAction={handleBulkProperties}
                  onOpenAddListing={onOpenAddListing}
                  onOpenEditListing={onOpenEditListing}
                  onOpenProperty={onOpenProperty}
                  onOpen3D={onOpen3D}
                />
              )}

              {activeSection === 'verifications' && (
                <AdminVerificationQueuePage
                  isRtl={isRtl}
                  properties={snapshot.properties}
                  reviewDocs={snapshot.reviewDocs}
                  users={snapshot.users}
                  busyId={busyId}
                  onVerifyProperty={handleVerifyProperty}
                  onReviewDocument={handleReviewDocument}
                  onOpenProperty={onOpenProperty}
                />
              )}

              {activeSection === 'reconstruction' && (
                <AdminReconstructionOpsPage
                  isRtl={isRtl}
                  jobs={snapshot.reconstructionJobs}
                  properties={snapshot.properties}
                  busyId={busyId}
                  onControlJob={handleControlJob}
                  onOpen3D={onOpen3D}
                />
              )}

              {activeSection === 'escrow' && (
                <AdminEscrowPage
                  isRtl={isRtl}
                  transactions={snapshot.transactions}
                  purchases={snapshot.purchases}
                  properties={snapshot.properties}
                  users={snapshot.users}
                  busyId={busyId}
                  onUpdatePurchase={handleUpdatePurchase}
                  onUpdateTransaction={handleUpdateTransaction}
                />
              )}

              {activeSection === 'users' && (
                <AdminUsersRbacPage
                  isRtl={isRtl}
                  isSuperAdmin={isSuperAdmin}
                  currentUserEmail={userEmail}
                  users={snapshot.users}
                  busyId={busyId}
                  initialSearch={userSearchSeed}
                  onUpdateRole={handleUpdateUserRole}
                  onUpdateKyc={handleUpdateUserKyc}
                  onToggleSuspended={handleToggleUserSuspended}
                  onDeleteUser={handleDeleteUser}
                />
              )}

              {activeSection === 'crm' && (
                <AdminCrmReportsPage
                  isRtl={isRtl}
                  userName={userName}
                  userEmail={userEmail}
                  properties={snapshot.properties}
                  reports={snapshot.reports}
                  contactMessages={snapshot.contactMessages}
                  alertSubscriptions={snapshot.alertSubscriptions}
                  busyId={busyId}
                  onResolveReport={handleResolveReport}
                  onDeleteReport={handleDeleteReport}
                  onOpenProperty={onOpenProperty}
                />
              )}

              {activeSection === 'ai-ops' && (
                <AdminAiOpsPage
                  isRtl={isRtl}
                  userEmail={userEmail}
                  onHealthUpdate={(h) => {
                    setAiHealthCache(h);
                    updateSnapshotState((prev) => prev);
                  }}
                />
              )}

              {activeSection === 'analytics-seo' && (
                <AdminAnalyticsSeoPage
                  isRtl={isRtl}
                  properties={snapshot.properties}
                />
              )}

              {activeSection === 'audit-settings' && (
                <AdminAuditSettingsPage
                  isRtl={isRtl}
                  isSuperAdmin={isSuperAdmin}
                  userEmail={userEmail}
                  auditLogs={snapshot.auditLogs}
                  settings={snapshot.settings}
                  counts={{
                    users: snapshot.users.length,
                    properties: snapshot.properties.length,
                    transactions: snapshot.transactions.length,
                    jobs: snapshot.reconstructionJobs.length,
                  }}
                  onSaveSettings={handleSaveSettings}
                  onResetPropertiesKeepUsers={handleResetPropertiesKeepUsers}
                />
              )}
            </>
          )}
        </main>
      </div>

      {/* Ctrl+K Global Command Palette Modal */}
      {commandOpen && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label={isRtl ? 'لوحة الأوامر السريعة' : 'Quick Command Palette'}
          className="fixed inset-0 z-50 bg-slate-950/60 backdrop-blur-xs flex items-start justify-center pt-[12vh] p-4"
          onClick={() => setCommandOpen(false)}
        >
          <div
            className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 max-w-xl w-full shadow-2xl overflow-hidden"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center gap-3 px-4 py-3.5 border-b border-slate-100 dark:border-slate-800">
              <Search size={18} className="text-accent-500 shrink-0" />
              <input
                ref={commandInputRef}
                type="text"
                value={commandQuery}
                onChange={(e) => setCommandQuery(e.target.value)}
                placeholder={
                  isRtl
                    ? 'اكتب اسم وحدة، عقار، أو بريد مستخدم للانتقال فوراً...'
                    : 'Type a module, property title, or user email to jump...'
                }
                className="flex-1 bg-transparent text-sm font-medium text-slate-900 dark:text-white placeholder:text-slate-400 focus:outline-none"
              />
              <button
                type="button"
                onClick={() => setCommandOpen(false)}
                className="p-1 rounded-lg text-slate-400 hover:text-slate-700 dark:hover:text-white cursor-pointer"
              >
                <X size={16} />
              </button>
            </div>

            <div className="max-h-[60vh] overflow-y-auto p-3 space-y-4 custom-scrollbar">
              {/* Modules */}
              {commandResults.modules.length > 0 && (
                <div className="space-y-1">
                  <div className="px-2.5 text-[10px] font-bold uppercase text-slate-400">
                    {isRtl ? 'وحدات بوابة الإدارة' : 'Admin Modules'}
                  </div>
                  {commandResults.modules.map((mod) => (
                    <button
                      key={mod.id}
                      type="button"
                      onClick={() => navigateTo(mod.id)}
                      className="w-full flex items-center justify-between gap-2 px-3 py-2 rounded-xl hover:bg-brand-50 dark:hover:bg-slate-800 text-xs font-bold text-slate-800 dark:text-slate-100 cursor-pointer"
                    >
                      <span className="flex items-center gap-2.5">
                        <span className="text-accent-500">{mod.icon}</span>
                        <span>{isRtl ? mod.labelAr : mod.labelEn}</span>
                      </span>
                      {mod.badge !== undefined && (
                        <span className="text-[10px] font-mono px-2 py-0.5 rounded-full bg-slate-100 dark:bg-slate-800 text-slate-500">
                          {mod.badge}
                        </span>
                      )}
                    </button>
                  ))}
                </div>
              )}

              {/* Properties */}
              {commandResults.props.length > 0 && (
                <div className="space-y-1">
                  <div className="px-2.5 text-[10px] font-bold uppercase text-slate-400">
                    {isRtl ? 'العقارات' : 'Properties'}
                  </div>
                  {commandResults.props.map((p) => (
                    <button
                      key={p.id}
                      type="button"
                      onClick={() => {
                        setPropertySearchSeed(p.title);
                        navigateTo('properties');
                      }}
                      className="w-full flex items-center justify-between gap-2 px-3 py-2 rounded-xl hover:bg-brand-50 dark:hover:bg-slate-800 text-xs text-start cursor-pointer"
                    >
                      <span className="font-bold text-slate-800 dark:text-slate-100 truncate">{p.title}</span>
                      <span className="text-[11px] font-mono text-accent-600 dark:text-accent-400 shrink-0">
                        {Number(p.price || 0).toLocaleString()} {p.currency || 'EGP'}
                      </span>
                    </button>
                  ))}
                </div>
              )}

              {/* Users */}
              {commandResults.matchedUsers.length > 0 && (
                <div className="space-y-1">
                  <div className="px-2.5 text-[10px] font-bold uppercase text-slate-400">
                    {isRtl ? 'المستخدمون' : 'Users'}
                  </div>
                  {commandResults.matchedUsers.map((u) => (
                    <button
                      key={u.id}
                      type="button"
                      onClick={() => {
                        setUserSearchSeed(u.email || u.name);
                        navigateTo('users');
                      }}
                      className="w-full flex items-center justify-between gap-2 px-3 py-2 rounded-xl hover:bg-brand-50 dark:hover:bg-slate-800 text-xs text-start cursor-pointer"
                    >
                      <span className="font-bold text-slate-800 dark:text-slate-100 truncate">
                        {u.name} <span className="font-normal text-slate-400">({u.email})</span>
                      </span>
                      <span className="text-[10px] font-mono uppercase px-2 py-0.5 rounded bg-slate-100 dark:bg-slate-800 text-slate-500">
                        {u.role}
                      </span>
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Toast Stack */}
      {toasts.length > 0 && (
        <div
          aria-live="polite"
          className="fixed bottom-4 end-4 z-50 flex flex-col gap-2 max-w-sm w-[calc(100vw-2rem)]"
        >
          {toasts.map((t) => (
            <div
              key={t.id}
              className={`rounded-xl px-4 py-3 shadow-lg border text-xs font-bold flex items-center gap-2.5 backdrop-blur-md ${
                t.type === 'success'
                  ? 'bg-emerald-950/95 text-emerald-100 border-emerald-700'
                  : t.type === 'error'
                  ? 'bg-rose-950/95 text-rose-100 border-rose-700'
                  : 'bg-brand-900/95 text-white border-brand-700'
              }`}
            >
              {t.type === 'success' ? (
                <CheckCircle2 size={16} className="text-emerald-400 shrink-0" />
              ) : t.type === 'error' ? (
                <XCircle size={16} className="text-rose-400 shrink-0" />
              ) : (
                <AlertTriangle size={16} className="text-amber-400 shrink-0" />
              )}
              <span className="leading-snug">{t.message}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

export default AdminPortalApp;
