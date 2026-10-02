import React, { useState } from 'react';
import {
  ShieldCheck,
  Clock,
  AlertTriangle,
  FileCheck,
  CheckCircle2,
  Lock,
  Eye,
  MessageSquare,
  BookmarkCheck,
  Tag,
  ChevronDown,
  Info,
} from 'lucide-react';
import { PropertyLifecycleStatus, GranularVerificationDetails } from '../../types';

interface PropertyLifecycleBadgeProps {
  status?: PropertyLifecycleStatus;
  verification?: GranularVerificationDetails;
  isVerified?: boolean;
  isRtl?: boolean;
  interactive?: boolean;
}

export const PropertyLifecycleBadge: React.FC<PropertyLifecycleBadgeProps> = ({
  status = 'draft',
  verification,
  isVerified,
  isRtl = false,
  interactive = true,
}) => {
  const [showDetails, setShowDetails] = useState(false);

  const STATUS_CONFIG: Record<
    PropertyLifecycleStatus,
    { labelEn: string; labelAr: string; color: string; bg: string; border: string; icon: React.ReactNode }
  > = {
    draft: {
      labelEn: 'Draft',
      labelAr: 'مسودة',
      color: 'text-slate-600 dark:text-slate-300',
      bg: 'bg-slate-100 dark:bg-slate-800',
      border: 'border-slate-300 dark:border-slate-700',
      icon: <Lock size={12} />,
    },
    submitted: {
      labelEn: 'Submitted for Review',
      labelAr: 'تم التقديم للمراجعة',
      color: 'text-amber-700 dark:text-amber-300',
      bg: 'bg-amber-50 dark:bg-amber-950/40',
      border: 'border-amber-200 dark:border-amber-800',
      icon: <Clock size={12} />,
    },
    under_review: {
      labelEn: 'Under Review',
      labelAr: 'قيد التدقيق القانوني',
      color: 'text-blue-700 dark:text-blue-300',
      bg: 'bg-blue-50 dark:bg-blue-950/40',
      border: 'border-blue-200 dark:border-blue-800',
      icon: <FileCheck size={12} />,
    },
    changes_requested: {
      labelEn: 'Changes Requested',
      labelAr: 'مطلوب تعديلات',
      color: 'text-rose-700 dark:text-rose-300',
      bg: 'bg-rose-50 dark:bg-rose-950/40',
      border: 'border-rose-200 dark:border-rose-800',
      icon: <AlertTriangle size={12} />,
    },
    approved: {
      labelEn: 'Approved',
      labelAr: 'معتمد للمنصة',
      color: 'text-emerald-700 dark:text-emerald-300',
      bg: 'bg-emerald-50 dark:bg-emerald-950/40',
      border: 'border-emerald-200 dark:border-emerald-800',
      icon: <CheckCircle2 size={12} />,
    },
    published: {
      labelEn: 'Published & Live',
      labelAr: 'منشور ومعروض',
      color: 'text-teal-700 dark:text-teal-300',
      bg: 'bg-teal-50 dark:bg-teal-950/40',
      border: 'border-teal-200 dark:border-teal-800',
      icon: <ShieldCheck size={12} />,
    },
    viewed: {
      labelEn: 'High Buyer Interest',
      labelAr: 'معاينات نشطة',
      color: 'text-indigo-700 dark:text-indigo-300',
      bg: 'bg-indigo-50 dark:bg-indigo-950/40',
      border: 'border-indigo-200 dark:border-indigo-800',
      icon: <Eye size={12} />,
    },
    contacted: {
      labelEn: 'Active Inquiries',
      labelAr: 'محادثات جارية',
      color: 'text-violet-700 dark:text-violet-300',
      bg: 'bg-violet-50 dark:bg-violet-950/40',
      border: 'border-violet-200 dark:border-violet-800',
      icon: <MessageSquare size={12} />,
    },
    reserved: {
      labelEn: 'Reserved',
      labelAr: 'محجوز بعربون',
      color: 'text-amber-800 dark:text-amber-200',
      bg: 'bg-amber-100/70 dark:bg-amber-900/50',
      border: 'border-amber-400 dark:border-amber-700',
      icon: <BookmarkCheck size={12} />,
    },
    sold: {
      labelEn: 'Sold & Closed',
      labelAr: 'تم البيع بنجاح',
      color: 'text-slate-800 dark:text-slate-100',
      bg: 'bg-slate-200 dark:bg-slate-800',
      border: 'border-slate-400 dark:border-slate-600',
      icon: <Tag size={12} />,
    },
    archived: {
      labelEn: 'Archived',
      labelAr: 'مؤرشف / ملغي',
      color: 'text-slate-500 dark:text-slate-400',
      bg: 'bg-slate-50 dark:bg-slate-900',
      border: 'border-slate-200 dark:border-slate-800',
      icon: <Lock size={12} />,
    },
  };

  const cfg = STATUS_CONFIG[status] || STATUS_CONFIG.draft;

  return (
    <div className="relative inline-block text-start">
      <div
        onClick={() => interactive && verification && setShowDetails(!showDetails)}
        className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-bold border transition-all ${
          cfg.bg
        } ${cfg.color} ${cfg.border} ${interactive && verification ? 'cursor-pointer hover:shadow-xs' : ''}`}
      >
        {cfg.icon}
        <span>{isRtl ? cfg.labelAr : cfg.labelEn}</span>
        {interactive && verification && (
          <ChevronDown size={11} className={`transition-transform duration-200 ${showDetails ? 'rotate-180' : ''}`} />
        )}
      </div>

      {showDetails && verification && (
        <div
          className="absolute z-50 top-full mt-2 w-72 p-3 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-2xl shadow-xl text-xs space-y-2 animate-in fade-in zoom-in-95 duration-150"
          style={{ [isRtl ? 'right' : 'left']: 0 }}
        >
          <div className="flex items-center justify-between pb-1.5 border-b border-slate-100 dark:border-slate-800">
            <span className="font-bold text-slate-800 dark:text-slate-100 flex items-center gap-1">
              <ShieldCheck size={13} className="text-emerald-500" />
              {isRtl ? 'أبعاد التحقق المعتمدة' : 'Hettety Trust Matrix'}
            </span>
            <span className="text-[10px] text-slate-400">
              {verification.verifiedAt ? new Date(verification.verifiedAt).toLocaleDateString() : ''}
            </span>
          </div>

          <div className="space-y-1.5 text-slate-600 dark:text-slate-300">
            <div className="flex items-center justify-between">
              <span>{isRtl ? 'فحص العقار والمواصفات' : 'Property & Specs'}</span>
              <span className={`font-semibold ${verification.propertyVerified ? 'text-emerald-600' : 'text-slate-400'}`}>
                {verification.propertyVerified ? (isRtl ? '✓ موثق' : '✓ Verified') : (isRtl ? '— غير مكتمل' : '— Pending')}
              </span>
            </div>
            <div className="flex items-center justify-between">
              <span>{isRtl ? 'هوية المالك المعتمدة' : 'Owner Identity'}</span>
              <span className={`font-semibold ${verification.ownerVerified ? 'text-emerald-600' : 'text-slate-400'}`}>
                {verification.ownerVerified ? (isRtl ? '✓ موثق' : '✓ Verified') : (isRtl ? '— قيد التدقيق' : '— Pending')}
              </span>
            </div>
            <div className="flex items-center justify-between">
              <span>{isRtl ? 'مستندات الملكية والشهر' : 'Legal Documents'}</span>
              <span className={`font-semibold ${verification.documentsReviewed ? 'text-emerald-600' : 'text-slate-400'}`}>
                {verification.documentsReviewed ? (isRtl ? '✓ تم التدقيق' : '✓ Reviewed') : (isRtl ? '— قيد المراجعة' : '— In Review')}
              </span>
            </div>
            <div className="flex items-center justify-between">
              <span>{isRtl ? 'الموقع الفعلي على الخريطة' : 'Grounded Location'}</span>
              <span className={`font-semibold ${verification.locationVerified ? 'text-emerald-600' : 'text-slate-400'}`}>
                {verification.locationVerified ? (isRtl ? '✓ معتمد' : '✓ Grounded') : (isRtl ? '— اختياري' : '— Unverified')}
              </span>
            </div>
            <div className="flex items-center justify-between">
              <span>{isRtl ? 'مطابقة السعر للسوق' : 'Price Realistic Check'}</span>
              <span className={`font-semibold ${verification.priceVerified ? 'text-emerald-600' : 'text-slate-400'}`}>
                {verification.priceVerified ? (isRtl ? '✓ متوافق' : '✓ Realistic') : (isRtl ? '— تقديري' : '— Estimated')}
              </span>
            </div>
          </div>

          {verification.reviewNote && (
            <div className="mt-2 pt-1.5 border-t border-slate-100 dark:border-slate-800 text-[11px] text-slate-500 italic bg-slate-50 dark:bg-slate-800/50 p-2 rounded-xl">
              <span className="font-semibold block not-italic text-slate-700 dark:text-slate-200">
                {isRtl ? 'ملاحظة المراجع:' : 'Reviewer Note:'}
              </span>
              {verification.reviewNote}
            </div>
          )}
        </div>
      )}
    </div>
  );
};
