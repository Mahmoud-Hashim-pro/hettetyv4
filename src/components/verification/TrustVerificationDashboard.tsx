import React from 'react';
import { Property, PropertyTrustMatrix } from '../../types';
import { calculateTrustScore, formatTrustTierLabel } from '../../services/verification/trust-verification-service';
import { ShieldCheck, FileText, CheckCircle2, AlertCircle, Building2, Wallet, Camera } from 'lucide-react';

interface TrustVerificationDashboardProps {
  property: Property;
  isRtl?: boolean;
  onVerifySection?: (section: 'ownership' | 'licensing' | 'financial' | 'physical') => void;
  isAdmin?: boolean;
}

export const TrustVerificationDashboard: React.FC<TrustVerificationDashboardProps> = ({
  property,
  isRtl = false,
  onVerifySection,
  isAdmin = false,
}) => {
  const trust = property.trustMatrix || {
    score: 0,
    tier: 'UNVERIFIED',
    ownership: { status: 'pending' },
    licensing: { status: 'pending' },
    financial: { status: 'pending' },
    physical: { status: 'none' },
    lastAuditedAt: new Date().toISOString(),
  };

  const calculated = calculateTrustScore(
    trust.ownership,
    trust.licensing,
    trust.financial,
    trust.physical
  );

  const tierInfo = formatTrustTierLabel(calculated.tier, isRtl);

  return (
    <div
      data-testid="trust-verification-dashboard"
      className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 p-6 shadow-sm"
      dir={isRtl ? 'rtl' : 'ltr'}
    >
      {/* Header & Overall Trust Score */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 pb-6 border-b border-slate-100 dark:border-slate-800">
        <div className="flex items-center gap-3">
          <div className="w-12 h-12 rounded-xl bg-amber-500/10 text-amber-600 dark:text-amber-400 flex items-center justify-center">
            <ShieldCheck size={28} />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h2 className="text-xl font-bold text-slate-900 dark:text-white">
                {isRtl ? 'مصفوفة الثقة والتحقق القانوني' : 'HETTETY Legal Trust Matrix'}
              </h2>
              <span className={`text-xs px-2.5 py-0.5 rounded-full font-semibold border ${tierInfo.color}`}>
                {tierInfo.label}
              </span>
            </div>
            <p className="text-sm text-slate-500 dark:text-slate-400 mt-0.5">
              {isRtl
                ? 'فحص شامل للأوراق وسند الملكية والتراخيص وفقاً للقانون المصري ١١٩ لسنة ٢٠٠٨'
                : 'Comprehensive legal, licensing, and 3D physical verification under Egyptian Law.'}
            </p>
          </div>
        </div>

        {/* Score Radial / Badge */}
        <div className="flex items-center gap-4 bg-slate-50 dark:bg-slate-800/60 px-5 py-3 rounded-xl border border-slate-200/60 dark:border-slate-700/60">
          <div className="text-center">
            <div className="text-3xl font-extrabold text-slate-900 dark:text-white">
              {calculated.score}<span className="text-sm font-medium text-slate-400">/100</span>
            </div>
            <div className="text-xs font-semibold text-slate-500 dark:text-slate-400">
              {isRtl ? 'درجة الموثوقية' : 'Trust Score'}
            </div>
          </div>
          <div className="text-xl select-none">{tierInfo.badge}</div>
        </div>
      </div>

      {/* 4 Pillars Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mt-6">
        {/* 1. Ownership Deed */}
        <div className="p-4 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-800/30">
          <div className="flex items-center justify-between mb-2">
            <div className="flex items-center gap-2">
              <FileText size={18} className="text-indigo-500" />
              <h3 className="font-semibold text-slate-800 dark:text-slate-200 text-sm">
                {isRtl ? 'سند الملكية والشهر العقاري' : 'Ownership Deed & Title'}
              </h3>
            </div>
            <span
              className={`text-xs font-medium px-2 py-0.5 rounded-full ${
                trust.ownership?.status === 'verified'
                  ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400'
                  : 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400'
              }`}
            >
              {trust.ownership?.status === 'verified'
                ? isRtl ? 'تم التحقق' : 'Verified'
                : isRtl ? 'قيد المراجعة' : 'Pending'}
            </span>
          </div>
          <p className="text-xs text-slate-600 dark:text-slate-400 mb-3">
            {trust.ownership?.registrationNumber
              ? `${isRtl ? 'رقم المشهر / التسجيل:' : 'Registry No:'} ${trust.ownership.registrationNumber}`
              : (isRtl ? 'تم فحص أصل العقد والتأكد من تسلسل الملكية' : 'Title deed sequence and origin checked')}
          </p>
          <div className="flex items-center justify-between text-xs text-slate-500 dark:text-slate-400">
            <span>{isRtl ? 'النقاط:' : 'Weight:'} {calculated.breakdown.ownership}/35</span>
            {isAdmin && onVerifySection && (
              <button
                onClick={() => onVerifySection('ownership')}
                className="text-amber-600 hover:text-amber-700 font-semibold"
              >
                {isRtl ? 'تحديث الفحص' : 'Audit'}
              </button>
            )}
          </div>
        </div>

        {/* 2. Building License & Reconciliation */}
        <div className="p-4 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-800/30">
          <div className="flex items-center justify-between mb-2">
            <div className="flex items-center gap-2">
              <Building2 size={18} className="text-blue-500" />
              <h3 className="font-semibold text-slate-800 dark:text-slate-200 text-sm">
                {isRtl ? 'تراخيص البناء والتصالح' : 'Building License & Permits'}
              </h3>
            </div>
            <span
              className={`text-xs font-medium px-2 py-0.5 rounded-full ${
                trust.licensing?.status === 'verified' || trust.licensing?.status === 'exempt'
                  ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400'
                  : 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400'
              }`}
            >
              {trust.licensing?.status === 'verified' || trust.licensing?.status === 'exempt'
                ? isRtl ? 'مطابق قانوناً' : 'Law Compliant'
                : isRtl ? 'قيد الفحص' : 'Pending'}
            </span>
          </div>
          <p className="text-xs text-slate-600 dark:text-slate-400 mb-3">
            {trust.licensing?.licenseType === 'reconciliation_form_10'
              ? (isRtl ? 'حاصل على نموذج ١٠ للتصالح النهائي' : 'Has Final Reconciliation Form 10')
              : (isRtl ? 'رخصة بناء معتمدة والارتفاعات مطابقة' : 'Approved building license, compliant floors')}
          </p>
          <div className="flex items-center justify-between text-xs text-slate-500 dark:text-slate-400">
            <span>{isRtl ? 'النقاط:' : 'Weight:'} {calculated.breakdown.licensing}/25</span>
            {isAdmin && onVerifySection && (
              <button
                onClick={() => onVerifySection('licensing')}
                className="text-amber-600 hover:text-amber-700 font-semibold"
              >
                {isRtl ? 'تحديث الفحص' : 'Audit'}
              </button>
            )}
          </div>
        </div>

        {/* 3. Financial Clearance */}
        <div className="p-4 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-800/30">
          <div className="flex items-center justify-between mb-2">
            <div className="flex items-center gap-2">
              <Wallet size={18} className="text-emerald-500" />
              <h3 className="font-semibold text-slate-800 dark:text-slate-200 text-sm">
                {isRtl ? 'المخالصات المالية والوديعة' : 'Financial Clearances'}
              </h3>
            </div>
            <span
              className={`text-xs font-medium px-2 py-0.5 rounded-full ${
                trust.financial?.status === 'verified'
                  ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400'
                  : 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400'
              }`}
            >
              {trust.financial?.status === 'verified'
                ? isRtl ? 'مسدد بالكامل' : 'Cleared'
                : isRtl ? 'بانتظار الإفادة' : 'Pending'}
            </span>
          </div>
          <p className="text-xs text-slate-600 dark:text-slate-400 mb-3">
            {isRtl
              ? 'مخالصة المطور العقاري وسداد وديعة الصيانة وفواتير المرافق'
              : 'Developer clearance, maintenance deposit paid, utility clearance verified'}
          </p>
          <div className="flex items-center justify-between text-xs text-slate-500 dark:text-slate-400">
            <span>{isRtl ? 'النقاط:' : 'Weight:'} {calculated.breakdown.financial}/20</span>
            {isAdmin && onVerifySection && (
              <button
                onClick={() => onVerifySection('financial')}
                className="text-amber-600 hover:text-amber-700 font-semibold"
              >
                {isRtl ? 'تحديث الفحص' : 'Audit'}
              </button>
            )}
          </div>
        </div>

        {/* 4. Physical 3D Reality Match */}
        <div className="p-4 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-800/30">
          <div className="flex items-center justify-between mb-2">
            <div className="flex items-center gap-2">
              <Camera size={18} className="text-purple-500" />
              <h3 className="font-semibold text-slate-800 dark:text-slate-200 text-sm">
                {isRtl ? 'المعاينة الميدانية والتصوير 3D' : '3D Reality & Physical Match'}
              </h3>
            </div>
            <span
              className={`text-xs font-medium px-2 py-0.5 rounded-full ${
                trust.physical?.status === 'verified'
                  ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400'
                  : 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-400'
              }`}
            >
              {trust.physical?.status === 'verified'
                ? isRtl ? 'مطابق فراغياً' : '3D Match'
                : isRtl ? 'غير متوفر' : 'Not Performed'}
            </span>
          </div>
          <p className="text-xs text-slate-600 dark:text-slate-400 mb-3">
            {trust.physical?.matched3DTour
              ? (isRtl ? 'تمت مطابقة النموذج الفراغي 3D مع العقار على أرض الواقع' : 'Metric 3D spatial scan verified on-site')
              : (isRtl ? 'فحص الإحداثيات الجغرافية والمعاينة البصرية' : 'GPS coordinates & visual inspection')}
          </p>
          <div className="flex items-center justify-between text-xs text-slate-500 dark:text-slate-400">
            <span>{isRtl ? 'النقاط:' : 'Weight:'} {calculated.breakdown.physical}/20</span>
            {isAdmin && onVerifySection && (
              <button
                onClick={() => onVerifySection('physical')}
                className="text-amber-600 hover:text-amber-700 font-semibold"
              >
                {isRtl ? 'تحديث الفحص' : 'Audit'}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
