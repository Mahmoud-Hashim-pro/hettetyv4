import React, { useState, useEffect, useMemo } from 'react';
import { motion } from 'motion/react';
import {
  Building2,
  MapPin,
  CheckCircle,
  Clock,
  Loader2,
  RefreshCw,
  Phone,
  Target,
  Edit2,
  Save,
  LogOut,
  Shield,
  History,
  Heart,
  PlusCircle,
  FileText,
  AlertCircle,
  Mail,
  UserCheck,
} from 'lucide-react';
import {
  auth,
  db,
  storage,
  doc,
  getDoc,
  setDoc,
  collection,
  getDocs,
  query,
  where,
  updateDoc,
  deleteDoc,
  ref,
  deleteObject,
  handleFirestoreError,
  OperationType,
} from '../../firebase';
import { SUPER_ADMIN_EMAILS } from '../../constants';
import { Property } from '../../types';
import {
  priceLabel,
  listingReviewInfo,
  storagePathFromUrl,
} from '../../shared/utils/propertyFormatters';
import { BrandButton } from '../../shared/ui/BrandButton';
import { PropertyImage } from '../../shared/ui/PropertyImage';
import { ReshapedPropertyCard } from '../properties/components/ReshapedPropertyCard';
import { EmptyState } from '../../components/EmptyState';

export interface ProfilePageProps {
  t: any;
  isRtl: boolean;
  onBrowse: () => void;
  onLogout: () => void;
  onLogin: () => void;
  userEmail: string | null;
  userFavorites: string[];
  allProperties: Property[];
  onToggleFavorite: (id: string) => void;
  open3D: (id: string) => void;
  onOpenProperty: (id: string) => void;
  onEditListing?: (id: string) => void;
  onAddListing?: () => void;
  onOpenAdmin?: () => void;
  isAdmin?: boolean;
  refreshProperties?: () => Promise<void>;
}

export const ProfilePage: React.FC<ProfilePageProps> = ({
  t,
  isRtl,
  onBrowse,
  onLogout,
  onLogin,
  userEmail,
  userFavorites,
  allProperties,
  onToggleFavorite,
  open3D,
  onOpenProperty,
  onEditListing,
  onAddListing,
  onOpenAdmin,
  isAdmin = false,
  refreshProperties,
}) => {
  const [profile, setProfile] = useState<any>(null);
  const [purchases, setPurchases] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [isEditing, setIsEditing] = useState(false);
  const [editForm, setEditForm] = useState<any>({});
  const [saving, setSaving] = useState(false);
  const [activeSubTab, setActiveSubTab] = useState<'purchases' | 'favorites' | 'listings'>('purchases');
  const [listingBusy, setListingBusy] = useState<string | null>(null);
  const [listingError, setListingError] = useState<string | null>(null);

  const currentUid = auth.currentUser?.uid;
  const myListings = useMemo(
    () => allProperties.filter((p) => p.authorUid && p.authorUid === currentUid),
    [allProperties, currentUid]
  );

  const favoriteProperties = useMemo(
    () => allProperties.filter((p) => userFavorites.includes(p.id)),
    [allProperties, userFavorites]
  );

  const completedPurchases = useMemo(
    () =>
      purchases.filter(
        (p) =>
          p.status?.toLowerCase() === 'completed' ||
          p.status?.toLowerCase() === 'finished'
      ),
    [purchases]
  );

  const inProgressPurchases = useMemo(
    () =>
      purchases.filter(
        (p) =>
          p.status?.toLowerCase() === 'processing' ||
          p.status?.toLowerCase() === 'pending'
      ),
    [purchases]
  );

  const isPrivilegedAdmin =
    isAdmin || SUPER_ADMIN_EMAILS.includes((userEmail || '').toLowerCase());

  /** Hide or re-publish a listing. Reversible, and nothing referencing it breaks. */
  const setListingState = async (id: string, next: 'Live' | 'Removed') => {
    setListingBusy(id);
    setListingError(null);
    try {
      await updateDoc(doc(db, 'properties', id), { listingState: next });
      await refreshProperties?.();
    } catch (err) {
      console.error('Listing state change failed:', err);
      setListingError(
        isRtl
          ? 'تعذّر تغيير حالة الإعلان.'
          : 'Could not change the listing state.'
      );
    } finally {
      setListingBusy(null);
    }
  };

  /**
   * Hard delete. Media uploaded before paths were namespaced by uid cannot be
   * removed from the browser, so the owner is told rather than reassured.
   */
  const deleteListing = async (p: Property) => {
    const urls = [
      p.imageUrl,
      ...(p.images || []),
      ...(p.panoramas || []),
      ...(p.legalDocs || []),
      p.videoUrl,
    ].filter(Boolean) as string[];
    const paths = urls.map(storagePathFromUrl).filter(Boolean) as string[];
    const legacy = paths.filter(
      (path) => !path.startsWith(`properties/${auth.currentUser?.uid}/`)
    );
    const warning = legacy.length
      ? isRtl
        ? `\n\nملحوظة: ${legacy.length} من ملفات الإعلان اترفعت قبل تعديل مسارات التخزين، فمش هتتمسح من السيرفر. لازم تتشال يدوي.`
        : `\n\nNote: ${legacy.length} of this listing's files predate the current storage layout and will stay on the server. They have to be removed manually.`
      : '';
    if (
      !window.confirm(
        (isRtl
          ? 'حذف الإعلان ده نهائياً؟ مش هينفع ترجّعه.'
          : 'Delete this listing permanently? This cannot be undone.') + warning
      )
    ) {
      return;
    }

    setListingBusy(p.id);
    setListingError(null);
    const removable = paths.filter((path) => !legacy.includes(path));
    let removed = 0;
    try {
      // Delete files first and in parallel; tolerate already-absent objects.
      await Promise.all(
        removable.map((path) =>
          deleteObject(ref(storage, path))
            .then(() => {
              removed += 1;
            })
            .catch((err: any) => {
              if (err?.code === 'storage/object-not-found') return;
              console.error('Storage delete failed for', path, err);
              throw err;
            })
        )
      );
      await deleteDoc(doc(db, 'properties', p.id));
    } catch (err) {
      console.error('Listing delete failed:', err);
      setListingError(
        removed > 0
          ? isRtl
            ? `تعذّر حذف الإعلان بالكامل. ${removed} من ملفاته اتشالوا فعلاً — جرّب تاني عشان يتشال الباقي.`
            : `Could not finish deleting the listing. ${removed} of its files were already removed — try again to finish.`
          : isRtl
            ? 'تعذّر حذف الإعلان. ما اتشالش حاجة — جرّب تاني.'
            : 'Could not delete the listing. Nothing was removed — please try again.'
      );
      return;
    } finally {
      setListingBusy(null);
    }
    // Outside the try: a failed refetch is a stale screen, not a failed delete.
    await refreshProperties?.().catch((err) =>
      console.warn('Refresh after delete failed:', err)
    );
  };

  useEffect(() => {
    if (!auth.currentUser) {
      setLoading(false);
      return;
    }

    const fetchProfile = async () => {
      try {
        const userDoc = await getDoc(doc(db, 'users', auth.currentUser!.uid));
        const fallback = {
          name: auth.currentUser!.displayName || '',
          email: auth.currentUser!.email || '',
          phone: '',
          preferences: '',
        };
        const data = userDoc.exists() ? userDoc.data() : fallback;
        setProfile(data);
        setEditForm(data);

        const q = query(
          collection(db, 'purchases'),
          where('userId', '==', auth.currentUser!.uid)
        );
        const querySnapshot = await getDocs(q);
        const purchaseData = querySnapshot.docs.map((d) => ({
          id: d.id,
          ...d.data(),
          property: allProperties.find(
            (prop) => prop.id === (d.data() as any).propertyId
          ),
        }));
        setPurchases(purchaseData);
      } catch (err) {
        console.error('Error fetching purchases:', err);
        setPurchases([]);
      } finally {
        setLoading(false);
      }
    };

    fetchProfile();
  }, [userEmail, allProperties]);

  const handleSave = async () => {
    if (!auth.currentUser) return;
    setSaving(true);
    try {
      const syncedProfile = {
        ...editForm,
        uid: auth.currentUser.uid,
        email: auth.currentUser.email || editForm.email || '',
        role:
          profile?.role ||
          (SUPER_ADMIN_EMAILS.includes(
            (auth.currentUser.email || '').toLowerCase()
          )
            ? 'admin'
            : 'user'),
      };
      await setDoc(doc(db, 'users', auth.currentUser.uid), syncedProfile, {
        merge: true,
      });
      setProfile(syncedProfile);
      setIsEditing(false);
    } catch (err) {
      handleFirestoreError(
        err,
        OperationType.UPDATE,
        `users/${auth.currentUser.uid}`
      );
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div
        dir={isRtl ? 'rtl' : 'ltr'}
        className="max-w-6xl mx-auto px-4 sm:px-6 py-12 animate-pulse"
        aria-busy="true"
        aria-label={isRtl ? 'جاري تحميل الملف الشخصي' : 'Loading profile'}
      >
        <div className="h-36 rounded-3xl bg-slate-200 dark:bg-slate-800 mb-8" />
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-8">
          {[0, 1, 2].map((i) => (
            <div
              key={i}
              className="h-24 rounded-2xl bg-slate-200/80 dark:bg-slate-800/80"
            />
          ))}
        </div>
        <div className="grid md:grid-cols-3 gap-8">
          <div className="h-72 rounded-2xl bg-slate-200/70 dark:bg-slate-800/70" />
          <div className="md:col-span-2 h-96 rounded-2xl bg-slate-200/70 dark:bg-slate-800/70" />
        </div>
      </div>
    );
  }

  if (!auth.currentUser || !profile) {
    return (
      <div
        dir={isRtl ? 'rtl' : 'ltr'}
        className="max-w-lg mx-auto px-4 py-20 text-center animate-fade-in"
      >
        <div className="w-16 h-16 mx-auto mb-5 rounded-3xl bg-brand-50 dark:bg-brand-950/60 border border-brand-100 dark:border-brand-900 flex items-center justify-center text-brand-600 dark:text-brand-300">
          <UserCheck size={30} aria-hidden="true" />
        </div>
        <h2 className="text-2xl font-heading font-black text-slate-900 dark:text-white mb-3">
          {isRtl ? 'يرجى تسجيل الدخول' : 'Please Sign In'}
        </h2>
        <p className="text-sm text-slate-500 dark:text-slate-400 mb-8 leading-relaxed">
          {isRtl
            ? 'يجب تسجيل الدخول لعرض الملف الشخصي وإدارة إعلاناتك ومفضلاتك.'
            : 'You must be signed in to view your profile, listings, and saved favorites.'}
        </p>
        <BrandButton onClick={onLogin} variant="primary">
          {isRtl ? 'تسجيل الدخول' : 'Sign In'}
        </BrandButton>
      </div>
    );
  }

  const avatarInitial =
    (profile.name || profile.email || 'H').trim().charAt(0).toUpperCase() || 'H';

  return (
    <div
      dir={isRtl ? 'rtl' : 'ltr'}
      className="max-w-6xl mx-auto px-4 sm:px-6 py-10 sm:py-12 animate-fade-in transition-colors duration-500"
    >
      {/* Top Action Header */}
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center mb-6 gap-4">
        <div className="text-start">
          <h1 className="text-2xl sm:text-3xl font-heading font-black text-slate-900 dark:text-white tracking-tight">
            {isRtl ? 'الملف الشخصي' : 'Personal Profile'}
          </h1>
          <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">
            {isRtl
              ? 'أدر بيانات حسابك، عقاراتك المفضلة، إعلاناتك، وطلبات الشراء.'
              : 'Manage your account details, saved properties, posted listings, and purchase requests.'}
          </p>
        </div>

        <div className="flex items-center gap-2.5 flex-wrap">
          {onAddListing && (
            <BrandButton
              onClick={onAddListing}
              variant="accent"
              className="px-4 py-2.5 text-xs sm:text-sm"
            >
              <PlusCircle size={16} aria-hidden="true" />
              <span>{isRtl ? 'أضف عقار جديد' : 'Add New Listing'}</span>
            </BrandButton>
          )}

          {isPrivilegedAdmin && onOpenAdmin && (
            <BrandButton
              onClick={onOpenAdmin}
              variant="primary"
              className="px-4 py-2.5 text-xs sm:text-sm"
            >
              <Shield size={16} aria-hidden="true" />
              <span>{isRtl ? 'لوحة الإدارة' : 'Admin OS'}</span>
            </BrandButton>
          )}

          {!isEditing ? (
            <BrandButton
              onClick={() => setIsEditing(true)}
              variant="outline"
              className="px-4 py-2.5 text-xs sm:text-sm dark:bg-slate-900 dark:border-slate-700 dark:text-slate-200"
            >
              <Edit2 size={15} aria-hidden="true" />
              <span>{isRtl ? 'تعديل البيانات' : 'Edit Profile'}</span>
            </BrandButton>
          ) : (
            <>
              <BrandButton
                onClick={() => {
                  setIsEditing(false);
                  setEditForm(profile);
                }}
                variant="outline"
                className="px-4 py-2.5 text-xs sm:text-sm dark:bg-slate-900 dark:border-slate-700 dark:text-slate-200"
              >
                {isRtl ? 'إلغاء' : 'Cancel'}
              </BrandButton>
              <BrandButton
                onClick={handleSave}
                disabled={saving}
                variant="primary"
                className="px-4 py-2.5 text-xs sm:text-sm"
              >
                {saving ? (
                  <Loader2 size={15} className="animate-spin" aria-hidden="true" />
                ) : (
                  <Save size={15} aria-hidden="true" />
                )}
                <span>{isRtl ? 'حفظ' : 'Save'}</span>
              </BrandButton>
            </>
          )}

          <button
            type="button"
            onClick={onLogout}
            className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl text-xs sm:text-sm font-bold text-rose-600 dark:text-rose-400 hover:bg-rose-50 dark:hover:bg-rose-950/40 border border-rose-200 dark:border-rose-900/60 transition-colors cursor-pointer focus:outline-none focus:ring-2 focus:ring-rose-500"
          >
            <LogOut size={15} aria-hidden="true" />
            <span>{isRtl ? 'تسجيل الخروج' : 'Sign Out'}</span>
          </button>
        </div>
      </div>

      {/* Portfolio KPI Banner */}
      <section
        aria-label={isRtl ? 'ملخص نشاطك العقاري' : 'Portfolio summary'}
        className="relative overflow-hidden rounded-3xl bg-gradient-to-br from-brand-700 via-brand-600 to-brand-900 text-white p-5 sm:p-6 mb-8 shadow-xl shadow-brand-900/10 border border-brand-500/30"
      >
        <div
          aria-hidden="true"
          className="pointer-events-none absolute -top-16 -end-16 w-64 h-64 rounded-full bg-accent-500/20 blur-3xl"
        />
        <div className="relative z-10 grid grid-cols-1 sm:grid-cols-3 gap-4">
          <div className="rounded-2xl bg-white/10 border border-white/15 p-4 backdrop-blur-sm flex items-center gap-4">
            <div className="w-12 h-12 rounded-xl bg-accent-500/20 border border-accent-400/30 text-accent-300 flex items-center justify-center shrink-0">
              <Building2 size={22} aria-hidden="true" />
            </div>
            <div className="text-start">
              <p className="text-xs font-semibold text-brand-100/80">
                {isRtl ? 'إعلانات منشورة' : 'Listings Posted'}
              </p>
              <p className="text-2xl font-black tabular-nums text-white mt-0.5">
                {myListings.length}
              </p>
            </div>
          </div>

          <div className="rounded-2xl bg-white/10 border border-white/15 p-4 backdrop-blur-sm flex items-center gap-4">
            <div className="w-12 h-12 rounded-xl bg-rose-500/20 border border-rose-400/30 text-rose-300 flex items-center justify-center shrink-0">
              <Heart size={22} aria-hidden="true" />
            </div>
            <div className="text-start">
              <p className="text-xs font-semibold text-brand-100/80">
                {isRtl ? 'عقارات محفوظة' : 'Saved Favorites'}
              </p>
              <p className="text-2xl font-black tabular-nums text-white mt-0.5">
                {favoriteProperties.length}
              </p>
            </div>
          </div>

          <div className="rounded-2xl bg-white/10 border border-white/15 p-4 backdrop-blur-sm flex items-center gap-4">
            <div className="w-12 h-12 rounded-xl bg-emerald-500/20 border border-emerald-400/30 text-emerald-300 flex items-center justify-center shrink-0">
              <FileText size={22} aria-hidden="true" />
            </div>
            <div className="text-start">
              <p className="text-xs font-semibold text-brand-100/80">
                {isRtl ? 'طلبات نشطة' : 'Active Requests'}
              </p>
              <p className="text-2xl font-black tabular-nums text-white mt-0.5">
                {inProgressPurchases.length}
              </p>
            </div>
          </div>
        </div>
      </section>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8 items-start">
        {/* Left Sidebar: Account Card + Preferences Card */}
        <aside className="lg:col-span-1 space-y-6">
          <div className="bg-white dark:bg-slate-900 p-6 rounded-3xl border border-slate-200/90 dark:border-slate-800 shadow-sm text-start">
            <div className="flex items-center gap-4 mb-5">
              <div className="w-18 h-18 bg-gradient-to-br from-brand-600 to-brand-800 text-white rounded-2xl flex items-center justify-center text-2xl font-black shadow-md relative shrink-0">
                {avatarInitial}
                {isPrivilegedAdmin && (
                  <div
                    className="absolute -bottom-1.5 -end-1.5 bg-accent-500 text-white p-1.5 rounded-lg border-2 border-white dark:border-slate-900 shadow-sm"
                    title={isRtl ? 'مسؤول النظام' : 'Admin'}
                  >
                    <Shield size={12} aria-hidden="true" />
                  </div>
                )}
              </div>
              {!isEditing && (
                <div className="min-w-0">
                  <h2 className="text-lg font-heading font-extrabold text-slate-900 dark:text-white truncate">
                    {profile.name || (isRtl ? 'مستخدم حتتي' : 'HETTETY Member')}
                  </h2>
                  <p className="text-xs text-slate-500 dark:text-slate-400 truncate mt-0.5 flex items-center gap-1">
                    <Mail size={12} aria-hidden="true" />
                    <span className="truncate">{profile.email}</span>
                  </p>
                  {isPrivilegedAdmin && (
                    <span className="inline-flex items-center gap-1 mt-2 px-2.5 py-0.5 rounded-full bg-brand-50 dark:bg-brand-900/40 text-brand-700 dark:text-brand-300 text-[11px] font-bold">
                      <Shield size={11} aria-hidden="true" />
                      <span>{isRtl ? 'مسؤول' : 'Admin'}</span>
                    </span>
                  )}
                </div>
              )}
            </div>

            {isEditing ? (
              <div className="space-y-4">
                <div>
                  <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-1.5">
                    {isRtl ? 'الاسم' : 'Name'}
                  </label>
                  <input
                    type="text"
                    value={editForm.name || ''}
                    onChange={(e) =>
                      setEditForm({ ...editForm, name: e.target.value })
                    }
                    className="w-full px-3.5 py-2.5 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl focus:ring-2 focus:ring-brand-500 focus:border-brand-500 outline-none text-sm text-slate-900 dark:text-white"
                  />
                </div>
                <div>
                  <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-1.5">
                    {isRtl ? 'البريد الإلكتروني' : 'Email'}
                  </label>
                  <input
                    type="email"
                    value={editForm.email || ''}
                    onChange={(e) =>
                      setEditForm({ ...editForm, email: e.target.value })
                    }
                    className="w-full px-3.5 py-2.5 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl focus:ring-2 focus:ring-brand-500 focus:border-brand-500 outline-none text-sm text-slate-900 dark:text-white"
                  />
                </div>
                <div>
                  <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-1.5">
                    {isRtl ? 'رقم الهاتف' : 'Phone'}
                  </label>
                  <input
                    type="tel"
                    value={editForm.phone || ''}
                    onChange={(e) =>
                      setEditForm({ ...editForm, phone: e.target.value })
                    }
                    className="w-full px-3.5 py-2.5 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl focus:ring-2 focus:ring-brand-500 focus:border-brand-500 outline-none text-sm text-slate-900 dark:text-white"
                  />
                </div>
              </div>
            ) : (
              <div className="space-y-3 pt-4 border-t border-slate-100 dark:border-slate-800">
                <div className="flex items-center gap-3 text-sm text-slate-600 dark:text-slate-300">
                  <div className="w-8 h-8 rounded-lg bg-slate-100 dark:bg-slate-800 flex items-center justify-center text-brand-600 dark:text-brand-400 shrink-0">
                    <Phone size={15} aria-hidden="true" />
                  </div>
                  <span className="truncate font-medium">
                    {profile.phone ||
                      (isRtl ? 'لم يُضف رقم هاتف بعد' : 'No phone added yet')}
                  </span>
                </div>
              </div>
            )}
          </div>

          {/* Preferences Card — Full Dark & Light Mode Parity */}
          <div className="bg-brand-50 dark:bg-brand-950/40 border border-brand-100 dark:border-brand-900/60 text-brand-900 dark:text-brand-200 p-6 rounded-3xl text-start">
            <h3 className="font-heading font-extrabold text-brand-900 dark:text-brand-200 flex items-center gap-2 mb-3 text-base">
              <Target size={18} className="text-accent-500" aria-hidden="true" />
              <span>{isRtl ? 'تفضيلاتك' : 'Your Preferences'}</span>
            </h3>
            {isEditing ? (
              <textarea
                value={editForm.preferences || ''}
                onChange={(e) =>
                  setEditForm({ ...editForm, preferences: e.target.value })
                }
                placeholder={
                  isRtl
                    ? 'مثال: شقة 3 غرف في التجمع الخامس أو الشيخ زايد...'
                    : 'e.g. 3-bedroom apartment in New Cairo or Sheikh Zayed...'
                }
                className="w-full px-3.5 py-2.5 bg-white dark:bg-slate-900 border border-brand-200 dark:border-brand-800 rounded-xl focus:ring-2 focus:ring-brand-500 focus:border-brand-500 outline-none min-h-[110px] text-sm text-slate-900 dark:text-slate-100 placeholder:text-slate-400"
              />
            ) : (
              <p className="text-sm text-brand-700 dark:text-brand-200/85 leading-relaxed">
                {profile.preferences ||
                  (isRtl
                    ? 'أضف تفضيلاتك العقارية من زر تعديل البيانات لحفظ نطاق بحثك المفضل.'
                    : 'Add your search preferences via Edit Profile to keep your target areas and unit specs handy.')}
              </p>
            )}
          </div>
        </aside>

        {/* Main Portfolio Tabs Column */}
        <div className="lg:col-span-2">
          {/* Sub Navigation */}
          <div className="flex gap-2 sm:gap-5 mb-8 border-b border-slate-200 dark:border-slate-800 overflow-x-auto no-scrollbar">
            <button
              type="button"
              onClick={() => setActiveSubTab('purchases')}
              className={`pb-4 px-2 font-bold text-sm uppercase tracking-wider transition-all relative whitespace-nowrap cursor-pointer ${
                activeSubTab === 'purchases'
                  ? 'text-brand-600 dark:text-accent-400'
                  : 'text-slate-400 hover:text-slate-700 dark:hover:text-slate-200'
              }`}
            >
              {t.prof_purchases}
              {activeSubTab === 'purchases' && (
                <motion.div
                  layoutId="profile-subtab"
                  className="absolute bottom-0 inset-x-0 h-1 bg-brand-600 dark:bg-accent-500 rounded-full"
                />
              )}
            </button>

            <button
              type="button"
              onClick={() => setActiveSubTab('favorites')}
              className={`pb-4 px-2 font-bold text-sm uppercase tracking-wider transition-all relative whitespace-nowrap cursor-pointer ${
                activeSubTab === 'favorites'
                  ? 'text-brand-600 dark:text-accent-400'
                  : 'text-slate-400 hover:text-slate-700 dark:hover:text-slate-200'
              }`}
            >
              {t.prof_favorites}
              <span className="ms-1.5 text-xs font-semibold text-slate-400 tabular-nums">
                ({favoriteProperties.length})
              </span>
              {activeSubTab === 'favorites' && (
                <motion.div
                  layoutId="profile-subtab"
                  className="absolute bottom-0 inset-x-0 h-1 bg-brand-600 dark:bg-accent-500 rounded-full"
                />
              )}
            </button>

            <button
              type="button"
              onClick={() => setActiveSubTab('listings')}
              className={`pb-4 px-2 font-bold text-sm uppercase tracking-wider transition-all relative whitespace-nowrap cursor-pointer ${
                activeSubTab === 'listings'
                  ? 'text-brand-600 dark:text-accent-400'
                  : 'text-slate-400 hover:text-slate-700 dark:hover:text-slate-200'
              }`}
            >
              {t.prof_listings}
              <span className="ms-1.5 text-xs font-semibold text-slate-400 tabular-nums">
                ({myListings.length})
              </span>
              {activeSubTab === 'listings' && (
                <motion.div
                  layoutId="profile-subtab"
                  className="absolute bottom-0 inset-x-0 h-1 bg-brand-600 dark:bg-accent-500 rounded-full"
                />
              )}
            </button>
          </div>

          {/* Purchases Tab */}
          {activeSubTab === 'purchases' && (
            <div className="space-y-10 animate-fade-in">
              {/* Completed Section */}
              <section>
                <h2 className="text-lg sm:text-xl font-heading font-extrabold text-slate-900 dark:text-white mb-5 flex items-center gap-2.5">
                  <div className="p-2 bg-emerald-50 dark:bg-emerald-950/50 text-emerald-600 dark:text-emerald-400 rounded-xl">
                    <CheckCircle size={18} aria-hidden="true" />
                  </div>
                  <span>{t.prof_completed}</span>
                  <span className="text-sm font-normal text-slate-400 tabular-nums">
                    ({completedPurchases.length})
                  </span>
                </h2>
                {completedPurchases.length > 0 ? (
                  <div className="space-y-4">
                    {completedPurchases.map((p) => (
                      <div
                        key={p.id}
                        className="bg-white dark:bg-slate-900 p-5 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-sm flex flex-col sm:flex-row gap-5 items-start sm:items-center"
                      >
                        <PropertyImage
                          src={p.property?.imageUrl}
                          alt={
                            p.property?.title ||
                            (isRtl ? 'صورة العقار' : 'Property image')
                          }
                          className="w-full sm:w-32 aspect-video sm:aspect-auto sm:h-24 rounded-xl object-cover shrink-0"
                        />
                        <div className="flex-1 min-w-0 text-start w-full">
                          <div className="flex justify-between items-start gap-3 mb-2">
                            <h4 className="font-bold text-slate-900 dark:text-white text-base sm:text-lg truncate">
                              {p.property?.title ||
                                (isRtl ? 'وحدة عقارية' : 'Property unit')}
                            </h4>
                            <span className="px-3 py-1 bg-emerald-100 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-400 text-[10px] font-black rounded-lg uppercase tracking-wider shrink-0">
                              {p.status}
                            </span>
                          </div>
                          {p.property?.location && (
                            <p className="text-sm text-slate-500 dark:text-slate-400 flex items-center gap-1.5 mb-3">
                              <MapPin size={14} className="text-accent-500 shrink-0" aria-hidden="true" />
                              <span className="truncate">{p.property.location}</span>
                            </p>
                          )}
                          <div className="flex justify-between items-center text-sm gap-2">
                            <span className="font-extrabold text-brand-700 dark:text-accent-400 tabular-nums">
                              {p.property
                                ? priceLabel(p.property, isRtl)
                                : '—'}
                            </span>
                            <span className="text-slate-400 text-xs flex items-center gap-1 tabular-nums">
                              <Clock size={12} aria-hidden="true" />
                              <span>{p.purchaseDate}</span>
                            </span>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="bg-slate-50 dark:bg-slate-900/60 p-10 rounded-2xl border border-dashed border-slate-200 dark:border-slate-800 text-center">
                    <History
                      className="mx-auto text-slate-300 dark:text-slate-700 mb-3"
                      size={38}
                      aria-hidden="true"
                    />
                    <p className="text-slate-600 dark:text-slate-400 font-semibold text-sm">
                      {isRtl
                        ? 'لا توجد مشتريات مكتملة بعد.'
                        : 'No completed purchases yet.'}
                    </p>
                  </div>
                )}
              </section>

              {/* In Progress Section */}
              <section>
                <h2 className="text-lg sm:text-xl font-heading font-extrabold text-slate-900 dark:text-white mb-5 flex items-center gap-2.5">
                  <div className="p-2 bg-amber-50 dark:bg-amber-950/50 text-amber-600 dark:text-amber-400 rounded-xl">
                    <RefreshCw size={18} aria-hidden="true" />
                  </div>
                  <span>{t.prof_in_progress}</span>
                  <span className="text-sm font-normal text-slate-400 tabular-nums">
                    ({inProgressPurchases.length})
                  </span>
                </h2>
                {inProgressPurchases.length > 0 ? (
                  <div className="space-y-4">
                    {inProgressPurchases.map((p) => (
                      <div
                        key={p.id}
                        className="bg-white dark:bg-slate-900 p-5 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-sm flex flex-col sm:flex-row gap-5 items-start sm:items-center relative overflow-hidden"
                      >
                        <div
                          aria-hidden="true"
                          className="absolute top-0 start-0 w-1 h-full bg-accent-500"
                        />
                        <PropertyImage
                          src={p.property?.imageUrl}
                          alt={
                            p.property?.title ||
                            (isRtl ? 'صورة العقار' : 'Property image')
                          }
                          className="w-full sm:w-32 aspect-video sm:aspect-auto sm:h-24 rounded-xl object-cover shrink-0"
                        />
                        <div className="flex-1 min-w-0 text-start w-full">
                          <div className="flex justify-between items-start gap-3 mb-2">
                            <h4 className="font-bold text-slate-900 dark:text-white text-base sm:text-lg truncate">
                              {p.property?.title ||
                                (isRtl ? 'وحدة عقارية' : 'Property unit')}
                            </h4>
                            <span className="px-3 py-1 bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-400 text-[10px] font-black rounded-lg uppercase tracking-wider shrink-0">
                              {p.status}
                            </span>
                          </div>
                          {p.property?.location && (
                            <p className="text-sm text-slate-500 dark:text-slate-400 flex items-center gap-1.5 mb-3">
                              <MapPin size={14} className="text-accent-500 shrink-0" aria-hidden="true" />
                              <span className="truncate">{p.property.location}</span>
                            </p>
                          )}
                          <div className="flex justify-between items-center text-sm gap-2">
                            <span className="font-extrabold text-brand-700 dark:text-accent-400 tabular-nums">
                              {p.property
                                ? priceLabel(p.property, isRtl)
                                : '—'}
                            </span>
                            <span className="text-slate-400 text-xs tabular-nums">
                              {p.purchaseDate}
                            </span>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="bg-slate-50 dark:bg-slate-900/60 p-10 rounded-2xl border border-dashed border-slate-200 dark:border-slate-800 text-center">
                    <Clock
                      className="mx-auto text-slate-300 dark:text-slate-700 mb-3"
                      size={38}
                      aria-hidden="true"
                    />
                    <p className="text-slate-600 dark:text-slate-400 font-semibold text-sm">
                      {isRtl
                        ? 'لا توجد طلبات قيد التنفيذ.'
                        : 'No in-progress requests.'}
                    </p>
                  </div>
                )}
              </section>
            </div>
          )}

          {/* Favorites Tab — Rendered with ReshapedPropertyCard */}
          {activeSubTab === 'favorites' && (
            <div className="animate-fade-in">
              <h2 className="text-lg sm:text-xl font-heading font-extrabold text-slate-900 dark:text-white mb-6 flex items-center gap-2.5">
                <div className="p-2 bg-rose-50 dark:bg-rose-950/50 text-rose-600 dark:text-rose-400 rounded-xl">
                  <Heart size={18} fill="currentColor" aria-hidden="true" />
                </div>
                <span>{t.prof_fav_title}</span>
                <span className="text-sm font-normal text-slate-400 tabular-nums">
                  ({favoriteProperties.length})
                </span>
              </h2>
              {favoriteProperties.length > 0 ? (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  {favoriteProperties.map((p) => (
                    <ReshapedPropertyCard
                      key={p.id}
                      property={p}
                      onView3D={() => open3D(p.id)}
                      onToggleFavorite={() => onToggleFavorite(p.id)}
                      isFavorited={true}
                      onClick={() => onOpenProperty(p.id)}
                      t={t}
                      isRtl={isRtl}
                    />
                  ))}
                </div>
              ) : (
                <EmptyState
                  variant="favorites"
                  title={t.prof_empty_fav}
                  description={t.prof_empty_fav_desc}
                  actionLabel={t.prof_start_browsing}
                  onAction={onBrowse}
                  isRtl={isRtl}
                />
              )}
            </div>
          )}

          {/* My Listings Tab */}
          {activeSubTab === 'listings' && (
            <div className="animate-fade-in">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-2">
                <h2 className="text-lg sm:text-xl font-heading font-extrabold text-slate-900 dark:text-white flex items-center gap-2.5">
                  <div className="p-2 bg-brand-50 dark:bg-brand-900/40 text-brand-600 dark:text-brand-300 rounded-xl">
                    <Building2 size={18} aria-hidden="true" />
                  </div>
                  <span>{t.prof_listings}</span>
                  <span className="text-sm font-normal text-slate-400 tabular-nums">
                    ({myListings.length})
                  </span>
                </h2>
                {onAddListing && (
                  <button
                    type="button"
                    onClick={onAddListing}
                    className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-accent-500 hover:bg-accent-600 text-white text-xs font-bold shadow-sm transition-colors cursor-pointer self-start sm:self-auto"
                  >
                    <PlusCircle size={14} aria-hidden="true" />
                    <span>{isRtl ? 'إعلان جديد' : 'Post a listing'}</span>
                  </button>
                )}
              </div>

              <p className="text-xs text-slate-500 dark:text-slate-400 mb-6 text-start leading-relaxed">
                {t.listing_draft_note}
              </p>

              {listingError && (
                <div
                  role="alert"
                  className="mb-4 p-3.5 rounded-2xl bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-800 text-rose-700 dark:text-rose-300 text-sm font-semibold flex items-center gap-2.5 text-start"
                >
                  <AlertCircle size={17} className="shrink-0" aria-hidden="true" />
                  <span>{listingError}</span>
                </div>
              )}

              {myListings.length === 0 ? (
                <EmptyState
                  variant="listings"
                  title={t.listing_none}
                  description={t.listing_draft_note}
                  actionLabel={
                    onAddListing
                      ? isRtl
                        ? 'أضف إعلانك الأول'
                        : 'Post Your First Listing'
                      : t.prof_start_browsing
                  }
                  onAction={onAddListing || onBrowse}
                  actionIcon={
                    onAddListing ? (
                      <PlusCircle size={18} aria-hidden="true" />
                    ) : undefined
                  }
                  secondaryActionLabel={
                    onAddListing ? t.prof_start_browsing : undefined
                  }
                  onSecondaryAction={onAddListing ? onBrowse : undefined}
                  isRtl={isRtl}
                />
              ) : (
                <div className="space-y-4">
                  {myListings.map((p) => {
                    const state = p.listingState || 'Live';
                    const rev = listingReviewInfo(p, t);
                    const stateLabel =
                      state === 'Draft'
                        ? t.listing_state_draft
                        : state === 'Removed'
                          ? t.listing_state_removed
                          : t.listing_state_live;
                    const busy = listingBusy === p.id;

                    return (
                      <article
                        key={p.id}
                        className="bg-white dark:bg-slate-900 p-4 sm:p-5 rounded-2xl border border-slate-200/90 dark:border-slate-800 shadow-sm hover:shadow-md transition-all"
                      >
                        <div className="flex flex-col sm:flex-row gap-4">
                          <button
                            type="button"
                            onClick={() => onOpenProperty(p.id)}
                            className="shrink-0 cursor-pointer text-start focus:outline-none focus:ring-2 focus:ring-brand-500 rounded-xl overflow-hidden"
                          >
                            <PropertyImage
                              src={p.imageUrl}
                              alt={p.title}
                              iconSize={22}
                              className="w-full sm:w-32 h-28 sm:h-24 rounded-xl object-cover"
                            />
                          </button>

                          <div className="flex-1 min-w-0 text-start">
                            <button
                              type="button"
                              onClick={() => onOpenProperty(p.id)}
                              className="font-heading font-extrabold text-slate-900 dark:text-white hover:text-accent-600 dark:hover:text-accent-400 cursor-pointer text-start truncate block w-full text-base transition-colors"
                            >
                              {p.title}
                            </button>
                            <p className="text-sm text-slate-500 dark:text-slate-400 mt-0.5 truncate">
                              <span className="font-bold text-brand-700 dark:text-accent-400 tabular-nums">
                                {priceLabel(p, isRtl)}
                              </span>{' '}
                              • {p.location}
                            </p>

                            <div className="flex items-center gap-2 mt-2.5 flex-wrap">
                              <span
                                className={`px-2.5 py-0.5 rounded-full text-[11px] font-bold ${
                                  state === 'Live'
                                    ? 'bg-emerald-100 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-400'
                                    : 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300'
                                }`}
                              >
                                {stateLabel}
                              </span>
                              <span
                                className={`px-2.5 py-0.5 rounded-full text-[11px] font-bold ${rev.chip}`}
                              >
                                {rev.label}
                              </span>
                              {p.rejectedAt &&
                                p.verificationStatus !== 'Verified' && (
                                  <span className="px-2.5 py-0.5 rounded-full text-[11px] font-bold bg-amber-100 dark:bg-amber-900/30 text-amber-800 dark:text-amber-300">
                                    {isRtl
                                      ? 'مخفي لحد المراجعة'
                                      : 'Held until reviewed'}
                                  </span>
                                )}
                            </div>

                            {p.reviewNote && (
                              <p className="mt-2.5 p-2.5 rounded-xl bg-rose-50/70 dark:bg-rose-950/30 border border-rose-200/60 dark:border-rose-900/50 text-xs text-rose-700 dark:text-rose-300 leading-relaxed">
                                <strong className="font-extrabold">
                                  {t.doc_review_note}:
                                </strong>{' '}
                                {p.reviewNote}
                              </p>
                            )}
                          </div>

                          <div className="flex sm:flex-col gap-2 shrink-0 justify-end sm:justify-start">
                            <button
                              type="button"
                              onClick={() => onEditListing?.(p.id)}
                              disabled={busy}
                              className="px-3.5 py-2 rounded-xl text-xs font-bold bg-brand-50 dark:bg-brand-900/30 text-brand-700 dark:text-brand-300 hover:bg-brand-600 hover:text-white transition-all cursor-pointer disabled:opacity-50 focus:outline-none focus:ring-2 focus:ring-brand-500"
                            >
                              {t.listing_edit}
                            </button>
                            <button
                              type="button"
                              onClick={() =>
                                setListingState(
                                  p.id,
                                  state === 'Live' ? 'Removed' : 'Live'
                                )
                              }
                              disabled={busy}
                              className="px-3.5 py-2 rounded-xl text-xs font-bold bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 hover:bg-slate-700 hover:text-white transition-all cursor-pointer disabled:opacity-50 focus:outline-none focus:ring-2 focus:ring-slate-500"
                            >
                              {state === 'Live'
                                ? t.listing_unpublish
                                : t.listing_publish}
                            </button>
                            <button
                              type="button"
                              onClick={() => deleteListing(p)}
                              disabled={busy}
                              className="px-3.5 py-2 rounded-xl text-xs font-bold bg-rose-50 dark:bg-rose-950/40 text-rose-700 dark:text-rose-400 hover:bg-rose-600 hover:text-white transition-all cursor-pointer disabled:opacity-50 focus:outline-none focus:ring-2 focus:ring-rose-500"
                            >
                              {t.listing_delete}
                            </button>
                          </div>
                        </div>
                      </article>
                    );
                  })}
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default ProfilePage;
