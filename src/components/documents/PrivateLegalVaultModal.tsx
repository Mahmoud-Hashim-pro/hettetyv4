import React, { useState } from 'react';
import { LegalDocumentRecord, LegalDocumentAccessRequest } from '../../types';
import {
  getDocumentTypeLabel,
  isAccessGrantActive,
  generateSecureViewerSession,
  requestDocumentAccess,
} from '../../services/documents/private-document-service';
import { ShieldAlert, Lock, Unlock, Eye, FileCheck, X, Check, Clock } from 'lucide-react';

interface PrivateLegalVaultModalProps {
  isOpen: boolean;
  onClose: () => void;
  propertyId: string;
  propertyTitle: string;
  ownerId: string;
  currentUserId: string;
  documents: LegalDocumentRecord[];
  accessRequest?: LegalDocumentAccessRequest | null;
  onRequestAccess?: (req: LegalDocumentAccessRequest) => void;
  onGrantAccess?: (reqId: string) => void;
  isRtl?: boolean;
}

export const PrivateLegalVaultModal: React.FC<PrivateLegalVaultModalProps> = ({
  isOpen,
  onClose,
  propertyId,
  propertyTitle,
  ownerId,
  currentUserId,
  documents,
  accessRequest,
  onRequestAccess,
  onGrantAccess,
  isRtl = false,
}) => {
  const [selectedDoc, setSelectedDoc] = useState<LegalDocumentRecord | null>(null);
  const [requesterName, setRequesterName] = useState('');
  const [requesterPhone, setRequesterPhone] = useState('');
  const [purpose, setPurpose] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  if (!isOpen) return null;

  const isOwner = currentUserId === ownerId;
  const isGranted = isAccessGrantActive(accessRequest);
  const canView = isOwner || isGranted;

  const handleCreateRequest = (e: React.FormEvent) => {
    e.preventDefault();
    if (!requesterName || !requesterPhone) return;

    setIsSubmitting(true);
    const newReq = requestDocumentAccess(
      propertyId,
      ownerId,
      {
        id: currentUserId,
        name: requesterName,
        phone: requesterPhone,
      },
      purpose
    );

    if (onRequestAccess) {
      onRequestAccess(newReq);
    }
    setIsSubmitting(false);
  };

  const activeViewerSession = selectedDoc && canView && accessRequest
    ? generateSecureViewerSession(selectedDoc, accessRequest, currentUserId)
    : null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      data-testid="private-legal-vault-modal"
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-sm"
      dir={isRtl ? 'rtl' : 'ltr'}
    >
      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl w-full max-w-3xl max-h-[90vh] flex flex-col shadow-2xl overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100 dark:border-slate-800">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-amber-500/10 text-amber-600 dark:text-amber-400 flex items-center justify-center">
              {canView ? <Unlock size={22} /> : <Lock size={22} />}
            </div>
            <div>
              <h3 className="font-bold text-lg text-slate-900 dark:text-white">
                {isRtl ? 'خزينة المستندات القانونية المشفرة' : 'Private Legal Document Vault'}
              </h3>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                {propertyTitle} (#{propertyId})
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-2 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800"
            aria-label="Close"
          >
            <X size={20} />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto p-6 space-y-6">
          {/* Security Notice */}
          <div className="flex items-start gap-3 p-4 rounded-xl bg-amber-500/10 border border-amber-500/20 text-xs text-amber-800 dark:text-amber-300">
            <ShieldAlert size={20} className="shrink-0 text-amber-600 dark:text-amber-400" />
            <div>
              <p className="font-semibold mb-1">
                {isRtl ? 'حماية مشددة لبيانات الملكية العقارية' : 'Confidential Title & Deed Protection'}
              </p>
              <p>
                {isRtl
                  ? 'يتم تشفير وتتبع جميع مستندات الملكية. أي معاينة للمستندات تكون مائية بالاسم ورقم الهاتف ولا يُسمح بتداولها خارج المنصة.'
                  : 'All ownership deeds are cryptographically restricted and watermarked with requester identity to prevent unauthorized distribution.'}
              </p>
            </div>
          </div>

          {/* If Buyer and Not Granted Access Yet */}
          {!canView && (
            <div className="bg-slate-50 dark:bg-slate-800/40 p-5 rounded-xl border border-slate-200 dark:border-slate-800 text-center">
              {accessRequest?.status === 'pending' ? (
                <div className="py-6 space-y-3">
                  <div className="w-12 h-12 rounded-full bg-blue-500/10 text-blue-500 mx-auto flex items-center justify-center">
                    <Clock size={28} />
                  </div>
                  <h4 className="font-bold text-slate-900 dark:text-white">
                    {isRtl ? 'طلب المعاينة قيد مراجعة المالك' : 'Access Request Under Owner Review'}
                  </h4>
                  <p className="text-xs text-slate-500 dark:text-slate-400 max-w-md mx-auto">
                    {isRtl
                      ? 'تم إرسال طلبك إلى مالك العقار بنجاح. ستصلك إشعار فوري عند منحك تصريح فحص الأوراق لمدة ٤٨ ساعة.'
                      : 'Your request has been forwarded to the property owner. You will receive immediate notice once access is granted for 48 hours.'}
                  </p>
                </div>
              ) : (
                <form onSubmit={handleCreateRequest} className="space-y-4 text-start">
                  <h4 className="font-bold text-slate-900 dark:text-white text-sm">
                    {isRtl ? 'طلب تصريح فحص الأوراق القانونية' : 'Request Legal Inspection Grant'}
                  </h4>
                  <p className="text-xs text-slate-500 dark:text-slate-400">
                    {isRtl
                      ? 'لحماية خصوصية البائع، يرجى تأكيد بياناتك الشخصية لإصدار نسخة مائية مؤقتة صالحة للمعاينة القانونية.'
                      : 'Please enter your verified details to generate a 48-hour watermarked inspection pass.'}
                  </p>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                    <div>
                      <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                        {isRtl ? 'الاسم بالكامل' : 'Full Name'}
                      </label>
                      <input
                        type="text"
                        required
                        value={requesterName}
                        onChange={(e) => setRequesterName(e.target.value)}
                        placeholder={isRtl ? 'أحمد محمد' : 'Ahmed Mohamed'}
                        className="w-full px-3 py-2 text-sm rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-amber-500"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                        {isRtl ? 'رقم الهاتف (واتساب)' : 'Phone Number (WhatsApp)'}
                      </label>
                      <input
                        type="tel"
                        required
                        value={requesterPhone}
                        onChange={(e) => setRequesterPhone(e.target.value)}
                        placeholder="+20 100 123 4567"
                        className="w-full px-3 py-2 text-sm rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-amber-500"
                      />
                    </div>
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                      {isRtl ? 'الغرض من الفحص' : 'Inspection Purpose'}
                    </label>
                    <input
                      type="text"
                      value={purpose}
                      onChange={(e) => setPurpose(e.target.value)}
                      placeholder={isRtl ? 'مراجعة سند الملكية قبل التعاقد والجدية' : 'Due diligence prior to purchase deposit'}
                      className="w-full px-3 py-2 text-sm rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-amber-500"
                    />
                  </div>
                  <button
                    type="submit"
                    disabled={isSubmitting}
                    className="w-full py-2.5 px-4 rounded-xl bg-amber-500 hover:bg-amber-600 text-slate-950 font-bold text-sm transition-colors shadow-sm"
                  >
                    {isRtl ? 'إرسال طلب فحص المستندات' : 'Submit Inspection Request'}
                  </button>
                </form>
              )}
            </div>
          )}

          {/* Document Inventory */}
          <div className="space-y-3">
            <h4 className="font-bold text-slate-900 dark:text-white text-sm">
              {isRtl ? 'قائمة المستندات المسجلة في الخزينة' : 'Registered Vault Documents'}
            </h4>
            {documents.length === 0 ? (
              <p className="text-xs text-slate-400 py-3">
                {isRtl ? 'لم يقم المالك برفع مستندات بعد.' : 'No legal documents uploaded yet.'}
              </p>
            ) : (
              <div className="space-y-2">
                {documents.map((doc) => (
                  <div
                    key={doc.id}
                    className={`flex items-center justify-between p-3.5 rounded-xl border transition-all ${
                      selectedDoc?.id === doc.id
                        ? 'border-amber-500 bg-amber-500/5'
                        : 'border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900'
                    }`}
                  >
                    <div className="flex items-center gap-3">
                      <FileCheck className="text-emerald-500" size={20} />
                      <div>
                        <div className="font-semibold text-sm text-slate-900 dark:text-white">
                          {isRtl ? doc.titleAr || doc.title : doc.title}
                        </div>
                        <div className="text-xs text-slate-500 dark:text-slate-400">
                          {getDocumentTypeLabel(doc.documentType, isRtl)} • {(doc.fileSizeBytes / 1024).toFixed(0)} KB
                        </div>
                      </div>
                    </div>
                    {canView ? (
                      <button
                        onClick={() => setSelectedDoc(doc)}
                        className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-xs font-semibold text-slate-700 dark:text-slate-300"
                      >
                        <Eye size={14} />
                        {isRtl ? 'معاينة مائية' : 'Inspect'}
                      </button>
                    ) : (
                      <span className="text-xs text-slate-400 flex items-center gap-1">
                        <Lock size={12} /> {isRtl ? 'مغلق' : 'Restricted'}
                      </span>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Watermarked Document Previewer */}
          {selectedDoc && canView && (
            <div
              data-testid="watermarked-document-viewer"
              className="mt-6 border-2 border-dashed border-amber-500/40 rounded-2xl p-6 bg-slate-50/70 dark:bg-slate-800/40 relative overflow-hidden"
            >
              {/* Dynamic Watermark Overlay */}
              <div
                data-testid="watermark-overlay"
                className="absolute inset-0 pointer-events-none select-none flex items-center justify-center rotate-[-25deg] text-red-500/15 dark:text-red-400/20 font-black text-center text-lg md:text-xl p-4 uppercase tracking-widest leading-loose"
              >
                {activeViewerSession?.watermark || 'HETTETY CONFIDENTIAL'}
              </div>

              <div className="relative z-10 space-y-4">
                <div className="flex items-center justify-between pb-3 border-b border-slate-200 dark:border-slate-700">
                  <div className="flex items-center gap-2">
                    <FileCheck className="text-emerald-500" size={18} />
                    <span className="font-bold text-sm text-slate-900 dark:text-white">
                      {isRtl ? selectedDoc.titleAr || selectedDoc.title : selectedDoc.title}
                    </span>
                  </div>
                  <span className="text-xs text-emerald-600 dark:text-emerald-400 font-semibold bg-emerald-500/10 px-2 py-0.5 rounded-full">
                    {isRtl ? 'معاينة قانونية آمنة' : 'Secure Certified View'}
                  </span>
                </div>

                <div className="p-4 bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-800 text-xs font-mono text-slate-700 dark:text-slate-300 space-y-2">
                  <p><strong className="text-slate-900 dark:text-white">Document ID:</strong> {selectedDoc.id}</p>
                  <p><strong className="text-slate-900 dark:text-white">Category:</strong> {selectedDoc.category}</p>
                  <p><strong className="text-slate-900 dark:text-white">Verification Status:</strong> {selectedDoc.verificationStatus}</p>
                  <p><strong className="text-slate-900 dark:text-white">Active Watermark:</strong> {activeViewerSession?.watermark}</p>
                  <p className="text-slate-400 italic">
                    [End-to-End Cryptographically Signed Preview Stream for Property #{propertyId}]
                  </p>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
