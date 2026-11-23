/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import {
  Building2,
  MapPin,
  ArrowRight,
  ArrowLeft,
  Loader2,
  PlusCircle,
  Lock as LockIcon,
} from 'lucide-react';
import { AddListingPage } from './components/add-listing-page';
import { TRANSLATIONS, SUPER_ADMIN_EMAILS } from './constants';
import { Property, Page, Notification } from './types';
import {
  auth,
  db,
  signOut,
  onAuthStateChanged,
  doc,
  getDoc,
  setDoc,
  collection,
  getDocs,
  query,
  where,
  onSnapshot,
  writeBatch,
  addDoc,
  updateDoc,
} from './firebase';
import AboutPage from './components/AboutPage';
import { BuyPropertyPage, VerificationPage, Tours3DPage } from './components/ServicePages';
import TermsPage from './components/TermsPage';
import PrivacyPage from './components/PrivacyPage';
import CookiePolicyPage from './components/CookiePolicyPage';
import CookieConsent from './components/CookieConsent';
import PremiumHero from './components/PremiumHero';
import RealEstateAdvisor from './components/RealEstateAdvisor';
import { lazyWithReload } from './lib/lazyWithReload';
import { LoadErrorBoundary } from './components/LoadErrorBoundary';
import { parseNaturalLanguageQuery } from './services/search/query-parser';
import { rankAndFilterProperties } from './services/search/ranking-engine';
import {
  DEFAULT_PROPERTY_FILTER_CRITERIA,
  PropertyDisplayMode,
  PropertyFilterCriteria,
} from './core/domain/entities';
import {
  filterAndSortProperties,
  extractDistrictFacets,
  countActiveFilters,
} from './core/use-cases/FilterPropertiesUseCase';
import { seoManager, buildPageSeoMetadata } from './infrastructure/seo/SeoManager';

// Shared Primitives & Pure Formatters (SRP)
import { BrandButton } from './shared/ui/BrandButton';
import { PropertyImage } from './shared/ui/PropertyImage';
import { SplashScreen } from './shared/ui/SplashScreen';
import {
  safeTourUrl,
  priceLabel,
  priceProvenance,
  tourKind,
} from './shared/utils/propertyFormatters';

// Modular Feature Pages & Shell Components (Clean Architecture)
import { SiteNavbar } from './features/layout/SiteNavbar';
import { SiteFooter } from './features/layout/SiteFooter';
import {
  HomeFeaturesSection,
  EgyptCorridorsSection,
  HomeInstallmentEstimatorSection,
  HomeSpotlightBannerSection,
} from './features/home/HomeExperienceSections';
import { AdvancedFilterBar, SavedSearchItem } from './features/properties/components/AdvancedFilterBar';
import { ReshapedPropertyCard } from './features/properties/components/ReshapedPropertyCard';
import { PropertyComparisonDrawer } from './features/properties/components/PropertyComparisonDrawer';
import { InventoryEmptyState } from './features/properties/components/InventoryEmptyState';
import { PropertyDetailPage } from './features/properties/pages/PropertyDetailPage';
import { ProjectPage } from './features/properties/pages/ProjectPage';
import { Experience3DPage } from './features/experience3d/Experience3DPage';
import { SahelPage } from './features/sahel/SahelPage';
import { LegalCenterPage } from './features/legal/LegalCenterPage';
import { ProfilePage } from './features/profile/ProfilePage';
import { PaymentPage } from './features/checkout/PaymentPage';
import { AuthForm } from './features/auth/AuthForm';
import { ContactPage } from './features/contact/ContactPage';

// Re-export domain formatters preserved for external callers & test contracts
export { priceLabel, priceProvenance, tourKind };

// Lazy-loaded heavy modules: Three.js 3D Viewer & Standalone Enterprise Admin OS
const Property3DViewer = lazyWithReload(() => import('./components/Property3DViewer'), 'viewer3d');
const AdminPortalApp = lazyWithReload(
  () => import('./features/admin/AdminPortalApp').then((m) => ({ default: m.AdminPortalApp })),
  'admin-portal'
);

const Loading3DFallback: React.FC = () => (
  <div className="fixed inset-0 z-[70] bg-black flex items-center justify-center">
    <Loader2 className="w-10 h-10 text-brand-500 animate-spin" />
  </div>
);

const Viewer3D: React.FC<{
  property: Property | undefined;
  onClose: () => void;
  t: any;
  isRtl: boolean;
}> = ({ property, onClose, isRtl }) => {
  const images = property
    ? (property.images && property.images.length > 0 ? property.images : [property.imageUrl]).filter(Boolean)
    : [];

  return (
    <LoadErrorBoundary onClose={onClose} isRtl={isRtl}>
      <React.Suspense fallback={<Loading3DFallback />}>
        <Property3DViewer
          images={images}
          depthMaps={property?.depthMaps}
          panoramas={property?.panoramas}
          tourUrl={property?.digitalTwinUrl ? safeTourUrl(property.digitalTwinUrl) : null}
          threeDTour={property?.threeDTour}
          title={property?.title}
          onClose={onClose}
          isRtl={isRtl}
        />
      </React.Suspense>
    </LoadErrorBoundary>
  );
};

export default function App() {
  const [showSplash, setShowSplash] = useState(
    () => !import.meta.env.MODE?.includes('test') && (typeof process === 'undefined' || process.env.NODE_ENV !== 'test')
  );
  const [currentPage, setCurrentPage] = useState<Page>('home');
  const [isAdmin, setIsAdmin] = useState(false);
  const [isSuperAdmin, setIsSuperAdmin] = useState(false);
  const [selectedPropertyId, setSelectedPropertyId] = useState<string | null>(null);
  const [selectedProject, setSelectedProject] = useState<string | null>(null);
  const [editingPropertyId, setEditingPropertyId] = useState<string | null>(null);
  const [paymentProperty, setPaymentProperty] = useState<Property | null>(null);

  // Clean reset state: zero demo/fixture properties injected into live inventory.
  const [properties, setProperties] = useState<Property[]>([]);
  const [loadingProps, setLoadingProps] = useState(false);

  // Language & Theme
  const [lang, setLang] = useState<'en' | 'ar'>('en');
  const [isDarkMode, setIsDarkMode] = useState(false);
  const t = TRANSLATIONS[lang];
  const isRtl = lang === 'ar';

  // Navigation & UI Popovers
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [showNotifications, setShowNotifications] = useState(false);
  const [showProfileMenu, setShowProfileMenu] = useState(false);
  const [prefillSahel, setPrefillSahel] = useState(false);

  // Auth & User State
  const [isAuthReady, setIsAuthReady] = useState(false);
  const [userEmail, setUserEmail] = useState<string | null>(null);
  const [userName, setUserName] = useState<string | null>(null);
  const [userFavorites, setUserFavorites] = useState<string[]>([]);
  const [notifications, setNotifications] = useState<Notification[]>([]);

  // Discovery, Filtering & Comparison
  const [filterCriteria, setFilterCriteria] = useState<PropertyFilterCriteria>(DEFAULT_PROPERTY_FILTER_CRITERIA);
  const [displayMode, setDisplayMode] = useState<PropertyDisplayMode>('grid');
  const [isAiSearching, setIsAiSearching] = useState(false);
  const [compareIds, setCompareIds] = useState<string[]>([]);
  const [showCompare, setShowCompare] = useState(false);
  const [savedSearches, setSavedSearches] = useState<SavedSearchItem[]>(() => {
    try {
      return JSON.parse(localStorage.getItem('hettety_saved_searches') || '[]');
    } catch {
      return [];
    }
  });

  // Navigation history depth & per-route scroll restoration
  const navDepth = useRef(0);
  const scrollByHash = useRef<Record<string, number>>({});
  const returningViaHistory = useRef(false);

  useEffect(() => {
    const onPop = () => {
      returningViaHistory.current = true;
    };
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);

  const restoreScroll = (y: number) => {
    if (y <= 0) {
      window.scrollTo(0, 0);
      return;
    }
    let tries = 0;
    const settle = () => {
      window.scrollTo(0, y);
      if (++tries < 12 && Math.abs(window.scrollY - y) > 4) requestAnimationFrame(settle);
    };
    requestAnimationFrame(settle);
  };

  // Hash-based routing
  useEffect(() => {
    const handleHashChange = () => {
      const raw = window.location.hash.replace('#', '');
      const [page, param] = raw.split('/');
      if (page === 'property' && param) {
        setSelectedPropertyId(param);
        setCurrentPage('property');
      } else if (page === 'edit-listing' && param) {
        setEditingPropertyId(param);
        setCurrentPage('edit-listing');
      } else if (page === 'project' && param) {
        setSelectedProject(decodeURIComponent(param));
        setCurrentPage('project');
      } else if (page === 'admin') {
        setCurrentPage('manage-users');
      } else if (page) {
        setCurrentPage(page as Page);
      } else {
        setCurrentPage('home');
      }

      if (returningViaHistory.current) {
        returningViaHistory.current = false;
        restoreScroll(scrollByHash.current[window.location.hash] ?? 0);
      } else {
        window.scrollTo(0, 0);
      }
    };

    handleHashChange();
    window.addEventListener('hashchange', handleHashChange);
    return () => window.removeEventListener('hashchange', handleHashChange);
  }, []);

  // Close profile / notification dropdowns on outside click
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (!(e.target as HTMLElement).closest('[data-menu]')) {
        setShowProfileMenu(false);
        setShowNotifications(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  // Theme initialization & system preference listener
  useEffect(() => {
    let savedTheme: string | null = null;
    try {
      savedTheme = localStorage.getItem('theme');
    } catch {
      // Ignore storage errors in sandboxed iframes
    }
    const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');

    const applyTheme = (dark: boolean) => {
      if (dark) {
        document.documentElement.classList.add('dark');
        setIsDarkMode(true);
      } else {
        document.documentElement.classList.remove('dark');
        setIsDarkMode(false);
      }
    };

    if (savedTheme === 'dark') applyTheme(true);
    else if (savedTheme === 'light') applyTheme(false);
    else applyTheme(mediaQuery.matches);

    const handleChange = (e: MediaQueryListEvent) => {
      let currentStored: string | null = null;
      try {
        currentStored = localStorage.getItem('theme');
      } catch {
        // ignore
      }
      if (!currentStored) applyTheme(e.matches);
    };

    mediaQuery.addEventListener('change', handleChange);
    return () => mediaQuery.removeEventListener('change', handleChange);
  }, []);

  const toggleDarkMode = () => {
    const newMode = !isDarkMode;
    setIsDarkMode(newMode);
    if (newMode) {
      document.documentElement.classList.add('dark');
      try {
        localStorage.setItem('theme', 'dark');
      } catch {
        // ignore
      }
    } else {
      document.documentElement.classList.remove('dark');
      try {
        localStorage.setItem('theme', 'light');
      } catch {
        // ignore
      }
    }
  };

  // Sync document root attributes with active language & direction
  useEffect(() => {
    document.documentElement.lang = lang;
    document.documentElement.dir = isRtl ? 'rtl' : 'ltr';
    if (isRtl) document.documentElement.classList.add('font-cairo');
    else document.documentElement.classList.remove('font-cairo');
  }, [lang, isRtl]);

  // Splash timeout
  useEffect(() => {
    const timer = setTimeout(() => setShowSplash(false), 3500);
    return () => clearTimeout(timer);
  }, []);

  // Neon Auth State & User Notifications Listener
  useEffect(() => {
    let unsubNotifications: (() => void) | null = null;

    const unsubscribe = onAuthStateChanged(auth, async (user) => {
      unsubNotifications?.();
      unsubNotifications = null;

      if (user) {
        setUserEmail(user.email);
        const isSuper = SUPER_ADMIN_EMAILS.includes((user.email || '').toLowerCase());
        setIsSuperAdmin(isSuper);

        try {
          const userDoc = await getDoc(doc(db, 'users', user.uid));
          if (userDoc.exists()) {
            const userData = userDoc.data();
            setIsAdmin(userData.role === 'admin' || userData.role === 'super_admin' || isSuper);
            setUserName(userData.name || user.displayName);
            setUserFavorites(userData.favorites || []);
            updateDoc(doc(db, 'users', user.uid), { lastLoginAt: new Date().toISOString() }).catch((err) =>
              console.warn('Could not record lastLoginAt:', err)
            );
          } else {
            setIsAdmin(isSuper);
            setUserName(user.displayName);
            setUserFavorites([]);
          }
        } catch (error) {
          console.error('Error fetching user data:', error);
          setIsAdmin(isSuper);
          setUserName(user.displayName);
        }

        const q = query(collection(db, 'notifications'), where('userId', '==', user.uid));
        unsubNotifications = onSnapshot(
          q,
          (snapshot) => {
            const notifs = snapshot.docs.map((d) => ({ id: d.id, ...d.data() } as Notification));
            setNotifications(notifs.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime()));
          },
          (error) => {
            console.error('Error fetching notifications:', error);
          }
        );
      } else {
        setUserEmail(null);
        setUserName(null);
        setIsAdmin(false);
        setIsSuperAdmin(false);
        setNotifications([]);
      }
      setIsAuthReady(true);
    });

    return () => {
      unsubscribe();
      unsubNotifications?.();
    };
  }, []);

  // Navigation helpers
  const pushHash = (hash: string) => {
    scrollByHash.current[window.location.hash] = window.scrollY;
    navDepth.current += 1;
    window.location.hash = hash;
  };

  const goBack = () => {
    if (navDepth.current > 0) {
      navDepth.current -= 1;
      returningViaHistory.current = true;
      window.history.back();
    } else {
      handleNav('listings');
    }
  };

  const handleNav = (page: Page) => {
    pushHash(page);
    setCurrentPage(page);
    setMobileMenuOpen(false);
    setShowNotifications(false);
    setShowProfileMenu(false);
  };

  const open3D = (id: string) => {
    setSelectedPropertyId(id);
    handleNav('3d');
  };

  const openProperty = (id: string) => {
    setSelectedPropertyId(id);
    pushHash(`property/${id}`);
    setCurrentPage('property');
    setMobileMenuOpen(false);
  };

  const openEditListing = (id: string) => {
    setEditingPropertyId(id);
    pushHash(`edit-listing/${id}`);
    setCurrentPage('edit-listing');
  };

  const openProject = (name: string) => {
    setSelectedProject(name);
    pushHash(`project/${encodeURIComponent(name)}`);
    setCurrentPage('project');
    setMobileMenuOpen(false);
  };

  // Hero / Corridor quick navigation into filtered listings
  const navigateToFilteredListings = (queryText: string) => {
    setFilterCriteria({
      ...DEFAULT_PROPERTY_FILTER_CRITERIA,
      query: queryText.trim(),
      aiFilteredIds: null,
    });
    setDisplayMode('grid');
    handleNav('listings');
  };

  // Filter & saved searches actions
  const resetFilterCriteria = useCallback(() => {
    setFilterCriteria(DEFAULT_PROPERTY_FILTER_CRITERIA);
  }, []);

  const saveCurrentSearch = () => {
    const s: SavedSearchItem = {
      id:
        `${filterCriteria.minPrice}-${filterCriteria.maxPrice}-${filterCriteria.type}-${filterCriteria.sortBy}-${filterCriteria.query}`.slice(
          0,
          60
        ) || 'search',
      q: filterCriteria.query,
      minPrice: filterCriteria.minPrice,
      maxPrice: filterCriteria.maxPrice,
      typeFilter: filterCriteria.type,
      sortBy: filterCriteria.sortBy,
      criteria: { ...filterCriteria, aiFilteredIds: null },
    };
    const next = [s, ...savedSearches.filter((x) => x.id !== s.id)].slice(0, 10);
    setSavedSearches(next);
    localStorage.setItem('hettety_saved_searches', JSON.stringify(next));
  };

  const applySavedSearch = (s: SavedSearchItem) => {
    setFilterCriteria({
      ...DEFAULT_PROPERTY_FILTER_CRITERIA,
      ...(s.criteria || {}),
      query: s.criteria?.query ?? s.q ?? '',
      minPrice: String(s.criteria?.minPrice ?? s.minPrice ?? ''),
      maxPrice: String(s.criteria?.maxPrice ?? s.maxPrice ?? ''),
      type: s.criteria?.type ?? s.typeFilter ?? 'all',
      sortBy: s.criteria?.sortBy ?? s.sortBy ?? 'default',
      aiFilteredIds: null,
    });
  };

  const removeSavedSearch = (id: string) => {
    const next = savedSearches.filter((x) => x.id !== id);
    setSavedSearches(next);
    localStorage.setItem('hettety_saved_searches', JSON.stringify(next));
  };

  const subscribeAlert = async () => {
    if (!auth.currentUser) {
      alert(isRtl ? 'سجّل الدخول عشان تفعّل التنبيهات.' : 'Sign in to enable email alerts.');
      return;
    }
    const email = auth.currentUser.email || '';
    if (!/.+@.+\..+/.test(email)) {
      alert(
        isRtl
          ? 'حسابك ملوش إيميل. سجّل دخول بإيميل عشان تفعّل التنبيهات.'
          : 'Your account has no email. Sign in with an email to enable alerts.'
      );
      return;
    }
    try {
      await addDoc(collection(db, 'alertSubscriptions'), {
        userId: auth.currentUser.uid,
        email,
        q: filterCriteria.query,
        minPrice: filterCriteria.minPrice === '' ? null : Number(filterCriteria.minPrice),
        maxPrice: filterCriteria.maxPrice === '' ? null : Number(filterCriteria.maxPrice),
        typeFilter: filterCriteria.type,
        createdAt: new Date().toISOString(),
      });
      alert(
        isRtl
          ? 'تم تفعيل التنبيهات ✅ هيوصلك إيميل لما يظهر عقار مطابق.'
          : "Alerts enabled ✅ you'll get an email when a matching listing appears."
      );
    } catch (e) {
      console.error('alert subscribe failed', e);
      alert(isRtl ? 'تعذّر تفعيل التنبيهات.' : 'Could not enable alerts.');
    }
  };

  const toggleCompare = (id: string) =>
    setCompareIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : prev.length >= 4 ? prev : [...prev, id]));

  const handleLogout = async () => {
    try {
      await signOut(auth);
      setUserFavorites([]);
      handleNav('home');
    } catch (error) {
      console.error('Logout error:', error);
    }
  };

  const handleMarkAllRead = async () => {
    const unread = notifications.filter((n) => !n.read);
    if (unread.length === 0) return;
    setNotifications((prev) => prev.map((n) => ({ ...n, read: true })));
    await Promise.all(
      unread.map((n) =>
        updateDoc(doc(db, 'notifications', n.id), { read: true }).catch(() => undefined)
      )
    );
  };

  const toggleFavorite = async (propertyId: string) => {
    if (!auth.currentUser) {
      handleNav('login');
      return;
    }
    const newFavorites = userFavorites.includes(propertyId)
      ? userFavorites.filter((id) => id !== propertyId)
      : [...userFavorites, propertyId];
    setUserFavorites(newFavorites);
    try {
      await updateDoc(doc(db, 'users', auth.currentUser.uid), { favorites: newFavorites });
    } catch (err) {
      console.error('Error updating favorites:', err);
    }
  };

  const handleAiSearch = async () => {
    const queryText = filterCriteria.query.trim();
    if (!queryText) {
      setFilterCriteria((prev) => ({ ...prev, aiFilteredIds: null }));
      return;
    }

    setIsAiSearching(true);
    try {
      const parsedFilters = parseNaturalLanguageQuery(queryText);
      const ranked = rankAndFilterProperties(publicProperties, parsedFilters);
      if (ranked.length > 0) {
        setFilterCriteria((prev) => ({ ...prev, aiFilteredIds: ranked.map((r) => r.property.id) }));
      } else {
        const q = queryText.toLowerCase();
        const fallback = publicProperties.filter(
          (p) =>
            (p.title || '').toLowerCase().includes(q) ||
            (p.location || '').toLowerCase().includes(q) ||
            (p.compound || '').toLowerCase().includes(q) ||
            (p.developer || '').toLowerCase().includes(q)
        );
        setFilterCriteria((prev) => ({ ...prev, aiFilteredIds: fallback.map((p) => p.id) }));
      }
    } catch (err) {
      console.error('AI Search Error:', err);
      setFilterCriteria((prev) => ({ ...prev, aiFilteredIds: null }));
    } finally {
      setIsAiSearching(false);
    }
  };

  // Publicly visible properties (excludes Draft, Removed, and Rejected listings)
  const publicProperties = useMemo(
    () =>
      properties.filter((p) => {
        if ((p.listingState || 'Live') !== 'Live') return false;
        if (p.verificationStatus === 'Rejected') return false;
        if (p.rejectedAt && p.verificationStatus !== 'Verified') return false;
        return true;
      }),
    [properties]
  );

  // SOLID Specification-based Filtering & Sorting Use Case (zero demo fallback injection)
  const filteredProperties = useMemo(
    () => filterAndSortProperties(publicProperties, filterCriteria),
    [publicProperties, filterCriteria]
  );
  const districtFacets = useMemo(() => extractDistrictFacets(publicProperties), [publicProperties]);
  const activeFilterCount = useMemo(() => countActiveFilters(filterCriteria), [filterCriteria]);

  // Reload every property from Neon Postgres (via compatibility layer)
  const refreshProperties = useCallback(async () => {
    try {
      const snap = await getDocs(collection(db, 'properties'));
      const fetched = snap.docs.map((d) => ({ id: d.id, ...d.data() })) as Property[];
      setProperties(fetched);
    } catch (err) {
      console.warn('Could not refresh properties from Neon database:', err);
      setProperties([]);
    }
  }, []);

  useEffect(() => {
    const fetchProps = async () => {
      setLoadingProps(true);
      try {
        await refreshProperties();
      } catch (err) {
        console.error('Error fetching properties from Neon database:', err);
        setProperties([]);
      } finally {
        setLoadingProps(false);
      }
    };
    fetchProps();
  }, [refreshProperties]);

  // Dynamic Technical SEO Engine across all routes
  useEffect(() => {
    const activeProperty = selectedPropertyId ? properties.find((p) => p.id === selectedPropertyId) : undefined;
    const seoMeta = buildPageSeoMetadata(currentPage, {
      isRtl,
      property: activeProperty,
      projectName: selectedProject || undefined,
    });
    seoManager.apply(seoMeta);
  }, [currentPage, isRtl, selectedPropertyId, selectedProject, properties]);

  if (!isAuthReady) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50 dark:bg-slate-950 transition-colors duration-500">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-brand-600" />
      </div>
    );
  }

  // Standalone Full-Viewport Enterprise Admin Command Center ("HETTETY Admin OS")
  if (!showSplash && currentPage === 'manage-users' && isAdmin) {
    return (
      <LoadErrorBoundary isRtl={isRtl} onClose={() => handleNav('home')}>
        <React.Suspense
          fallback={
            <div className="min-h-screen flex flex-col items-center justify-center bg-slate-950 text-white gap-4">
              <Loader2 className="w-10 h-10 text-accent-500 animate-spin" />
              <p className="text-sm font-bold tracking-wide text-slate-300">
                {isRtl ? 'جاري تشغيل مركز قيادة حِتّتي الإداري...' : 'Launching HETTETY Admin OS...'}
              </p>
            </div>
          }
        >
          <AdminPortalApp
            isRtl={isRtl}
            isSuperAdmin={isSuperAdmin}
            userEmail={userEmail}
            userName={userName}
            darkMode={isDarkMode}
            onToggleDarkMode={() => toggleDarkMode()}
            onToggleLanguage={() => setLang((l) => (l === 'ar' ? 'en' : 'ar'))}
            onExitAdmin={() => handleNav('home')}
            onOpenAddListing={() => handleNav('add-listing')}
            onOpenEditListing={(prop) => openEditListing(prop.id)}
            onOpenProperty={openProperty}
            onOpen3D={open3D}
            onPropertiesChanged={refreshProperties}
          />
        </React.Suspense>
      </LoadErrorBoundary>
    );
  }

  return (
    <div
      className={`min-h-screen w-full max-w-full overflow-x-hidden flex flex-col font-sans ${
        isRtl ? 'font-cairo' : ''
      } bg-[#f8fafc] dark:bg-slate-950 transition-colors duration-500`}
      dir={isRtl ? 'rtl' : 'ltr'}
    >
      {showSplash ? (
        <SplashScreen onFinish={() => setShowSplash(false)} />
      ) : (
        <>
          <SiteNavbar
            currentPage={currentPage}
            lang={lang}
            isRtl={isRtl}
            isDarkMode={isDarkMode}
            isAdmin={isAdmin}
            isSuperAdmin={isSuperAdmin}
            userEmail={userEmail}
            userName={userName}
            notifications={notifications}
            mobileMenuOpen={mobileMenuOpen}
            showNotifications={showNotifications}
            showProfileMenu={showProfileMenu}
            t={t}
            onNavigate={handleNav}
            onToggleDarkMode={toggleDarkMode}
            onToggleLanguage={() => setLang(lang === 'en' ? 'ar' : 'en')}
            onToggleMobileMenu={() => setMobileMenuOpen((prev) => !prev)}
            onCloseMobileMenu={() => setMobileMenuOpen(false)}
            onToggleNotifications={() => {
              setShowNotifications((prev) => !prev);
              setShowProfileMenu(false);
            }}
            onMarkAllRead={handleMarkAllRead}
            onToggleProfileMenu={() => {
              setShowProfileMenu((prev) => !prev);
              setShowNotifications(false);
            }}
            onCloseMenus={() => {
              setShowNotifications(false);
              setShowProfileMenu(false);
            }}
            onLogout={handleLogout}
          />

          <main className="flex-1 min-w-0 w-full max-w-full overflow-x-hidden bg-slate-50 dark:bg-slate-950 transition-colors duration-500">
            {currentPage === 'home' && (
              <>
                <PremiumHero
                  onPrimaryCta={() => handleNav('register')}
                  onSecondaryCta={() => handleNav('listings')}
                  onQuickSearch={navigateToFilteredListings}
                  onSelectLocation={(loc) => {
                    if (/north coast|الساحل/i.test(loc)) {
                      handleNav('yalla-sahel');
                    } else {
                      navigateToFilteredListings(loc);
                    }
                  }}
                  onOpen3D={() => handleNav('3d-experience')}
                  onOpenAdvisor={() => handleNav('ai-chat')}
                  t={t}
                  isRtl={isRtl}
                />

                <HomeFeaturesSection t={t} isRtl={isRtl} />

                <EgyptCorridorsSection
                  isRtl={isRtl}
                  onExploreLocation={navigateToFilteredListings}
                  onOpenSahel={() => handleNav('yalla-sahel')}
                />

                <div className="bg-slate-100/80 dark:bg-slate-900/50 py-10 border-y border-slate-200/70 dark:border-slate-800/70">
                  <Experience3DPage
                    properties={publicProperties}
                    loading={loadingProps}
                    onView3D={open3D}
                    onBrowse={() => handleNav('listings')}
                    isRtl={isRtl}
                    limit={3}
                    onViewAll={() => handleNav('3d-experience')}
                  />
                </div>

                <section className="py-20 max-w-7xl mx-auto px-4" aria-label={t.prop_featured}>
                  <div className="flex flex-wrap justify-between items-end gap-4 mb-10">
                    <div>
                      <h2 className="text-3xl font-heading font-black text-brand-900 dark:text-white mb-2">
                        {t.prop_featured}
                      </h2>
                      <p className="text-slate-600 dark:text-slate-400">{t.prop_subtitle}</p>
                    </div>
                    <button
                      type="button"
                      onClick={() => handleNav('listings')}
                      className="text-accent-600 dark:text-accent-400 font-bold flex items-center gap-1.5 hover:gap-2.5 transition-all cursor-pointer"
                    >
                      {t.prop_view_all} {isRtl ? <ArrowLeft size={18} /> : <ArrowRight size={18} />}
                    </button>
                  </div>
                  {loadingProps ? (
                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-8">
                      {[1, 2, 3].map((i) => (
                        <div key={i} className="h-96 bg-slate-200 dark:bg-slate-800 rounded-3xl animate-pulse" />
                      ))}
                    </div>
                  ) : publicProperties.length === 0 ? (
                    <InventoryEmptyState
                      mode="clean-database"
                      isRtl={isRtl}
                      isAdmin={isAdmin}
                      totalInventoryCount={0}
                      onAddProperty={() => handleNav(auth.currentUser ? 'add-listing' : 'login')}
                      onOpenAdmin={isAdmin ? () => handleNav('manage-users') : undefined}
                      onOpenAdvisor={() => handleNav('ai-chat')}
                    />
                  ) : (
                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-8">
                      {publicProperties.slice(0, 3).map((p) => (
                        <ReshapedPropertyCard
                          key={p.id}
                          property={p}
                          variant="grid"
                          onView3D={() => open3D(p.id)}
                          onToggleFavorite={() => toggleFavorite(p.id)}
                          isFavorited={userFavorites.includes(p.id)}
                          onToggleCompare={() => toggleCompare(p.id)}
                          isComparing={compareIds.includes(p.id)}
                          onClick={() => openProperty(p.id)}
                          onOpenProject={openProject}
                          t={t}
                          isRtl={isRtl}
                        />
                      ))}
                    </div>
                  )}
                </section>

                <HomeInstallmentEstimatorSection
                  isRtl={isRtl}
                  onBrowseListings={() => handleNav('listings')}
                  onOpenAdvisor={() => handleNav('ai-chat')}
                />

                <HomeSpotlightBannerSection
                  isRtl={isRtl}
                  onOpenSahel={() => handleNav('yalla-sahel')}
                  onOpenAdvisor={() => handleNav('ai-chat')}
                  onOpenLegal={() => handleNav('legal')}
                />
              </>
            )}

            {currentPage === 'listings' && (
              <section className="py-12 max-w-7xl mx-auto px-4" aria-label={t.prop_avail}>
                <div className="mb-8 flex flex-col gap-5 w-full min-w-0">
                  <div className="flex flex-wrap items-end justify-between gap-4">
                    <div>
                      <h1 className="text-3xl lg:text-4xl font-heading font-black text-slate-900 dark:text-white tracking-tight">
                        {t.prop_avail}
                      </h1>
                      <p className="text-sm text-slate-500 dark:text-slate-400 mt-1 font-medium">
                        {isRtl
                          ? 'ابحث وقارن الوحدات الحقيقية بفلترة ذكية وجولات 3D.'
                          : 'Discover, filter, and compare real listings with interactive 3D spatial tours.'}
                      </p>
                    </div>
                    {auth.currentUser && (
                      <button
                        type="button"
                        onClick={() => handleNav('add-listing')}
                        className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-accent-500 hover:bg-accent-600 text-white text-xs sm:text-sm font-black shadow-md shadow-accent-500/20 transition-all cursor-pointer"
                      >
                        <PlusCircle size={16} aria-hidden="true" />
                        <span>{isRtl ? 'أضف عقارك' : 'Add Listing'}</span>
                      </button>
                    )}
                  </div>

                  <AdvancedFilterBar
                    criteria={filterCriteria}
                    onChange={setFilterCriteria}
                    onReset={resetFilterCriteria}
                    onAiSearch={handleAiSearch}
                    isAiSearching={isAiSearching}
                    displayMode={displayMode}
                    onDisplayModeChange={setDisplayMode}
                    totalCount={publicProperties.length}
                    filteredCount={filteredProperties.length}
                    districtFacets={districtFacets}
                    savedSearches={savedSearches}
                    onSaveSearch={saveCurrentSearch}
                    onApplySavedSearch={applySavedSearch}
                    onRemoveSavedSearch={removeSavedSearch}
                    onSubscribeAlert={subscribeAlert}
                    t={t}
                    isRtl={isRtl}
                  />
                </div>

                {displayMode === 'projects' ? (
                  (() => {
                    if (filteredProperties.length === 0 && !loadingProps) {
                      return (
                        <InventoryEmptyState
                          mode={publicProperties.length === 0 ? 'clean-database' : 'no-matches'}
                          isRtl={isRtl}
                          isAdmin={isAdmin}
                          activeFilterCount={activeFilterCount}
                          totalInventoryCount={publicProperties.length}
                          onAddProperty={() => handleNav(auth.currentUser ? 'add-listing' : 'login')}
                          onOpenAdmin={isAdmin ? () => handleNav('manage-users') : undefined}
                          onClearFilters={resetFilterCriteria}
                          onOpenAdvisor={() => handleNav('ai-chat')}
                        />
                      );
                    }
                    const groups = new Map<string, Property[]>();
                    filteredProperties.forEach((p) => {
                      const k = p.compound || (isRtl ? 'وحدات فردية' : 'Individual units');
                      if (!groups.has(k)) groups.set(k, []);
                      groups.get(k)!.push(p);
                    });
                    const projects = [...groups.entries()];
                    return (
                      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-8">
                        {projects.map(([name, units]) => {
                          const prices = units.map((u) => u.price).filter(Boolean);
                          const min = prices.length ? Math.min(...prices) : 0;
                          const max = prices.length ? Math.max(...prices) : 0;
                          const cur = units[0].currency || 'EGP';
                          const openGroup = () => {
                            if (units[0].compound) {
                              openProject(name);
                              return;
                            }
                            setDisplayMode('grid');
                            setFilterCriteria((prev) => ({ ...prev, query: name, aiFilteredIds: null }));
                          };
                          return (
                            <article
                              key={name}
                              onClick={openGroup}
                              onKeyDown={(e) => {
                                if (e.key === 'Enter' || e.key === ' ') {
                                  e.preventDefault();
                                  openGroup();
                                }
                              }}
                              role="button"
                              tabIndex={0}
                              aria-label={`${name}, ${units.length} ${isRtl ? 'وحدة' : 'units'}`}
                              className="group bg-white dark:bg-slate-900 rounded-3xl border border-slate-200/80 dark:border-slate-800 shadow-sm hover:shadow-xl transition-all overflow-hidden cursor-pointer animate-fade-in focus:outline-none focus:ring-2 focus:ring-brand-500"
                            >
                              <div className="relative h-56 overflow-hidden">
                                <PropertyImage
                                  src={units[0].imageUrl}
                                  alt={name}
                                  iconSize={48}
                                  className="w-full h-full object-cover transition-transform duration-700 group-hover:scale-110"
                                />
                                <div className="absolute bottom-0 left-0 right-0 p-4 bg-gradient-to-t from-brand-950/90 to-transparent">
                                  <h3 className="text-white font-heading font-black text-lg line-clamp-1">{name}</h3>
                                  {units[0].developer && <p className="text-white/75 text-xs">{units[0].developer}</p>}
                                </div>
                                <span className="absolute top-4 end-4 bg-accent-500 text-white text-xs font-black px-3 py-1 rounded-full shadow-md">
                                  {units.length} {isRtl ? 'وحدة' : 'units'}
                                </span>
                              </div>
                              <div className="p-5">
                                <p className="flex items-center text-slate-500 dark:text-slate-400 text-sm mb-2">
                                  <MapPin size={14} className="me-1 text-accent-500" /> {units[0].location}
                                </p>
                                <div className="font-black text-brand-700 dark:text-accent-400">
                                  {min === max ? min.toLocaleString() : `${min.toLocaleString()} – ${max.toLocaleString()}`}{' '}
                                  {cur}
                                </div>
                              </div>
                            </article>
                          );
                        })}
                      </div>
                    );
                  })()
                ) : filteredProperties.length === 0 && !loadingProps ? (
                  <InventoryEmptyState
                    mode={publicProperties.length === 0 ? 'clean-database' : 'no-matches'}
                    isRtl={isRtl}
                    isAdmin={isAdmin}
                    activeFilterCount={activeFilterCount}
                    totalInventoryCount={publicProperties.length}
                    onAddProperty={() => handleNav(auth.currentUser ? 'add-listing' : 'login')}
                    onOpenAdmin={isAdmin ? () => handleNav('manage-users') : undefined}
                    onClearFilters={resetFilterCriteria}
                    onOpenAdvisor={() => handleNav('ai-chat')}
                  />
                ) : (
                  <div
                    className={
                      displayMode === 'list'
                        ? 'flex flex-col gap-6'
                        : 'grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-8'
                    }
                  >
                    {loadingProps
                      ? [1, 2, 3, 4, 5, 6].map((i) => (
                          <div key={i} className="h-96 bg-slate-200 dark:bg-slate-800 rounded-3xl animate-pulse" />
                        ))
                      : filteredProperties.map((p) => (
                          <ReshapedPropertyCard
                            key={p.id}
                            property={p}
                            variant={displayMode === 'list' ? 'list' : 'grid'}
                            onView3D={() => open3D(p.id)}
                            onToggleFavorite={() => toggleFavorite(p.id)}
                            isFavorited={userFavorites.includes(p.id)}
                            onToggleCompare={() => toggleCompare(p.id)}
                            isComparing={compareIds.includes(p.id)}
                            onClick={() => openProperty(p.id)}
                            onOpenProject={openProject}
                            t={t}
                            isRtl={isRtl}
                          />
                        ))}
                  </div>
                )}
              </section>
            )}

            {currentPage === 'ai-chat' && (
              <RealEstateAdvisor
                t={t}
                isRtl={isRtl}
                properties={publicProperties}
                userName={userName}
                onShow3D={open3D}
                onOpenProperty={openProperty}
              />
            )}

            {currentPage === 'legal' && <LegalCenterPage t={t} isRtl={isRtl} userEmail={userEmail} />}
            {currentPage === 'about' && <AboutPage onCta={() => handleNav('register')} t={t} isRtl={isRtl} />}
            {currentPage === 'terms' && <TermsPage t={t} isRtl={isRtl} />}
            {currentPage === 'privacy' && <PrivacyPage t={t} isRtl={isRtl} />}
            {currentPage === 'cookie-policy' && <CookiePolicyPage t={t} isRtl={isRtl} />}
            {currentPage === 'buy' && <BuyPropertyPage onCta={() => handleNav('listings')} t={t} isRtl={isRtl} />}
            {currentPage === 'verification' && <VerificationPage onCta={() => handleNav('legal')} t={t} isRtl={isRtl} />}
            {currentPage === 'tours' && <Tours3DPage onCta={() => handleNav('3d-experience')} t={t} isRtl={isRtl} />}

            {currentPage === 'project' && selectedProject && (
              <ProjectPage
                projectName={selectedProject}
                units={publicProperties.filter((p) => (p.compound || '') === selectedProject)}
                onBack={goBack}
                onOpenProperty={openProperty}
                onView3D={open3D}
                onToggleFavorite={toggleFavorite}
                userFavorites={userFavorites}
                onToggleCompare={toggleCompare}
                compareIds={compareIds}
                t={t}
                isRtl={isRtl}
              />
            )}

            {currentPage === 'yalla-sahel' && (
              <SahelPage
                properties={publicProperties}
                userFavorites={userFavorites}
                compareIds={compareIds}
                onView3D={open3D}
                onToggleFavorite={toggleFavorite}
                onToggleCompare={toggleCompare}
                onOpenProperty={openProperty}
                onOpenProject={openProject}
                onListChalet={() => {
                  setPrefillSahel(true);
                  handleNav('add-listing');
                }}
                onBrowseAll={() => handleNav('listings')}
                t={t}
                isRtl={isRtl}
              />
            )}

            {currentPage === '3d' && selectedPropertyId && (
              <Viewer3D
                property={properties.find((p) => p.id === selectedPropertyId)}
                onClose={() => {
                  setSelectedPropertyId(null);
                  handleNav('listings');
                }}
                t={t}
                isRtl={isRtl}
              />
            )}

            {currentPage === 'property' &&
              selectedPropertyId &&
              (() => {
                const prop = properties.find((p) => p.id === selectedPropertyId);
                if (!prop) {
                  return (
                    <div className="max-w-3xl mx-auto px-4 py-24 text-center">
                      {loadingProps ? (
                        <Loader2 className="w-10 h-10 text-brand-500 animate-spin mx-auto" />
                      ) : (
                        <>
                          <Building2 className="w-16 h-16 text-slate-300 dark:text-slate-700 mx-auto mb-4" />
                          <p className="text-slate-500 dark:text-slate-400 mb-6">
                            {isRtl ? 'العقار غير موجود أو تم حذفه.' : 'This property was not found or has been removed.'}
                          </p>
                          <BrandButton onClick={() => handleNav('listings')}>
                            {isRtl ? 'تصفح العقارات' : 'Browse Listings'}
                          </BrandButton>
                        </>
                      )}
                    </div>
                  );
                }
                return (
                  <PropertyDetailPage
                    key={prop.id}
                    property={prop}
                    onBack={goBack}
                    onPurchase={() => {
                      setPaymentProperty(prop);
                      handleNav('payment');
                    }}
                    onOpenProject={openProject}
                    onToggleFavorite={() => toggleFavorite(prop.id)}
                    isFavorited={userFavorites.includes(prop.id)}
                    onToggleCompare={() => toggleCompare(prop.id)}
                    isComparing={compareIds.includes(prop.id)}
                    t={t}
                    isRtl={isRtl}
                  />
                );
              })()}

            {currentPage === '3d-experience' && (
              <Experience3DPage
                properties={publicProperties}
                loading={loadingProps}
                onView3D={open3D}
                onBrowse={() => handleNav('listings')}
                isRtl={isRtl}
              />
            )}

            {currentPage === 'profile' && (
              <ProfilePage
                t={t}
                isRtl={isRtl}
                onBrowse={() => handleNav('listings')}
                onLogout={handleLogout}
                onLogin={() => handleNav('login')}
                userEmail={userEmail}
                userFavorites={userFavorites}
                allProperties={properties}
                onToggleFavorite={toggleFavorite}
                open3D={open3D}
                onOpenProperty={openProperty}
                onEditListing={openEditListing}
                onAddListing={() => handleNav('add-listing')}
                onOpenAdmin={isAdmin ? () => handleNav('manage-users') : undefined}
                isAdmin={isAdmin}
                refreshProperties={refreshProperties}
              />
            )}

            {currentPage === 'payment' && paymentProperty && (
              <PaymentPage
                property={paymentProperty}
                onConfirm={async () => {
                  if (!auth.currentUser) {
                    alert(
                      isRtl
                        ? 'سجّل الدخول الأول عشان نقدر نتواصل معاك بخصوص الطلب.'
                        : 'Please sign in first so we can contact you about this request.'
                    );
                    handleNav('login');
                    return;
                  }
                  if (paymentProperty.availability === 'Sold') {
                    alert(isRtl ? 'عذراً، هذا العقار تم بيعه بالفعل.' : 'Sorry, this property is already sold.');
                    setPaymentProperty(null);
                    return;
                  }
                  const purchaseId = `purchase_${auth.currentUser.uid}_${paymentProperty.id}`;
                  await setDoc(doc(db, 'purchases', purchaseId), {
                    userId: auth.currentUser.uid,
                    propertyId: paymentProperty.id,
                    propertyTitle: paymentProperty.title,
                    frozenPrice: paymentProperty.price || paymentProperty.projectPriceFrom || 0,
                    currency: paymentProperty.currency || 'EGP',
                    status: 'processing',
                    createdAt: new Date().toISOString(),
                  });
                  try {
                    await addDoc(collection(db, 'notifications'), {
                      userId: auth.currentUser.uid,
                      title: isRtl ? 'طلب شراء قيد المراجعة' : 'Purchase Request Received',
                      message: isRtl
                        ? `تم استلام طلبك للعقار ${paymentProperty.title}. سيقوم أحد خبرائنا بالتواصل معك قريباً.`
                        : `Your request for ${paymentProperty.title} has been received. Our expert will contact you shortly.`,
                      date: new Date().toISOString(),
                      read: false,
                    });
                  } catch (notifyErr) {
                    console.warn('Purchase saved, but confirmation notification failed:', notifyErr);
                  }
                  setPaymentProperty(null);
                  handleNav('profile');
                }}
                onCancel={() => {
                  setPaymentProperty(null);
                  handleNav('listings');
                }}
                t={t}
                isRtl={isRtl}
              />
            )}

            {currentPage === 'add-listing' && !auth.currentUser && (
              <div className="max-w-lg mx-auto px-4 py-24 text-center animate-fade-in">
                <PlusCircle size={48} className="mx-auto mb-4 text-slate-300 dark:text-slate-700" aria-hidden="true" />
                <h1 className="text-2xl font-heading font-black text-slate-900 dark:text-white mb-2">
                  {isRtl ? 'سجّل الدخول عشان تضيف إعلان' : 'Sign in to post a listing'}
                </h1>
                <p className="text-slate-500 dark:text-slate-400 mb-8">
                  {isRtl
                    ? 'الإعلان بيتسجّل باسم حسابك، عشان تقدر تعدّله أو تشيله بعدين.'
                    : 'A listing is filed under your account, so you can edit or remove it later.'}
                </p>
                <BrandButton onClick={() => handleNav('login')}>
                  {isRtl ? 'تسجيل الدخول' : 'Sign in'}
                </BrandButton>
              </div>
            )}

            {currentPage === 'edit-listing' &&
              editingPropertyId &&
              (() => {
                const prop = properties.find((pr) => pr.id === editingPropertyId);
                if (loadingProps) {
                  return (
                    <div className="py-24 text-center">
                      <Loader2 className="animate-spin mx-auto text-brand-500 w-8 h-8" aria-hidden="true" />
                    </div>
                  );
                }
                if (!prop) {
                  return (
                    <div className="max-w-lg mx-auto px-4 py-24 text-center animate-fade-in">
                      <p className="text-slate-500 dark:text-slate-400 mb-6">
                        {isRtl ? 'الإعلان ده مش موجود.' : 'That listing no longer exists.'}
                      </p>
                      <BrandButton onClick={() => handleNav('profile')}>
                        {isRtl ? 'رجوع لإعلاناتي' : 'Back to my listings'}
                      </BrandButton>
                    </div>
                  );
                }
                if (!auth.currentUser || (prop.authorUid !== auth.currentUser.uid && !isAdmin)) {
                  return (
                    <div className="max-w-lg mx-auto px-4 py-24 text-center animate-fade-in">
                      <LockIcon size={40} className="mx-auto mb-4 text-slate-300 dark:text-slate-700" aria-hidden="true" />
                      <p className="text-slate-500 dark:text-slate-400 mb-6">
                        {isRtl ? 'الإعلان ده مش بتاعك.' : "This listing isn't yours to edit."}
                      </p>
                      <BrandButton onClick={() => handleNav('listings')}>
                        {isRtl ? 'تصفّح العقارات' : 'Browse listings'}
                      </BrandButton>
                    </div>
                  );
                }
                return (
                  <AddListingPage
                    mode="edit"
                    initialProperty={prop}
                    isAdmin={isAdmin}
                    isSuperAdmin={isSuperAdmin}
                    onAdd={async () => {
                      /* unreachable in edit mode */
                    }}
                    onUpdate={async (id, patch) => {
                      await updateDoc(doc(db, 'properties', id), patch);
                      await refreshProperties();
                    }}
                    t={t}
                    isRtl={isRtl}
                  />
                );
              })()}

            {currentPage === 'add-listing' && auth.currentUser && (
              <AddListingPage
                isAdmin={isAdmin}
                isSuperAdmin={isSuperAdmin}
                defaultYallaSahel={prefillSahel}
                onAdd={async (prop) => {
                  try {
                    await addDoc(collection(db, 'properties'), {
                      ...prop,
                      authorUid: auth.currentUser?.uid || 'anonymous',
                    });
                    await refreshProperties();
                    handleNav('listings');
                  } catch (err) {
                    console.error('Error adding property to Neon DB:', err);
                    throw err;
                  }
                }}
                onAddMany={async (props) => {
                  const uid = auth.currentUser?.uid || 'anonymous';
                  const batch = writeBatch(db);
                  props.forEach((p) => batch.set(doc(collection(db, 'properties')), { ...p, authorUid: uid }));
                  try {
                    await batch.commit();
                    await refreshProperties();
                    handleNav('listings');
                  } catch (err) {
                    console.error('Error adding project units to Neon DB:', err);
                    throw err;
                  }
                }}
                t={t}
                isRtl={isRtl}
              />
            )}

            {currentPage === 'login' && (
              <AuthForm
                type="login"
                onSwitch={() => handleNav('register')}
                onSubmit={(email) => {
                  setUserEmail(email);
                  handleNav('home');
                }}
                t={t}
                isRtl={isRtl}
              />
            )}

            {currentPage === 'register' && (
              <AuthForm
                type="register"
                onSwitch={() => handleNav('login')}
                onSubmit={(email) => {
                  setUserEmail(email);
                  handleNav('home');
                }}
                t={t}
                isRtl={isRtl}
              />
            )}

            {currentPage === 'contact' && (
              <ContactPage t={t} isRtl={isRtl} onOpenAdvisor={() => handleNav('ai-chat')} />
            )}
          </main>

          {/* Reshaped Sticky Property Comparison Bar & Side-by-Side Modal */}
          <PropertyComparisonDrawer
            properties={compareIds.map((id) => properties.find((p) => p.id === id)).filter(Boolean) as Property[]}
            isOpen={showCompare}
            onOpen={() => setShowCompare(true)}
            onClose={() => setShowCompare(false)}
            onRemove={toggleCompare}
            onClearAll={() => {
              setCompareIds([]);
              setShowCompare(false);
            }}
            onSelectProperty={(id) => {
              setShowCompare(false);
              openProperty(id);
            }}
            onView3D={(id) => {
              setShowCompare(false);
              open3D(id);
            }}
            isRtl={isRtl}
            t={t}
          />

          <CookieConsent t={t} isRtl={isRtl} onNavigateToLegal={handleNav} />

          <SiteFooter t={t} isRtl={isRtl} onNavigate={handleNav} />
        </>
      )}
    </div>
  );
}
