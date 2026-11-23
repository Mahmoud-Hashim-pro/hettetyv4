import React, { useEffect, useMemo, useState } from 'react';
import {
  Users,
  Search,
  Shield,
  ShieldCheck,
  ShieldAlert,
  Ban,
  CheckCircle2,
  Trash2,
  Lock,
  Layers,
  Check,
  Minus,
  Eye,
  Loader2,
} from 'lucide-react';
import {
  ADMIN_ROLES_META,
  AdminRole,
  PermissionLevel,
  RBAC_PERMISSIONS_MATRIX,
  UserAccountRecord,
} from '../types';
import { SUPER_ADMIN_EMAILS } from '../../../constants';

export interface AdminUsersRbacPageProps {
  isRtl: boolean;
  isSuperAdmin: boolean;
  currentUserEmail?: string | null;
  users: UserAccountRecord[];
  busyId: string | null;
  initialSearch?: string;
  onUpdateRole: (user: UserAccountRecord, role: AdminRole) => Promise<void>;
  onUpdateKyc: (user: UserAccountRecord, status: NonNullable<UserAccountRecord['kycStatus']>) => Promise<void>;
  onToggleSuspended: (user: UserAccountRecord, suspended: boolean) => Promise<void>;
  onDeleteUser: (user: UserAccountRecord) => Promise<void>;
}

const ASSIGNABLE_ROLES: AdminRole[] = [
  'super_admin',
  'admin',
  'operations',
  'broker',
  'technician',
  'seller',
  'buyer',
  'user',
];

const MATRIX_ROLES: Array<Exclude<AdminRole, 'user'>> = [
  'super_admin',
  'admin',
  'operations',
  'broker',
  'technician',
  'seller',
  'buyer',
];

export const AdminUsersRbacPage: React.FC<AdminUsersRbacPageProps> = ({
  isRtl,
  isSuperAdmin,
  currentUserEmail,
  users,
  busyId,
  initialSearch = '',
  onUpdateRole,
  onUpdateKyc,
  onToggleSuspended,
  onDeleteUser,
}) => {
  const [search, setSearch] = useState(initialSearch);
  useEffect(() => {
    if (initialSearch) setSearch(initialSearch);
  }, [initialSearch]);
  const [roleFilter, setRoleFilter] = useState<'all' | AdminRole>('all');
  const [statusFilter, setStatusFilter] = useState<'all' | 'active' | 'suspended' | 'kyc_verified'>('all');
  const [highlightedRole, setHighlightedRole] = useState<Exclude<AdminRole, 'user'> | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<UserAccountRecord | null>(null);

  const superEmailSet = useMemo(
    () => new Set(SUPER_ADMIN_EMAILS.map((e) => e.toLowerCase())),
    []
  );

  const filteredUsers = useMemo(() => {
    const q = search.trim().toLowerCase();
    return users.filter((u) => {
      if (roleFilter !== 'all' && u.role !== roleFilter) return false;
      if (statusFilter === 'active' && u.isSuspended) return false;
      if (statusFilter === 'suspended' && !u.isSuspended) return false;
      if (statusFilter === 'kyc_verified' && u.kycStatus !== 'verified') return false;
      if (q) {
        const hay = `${u.name} ${u.email} ${u.phone || ''} ${u.id} ${u.role}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [users, search, roleFilter, statusFilter]);

  const roleStats = useMemo(() => {
    const admins = users.filter((u) => u.role === 'super_admin' || u.role === 'admin').length;
    const verifiedKyc = users.filter((u) => u.kycStatus === 'verified').length;
    const suspended = users.filter((u) => u.isSuspended).length;
    const mergedCount = users.reduce((sum, u) => sum + Math.max(0, (u.accounts || 1) - 1), 0);
    return { admins, verifiedKyc, suspended, mergedCount };
  }, [users]);

  const renderPermissionBadge = (level: PermissionLevel) => {
    if (level === 'full') {
      return (
        <span
          title={isRtl ? 'صلاحية كاملة' : 'Full Access'}
          className="inline-flex items-center justify-center w-6 h-6 rounded-lg bg-emerald-100 text-emerald-700 dark:bg-emerald-950/60 dark:text-emerald-300"
        >
          <Check size={14} strokeWidth={3} />
        </span>
      );
    }
    if (level === 'limited') {
      return (
        <span
          title={isRtl ? 'صلاحية محدودة' : 'Scoped / Limited'}
          className="inline-flex items-center justify-center px-2 h-6 rounded-lg bg-amber-100 text-amber-700 dark:bg-amber-950/60 dark:text-amber-300 text-[10px] font-bold"
        >
          {isRtl ? 'جزئي' : 'Scoped'}
        </span>
      );
    }
    if (level === 'view') {
      return (
        <span
          title={isRtl ? 'عرض فقط' : 'Read Only'}
          className="inline-flex items-center justify-center w-6 h-6 rounded-lg bg-sky-100 text-sky-700 dark:bg-sky-950/60 dark:text-sky-300"
        >
          <Eye size={13} />
        </span>
      );
    }
    return (
      <span
        title={isRtl ? 'غير مصرح' : 'No Access'}
        className="inline-flex items-center justify-center w-6 h-6 rounded-lg bg-slate-100 text-slate-400 dark:bg-slate-800 dark:text-slate-600"
      >
        <Minus size={13} />
      </span>
    );
  };

  const confirmDelete = async () => {
    if (!deleteTarget) return;
    await onDeleteUser(deleteTarget);
    setDeleteTarget(null);
  };

  return (
    <div className="space-y-6 animate-fade-in" data-testid="admin-users-rbac-page">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-black text-slate-900 dark:text-white flex items-center gap-2.5">
            <Users className="text-accent-500" size={24} />
            {isRtl ? 'إدارة الهويات والصلاحيات (IAM & RBAC)' : 'Enterprise IAM, KYC & RBAC Console'}
          </h1>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
            {isRtl
              ? 'دمج تلقائي للحسابات المكررة بنفس البريد، إدارة أدوار RBAC متعددة المستويات، توثيق KYC، وتعليق الحسابات'
              : 'Intelligent duplicate-email deduplication, multi-tier RBAC roles, KYC verification & account suspension controls'}
          </p>
        </div>

        <div className="inline-flex items-center gap-2 px-3.5 py-2 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 text-xs font-bold">
          {isSuperAdmin ? (
            <>
              <Shield className="text-accent-500" size={16} />
              <span className="text-slate-800 dark:text-slate-100">
                {isRtl ? 'وضع السوبر أدمن — تعديل الأدوار مفعّل' : 'Super Admin Mode — RBAC Editing Unlocked'}
              </span>
            </>
          ) : (
            <>
              <Lock className="text-slate-400" size={15} />
              <span className="text-slate-500">
                {isRtl ? 'تغيير الأدوار حصري للسوبر أدمن' : 'Role assignment restricted to Super Admins'}
              </span>
            </>
          )}
        </div>
      </div>

      {/* IAM Summary Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200/80 dark:border-slate-800 p-4 shadow-xs">
          <div className="text-xs font-semibold text-slate-500 dark:text-slate-400">
            {isRtl ? 'الحسابات الموحّدة' : 'Unique Accounts'}
          </div>
          <div className="text-2xl font-black font-mono text-slate-900 dark:text-white mt-1">{users.length}</div>
          {roleStats.mergedCount > 0 && (
            <div className="text-[11px] text-sky-600 dark:text-sky-400 font-semibold mt-0.5">
              {isRtl ? `تم دمج ${roleStats.mergedCount} سجل مكرر` : `${roleStats.mergedCount} duplicate(s) collapsed`}
            </div>
          )}
        </div>
        <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200/80 dark:border-slate-800 p-4 shadow-xs">
          <div className="text-xs font-semibold text-slate-500 dark:text-slate-400">
            {isRtl ? 'مديرون وصلاحيات عليا' : 'Admins & Super Admins'}
          </div>
          <div className="text-2xl font-black font-mono text-accent-600 dark:text-accent-400 mt-1">
            {roleStats.admins}
          </div>
        </div>
        <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200/80 dark:border-slate-800 p-4 shadow-xs">
          <div className="text-xs font-semibold text-slate-500 dark:text-slate-400">
            {isRtl ? 'هوية KYC موثّقة' : 'KYC Verified'}
          </div>
          <div className="text-2xl font-black font-mono text-emerald-600 dark:text-emerald-400 mt-1">
            {roleStats.verifiedKyc}
          </div>
        </div>
        <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200/80 dark:border-slate-800 p-4 shadow-xs">
          <div className="text-xs font-semibold text-slate-500 dark:text-slate-400">
            {isRtl ? 'حسابات معلّقة' : 'Suspended Accounts'}
          </div>
          <div className="text-2xl font-black font-mono text-rose-600 dark:text-rose-400 mt-1">
            {roleStats.suspended}
          </div>
        </div>
      </div>

      {/* Filters */}
      <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200/80 dark:border-slate-800 p-4 shadow-xs grid grid-cols-1 md:grid-cols-12 gap-3">
        <div className="md:col-span-5 relative">
          <Search size={15} className="absolute start-3.5 top-1/2 -translate-y-1/2 text-slate-400" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={isRtl ? 'ابحث بالاسم، البريد الإلكتروني، أو الهاتف...' : 'Search by name, email, phone, or UID...'}
            className="w-full ps-10 pe-3 py-2.5 rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-xs"
          />
        </div>
        <select
          aria-label={isRtl ? 'تصفية بالدور' : 'Filter by role'}
          value={roleFilter}
          onChange={(e) => setRoleFilter(e.target.value as any)}
          className="md:col-span-4 px-3 py-2.5 rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-xs font-semibold"
        >
          <option value="all">{isRtl ? 'كل الأدوار (RBAC)' : 'All RBAC Roles'}</option>
          {ASSIGNABLE_ROLES.map((role) => (
            <option key={role} value={role}>
              {isRtl ? ADMIN_ROLES_META[role].labelAr : ADMIN_ROLES_META[role].labelEn}
            </option>
          ))}
        </select>
        <select
          aria-label={isRtl ? 'تصفية بالحالة' : 'Filter by status'}
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value as any)}
          className="md:col-span-3 px-3 py-2.5 rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-xs font-semibold"
        >
          <option value="all">{isRtl ? 'كل الحالات' : 'All Statuses'}</option>
          <option value="active">{isRtl ? 'نشط' : 'Active'}</option>
          <option value="suspended">{isRtl ? 'معلّق' : 'Suspended'}</option>
          <option value="kyc_verified">{isRtl ? 'KYC موثّق' : 'KYC Verified'}</option>
        </select>
      </div>

      {/* Users Table */}
      <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200/80 dark:border-slate-800 overflow-hidden shadow-xs">
        {filteredUsers.length === 0 ? (
          <div className="py-16 text-center space-y-2">
            <Users size={34} className="text-slate-300 dark:text-slate-700 mx-auto" />
            <p className="text-sm font-bold text-slate-700 dark:text-slate-200">
              {isRtl ? 'لا توجد حسابات مطابقة للبحث' : 'No matching user accounts found'}
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-xs text-start">
              <thead className="bg-slate-50 dark:bg-slate-800/60 text-slate-500 dark:text-slate-400 font-bold border-b border-slate-100 dark:border-slate-800">
                <tr>
                  <th className="py-3.5 px-4">{isRtl ? 'المستخدم' : 'User Identity'}</th>
                  <th className="py-3.5 px-3">{isRtl ? 'الدور (RBAC)' : 'RBAC Role'}</th>
                  <th className="py-3.5 px-3">{isRtl ? 'توثيق KYC' : 'KYC Status'}</th>
                  <th className="py-3.5 px-3">{isRtl ? 'حالة الحساب' : 'Account Status'}</th>
                  <th className="py-3.5 px-4 text-end">{isRtl ? 'إجراءات' : 'Actions'}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                {filteredUsers.map((user) => {
                  const isBusy = busyId === user.id;
                  const isProtectedSuper = superEmailSet.has((user.email || '').toLowerCase());
                  const isSelf = Boolean(
                    currentUserEmail && user.email && currentUserEmail.toLowerCase() === user.email.toLowerCase()
                  );
                  const canEditRole = isSuperAdmin && !isProtectedSuper && !isSelf;
                  const roleMeta = ADMIN_ROLES_META[user.role] || ADMIN_ROLES_META.user;

                  return (
                    <tr key={user.id} className="hover:bg-slate-50/70 dark:hover:bg-slate-800/30 transition-colors">
                      <td className="py-3.5 px-4">
                        <div className="flex items-center gap-3 min-w-[210px]">
                          <div className="w-10 h-10 rounded-xl bg-brand-600/10 dark:bg-brand-500/20 text-brand-700 dark:text-brand-200 font-black flex items-center justify-center shrink-0">
                            {(user.name || user.email || '?').charAt(0).toUpperCase()}
                          </div>
                          <div className="min-w-0">
                            <div className="flex items-center gap-1.5 flex-wrap">
                              <span className="font-bold text-slate-900 dark:text-white truncate max-w-[180px]">
                                {user.name}
                              </span>
                              {isProtectedSuper && (
                                <span
                                  title={isRtl ? 'حساب سوبر أدمن محمي' : 'Protected Super Admin'}
                                  className="inline-flex items-center gap-0.5 text-[10px] font-bold px-1.5 py-0.5 rounded bg-accent-500/15 text-accent-600 dark:text-accent-400"
                                >
                                  <Lock size={10} />
                                  {isRtl ? 'محمي' : 'Root'}
                                </span>
                              )}
                              {(user.accounts || 1) > 1 && (
                                <span
                                  title={isRtl ? 'حسابات مدمجة بنفس البريد' : 'Collapsed duplicate auth accounts'}
                                  className="text-[10px] font-mono font-bold px-1.5 py-0.5 rounded bg-sky-100 text-sky-700 dark:bg-sky-950/60 dark:text-sky-300"
                                >
                                  x{user.accounts}
                                </span>
                              )}
                            </div>
                            <div className="text-[11px] text-slate-500 dark:text-slate-400 truncate max-w-[220px]">
                              {user.email || user.id}
                            </div>
                          </div>
                        </div>
                      </td>

                      <td className="py-3.5 px-3">
                        {canEditRole ? (
                          <select
                            aria-label={`RBAC role for ${user.email}`}
                            disabled={isBusy}
                            value={user.role}
                            onChange={(e) => onUpdateRole(user, e.target.value as AdminRole)}
                            className={`px-2.5 py-1.5 rounded-lg text-[11px] font-bold border cursor-pointer disabled:opacity-50 ${roleMeta.badgeClass}`}
                          >
                            {ASSIGNABLE_ROLES.map((r) => (
                              <option key={r} value={r} className="bg-white dark:bg-slate-900 text-slate-900 dark:text-white">
                                {isRtl ? ADMIN_ROLES_META[r].labelAr : ADMIN_ROLES_META[r].labelEn}
                              </option>
                            ))}
                          </select>
                        ) : (
                          <span className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-[11px] font-bold border ${roleMeta.badgeClass}`}>
                            {isRtl ? roleMeta.labelAr : roleMeta.labelEn}
                          </span>
                        )}
                      </td>

                      <td className="py-3.5 px-3">
                        <select
                          aria-label={`KYC status for ${user.email}`}
                          disabled={isBusy}
                          value={user.kycStatus || 'unverified'}
                          onChange={(e) => onUpdateKyc(user, e.target.value as any)}
                          className={`px-2.5 py-1.5 rounded-lg text-[11px] font-bold border cursor-pointer disabled:opacity-50 ${
                            user.kycStatus === 'verified'
                              ? 'bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-950/40 dark:text-emerald-300 dark:border-emerald-900'
                              : user.kycStatus === 'pending'
                              ? 'bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-950/40 dark:text-amber-300 dark:border-amber-900'
                              : user.kycStatus === 'rejected'
                              ? 'bg-rose-50 text-rose-700 border-rose-200 dark:bg-rose-950/40 dark:text-rose-300 dark:border-rose-900'
                              : 'bg-slate-50 text-slate-600 border-slate-200 dark:bg-slate-800 dark:text-slate-300 dark:border-slate-700'
                          }`}
                        >
                          <option value="unverified">{isRtl ? 'غير موثّق' : 'Unverified'}</option>
                          <option value="pending">{isRtl ? 'قيد الفحص' : 'Pending'}</option>
                          <option value="verified">{isRtl ? 'موثّق KYC' : 'Verified'}</option>
                          <option value="rejected">{isRtl ? 'مرفوض' : 'Rejected'}</option>
                        </select>
                      </td>

                      <td className="py-3.5 px-3">
                        <button
                          type="button"
                          disabled={isBusy || isProtectedSuper || isSelf}
                          onClick={() => onToggleSuspended(user, !user.isSuspended)}
                          className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-[11px] font-bold border transition-all cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed ${
                            user.isSuspended
                              ? 'bg-rose-100 text-rose-700 border-rose-200 dark:bg-rose-950/50 dark:text-rose-300 dark:border-rose-900'
                              : 'bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-950/40 dark:text-emerald-300 dark:border-emerald-900'
                          }`}
                        >
                          {user.isSuspended ? <Ban size={12} /> : <CheckCircle2 size={12} />}
                          {user.isSuspended ? (isRtl ? 'معلّق' : 'Suspended') : (isRtl ? 'نشط' : 'Active')}
                        </button>
                      </td>

                      <td className="py-3.5 px-4 text-end">
                        <div className="inline-flex items-center gap-1.5">
                          {isBusy && <Loader2 size={14} className="animate-spin text-accent-500" />}
                          {!isProtectedSuper && !isSelf && (
                            <button
                              type="button"
                              disabled={isBusy}
                              onClick={() => setDeleteTarget(user)}
                              title={isRtl ? 'حذف الحساب' : 'Delete account'}
                              className="p-1.5 rounded-lg text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-950/40 cursor-pointer disabled:opacity-50"
                            >
                              <Trash2 size={15} />
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Interactive RBAC Permissions Matrix */}
      <section className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200/80 dark:border-slate-800 overflow-hidden shadow-xs">
        <div className="px-6 py-4 border-b border-slate-100 dark:border-slate-800 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="flex items-center gap-2.5">
            <div className="w-9 h-9 rounded-xl bg-brand-600/10 dark:bg-brand-500/20 text-brand-700 dark:text-brand-200 flex items-center justify-center">
              <Layers size={18} />
            </div>
            <div>
              <h2 className="text-base font-bold text-slate-900 dark:text-white">
                {isRtl ? 'مصفوفة صلاحيات الأدوار التفاعلية (RBAC Matrix)' : 'Interactive RBAC Permissions Matrix'}
              </h2>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                {isRtl
                  ? 'اضغط على أي دور لتمييز صلاحياته الدقيقة عبر جميع وحدات المنصة'
                  : 'Click any role column header to inspect its exact capability boundary across HETTETY'}
              </p>
            </div>
          </div>

          {highlightedRole && (
            <div className="text-xs font-semibold px-3 py-1.5 rounded-xl bg-accent-50 dark:bg-accent-950/30 text-accent-700 dark:text-accent-300 border border-accent-200 dark:border-accent-900">
              {isRtl ? ADMIN_ROLES_META[highlightedRole].descriptionAr : ADMIN_ROLES_META[highlightedRole].descriptionEn}
            </div>
          )}
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-xs text-start">
            <thead className="bg-slate-50 dark:bg-slate-800/60 border-b border-slate-100 dark:border-slate-800">
              <tr>
                <th className="py-3 px-5 font-bold text-slate-600 dark:text-slate-300 min-w-[220px]">
                  {isRtl ? 'القدرة / الوحدة التشغيلية' : 'Platform Capability'}
                </th>
                {MATRIX_ROLES.map((role) => (
                  <th key={role} className="py-3 px-3 text-center">
                    <button
                      type="button"
                      onClick={() => setHighlightedRole((prev) => (prev === role ? null : role))}
                      className={`px-2.5 py-1 rounded-lg text-[11px] font-bold border transition-all cursor-pointer ${
                        highlightedRole === role
                          ? 'bg-accent-500 text-white border-accent-500 shadow-xs'
                          : ADMIN_ROLES_META[role].badgeClass
                      }`}
                    >
                      {isRtl ? ADMIN_ROLES_META[role].labelAr : ADMIN_ROLES_META[role].labelEn}
                    </button>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
              {RBAC_PERMISSIONS_MATRIX.map((row) => (
                <tr key={row.capabilityEn} className="hover:bg-slate-50/70 dark:hover:bg-slate-800/30">
                  <td className="py-3 px-5 font-semibold text-slate-800 dark:text-slate-200">
                    {isRtl ? row.capabilityAr : row.capabilityEn}
                  </td>
                  {MATRIX_ROLES.map((role) => (
                    <td
                      key={role}
                      className={`py-3 px-3 text-center transition-colors ${
                        highlightedRole === role ? 'bg-accent-50/50 dark:bg-accent-950/20' : ''
                      }`}
                    >
                      {renderPermissionBadge(row.roles[role])}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {/* Delete Confirmation Modal */}
      {deleteTarget && (
        <div
          role="dialog"
          aria-modal="true"
          className="fixed inset-0 z-50 bg-slate-950/60 backdrop-blur-xs flex items-center justify-center p-4"
        >
          <div className="bg-white dark:bg-slate-900 rounded-2xl border border-rose-200 dark:border-rose-900 max-w-md w-full p-6 shadow-2xl space-y-4">
            <div className="flex items-center gap-3">
              <div className="w-11 h-11 rounded-xl bg-rose-500/15 text-rose-600 flex items-center justify-center shrink-0">
                <ShieldAlert size={22} />
              </div>
              <div>
                <h3 className="text-base font-black text-slate-900 dark:text-white">
                  {isRtl ? 'تأكيد حذف حساب المستخدم' : 'Confirm User Profile Deletion'}
                </h3>
                <p className="text-xs text-slate-500">{deleteTarget.email || deleteTarget.id}</p>
              </div>
            </div>
            <p className="text-xs text-slate-600 dark:text-slate-300 leading-relaxed bg-slate-50 dark:bg-slate-800/60 p-3 rounded-xl">
              {isRtl
                ? `سيتم مسح ملف المستخدم وعدد (${deleteTarget.accountIds?.length || 1}) سجل مرتبط به وإلغاء صلاحياته فوراً.`
                : `This will permanently delete this user profile (${deleteTarget.accountIds?.length || 1} linked record(s)) and revoke all platform roles immediately.`}
            </p>
            <div className="flex items-center justify-end gap-2">
              <button
                type="button"
                onClick={() => setDeleteTarget(null)}
                className="px-4 py-2 rounded-xl text-xs font-bold text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 cursor-pointer"
              >
                {isRtl ? 'إلغاء' : 'Cancel'}
              </button>
              <button
                type="button"
                onClick={confirmDelete}
                className="px-4 py-2 rounded-xl bg-rose-600 hover:bg-rose-700 text-white text-xs font-bold cursor-pointer"
              >
                {isRtl ? 'تأكيد الحذف' : 'Delete User'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
