import React, { useEffect, useMemo, useState } from 'react';
import {
  FileCheck2,
  Building2,
  FileText,
  CheckCircle2,
  AlertTriangle,
  Clock,
  ExternalLink,
  Loader2,
  ShieldAlert,
  BellRing,
  Eye,
  RotateCcw,
} from 'lucide-react';
import { Property, UserAccountRecord, UserDocument } from '../types';
import { adminPortalService } from '../services/adminPortalService';

export interface AdminVerificationQueuePageProps {
  isRtl: boolean;
  properties: Property[];
  reviewDocs: UserDocument[];
  users: UserAccountRecord[];
  busyId: string | null;
  onVerifyProperty: (property: Property, status: 'Verified' | 'Rejected' | 'Pending', note?: string) => Promise<void>;
  onReviewDocument: (
    doc: UserDocument,
    nextStatus: 'InReview' | 'Checked' | 'NeedsAttention',
    note: string
  ) => Promise<void>;
  onOpenProperty?: (propertyId: string) => void;
}

export const AdminVerificationQueuePage: React.FC<AdminVerificationQueuePageProps> = ({
  isRtl,
  properties,
  reviewDocs,
  users,
  busyId,
  onVerifyProperty,
  onReviewDocument,
  onOpenProperty,
}) => {
  const [activeTab, setActiveTab] = useState<'properties' | 'documents'>('properties');
  const [propFilter, setPropFilter] = useState<'Pending' | 'Rejected' | 'all'>('Pending');
  const [docFilter, setDocFilter] = useState<'queue' | 'NeedsAttention' | 'Checked' | 'all'>('queue');

  const [selectedPropId, setSelectedPropId] = useState<string | null>(null);
  const [propNote, setPropNote] = useState('');
  const [propError, setPropError] = useState<string | null>(null);

  const [selectedDocId, setSelectedDocId] = useState<string | null>(null);
  const [docNote, setDocNote] = useState('');
  const [docError, setDocError] = useState<string | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewErr, setPreviewErr] = useState<string | null>(null);

  const filteredProps = useMemo(() => {
    return properties.filter((p) => {
      const st = p.verificationStatus || (p.isVerified ? 'Verified' : 'Pending');
      if (propFilter === 'all') return true;
      return st === propFilter;
    });
  }, [properties, propFilter]);

  const filteredDocs = useMemo(() => {
    return reviewDocs.filter((d) => {
      const st = d.reviewStatus || 'Uploaded';
      if (docFilter === 'all') return true;
      if (docFilter === 'queue') return st === 'Uploaded' || st === 'InReview';
      return st === docFilter;
    });
  }, [reviewDocs, docFilter]);

  const pendingPropCount = properties.filter(
    (p) => (p.verificationStatus || (p.isVerified ? 'Verified' : 'Pending')) === 'Pending'
  ).length;
  const pendingDocCount = reviewDocs.filter(
    (d) => !d.reviewStatus || d.reviewStatus === 'Uploaded' || d.reviewStatus === 'InReview'
  ).length;

  const selectedProp = useMemo(
    () => filteredProps.find((p) => p.id === selectedPropId) || filteredProps[0] || null,
    [filteredProps, selectedPropId]
  );

  const selectedDoc = useMemo(
    () => filteredDocs.find((d) => d.id === selectedDocId) || filteredDocs[0] || null,
    [filteredDocs, selectedDocId]
  );

  useEffect(() => {
    if (selectedProp) {
      setPropNote(selectedProp.reviewNote || '');
      setPropError(null);
    }
  }, [selectedProp?.id]);

  useEffect(() => {
    let active = true;
    if (!selectedDoc) {
      setPreviewUrl(null);
      setPreviewErr(null);
      return;
    }
    setDocNote(selectedDoc.reviewNote || '');
    setDocError(null);
    setPreviewUrl(null);
    setPreviewErr(null);
    setPreviewLoading(true);

    adminPortalService
      .resolveDocumentFileUrl(selectedDoc)
      .then((url) => {
        if (active) setPreviewUrl(url);
      })
      .catch(() => {
        if (active) {
          setPreviewErr(
            isRtl
              ? 'المستند لا يحتوي على مسار تخزين مباشر أو تعذّر جلبه في البيئة الحالية.'
              : 'No direct storage path available or file could not be resolved in this environment.'
          );
        }
      })
      .finally(() => {
        if (active) setPreviewLoading(false);
      });

    return () => {
      active = false;
    };
  }, [selectedDoc?.id, isRtl]);

  const ownerLabel = (uid?: string) => {
    if (!uid) return isRtl ? 'غير محدد' : 'Unknown';
    const u = users.find((x) => x.id === uid || x.uid === uid || x.accountIds?.includes(uid));
    return u ? `${u.name} (${u.email})` : `#${uid.slice(0, 10)}`;
  };

  const handlePropDecision = async (status: 'Verified' | 'Rejected' | 'Pending') => {
    if (!selectedProp) return;
    if (status === 'Rejected' && !propNote.trim()) {
      setPropError(
        isRtl
          ? 'سبب الرفض إلزامي حتى نتمكن من إبلاغ البائع بالتعديل المطلوب.'
          : 'A rejection reason is mandatory so the seller knows what to fix.'
      );
      return;
    }
    setPropError(null);
    await onVerifyProperty(selectedProp, status, propNote.trim() || undefined);
  };

  const handleDocDecision = async (nextStatus: 'InReview' | 'Checked' | 'NeedsAttention') => {
    if (!selectedDoc) return;
    if (nextStatus === 'NeedsAttention' && !docNote.trim()) {
      setDocError(
        isRtl
          ? 'يرجى كتابة ملاحظة توضح ما يحتاج تعديل قبل الإرسال للمستخدم.'
          : 'Please enter a reviewer note explaining what needs attention before submitting.'
      );
      return;
    }
    setDocError(null);
    await onReviewDocument(selectedDoc, nextStatus, docNote.trim());
  };

  const isImageUrl = (url: string, name: string) =>
    /\.(png|jpe?g|webp|gif)(\?|$)/i.test(url) || /\.(png|jpe?g|webp|gif)$/i.test(name) || url.startsWith('data:image/');

  const isPdfUrl = (url: string, name: string) =>
    /\.pdf(\?|$)/i.test(url) || /\.pdf$/i.test(name) || url.startsWith('data:application/pdf');

  return (
    <div className="space-y-6 animate-fade-in" data-testid="admin-verification-queue-page">
      {/* Header & Dual Switcher */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-black text-slate-900 dark:text-white flex items-center gap-2.5">
            <FileCheck2 className="text-accent-500" size={24} />
            {isRtl ? 'منصة المراجعة والتوثيق القانوني' : 'Verification & Legal Review Workbench'}
          </h1>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
            {isRtl
              ? 'مراجعة الإعلانات المعلّقة ومستندات الملكية المرفوعة مع إشعار فوري تلقائي للمالك باللغتين'
              : 'Split-screen review desk for pending property listings and user legal documents with automatic bilingual notifications'}
          </p>
        </div>

        <div className="inline-flex rounded-2xl bg-white dark:bg-slate-900 p-1.5 border border-slate-200 dark:border-slate-800 shadow-xs">
          <button
            type="button"
            onClick={() => setActiveTab('properties')}
            className={`px-4 py-2 rounded-xl text-xs font-bold inline-flex items-center gap-2 transition-all cursor-pointer ${
              activeTab === 'properties'
                ? 'bg-brand-600 text-white shadow-sm'
                : 'text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800'
            }`}
          >
            <Building2 size={15} />
            <span>{isRtl ? 'العقارات' : 'Listings'}</span>
            <span className="px-1.5 py-0.5 rounded-full text-[10px] bg-white/20 font-mono">{pendingPropCount}</span>
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('documents')}
            className={`px-4 py-2 rounded-xl text-xs font-bold inline-flex items-center gap-2 transition-all cursor-pointer ${
              activeTab === 'documents'
                ? 'bg-brand-600 text-white shadow-sm'
                : 'text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800'
            }`}
          >
            <FileText size={15} />
            <span>{isRtl ? 'مستندات المستخدمين' : 'Legal Documents'}</span>
            <span className="px-1.5 py-0.5 rounded-full text-[10px] bg-white/20 font-mono">{pendingDocCount}</span>
          </button>
        </div>
      </div>

      {/* Compliance Notice Banner */}
      <div className="rounded-2xl bg-amber-50/80 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-900/60 p-4 flex items-start gap-3">
        <ShieldAlert size={18} className="text-amber-600 dark:text-amber-400 shrink-0 mt-0.5" />
        <div className="text-xs text-amber-900 dark:text-amber-200 leading-relaxed">
          <span className="font-bold">
            {isRtl ? 'تنبيه الحوكمة والامتثال: ' : 'Compliance Protocol: '}
          </span>
          {isRtl
            ? 'حالة «تمت المراجعة / موثّق» تعني أن مراجع حتتي اطلع على النسخ المرفوعة وتأكد من اتساقها، ولا تغني عن التحقق الرسمي في مصلحة الشهر العقاري.'
            : 'Marking a listing or document "Reviewed / Checked" confirms a HETTETY reviewer inspected the uploaded copy; it does not substitute for an official Real Estate Publicity (الشهر العقاري) title search.'}
        </div>
      </div>

      {activeTab === 'properties' ? (
        <div className="space-y-4">
          {/* Sub-filter pills */}
          <div className="flex flex-wrap gap-2">
            {(['Pending', 'Rejected', 'all'] as const).map((st) => (
              <button
                key={st}
                type="button"
                onClick={() => setPropFilter(st)}
                className={`px-3.5 py-1.5 rounded-xl text-xs font-bold border transition-all cursor-pointer ${
                  propFilter === st
                    ? 'bg-accent-500 text-white border-accent-500'
                    : 'bg-white dark:bg-slate-900 text-slate-600 dark:text-slate-300 border-slate-200 dark:border-slate-800'
                }`}
              >
                {st === 'Pending'
                  ? isRtl ? 'بانتظار المراجعة' : 'Pending Review'
                  : st === 'Rejected'
                  ? isRtl ? 'مرفوض / يحتاج تعديل' : 'Needs Changes'
                  : isRtl ? 'كل العقارات' : 'All Listings'}
              </button>
            ))}
          </div>

          {filteredProps.length === 0 ? (
            <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 py-16 text-center space-y-2">
              <CheckCircle2 size={36} className="text-emerald-500 mx-auto" />
              <h3 className="text-base font-bold text-slate-900 dark:text-white">
                {isRtl ? 'طابور مراجعة العقارات نظيف تماماً!' : 'Property verification queue is completely clear!'}
              </h3>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                {isRtl ? 'لا توجد عقارات معلقة في هذا التصنيف حالياً.' : 'No listings waiting in this queue right now.'}
              </p>
            </div>
          ) : (
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-5">
              {/* Left Queue List */}
              <div className="lg:col-span-5 space-y-2.5 max-h-[620px] overflow-y-auto pe-1 custom-scrollbar">
                {filteredProps.map((prop) => {
                  const active = selectedProp?.id === prop.id;
                  const st = prop.verificationStatus || (prop.isVerified ? 'Verified' : 'Pending');
                  return (
                    <button
                      key={prop.id}
                      type="button"
                      onClick={() => setSelectedPropId(prop.id)}
                      className={`w-full text-start p-3.5 rounded-2xl border transition-all flex items-center gap-3 cursor-pointer ${
                        active
                          ? 'bg-brand-50/80 dark:bg-brand-900/40 border-brand-600 dark:border-accent-500 shadow-xs'
                          : 'bg-white dark:bg-slate-900 border-slate-200/80 dark:border-slate-800 hover:border-slate-300 dark:hover:border-slate-700'
                      }`}
                    >
                      <div className="w-14 h-14 rounded-xl overflow-hidden bg-slate-100 dark:bg-slate-800 shrink-0">
                        {prop.imageUrl ? (
                          <img src={prop.imageUrl} alt={prop.title} className="w-full h-full object-cover" />
                        ) : (
                          <div className="w-full h-full flex items-center justify-center text-slate-400">
                            <Building2 size={20} />
                          </div>
                        )}
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center justify-between gap-2">
                          <span className="font-bold text-xs text-slate-900 dark:text-white truncate">
                            {prop.title}
                          </span>
                          <span
                            className={`text-[10px] font-bold px-2 py-0.5 rounded-full shrink-0 ${
                              st === 'Verified'
                                ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950/50 dark:text-emerald-300'
                                : st === 'Rejected'
                                ? 'bg-rose-100 text-rose-700 dark:bg-rose-950/50 dark:text-rose-300'
                                : 'bg-amber-100 text-amber-700 dark:bg-amber-950/50 dark:text-amber-300'
                            }`}
                          >
                            {st}
                          </span>
                        </div>
                        <div className="text-[11px] text-slate-500 truncate mt-0.5">{prop.location}</div>
                        <div className="text-[11px] font-mono font-bold text-accent-600 dark:text-accent-400 mt-1">
                          {Number(prop.price || 0).toLocaleString()} {prop.currency || 'EGP'}
                        </div>
                      </div>
                    </button>
                  );
                })}
              </div>

              {/* Right Inspector */}
              {selectedProp && (
                <div className="lg:col-span-7 bg-white dark:bg-slate-900 rounded-2xl border border-slate-200/80 dark:border-slate-800 p-6 shadow-xs space-y-5">
                  <div className="flex items-start justify-between gap-4 border-b border-slate-100 dark:border-slate-800 pb-4">
                    <div>
                      <h2 className="text-lg font-black text-slate-900 dark:text-white">{selectedProp.title}</h2>
                      <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                        {isRtl ? 'المالك / الناشر:' : 'Submitted by:'} <span className="font-semibold text-slate-700 dark:text-slate-200">{ownerLabel(selectedProp.authorUid)}</span>
                      </p>
                    </div>
                    {onOpenProperty && (
                      <button
                        type="button"
                        onClick={() => onOpenProperty(selectedProp.id)}
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-slate-100 dark:bg-slate-800 text-xs font-bold text-slate-700 dark:text-slate-200 hover:bg-slate-200 dark:hover:bg-slate-700 cursor-pointer"
                      >
                        <Eye size={14} />
                        {isRtl ? 'معاينة' : 'Preview'}
                      </button>
                    )}
                  </div>

                  {/* Media Strip */}
                  {(selectedProp.images?.length || selectedProp.imageUrl) && (
                    <div className="flex gap-2.5 overflow-x-auto pb-1">
                      {[selectedProp.imageUrl, ...(selectedProp.images || [])]
                        .filter((u, idx, arr) => Boolean(u) && arr.indexOf(u) === idx)
                        .slice(0, 5)
                        .map((img, i) => (
                          <img
                            key={i}
                            src={img}
                            alt={`${selectedProp.title} #${i + 1}`}
                            className="w-28 h-20 rounded-xl object-cover border border-slate-200 dark:border-slate-700 shrink-0"
                          />
                        ))}
                    </div>
                  )}

                  {/* Legal Metadata Grid */}
                  <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 text-xs">
                    <div className="p-3 rounded-xl bg-slate-50 dark:bg-slate-800/60">
                      <div className="text-[10px] text-slate-400 font-bold">{isRtl ? 'رقم الشهر العقاري' : 'Registration #'}</div>
                      <div className="font-mono font-bold text-slate-900 dark:text-white mt-0.5">
                        {selectedProp.registrationNumber || (isRtl ? 'غير مرفق' : 'Not provided')}
                      </div>
                    </div>
                    <div className="p-3 rounded-xl bg-slate-50 dark:bg-slate-800/60">
                      <div className="text-[10px] text-slate-400 font-bold">{isRtl ? 'صحة التوقيع' : 'Court Signature'}</div>
                      <div className="font-bold text-slate-900 dark:text-white mt-0.5">
                        {selectedProp.courtSignatureValidity ? (isRtl ? 'مذكور: نعم' : 'Claimed: Yes') : (isRtl ? 'غير محدد' : 'Not stated')}
                      </div>
                    </div>
                    <div className="p-3 rounded-xl bg-slate-50 dark:bg-slate-800/60">
                      <div className="text-[10px] text-slate-400 font-bold">{isRtl ? 'المستندات المرفقة' : 'Attached Legal Docs'}</div>
                      <div className="font-mono font-bold text-slate-900 dark:text-white mt-0.5">
                        {selectedProp.legalDocs?.length || 0} {isRtl ? 'ملفات' : 'file(s)'}
                      </div>
                    </div>
                  </div>

                  {/* Reviewer Note */}
                  <div className="space-y-1.5">
                    <label className="text-xs font-bold text-slate-700 dark:text-slate-200 flex items-center justify-between">
                      <span>{isRtl ? 'ملاحظات المراجع (إلزامية عند الرفض)' : 'Reviewer Notes (Mandatory on Rejection)'}</span>
                      <span className="inline-flex items-center gap-1 text-[10px] text-emerald-600 dark:text-emerald-400">
                        <BellRing size={11} />
                        {isRtl ? 'سيصل إشعار تلقائي للمالك' : 'Auto-notifies owner'}
                      </span>
                    </label>
                    <textarea
                      rows={3}
                      value={propNote}
                      onChange={(e) => {
                        setPropNote(e.target.value);
                        if (propError) setPropError(null);
                      }}
                      placeholder={
                        isRtl
                          ? 'اكتب ما تمت مراجعته أو أي تعديلات مطلوبة من البائع...'
                          : 'Document what was checked or specify required fixes for the seller...'
                      }
                      className="w-full rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 p-3 text-xs text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-accent-500/40"
                    />
                    {propError && <p className="text-xs font-semibold text-rose-600">{propError}</p>}
                  </div>

                  {/* Decision Controls */}
                  <div className="flex flex-wrap items-center gap-2.5 pt-2">
                    <button
                      type="button"
                      disabled={busyId === selectedProp.id}
                      onClick={() => handlePropDecision('Verified')}
                      className="px-4 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold inline-flex items-center gap-1.5 cursor-pointer disabled:opacity-50"
                    >
                      {busyId === selectedProp.id ? <Loader2 size={14} className="animate-spin" /> : <CheckCircle2 size={15} />}
                      {isRtl ? 'اعتماد وتوثيق الإعلان' : 'Approve & Verify Listing'}
                    </button>
                    <button
                      type="button"
                      disabled={busyId === selectedProp.id}
                      onClick={() => handlePropDecision('Rejected')}
                      className="px-4 py-2.5 rounded-xl bg-rose-600 hover:bg-rose-700 text-white text-xs font-bold inline-flex items-center gap-1.5 cursor-pointer disabled:opacity-50"
                    >
                      <AlertTriangle size={15} />
                      {isRtl ? 'رفض وطلب تعديل' : 'Reject & Request Changes'}
                    </button>
                    <button
                      type="button"
                      disabled={busyId === selectedProp.id}
                      onClick={() => handlePropDecision('Pending')}
                      className="px-3.5 py-2.5 rounded-xl bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 text-xs font-bold inline-flex items-center gap-1.5 cursor-pointer disabled:opacity-50"
                    >
                      <RotateCcw size={14} />
                      {isRtl ? 'إرجاع للمعلق' : 'Return to Pending'}
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      ) : (
        /* User Legal Documents Workbench */
        <div className="space-y-4">
          <div className="flex flex-wrap gap-2">
            {(['queue', 'NeedsAttention', 'Checked', 'all'] as const).map((st) => (
              <button
                key={st}
                type="button"
                onClick={() => setDocFilter(st)}
                className={`px-3.5 py-1.5 rounded-xl text-xs font-bold border transition-all cursor-pointer ${
                  docFilter === st
                    ? 'bg-accent-500 text-white border-accent-500'
                    : 'bg-white dark:bg-slate-900 text-slate-600 dark:text-slate-300 border-slate-200 dark:border-slate-800'
                }`}
              >
                {st === 'queue'
                  ? isRtl ? 'بانتظار المراجعة' : 'Uploaded / In Review'
                  : st === 'NeedsAttention'
                  ? isRtl ? 'تحتاج إجراء' : 'Needs Attention'
                  : st === 'Checked'
                  ? isRtl ? 'تمت المراجعة' : 'Checked'
                  : isRtl ? 'الكل' : 'All Documents'}
              </button>
            ))}
          </div>

          {filteredDocs.length === 0 ? (
            <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 py-16 text-center space-y-2">
              <FileText size={36} className="text-emerald-500 mx-auto" />
              <h3 className="text-base font-bold text-slate-900 dark:text-white">
                {isRtl ? 'لا توجد مستندات بانتظار المراجعة' : 'No legal documents pending review'}
              </h3>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                {isRtl ? 'عند رفع المستخدمين لمستندات جديدة في الخزنة القانونية ستظهر هنا.' : 'Newly uploaded legal vault documents will appear here automatically.'}
              </p>
            </div>
          ) : (
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-5">
              {/* Left Document Queue */}
              <div className="lg:col-span-5 space-y-2.5 max-h-[620px] overflow-y-auto pe-1 custom-scrollbar">
                {filteredDocs.map((d) => {
                  const active = selectedDoc?.id === d.id;
                  const status = d.reviewStatus || 'Uploaded';
                  return (
                    <button
                      key={d.id}
                      type="button"
                      onClick={() => setSelectedDocId(d.id)}
                      className={`w-full text-start p-4 rounded-2xl border transition-all space-y-1.5 cursor-pointer ${
                        active
                          ? 'bg-brand-50/80 dark:bg-brand-900/40 border-brand-600 dark:border-accent-500 shadow-xs'
                          : 'bg-white dark:bg-slate-900 border-slate-200/80 dark:border-slate-800 hover:border-slate-300 dark:hover:border-slate-700'
                      }`}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="font-bold text-xs text-slate-900 dark:text-white truncate">{d.name}</span>
                        <span
                          className={`text-[10px] font-bold px-2 py-0.5 rounded-full shrink-0 ${
                            status === 'Checked'
                              ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950/50 dark:text-emerald-300'
                              : status === 'NeedsAttention'
                              ? 'bg-rose-100 text-rose-700 dark:bg-rose-950/50 dark:text-rose-300'
                              : status === 'InReview'
                              ? 'bg-sky-100 text-sky-700 dark:bg-sky-950/50 dark:text-sky-300'
                              : 'bg-amber-100 text-amber-700 dark:bg-amber-950/50 dark:text-amber-300'
                          }`}
                        >
                          {status}
                        </span>
                      </div>
                      <div className="text-[11px] text-slate-500 truncate">{ownerLabel(d.ownerUid)}</div>
                      <div className="text-[10px] text-slate-400 flex items-center justify-between">
                        <span>{d.type || 'Document'}</span>
                        <span>{d.uploadDate}</span>
                      </div>
                    </button>
                  );
                })}
              </div>

              {/* Right Document Previewer & Review Controls */}
              {selectedDoc && (
                <div className="lg:col-span-7 bg-white dark:bg-slate-900 rounded-2xl border border-slate-200/80 dark:border-slate-800 p-6 shadow-xs space-y-5">
                  <div className="flex items-start justify-between gap-3 border-b border-slate-100 dark:border-slate-800 pb-4">
                    <div>
                      <h2 className="text-base font-black text-slate-900 dark:text-white">{selectedDoc.name}</h2>
                      <p className="text-xs text-slate-500 mt-0.5">
                        {isRtl ? 'المالك:' : 'Owner:'} {ownerLabel(selectedDoc.ownerUid)} • {selectedDoc.uploadDate}
                      </p>
                    </div>
                    {previewUrl && (
                      <a
                        href={previewUrl}
                        target="_blank"
                        rel="noreferrer"
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-brand-600 text-white text-xs font-bold hover:bg-brand-700 shrink-0"
                      >
                        <ExternalLink size={13} />
                        {isRtl ? 'فتح الملف' : 'Open File'}
                      </a>
                    )}
                  </div>

                  {/* File Preview Container */}
                  <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950/60 min-h-[220px] flex items-center justify-center overflow-hidden p-3">
                    {previewLoading ? (
                      <div className="flex flex-col items-center gap-2 text-slate-400">
                        <Loader2 size={24} className="animate-spin text-accent-500" />
                        <span className="text-xs">{isRtl ? 'جاري تحميل معاينة المستند...' : 'Resolving secure file preview...'}</span>
                      </div>
                    ) : previewUrl ? (
                      isImageUrl(previewUrl, selectedDoc.name) ? (
                        <img
                          src={previewUrl}
                          alt={selectedDoc.name}
                          className="max-h-[320px] w-auto rounded-lg object-contain"
                        />
                      ) : isPdfUrl(previewUrl, selectedDoc.name) ? (
                        <iframe
                          src={previewUrl}
                          title={selectedDoc.name}
                          className="w-full h-[320px] rounded-lg border-0 bg-white"
                        />
                      ) : (
                        <div className="text-center space-y-2 py-6">
                          <FileText size={32} className="text-brand-600 dark:text-accent-400 mx-auto" />
                          <p className="text-xs font-semibold text-slate-600 dark:text-slate-300">
                            {isRtl ? 'الملف جاهز للفتح في نافذة منفصلة' : 'Document resolved and ready to inspect'}
                          </p>
                          <a
                            href={previewUrl}
                            target="_blank"
                            rel="noreferrer"
                            className="inline-flex items-center gap-1.5 text-xs font-bold text-accent-600 hover:underline"
                          >
                            <ExternalLink size={13} />
                            {isRtl ? 'تنزيل / عرض الملف' : 'Open / Download File'}
                          </a>
                        </div>
                      )
                    ) : (
                      <div className="text-center space-y-1.5 py-6 px-4">
                        <AlertTriangle size={26} className="text-amber-500 mx-auto" />
                        <p className="text-xs font-medium text-slate-500 dark:text-slate-400">
                          {previewErr || (isRtl ? 'لا توجد معاينة متاحة' : 'Preview unavailable')}
                        </p>
                      </div>
                    )}
                  </div>

                  {/* Reviewer Notes */}
                  <div className="space-y-1.5">
                    <label className="text-xs font-bold text-slate-700 dark:text-slate-200 flex items-center justify-between">
                      <span>{isRtl ? 'ملاحظات المراجع القانوني' : 'Legal Reviewer Note'}</span>
                      <span className="text-[10px] text-slate-400">
                        {isRtl ? 'إلزامي لحالة «يحتاج إجراء»' : 'Required for NeedsAttention'}
                      </span>
                    </label>
                    <textarea
                      rows={3}
                      value={docNote}
                      onChange={(e) => {
                        setDocNote(e.target.value);
                        if (docError) setDocError(null);
                      }}
                      placeholder={
                        isRtl
                          ? 'مثال: الصفحات 1-4 واضحة ومتطابقة مع بيانات البائع...'
                          : 'e.g. Verified contract pages 1–4 match seller profile; advise buyer to verify registry deed...'
                      }
                      className="w-full rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 p-3 text-xs text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-accent-500/40"
                    />
                    {docError && <p className="text-xs font-semibold text-rose-600">{docError}</p>}
                  </div>

                  {/* Action Buttons */}
                  <div className="flex flex-wrap items-center gap-2.5">
                    <button
                      type="button"
                      disabled={busyId === selectedDoc.id}
                      onClick={() => handleDocDecision('InReview')}
                      className="px-4 py-2.5 rounded-xl bg-sky-600 hover:bg-sky-700 text-white text-xs font-bold inline-flex items-center gap-1.5 cursor-pointer disabled:opacity-50"
                    >
                      <Clock size={14} />
                      {isRtl ? 'قيد المراجعة' : 'Mark In Review'}
                    </button>
                    <button
                      type="button"
                      disabled={busyId === selectedDoc.id}
                      onClick={() => handleDocDecision('Checked')}
                      className="px-4 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold inline-flex items-center gap-1.5 cursor-pointer disabled:opacity-50"
                    >
                      <CheckCircle2 size={14} />
                      {isRtl ? 'تمت المراجعة (إخطار المالك)' : 'Mark Checked (Notify Owner)'}
                    </button>
                    <button
                      type="button"
                      disabled={busyId === selectedDoc.id}
                      onClick={() => handleDocDecision('NeedsAttention')}
                      className="px-4 py-2.5 rounded-xl bg-rose-600 hover:bg-rose-700 text-white text-xs font-bold inline-flex items-center gap-1.5 cursor-pointer disabled:opacity-50"
                    >
                      <AlertTriangle size={14} />
                      {isRtl ? 'يحتاج إجراء من المالك' : 'Flag Needs Attention'}
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
};
