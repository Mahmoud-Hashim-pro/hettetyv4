import React, { useEffect, useMemo, useState } from 'react';
import {
  Search,
  Plus,
  LayoutGrid,
  Table as TableIcon,
  CheckCircle2,
  XCircle,
  Eye,
  EyeOff,
  Box,
  Pencil,
  Trash2,
  Building2,
  MapPin,
  BedDouble,
  Bath,
  Maximize2,
  ShieldCheck,
  AlertTriangle,
  CheckSquare,
  Square,
  Loader2,
  X,
} from 'lucide-react';
import { Property } from '../types';

export interface AdminPropertiesPageProps {
  isRtl: boolean;
  properties: Property[];
  busyId: string | null;
  initialSearch?: string;
  onVerify: (property: Property, status: 'Verified' | 'Rejected' | 'Pending', note?: string) => Promise<void>;
  onChangeListingState: (property: Property, state: 'Live' | 'Draft' | 'Removed') => Promise<void>;
  onChangeAvailability: (property: Property, availability: 'Available' | 'Sold' | 'Reserved') => Promise<void>;
  onDelete: (property: Property) => Promise<void>;
  onBulkAction: (selected: Property[], action: 'verify' | 'hide' | 'live' | 'delete') => Promise<void>;
  onOpenAddListing?: () => void;
  onOpenEditListing?: (property: Property) => void;
  onOpenProperty?: (propertyId: string) => void;
  onOpen3D?: (propertyId: string) => void;
}

export const AdminPropertiesPage: React.FC<AdminPropertiesPageProps> = ({
  isRtl,
  properties,
  busyId,
  initialSearch = '',
  onVerify,
  onChangeListingState,
  onChangeAvailability,
  onDelete,
  onBulkAction,
  onOpenAddListing,
  onOpenEditListing,
  onOpenProperty,
  onOpen3D,
}) => {
  const [search, setSearch] = useState(initialSearch);
  useEffect(() => {
    if (initialSearch) setSearch(initialSearch);
  }, [initialSearch]);
  const [statusFilter, setStatusFilter] = useState<'all' | 'For Sale' | 'For Rent'>('all');
  const [verifFilter, setVerifFilter] = useState<'all' | 'Verified' | 'Pending' | 'Rejected'>('all');
  const [stateFilter, setStateFilter] = useState<'all' | 'Live' | 'Draft' | 'Removed'>('all');
  const [only3D, setOnly3D] = useState(false);
  const [viewMode, setViewMode] = useState<'table' | 'cards'>('table');
  const [selectedIds, setSelectedIds] = useState<string[]>([]);

  // Reject Reason Modal state
  const [rejectTarget, setRejectTarget] = useState<Property | null>(null);
  const [rejectReason, setRejectReason] = useState('');
  const [rejectError, setRejectError] = useState<string | null>(null);

  // Delete Confirmation Modal state
  const [deleteTarget, setDeleteTarget] = useState<Property | 'bulk' | null>(null);
  const [bulkBusy, setBulkBusy] = useState(false);

  const has3D = (p: Property) => Boolean(p.threeDTour || p.digitalTwinUrl || (p.panoramas && p.panoramas.length > 0));

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return properties.filter((p) => {
      if (statusFilter !== 'all' && p.status !== statusFilter) return false;
      const verif = p.verificationStatus || (p.isVerified ? 'Verified' : 'Pending');
      if (verifFilter !== 'all' && verif !== verifFilter) return false;
      const lState = p.listingState || 'Live';
      if (stateFilter !== 'all' && lState !== stateFilter) return false;
      if (only3D && !has3D(p)) return false;
      if (q) {
        const hay = `${p.title} ${p.location} ${p.compound || ''} ${p.developer || ''} ${p.unitCode || ''} ${p.id}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [properties, search, statusFilter, verifFilter, stateFilter, only3D]);

  const selectedProperties = useMemo(
    () => properties.filter((p) => selectedIds.includes(p.id)),
    [properties, selectedIds]
  );

  const allVisibleSelected =
    filtered.length > 0 && filtered.every((p) => selectedIds.includes(p.id));

  const toggleSelectAll = () => {
    if (allVisibleSelected) {
      setSelectedIds([]);
    } else {
      setSelectedIds(filtered.map((p) => p.id));
    }
  };

  const toggleSelectOne = (id: string) => {
    setSelectedIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  };

  const submitReject = async () => {
    if (!rejectTarget) return;
    if (!rejectReason.trim()) {
      setRejectError(isRtl ? 'يرجى كتابة سبب الرفض أو التعديل المطلوب.' : 'Please provide a rejection reason before submitting.');
      return;
    }
    setRejectError(null);
    await onVerify(rejectTarget, 'Rejected', rejectReason.trim());
    setRejectTarget(null);
    setRejectReason('');
  };

  const executeDelete = async () => {
    if (!deleteTarget) return;
    setBulkBusy(true);
    try {
      if (deleteTarget === 'bulk') {
        await onBulkAction(selectedProperties, 'delete');
        setSelectedIds([]);
      } else {
        await onDelete(deleteTarget);
        setSelectedIds((prev) => prev.filter((id) => id !== deleteTarget.id));
      }
      setDeleteTarget(null);
    } finally {
      setBulkBusy(false);
    }
  };

  const executeBulkNonDelete = async (action: 'verify' | 'hide' | 'live') => {
    if (selectedProperties.length === 0) return;
    setBulkBusy(true);
    try {
      await onBulkAction(selectedProperties, action);
      setSelectedIds([]);
    } finally {
      setBulkBusy(false);
    }
  };

  const formatPrice = (p: Property) => {
    const num = Number(p.price || 0);
    return `${num.toLocaleString()} ${p.currency || 'EGP'}`;
  };

  return (
    <div className="space-y-6 animate-fade-in" data-testid="admin-properties-page">
      {/* Header Row */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-black text-slate-900 dark:text-white flex items-center gap-2.5">
            <Building2 className="text-accent-500" size={24} />
            {isRtl ? 'إدارة مخزون العقارات (CMS)' : 'Properties Inventory CMS'}
          </h1>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
            {isRtl
              ? `عرض ${filtered.length} من أصل ${properties.length} عقار — تعديل التوافر، النشر، التوثيق، والإجراءات الجماعية`
              : `Showing ${filtered.length} of ${properties.length} listings — inline availability, publication state, verification & bulk actions`}
          </p>
        </div>

        <div className="flex items-center gap-2.5">
          <div className="inline-flex rounded-xl bg-slate-100 dark:bg-slate-800 p-1 border border-slate-200/70 dark:border-slate-700">
            <button
              type="button"
              onClick={() => setViewMode('table')}
              className={`px-3 py-1.5 rounded-lg text-xs font-bold flex items-center gap-1.5 transition-all cursor-pointer ${
                viewMode === 'table'
                  ? 'bg-white dark:bg-slate-900 text-brand-700 dark:text-white shadow-xs'
                  : 'text-slate-500 dark:text-slate-400'
              }`}
              aria-label={isRtl ? 'عرض جدول' : 'Table view'}
            >
              <TableIcon size={14} />
              <span className="hidden sm:inline">{isRtl ? 'جدول' : 'Table'}</span>
            </button>
            <button
              type="button"
              onClick={() => setViewMode('cards')}
              className={`px-3 py-1.5 rounded-lg text-xs font-bold flex items-center gap-1.5 transition-all cursor-pointer ${
                viewMode === 'cards'
                  ? 'bg-white dark:bg-slate-900 text-brand-700 dark:text-white shadow-xs'
                  : 'text-slate-500 dark:text-slate-400'
              }`}
              aria-label={isRtl ? 'عرض بطاقات' : 'Cards view'}
            >
              <LayoutGrid size={14} />
              <span className="hidden sm:inline">{isRtl ? 'بطاقات' : 'Cards'}</span>
            </button>
          </div>

          {onOpenAddListing && (
            <button
              type="button"
              onClick={onOpenAddListing}
              className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-accent-500 hover:bg-accent-600 text-white text-xs font-bold shadow-md shadow-accent-500/20 transition-all cursor-pointer"
            >
              <Plus size={16} />
              {isRtl ? 'إضافة عقار جديد' : 'Add New Property'}
            </button>
          )}
        </div>
      </div>

      {/* Filters Toolbar */}
      <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200/80 dark:border-slate-800 p-4 shadow-xs space-y-3">
        <div className="grid grid-cols-1 md:grid-cols-12 gap-3">
          <div className="md:col-span-4 relative">
            <Search size={16} className="absolute start-3.5 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={isRtl ? 'ابحث بالعنوان، المنطقة، الكمبوند، أو الكود...' : 'Search title, location, compound, developer, or ID...'}
              className="w-full ps-10 pe-3 py-2.5 rounded-xl bg-slate-50 dark:bg-slate-800/70 border border-slate-200 dark:border-slate-700 text-xs font-medium text-slate-900 dark:text-white placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-accent-500/40"
            />
          </div>

          <select
            aria-label={isRtl ? 'نوع العرض' : 'Listing status'}
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value as any)}
            className="md:col-span-2 px-3 py-2.5 rounded-xl bg-slate-50 dark:bg-slate-800/70 border border-slate-200 dark:border-slate-700 text-xs font-semibold text-slate-800 dark:text-slate-100"
          >
            <option value="all">{isRtl ? 'كل الأنواع' : 'All Types'}</option>
            <option value="For Sale">{isRtl ? 'للبيع' : 'For Sale'}</option>
            <option value="For Rent">{isRtl ? 'للإيجار' : 'For Rent'}</option>
          </select>

          <select
            aria-label={isRtl ? 'حالة التوثيق' : 'Verification filter'}
            value={verifFilter}
            onChange={(e) => setVerifFilter(e.target.value as any)}
            className="md:col-span-2 px-3 py-2.5 rounded-xl bg-slate-50 dark:bg-slate-800/70 border border-slate-200 dark:border-slate-700 text-xs font-semibold text-slate-800 dark:text-slate-100"
          >
            <option value="all">{isRtl ? 'كل حالات التوثيق' : 'All Verification'}</option>
            <option value="Verified">{isRtl ? 'موثّق' : 'Verified'}</option>
            <option value="Pending">{isRtl ? 'قيد المراجعة' : 'Pending'}</option>
            <option value="Rejected">{isRtl ? 'يحتاج تعديل' : 'Rejected'}</option>
          </select>

          <select
            aria-label={isRtl ? 'حالة النشر' : 'Listing visibility'}
            value={stateFilter}
            onChange={(e) => setStateFilter(e.target.value as any)}
            className="md:col-span-2 px-3 py-2.5 rounded-xl bg-slate-50 dark:bg-slate-800/70 border border-slate-200 dark:border-slate-700 text-xs font-semibold text-slate-800 dark:text-slate-100"
          >
            <option value="all">{isRtl ? 'كل حالات النشر' : 'All Visibility'}</option>
            <option value="Live">{isRtl ? 'منشور (Live)' : 'Live'}</option>
            <option value="Draft">{isRtl ? 'مسودة (Draft)' : 'Draft'}</option>
            <option value="Removed">{isRtl ? 'مخفي (Removed)' : 'Removed'}</option>
          </select>

          <button
            type="button"
            onClick={() => setOnly3D((v) => !v)}
            className={`md:col-span-2 px-3 py-2.5 rounded-xl border text-xs font-bold flex items-center justify-center gap-1.5 transition-all cursor-pointer ${
              only3D
                ? 'bg-purple-600 text-white border-purple-600'
                : 'bg-slate-50 dark:bg-slate-800/70 text-slate-700 dark:text-slate-200 border-slate-200 dark:border-slate-700 hover:border-purple-400'
            }`}
          >
            <Box size={14} />
            {isRtl ? 'جولات 3D فقط' : 'Has 3D Only'}
          </button>
        </div>

        {/* Bulk Actions Bar */}
        {selectedIds.length > 0 && (
          <div className="flex flex-wrap items-center justify-between gap-3 pt-3 border-t border-slate-100 dark:border-slate-800 bg-brand-50/70 dark:bg-brand-900/30 -mx-4 -mb-4 px-4 py-3 rounded-b-2xl">
            <div className="flex items-center gap-2 text-xs font-bold text-brand-800 dark:text-brand-200">
              <CheckSquare size={16} className="text-accent-500" />
              <span>
                {isRtl ? `تم تحديد ${selectedIds.length} عقار` : `${selectedIds.length} properties selected`}
              </span>
              <button
                type="button"
                onClick={() => setSelectedIds([])}
                className="text-[11px] underline text-slate-500 hover:text-slate-800 dark:hover:text-white ms-2 cursor-pointer"
              >
                {isRtl ? 'إلغاء التحديد' : 'Clear'}
              </button>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                disabled={bulkBusy}
                onClick={() => executeBulkNonDelete('verify')}
                className="px-3 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold inline-flex items-center gap-1.5 disabled:opacity-50 cursor-pointer"
              >
                <ShieldCheck size={14} />
                {isRtl ? 'توثيق المحدد' : 'Verify Selected'}
              </button>
              <button
                type="button"
                disabled={bulkBusy}
                onClick={() => executeBulkNonDelete('live')}
                className="px-3 py-1.5 rounded-lg bg-brand-600 hover:bg-brand-700 text-white text-xs font-bold inline-flex items-center gap-1.5 disabled:opacity-50 cursor-pointer"
              >
                <Eye size={14} />
                {isRtl ? 'نشر المحدد' : 'Set Live'}
              </button>
              <button
                type="button"
                disabled={bulkBusy}
                onClick={() => executeBulkNonDelete('hide')}
                className="px-3 py-1.5 rounded-lg bg-amber-600 hover:bg-amber-700 text-white text-xs font-bold inline-flex items-center gap-1.5 disabled:opacity-50 cursor-pointer"
              >
                <EyeOff size={14} />
                {isRtl ? 'إخفاء المحدد' : 'Hide Selected'}
              </button>
              <button
                type="button"
                disabled={bulkBusy}
                onClick={() => setDeleteTarget('bulk')}
                className="px-3 py-1.5 rounded-lg bg-rose-600 hover:bg-rose-700 text-white text-xs font-bold inline-flex items-center gap-1.5 disabled:opacity-50 cursor-pointer"
              >
                <Trash2 size={14} />
                {isRtl ? 'حذف المحدد' : 'Delete Selected'}
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Empty States */}
      {properties.length === 0 ? (
        <div
          data-testid="properties-zero-empty-state"
          className="bg-white dark:bg-slate-900 rounded-3xl border-2 border-dashed border-slate-200 dark:border-slate-800 py-16 px-6 text-center space-y-4"
        >
          <div className="w-16 h-16 rounded-2xl bg-brand-50 dark:bg-brand-900/40 text-brand-600 dark:text-accent-400 flex items-center justify-center mx-auto">
            <Building2 size={32} />
          </div>
          <div className="space-y-1.5 max-w-md mx-auto">
            <h3 className="text-lg font-black text-slate-900 dark:text-white">
              {isRtl ? 'مخزون العقارات فارغ حالياً (0 عقار)' : 'Property Inventory is Empty (0 Listings)'}
            </h3>
            <p className="text-xs text-slate-500 dark:text-slate-400 leading-relaxed">
              {isRtl
                ? 'تم تصفير العقارات أو لم يتم إضافة أي وحدات بعد. جميع حسابات المستخدمين والأدمن محفوظة بأمان. ابدأ بإضافة أول عقار رسمي الآن.'
                : 'No properties are currently stored in the database. All user and super admin accounts remain safely preserved. Start by adding your first listing.'}
            </p>
          </div>
          {onOpenAddListing && (
            <button
              type="button"
              onClick={onOpenAddListing}
              className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-accent-500 hover:bg-accent-600 text-white text-xs font-bold shadow-md transition-all cursor-pointer"
            >
              <Plus size={16} />
              {isRtl ? 'إضافة أول عقار للمنصة' : 'Add First Property'}
            </button>
          )}
        </div>
      ) : filtered.length === 0 ? (
        <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 py-14 px-6 text-center space-y-3">
          <p className="text-sm font-bold text-slate-800 dark:text-slate-200">
            {isRtl ? 'لا توجد عقارات مطابقة لمعايير التصفية الحالية' : 'No listings match your current filters'}
          </p>
          <button
            type="button"
            onClick={() => {
              setSearch('');
              setStatusFilter('all');
              setVerifFilter('all');
              setStateFilter('all');
              setOnly3D(false);
            }}
            className="text-xs font-bold text-accent-600 dark:text-accent-400 hover:underline cursor-pointer"
          >
            {isRtl ? 'إعادة ضبط الفلاتر' : 'Reset all filters'}
          </button>
        </div>
      ) : viewMode === 'table' ? (
        /* Table View */
        <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200/80 dark:border-slate-800 shadow-xs overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-xs text-start">
              <thead className="bg-slate-50 dark:bg-slate-800/60 text-slate-500 dark:text-slate-400 font-bold border-b border-slate-200/70 dark:border-slate-800">
                <tr>
                  <th className="py-3.5 px-4 w-10">
                    <button
                      type="button"
                      onClick={toggleSelectAll}
                      aria-label={isRtl ? 'تحديد الكل' : 'Select all'}
                      className="text-slate-500 hover:text-accent-500 cursor-pointer"
                    >
                      {allVisibleSelected ? <CheckSquare size={16} className="text-accent-500" /> : <Square size={16} />}
                    </button>
                  </th>
                  <th className="py-3.5 px-3">{isRtl ? 'العقار والموقع' : 'Property & Location'}</th>
                  <th className="py-3.5 px-3">{isRtl ? 'السعر والنوع' : 'Price & Type'}</th>
                  <th className="py-3.5 px-3">{isRtl ? 'التوافر' : 'Availability'}</th>
                  <th className="py-3.5 px-3">{isRtl ? 'النشر' : 'Visibility'}</th>
                  <th className="py-3.5 px-3">{isRtl ? 'التوثيق' : 'Verification'}</th>
                  <th className="py-3.5 px-4 text-end">{isRtl ? 'إجراءات' : 'Actions'}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                {filtered.map((prop) => {
                  const isBusy = busyId === prop.id;
                  const isSelected = selectedIds.includes(prop.id);
                  const verif = prop.verificationStatus || (prop.isVerified ? 'Verified' : 'Pending');
                  const lState = prop.listingState || 'Live';
                  const avail = prop.availability || 'Available';
                  const propHas3D = has3D(prop);

                  return (
                    <tr
                      key={prop.id}
                      className={`hover:bg-slate-50/80 dark:hover:bg-slate-800/30 transition-colors ${
                        isSelected ? 'bg-accent-50/40 dark:bg-accent-950/10' : ''
                      }`}
                    >
                      <td className="py-3.5 px-4 align-middle">
                        <button
                          type="button"
                          onClick={() => toggleSelectOne(prop.id)}
                          aria-label={prop.title}
                          className="text-slate-400 hover:text-accent-500 cursor-pointer"
                        >
                          {isSelected ? <CheckSquare size={16} className="text-accent-500" /> : <Square size={16} />}
                        </button>
                      </td>
                      <td className="py-3.5 px-3 align-middle">
                        <div className="flex items-center gap-3 min-w-[220px]">
                          <div className="w-12 h-12 rounded-xl overflow-hidden bg-slate-100 dark:bg-slate-800 shrink-0 border border-slate-200/70 dark:border-slate-700">
                            {prop.imageUrl ? (
                              <img src={prop.imageUrl} alt={prop.title} className="w-full h-full object-cover" />
                            ) : (
                              <div className="w-full h-full flex items-center justify-center text-slate-400">
                                <Building2 size={18} />
                              </div>
                            )}
                          </div>
                          <div className="min-w-0">
                            <div className="font-bold text-slate-900 dark:text-white truncate max-w-[220px]">
                              {prop.title}
                            </div>
                            <div className="text-[11px] text-slate-500 dark:text-slate-400 flex items-center gap-1 mt-0.5 truncate">
                              <MapPin size={11} className="shrink-0" />
                              <span className="truncate">{prop.compound ? `${prop.compound} • ${prop.location}` : prop.location}</span>
                            </div>
                            <div className="text-[10px] text-slate-400 mt-0.5 flex items-center gap-2 font-mono">
                              <span>{prop.area} m²</span>
                              <span>•</span>
                              <span>{prop.bedrooms} BD / {prop.bathrooms} BA</span>
                              {propHas3D && (
                                <span className="px-1.5 py-0.2 rounded bg-purple-100 text-purple-700 dark:bg-purple-900/40 dark:text-purple-300 font-sans font-bold">
                                  3D
                                </span>
                              )}
                            </div>
                          </div>
                        </div>
                      </td>
                      <td className="py-3.5 px-3 align-middle whitespace-nowrap">
                        <div className="font-mono font-black text-slate-900 dark:text-white">
                          {formatPrice(prop)}
                        </div>
                        <span
                          className={`inline-block mt-1 px-2 py-0.5 rounded-full text-[10px] font-bold ${
                            prop.status === 'For Sale'
                              ? 'bg-brand-100 text-brand-700 dark:bg-brand-900/40 dark:text-brand-200'
                              : 'bg-accent-100 text-accent-700 dark:bg-accent-900/40 dark:text-accent-300'
                          }`}
                        >
                          {prop.status === 'For Sale' ? (isRtl ? 'للبيع' : 'For Sale') : (isRtl ? 'للإيجار' : 'For Rent')}
                        </span>
                      </td>
                      <td className="py-3.5 px-3 align-middle">
                        <select
                          aria-label={isRtl ? 'حالة التوافر' : 'Availability'}
                          disabled={isBusy}
                          value={avail}
                          onChange={(e) => onChangeAvailability(prop, e.target.value as any)}
                          className={`px-2.5 py-1.5 rounded-lg text-[11px] font-bold border cursor-pointer disabled:opacity-50 ${
                            avail === 'Available'
                              ? 'bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-950/40 dark:text-emerald-300 dark:border-emerald-900'
                              : avail === 'Reserved'
                              ? 'bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-950/40 dark:text-amber-300 dark:border-amber-900'
                              : 'bg-slate-100 text-slate-700 border-slate-300 dark:bg-slate-800 dark:text-slate-300 dark:border-slate-700'
                          }`}
                        >
                          <option value="Available">{isRtl ? 'متاح' : 'Available'}</option>
                          <option value="Reserved">{isRtl ? 'محجوز' : 'Reserved'}</option>
                          <option value="Sold">{isRtl ? 'مباع' : 'Sold'}</option>
                        </select>
                      </td>
                      <td className="py-3.5 px-3 align-middle">
                        <select
                          aria-label={isRtl ? 'حالة النشر' : 'Listing visibility'}
                          disabled={isBusy}
                          value={lState}
                          onChange={(e) => onChangeListingState(prop, e.target.value as any)}
                          className={`px-2.5 py-1.5 rounded-lg text-[11px] font-bold border cursor-pointer disabled:opacity-50 ${
                            lState === 'Live'
                              ? 'bg-sky-50 text-sky-700 border-sky-200 dark:bg-sky-950/40 dark:text-sky-300 dark:border-sky-900'
                              : lState === 'Draft'
                              ? 'bg-slate-100 text-slate-600 border-slate-200 dark:bg-slate-800 dark:text-slate-300 dark:border-slate-700'
                              : 'bg-rose-50 text-rose-700 border-rose-200 dark:bg-rose-950/40 dark:text-rose-300 dark:border-rose-900'
                          }`}
                        >
                          <option value="Live">{isRtl ? 'منشور' : 'Live'}</option>
                          <option value="Draft">{isRtl ? 'مسودة' : 'Draft'}</option>
                          <option value="Removed">{isRtl ? 'مخفي' : 'Removed'}</option>
                        </select>
                      </td>
                      <td className="py-3.5 px-3 align-middle">
                        <div className="flex items-center gap-1.5">
                          <span
                            className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${
                              verif === 'Verified'
                                ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950/50 dark:text-emerald-300'
                                : verif === 'Rejected'
                                ? 'bg-rose-100 text-rose-700 dark:bg-rose-950/50 dark:text-rose-300'
                                : 'bg-amber-100 text-amber-700 dark:bg-amber-950/50 dark:text-amber-300'
                            }`}
                          >
                            {verif === 'Verified'
                              ? isRtl ? 'موثّق' : 'Verified'
                              : verif === 'Rejected'
                              ? isRtl ? 'مرفوض' : 'Rejected'
                              : isRtl ? 'معلّق' : 'Pending'}
                          </span>
                          {verif !== 'Verified' && (
                            <button
                              type="button"
                              disabled={isBusy}
                              onClick={() => onVerify(prop, 'Verified')}
                              title={isRtl ? 'توثيق فوري' : 'Approve & Verify'}
                              className="p-1 rounded-lg text-emerald-600 hover:bg-emerald-50 dark:hover:bg-emerald-950/40 cursor-pointer"
                            >
                              <CheckCircle2 size={15} />
                            </button>
                          )}
                          <button
                            type="button"
                            disabled={isBusy}
                            onClick={() => {
                              setRejectTarget(prop);
                              setRejectReason(prop.reviewNote || '');
                              setRejectError(null);
                            }}
                            title={isRtl ? 'رفض مع سبب' : 'Reject with reason'}
                            className="p-1 rounded-lg text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-950/40 cursor-pointer"
                          >
                            <XCircle size={15} />
                          </button>
                        </div>
                      </td>
                      <td className="py-3.5 px-4 align-middle text-end">
                        <div className="inline-flex items-center gap-1">
                          {isBusy && <Loader2 size={14} className="animate-spin text-accent-500 me-1" />}
                          {onOpenProperty && (
                            <button
                              type="button"
                              onClick={() => onOpenProperty(prop.id)}
                              title={isRtl ? 'عرض الإعلان' : 'View listing'}
                              className="p-1.5 rounded-lg text-slate-500 hover:text-brand-700 hover:bg-slate-100 dark:hover:bg-slate-800 cursor-pointer"
                            >
                              <Eye size={15} />
                            </button>
                          )}
                          {onOpen3D && propHas3D && (
                            <button
                              type="button"
                              onClick={() => onOpen3D(prop.id)}
                              title={isRtl ? 'جولة 3D' : 'Launch 3D Tour'}
                              className="p-1.5 rounded-lg text-purple-600 hover:bg-purple-50 dark:hover:bg-purple-950/40 cursor-pointer"
                            >
                              <Box size={15} />
                            </button>
                          )}
                          {onOpenEditListing && (
                            <button
                              type="button"
                              onClick={() => onOpenEditListing(prop)}
                              title={isRtl ? 'تعديل العقار' : 'Edit listing'}
                              className="p-1.5 rounded-lg text-brand-600 dark:text-brand-300 hover:bg-brand-50 dark:hover:bg-brand-900/40 cursor-pointer"
                            >
                              <Pencil size={15} />
                            </button>
                          )}
                          <button
                            type="button"
                            disabled={isBusy}
                            onClick={() => setDeleteTarget(prop)}
                            title={isRtl ? 'حذف نهائي' : 'Delete permanently'}
                            className="p-1.5 rounded-lg text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-950/40 cursor-pointer"
                          >
                            <Trash2 size={15} />
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      ) : (
        /* Card View */
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-5">
          {filtered.map((prop) => {
            const isSelected = selectedIds.includes(prop.id);
            const verif = prop.verificationStatus || (prop.isVerified ? 'Verified' : 'Pending');
            const lState = prop.listingState || 'Live';
            const avail = prop.availability || 'Available';
            const propHas3D = has3D(prop);

            return (
              <div
                key={prop.id}
                className={`bg-white dark:bg-slate-900 rounded-2xl border overflow-hidden shadow-xs flex flex-col transition-all ${
                  isSelected
                    ? 'border-accent-500 ring-2 ring-accent-500/20'
                    : 'border-slate-200/80 dark:border-slate-800 hover:shadow-md'
                }`}
              >
                <div className="relative h-44 bg-slate-100 dark:bg-slate-800">
                  {prop.imageUrl ? (
                    <img src={prop.imageUrl} alt={prop.title} className="w-full h-full object-cover" />
                  ) : (
                    <div className="w-full h-full flex items-center justify-center text-slate-400">
                      <Building2 size={36} />
                    </div>
                  )}
                  <div className="absolute top-3 start-3 flex items-center gap-1.5">
                    <button
                      type="button"
                      onClick={() => toggleSelectOne(prop.id)}
                      className="w-7 h-7 rounded-lg bg-white/90 dark:bg-slate-900/90 backdrop-blur flex items-center justify-center text-slate-700 dark:text-slate-200 shadow-xs cursor-pointer"
                      aria-label={prop.title}
                    >
                      {isSelected ? <CheckSquare size={15} className="text-accent-500" /> : <Square size={15} />}
                    </button>
                    <span
                      className={`px-2.5 py-1 rounded-lg text-[10px] font-bold backdrop-blur ${
                        verif === 'Verified'
                          ? 'bg-emerald-600/90 text-white'
                          : verif === 'Rejected'
                          ? 'bg-rose-600/90 text-white'
                          : 'bg-amber-500/90 text-white'
                      }`}
                    >
                      {verif}
                    </span>
                  </div>
                  {propHas3D && (
                    <span className="absolute top-3 end-3 px-2 py-1 rounded-lg bg-purple-600/90 text-white text-[10px] font-bold inline-flex items-center gap-1">
                      <Box size={11} /> 3D
                    </span>
                  )}
                </div>

                <div className="p-4 flex-1 flex flex-col justify-between gap-4">
                  <div className="space-y-1.5">
                    <div className="flex items-start justify-between gap-2">
                      <h3 className="text-sm font-bold text-slate-900 dark:text-white line-clamp-1">{prop.title}</h3>
                      <span className="text-xs font-mono font-black text-accent-600 dark:text-accent-400 shrink-0">
                        {formatPrice(prop)}
                      </span>
                    </div>
                    <p className="text-xs text-slate-500 dark:text-slate-400 flex items-center gap-1">
                      <MapPin size={12} /> {prop.location}
                    </p>
                    <div className="flex items-center gap-3 text-[11px] text-slate-500 dark:text-slate-400 pt-1">
                      <span className="inline-flex items-center gap-1"><BedDouble size={13} /> {prop.bedrooms}</span>
                      <span className="inline-flex items-center gap-1"><Bath size={13} /> {prop.bathrooms}</span>
                      <span className="inline-flex items-center gap-1"><Maximize2 size={13} /> {prop.area} m²</span>
                    </div>
                  </div>

                  <div className="space-y-3 pt-3 border-t border-slate-100 dark:border-slate-800">
                    <div className="grid grid-cols-2 gap-2">
                      <select
                        value={avail}
                        onChange={(e) => onChangeAvailability(prop, e.target.value as any)}
                        className="px-2.5 py-1.5 rounded-lg bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-[11px] font-bold"
                      >
                        <option value="Available">{isRtl ? 'متاح' : 'Available'}</option>
                        <option value="Reserved">{isRtl ? 'محجوز' : 'Reserved'}</option>
                        <option value="Sold">{isRtl ? 'مباع' : 'Sold'}</option>
                      </select>
                      <select
                        value={lState}
                        onChange={(e) => onChangeListingState(prop, e.target.value as any)}
                        className="px-2.5 py-1.5 rounded-lg bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-[11px] font-bold"
                      >
                        <option value="Live">{isRtl ? 'منشور' : 'Live'}</option>
                        <option value="Draft">{isRtl ? 'مسودة' : 'Draft'}</option>
                        <option value="Removed">{isRtl ? 'مخفي' : 'Removed'}</option>
                      </select>
                    </div>

                    <div className="flex items-center justify-between gap-1.5">
                      <div className="flex items-center gap-1">
                        <button
                          type="button"
                          onClick={() => onVerify(prop, 'Verified')}
                          className="px-2.5 py-1.5 rounded-lg bg-emerald-50 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-300 text-[11px] font-bold hover:bg-emerald-100 cursor-pointer"
                        >
                          {isRtl ? 'توثيق' : 'Verify'}
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            setRejectTarget(prop);
                            setRejectReason(prop.reviewNote || '');
                            setRejectError(null);
                          }}
                          className="px-2.5 py-1.5 rounded-lg bg-rose-50 dark:bg-rose-950/40 text-rose-700 dark:text-rose-300 text-[11px] font-bold hover:bg-rose-100 cursor-pointer"
                        >
                          {isRtl ? 'رفض' : 'Reject'}
                        </button>
                      </div>
                      <div className="flex items-center gap-1">
                        {onOpen3D && propHas3D && (
                          <button
                            type="button"
                            onClick={() => onOpen3D(prop.id)}
                            className="p-1.5 rounded-lg text-purple-600 hover:bg-purple-50 dark:hover:bg-purple-950/40 cursor-pointer"
                            title="3D"
                          >
                            <Box size={15} />
                          </button>
                        )}
                        {onOpenEditListing && (
                          <button
                            type="button"
                            onClick={() => onOpenEditListing(prop)}
                            className="p-1.5 rounded-lg text-brand-600 dark:text-brand-300 hover:bg-slate-100 dark:hover:bg-slate-800 cursor-pointer"
                            title={isRtl ? 'تعديل' : 'Edit'}
                          >
                            <Pencil size={15} />
                          </button>
                        )}
                        <button
                          type="button"
                          onClick={() => setDeleteTarget(prop)}
                          className="p-1.5 rounded-lg text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-950/40 cursor-pointer"
                          title={isRtl ? 'حذف' : 'Delete'}
                        >
                          <Trash2 size={15} />
                        </button>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Reject With Reason Modal */}
      {rejectTarget && (
        <div
          role="dialog"
          aria-modal="true"
          className="fixed inset-0 z-50 bg-slate-950/60 backdrop-blur-xs flex items-center justify-center p-4"
        >
          <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 max-w-md w-full p-6 shadow-2xl space-y-4">
            <div className="flex items-start justify-between gap-3">
              <div className="flex items-center gap-2.5">
                <div className="w-10 h-10 rounded-xl bg-rose-500/10 text-rose-600 flex items-center justify-center">
                  <AlertTriangle size={20} />
                </div>
                <div>
                  <h3 className="text-base font-bold text-slate-900 dark:text-white">
                    {isRtl ? 'رفض / طلب تعديل الإعلان' : 'Reject / Request Listing Changes'}
                  </h3>
                  <p className="text-xs text-slate-500 truncate max-w-[260px]">{rejectTarget.title}</p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setRejectTarget(null)}
                className="p-1 text-slate-400 hover:text-slate-700 dark:hover:text-white cursor-pointer"
              >
                <X size={18} />
              </button>
            </div>

            <div className="space-y-1.5">
              <label className="text-xs font-bold text-slate-700 dark:text-slate-200 block">
                {isRtl ? 'سبب الرفض أو الملاحظات للمالك (إلزامي)' : 'Reason / Reviewer Note for Owner (Required)'}
              </label>
              <textarea
                rows={4}
                value={rejectReason}
                onChange={(e) => {
                  setRejectReason(e.target.value);
                  if (rejectError) setRejectError(null);
                }}
                placeholder={
                  isRtl
                    ? 'مثال: يرجى إرفاق صورة أوضح لعقد الملكية وتوضيح السعر الصافي...'
                    : 'e.g. Ownership deed scan is unreadable; please upload a clear copy and confirm exact area...'
                }
                className="w-full rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 p-3 text-xs text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-rose-500/40"
              />
              {rejectError && <p className="text-xs font-semibold text-rose-600">{rejectError}</p>}
            </div>

            <div className="flex items-center justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => setRejectTarget(null)}
                className="px-4 py-2 rounded-xl text-xs font-bold text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 cursor-pointer"
              >
                {isRtl ? 'إلغاء' : 'Cancel'}
              </button>
              <button
                type="button"
                onClick={submitReject}
                className="px-4 py-2 rounded-xl bg-rose-600 hover:bg-rose-700 text-white text-xs font-bold cursor-pointer"
              >
                {isRtl ? 'تأكيد الرفض وإخطار المالك' : 'Confirm Reject & Notify Owner'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Permanent Delete Modal */}
      {deleteTarget && (
        <div
          role="dialog"
          aria-modal="true"
          className="fixed inset-0 z-50 bg-slate-950/60 backdrop-blur-xs flex items-center justify-center p-4"
        >
          <div className="bg-white dark:bg-slate-900 rounded-2xl border border-rose-200 dark:border-rose-900/60 max-w-md w-full p-6 shadow-2xl space-y-4">
            <div className="flex items-center gap-3">
              <div className="w-11 h-11 rounded-xl bg-rose-500/15 text-rose-600 flex items-center justify-center shrink-0">
                <Trash2 size={22} />
              </div>
              <div>
                <h3 className="text-base font-black text-slate-900 dark:text-white">
                  {deleteTarget === 'bulk'
                    ? isRtl
                      ? `حذف ${selectedProperties.length} عقار نهائياً؟`
                      : `Permanently delete ${selectedProperties.length} properties?`
                    : isRtl
                    ? 'حذف العقار نهائياً؟'
                    : 'Permanently delete listing?'}
                </h3>
                <p className="text-xs text-slate-500 dark:text-slate-400">
                  {deleteTarget === 'bulk'
                    ? isRtl
                      ? 'لا يمكن التراجع عن هذا الإجراء.'
                      : 'This action cannot be undone.'
                    : deleteTarget.title}
                </p>
              </div>
            </div>
            <p className="text-xs text-slate-600 dark:text-slate-300 bg-slate-50 dark:bg-slate-800/60 p-3 rounded-xl leading-relaxed">
              {isRtl
                ? 'إذا كنت ترغب في إخفاء الإعلان من الموقع العام فقط بدون مسح بياناته، يمكنك إلغاء الحذف واستخدام حالة النشر «مخفي» بدلاً من ذلك.'
                : 'If you only want to remove the listing from public view without destroying its data, cancel and set Visibility to "Removed" instead.'}
            </p>
            <div className="flex items-center justify-end gap-2">
              <button
                type="button"
                disabled={bulkBusy}
                onClick={() => setDeleteTarget(null)}
                className="px-4 py-2 rounded-xl text-xs font-bold text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 cursor-pointer"
              >
                {isRtl ? 'إلغاء' : 'Cancel'}
              </button>
              <button
                type="button"
                disabled={bulkBusy}
                onClick={executeDelete}
                className="px-4 py-2 rounded-xl bg-rose-600 hover:bg-rose-700 text-white text-xs font-bold inline-flex items-center gap-1.5 cursor-pointer disabled:opacity-50"
              >
                {bulkBusy && <Loader2 size={14} className="animate-spin" />}
                {isRtl ? 'نعم، احذف نهائياً' : 'Yes, Delete Permanently'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
