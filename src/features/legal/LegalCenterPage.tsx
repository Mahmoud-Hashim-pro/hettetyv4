import React, { useState, useEffect, useRef, useMemo } from 'react';
import {
  FileText,
  Upload,
  Search,
  ShieldCheck,
  Shield,
  Trash2,
  Loader2,
  X,
  AlertCircle,
  CheckCircle2,
  Clock,
  FileCheck2,
  Lock,
  ExternalLink,
  Scale,
  FolderOpen,
  CloudUpload,
  Eye,
  Info,
  Send,
} from 'lucide-react';
import imageCompression from 'browser-image-compression';
import {
  auth,
  db,
  storage,
  collection,
  query,
  where,
  onSnapshot,
  addDoc,
  updateDoc,
  deleteDoc,
  doc,
  ref,
  uploadBytes,
  getDownloadURL,
  deleteObject,
  handleFirestoreError,
  OperationType,
} from '../../firebase';
import { UserDocument, DocReviewStatus } from '../../types';
import { docReviewInfo, storagePathFromUrl } from '../../shared/utils/propertyFormatters';
import { BrandButton } from '../../shared/ui/BrandButton';
import { BrandLogo } from '../../components/BrandLogo';
import { useFocusTrap } from '../../hooks/useFocusTrap';

export interface LegalCenterPageProps {
  t: any;
  isRtl: boolean;
  userEmail: string | null;
}

type StatusFilter = 'all' | DocReviewStatus;

const MAX_FILE_SIZE_BYTES = 5 * 1024 * 1024;
const ALLOWED_MIME_TYPES = [
  'application/pdf',
  'image/jpeg',
  'image/png',
  'image/jpg',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
];

export const LegalCenterPage: React.FC<LegalCenterPageProps> = ({
  t,
  isRtl,
  userEmail,
}) => {
  const [docs, setDocs] = useState<UserDocument[]>([]);
  const [uploading, setUploading] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const [error, setError] = useState<string | null>(null);
  const [viewingDoc, setViewingDoc] = useState<UserDocument | null>(null);
  const [busyDocId, setBusyDocId] = useState<string | null>(null);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const legalModalRef = useFocusTrap<HTMLDivElement>(
    Boolean(viewingDoc),
    () => setViewingDoc(null)
  );

  useEffect(() => {
    if (!auth.currentUser) {
      setDocs([]);
      return;
    }

    const q = query(
      collection(db, 'user_documents'),
      where('ownerUid', '==', auth.currentUser.uid)
    );

    const unsubscribe = onSnapshot(
      q,
      (snapshot) => {
        const docsData = snapshot.docs.map((d) => ({
          id: d.id,
          ...d.data(),
        })) as UserDocument[];
        setDocs(docsData);
      },
      (err) => {
        handleFirestoreError(err, OperationType.GET, 'user_documents');
      }
    );

    return () => unsubscribe();
  }, [userEmail]);

  const handleUploadClick = () => {
    setError(null);
    if (!auth.currentUser) {
      setError(
        isRtl
          ? 'يرجى تسجيل الدخول أولاً لرفع المستندات.'
          : 'Please sign in first to upload documents.'
      );
      return;
    }
    fileInputRef.current?.click();
  };

  const processUploadFile = async (file: File) => {
    setError(null);

    if (!auth.currentUser) {
      setError(
        isRtl
          ? 'يرجى تسجيل الدخول أولاً لرفع المستندات.'
          : 'Please sign in first to upload documents.'
      );
      return;
    }

    if (file.size > MAX_FILE_SIZE_BYTES) {
      setError(
        isRtl
          ? 'حجم الملف يتجاوز الحد الأقصى (5 ميجابايت).'
          : 'File size exceeds the maximum limit (5MB).'
      );
      if (fileInputRef.current) fileInputRef.current.value = '';
      return;
    }

    if (!ALLOWED_MIME_TYPES.includes(file.type)) {
      setError(
        isRtl
          ? 'نوع الملف غير مدعوم. يرجى رفع ملفات PDF أو صور أو مستندات.'
          : 'Unsupported file type. Please upload PDF, images, or documents.'
      );
      if (fileInputRef.current) fileInputRef.current.value = '';
      return;
    }

    setUploading(true);
    const newDocName = file.name;

    try {
      let fileToUpload = file;
      if (file.type.includes('image')) {
        try {
          const options = {
            maxSizeMB: 1,
            maxWidthOrHeight: 1920,
            useWebWorker: true,
          };
          fileToUpload = await imageCompression(file, options);
        } catch (compressionError) {
          console.warn(
            'Image compression failed, uploading original:',
            compressionError
          );
        }
      }

      const storagePath = `user_documents/${auth.currentUser.uid}/${Date.now()}_${fileToUpload.name}`;
      const fileRef = ref(storage, storagePath);
      const uploadResult = await uploadBytes(fileRef, fileToUpload);
      const downloadUrl = await getDownloadURL(uploadResult.ref);

      // Uploading a file is not verifying it. The document starts unreviewed and
      // only an admin can move it on — never write status or accessStatus here.
      const newDocData = {
        fileId: `DOC-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
        name: newDocName,
        type: file.type.includes('image')
          ? 'Image'
          : file.type.includes('pdf')
            ? 'PDF'
            : 'Document',
        reviewStatus: 'Uploaded' as DocReviewStatus,
        uploadDate: new Date().toISOString().split('T')[0],
        size: fileToUpload.size,
        content: downloadUrl,
        ownerUid: auth.currentUser.uid,
        storagePath,
      };

      await addDoc(collection(db, 'user_documents'), newDocData);
    } catch (err) {
      setError(
        isRtl
          ? 'فشل رفع المستند. يرجى المحاولة مرة أخرى.'
          : 'Failed to upload document. Please try again.'
      );
      console.error('Upload Error:', err);
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    await processUploadFile(file);
  };

  const handleDrop = async (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
    if (uploading) return;
    const file = e.dataTransfer?.files?.[0];
    if (file) {
      await processUploadFile(file);
    }
  };

  /**
   * Documents uploaded before reviewStatus existed carry no state, so the admin's
   * queue query cannot see them. This lets the owner enqueue them as 'Uploaded'.
   */
  const handleRequestReview = async (docData: UserDocument) => {
    setError(null);
    setBusyDocId(docData.id);
    try {
      await updateDoc(doc(db, 'user_documents', docData.id), {
        reviewStatus: 'Uploaded',
      });
    } catch (err) {
      console.error('Review request failed:', err);
      setError(
        isRtl
          ? 'تعذّر إرسال المستند للمراجعة.'
          : 'Could not send this document for review.'
      );
    } finally {
      setBusyDocId(null);
    }
  };

  const handleDelete = async (docData: UserDocument) => {
    if (
      !window.confirm(
        isRtl
          ? 'هل أنت متأكد من حذف هذا المستند؟'
          : 'Are you sure you want to delete this document?'
      )
    ) {
      return;
    }
    setError(null);
    setBusyDocId(docData.id);
    try {
      // Delete the storage object first; tolerate storage/object-not-found so orphaned rows remain deletable.
      const path = docData.storagePath || storagePathFromUrl(docData.content);
      if (path) {
        await deleteObject(ref(storage, path)).catch((err: any) => {
          if (err?.code !== 'storage/object-not-found') throw err;
        });
      }
      await deleteDoc(doc(db, 'user_documents', docData.id));
      if (viewingDoc?.id === docData.id) {
        setViewingDoc(null);
      }
    } catch (err) {
      setError(isRtl ? 'فشل حذف المستند.' : 'Failed to delete document.');
      console.error('Delete Error:', err);
    } finally {
      setBusyDocId(null);
    }
  };

  const formatSize = (bytes?: number) => {
    if (!bytes) return '';
    if (bytes < 1024 * 1024) {
      return `${Math.max(1, Math.round(bytes / 1024))} KB`;
    }
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  const counts = useMemo(
    () => ({
      all: docs.length,
      uploaded: docs.filter((d) => !d.reviewStatus || d.reviewStatus === 'Uploaded').length,
      inReview: docs.filter((d) => d.reviewStatus === 'InReview').length,
      needsAttention: docs.filter((d) => d.reviewStatus === 'NeedsAttention').length,
      checked: docs.filter((d) => d.reviewStatus === 'Checked').length,
    }),
    [docs]
  );

  const filteredDocs = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return docs.filter((d) => {
      const normalizedStatus: DocReviewStatus = d.reviewStatus || 'Uploaded';
      if (statusFilter !== 'all' && normalizedStatus !== statusFilter) {
        return false;
      }
      if (!q) return true;
      return (
        d.name.toLowerCase().includes(q) ||
        d.type.toLowerCase().includes(q) ||
        (d.fileId ? d.fileId.toLowerCase().includes(q) : false)
      );
    });
  }, [docs, searchQuery, statusFilter]);

  const filterPills: { key: StatusFilter; label: string; count: number }[] = [
    { key: 'all', label: isRtl ? 'الكل' : 'All', count: counts.all },
    { key: 'Uploaded', label: isRtl ? 'مرفوع' : 'Uploaded', count: counts.uploaded },
    { key: 'InReview', label: isRtl ? 'جاري الفحص' : 'In Review', count: counts.inReview },
    { key: 'Checked', label: isRtl ? 'تم الفحص' : 'Checked', count: counts.checked },
    {
      key: 'NeedsAttention',
      label: isRtl ? 'إجراء مطلوب' : 'Action Needed',
      count: counts.needsAttention,
    },
  ];

  const lifecycleSteps = [
    {
      num: '01',
      icon: <CloudUpload size={17} className="text-accent-500" aria-hidden="true" />,
      title: isRtl ? 'رفع المستند في خزنتك' : 'Upload to Your Vault',
      desc: isRtl
        ? 'تُحفظ نسختك فور الرفع بحالة مبدئية دون أي اعتماد تلقائي أو تحليل آلي.'
        : 'Files are stored in your account with no automatic sign-off or automated analysis.',
    },
    {
      num: '02',
      icon: <Eye size={17} className="text-brand-500 dark:text-brand-300" aria-hidden="true" />,
      title: isRtl ? 'استلام المراجع البشري' : 'Human Reviewer Intake',
      desc: isRtl
        ? 'يطّلع أحد مراجعي حتتي على الصفحات المرفوعة للتأكد من وضوح البيانات وتطابقها الظاهري.'
        : 'A HETTETY reviewer reads the submitted copy for legibility and basic consistency.',
    },
    {
      num: '03',
      icon: <FileCheck2 size={17} className="text-emerald-600 dark:text-emerald-400" aria-hidden="true" />,
      title: isRtl ? 'ملاحظة مكتوبة وواضحة' : 'Plain Written Notes',
      desc: isRtl
        ? 'يُسجل المراجع ما شاهده فعلياً أو يطلب إعادة رفع أي صفحة غير واضحة بملاحظة صريحة.'
        : 'The reviewer records what was seen or flags illegible or missing pages for you to fix.',
    },
    {
      num: '04',
      icon: <Scale size={17} className="text-amber-600 dark:text-amber-400" aria-hidden="true" />,
      title: isRtl
        ? 'التأكيد الرسمي في الشهر العقاري'
        : 'Official Publicity Department Check',
      desc: isRtl
        ? 'لا تستطيع حتتي الاستعلام من السجلات الحكومية أو مخالفات البناء — يجب التحقق من التسجيل رسمياً في الشهر العقاري مع محاميك.'
        : 'HETTETY cannot query government registries, building violations, or tax dues. Always confirm title registration directly with the Real Estate Publicity Department and your lawyer.',
    },
  ];

  return (
    <div
      dir={isRtl ? 'rtl' : 'ltr'}
      className="max-w-6xl mx-auto px-4 sm:px-6 py-10 sm:py-12 animate-fade-in transition-colors duration-500"
    >
      {/* Architectural Header Banner */}
      <div className="relative overflow-hidden rounded-3xl bg-gradient-to-br from-brand-700 via-brand-600 to-brand-900 text-white p-6 sm:p-8 mb-8 shadow-xl shadow-brand-900/15 border border-brand-500/30">
        <div
          aria-hidden="true"
          className="pointer-events-none absolute -top-20 -end-16 w-72 h-72 rounded-full bg-accent-500/20 blur-3xl"
        />
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-0 opacity-[0.06] bg-[linear-gradient(to_right,#ffffff_1px,transparent_1px),linear-gradient(to_bottom,#ffffff_1px,transparent_1px)] bg-[size:32px_32px]"
        />

        <div className="relative z-10 flex flex-col lg:flex-row justify-between items-start lg:items-center gap-6">
          <div className="max-w-xl text-start">
            <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-white/10 border border-white/15 text-xs font-bold text-brand-100 mb-3 backdrop-blur-sm">
              <Lock size={13} className="text-accent-400" aria-hidden="true" />
              <span>{isRtl ? 'خزنة المستندات الشخصية' : 'Personal Document Vault'}</span>
            </div>
            <h2 className="text-2xl sm:text-3xl font-heading font-black text-white tracking-tight">
              {t.legal_title}
            </h2>
            <p className="text-brand-100/90 text-sm sm:text-base mt-1.5 leading-relaxed">
              {isRtl
                ? 'إدارة المستندات القانونية الخاصة بك بأمان.'
                : 'Securely manage your personal legal documents.'}
            </p>
          </div>

          <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-3 w-full lg:w-auto">
            <div className="relative flex-1 sm:w-64">
              <Search
                size={16}
                aria-hidden="true"
                className="absolute top-1/2 -translate-y-1/2 text-brand-200 start-3.5 pointer-events-none"
              />
              <input
                type="text"
                placeholder={
                  isRtl ? 'البحث بالاسم أو المعرف...' : 'Search by name or ID...'
                }
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                aria-label={
                  isRtl ? 'البحث في المستندات' : 'Search documents'
                }
                className="w-full bg-white/10 hover:bg-white/15 focus:bg-white dark:focus:bg-slate-900 border border-white/20 focus:border-accent-400 rounded-xl py-2.5 ps-10 pe-4 text-sm text-white placeholder:text-brand-200 focus:text-slate-900 dark:focus:text-white focus:placeholder:text-slate-400 outline-none transition-all backdrop-blur-sm"
              />
            </div>

            <input
              type="file"
              ref={fileInputRef}
              onChange={handleFileChange}
              className="hidden"
              accept=".pdf,.jpg,.jpeg,.png,.doc,.docx"
            />
            <BrandButton
              variant="accent"
              onClick={handleUploadClick}
              disabled={uploading}
              className="w-full sm:w-auto whitespace-nowrap shadow-lg shadow-accent-500/30"
            >
              {uploading ? (
                <Loader2 className="animate-spin w-4 h-4" aria-hidden="true" />
              ) : (
                <Upload className="w-4 h-4" aria-hidden="true" />
              )}
              <span>{uploading ? t.legal_uploading : t.legal_upload}</span>
            </BrandButton>
          </div>
        </div>
      </div>

      {/* Inline Error Banner */}
      {error && (
        <div
          role="alert"
          className="mb-6 p-4 bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-800 text-rose-700 dark:text-rose-300 rounded-2xl flex items-center justify-between gap-3 animate-fade-in"
        >
          <div className="flex items-center gap-3">
            <AlertCircle className="w-5 h-5 shrink-0" aria-hidden="true" />
            <p className="text-sm font-semibold">{error}</p>
          </div>
          <button
            type="button"
            onClick={() => setError(null)}
            aria-label={isRtl ? 'إغلاق التنبيه' : 'Dismiss error'}
            className="p-1.5 rounded-lg hover:bg-rose-100 dark:hover:bg-rose-900/50 transition-colors cursor-pointer"
          >
            <X size={16} aria-hidden="true" />
          </button>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8 items-start">
        {/* Main Vault Column */}
        <div className="lg:col-span-2 space-y-6">
          {/* Interactive Drag-and-Drop Document Dropzone */}
          <div
            onDragOver={(e) => {
              e.preventDefault();
              e.stopPropagation();
              if (!isDragging) setIsDragging(true);
            }}
            onDragLeave={(e) => {
              e.preventDefault();
              e.stopPropagation();
              setIsDragging(false);
            }}
            onDrop={handleDrop}
            onClick={() => !uploading && handleUploadClick()}
            role="region"
            aria-label={isRtl ? 'منطقة إفلات المستندات' : 'Document dropzone'}
            className={`group relative rounded-2xl border-2 border-dashed p-6 sm:p-7 transition-all duration-300 cursor-pointer ${
              isDragging
                ? 'border-accent-500 bg-accent-50/70 dark:bg-accent-950/30 scale-[1.01] shadow-lg shadow-accent-500/10'
                : 'border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 hover:border-brand-500 dark:hover:border-brand-400 hover:bg-brand-50/30 dark:hover:bg-slate-800/60'
            }`}
          >
            <div className="flex flex-col sm:flex-row items-center gap-4 text-center sm:text-start">
              <div
                className={`w-14 h-14 rounded-2xl flex items-center justify-center shrink-0 transition-transform duration-300 ${
                  isDragging
                    ? 'bg-accent-500 text-white scale-110'
                    : 'bg-brand-50 dark:bg-brand-900/40 text-brand-600 dark:text-brand-300 group-hover:scale-105'
                }`}
              >
                {uploading ? (
                  <Loader2 size={26} className="animate-spin" aria-hidden="true" />
                ) : (
                  <CloudUpload size={26} aria-hidden="true" />
                )}
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm sm:text-base font-extrabold text-slate-900 dark:text-white">
                  {uploading
                    ? t.legal_uploading
                    : isDragging
                      ? isRtl
                        ? 'أفلت الملف هنا لبدء الرفع'
                        : 'Drop your file here to start uploading'
                      : isRtl
                        ? 'اسحب وأفلت المستند هنا، أو انقر لاختيار ملف'
                        : 'Drag and drop a document here, or click to browse'}
                </p>
                <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
                  {isRtl
                    ? 'PDF، JPG، PNG، DOC، DOCX • الحد الأقصى 5 ميجابايت • يتم ضغط الصور تلقائياً'
                    : 'PDF, JPG, PNG, DOC, DOCX • Max 5MB • Images are compressed automatically'}
                </p>
              </div>
              <button
                type="button"
                disabled={uploading}
                onClick={(e) => {
                  e.stopPropagation();
                  handleUploadClick();
                }}
                className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-slate-100 dark:bg-slate-800 group-hover:bg-brand-600 dark:group-hover:bg-accent-500 group-hover:text-white text-slate-700 dark:text-slate-200 text-xs font-bold transition-colors shrink-0 cursor-pointer disabled:opacity-50 focus:outline-none focus:ring-2 focus:ring-brand-500"
              >
                <Upload size={14} aria-hidden="true" />
                <span>{isRtl ? 'اختر ملف' : 'Browse'}</span>
              </button>
            </div>
          </div>

          {/* Status Filter Pills */}
          <div
            className="flex items-center gap-2 overflow-x-auto pb-1 no-scrollbar"
            role="group"
            aria-label={isRtl ? 'تصفية المستندات حسب الحالة' : 'Filter documents by status'}
          >
            {filterPills.map((pill) => {
              const active = statusFilter === pill.key;
              return (
                <button
                  key={pill.key}
                  type="button"
                  onClick={() => setStatusFilter(pill.key)}
                  aria-pressed={active}
                  className={`inline-flex items-center gap-2 px-3.5 py-2 rounded-xl text-xs font-bold whitespace-nowrap border transition-all cursor-pointer focus:outline-none focus:ring-2 focus:ring-brand-500 ${
                    active
                      ? 'bg-brand-600 dark:bg-accent-500 text-white border-brand-600 dark:border-accent-500 shadow-sm'
                      : 'bg-white dark:bg-slate-900 text-slate-600 dark:text-slate-300 border-slate-200 dark:border-slate-800 hover:border-brand-300 dark:hover:border-slate-700'
                  }`}
                >
                  <span>{pill.label}</span>
                  <span
                    className={`px-1.5 py-0.5 rounded-md text-[10px] font-black tabular-nums ${
                      active
                        ? 'bg-white/20 text-white'
                        : 'bg-slate-100 dark:bg-slate-800 text-slate-500 dark:text-slate-400'
                    }`}
                  >
                    {pill.count}
                  </span>
                </button>
              );
            })}
          </div>

          {/* Document Cards List */}
          <div className="space-y-4">
            {filteredDocs.length > 0 ? (
              filteredDocs.map((docItem) => {
                const rev = docReviewInfo(docItem, t);
                const isBusy = busyDocId === docItem.id;
                return (
                  <article
                    key={docItem.id}
                    className="bg-white dark:bg-slate-900 p-5 sm:p-6 rounded-2xl border border-slate-200/90 dark:border-slate-800 shadow-sm hover:shadow-md hover:border-brand-200 dark:hover:border-slate-700 transition-all"
                  >
                    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                      <div className="flex items-start sm:items-center gap-4 min-w-0">
                        <div
                          className={`shrink-0 w-12 h-12 rounded-xl flex items-center justify-center border border-black/5 dark:border-white/5 ${rev.icon}`}
                        >
                          <FileText size={22} aria-hidden="true" />
                        </div>
                        <div className="min-w-0 text-start">
                          <div className="flex items-center gap-2 flex-wrap mb-1">
                            {docItem.fileId && (
                              <span className="text-[11px] font-mono font-semibold bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400 px-2 py-0.5 rounded-md border border-slate-200/70 dark:border-slate-700">
                                {docItem.fileId}
                              </span>
                            )}
                            <h4 className="font-extrabold text-slate-900 dark:text-white truncate text-sm sm:text-base">
                              {docItem.name}
                            </h4>
                          </div>
                          <p className="text-xs text-slate-500 dark:text-slate-400 flex items-center gap-1.5 flex-wrap">
                            <span className="font-bold uppercase tracking-wide">
                              {docItem.type}
                            </span>
                            <span aria-hidden="true">•</span>
                            <span className="tabular-nums">{docItem.uploadDate}</span>
                            {docItem.size ? (
                              <>
                                <span aria-hidden="true">•</span>
                                <span className="tabular-nums">{formatSize(docItem.size)}</span>
                              </>
                            ) : null}
                          </p>
                        </div>
                      </div>

                      <div className="flex items-center gap-2.5 sm:ms-4 shrink-0 justify-between sm:justify-end flex-wrap">
                        <span
                          className={`px-3 py-1 rounded-full text-xs font-bold border ${rev.chip}`}
                        >
                          {rev.label}
                        </span>

                        <div className="flex items-center gap-2">
                          {!docItem.reviewStatus && (
                            <button
                              type="button"
                              disabled={isBusy}
                              onClick={() => handleRequestReview(docItem)}
                              className="inline-flex items-center gap-1.5 text-xs font-bold text-slate-700 dark:text-slate-200 bg-slate-100 dark:bg-slate-800 px-3 py-1.5 rounded-xl border border-slate-200 dark:border-slate-700 hover:bg-brand-600 hover:text-white hover:border-brand-600 transition-colors cursor-pointer disabled:opacity-50 focus:outline-none focus:ring-2 focus:ring-brand-500"
                            >
                              <Send size={12} aria-hidden="true" />
                              <span>{isRtl ? 'اطلب مراجعة' : 'Request review'}</span>
                            </button>
                          )}

                          <button
                            type="button"
                            onClick={() => setViewingDoc(docItem)}
                            className="inline-flex items-center gap-1.5 text-xs font-bold text-brand-700 dark:text-brand-300 bg-brand-50 dark:bg-brand-900/30 px-3.5 py-1.5 rounded-xl border border-brand-200 dark:border-brand-800 hover:bg-brand-600 hover:text-white dark:hover:bg-brand-500 transition-colors cursor-pointer focus:outline-none focus:ring-2 focus:ring-brand-500"
                          >
                            {isRtl ? 'عرض' : 'View'}
                          </button>

                          <button
                            type="button"
                            disabled={isBusy}
                            onClick={() => handleDelete(docItem)}
                            aria-label={isRtl ? 'حذف' : 'Delete'}
                            title={isRtl ? 'حذف' : 'Delete'}
                            className="p-2 text-rose-500 hover:text-white hover:bg-rose-600 dark:hover:bg-rose-600 rounded-xl border border-transparent hover:border-rose-600 transition-colors cursor-pointer disabled:opacity-50 focus:outline-none focus:ring-2 focus:ring-rose-500"
                          >
                            <Trash2 size={16} aria-hidden="true" />
                          </button>
                        </div>
                      </div>
                    </div>

                    {/* Plain explanation of what the review status actually means */}
                    <p className="mt-3.5 pt-3 border-t border-slate-100 dark:border-slate-800/80 text-xs text-slate-600 dark:text-slate-400 leading-relaxed text-start">
                      {rev.desc}
                    </p>

                    {docItem.reviewNote && (
                      <div className="mt-3.5 p-4 rounded-xl bg-amber-50/70 dark:bg-amber-950/25 border border-amber-200/70 dark:border-amber-800/60 text-start">
                        <p className="text-xs font-extrabold text-amber-800 dark:text-amber-300 mb-1 flex items-center gap-1.5">
                          <Info size={13} aria-hidden="true" />
                          <span>{t.doc_review_note}</span>
                        </p>
                        <p className="text-sm text-slate-800 dark:text-slate-200 whitespace-pre-wrap leading-relaxed">
                          {docItem.reviewNote}
                        </p>
                      </div>
                    )}
                  </article>
                );
              })
            ) : (
              <div className="bg-white dark:bg-slate-900 p-10 rounded-2xl border border-slate-200 dark:border-slate-800 text-center">
                <div className="w-14 h-14 mx-auto mb-4 rounded-2xl bg-slate-100 dark:bg-slate-800 text-slate-400 dark:text-slate-500 flex items-center justify-center">
                  <FolderOpen size={26} aria-hidden="true" />
                </div>
                <p className="text-sm font-bold text-slate-700 dark:text-slate-300">
                  {isRtl ? 'لم يتم العثور على ملفات.' : 'No files found.'}
                </p>
                <p className="text-xs text-slate-500 dark:text-slate-400 mt-1.5 max-w-sm mx-auto">
                  {statusFilter !== 'all' || searchQuery.trim()
                    ? isRtl
                      ? 'جرّب مسح البحث أو تغيير تصفية الحالة لعرض جميع مستنداتك.'
                      : 'Try clearing your search or switching the filter to see all files.'
                    : isRtl
                      ? 'ابدأ برفع عقود الملكية أو التوكيلات في المنطقة أعلاه.'
                      : 'Upload title deeds, contracts, or permits using the dropzone above.'}
                </p>
                {(statusFilter !== 'all' || searchQuery.trim()) && (
                  <button
                    type="button"
                    onClick={() => {
                      setStatusFilter('all');
                      setSearchQuery('');
                    }}
                    className="mt-4 px-4 py-2 rounded-xl bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-xs font-bold text-slate-700 dark:text-slate-200 transition-colors cursor-pointer"
                  >
                    {isRtl ? 'عرض جميع المستندات' : 'Show all documents'}
                  </button>
                )}
              </div>
            )}
          </div>

          {/* 4-Step Transparent Review Lifecycle Guide */}
          <section
            aria-label={
              isRtl ? 'كيف تتم مراجعة المستندات' : 'Transparent Review Lifecycle'
            }
            className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200/90 dark:border-slate-800 p-6 shadow-sm"
          >
            <div className="flex items-center justify-between gap-3 mb-5">
              <div className="text-start">
                <h3 className="text-base sm:text-lg font-heading font-black text-slate-900 dark:text-white flex items-center gap-2">
                  <Scale size={18} className="text-accent-500" aria-hidden="true" />
                  <span>
                    {isRtl
                      ? 'كيف تعمل مراجعة المستندات بشفافية'
                      : 'How Transparent Document Review Works'}
                  </span>
                </h3>
                <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
                  {isRtl
                    ? 'ما يراجعه فريق حتتي مقابل ما يتطلب التحقق الحكومي الرسمي.'
                    : 'What HETTETY checks versus what requires official government registration.'}
                </p>
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              {lifecycleSteps.map((step) => (
                <div
                  key={step.num}
                  className="p-4 rounded-2xl bg-slate-50/90 dark:bg-slate-800/50 border border-slate-100 dark:border-slate-800 text-start flex flex-col gap-2"
                >
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2 font-extrabold text-xs sm:text-sm text-slate-900 dark:text-white">
                      {step.icon}
                      <span>{step.title}</span>
                    </div>
                    <span className="text-[11px] font-mono font-black text-slate-400 dark:text-slate-500">
                      {step.num}
                    </span>
                  </div>
                  <p className="text-xs text-slate-600 dark:text-slate-400 leading-relaxed">
                    {step.desc}
                  </p>
                </div>
              ))}
            </div>
          </section>
        </div>

        {/* Right Sidebar: Review Status Summary + Privacy Assurance */}
        <aside className="space-y-6">
          {/* Dark-Navy Review Status Summary Card */}
          <div className="bg-brand-900 dark:bg-slate-900 text-white p-6 rounded-2xl border border-brand-800 dark:border-slate-800 shadow-lg overflow-hidden relative">
            <div
              aria-hidden="true"
              className="absolute -top-2 -end-2 p-4 opacity-10 pointer-events-none"
            >
              <Shield size={84} />
            </div>
            <h3 className="font-heading font-black text-base mb-5 flex items-center gap-2 relative z-10">
              <ShieldCheck className="text-accent-400" size={20} aria-hidden="true" />
              <span>{t.legal_status}</span>
            </h3>
            <div className="space-y-1 relative z-10">
              {(
                [
                  {
                    label: t.legal_stat_1,
                    n: counts.uploaded,
                    color: 'text-slate-200',
                  },
                  {
                    label: t.legal_stat_2,
                    n: counts.inReview,
                    color: 'text-amber-400',
                  },
                  {
                    label: t.legal_stat_3,
                    n: counts.needsAttention,
                    color: 'text-rose-400',
                  },
                  {
                    label: t.legal_stat_4,
                    n: counts.checked,
                    color: 'text-emerald-400',
                  },
                ] as const
              ).map((row) => (
                <div
                  key={row.label}
                  className="flex justify-between items-center text-sm py-2.5 border-b border-white/10 last:border-b-0"
                >
                  <span className="text-slate-300 font-medium">{row.label}</span>
                  <span className={`font-black tabular-nums text-base ${row.color}`}>
                    {row.n}
                  </span>
                </div>
              ))}
            </div>

            <div className="mt-5 pt-4 border-t border-white/10 flex items-center justify-between text-xs text-brand-200 relative z-10">
              <span>{isRtl ? 'إجمالي الملفات' : 'Total files'}</span>
              <span className="font-black text-white tabular-nums">{counts.all}</span>
            </div>
          </div>

          {/* Honest Privacy & Link Scope Card */}
          <div className="bg-brand-50 dark:bg-brand-950/40 border border-brand-100 dark:border-brand-900/60 p-6 rounded-2xl text-start">
            <h3 className="font-extrabold text-brand-900 dark:text-brand-200 mb-2.5 text-sm flex items-center gap-2">
              <Lock size={16} className="text-accent-500 shrink-0" aria-hidden="true" />
              <span>{t.legal_privacy_title}</span>
            </h3>
            <p className="text-xs text-brand-700 dark:text-brand-300/90 leading-relaxed">
              {t.legal_privacy}
            </p>
          </div>

          {/* Quick Tips Card */}
          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 p-5 rounded-2xl text-start">
            <h4 className="text-xs font-black uppercase tracking-wider text-slate-500 dark:text-slate-400 mb-3">
              {isRtl ? 'إرشادات لملفات أوضح' : 'Tips for Faster Reading'}
            </h4>
            <ul className="space-y-2.5 text-xs text-slate-600 dark:text-slate-400">
              <li className="flex items-start gap-2">
                <CheckCircle2
                  size={14}
                  className="text-emerald-500 shrink-0 mt-0.5"
                  aria-hidden="true"
                />
                <span>
                  {isRtl
                    ? 'ارفع صور واضحة لكل صفحات العقد بدون قص للأطراف أو التوقيعات.'
                    : 'Capture full pages without cropping corners, stamps, or signatures.'}
                </span>
              </li>
              <li className="flex items-start gap-2">
                <Clock
                  size={14}
                  className="text-amber-500 shrink-0 mt-0.5"
                  aria-hidden="true"
                />
                <span>
                  {isRtl
                    ? 'احتفظ بنسخك الأصلية دائماً ولا ترفع مستندات شخصية غير لازمة للعقار.'
                    : 'Keep originals safe and avoid uploading unrelated personal records.'}
                </span>
              </li>
            </ul>
          </div>
        </aside>
      </div>

      {/* Accessible Focus-Trapped Document Preview Modal */}
      {viewingDoc && (
        <div
          className="fixed inset-0 z-[100] bg-slate-950/70 backdrop-blur-sm flex items-center justify-center p-4 animate-fade-in"
          onClick={() => setViewingDoc(null)}
        >
          <div
            ref={legalModalRef}
            role="dialog"
            aria-modal="true"
            aria-labelledby="legal-doc-modal-title"
            className="bg-white dark:bg-slate-900 rounded-3xl w-full max-w-4xl max-h-[90vh] flex flex-col overflow-hidden shadow-2xl border border-slate-200 dark:border-slate-800"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex justify-between items-center gap-3 p-4 sm:p-5 border-b border-slate-100 dark:border-slate-800 bg-slate-50 dark:bg-slate-900">
              <div className="flex items-center gap-3 min-w-0">
                <div className="bg-brand-100 dark:bg-brand-900/50 text-brand-600 dark:text-brand-300 p-2.5 rounded-xl shrink-0">
                  <FileText size={20} aria-hidden="true" />
                </div>
                <div className="min-w-0 text-start">
                  <h3
                    id="legal-doc-modal-title"
                    className="font-extrabold text-slate-900 dark:text-white truncate text-sm sm:text-base"
                  >
                    {viewingDoc.name}
                  </h3>
                  <p className="text-xs text-slate-500 dark:text-slate-400">
                    {viewingDoc.fileId} • {viewingDoc.type}
                  </p>
                </div>
                <span
                  className={`hidden sm:inline-flex px-3 py-1 rounded-full text-xs font-bold border shrink-0 ${
                    docReviewInfo(viewingDoc, t).chip
                  }`}
                >
                  {docReviewInfo(viewingDoc, t).label}
                </span>
              </div>

              <div className="flex items-center gap-2 shrink-0">
                {viewingDoc.content && /^https?:\/\//i.test(viewingDoc.content) && (
                  <a
                    href={viewingDoc.content}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl bg-brand-50 dark:bg-brand-900/40 text-brand-700 dark:text-brand-300 hover:bg-brand-600 hover:text-white text-xs font-bold transition-colors"
                  >
                    <ExternalLink size={14} aria-hidden="true" />
                    <span className="hidden sm:inline">
                      {isRtl ? 'فتح في نافذة جديدة' : 'Open file'}
                    </span>
                  </a>
                )}
                <button
                  type="button"
                  onClick={() => setViewingDoc(null)}
                  aria-label={isRtl ? 'إغلاق المستند' : 'Close document viewer'}
                  className="min-w-[44px] min-h-[44px] p-2.5 text-slate-500 hover:text-slate-800 dark:text-slate-400 dark:hover:text-white hover:bg-slate-200 dark:hover:bg-slate-800 rounded-full transition-colors cursor-pointer flex items-center justify-center focus:outline-none focus:ring-2 focus:ring-brand-500"
                >
                  <X size={20} aria-hidden="true" />
                </button>
              </div>
            </div>

            <div className="flex-1 bg-slate-100 dark:bg-slate-950 p-5 sm:p-8 flex items-center justify-center overflow-y-auto">
              {viewingDoc.type === 'Image' ||
              /\.(jpg|jpeg|png)$/i.test(viewingDoc.name) ? (
                <div className="max-w-full max-h-full flex flex-col items-center justify-center">
                  <div className="bg-white dark:bg-slate-900 p-2 rounded-2xl shadow-sm border border-slate-200 dark:border-slate-800 flex flex-col items-center justify-center overflow-hidden">
                    <img
                      src={viewingDoc.content || ''}
                      alt={viewingDoc.name}
                      className="max-w-full max-h-[60vh] object-contain rounded-xl"
                      referrerPolicy="no-referrer"
                    />
                  </div>
                  <p className="text-sm font-semibold mt-4 text-slate-600 dark:text-slate-400">
                    {viewingDoc.name}
                  </p>
                </div>
              ) : viewingDoc.type === 'PDF' && viewingDoc.content ? (
                <div className="w-full h-full min-h-[540px] bg-white dark:bg-slate-900 rounded-2xl shadow-sm border border-slate-200 dark:border-slate-800 overflow-hidden">
                  <iframe
                    src={viewingDoc.content}
                    title={viewingDoc.name}
                    className="w-full h-full min-h-[540px] border-0"
                  />
                </div>
              ) : (
                <div className="bg-white dark:bg-slate-900 w-full max-w-2xl min-h-[480px] shadow-sm border border-slate-200 dark:border-slate-800 rounded-2xl p-8 sm:p-10 text-start">
                  <div className="border-b border-slate-200 dark:border-slate-800 pb-6 mb-6">
                    <div className="flex justify-between items-start gap-4 mb-6">
                      <BrandLogo
                        variant="horizontal"
                        showTagline={false}
                        color="currentColor"
                        className="h-8 text-brand-600 dark:text-white"
                        isRtl={isRtl}
                      />
                      <div className="text-end">
                        <p className="text-lg font-heading font-black text-slate-900 dark:text-white">
                          {viewingDoc.type}
                        </p>
                        <p className="text-xs font-mono text-slate-500 dark:text-slate-400 mt-1">
                          {viewingDoc.fileId}
                        </p>
                      </div>
                    </div>
                    <h4 className="text-xl font-bold text-slate-900 dark:text-white mb-1.5">
                      {viewingDoc.name.replace(/\.[^/.]+$/, '')}
                    </h4>
                    <p className="text-xs text-slate-500 dark:text-slate-400">
                      {isRtl ? 'تاريخ الرفع:' : 'Upload Date:'}{' '}
                      {viewingDoc.uploadDate}
                    </p>
                  </div>

                  <div className="space-y-4 text-slate-600 dark:text-slate-400 leading-relaxed text-sm">
                    <p className="font-bold text-slate-900 dark:text-white">
                      {isRtl ? 'محتوى المستند:' : 'Document Content:'}
                    </p>
                    {viewingDoc.content &&
                    viewingDoc.content.startsWith('data:text') ? (
                      <div className="p-4 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl whitespace-pre-wrap font-mono text-xs overflow-auto max-h-64">
                        {(() => {
                          try {
                            return atob(viewingDoc.content.split(',')[1] || '');
                          } catch {
                            return isRtl
                              ? 'تعذر عرض محتوى المستند.'
                              : 'Unable to display document content.';
                          }
                        })()}
                      </div>
                    ) : (
                      <p>{docReviewInfo(viewingDoc, t).desc}</p>
                    )}

                    <div className="mt-6 p-4 bg-slate-50 dark:bg-slate-800/80 border border-slate-200 dark:border-slate-700 rounded-xl font-mono text-xs text-slate-600 dark:text-slate-400 space-y-1">
                      <div>ID: {viewingDoc.fileId || viewingDoc.id}</div>
                      <div>Name: {viewingDoc.name}</div>
                      <div>Type: {viewingDoc.type}</div>
                      <div>
                        Size:{' '}
                        {viewingDoc.size
                          ? `${(viewingDoc.size / 1024 / 1024).toFixed(2)} MB`
                          : 'Unknown'}
                      </div>
                    </div>
                  </div>

                  <div className="mt-10 pt-6 border-t border-slate-200 dark:border-slate-800 flex justify-between items-center gap-4 flex-wrap">
                    <p className="text-xs text-slate-500 dark:text-slate-400 max-w-md">
                      {docReviewInfo(viewingDoc, t).desc}
                    </p>
                    <span
                      className={`px-3 py-1 rounded-full text-xs font-bold border ${
                        docReviewInfo(viewingDoc, t).chip
                      }`}
                    >
                      {docReviewInfo(viewingDoc, t).label}
                    </span>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default LegalCenterPage;
