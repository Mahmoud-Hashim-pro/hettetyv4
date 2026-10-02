/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { motion } from 'motion/react';
import { 
  Building2, MapPin, Users, Globe, ShieldCheck, 
  Sparkles, Code2, Menu, X, Home, Search, 
  MessageSquareText, FileText, Box, ArrowRight,
  CheckCircle, PlayCircle, Send, Upload, Clock,
  DollarSign, BedDouble, Bath, Maximize, Loader2,
  Check, FileCheck, Key, RefreshCw,
  User, ArrowLeft, Phone, Target, CreditCard, PlusCircle, Edit2, Save, LogOut, Shield, Trash2, Bell, Lock as LockIcon,
  Plus, History, PanelLeftClose, PanelLeftOpen, ChevronLeft, ChevronRight, MessageSquare, Sun, Moon, Heart, Star
} from 'lucide-react';
import { Type, createChat, extract3DMarker, withRetry, isOverloadedError, generateContentResilient, aiErrorMessage } from './ai';
import { AddListingPage, PAYMENT_OPTIONS, PROPERTY_TYPES, FINISHING_OPTIONS, AMENITIES } from './components/add-listing-page';
import { INITIAL_ENTITY_DATA, TRANSLATIONS, SUPER_ADMIN_EMAILS } from './constants';
import { Property, ChatMessage, UserDocument, Page, Notification, ChatSession } from './types';
import imageCompression from 'browser-image-compression';
import { api } from './mockApi';
import { 
  auth, db, storage, googleProvider, signInWithPopup, signOut, onAuthStateChanged,
  doc, getDoc, setDoc, collection, getDocs, query, where, onSnapshot, writeBatch,
  addDoc, updateDoc, deleteDoc,
  ref, uploadBytes, uploadBytesResumable, getDownloadURL, deleteObject,
  handleFirestoreError, OperationType
} from './firebase';
import { createUserWithEmailAndPassword, signInWithEmailAndPassword } from 'firebase/auth';
import AboutPage from './components/AboutPage';
import BrandLogo, { BrandMonogram } from './components/BrandLogo';
import { BuyPropertyPage, VerificationPage, Tours3DPage } from './components/ServicePages';
import TermsPage from './components/TermsPage';
import PrivacyPage from './components/PrivacyPage';
import CookiePolicyPage from './components/CookiePolicyPage';
import CookieConsent from './components/CookieConsent';
import PremiumHero from './components/PremiumHero';
import EmptyState from './components/EmptyState';
import { useFocusTrap } from './hooks/useFocusTrap';
import { lazyWithReload } from './lib/lazyWithReload';
import { LoadErrorBoundary } from './components/LoadErrorBoundary';
import RealEstateAdvisor from './components/RealEstateAdvisor';
import { parseNaturalLanguageQuery } from './services/search/query-parser';
import { rankAndFilterProperties } from './services/search/ranking-engine';

// Lazy-loaded so the heavy three.js bundle is only fetched when a 3D tour is opened
const Property3DViewer = lazyWithReload(() => import('./components/Property3DViewer'), 'viewer3d');

const Loading3DFallback = () => (
  <div className="fixed inset-0 z-[70] bg-black flex items-center justify-center">
    <Loader2 className="w-10 h-10 text-brand-500 animate-spin" />
  </div>
);

/** Exports an array of objects to a downloaded CSV file. */
const downloadCsv = (filename: string, rows: Record<string, any>[]) => {
  if (!rows.length) return;
  const headerSet = new Set<string>();
  rows.forEach(r => Object.keys(r).forEach(k => headerSet.add(k)));
  const headers: string[] = Array.from(headerSet);
  const esc = (v: any) => {
    const s = v == null ? '' : typeof v === 'object' ? JSON.stringify(v) : String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const csv = [headers.join(','), ...rows.map(r => headers.map(h => esc(r[h])).join(','))].join('\n');
  const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
};

/** Returns the URL only if it's a safe https Matterport/Polycam/Kuula tour link, else null.
 *  Prevents a malicious lister storing a javascript:/data: URL that would execute in the iframe. */
const safeTourUrl = (raw: string | undefined): string | null => {
  if (!raw) return null;
  try {
    const u = new URL(raw.trim());
    const host = u.hostname.replace(/^www\./, '');
    const ok = u.protocol === 'https:' && (host === 'matterport.com' || host.endsWith('.matterport.com') || host === 'poly.cam' || host.endsWith('.poly.cam') || host === 'kuula.co' || host.endsWith('.kuula.co'));
    return ok ? u.href : null;
  } catch { return null; }
};

/** Suffix appended to a price for rental periods (e.g. "/night"). */
/**
 * Developer brochures routinely carry no prices at all — every one of the five
 * we tested had none. A listing priced 0 means "ask", not free.
 */
/**
 * What stands where a price would go.
 *
 * "Price on request" tells a buyer nothing at all. Where the developer has
 * published what the project starts at, say that instead — as the project's
 * floor, never as this unit's price.
 */
export const priceLabel = (p: Property, isRtl: boolean) => {
  if (p.price) return `${p.price.toLocaleString()} ${p.currency || 'EGP'}`;
  if (p.projectPriceFrom) {
    const amount = `${p.projectPriceFrom.toLocaleString()} ${p.currency || 'EGP'}`;
    return isRtl ? `المشروع يبدأ من ${amount}` : `Project from ${amount}`;
  }
  return isRtl ? 'السعر عند الطلب' : 'Price on request';
};

/**
 * The sentence that keeps the figure honest: whose number it is, when they
 * published it, and that it is not this unit's price. Nothing to say when the
 * unit carries its own price, or when we cannot name a source.
 */
export const priceProvenance = (p: Property, isRtl: boolean): string | null => {
  if (p.price || !p.projectPriceFrom || !p.priceSource) return null;
  const when = p.priceAsOf ? ` — ${p.priceAsOf}` : '';
  return isRtl
    ? `أقل سعر معلن في المشروع، مش سعر الوحدة دي. المصدر: ${p.priceSource}${when}`
    : `Lowest advertised price in the project, not this unit's. Source: ${p.priceSource}${when}`;
};

const pricePeriodSuffix = (period: string | undefined, isRtl: boolean) => {
  switch (period) {
    case 'night': return isRtl ? ' / ليلة' : ' / night';
    case 'week': return isRtl ? ' / أسبوع' : ' / week';
    case 'month': return isRtl ? ' / شهر' : ' / month';
    default: return '';
  }
};

/** Looks a stored English value up in an option list and returns the localized label.
 *  Property values are stored in English but were being rendered raw, so an Arabic
 *  visitor saw "Semi Finished" / "Apartment" and could not read their own listing. */
const optionLabel = (
  options: { value: string; ar: string; en: string }[],
  value: string | undefined,
  isRtl: boolean
) => {
  if (!value) return '';
  const hit = options.find((o) => o.value === value);
  return hit ? (isRtl ? hit.ar : hit.en) : value;
};

const typeLabel = (v: string | undefined, isRtl: boolean) => optionLabel(PROPERTY_TYPES, v, isRtl);
const finishingLabel = (v: string | undefined, isRtl: boolean) => optionLabel(FINISHING_OPTIONS, v, isRtl);
const amenityLabel = (v: string, isRtl: boolean) => optionLabel(AMENITIES, v, isRtl);

/** Localized label for a stored (English) payment-method value. */
const paymentLabel = (value: string, isRtl: boolean) => {
  const opt = PAYMENT_OPTIONS.find(o => o.value === value);
  return opt ? (isRtl ? opt.ar : opt.en) : value;
};

/** Localized label + styling for a property's availability. `status` switches Sold↔Rented wording. */
const availabilityInfo = (availability: Property['availability'], status: Property['status'], isRtl: boolean) => {
  switch (availability) {
    case 'Sold':
      return { label: status === 'For Rent' ? (isRtl ? 'مؤجَّر' : 'Rented') : (isRtl ? 'مباع' : 'Sold'), color: 'bg-red-500', taken: true };
    case 'Reserved':
      return { label: isRtl ? 'محجوز' : 'Reserved', color: 'bg-amber-500', taken: true };
    default:
      return { label: isRtl ? 'متاح' : 'Available', color: 'bg-green-500', taken: false };
  }
};

// --- Components ---

const SplashScreen = ({ onFinish }: { onFinish: () => void }) => {
  const [showButton, setShowButton] = useState(false);

  useEffect(() => {
    const timer = setTimeout(() => {
      setShowButton(true);
    }, 3000);
    return () => clearTimeout(timer);
  }, []);

  return (
    <motion.div 
      initial={{ opacity: 1 }}
      exit={{ opacity: 0, transition: { duration: 0.8 } }}
      className="fixed inset-0 z-[9999] bg-white dark:bg-slate-950 flex flex-col items-center justify-center overflow-hidden transition-colors duration-500"
    >
      <motion.div
        initial={{ scale: 0.8, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        transition={{ duration: 1, ease: "easeOut" }}
        className="relative flex flex-col items-center gap-12"
      >
        <div className="relative">
          {/* Decorative Background Pulsing Glow */}
          <motion.div 
             animate={{ 
               scale: [1, 1.2, 1],
               opacity: [0.1, 0.3, 0.1]
             }}
             transition={{ duration: 3, repeat: Infinity, ease: "easeInOut" }}
             className="absolute inset-[-50%] bg-brand-500/20 blur-[100px] rounded-full"
          />
          <BrandMonogram className="h-32 md:h-44 w-auto relative z-10 text-brand-900 dark:text-white transition-colors" />
        </div>
        
        <div className="text-center space-y-6">
          <motion.div
            initial={{ y: 20, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            transition={{ delay: 0.8, duration: 0.8 }}
          >
            <h1 className="text-5xl md:text-7xl font-black text-brand-900 dark:text-white tracking-widest mb-4 uppercase font-sans">
              HETTETY
            </h1>
            <div className="flex items-center justify-center gap-4">
              <div className="h-0.5 w-12 bg-orange-200 dark:bg-orange-900/40"></div>
              <p className="text-[#FF5722] font-black uppercase tracking-[0.3em] text-xs md:text-sm">
                FIND. TRUST. OWN.
              </p>
              <div className="h-0.5 w-12 bg-orange-200 dark:bg-orange-900/40"></div>
            </div>
          </motion.div>

          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: showButton ? 1 : 0 }}
            className="pt-10"
          >
            <button 
              onClick={onFinish}
              className="px-10 py-4 bg-brand-600 text-white font-black uppercase tracking-[0.2em] text-sm rounded-full hover:bg-brand-700 shadow-2xl shadow-brand-500/30 transform hover:-translate-y-1 active:scale-95 transition-all cursor-pointer border border-brand-500"
            >
              Enter HETTETY
            </button>
          </motion.div>
        </div>
      </motion.div>

      {/* Loading Progress Bar */}
      {!showButton && (
        <motion.div 
          initial={{ scaleX: 0 }}
          animate={{ scaleX: 1 }}
          transition={{ duration: 3, ease: "linear" }}
          className="absolute bottom-0 left-0 right-0 h-2 bg-brand-600 origin-left"
        />
      )}
    </motion.div>
  );
};

const Button: React.FC<{ 
  children: React.ReactNode; 
  onClick?: () => void; 
  variant?: 'primary' | 'accent' | 'outline' | 'ghost' | 'white' | 'black'; 
  className?: string;
  disabled?: boolean;
  type?: "button" | "submit" | "reset";
}> = ({ children, onClick, variant = 'primary', className = "", disabled = false, type = "button" }) => {
  const base = "px-6 py-3 rounded-xl font-semibold transition-all duration-300 flex items-center justify-center gap-2 transform active:scale-95 disabled:active:scale-100 cursor-pointer";
  const variants = {
    primary: "bg-brand-500 text-white hover:bg-brand-600 hover:shadow-lg shadow-brand-500/20",
    accent: "bg-accent-500 text-white hover:bg-accent-600 hover:shadow-lg shadow-accent-500/20",
    outline: "border-2 border-brand-500 text-brand-600 hover:bg-brand-50",
    ghost: "text-slate-600 hover:text-brand-600 hover:bg-slate-100",
    white: "bg-white text-brand-900 hover:bg-brand-50 hover:shadow-xl",
    black: "bg-slate-900 text-white hover:bg-slate-800 hover:shadow-xl"
  };
  return (
    <button type={type} disabled={disabled} onClick={onClick} className={`${base} ${variants[variant]} ${className} ${disabled ? 'opacity-50 cursor-not-allowed' : ''}`}>
      {children}
    </button>
  );
};

const Logo: React.FC<{ color?: string; className?: string; variant?: 'horizontal' | 'full' | 'mark' }> = ({ 
  color = "currentColor", 
  className = "h-12",
  variant
}) => {
  // If the context uses a compact square/circle icon (e.g. chat avatars or small badges)
  const isSmallIcon = className.includes('h-6') || className.includes('w-6') || variant === 'mark';
  if (isSmallIcon && !variant) {
    return <BrandMonogram className={className} color={color} isWhite={color === 'white' || color === '#ffffff'} />;
  }
  return (
    <BrandLogo 
      variant={variant || 'horizontal'} 
      color={color} 
      className={className} 
    />
  );
};

/** A property photo that falls back to a placeholder when the listing has none. */
const PropertyImage = ({ src, alt, className, iconSize = 24 }: { src?: string; alt: string; className?: string; iconSize?: number }) => (
  src
    ? <img src={src} alt={alt} className={className} />
    : <div role="img" aria-label={alt} className={`${className || ''} flex items-center justify-center bg-slate-100 dark:bg-slate-800 text-slate-400`}>
        <Building2 size={iconSize} aria-hidden="true" />
      </div>
);

/**
 * What this listing can actually show a buyer, in descending order of how much
 * of the property it really conveys.
 *
 *  walkthrough — a Matterport/Polycam scan: you move through the rooms
 *  pano        — equirectangular photos: you stand in one spot and look around
 *  gallery     — several flat photos, shown as a relief you can tilt
 *  single      — one flat photo; there is nothing to tour
 */
export const tourKind = (p: Property): 'walkthrough' | 'pano' | 'gallery' | 'single' => {
  if (p.threeDTour?.assetUrl || (p.digitalTwinUrl && safeTourUrl(p.digitalTwinUrl))) return 'walkthrough';
  if ((p.panoramas || []).length > 0) return 'pano';
  const shots = (p.images || []).filter(Boolean);
  return shots.length > 1 ? 'gallery' : 'single';
};

const tourLabel = (kind: ReturnType<typeof tourKind>, isRtl: boolean) => {
  switch (kind) {
    case 'walkthrough': return isRtl ? 'جولة داخل الوحدة' : 'Walk through it';
    case 'pano': return isRtl ? 'جولة 360°' : '360° tour';
    default: return isRtl ? 'معاينة الصور' : 'Photo preview';
  }
};

const PropertyCard: React.FC<{
  property: Property;
  onView3D: () => void;
  onToggleFavorite?: () => void;
  isFavorited?: boolean;
  onToggleCompare?: () => void;
  isComparing?: boolean;
  onClick?: () => void;
  t: any;
  isRtl: boolean
}> = ({ property, onView3D, onToggleFavorite, isFavorited, onToggleCompare, isComparing, onClick, t, isRtl }) => (
  <div 
    onClick={onClick} 
    onKeyDown={(e) => {
      if (onClick && (e.key === 'Enter' || e.key === ' ')) {
        e.preventDefault();
        onClick();
      }
    }}
    role={onClick ? 'button' : undefined}
    tabIndex={onClick ? 0 : undefined}
    aria-label={onClick ? `${property.title}, ${priceLabel(property, isRtl)}` : undefined}
    className={`group bg-white dark:bg-slate-900 rounded-2xl border border-slate-100 dark:border-slate-800 shadow-sm hover:shadow-xl dark:shadow-none transition-all duration-300 overflow-hidden flex flex-col h-full animate-fade-in focus:outline-none focus:ring-2 focus:ring-brand-500 ${onClick ? 'cursor-pointer' : ''}`}
  >
    <div className="relative h-64 overflow-hidden">
      {property.imageUrl ? (
        <img src={property.imageUrl} alt={property.title || (isRtl ? 'صورة العقار' : 'Property image')} className="w-full h-full object-cover transition-transform duration-700 group-hover:scale-110" />
      ) : (
        // A listing saved without a photo would otherwise render a broken image.
        <div className="w-full h-full flex flex-col items-center justify-center gap-2 bg-slate-100 dark:bg-slate-800 text-slate-400">
          <Building2 size={40} aria-hidden="true" />
          <span className="text-xs font-bold">{isRtl ? 'من غير صورة' : 'No photo yet'}</span>
        </div>
      )}
      {(() => { const av = availabilityInfo(property.availability, property.status, isRtl); return av.taken ? (
        <div className="absolute inset-0 bg-black/50 flex items-center justify-center z-10">
          <span className={`${av.color} text-white text-lg font-black uppercase tracking-widest px-6 py-2 rounded-lg -rotate-12 shadow-xl`}>{av.label}</span>
        </div>
      ) : null; })()}
      <div className="absolute top-4 start-4 flex flex-col items-start gap-1.5 z-10 max-w-[calc(100%-80px)]">
        <div className="bg-accent-500 text-white px-3 py-1 rounded-full text-xs font-bold uppercase tracking-wider shadow-sm">
          {property.status === 'For Sale' ? t.prop_forsale : t.prop_forrent}
        </div>
        {/* The badge follows verificationStatus alone. A stale isVerified: true on a
            listing a reviewer later rejected must never keep showing green. And an
            unreviewed listing says so, rather than saying nothing. */}
        <div className={`${listingReviewInfo(property, t).chip} px-2 py-1 rounded-full text-xs font-bold flex items-center gap-1 shadow-sm truncate max-w-full`}>
          {property.verificationStatus === 'Verified' && <ShieldCheck size={12} aria-hidden="true" />}
          <span className="truncate">{listingReviewInfo(property, t).label}</span>
        </div>
      </div>
      {onToggleFavorite && (
        <button 
          type="button"
          onClick={(e) => { e.stopPropagation(); onToggleFavorite(); }}
          aria-label={isFavorited ? (isRtl ? 'إزالة من المفضلة' : 'Remove from favorites') : (isRtl ? 'إضافة إلى المفضلة' : 'Add to favorites')}
          aria-pressed={isFavorited}
          className={`absolute top-4 end-4 z-10 min-w-[48px] min-h-[48px] p-2.5 rounded-full backdrop-blur-md transition-all shadow-lg flex items-center justify-center cursor-pointer focus:outline-none focus:ring-2 focus:ring-red-400 ${isFavorited ? 'bg-red-500 text-white' : 'bg-black/40 hover:bg-black/60 text-white'}`}
        >
          <Heart size={18} fill={isFavorited ? 'currentColor' : 'none'} aria-hidden="true" />
        </button>
      )}
      {/* Always visible on touch screens (no hover there); hover-reveal from sm up. */}
      <div className="absolute bottom-0 left-0 right-0 p-4 bg-gradient-to-t from-black/70 to-transparent opacity-100 sm:opacity-0 sm:group-hover:opacity-100 transition-opacity flex justify-between items-end">
        {/* Only offered when there is something to open. A single photo used to
            carry a "View in 3D" button and deliver one photo tilting. */}
        {tourKind(property) !== 'single' && (
        <button
          type="button"
          onClick={(e) => { e.stopPropagation(); onView3D(); }}
          aria-label={`${tourLabel(tourKind(property), !!isRtl)} — ${property.title}`}
          className="bg-white/20 hover:bg-white text-white hover:text-brand-900 backdrop-blur border border-white/50 px-4 py-2 rounded-lg text-sm font-medium transition-colors flex items-center gap-2 cursor-pointer focus:outline-none focus:ring-2 focus:ring-brand-400"
        >
          <Box size={16} aria-hidden="true" /> {tourLabel(tourKind(property), !!isRtl)}
        </button>
        )}
        {onToggleCompare && (
          <button 
            type="button"
            onClick={(e) => { e.stopPropagation(); onToggleCompare(); }} 
            aria-label={isComparing ? (isRtl ? 'إزالة من المقارنة' : 'Remove from comparison') : (isRtl ? 'إضافة إلى المقارنة' : 'Add to comparison')}
            aria-pressed={isComparing}
            className={`backdrop-blur border px-3 py-2 rounded-lg text-sm font-medium transition-colors flex items-center gap-1.5 cursor-pointer focus:outline-none focus:ring-2 focus:ring-brand-400 ${isComparing ? 'bg-brand-600 text-white border-brand-600' : 'bg-white/20 hover:bg-white text-white hover:text-brand-900 border-white/50'}`}
          >
            {isComparing ? <Check size={16} aria-hidden="true" /> : <Plus size={16} aria-hidden="true" />} {isRtl ? 'قارن' : 'Compare'}
          </button>
        )}
      </div>
    </div>
    <div className="p-6 flex-1 flex flex-col">
      <div className="flex justify-between items-start mb-2">
        <h3 className="text-lg font-heading font-bold text-slate-900 dark:text-white line-clamp-1">{property.title}</h3>
        <span className="text-brand-600 dark:text-brand-400 font-bold whitespace-nowrap">
          {priceLabel(property, isRtl)}{property.price ? <span className="text-[10px] text-slate-600 dark:text-slate-400 font-medium">{pricePeriodSuffix(property.pricePeriod, isRtl)}</span> : null}
        </span>
      </div>
      <div className="flex items-center gap-2 mb-3 flex-wrap">
        {property.yallaSahel && <span className="text-[10px] font-bold bg-cyan-50 dark:bg-cyan-900/30 text-cyan-700 dark:text-cyan-300 px-2 py-0.5 rounded">🌊 {isRtl ? 'ساحل حتتي' : 'Sahel Hettety'}</span>}
        {property.propertyType && <span className="text-[10px] font-bold bg-brand-50 dark:bg-brand-900/30 text-brand-700 dark:text-brand-300 px-2 py-0.5 rounded">{typeLabel(property.propertyType, isRtl)}</span>}
        <span className="flex items-center text-slate-600 dark:text-slate-400 text-sm"><MapPin size={14} className="me-1" aria-hidden="true" /> {property.location}</span>
      </div>
      {property.unitCode && (
        <div className="text-xs text-slate-600 dark:text-slate-400 mb-3 bg-slate-100 dark:bg-slate-800 px-2 py-1 rounded inline-block w-fit">
          {isRtl ? 'كود الوحدة:' : 'Unit Code:'} {property.unitCode}
        </div>
      )}
      {property.paymentMethods && property.paymentMethods.length > 0 && (
        <div className="flex flex-wrap gap-1 mb-4">
          {property.paymentMethods.map(method => (
            <span key={method} className="px-2 py-0.5 bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 text-[10px] uppercase tracking-wider font-bold rounded">
              {paymentLabel(method, isRtl)}
            </span>
          ))}
        </div>
      )}
      <div className="grid grid-cols-3 gap-2 py-4 border-t border-slate-100 dark:border-slate-800 mt-auto">
        <div className="flex flex-col items-center text-slate-700 dark:text-slate-300">
          <BedDouble size={20} className="mb-1 text-brand-600 dark:text-brand-400" aria-hidden="true" />
          <span className="text-xs font-medium">{property.bedrooms} {t.prop_beds}</span>
        </div>
        <div className="flex flex-col items-center text-slate-700 dark:text-slate-300">
          <Bath size={20} className="mb-1 text-brand-600 dark:text-brand-400" aria-hidden="true" />
          <span className="text-xs font-medium">{property.bathrooms} {t.prop_baths}</span>
        </div>
        <div className="flex flex-col items-center text-slate-700 dark:text-slate-300">
          <Maximize size={20} className="mb-1 text-brand-600 dark:text-brand-400" aria-hidden="true" />
          <span className="text-xs font-medium">{property.area}{property.areaTo ? `–${property.areaTo}` : ''} m²</span>
        </div>
      </div>
    </div>
  </div>
);

// --- Sections ---

const AuthForm = ({ type, onSwitch, onSubmit, t, isRtl }: { type: 'login' | 'register', onSwitch: () => void, onSubmit: (email: string) => void, t: any, isRtl: boolean }) => {
  const isLogin = type === 'login';
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [name, setName] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const calculateStrength = (pass: string) => {
    let score = 0;
    if (pass.length > 0) score += 1;
    if (pass.length >= 8) score += 1;
    if (/[A-Za-z]/.test(pass) && /[0-9]/.test(pass)) score += 1;
    if (/[^A-Za-z0-9]/.test(pass)) score += 1;
    return score; // 0 to 4
  };

  const strength = calculateStrength(password);
  const strengthLabels = ['', t.auth_pass_weak || 'Weak', t.auth_pass_fair || 'Fair', t.auth_pass_good || 'Good', t.auth_pass_strong || 'Strong'];
  const strengthColors = ['bg-slate-200', 'bg-red-500', 'bg-yellow-500', 'bg-brand-400', 'bg-green-500'];

  const handleGoogleSignIn = async () => {
    setLoading(true);
    setError('');
    try {
      const result = await signInWithPopup(auth, googleProvider);
      const user = result.user;
      
      // Check if user exists in Firestore
      const userDoc = await getDoc(doc(db, 'users', user.uid));
      
      if (!userDoc.exists()) {
        if (isLogin) {
          // If trying to login but doesn't exist, prompt to register
          await signOut(auth);
          setError(isRtl ? 'هذا الحساب غير موجود، يرجى التسجيل أولاً' : 'This account does not exist. Please register first.');
          setLoading(false);
          return;
        } else {
          // Create new user profile
          await setDoc(doc(db, 'users', user.uid), {
            uid: user.uid,
            name: user.displayName || '',
            email: user.email || '',
            role: SUPER_ADMIN_EMAILS.includes((user.email || '').toLowerCase()) ? 'admin' : 'user',
            createdAt: new Date().toISOString()
          });
        }
      }
      
      onSubmit(user.email || '');
    } catch (err: any) {
      // Clear loading state immediately
      setLoading(false);
      
      if (err.code === 'auth/popup-closed-by-user' || err.code === 'auth/cancelled-popup-request') {
        // User intentionally closed the popup or cancelled, no need to show a scary error
        setError('');
      } else {
        console.error("Google Sign In Error:", err);
        setError(err.message);
      }
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    
    try {
      if (isLogin) {
        try {
          const result = await signInWithEmailAndPassword(auth, email, password);
          const userDoc = await getDoc(doc(db, 'users', result.user.uid));
          if (!userDoc.exists()) {
            await signOut(auth);
            setError(isRtl ? 'هذا الحساب غير موجود، يرجى التسجيل أولاً' : 'This account does not exist. Please register first.');
            setLoading(false);
            return;
          }
          onSubmit(email);
        } catch (err: any) {
          if (err.code === 'auth/user-not-found') {
            setError(isRtl ? 'هذا الحساب غير موجود، يرجى التسجيل أولاً' : 'This account does not exist. Please register first.');
          } else if (err.code === 'auth/unauthorized-domain') {
            setError(isRtl ? 'نطاق غير مصرح به. يرجى إضافة هذا النطاق في إعدادات Firebase.' : 'Unauthorized domain. Please add this domain in Firebase settings.');
          } else {
            setError(err.message);
          }
        }
      } else {
        // Register
        if (password.length < 8 || !/[^A-Za-z0-9]/.test(password)) {
          setError(t.auth_pass_req || 'Password must be at least 8 characters and include a special character.');
          setLoading(false);
          return;
        }
        
        const result = await createUserWithEmailAndPassword(auth, email, password);
        await setDoc(doc(db, 'users', result.user.uid), {
          uid: result.user.uid,
          name: name,
          email: email,
          role: SUPER_ADMIN_EMAILS.includes(email.toLowerCase()) ? 'admin' : 'user',
          createdAt: new Date().toISOString()
        });
        onSubmit(email);
      }
    } catch (err: any) {
      if (err.code === 'auth/operation-not-allowed') {
        setError(isRtl ? 'يرجى تفعيل تسجيل الدخول بالبريد الإلكتروني في لوحة تحكم Firebase.' : 'Please enable Email/Password authentication in the Firebase Console.');
      } else if (err.code === 'auth/unauthorized-domain') {
        setError(isRtl ? 'نطاق غير مصرح به. يرجى إضافة هذا النطاق في إعدادات Firebase.' : 'Unauthorized domain. Please add this domain in Firebase settings.');
      } else {
        setError(err.message);
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-[80vh] flex items-center justify-center bg-slate-50 dark:bg-slate-950 px-4 py-12 animate-fade-in relative transition-colors duration-500">
      <div className="max-w-md w-full bg-white dark:bg-slate-900 rounded-2xl shadow-xl border border-slate-200 dark:border-slate-800 p-8">
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-12 h-12 rounded-full bg-brand-100 dark:bg-brand-900 text-brand-600 dark:text-brand-400 mb-4">
            <User size={24} />
          </div>
          <h2 className="text-2xl font-heading font-bold text-slate-900 dark:text-white">
            {isLogin ? t.auth_welcome : t.auth_create}
          </h2>
          <p className="text-slate-500 dark:text-slate-400 text-sm mt-2">
            {isLogin ? t.auth_login_desc : t.auth_reg_desc}
          </p>
        </div>

        <form className="space-y-4" onSubmit={handleSubmit}>
           {!isLogin && (
              <div>
                <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">{t.auth_name}</label>
                <input 
                  type="text" 
                  required 
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  className="w-full px-4 py-3 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 focus:ring-2 focus:ring-brand-500 outline-none transition-all text-slate-900 dark:text-white" 
                  placeholder="John Doe" 
                />
              </div>
           )}
           <div>
              <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">{t.auth_email}</label>
              <input 
                type="email" 
                required 
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="w-full px-4 py-3 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 focus:ring-2 focus:ring-brand-500 outline-none transition-all text-slate-900 dark:text-white" 
                placeholder="you@example.com" 
              />
           </div>
           <div>
              <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">{t.auth_pass}</label>
              <input 
                type="password" 
                required 
                value={password}
                onChange={(e) => { setPassword(e.target.value); setError(''); }}
                className="w-full px-4 py-3 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 focus:ring-2 focus:ring-brand-500 outline-none transition-all text-slate-900 dark:text-white" 
                placeholder="••••••••" 
              />
              {password.length > 0 && (
                <div className="mt-2">
                  <div className="flex gap-1 mb-1">
                    {[1, 2, 3, 4].map((level) => (
                      <div key={level} className={`h-1.5 flex-1 rounded-full transition-colors duration-300 ${strength >= level ? strengthColors[strength] : 'bg-slate-100 dark:bg-slate-800'}`}></div>
                    ))}
                  </div>
                  <div className="flex justify-between items-center text-xs">
                    <span className={`font-medium ${strengthColors[strength].replace('bg-', 'text-')}`}>{strengthLabels[strength]}</span>
                    <span className="text-slate-400">{t.auth_pass_req}</span>
                  </div>
                </div>
              )}
           </div>

           {error && <p className="text-red-500 text-sm font-medium">{error}</p>}

           <Button type="submit" disabled={loading} className="w-full mt-6">
             {loading ? <Loader2 className="animate-spin" /> : (isLogin ? t.auth_signin_btn : t.auth_signup_btn)}
           </Button>
        </form>

        <div className="mt-8">
          <div className="relative">
            <div className="absolute inset-0 flex items-center">
              <div className="w-full border-t border-slate-200 dark:border-slate-800"></div>
            </div>
            <div className="relative flex justify-center text-sm">
              <span className="px-2 bg-white dark:bg-slate-900 text-slate-500 dark:text-slate-400">{t.auth_or_continue || 'Or continue with'}</span>
            </div>
          </div>

          <div className="mt-6">
            <button 
              type="button" 
              onClick={handleGoogleSignIn} 
              disabled={loading}
              className="flex items-center justify-center gap-2 w-full px-4 py-2.5 border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 rounded-xl hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors text-slate-700 dark:text-slate-300 font-medium cursor-pointer disabled:opacity-50"
            >
              <svg className="w-5 h-5" viewBox="0 0 24 24">
                <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4"/>
                <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/>
                <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05"/>
                <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/>
              </svg>
              {t.auth_google || 'Google'}
            </button>
          </div>
        </div>

        <div className="mt-6 text-center text-sm">
          <span className="text-slate-500 dark:text-slate-400">
            {isLogin ? t.auth_no_account : t.auth_has_account}
          </span>
          <button onClick={onSwitch} className="font-bold text-brand-600 dark:text-brand-400 hover:text-brand-700 dark:hover:text-brand-300 cursor-pointer ml-1">
            {isLogin ? t.nav_register : t.nav_login_short}
          </button>
        </div>
      </div>
    </div>
  )
};

// --- 3D Experience Sector ---
// Lists every property that has photos and opens the interactive 3D showroom.
// Used both as the full #3d-experience page and (with `limit`) as the home teaser.
const Experience3DPage = ({ properties, loading, onView3D, onBrowse, isRtl, limit, onViewAll }: {
  properties: Property[];
  loading?: boolean;
  onView3D: (id: string) => void;
  onBrowse: () => void;
  isRtl: boolean;
  limit?: number;
  onViewAll?: () => void;
}) => {
  const ready = properties.filter(p => (p.images?.filter(Boolean).length ?? 0) > 0 || !!p.imageUrl);
  const shown = limit ? ready.slice(0, limit) : ready;

  return (
    <div className="max-w-7xl mx-auto px-4 py-16 animate-fade-in transition-colors duration-500">
      {/* Header */}
      <div className="text-center mb-12 max-w-3xl mx-auto">
        <div className="inline-flex items-center gap-2 bg-brand-100 dark:bg-brand-900 text-brand-700 dark:text-brand-300 px-4 py-1 rounded-full text-xs font-bold uppercase tracking-widest mb-4">
          <Box size={14} /> {isRtl ? 'تجربة ثلاثية الأبعاد' : '3D Experience'}
        </div>
        <h1 className="text-4xl md:text-5xl font-heading font-bold text-slate-900 dark:text-white mb-6 leading-tight">
          {isRtl ? 'تجوّل داخل العقار قبل ما تزوره' : 'Walk through the property before you visit'}
        </h1>
        <p className="text-lg text-slate-600 dark:text-slate-400 leading-relaxed">
          {isRtl
            ? 'اختر أي وحدة وادخل صالة عرض تفاعلية 360° مبنية من صورها الحقيقية — لف، قرّب، واتنقل بين الغرف من مكانك.'
            : 'Pick any unit and step into an interactive 360° showroom built from its real photos — orbit, zoom, and flip between rooms from wherever you are.'}
        </p>
      </div>

      {/* Gallery */}
      {loading ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-8">
          {[1, 2, 3].map(i => <div key={i} className="h-80 bg-slate-200 dark:bg-slate-800 rounded-3xl animate-pulse"></div>)}
        </div>
      ) : ready.length === 0 ? (
        <div className="relative w-full bg-slate-900 dark:bg-black rounded-3xl overflow-hidden shadow-2xl border border-slate-800 py-24 text-center">
          <div className="absolute inset-0 opacity-20 dark:opacity-10 bg-[linear-gradient(rgba(255,255,255,0.1)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,0.1)_1px,transparent_1px)] bg-[size:40px_40px]"></div>
          <div className="relative z-10 flex flex-col items-center text-white px-6">
            <Box className="w-20 h-20 text-slate-700" strokeWidth={1} />
            <h3 className="mt-6 text-xl font-bold">{isRtl ? 'لا توجد وحدات جاهزة للعرض ثلاثي الأبعاد بعد' : 'No 3D-ready units yet'}</h3>
            <p className="mt-2 text-slate-400 max-w-md">
              {isRtl ? 'أول ما تتضاف وحدات بصور حقيقية هتظهر هنا تلقائيًا.' : 'As soon as listings with real photos are added, they will appear here automatically.'}
            </p>
            <Button onClick={onBrowse} variant="accent" className="mt-8">{isRtl ? 'تصفح العقارات' : 'Browse Listings'}</Button>
          </div>
        </div>
      ) : (
        <>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-8">
            {shown.map(p => {
              const cover = (p.images && p.images.find(Boolean)) || p.imageUrl;
              const photoCount = Math.max(p.images?.filter(Boolean).length ?? 0, cover ? 1 : 0);
              return (
                <div
                  key={p.id}
                  onClick={() => onView3D(p.id)}
                  className="group relative rounded-3xl overflow-hidden bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-lg hover:shadow-2xl cursor-pointer transition-all duration-500 hover:-translate-y-1"
                >
                  <PropertyImage src={cover} alt={p.title} iconSize={56} className="w-full h-80 object-cover opacity-90 group-hover:opacity-100 group-hover:scale-105 transition-all duration-700" />
                  <div className="absolute inset-0 bg-gradient-to-t from-slate-950 via-slate-900/20 to-transparent"></div>

                  {/* Badges */}
                  <div className={`absolute top-4 flex items-center gap-2 ${isRtl ? 'right-4' : 'left-4'}`}>
                    <span className="bg-brand-600/90 backdrop-blur text-white text-[10px] font-black px-3 py-1.5 rounded-full uppercase tracking-widest flex items-center gap-1.5">
                      <Box size={12} /> 360°
                    </span>
                    <span className="bg-black/50 backdrop-blur text-white text-[10px] font-bold px-3 py-1.5 rounded-full">
                      {photoCount} {isRtl ? 'صورة' : photoCount === 1 ? 'photo' : 'photos'}
                    </span>
                  </div>

                  {/* Info */}
                  <div className="absolute bottom-0 inset-x-0 p-6 text-white">
                    <h3 className="text-xl font-bold mb-1 line-clamp-1">{p.title}</h3>
                    <p className="text-sm text-slate-300 flex items-center gap-1.5 mb-4">
                      <MapPin size={14} className="shrink-0" /> <span className="line-clamp-1">{p.location}</span>
                    </p>
                    <div className="flex items-center justify-between gap-3">
                      <span className="font-black text-accent-400">{p.price.toLocaleString(isRtl ? 'ar-EG' : 'en-US')} {isRtl ? 'ج.م' : 'EGP'}</span>
                      <span className="inline-flex items-center gap-2 bg-white text-slate-900 text-xs font-black px-4 py-2.5 rounded-full uppercase tracking-wider group-hover:bg-brand-500 group-hover:text-white transition-colors">
                        <PlayCircle size={14} /> {isRtl ? 'ادخل الجولة' : 'Enter Tour'}
                      </span>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
          {limit && onViewAll && ready.length > limit && (
            <div className="text-center mt-10">
              <Button onClick={onViewAll} variant="outline">
                {isRtl ? `عرض كل الجولات (${ready.length})` : `View all tours (${ready.length})`}
              </Button>
            </div>
          )}
        </>
      )}
    </div>
  );
};

const Hero = ({ onCta, t }: { onCta: () => void, t: any }) => (
  <div className="relative min-h-[90vh] flex items-center justify-center overflow-hidden bg-slate-900">
    <div className="absolute inset-0 opacity-40">
      <img src="https://images.unsplash.com/photo-1486406146926-c627a92ad1ab?auto=format&fit=crop&q=80&w=2000" alt="Modern Architecture" className="w-full h-full object-cover" />
    </div>
    <div className="absolute inset-0 bg-gradient-to-t from-slate-900 via-slate-900/50 to-transparent"></div>
    <div className="relative z-10 max-w-7xl mx-auto px-4 text-center animate-fade-in">
      <div className="inline-flex items-center gap-2 bg-white/10 backdrop-blur border border-white/20 rounded-full px-4 py-1.5 mb-6 animate-slide-up">
        <Sparkles className="text-accent-400 w-4 h-4" />
        <span className="text-accent-100 text-xs font-bold tracking-wider uppercase">{t.hero_verified_badge}</span>
      </div>
      <h1 className="text-5xl md:text-7xl font-heading font-bold text-white mb-6 leading-tight">
        {t.hero_title} <br/>
        <span className="text-transparent bg-clip-text bg-gradient-to-r from-brand-300 to-brand-500">{t.hero_span}</span>
      </h1>
      <p className="text-xl text-slate-300 mb-10 max-w-2xl mx-auto font-light">
        {t.hero_desc}
      </p>
      <div className="flex flex-col sm:flex-row gap-4 justify-center">
        <Button onClick={onCta} variant="accent" className="text-lg px-8">{t.hero_cta}</Button>
      </div>
    </div>
  </div>
);

const Features = ({ t }: { t: any }) => (
  <section className="py-20 bg-white dark:bg-slate-950 transition-colors duration-500">
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
      <div className="text-center mb-16">
        <h2 className="text-3xl font-heading font-bold text-slate-900 dark:text-white mb-4 italic tracking-tight">{t.feat_title}</h2>
        <p className="text-slate-600 dark:text-slate-400 max-w-2xl mx-auto">{t.feat_desc}</p>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-8">
        {[
          { icon: <ShieldCheck className="w-8 h-8" />, title: t.feat_1_title, desc: t.feat_1_desc },
          { icon: <FileCheck className="w-8 h-8" />, title: t.feat_2_title, desc: t.feat_2_desc },
          { icon: <Box className="w-8 h-8" />, title: t.feat_3_title, desc: t.feat_3_desc },
          { icon: <Users className="w-8 h-8" />, title: t.feat_4_title, desc: t.feat_4_desc },
        ].map((f, i) => (
          <div key={i} className="p-6 rounded-2xl bg-slate-50 dark:bg-slate-900 border border-slate-100 dark:border-slate-800 hover:shadow-lg transition-all duration-300 hover:-translate-y-1">
            <div className="w-14 h-14 bg-brand-100 dark:bg-brand-900/50 rounded-xl flex items-center justify-center text-brand-600 dark:text-brand-400 mb-4">{f.icon}</div>
            <h3 className="text-lg font-bold text-slate-900 dark:text-white mb-2 tracking-tight">{f.title}</h3>
            <p className="text-sm text-slate-600 dark:text-slate-400 leading-relaxed">{f.desc}</p>
          </div>
        ))}
      </div>
    </div>
  </section>
);

const AIChat = ({ t, isRtl, properties, userName, onShow3D }: { t: any, isRtl: boolean, properties: Property[], userName?: string | null, onShow3D?: (propertyId: string) => void }) => {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [isSidebarOpen, setIsSidebarOpen] = useState(true);
  const [sessions, setSessions] = useState<ChatSession[]>([]);
  const [currentSessionId, setCurrentSessionId] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const chatRef = useRef<any>(null);
  // Kept so we can transparently recreate the chat on a fallback model when the
  // primary model is overloaded (503), preserving the same system instruction.
  const chatConfigRef = useRef<{ systemInstruction: string } | null>(null);

  // Fetch real sessions from Firestore
  useEffect(() => {
    if (!auth.currentUser) {
      setSessions([]);
      return;
    }
    const q = query(
      collection(db, 'chat_sessions'), 
      where('userId', '==', auth.currentUser.uid)
    );
    const unsubscribe = onSnapshot(q, (snapshot) => {
      const data = snapshot.docs.map(doc => {
        const d = doc.data();
        return {
          ...d,
          id: doc.id,
          messages: (d.messages || []).map((m: any) => ({
            ...m,
            timestamp: m.timestamp?.toDate ? m.timestamp.toDate() : new Date(m.timestamp)
          }))
        } as ChatSession;
      });
      // Sort by last updated
      setSessions(data.sort((a, b) => {
        const timeA = a.lastUpdatedAt ? new Date(a.lastUpdatedAt).getTime() : 0;
        const timeB = b.lastUpdatedAt ? new Date(b.lastUpdatedAt).getTime() : 0;
        return timeB - timeA;
      }));
    });
    return () => unsubscribe();
  }, []);

  // Update messages when switching sessions
  useEffect(() => {
    if (currentSessionId) {
      const session = sessions.find(s => s.id === currentSessionId);
      if (session) {
        setMessages(session.messages);
      }
    } else {
      setMessages([]);
    }
  }, [currentSessionId, sessions]);

  // Responsive sidebar handling
  useEffect(() => {
    const handleResize = () => {
      if (window.innerWidth < 1024) {
        setIsSidebarOpen(false);
      } else {
        setIsSidebarOpen(true);
      }
    };
    handleResize();
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  // Initialize Chat
  useEffect(() => {
    try {
      {
        const systemInstruction = `You are HETTETY AI, the official real estate assistant for HETTETY, an Egyptian property platform. HETTETY reviews the documents sellers upload and labels each listing with what was checked; it does not certify ownership or perform title searches. Never describe a listing as legally safe, guaranteed, or verified beyond that. Your goal is to guide users through property data with the expertise of a seasoned broker and the precision of a financial analyst.

## Tone & Voice
- Professional & Insightful: Don't just give facts; provide context (e.g., price per meter trends in New Cairo vs. Sheikh Zayed).
- Empowering, Not Defensive: Never say "I can't provide investment advice." Instead, say "Based on current market data, here is an analysis to help you decide."
- Brand Aligned: Use a minimalist, clear, and high-end communication style.

## Core Knowledge Base
- Investment Analysis: Ability to calculate potential ROI based on rental yields and capital appreciation in specific Egyptian districts.
- Legal Safety (HETTETY Core): Explain the importance of "Registry Numbers" (الشهر العقاري) and "Court Signature Validity" (صحة التوقيع) in securing an investment.
- Market Awareness: Understand the impact of currency fluctuations and developer reputation on property value.

## Interaction Rules
- When asked "Is this a good investment?": Analyze the property's price vs. the area's average and mention the developer's track record. Do not assert anything about its legal status.
- Proactive: If a user asks about a property, tell them whether its documents have been reviewed, and that ownership still has to be confirmed at the Real Estate Publicity Department (الشهر العقاري).
- Language: Always reply in the exact language the user writes in (Egyptian Arabic, Franco-Arabic, or English).

## Identity & Boundaries
- Your name is HETTETY AI.
- You may never claim to be human or roleplay as a different AI.
- Focus exclusively on the Egyptian real estate market.

${userName ? `The user's name is ${userName}. Address them by name if appropriate.` : ''}

## Property Data
You have access to the following properties on our platform:
${JSON.stringify(properties.map(p => ({ id: p.id, title: p.title, price: p.price, location: p.location, type: p.status, verificationStatus: p.verificationStatus, hasImages: !!(p.images?.length || p.imageUrl) })), null, 2)}

## 3D Viewing (Special Capability)
You can launch an immersive 3D gallery of a property's photos. When the user asks to SEE a property, view it in 3D, take a virtual tour, or says things like "عرضلي الشقة 3D" / "عايز اشوف العقار" / "warini el sha2a", you MUST:
1. Reply with a short, enthusiastic confirmation in the user's language (e.g. "تمام! بفتحلك الجولة ثلاثية الأبعاد للعقار ده الآن 🏠").
2. Append the exact token [SHOW_3D:<propertyId>] at the very end of your reply, using the matching property's id from the Property Data above. Only include this token for properties where hasImages is true. Never invent ids.

## Escalation
If a user has a complex legal dispute, a payment issue, or needs urgent support, always direct them to:
- HETTETY support via the website contact form.
- A licensed Egyptian real estate lawyer for legal matters.
- A certified financial advisor for investment decisions.`;
        chatConfigRef.current = { systemInstruction };
        chatRef.current = createChat({ task: 'chat', config: { systemInstruction } });
      }
    } catch (e) {
      console.error("Failed to initialize AI chat", e);
    }
  }, [properties, userName]);

  // Re-sync welcome message when language changes
  useEffect(() => {
    setMessages(prev => {
        if (prev.length === 1 && prev[0].role === 'model') {
            return [{ role: 'model', text: t.ai_welcome, timestamp: new Date() }];
        }
        return prev;
    });
  }, [t]);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages]);

  const handleSend = async () => {
    if (!input.trim() || !auth.currentUser) return;

    const userMsg: ChatMessage = { role: 'user', text: input, timestamp: new Date() };
    const newMessages = [...messages, userMsg];
    setMessages(newMessages);
    const originalInput = input;
    setInput('');
    setIsLoading(true);

    try {
      let aiText = "";
      if (chatRef.current) {
        try {
          const response: any = await withRetry(() => chatRef.current.sendMessage({ message: userMsg.text }));
          aiText = response.text;
        } catch (apiError: any) {
          // Primary model still overloaded after retries — rebuild the chat on the
          // stable fallback model (replaying history) and try once more.
          if (isOverloadedError(apiError) && chatConfigRef.current) {
            try {
              const history = messages.map(m => ({ role: (m.role === 'model' ? 'model' : 'user') as 'model' | 'user', parts: [{ text: m.text }] }));
              chatRef.current = createChat({
                task: 'chat',
                history,
                config: { systemInstruction: chatConfigRef.current.systemInstruction },
              });
              const response: any = await withRetry(() => chatRef.current.sendMessage({ message: userMsg.text }), 2);
              aiText = response.text;
            } catch (fallbackErr: any) {
              console.error("API Error (fallback):", fallbackErr);
              aiText = aiErrorMessage(fallbackErr, isRtl);
            }
          } else {
            console.error("API Error:", apiError);
            aiText = aiErrorMessage(apiError, isRtl);
          }
        }
      } else {
        const response = await api.chat(userMsg.text);
        aiText = response.success ? response.data : "Mock API failed";
      }

      // If the model asked to open the 3D viewer, strip the marker and launch it
      const { cleanText, show3D, propertyId } = extract3DMarker(aiText || '');
      if (show3D && propertyId && onShow3D) {
        aiText = cleanText || (isRtl ? 'جاري فتح الجولة ثلاثية الأبعاد...' : 'Opening the 3D tour...');
        onShow3D(propertyId);
      }

      const modelMsg: ChatMessage = { role: 'model', text: aiText, timestamp: new Date() };
      const finalMessages = [...newMessages, modelMsg];
      setMessages(finalMessages);

      // Persistence logic
      if (auth.currentUser) {
        // newMessages already contains the user's message, so a fresh session has exactly 1
        const isFirstMessage = newMessages.length === 1;
        const sessionData = {
          userId: auth.currentUser.uid,
          title: isFirstMessage ? (originalInput.length > 30 ? originalInput.substring(0, 30) + '...' : originalInput) : (sessions.find(s => s.id === currentSessionId)?.title || originalInput),
          messages: finalMessages.map(m => ({
            role: m.role,
            text: m.text,
            timestamp: m.timestamp.toISOString() // Store as ISO string for simplicity or timestamp
          })),
          lastUpdatedAt: new Date().toISOString()
        };

        if (currentSessionId) {
          await updateDoc(doc(db, 'chat_sessions', currentSessionId), sessionData);
        } else {
          const docRef = await addDoc(collection(db, 'chat_sessions'), sessionData);
          setCurrentSessionId(docRef.id);
        }
      }
    } catch (error: any) {
      // Log without re-throwing: handleFirestoreError throws, which used to skip
      // setIsLoading(false) and leave the chat spinner stuck forever.
      console.error("Chat error:", error);
      setMessages(prev => [...prev, { role: 'model', text: isRtl ? 'حدث خطأ أثناء حفظ المحادثة. حاول مرة أخرى.' : 'An error occurred while saving the chat. Please try again.', timestamp: new Date() }]);
    } finally {
      setIsLoading(false);
    }
  };

  const handleNewChat = () => {
    setMessages([]);
    setCurrentSessionId(null);
    if (window.innerWidth < 1024) setIsSidebarOpen(false);
  };

  return (
    <div className={`flex h-[calc(100dvh-80px)] w-full bg-[#f8fafc] dark:bg-slate-950 overflow-hidden relative ${isRtl ? 'flex-row-reverse' : 'flex-row'} transition-colors duration-500`}>
      {/* Sidebar Overlay for Mobile */}
      {isSidebarOpen && window.innerWidth < 1024 && (
        <div 
          className="fixed inset-0 bg-black/50 z-30 transition-opacity" 
          onClick={() => setIsSidebarOpen(false)}
        />
      )}

      {/* Sidebar */}
      <motion.aside 
        initial={false}
        animate={{ 
          width: isSidebarOpen ? 300 : 0,
          opacity: isSidebarOpen ? 1 : 0
        }}
        className={`bg-white dark:bg-slate-900 ${isRtl ? 'border-l' : 'border-r'} border-slate-100 dark:border-slate-800 flex flex-col z-40 h-full relative overflow-hidden shrink-0 shadow-sm transition-all duration-300 ease-in-out ${!isSidebarOpen && 'pointer-events-none'}`}
      >
        <div className="p-4 flex flex-col h-full w-[300px]">
          {/* New Chat Button */}
          <button 
            onClick={handleNewChat}
            className={`flex items-center gap-3 w-full p-4 mb-6 rounded-2xl border border-slate-100 dark:border-slate-800 bg-white dark:bg-slate-800 hover:bg-slate-50 dark:hover:bg-slate-700 transition-all text-slate-800 dark:text-slate-200 font-bold text-sm group shadow-sm hover:shadow-md active:scale-[0.98] cursor-pointer ${isRtl ? 'flex-row-reverse text-right' : 'text-left'}`}
          >
            <div className="bg-brand-50 dark:bg-brand-900/30 p-2 rounded-xl group-hover:bg-brand-100 dark:group-hover:bg-brand-900 transition-colors">
              <Plus className="text-brand-600 dark:text-brand-400 w-5 h-5" />
            </div>
            {isRtl ? 'محادثة جديدة' : 'New Chat Session'}
          </button>

          {/* History Sections */}
          <div className="flex-1 overflow-y-auto space-y-6 px-1 custom-scrollbar">
            {sessions.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-40 text-slate-400 dark:text-slate-600 space-y-3 opacity-60">
                 <History size={32} strokeWidth={1.5} className="text-slate-300 dark:text-slate-700" />
                 <p className="text-xs font-medium tracking-tight uppercase">{isRtl ? 'لا يوجد سجل محادثات' : 'No history yet'}</p>
              </div>
            ) : (
              <div className="space-y-6">
                {(() => {
                  const now = new Date();
                  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
                  const yesterday = new Date(today);
                  yesterday.setDate(yesterday.getDate() - 1);
                  const sevenDaysAgo = new Date(today);
                  sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);

                  const groups = {
                    today: sessions.filter(s => new Date(s.lastUpdatedAt) >= today),
                    previous: sessions.filter(s => {
                      const d = new Date(s.lastUpdatedAt);
                      return d < today && d >= sevenDaysAgo;
                    }),
                    older: sessions.filter(s => new Date(s.lastUpdatedAt) < sevenDaysAgo)
                  };

                  return (
                    <>
                      {groups.today.length > 0 && (
                        <div>
                          <h3 className={`text-[10px] font-black text-slate-400 dark:text-slate-500 uppercase tracking-widest mb-3 px-2 ${isRtl ? 'text-right' : 'text-left'}`}>
                            {isRtl ? 'اليوم' : 'Today'}
                          </h3>
                          <div className="space-y-1">
                            {groups.today.map(session => (
                              <button 
                                key={session.id}
                                onClick={() => {
                                  setCurrentSessionId(session.id);
                                  if (window.innerWidth < 1024) setIsSidebarOpen(false);
                                }}
                                className={`flex items-center gap-3 w-full p-3 rounded-xl text-sm transition-all group cursor-pointer border ${currentSessionId === session.id ? 'bg-brand-50/50 dark:bg-brand-900/20 border-brand-100 dark:border-brand-800 text-brand-800 dark:text-brand-200 font-bold' : 'text-slate-600 dark:text-slate-400 border-transparent hover:bg-slate-50 dark:hover:bg-slate-800 hover:text-slate-900 dark:hover:text-slate-200'} ${isRtl ? 'flex-row-reverse text-right' : 'text-left'}`}
                              >
                                <MessageSquare className={`w-4 h-4 shrink-0 shadow-sm ${currentSessionId === session.id ? 'text-brand-600 dark:text-brand-400' : 'text-slate-300 dark:text-slate-600 group-hover:text-brand-500'}`} />
                                <span className="truncate flex-1 leading-tight tracking-tight">{session.title}</span>
                              </button>
                            ))}
                          </div>
                        </div>
                      )}

                      {groups.previous.length > 0 && (
                        <div>
                          <h3 className={`text-[10px] font-black text-slate-400 dark:text-slate-500 uppercase tracking-widest mb-3 px-2 ${isRtl ? 'text-right' : 'text-left'}`}>
                            {isRtl ? 'آخر 7 أيام' : 'Previous 7 Days'}
                          </h3>
                          <div className="space-y-1">
                            {groups.previous.map(session => (
                              <button 
                                key={session.id}
                                onClick={() => {
                                  setCurrentSessionId(session.id);
                                  if (window.innerWidth < 1024) setIsSidebarOpen(false);
                                }}
                                className={`flex items-center gap-3 w-full p-3 rounded-xl text-sm transition-all group cursor-pointer border ${currentSessionId === session.id ? 'bg-brand-50/50 dark:bg-brand-900/20 border-brand-100 dark:border-brand-800 text-brand-800 dark:text-brand-200 font-bold' : 'text-slate-600 dark:text-slate-400 border-transparent hover:bg-slate-50 dark:hover:bg-slate-800 hover:text-slate-900 dark:hover:text-slate-200'} ${isRtl ? 'flex-row-reverse text-right' : 'text-left'}`}
                              >
                                <MessageSquare className={`w-4 h-4 shrink-0 ${currentSessionId === session.id ? 'text-brand-600 dark:text-brand-400' : 'text-slate-300 dark:text-slate-600 group-hover:text-brand-500'}`} />
                                <span className="truncate flex-1 leading-tight tracking-tight">{session.title}</span>
                              </button>
                            ))}
                          </div>
                        </div>
                      )}

                      {groups.older.length > 0 && (
                        <div>
                          <h3 className={`text-[10px] font-black text-slate-400 dark:text-slate-500 uppercase tracking-widest mb-3 px-2 ${isRtl ? 'text-right' : 'text-left'}`}>
                            {isRtl ? 'أقدم' : 'Older'}
                          </h3>
                          <div className="space-y-1">
                            {groups.older.map(session => (
                              <button 
                                key={session.id}
                                onClick={() => {
                                  setCurrentSessionId(session.id);
                                  if (window.innerWidth < 1024) setIsSidebarOpen(false);
                                }}
                                className={`flex items-center gap-3 w-full p-3 rounded-xl text-sm transition-all group cursor-pointer border ${currentSessionId === session.id ? 'bg-brand-50/50 dark:bg-brand-900/20 border-brand-100 dark:border-brand-800 text-brand-800 dark:text-brand-200 font-bold' : 'text-slate-600 dark:text-slate-400 border-transparent hover:bg-slate-50 dark:hover:bg-slate-800 hover:text-slate-900 dark:hover:text-slate-200'} ${isRtl ? 'flex-row-reverse text-right' : 'text-left'}`}
                              >
                                <MessageSquare className={`w-4 h-4 shrink-0 ${currentSessionId === session.id ? 'text-brand-600 dark:text-brand-400' : 'text-slate-300 dark:text-slate-600 group-hover:text-brand-500'}`} />
                                <span className="truncate flex-1 leading-tight tracking-tight">{session.title}</span>
                              </button>
                            ))}
                          </div>
                        </div>
                      )}
                    </>
                  );
                })()}
              </div>
            )}
          </div>

          <div className="pt-4 border-t border-slate-50 dark:border-slate-800 mt-auto">
             <div className={`flex items-center gap-3 p-3.5 rounded-2xl bg-white dark:bg-slate-800 border border-slate-100 dark:border-slate-700 shadow-sm ${isRtl ? 'flex-row-reverse text-right' : ''}`}>
                <div className="w-10 h-10 bg-brand-600 rounded-xl flex items-center justify-center text-white text-sm font-black shadow-lg shadow-brand-100 shrink-0">
                   {userName ? userName.charAt(0).toUpperCase() : 'U'}
                </div>
                <div className="flex-1 min-w-0">
                   <p className="text-sm font-bold text-slate-800 dark:text-slate-200 truncate tracking-tight">{userName || 'HETTETY Member'}</p>
                   <div className="flex items-center gap-1.5 opacity-60">
                      <div className="w-1.5 h-1.5 bg-emerald-500 rounded-full animate-pulse"></div>
                      <p className="text-[10px] text-slate-500 dark:text-slate-400 truncate font-black uppercase tracking-wider">{isRtl ? 'مسجّل الدخول' : 'Signed in'}</p>
                   </div>
                </div>
             </div>
          </div>
        </div>
      </motion.aside>

      {/* Main Chat Area */}
      <main className="flex-1 flex flex-col relative h-full min-w-0 bg-white dark:bg-slate-950 transition-colors duration-500">
        {/* Header */}
        <header className={`h-16 border-b border-slate-50 dark:border-slate-800 flex items-center justify-between px-4 sm:px-6 shrink-0 bg-white dark:bg-slate-900 z-20 ${isRtl ? 'flex-row-reverse' : ''}`}>
          <div className={`flex items-center gap-4 ${isRtl ? 'flex-row-reverse' : ''}`}>
            <button 
              onClick={() => setIsSidebarOpen(!isSidebarOpen)}
              className="p-2.5 hover:bg-slate-50 dark:hover:bg-slate-800 rounded-xl text-slate-500 transition-all cursor-pointer border border-transparent hover:border-slate-100 dark:hover:border-slate-700 group"
              aria-label="Toggle Sidebar"
            >
              {isSidebarOpen ? <PanelLeftClose size={20} className="group-hover:text-brand-600" /> : <PanelLeftOpen size={20} className="group-hover:text-brand-600" />}
            </button>
            <div className={`flex items-center gap-3 ${isRtl ? 'flex-row-reverse' : ''}`}>
              <div className="w-9 h-9 bg-brand-50 dark:bg-brand-900/30 rounded-xl flex items-center justify-center shadow-inner">
                 <Sparkles className="text-brand-600 dark:text-brand-400 w-5.5 h-5.5 animate-pulse" />
              </div>
              <h1 className="font-extrabold text-slate-800 dark:text-slate-200 text-sm sm:text-[15px] hidden sm:block tracking-tight italic uppercase">HETTETY AI</h1>
            </div>
          </div>
          
          <div className="flex items-center gap-2">
             <div className="px-3 py-1.5 rounded-full bg-emerald-50 dark:bg-emerald-950/30 text-emerald-700 dark:text-emerald-400 text-[10px] font-black border border-emerald-100 dark:border-emerald-900/50 flex items-center gap-1.5 tracking-wider uppercase">
               <div className="w-1.5 h-1.5 bg-emerald-500 rounded-full"></div>
               {isRtl ? 'بيانات البائعين' : 'SELLER-POSTED DATA'}
             </div>
          </div>
        </header>

        {/* Messages */}
        <div ref={scrollRef} className="flex-1 overflow-y-auto p-4 sm:p-8 space-y-6 bg-[#fcfdfe] dark:bg-slate-950 custom-scrollbar">
          <div className="max-w-3xl mx-auto space-y-10 pb-6">
            {messages.length === 0 && (
              <div className="flex flex-col items-center justify-center h-[50vh] text-center space-y-8 animate-fade-in px-4">
                 <div className="w-24 h-24 bg-white dark:bg-slate-900 border border-slate-100 dark:border-slate-800 rounded-[2rem] flex items-center justify-center shadow-xl shadow-brand-50 transform -rotate-3 hover:rotate-0 transition-transform">
                    <Logo color="currentColor" className="h-12 w-auto text-slate-400" />
                 </div>
                 <div className="space-y-3">
                    <h2 className="text-3xl font-black text-slate-900 dark:text-white tracking-tighter uppercase italic">{isRtl ? 'مساعدك العقاري' : 'Your Property Ally'}</h2>
                    <p className="text-slate-500 dark:text-slate-400 max-w-sm text-[15px] font-medium leading-relaxed opacity-80">
                      {isRtl ? 'أهلاً بك في حتتي AI. كيف يمكنني مساعدتك اليوم في رحلتك العقارية؟' : 'Welcome to HETTETY AI. How can I assist you with your real estate journey today?'}
                    </p>
                 </div>
                 <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 w-full max-w-xl">
                    {[t.ai_quick_1, t.ai_quick_2, t.ai_quick_3, isRtl ? 'خطوات التسجيل العقاري في مصر؟' : 'Legal property registration steps?'].map((q, idx) => (
                      <button 
                        key={idx} 
                        onClick={() => setInput(q)}
                        className={`p-5 rounded-2xl border border-slate-100 dark:border-slate-800 bg-white dark:bg-slate-900 hover:border-brand-300 dark:hover:border-brand-800 hover:shadow-xl hover:shadow-brand-50/10 transition-all text-[13px] font-extrabold text-slate-700 dark:text-slate-300 hover:text-brand-700 dark:hover:text-brand-400 active:scale-95 cursor-pointer flex flex-col gap-1 ${isRtl ? 'text-right' : 'text-left'}`}
                      >
                         <span className="text-[10px] text-brand-400 font-black uppercase tracking-widest block mb-1">PROMPT #{idx + 1}</span>
                         {q}
                      </button>
                    ))}
                 </div>
              </div>
            )}
            {messages.map((m, i) => (
              <div key={i} className={`flex gap-4 sm:gap-6 ${m.role === 'user' ? 'flex-row-reverse' : ''} group animate-fade-in`}>
                <div className={`w-10 h-10 sm:w-12 sm:h-12 rounded-2xl shrink-0 flex items-center justify-center shadow-lg transform transition-transform group-hover:scale-110 ${m.role === 'user' ? 'bg-brand-600 shadow-brand-100' : 'bg-white dark:bg-slate-800 border border-slate-100 dark:border-slate-800 shadow-slate-100'}`}>
                   {m.role === 'user' ? <User size={20} className="text-white" /> : <Logo color="currentColor" className="h-6 w-auto text-brand-600 dark:text-white" />}
                </div>
                <div className={`flex flex-col max-w-[85%] ${m.role === 'user' ? 'items-end' : 'items-start'}`}>
                  <div className={`p-5 sm:p-6 rounded-[2rem] shadow-sm transform transition-all group-hover:shadow-md ${m.role === 'user' ? 'bg-brand-600 text-white rounded-tr-none' : 'bg-white dark:bg-slate-800 border border-slate-100 dark:border-slate-800 text-slate-800 dark:text-slate-200 rounded-tl-none'}`}>
                    <p className={`whitespace-pre-wrap leading-relaxed text-sm sm:text-[16px] font-medium ${isRtl ? 'font-cairo' : ''}`}>{m.text}</p>
                  </div>
                  <span className={`text-[10px] font-black text-slate-400 mt-3 px-2 uppercase tracking-widest opacity-60`}>
                    {m.timestamp.toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})}
                  </span>
                </div>
              </div>
            ))}
            {isLoading && (
              <div className="flex gap-4 sm:gap-6 animate-pulse">
                <div className="w-10 h-10 sm:w-12 sm:h-12 rounded-2xl bg-slate-50 dark:bg-slate-900 border border-slate-100 dark:border-slate-800 flex items-center justify-center shrink-0">
                   <Sparkles className="text-slate-200 dark:text-slate-700 w-6 h-6" />
                </div>
                <div className="flex-1 space-y-3">
                  <div className="h-4 bg-slate-50 dark:bg-slate-900 rounded-full w-1/4"></div>
                  <div className="h-20 bg-slate-50 dark:bg-slate-900 rounded-[2rem] w-3/4"></div>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Input Area */}
        <div className="p-4 sm:p-8 bg-white dark:bg-slate-900 shrink-0 border-t border-slate-50 dark:border-slate-800">
          <div className="max-w-3xl mx-auto relative">
            <div className={`flex items-end gap-3 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-[2rem] p-3 focus-within:border-brand-500 dark:focus-within:border-brand-600 focus-within:ring-8 focus-within:ring-brand-50 dark:focus-within:ring-brand-900/20 transition-all shadow-inner ${isRtl ? 'flex-row-reverse' : ''}`}>
              <textarea 
                value={input} 
                onChange={(e) => setInput(e.target.value)} 
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault();
                    handleSend();
                  }
                }}
                placeholder={t.ai_placeholder} 
                rows={1}
                className={`flex-1 max-h-48 bg-transparent border-0 rounded-2xl px-3 py-3 focus:ring-0 transition-all outline-none text-slate-800 dark:text-slate-200 text-[16px] font-bold resize-none ${isRtl ? 'text-right' : 'text-left'}`} 
              />
              <button 
                onClick={handleSend} 
                disabled={isLoading || !input.trim()} 
                className="bg-brand-600 text-white p-4 rounded-2xl hover:bg-brand-700 transition-all disabled:opacity-20 disabled:grayscale transform active:scale-90 cursor-pointer shadow-xl shadow-brand-200 group"
              >
                <Send size={20} className={`${isRtl ? "rotate-180" : ""} group-hover:translate-x-1 transition-transform`} />
              </button>
            </div>

            {/* Quick Suggestions */}
            <div className="flex gap-2.5 mt-4 overflow-x-auto pb-1 no-scrollbar justify-start sm:justify-center">
              {[t.ai_quick_1, t.ai_quick_2, t.ai_quick_3].map((s, i) => (
                <button 
                  key={i} 
                  onClick={() => setInput(s)} 
                  className="whitespace-nowrap px-4 py-2 rounded-full bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-xs font-semibold text-slate-600 dark:text-slate-400 hover:border-brand-500 hover:text-brand-600 transition-all cursor-pointer shadow-sm hover:shadow-md"
                >
                  {s}
                </button>
              ))}
            </div>
            
            <p className="text-[10px] text-slate-400 dark:text-slate-500 text-center mt-4">
              {isRtl
                ? 'حتتي AI بيحلل بيانات البائعين. أي كلام قانوني لازم تتأكد منه بنفسك في الشهر العقاري.'
                : 'HETTETY AI analyses seller-posted data. Confirm anything legal yourself at the Real Estate Publicity Department.'}
            </p>
          </div>
        </div>
      </main>
    </div>
  );
};

/**
 * How a document's review state is shown. Absent reviewStatus means nobody has
 * looked at it — legacy documents carry a self-asserted status: 'Verified' that
 * no human or system ever checked, so it is deliberately ignored here.
 */
const docReviewInfo = (doc: UserDocument, t: any) => {
  switch (doc.reviewStatus) {
    case 'InReview':
      return { label: t.doc_status_inreview, desc: t.doc_status_inreview_desc,
               chip: 'bg-amber-50 dark:bg-amber-900/20 text-amber-700 dark:text-amber-400 border-amber-200 dark:border-amber-800',
               icon: 'bg-amber-100 dark:bg-amber-900/30 text-amber-600 dark:text-amber-400' };
    case 'Checked':
      return { label: t.doc_status_checked, desc: t.doc_status_checked_desc,
               chip: 'bg-green-50 dark:bg-green-900/20 text-green-700 dark:text-green-400 border-green-200 dark:border-green-800',
               icon: 'bg-green-100 dark:bg-green-900/30 text-green-600 dark:text-green-400' };
    case 'NeedsAttention':
      return { label: t.doc_status_attention, desc: t.doc_status_attention_desc,
               chip: 'bg-red-50 dark:bg-red-900/20 text-red-700 dark:text-red-400 border-red-200 dark:border-red-800',
               icon: 'bg-red-100 dark:bg-red-900/30 text-red-600 dark:text-red-400' };
    default:
      return { label: t.doc_status_uploaded, desc: t.doc_status_uploaded_desc,
               chip: 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 border-slate-200 dark:border-slate-700',
               icon: 'bg-slate-100 dark:bg-slate-800 text-slate-500 dark:text-slate-400' };
  }
};

const LegalCenter = ({ t, isRtl, userEmail }: { t: any, isRtl: boolean, userEmail: string | null }) => {
  const [docs, setDocs] = useState<UserDocument[]>([]);
  const [uploading, setUploading] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [viewingDoc, setViewingDoc] = useState<UserDocument | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const legalModalRef = useFocusTrap<HTMLDivElement>(!!viewingDoc, () => setViewingDoc(null));

  useEffect(() => {
    if (!auth.currentUser) {
      setDocs([]);
      return;
    }

    const q = query(
      collection(db, 'user_documents'),
      where('ownerUid', '==', auth.currentUser.uid)
    );

    const unsubscribe = onSnapshot(q, (snapshot) => {
      const docsData = snapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data()
      })) as UserDocument[];
      setDocs(docsData);
    }, (err) => {
      handleFirestoreError(err, OperationType.GET, 'user_documents');
    });

    return () => unsubscribe();
  }, [userEmail]);

  const handleUploadClick = () => {
    setError(null);
    if (!auth.currentUser) {
      setError(isRtl ? 'يرجى تسجيل الدخول أولاً لرفع المستندات.' : 'Please sign in first to upload documents.');
      return;
    }
    fileInputRef.current?.click();
  };

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    setError(null);
    const file = e.target.files?.[0];
    if (!file) return;

    if (!auth.currentUser) {
      setError(isRtl ? 'يرجى تسجيل الدخول أولاً لرفع المستندات.' : 'Please sign in first to upload documents.');
      return;
    }

    const MAX_SIZE = 5 * 1024 * 1024; 
    if (file.size > MAX_SIZE) {
      setError(isRtl ? 'حجم الملف يتجاوز الحد الأقصى (5 ميجابايت).' : 'File size exceeds the maximum limit (5MB).');
      if (fileInputRef.current) fileInputRef.current.value = '';
      return;
    }

    const allowedTypes = ['application/pdf', 'image/jpeg', 'image/png', 'image/jpg', 'application/msword', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'];
    if (!allowedTypes.includes(file.type)) {
      setError(isRtl ? 'نوع الملف غير مدعوم. يرجى رفع ملفات PDF أو صور أو مستندات.' : 'Unsupported file type. Please upload PDF, images, or documents.');
      if (fileInputRef.current) fileInputRef.current.value = '';
      return;
    }

    setUploading(true);
    const newDocName = file.name;
    
    try {
      let fileToUpload = file;
      if (file.type.includes('image')) {
        try {
          const options = { maxSizeMB: 1, maxWidthOrHeight: 1920, useWebWorker: true };
          fileToUpload = await imageCompression(file, options);
        } catch (compressionError) {
          console.warn("Image compression failed, uploading original:", compressionError);
        }
      }

      const storagePath = `user_documents/${auth.currentUser.uid}/${Date.now()}_${fileToUpload.name}`;
      const fileRef = ref(storage, storagePath);
      const uploadResult = await uploadBytes(fileRef, fileToUpload);
      const downloadUrl = await getDownloadURL(uploadResult.ref);

      
      // Uploading a file is not verifying it. The document starts unreviewed and
      // only an admin can move it on — see the user_documents rules.
      const newDocData = {
          fileId: `DOC-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
          name: newDocName,
          type: file.type.includes('image') ? 'Image' : file.type.includes('pdf') ? 'PDF' : 'Document',
          reviewStatus: 'Uploaded',
          uploadDate: new Date().toISOString().split('T')[0],
          size: fileToUpload.size,
          content: downloadUrl,
          ownerUid: auth.currentUser!.uid,
          storagePath: storagePath
      };

      await addDoc(collection(db, 'user_documents'), newDocData);
    } catch (err) {
      setError(isRtl ? 'فشل رفع المستند. يرجى المحاولة مرة أخرى.' : 'Failed to upload document. Please try again.');
      console.error('Upload Error:', err);
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  /**
   * Documents uploaded before reviewStatus existed carry no state, so the admin's
   * queue query cannot see them. This is the owner's way of joining the queue —
   * the only reviewStatus value they may ever write, enforced by the rules.
   */
  const handleRequestReview = async (docData: UserDocument) => {
    setError(null);
    try {
      await updateDoc(doc(db, 'user_documents', docData.id), { reviewStatus: 'Uploaded' });
    } catch (err) {
      console.error('Review request failed:', err);
      setError(isRtl ? 'تعذّر إرسال المستند للمراجعة.' : 'Could not send this document for review.');
    }
  };

  const handleDelete = async (docData: UserDocument) => {
    if (!window.confirm(isRtl ? 'هل أنت متأكد من حذف هذا المستند؟' : 'Are you sure you want to delete this document?')) return;
    try {
      // Delete the file first. If that fails, keep the Firestore row: dropping it
      // would leave a live download URL behind with nothing pointing at it. A file
      // that is already gone is not a failure — otherwise the row is undeletable.
      // Documents uploaded before storagePath was recorded still have an object;
      // the download URL is the only pointer to it, and this row is about to
      // destroy that URL.
      const path = docData.storagePath || storagePathFromUrl(docData.content);
      if (path) {
        await deleteObject(ref(storage, path)).catch((err: any) => {
          if (err?.code !== 'storage/object-not-found') throw err;
        });
      }
      await deleteDoc(doc(db, 'user_documents', docData.id));
    } catch (err) {
      setError(isRtl ? 'فشل حذف المستند.' : 'Failed to delete document.');
      console.error('Delete Error:', err);
    }
  };

  const formatSize = (bytes?: number) => {
    if (!bytes) return '';
    const mb = bytes / (1024 * 1024);
    return `${mb.toFixed(1)} MB`;
  };

  const filteredDocs = docs.filter(doc => 
    doc.name.toLowerCase().includes(searchQuery.toLowerCase()) || 
    doc.type.toLowerCase().includes(searchQuery.toLowerCase()) ||
    (doc.fileId && doc.fileId.toLowerCase().includes(searchQuery.toLowerCase()))
  );

  return (
    <div className="max-w-6xl mx-auto px-4 py-12 animate-fade-in transition-colors duration-500">
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center mb-10 gap-4">
        <div>
          <h2 className="text-3xl font-heading font-bold text-slate-900 dark:text-white">{t.legal_title}</h2>
          <p className="text-slate-500 dark:text-slate-400 mt-1">{isRtl ? 'إدارة المستندات القانونية الخاصة بك بأمان.' : 'Securely manage your personal legal documents.'}</p>
        </div>
        <div className="flex flex-col sm:flex-row gap-3 w-full md:w-auto">
          <div className="relative flex-1 sm:w-64">
            <Search className={"absolute top-1/2 -translate-y-1/2 text-slate-400 w-4 h-4 start-3"} />
            <input 
              type="text" 
              placeholder={isRtl ? "البحث بالاسم أو المعرف..." : "Search by name or ID..."}
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className={`w-full bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl py-2.5 focus:ring-2 focus:ring-brand-500 outline-none text-sm text-slate-700 dark:text-slate-200 ps-9 pe-4`}
            />
          </div>
          <input type="file" ref={fileInputRef} onChange={handleFileChange} className="hidden" accept=".pdf,.jpg,.jpeg,.png,.doc,.docx" />
          <Button onClick={handleUploadClick} disabled={uploading} className="w-full sm:w-auto whitespace-nowrap">
            {uploading ? <Loader2 className="animate-spin w-4 h-4" /> : <Upload className="w-4 h-4" />}
            {uploading ? t.legal_uploading : t.legal_upload}
          </Button>
        </div>
      </div>
      
      {error && (
        <div className="mb-6 p-4 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 text-red-700 dark:text-red-400 rounded-xl flex items-center gap-3">
          <ShieldCheck className="w-5 h-5 shrink-0" />
          <p className="text-sm font-medium">{error}</p>
        </div>
      )}

      <div className="grid md:grid-cols-3 gap-8">
        <div className="md:col-span-2 space-y-4">
           {filteredDocs.length > 0 ? filteredDocs.map(doc => {
             const rev = docReviewInfo(doc, t);
             return (
             <div key={doc.id} className="bg-white dark:bg-slate-900 p-5 rounded-xl border border-slate-200 dark:border-slate-800 shadow-sm hover:shadow-md transition-shadow">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                <div className="flex items-center gap-4 overflow-hidden">
                  <div className={`shrink-0 w-12 h-12 rounded-lg flex items-center justify-center ${rev.icon}`}><FileText size={24} aria-hidden="true" /></div>
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      <span className="text-xs font-mono bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400 px-2 py-0.5 rounded">{doc.fileId}</span>
                      <h4 className="font-bold text-slate-800 dark:text-slate-200 truncate">{doc.name}</h4>
                    </div>
                    <p className="text-xs text-slate-500 dark:text-slate-400 uppercase tracking-wide">{doc.type} • {doc.uploadDate} {doc.size ? `• ${formatSize(doc.size)}` : ''}</p>
                  </div>
                </div>
                <div className="flex items-center gap-3 sm:ml-4 shrink-0 justify-between sm:justify-end">
                  <div className={`px-3 py-1 rounded-full text-xs font-bold border ${rev.chip}`}>{rev.label}</div>
                  <div className="flex items-center gap-2">
                    {!doc.reviewStatus && (
                      <button onClick={() => handleRequestReview(doc)} className="text-xs font-medium text-slate-700 dark:text-slate-200 bg-slate-100 dark:bg-slate-800 px-3 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 hover:bg-slate-700 hover:text-white transition-colors cursor-pointer">
                        {isRtl ? 'اطلب مراجعة' : 'Request review'}
                      </button>
                    )}
                    <button onClick={() => setViewingDoc(doc)} className="text-xs font-medium text-brand-600 dark:text-brand-400 bg-brand-50 dark:bg-brand-900/30 px-3 py-1.5 rounded-lg border border-brand-200 dark:border-brand-800 hover:bg-brand-100 dark:hover:bg-brand-900/50 transition-colors cursor-pointer">
                      {isRtl ? 'عرض' : 'View'}
                    </button>
                    <button onClick={() => handleDelete(doc)} className="p-1.5 text-red-400 hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-900/30 rounded-lg transition-colors cursor-pointer" title={isRtl ? 'حذف' : 'Delete'}>
                      <Trash2 size={16} aria-hidden="true" />
                    </button>
                  </div>
                </div>
              </div>
              {/* What the state actually means, in the row itself. Burying the
                  caveat behind a click is how "Reviewed" gets read as "genuine". */}
              <p className="mt-3 text-xs text-slate-500 dark:text-slate-400">{rev.desc}</p>
              {doc.reviewNote && (
                <div className="mt-4 pt-4 border-t border-slate-100 dark:border-slate-800">
                  <p className="text-xs font-bold text-slate-500 dark:text-slate-400 mb-1">{t.doc_review_note}</p>
                  <p className="text-sm text-slate-700 dark:text-slate-300 whitespace-pre-wrap">{doc.reviewNote}</p>
                </div>
              )}
             </div>
             );
            }) : (
              <div className="bg-white dark:bg-slate-900 p-8 rounded-xl border border-slate-200 dark:border-slate-800 text-center text-slate-500 dark:text-slate-400">
                {isRtl ? "لم يتم العثور على ملفات." : "No files found."}
              </div>
            )}
        </div>
        <div className="space-y-6">
           <div className="bg-slate-900 dark:bg-slate-800 text-white p-6 rounded-2xl border border-slate-800 overflow-hidden relative">
             <div className="absolute top-0 right-0 p-4 opacity-10"><Shield size={80} /></div>
             <h3 className="font-bold mb-4 flex items-center gap-2 relative z-10"><ShieldCheck className="text-brand-400" /> {t.legal_status}</h3>
             <div className="space-y-4 relative z-10">
               {([
                 { label: t.legal_stat_1, n: docs.filter(d => !d.reviewStatus || d.reviewStatus === 'Uploaded').length, color: 'text-slate-300' },
                 { label: t.legal_stat_2, n: docs.filter(d => d.reviewStatus === 'InReview').length, color: 'text-amber-400' },
                 { label: t.legal_stat_3, n: docs.filter(d => d.reviewStatus === 'NeedsAttention').length, color: 'text-red-400' },
                 { label: t.legal_stat_4, n: docs.filter(d => d.reviewStatus === 'Checked').length, color: 'text-green-400' },
               ]).map((row) => (
                 <div key={row.label} className="flex justify-between items-center text-sm">
                   <span className="text-slate-400">{row.label}</span>
                   <span className={`font-black tabular-nums ${row.color}`}>{row.n}</span>
                 </div>
               ))}
             </div>
           </div>
           <div className="bg-brand-50 dark:bg-brand-900/20 border border-brand-100 dark:border-brand-800 p-6 rounded-2xl">
             <h3 className="font-bold text-brand-900 dark:text-brand-300 mb-2 text-sm">{t.legal_privacy_title}</h3>
             <p className="text-xs text-brand-700 dark:text-brand-400 leading-relaxed">{t.legal_privacy}</p>
           </div>
        </div>
      </div>

      {viewingDoc && (
        <div 
          className="fixed inset-0 z-[100] bg-slate-900/60 backdrop-blur-sm flex items-center justify-center p-4 animate-fade-in"
          onClick={() => setViewingDoc(null)}
        >
          <div 
            ref={legalModalRef}
            role="dialog"
            aria-modal="true"
            aria-labelledby="legal-doc-modal-title"
            className="bg-white dark:bg-slate-900 rounded-2xl w-full max-w-4xl max-h-[90vh] flex flex-col overflow-hidden shadow-2xl border border-slate-200 dark:border-slate-800"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex justify-between items-center p-4 border-b border-slate-100 dark:border-slate-800 bg-slate-50 dark:bg-slate-800">
              <div className="flex items-center gap-3">
                <div className="bg-brand-100 dark:bg-brand-900 text-brand-600 dark:text-brand-400 p-2 rounded-lg">
                  <FileText size={20} aria-hidden="true" />
                </div>
                <div>
                  <h3 id="legal-doc-modal-title" className="font-bold text-slate-900 dark:text-white">{viewingDoc.name}</h3>
                  <p className="text-xs text-slate-500 dark:text-slate-400">{viewingDoc.fileId} • {viewingDoc.type}</p>
                </div>
                <div className={`px-3 py-1 rounded-full text-xs font-bold border ${docReviewInfo(viewingDoc, t).chip}`}>
                  {docReviewInfo(viewingDoc, t).label}
                </div>
              </div>
              <button 
                type="button"
                onClick={() => setViewingDoc(null)} 
                aria-label={isRtl ? "إغلاق المستند" : "Close document viewer"}
                className="min-w-[48px] min-h-[48px] p-3 text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200 hover:bg-slate-200 dark:hover:bg-slate-700 rounded-full transition-colors cursor-pointer flex items-center justify-center focus:outline-none focus:ring-2 focus:ring-brand-500"
              >
                <X size={20} aria-hidden="true" />
              </button>
            </div>
            <div className="flex-1 bg-slate-100 dark:bg-slate-950 p-8 flex items-center justify-center overflow-y-auto">
              {viewingDoc.type === 'Image' || viewingDoc.name.match(/\.(jpg|jpeg|png)$/i) ? (
                <div className="max-w-full max-h-full flex flex-col items-center justify-center">
                  <div className="bg-white dark:bg-slate-900 p-2 rounded-xl shadow-sm border border-slate-200 dark:border-slate-800 flex flex-col items-center justify-center overflow-hidden">
                    <img 
                      src={viewingDoc.content || `https://picsum.photos/seed/${viewingDoc.id}/800/600`} 
                      alt={viewingDoc.name} 
                      className="max-w-full max-h-[60vh] object-contain rounded-lg"
                      referrerPolicy="no-referrer"
                    />
                  </div>
                  <p className="text-sm font-medium mt-4 text-slate-600 dark:text-slate-400">{viewingDoc.name}</p>
                </div>
              ) : viewingDoc.type === 'PDF' && viewingDoc.content ? (
                <div className="w-full h-full min-h-[600px] bg-white dark:bg-slate-900 rounded-xl shadow-sm border border-slate-200 dark:border-slate-800 overflow-hidden">
                  <iframe 
                    src={viewingDoc.content} 
                    title={viewingDoc.name}
                    className="w-full h-full min-h-[600px] border-0"
                  />
                </div>
              ) : (
                <div className="bg-white dark:bg-slate-900 w-full max-w-2xl min-h-[600px] shadow-sm border border-slate-200 dark:border-slate-800 rounded-xl p-12">
                  <div className="border-b border-slate-200 dark:border-slate-800 pb-6 mb-6">
                    <div className="flex justify-between items-start mb-8">
                      <Logo color="currentColor" className="h-8 text-brand-600 dark:text-white" />
                      <div className="text-right">
                        <h1 className="text-2xl font-serif font-bold text-slate-900 dark:text-white">{viewingDoc.type}</h1>
                        <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">{viewingDoc.fileId}</p>
                      </div>
                    </div>
                    <h2 className="text-xl font-bold text-slate-800 dark:text-slate-200 mb-2">{viewingDoc.name.replace(/\.[^/.]+$/, "")}</h2>
                    <p className="text-sm text-slate-500 dark:text-slate-400">{isRtl ? 'تاريخ الرفع:' : 'Upload Date:'} {viewingDoc.uploadDate}</p>
                  </div>
                  <div className="space-y-4 text-slate-600 dark:text-slate-400 leading-relaxed text-sm">
                    <p className="font-semibold mb-4 text-slate-900 dark:text-white">{isRtl ? 'محتوى المستند:' : 'Document Content:'}</p>
                    {viewingDoc.content && viewingDoc.content.startsWith('data:text') ? (
                      <div className="p-4 bg-slate-50 dark:bg-slate-800 border border-slate-100 dark:border-slate-700 rounded-lg whitespace-pre-wrap font-mono text-xs overflow-auto max-h-64">
                        {(() => {
                          // atob throws on malformed base64 — never let it crash the render
                          try { return atob(viewingDoc.content.split(',')[1] || ''); }
                          catch { return isRtl ? 'تعذر عرض محتوى المستند.' : 'Unable to display document content.'; }
                        })()}
                      </div>
                    ) : (
                      <p>{docReviewInfo(viewingDoc, t).desc}</p>
                    )}
                    <div className="mt-8 p-4 bg-slate-50 dark:bg-slate-800 border border-slate-100 dark:border-slate-700 rounded-lg">
                      <p className="text-xs text-slate-500 dark:text-slate-500 font-mono">
                        ID: {viewingDoc.fileId}<br/>
                        Name: {viewingDoc.name}<br/>
                        Type: {viewingDoc.type}<br/>
                        Size: {viewingDoc.size ? (viewingDoc.size / 1024 / 1024).toFixed(2) + ' MB' : 'Unknown'}
                      </p>
                    </div>
                  </div>
                  <div className="mt-16 pt-8 border-t border-slate-200 dark:border-slate-800 flex justify-between items-center gap-4 flex-wrap">
                    <div className="text-xs text-slate-400 dark:text-slate-500 max-w-md">{docReviewInfo(viewingDoc, t).desc}</div>
                    <div className={`px-3 py-1 rounded-full text-xs font-bold border ${docReviewInfo(viewingDoc, t).chip}`}>
                      {docReviewInfo(viewingDoc, t).label}
                    </div>
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

const Viewer3D = ({ property, onClose, isRtl }: { property: Property | undefined, onClose: () => void, t: any, isRtl: boolean }) => {
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

/** Unit types grouped into the categories a buyer actually shops by. */
const UNIT_CATEGORIES: { key: string; ar: string; en: string; types: string[] }[] = [
  { key: 'apartments', ar: 'شقق', en: 'Apartments', types: ['Apartment', 'Duplex', 'Penthouse', 'Studio'] },
  { key: 'villas', ar: 'فلل', en: 'Villas', types: ['Villa', 'Townhouse'] },
  { key: 'chalets', ar: 'شاليهات', en: 'Chalets', types: ['Chalet'] },
  { key: 'commercial', ar: 'تجاري وإداري', en: 'Commercial', types: ['Office', 'Retail'] },
  { key: 'land', ar: 'أراضي', en: 'Land', types: ['Land'] },
];

/**
 * A whole compound on one page: its units split into the categories a buyer
 * shops by (apartments / villas / ...), each with its own price, area and
 * bedroom filters. Reached from the Projects view or #project/<compound>.
 */
const ProjectPage = ({
  projectName, units, onBack, onOpenProperty, onView3D, onToggleFavorite, userFavorites,
  onToggleCompare, compareIds, t, isRtl,
}: {
  projectName: string; units: Property[]; onBack: () => void;
  onOpenProperty: (id: string) => void; onView3D: (id: string) => void;
  onToggleFavorite: (id: string) => void; userFavorites: string[];
  onToggleCompare: (id: string) => void; compareIds: string[];
  t: any; isRtl: boolean;
}) => {
  // Only show a tab for a category this project actually has units in.
  const categories = useMemo(() => {
    const present = UNIT_CATEGORIES
      .map(c => ({ ...c, units: units.filter(u => c.types.includes(u.propertyType || '')) }))
      .filter(c => c.units.length > 0);
    const categorised = new Set(present.flatMap(c => c.units.map(u => u.id)));
    const rest = units.filter(u => !categorised.has(u.id));
    if (rest.length) {
      present.push({ key: 'other', ar: 'وحدات أخرى', en: 'Other units', types: [], units: rest });
    }
    return present;
  }, [units]);

  const [tabIndex, setTabIndex] = useState(0);
  const [maxPrice, setMaxPrice] = useState<number | ''>('');
  const [minArea, setMinArea] = useState<number | ''>('');
  const [minBeds, setMinBeds] = useState(0);
  // Each category has its own price/area range, so carrying filters across tabs would mislead.
  const clearFilters = () => { setMaxPrice(''); setMinArea(''); setMinBeds(0); };

  const tab = Math.min(tabIndex, Math.max(categories.length - 1, 0));
  const activeUnits = categories[tab] ? categories[tab].units : [];

  const shown = activeUnits.filter(u =>
    (maxPrice === '' || u.price <= Number(maxPrice)) &&
    (minArea === '' || (u.area || 0) >= Number(minArea)) &&
    (minBeds === 0 || (u.bedrooms || 0) >= minBeds)
  );

  const lead = units[0];
  const prices = units.map(u => u.price).filter(Boolean);
  const areas = units.map(u => u.area).filter(Boolean);
  const currency = lead?.currency || 'EGP';
  const fmt = (n: number) => n.toLocaleString();

  return (
    <div className="animate-fade-in">
      <div className="relative h-64 sm:h-80 overflow-hidden">
        {lead?.imageUrl && <img src={lead.imageUrl} alt={projectName} className="w-full h-full object-cover" />}
        <div className="absolute inset-0 bg-gradient-to-t from-black/85 via-black/40 to-black/20" />
        <div className="absolute inset-0 max-w-6xl mx-auto px-4 flex flex-col justify-end pb-8">
          <button onClick={onBack} className="self-start mb-auto mt-6 flex items-center gap-2 text-white/90 hover:text-white font-bold bg-black/30 backdrop-blur px-4 py-2 rounded-full cursor-pointer">
            {isRtl ? <ArrowRight size={18} aria-hidden="true" /> : <ArrowLeft size={18} aria-hidden="true" />}
            {isRtl ? 'رجوع' : 'Back'}
          </button>
          <h1 className="text-3xl sm:text-5xl font-heading font-black text-white mb-2">{projectName}</h1>
          <div className="flex items-center gap-x-4 gap-y-1 flex-wrap text-white/85 text-sm font-medium">
            {lead?.developer && <span>{isRtl ? 'المطوّر:' : 'Developer:'} <strong>{lead.developer}</strong></span>}
            {lead?.location && <span className="flex items-center gap-1"><MapPin size={14} aria-hidden="true" /> {lead.location}</span>}
            {lead?.deliveryDate && <span>{isRtl ? 'الاستلام:' : 'Delivery:'} <strong>{lead.deliveryDate}</strong></span>}
          </div>
        </div>
      </div>

      <div className="max-w-6xl mx-auto px-4 py-8">
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-4 mb-8">
          <div className="bg-slate-50 dark:bg-slate-800 rounded-2xl p-5 text-center border border-slate-100 dark:border-slate-700">
            <div className="text-2xl font-black text-slate-900 dark:text-white">{units.length}</div>
            <div className="text-sm text-slate-500 dark:text-slate-400 mt-1">{isRtl ? 'وحدة متاحة' : 'Units available'}</div>
          </div>
          {prices.length > 0 && (
            <div className="bg-slate-50 dark:bg-slate-800 rounded-2xl p-5 text-center border border-slate-100 dark:border-slate-700">
              <div className="text-lg font-black text-brand-600 dark:text-brand-400">{isRtl ? 'تبدأ من' : 'From'} {fmt(Math.min(...prices))}</div>
              <div className="text-sm text-slate-500 dark:text-slate-400 mt-1">{currency}</div>
            </div>
          )}
          {areas.length > 0 && (
            <div className="bg-slate-50 dark:bg-slate-800 rounded-2xl p-5 text-center border border-slate-100 dark:border-slate-700">
              <div className="text-lg font-black text-slate-900 dark:text-white">{Math.min(...areas)} - {Math.max(...areas)}</div>
              <div className="text-sm text-slate-500 dark:text-slate-400 mt-1">{isRtl ? 'م²' : 'm²'}</div>
            </div>
          )}
        </div>

        {categories.length > 0 && (
          <div role="tablist" aria-label={isRtl ? 'أنواع الوحدات' : 'Unit types'} className="flex gap-2 flex-wrap mb-6 border-b border-slate-200 dark:border-slate-800">
            {categories.map((c, i) => (
              <button
                key={c.key}
                role="tab"
                aria-selected={i === tab}
                onClick={() => { setTabIndex(i); clearFilters(); }}
                className={`px-5 py-3 font-bold text-sm transition-all border-b-2 -mb-px cursor-pointer rounded-t focus:outline-none focus:ring-2 focus:ring-brand-500 ${i === tab ? 'border-brand-600 text-brand-600 dark:text-brand-400' : 'border-transparent text-slate-500 dark:text-slate-400 hover:text-slate-800 dark:hover:text-slate-200'}`}
              >
                {isRtl ? c.ar : c.en} <span className="text-xs opacity-70">({c.units.length})</span>
              </button>
            ))}
          </div>
        )}

        <div className="bg-slate-50 dark:bg-slate-800/50 rounded-2xl border border-slate-200 dark:border-slate-800 p-4 mb-6 grid sm:grid-cols-3 gap-4">
          <div>
            <label htmlFor="proj-price" className="block text-sm font-bold text-slate-700 dark:text-slate-300 mb-1.5">{isRtl ? 'أقصى سعر' : 'Max price'}</label>
            <input id="proj-price" type="number" min="0" value={maxPrice}
              onChange={e => setMaxPrice(e.target.value === '' ? '' : Number(e.target.value))}
              placeholder={prices.length ? fmt(Math.max(...prices)) : ''}
              className="w-full px-4 py-2.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-900 dark:text-white outline-none focus:ring-2 focus:ring-brand-500" />
          </div>
          <div>
            <label htmlFor="proj-area" className="block text-sm font-bold text-slate-700 dark:text-slate-300 mb-1.5">{isRtl ? 'أقل مساحة (م²)' : 'Min area (m²)'}</label>
            <input id="proj-area" type="number" min="0" value={minArea}
              onChange={e => setMinArea(e.target.value === '' ? '' : Number(e.target.value))}
              placeholder={areas.length ? String(Math.min(...areas)) : ''}
              className="w-full px-4 py-2.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-900 dark:text-white outline-none focus:ring-2 focus:ring-brand-500" />
          </div>
          <div>
            <label htmlFor="proj-beds" className="block text-sm font-bold text-slate-700 dark:text-slate-300 mb-1.5">{isRtl ? 'عدد الغرف' : 'Bedrooms'}</label>
            <select id="proj-beds" value={minBeds} onChange={e => setMinBeds(Number(e.target.value))}
              className="w-full px-4 py-2.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-900 dark:text-white outline-none focus:ring-2 focus:ring-brand-500">
              <option value={0}>{isRtl ? 'أي عدد' : 'Any'}</option>
              {[1, 2, 3, 4, 5].map(n => <option key={n} value={n}>{n}+</option>)}
            </select>
          </div>
        </div>

        <p className="text-sm text-slate-500 dark:text-slate-400 mb-4" aria-live="polite">
          {isRtl ? `${shown.length} من ${activeUnits.length} وحدة` : `Showing ${shown.length} of ${activeUnits.length} units`}
        </p>

        {shown.length === 0 ? (
          <div className="text-center py-16 text-slate-400">
            <p className="font-bold mb-3">{isRtl ? 'مفيش وحدات مطابقة للاختيارات دي.' : 'No units match these filters.'}</p>
            <button onClick={clearFilters} className="bg-brand-600 hover:bg-brand-700 text-white px-6 py-2.5 rounded-full font-bold cursor-pointer">
              {isRtl ? 'امسح الفلاتر' : 'Clear filters'}
            </button>
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-8">
            {shown.map(p => (
              <PropertyCard key={p.id} property={p}
                onView3D={() => onView3D(p.id)}
                onToggleFavorite={() => onToggleFavorite(p.id)}
                isFavorited={userFavorites.includes(p.id)}
                onToggleCompare={() => onToggleCompare(p.id)}
                isComparing={compareIds.includes(p.id)}
                onClick={() => onOpenProperty(p.id)}
                t={t} isRtl={isRtl} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
};

const PropertyDetailPage = ({ property, onBack, onPurchase, onOpenProject, t, isRtl }: { property: Property, onBack: () => void, onPurchase: (id: string) => void, onOpenProject?: (name: string) => void, t: any, isRtl: boolean }) => {
  const [currentImageIndex, setCurrentImageIndex] = useState(0);
  const [show3D, setShow3D] = useState(false);
  const [calcDown, setCalcDown] = useState(10); // installment estimate: down payment %
  const [calcYears, setCalcYears] = useState(5);
  const [reporting, setReporting] = useState(false);
  const [reviews, setReviews] = useState<any[]>([]);
  const [reviewRating, setReviewRating] = useState(5);
  const [reviewComment, setReviewComment] = useState('');
  const [submittingReview, setSubmittingReview] = useState(false);
  const displayImages = (property.images && property.images.length > 0 ? property.images : [property.imageUrl]).filter(Boolean);
  // Unified media carousel so the photos stay reachable even when a video exists.
  const slides: { type: 'video' | 'image'; src: string }[] = [
    ...(property.videoUrl ? [{ type: 'video' as const, src: property.videoUrl }] : []),
    ...displayImages.map((src) => ({ type: 'image' as const, src })),
  ];

  const [messages, setMessages] = useState<ChatMessage[]>([
    { role: 'model', text: isRtl ? `أهلاً! أنا المساعد الذكي الخاص بهذا العقار (${property.title}). اسألني عن تفاصيل العقار، الأوراق القانونية، حالة إعادة البيع، أو رقم الشهر العقاري.` : `Hello! I'm the AI assistant for this property (${property.title}). Ask me about its details, legal documents, resale status, or registry number.`, timestamp: new Date() }
  ]);
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  // Reset the view whenever a different property is opened
  useEffect(() => {
    setCurrentImageIndex(0);
    setShow3D(false);
    window.scrollTo(0, 0);
  }, [property.id]);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages]);

  const handleSendMessage = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!input.trim() || isLoading) return;

    const userText = input;
    const newMessages: ChatMessage[] = [...messages, { role: 'user', text: userText, timestamp: new Date() }];
    setMessages(newMessages);
    setInput('');
    setIsLoading(true);

    try {
      {
        const systemPrompt = `You are an expert broker and financial analyst for a specific real estate property on HETTETY — Egypt's premier verified property platform. Your goal is to guide users through this property's data with professional insight.

Answer questions ONLY about this property based on the following data:
Title: ${property.title}
Price: ${property.price} EGP
Location: ${property.location}
Area: ${property.area} sqm
Bedrooms: ${property.bedrooms}
Bathrooms: ${property.bathrooms}
Status: ${property.status}
Availability: ${property.availability || 'Available'}
Payment Methods: ${property.paymentMethods?.join(', ') || 'Not specified'}
Unit Code: ${property.unitCode || 'N/A'}
Registry Number AS TYPED BY THE SELLER, unverified by HETTETY: ${property.registrationNumber || 'Not provided'}
Court Signature — the seller ticked a checkbox, nobody checked it: ${property.courtSignatureValidity ? 'seller ticked it' : 'not ticked'}
Document review state: ${property.verificationStatus === 'Verified' ? 'a HETTETY reviewer read the documents the seller uploaded — this is NOT proof of authenticity or of registration with the Real Estate Publicity Department' : 'no reviewer has looked at this listing yet'}
Resale: ${property.isResale ? 'Yes, this is a resale property.' : 'No, direct sale.'}
Description: ${property.description || 'N/A'}
Images: ${property.images?.length ? property.images.join(', ') : property.imageUrl} (If the user asks to see the apartment / shape of the apartment / sor el shaqa, you MUST output ALL these images exactly in markdown format like this: ![Apartment](URL1) ![Apartment](URL2) etc.)

## Tone & Voice
- Professional & Insightful: Provide context like price per square meter analysis.
- Empowering, Not Defensive: Never say "I can't provide investment advice." Instead use "Based on current market data, here is an analysis to help you decide."
- Brand Aligned: Minimalist, clear, and high-end.

## Interaction Rules
- When asked "Is this a good investment?": Analyze the price vs. area average. Never vouch for the property's legal safety: the registry number and court-signature box are the seller's own claims. Say what the document review state is, and that confirming ownership requires a search at the Real Estate Publicity Department (الشهر العقاري).
- Multi-Modal: Use data from images (like floor plans, if available) to explain spatial efficiency.
- Language: Keep your answers helpful and in the exact language the user speaks (English, Egyptian Arabic, Franco). Do not invent information not in the data provided.
- 3D Viewing (Special Capability): You can launch an immersive 3D gallery of this property's photos. When the user asks to see the apartment in 3D, take a virtual tour, walk through it, or says things like "عرضلي الشقة 3D" / "عايز أشوفها مجسمة" / "warini el sha2a 3D", reply with a short enthusiastic confirmation in the user's language and append the exact token [SHOW_3D] at the very end of your reply.`;

        const response = await generateContentResilient({
          task: 'chat',
          contents: newMessages.map(m => ({ role: m.role === 'model' ? 'model' : 'user', parts: [{ text: m.text }] })),
          config: {
            systemInstruction: systemPrompt
          }
        });

        let aiText = response.text || "Sorry, I couldn't process that request.";

        const { cleanText, show3D: wants3D } = extract3DMarker(aiText);
        if (wants3D) {
          aiText = cleanText || (isRtl ? 'جاري فتح الجولة ثلاثية الأبعاد...' : 'Opening the 3D tour...');
          setShow3D(true);
        }

        setMessages([...newMessages, { role: 'model', text: aiText, timestamp: new Date() }]);
      }
    } catch (err) {
      console.error(err);
      setMessages([...newMessages, { role: 'model', text: aiErrorMessage(err, isRtl), timestamp: new Date() }]);
    } finally {
      setIsLoading(false);
    }
  };

  // Per-listing SEO structured data (helps this unit earn rich results).
  useEffect(() => {
    const script = document.createElement('script');
    script.type = 'application/ld+json';
    script.id = 'listing-jsonld';
    script.text = JSON.stringify({
      '@context': 'https://schema.org',
      '@type': 'Residence',
      name: property.title,
      description: property.description || property.title,
      image: property.imageUrl || (property.images && property.images[0]) || undefined,
      address: { '@type': 'PostalAddress', addressLocality: property.location, addressCountry: 'EG' },
      numberOfRooms: property.bedrooms,
      floorSize: { '@type': 'QuantitativeValue', value: property.area, unitCode: 'MTK' },
      offers: {
        '@type': 'Offer',
        price: property.price,
        priceCurrency: property.currency || 'EGP',
        availability: property.availability === 'Sold' ? 'https://schema.org/SoldOut' : 'https://schema.org/InStock',
      },
    });
    document.head.appendChild(script);
    return () => { const el = document.getElementById('listing-jsonld'); if (el) el.remove(); };
  }, [property]);

  const av = availabilityInfo(property.availability, property.status, isRtl);
  const mapsQuery = encodeURIComponent([property.compound, property.location].filter(Boolean).join(', '));
  const mapsUrl = (property.lat && property.lng)
    ? `https://www.google.com/maps/search/?api=1&query=${property.lat},${property.lng}`
    : `https://www.google.com/maps/search/?api=1&query=${mapsQuery}`;

  useEffect(() => {
    (async () => {
      try {
        const snap = await getDocs(query(collection(db, 'reviews'), where('propertyId', '==', property.id)));
        setReviews(snap.docs.map(d => ({ id: d.id, ...d.data() })));
      } catch (e) { console.error('reviews load failed', e); }
    })();
  }, [property.id]);

  const avgRating = reviews.length ? reviews.reduce((s, r) => s + (r.rating || 0), 0) / reviews.length : 0;

  const submitReview = async () => {
    if (!auth.currentUser) { alert(isRtl ? 'سجّل الدخول عشان تقيّم.' : 'Sign in to review.'); return; }
    if (!reviewComment.trim()) return;
    setSubmittingReview(true);
    try {
      const reviewDocId = `${property.id}_${auth.currentUser.uid}`;
      const rev = {
        propertyId: property.id,
        userId: auth.currentUser.uid,
        userName: auth.currentUser.displayName || (auth.currentUser.email || '').split('@')[0] || 'User',
        rating: reviewRating,
        comment: reviewComment.trim().slice(0, 999),
        createdAt: new Date().toISOString(),
      };
      await setDoc(doc(db, 'reviews', reviewDocId), rev);
      setReviews(prev => [{ id: reviewDocId, ...rev }, ...prev.filter(r => r.id !== reviewDocId)]);
      setReviewComment('');
      setReviewRating(5);
    } catch (e) {
      console.error('review failed', e);
      alert(isRtl ? 'تعذّر إرسال التقييم.' : 'Could not submit the review.');
    } finally { setSubmittingReview(false); }
  };

  const handleReport = async () => {
    if (!auth.currentUser) { alert(isRtl ? 'سجّل الدخول الأول عشان تبلّغ.' : 'Please sign in to report a listing.'); return; }
    const reason = window.prompt(isRtl ? 'سبب البلاغ عن الإعلان:' : 'Reason for reporting this listing:');
    if (!reason || !reason.trim()) return;
    setReporting(true);
    try {
      await addDoc(collection(db, 'reports'), {
        propertyId: property.id,
        userId: auth.currentUser.uid,
        reason: reason.trim().slice(0, 999),
        createdAt: new Date().toISOString(),
      });
      alert(isRtl ? 'تم إرسال البلاغ للمراجعة. شكرًا.' : 'Report submitted for review. Thank you.');
    } catch (err) {
      console.error('Report failed', err);
      alert(isRtl ? 'تعذّر إرسال البلاغ.' : 'Could not submit the report.');
    } finally { setReporting(false); }
  };

  return (
    <div className="max-w-6xl mx-auto px-4 py-8 animate-fade-in">
      <button onClick={onBack} className="flex items-center gap-2 text-slate-500 dark:text-slate-400 hover:text-brand-600 dark:hover:text-brand-400 font-bold mb-6 transition-colors cursor-pointer">
        {/* Not "back to listings" any more — it returns wherever you came from. */}
        {isRtl ? <ArrowRight size={18} aria-hidden="true" /> : <ArrowLeft size={18} aria-hidden="true" />} {isRtl ? 'رجوع' : 'Back'}
      </button>

      <div className="grid lg:grid-cols-3 gap-8 items-start">
        {/* Details column */}
        <div className="lg:col-span-2 space-y-8">
          {/* Gallery */}
          <div className="relative h-72 sm:h-96 group rounded-3xl overflow-hidden border border-slate-200 dark:border-slate-800 shadow-lg">
            {slides[currentImageIndex]?.type === 'video' ? (
              <video src={slides[currentImageIndex].src} className="w-full h-full object-cover" controls playsInline />
            ) : (
              <PropertyImage src={slides[currentImageIndex]?.src} alt={property.title} iconSize={56} className="w-full h-full object-cover" />
            )}
            {av.taken && (
              <div className="absolute inset-0 bg-black/50 flex items-center justify-center z-10 pointer-events-none">
                <span className={`${av.color} text-white text-2xl font-black uppercase tracking-widest px-8 py-3 rounded-xl -rotate-12 shadow-2xl`}>{av.label}</span>
              </div>
            )}
            {(displayImages.length > 0 || (property.panoramas && property.panoramas.length > 0)) && (
              <button
                onClick={() => setShow3D(true)}
                className={`absolute top-4 ${isRtl ? 'right-4' : 'left-4'} bg-black/60 hover:bg-brand-600 text-white backdrop-blur px-4 py-2 rounded-full text-sm font-bold transition-colors flex items-center gap-2 cursor-pointer z-20`}
              >
                <Box size={16} /> {property.panoramas && property.panoramas.length > 0 ? (isRtl ? 'جولة 360°' : '360° Tour') : (isRtl ? 'جولة 3D' : 'View in 3D')}
              </button>
            )}
            {slides.length > 1 && (
              <>
                {/* Previous: sits on the start edge and points backwards in both directions. */}
                <button 
                  type="button"
                  aria-label={isRtl ? 'الصورة السابقة' : 'Previous image'} 
                  onClick={() => setCurrentImageIndex(i => i === 0 ? slides.length - 1 : i - 1)} 
                  className={`absolute ${isRtl ? 'right-4' : 'left-4'} top-1/2 -translate-y-1/2 min-w-[44px] min-h-[44px] p-2 bg-black/50 text-white rounded-full hover:bg-black/70 cursor-pointer transition-colors opacity-100 sm:opacity-0 sm:group-hover:opacity-100 focus:opacity-100 focus:outline-none focus:ring-2 focus:ring-brand-400 z-20 flex items-center justify-center`}
                >
                  {isRtl ? <ChevronRight size={20} aria-hidden="true" /> : <ChevronLeft size={20} aria-hidden="true" />}
                </button>
                <button 
                  type="button"
                  aria-label={isRtl ? 'الصورة التالية' : 'Next image'} 
                  onClick={() => setCurrentImageIndex(i => (i + 1) % slides.length)} 
                  className={`absolute ${isRtl ? 'left-4' : 'right-4'} top-1/2 -translate-y-1/2 min-w-[44px] min-h-[44px] p-2 bg-black/50 text-white rounded-full hover:bg-black/70 cursor-pointer transition-colors opacity-100 sm:opacity-0 sm:group-hover:opacity-100 focus:opacity-100 focus:outline-none focus:ring-2 focus:ring-brand-400 z-20 flex items-center justify-center`}
                >
                  {isRtl ? <ChevronLeft size={20} aria-hidden="true" /> : <ChevronRight size={20} aria-hidden="true" />}
                </button>
                <div className="absolute bottom-4 left-1/2 -translate-x-1/2 flex gap-2 z-20" role="tablist" aria-label={isRtl ? 'صور المعرض' : 'Gallery slides'}>
                  {slides.map((_, idx) => (
                    <button 
                      key={idx} 
                      type="button"
                      role="tab"
                      aria-selected={idx === currentImageIndex}
                      aria-label={isRtl ? `الصورة ${idx + 1} من ${slides.length}` : `Slide ${idx + 1} of ${slides.length}`}
                      className="w-4 h-4 min-w-[24px] min-h-[24px] flex items-center justify-center p-1 rounded-full transition-all focus:outline-none focus:ring-2 focus:ring-brand-400 cursor-pointer" 
                      onClick={() => setCurrentImageIndex(idx)}
                    >
                      <span className={`w-2.5 h-2.5 rounded-full transition-all block ${idx === currentImageIndex ? 'bg-white scale-125' : 'bg-white/50 hover:bg-white/75'}`} />
                    </button>
                  ))}
                </div>
              </>
            )}
          </div>

          {/* Header */}
          <div className="flex flex-col sm:flex-row justify-between items-start gap-4">
            <div className="flex-1">
              <div className="flex items-center gap-2 mb-2 flex-wrap">
                <h1 className="text-3xl font-black text-slate-900 dark:text-white tracking-tight">{property.title}</h1>
                <span className={`${listingReviewInfo(property, t).chip} text-[10px] px-2 py-1 rounded-full font-black flex items-center gap-1 uppercase tracking-wider`}>
                  {property.verificationStatus === 'Verified' && <ShieldCheck size={12} aria-hidden="true" />}
                  {listingReviewInfo(property, t).label}
                </span>
                <span className={`${av.color} text-white text-[10px] px-2 py-1 rounded-full font-black uppercase tracking-wider`}>{av.label}</span>
              </div>
              {listingReviewInfo(property, t).note && (
                <p className="text-xs text-slate-500 dark:text-slate-400 mb-2 max-w-2xl">{listingReviewInfo(property, t).note}</p>
              )}
              <p className="text-slate-500 dark:text-slate-400 flex items-center gap-1.5 mb-1 font-medium flex-wrap">
                <MapPin size={16} className="text-brand-500"/> {property.location}
                {property.compound && (onOpenProject
                  ? <>{'—'} <button onClick={() => onOpenProject(property.compound!)} className="text-brand-600 dark:text-brand-400 font-bold hover:underline cursor-pointer">{property.compound}</button></>
                  : <>{' — '}{property.compound}</>)}
                <a href={mapsUrl} target="_blank" rel="noopener noreferrer" className="text-brand-600 dark:text-brand-400 font-bold hover:underline text-sm">{isRtl ? '· عرض على الخريطة' : '· View on map'}</a>
              </p>
              {property.propertyType && (
                <p className="text-base font-bold text-brand-700 dark:text-brand-300 mb-1">{typeLabel(property.propertyType, isRtl)}</p>
              )}
              <div className="flex items-center gap-3 text-sm text-slate-500 dark:text-slate-400 flex-wrap">
                {property.unitCode && <span>{isRtl ? 'كود الوحدة:' : 'Unit code:'} <span className="font-bold text-slate-700 dark:text-slate-300">{property.unitCode}</span></span>}
                {property.publishDate && <span>{isRtl ? 'نُشر:' : 'Published:'} <span className="font-bold text-slate-700 dark:text-slate-300">{property.publishDate}</span></span>}
              </div>
            </div>
            <div className="text-right bg-slate-50 dark:bg-slate-800/50 p-4 rounded-2xl border border-slate-100 dark:border-slate-800 flex sm:flex-col justify-between items-center sm:items-end gap-2 w-full sm:w-auto">
              <div className={`font-black text-brand-600 dark:text-brand-400 ${property.price ? 'text-2xl' : 'text-lg'}`}>{priceLabel(property, isRtl)}{property.price ? <span className="text-xs text-slate-400 font-bold">{pricePeriodSuffix(property.pricePeriod, isRtl)}</span> : null}</div>
              {/* A figure without its source is a rumour. */}
              {priceProvenance(property, isRtl) && (
                <p className="text-[10px] leading-snug text-slate-500 dark:text-slate-400 max-w-[15rem] sm:text-right">{priceProvenance(property, isRtl)}</p>
              )}
              <div className="text-[10px] font-black text-slate-500 dark:text-slate-400 uppercase tracking-widest bg-slate-100 dark:bg-slate-800 px-2 py-1 rounded">{property.status === 'For Sale' ? (isRtl ? 'للبيع' : 'For Sale') : (isRtl ? 'للإيجار' : 'For Rent')}</div>
            </div>
          </div>

          {/* Headline figures — big enough to read at a glance */}
          <div className="grid grid-cols-3 gap-4">
            {[
              { icon: <BedDouble className="text-brand-500 dark:text-brand-400" size={26} aria-hidden="true" />, value: property.bedrooms, label: t.prop_beds },
              { icon: <Bath className="text-brand-500 dark:text-brand-400" size={26} aria-hidden="true" />, value: property.bathrooms, label: t.prop_baths },
              { icon: <Maximize className="text-brand-500 dark:text-brand-400" size={26} aria-hidden="true" />, value: `${property.area}${property.areaTo ? `–${property.areaTo}` : ''} ${isRtl ? 'م²' : 'm²'}`, label: isRtl ? 'المساحة' : 'Area' },
            ].map((s, i) => (
              <div key={i} className="flex flex-col items-center justify-center p-5 bg-slate-50 dark:bg-slate-800 rounded-2xl border border-slate-100 dark:border-slate-700">
                {s.icon}
                <span className="text-2xl font-black text-slate-900 dark:text-white mt-2 leading-none">{s.value}</span>
                <span className="text-sm font-medium text-slate-500 dark:text-slate-400 mt-1.5">{s.label}</span>
              </div>
            ))}
          </div>

          {/* Full specification — every stored field, labelled and in the user's
              language. These values are stored in English and used to render raw,
              which made the listing unreadable in Arabic. */}
          {(() => {
            const rows: { label: string; value: React.ReactNode }[] = [];
            const add = (label: string, value: React.ReactNode) => {
              if (value !== undefined && value !== null && value !== '' && value !== 0) rows.push({ label, value });
            };
            add(isRtl ? 'نوع العقار' : 'Property type', typeLabel(property.propertyType, isRtl));
            add(isRtl ? 'الغرض' : 'Purpose', property.status === 'For Sale' ? (isRtl ? 'للبيع' : 'For sale') : (isRtl ? 'للإيجار' : 'For rent'));
            add(isRtl ? 'الحالة' : 'Availability', av.label);
            add(isRtl ? 'التشطيب' : 'Finishing', finishingLabel(property.finishing, isRtl));
            add(isRtl ? 'الدور' : 'Floor', property.floor);
            add(isRtl ? 'الإطلالة' : 'View', property.view);
            add(isRtl ? 'مفروش' : 'Furnished', property.furnished ? (isRtl ? 'نعم' : 'Yes') : undefined);
            add(isRtl ? 'عدد الأفراد' : 'Sleeps', property.guests);
            add(isRtl ? 'الكمبوند' : 'Compound', property.compound);
            add(isRtl ? 'القرية' : 'Village', property.village);
            add(isRtl ? 'المطوّر' : 'Developer', property.developer);
            add(isRtl ? 'الاستلام' : 'Delivery', property.deliveryDate);
            if (rows.length === 0) return null;
            return (
              <div>
                <h3 className="font-bold text-lg text-slate-900 dark:text-white mb-3">{isRtl ? 'تفاصيل الوحدة' : 'Property details'}</h3>
                <dl className="grid sm:grid-cols-2 gap-x-8 gap-y-0 bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 px-5 py-1">
                  {rows.map((r, i) => (
                    <div key={i} className="flex items-baseline justify-between gap-4 py-3 border-b border-slate-100 dark:border-slate-800 last:border-0">
                      <dt className="text-sm text-slate-500 dark:text-slate-400 shrink-0">{r.label}</dt>
                      <dd className="text-base font-bold text-slate-900 dark:text-white text-end">{r.value}</dd>
                    </div>
                  ))}
                </dl>
              </div>
            );
          })()}

          {property.description && (
            <div>
              <h3 className="font-bold text-slate-900 dark:text-white mb-2">{isRtl ? 'الوصف' : 'Description'}</h3>
              <p className="text-slate-600 dark:text-slate-300 whitespace-pre-wrap leading-relaxed text-sm">{property.description}</p>
            </div>
          )}

          {/* Location map */}
          <div>
            <h3 className="font-bold text-slate-900 dark:text-white mb-3 flex items-center gap-2"><MapPin size={18} className="text-brand-500" /> {isRtl ? 'الموقع على الخريطة' : 'Location'}</h3>
            <div className="relative w-full rounded-3xl overflow-hidden border border-slate-200 dark:border-slate-800 shadow-lg" style={{ aspectRatio: '16 / 9' }}>
              <iframe
                title={isRtl ? 'خريطة الموقع' : 'Location map'}
                className="absolute inset-0 w-full h-full"
                loading="lazy"
                referrerPolicy="no-referrer-when-downgrade"
                src={(property.lat && property.lng)
                  ? `https://maps.google.com/maps?q=${property.lat},${property.lng}&z=14&output=embed`
                  : `https://maps.google.com/maps?q=${mapsQuery}&z=13&output=embed`}
              />
            </div>
            <a href={mapsUrl} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1.5 mt-2 text-sm font-bold text-brand-600 dark:text-brand-400 hover:underline">
              {isRtl ? 'افتح في خرائط جوجل' : 'Open in Google Maps'} <ArrowRight size={14} className={isRtl ? 'rotate-180' : ''} />
            </a>
          </div>

          {/* Real virtual tour (Matterport / Polycam / Kuula …) — only if the URL is a safe allowlisted https link */}
          {safeTourUrl(property.digitalTwinUrl) && (
            <div>
              <h3 className="font-bold text-slate-900 dark:text-white mb-3 flex items-center gap-2"><Box size={18} className="text-brand-500" /> {isRtl ? 'الجولة الافتراضية الحقيقية' : 'Real Virtual Tour'}</h3>
              <div className="relative w-full rounded-3xl overflow-hidden border border-slate-200 dark:border-slate-800 shadow-lg bg-slate-100 dark:bg-slate-800" style={{ aspectRatio: '16 / 10' }}>
                <iframe
                  src={safeTourUrl(property.digitalTwinUrl)!}
                  title={isRtl ? 'جولة افتراضية' : 'Virtual Tour'}
                  className="absolute inset-0 w-full h-full"
                  sandbox="allow-scripts allow-same-origin allow-popups"
                  allow="xr-spatial-tracking; gyroscope; accelerometer; fullscreen"
                  allowFullScreen
                  loading="lazy"
                />
              </div>
              <a href={safeTourUrl(property.digitalTwinUrl)!} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1.5 mt-2 text-sm font-bold text-brand-600 dark:text-brand-400 hover:underline">
                {isRtl ? 'افتح الجولة في نافذة كاملة' : 'Open tour in full window'} <ArrowRight size={14} className={isRtl ? 'rotate-180' : ''} />
              </a>
            </div>
          )}

          {/* Legal & details */}
          <div>
            <h3 className="font-bold text-slate-900 dark:text-white mb-1 flex items-center gap-2"><Shield size={18} className="text-brand-500" aria-hidden="true" /> {isRtl ? 'التفاصيل القانونية' : 'Legal Details'}</h3>
            {/* Everything in this block is typed in by whoever posted the listing.
                Presenting it as a platform finding is how a green "Valid" ends up
                standing in for a court nobody contacted. */}
            <p className="text-xs text-slate-500 dark:text-slate-400 mb-3">{t.listing_seller_stated}</p>
            <div className="grid sm:grid-cols-2 gap-3">
              <div className="flex justify-between items-center bg-slate-50 dark:bg-slate-800 px-4 py-3 rounded-xl text-sm">
                <span className="text-slate-500 dark:text-slate-400">{isRtl ? 'رقم الشهر العقاري' : 'Registry Number'}</span>
                <span className="font-bold text-slate-900 dark:text-white">{property.registrationNumber || (isRtl ? 'غير متاح' : 'N/A')}</span>
              </div>
              <div className="flex justify-between items-center bg-slate-50 dark:bg-slate-800 px-4 py-3 rounded-xl text-sm">
                <span className="text-slate-500 dark:text-slate-400">{isRtl ? 'صحة توقيع المحكمة' : 'Court Signature'}</span>
                <span className="font-bold text-slate-900 dark:text-white">{property.courtSignatureValidity ? (isRtl ? 'البائع بيقول: صحيح' : 'Seller says: valid') : (isRtl ? 'غير محدد' : 'Not stated')}</span>
              </div>
              <div className="flex justify-between items-center bg-slate-50 dark:bg-slate-800 px-4 py-3 rounded-xl text-sm">
                <span className="text-slate-500 dark:text-slate-400">{isRtl ? 'نوع البيع' : 'Sale Type'}</span>
                <span className="font-bold text-slate-900 dark:text-white">{property.isResale ? (isRtl ? 'إعادة بيع' : 'Resale') : (isRtl ? 'بيع مباشر' : 'Direct')}</span>
              </div>
              <div className="flex justify-between items-center bg-slate-50 dark:bg-slate-800 px-4 py-3 rounded-xl text-sm">
                <span className="text-slate-500 dark:text-slate-400">{isRtl ? 'حالة التوفر' : 'Availability'}</span>
                <span className="font-bold text-slate-900 dark:text-white">{av.label}</span>
              </div>
            </div>
          </div>

          {/* Amenities */}
          {property.amenities && property.amenities.length > 0 && (
            <div>
              <h3 className="font-bold text-slate-900 dark:text-white mb-3">{isRtl ? 'المميزات والخدمات' : 'Amenities'}</h3>
              <div className="flex flex-wrap gap-2">
                {property.amenities.map(a => (
                  <span key={a} className="flex items-center gap-1.5 px-3 py-1.5 bg-slate-50 dark:bg-slate-800 text-slate-700 dark:text-slate-300 rounded-lg text-sm font-medium border border-slate-100 dark:border-slate-700">
                    <CheckCircle size={14} className="text-brand-500" aria-hidden="true" /> {amenityLabel(a, isRtl)}
                  </span>
                ))}
              </div>
            </div>
          )}

          {/* Structured payment plans */}
          {property.paymentPlans && property.paymentPlans.length > 0 && (
            <div>
              <h3 className="font-bold text-slate-900 dark:text-white mb-3">{isRtl ? 'خطط السداد' : 'Payment Plans'}</h3>
              <div className="grid sm:grid-cols-2 gap-3">
                {property.paymentPlans.map((pl, i) => (
                  <div key={i} className="bg-slate-50 dark:bg-slate-800 rounded-xl p-4 border border-slate-100 dark:border-slate-700">
                    <div className="flex items-baseline gap-2 flex-wrap">
                      {pl.downPayment ? <span className="text-lg font-black text-brand-600 dark:text-brand-400">{pl.downPayment}%</span> : null}
                      <span className="text-sm text-slate-500 dark:text-slate-400">{isRtl ? 'مقدم' : 'down'}</span>
                      {pl.years ? <span className="text-sm font-bold text-slate-700 dark:text-slate-300">· {pl.years} {isRtl ? 'سنة' : 'yrs'}</span> : null}
                    </div>
                    {pl.note && <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">{pl.note}</p>}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Payment methods */}
          <div>
            <h3 className="font-bold text-slate-900 dark:text-white mb-3">{isRtl ? 'طرق الدفع المتاحة' : 'Available Payment Methods'}</h3>
            <div className="flex flex-wrap gap-2">
              {property.paymentMethods?.map(m => (
                <span key={m} className="px-3 py-1.5 bg-brand-50 dark:bg-brand-900/30 text-brand-700 dark:text-brand-300 rounded-lg text-sm font-medium border border-brand-100 dark:border-brand-800">{paymentLabel(m, isRtl)}</span>
              ))}
              {(!property.paymentMethods || property.paymentMethods.length === 0) && (
                <span className="text-slate-500 dark:text-slate-400 text-sm">{isRtl ? 'غير محدد' : 'Not specified'}</span>
              )}
            </div>
          </div>

          {property.status === 'For Sale' && property.price > 0 && (
            <div className="bg-slate-50 dark:bg-slate-800/50 rounded-2xl border border-slate-200 dark:border-slate-800 p-5">
              <h3 className="font-bold text-slate-900 dark:text-white mb-1 flex items-center gap-2"><DollarSign size={18} className="text-brand-500"/> {isRtl ? 'حاسبة التقسيط (تقديرية)' : 'Installment Estimate'}</h3>
              <p className="text-xs text-slate-500 dark:text-slate-400 mb-4">{isRtl ? 'تقدير بأقساط متساوية بدون فوائد — للاسترشاد فقط، مش سعر رسمي.' : 'Rough equal-installment estimate (no interest) — guidance only, not an official quote.'}</p>
              <div className="grid grid-cols-2 gap-4 mb-4">
                <div>
                  <label className="text-xs font-bold text-slate-500 dark:text-slate-400 flex justify-between mb-1"><span>{isRtl ? 'المقدم' : 'Down payment'}</span><span>{calcDown}%</span></label>
                  <input type="range" min="0" max="50" step="5" value={calcDown} onChange={e => setCalcDown(Number(e.target.value))} className="w-full accent-brand-600" />
                </div>
                <div>
                  <label className="text-xs font-bold text-slate-500 dark:text-slate-400 flex justify-between mb-1"><span>{isRtl ? 'عدد السنين' : 'Years'}</span><span>{calcYears}</span></label>
                  <input type="range" min="1" max="15" step="1" value={calcYears} onChange={e => setCalcYears(Number(e.target.value))} className="w-full accent-brand-600" />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3 text-center">
                <div className="bg-white dark:bg-slate-900 rounded-xl p-3 border border-slate-100 dark:border-slate-800">
                  <div className="text-[11px] text-slate-500 dark:text-slate-400">{isRtl ? 'المقدم' : 'Down payment'}</div>
                  <div className="font-black text-brand-600 dark:text-brand-400">{Math.round(property.price * calcDown / 100).toLocaleString()} {property.currency || 'EGP'}</div>
                </div>
                <div className="bg-white dark:bg-slate-900 rounded-xl p-3 border border-slate-100 dark:border-slate-800">
                  <div className="text-[11px] text-slate-500 dark:text-slate-400">{isRtl ? 'القسط الشهري' : 'Monthly'}</div>
                  <div className="font-black text-brand-600 dark:text-brand-400">{Math.round(property.price * (1 - calcDown / 100) / (calcYears * 12)).toLocaleString()} {property.currency || 'EGP'}</div>
                </div>
              </div>
            </div>
          )}

          {property.contactPhone && (
            <div>
              <h3 className="font-bold text-slate-900 dark:text-white mb-3">{isRtl ? 'تواصل مع البائع' : 'Contact the seller'}</h3>
              <div className="grid grid-cols-2 gap-3">
                <a
                  href={`https://wa.me/${(property.contactPhone || '').replace(/\D/g, '')}?text=${encodeURIComponent(isRtl ? `مرحبًا، مهتم بالعقار ${property.unitCode || property.title}` : `Hi, I'm interested in ${property.unitCode || property.title}`)}`}
                  target="_blank" rel="noopener noreferrer"
                  className="flex items-center justify-center gap-2 py-3.5 rounded-xl bg-green-500 hover:bg-green-600 text-white font-bold transition-colors shadow-md"
                >
                  <MessageSquare size={18} /> {isRtl ? 'واتساب' : 'WhatsApp'}
                </a>
                <a
                  href={`tel:${property.contactPhone}`}
                  className="flex items-center justify-center gap-2 py-3.5 rounded-xl bg-brand-600 hover:bg-brand-700 text-white font-bold transition-colors shadow-md"
                >
                  <Phone size={18} /> {isRtl ? 'اتصال' : 'Call'}
                </a>
              </div>
            </div>
          )}

          {av.taken ? (
            <div className="w-full py-4 text-lg text-center font-bold rounded-xl bg-slate-100 dark:bg-slate-800 text-slate-500 dark:text-slate-400 border border-slate-200 dark:border-slate-700">
              {isRtl ? `هذا العقار ${av.label} حاليًا` : `This property is ${av.label}`}
            </div>
          ) : (
            <Button onClick={() => onPurchase(property.id)} className="w-full py-4 text-lg">
              {isRtl ? 'اطلب الوحدة دي' : 'Request this property'}
            </Button>
          )}

          {/* Reviews */}
          <div>
            <div className="flex items-center gap-2 mb-3">
              <h3 className="font-bold text-slate-900 dark:text-white">{isRtl ? 'التقييمات' : 'Reviews'}</h3>
              {reviews.length > 0 && (
                <span className="flex items-center gap-1 text-sm font-bold text-amber-500"><Star size={16} fill="currentColor" /> {avgRating.toFixed(1)} <span className="text-slate-400 font-normal">({reviews.length})</span></span>
              )}
            </div>
            <div className="bg-slate-50 dark:bg-slate-800/50 rounded-2xl p-4 mb-4 border border-slate-100 dark:border-slate-800">
              <div className="flex items-center gap-1 mb-2" role="radiogroup" aria-label={isRtl ? 'التقييم بالنجوم' : 'Rating stars'}>
                {[1, 2, 3, 4, 5].map(n => (
                  <button 
                    key={n} 
                    type="button" 
                    onClick={() => setReviewRating(n)} 
                    aria-label={isRtl ? `${n} نجوم من 5` : `${n} stars out of 5`}
                    aria-pressed={reviewRating === n}
                    className="min-w-[44px] min-h-[44px] p-2 flex items-center justify-center cursor-pointer focus:outline-none focus:ring-2 focus:ring-amber-400 rounded-lg"
                  >
                    <Star size={22} className={n <= reviewRating ? 'text-amber-500' : 'text-slate-300 dark:text-slate-600'} fill={n <= reviewRating ? 'currentColor' : 'none'} aria-hidden="true" />
                  </button>
                ))}
              </div>
              <textarea value={reviewComment} onChange={e => setReviewComment(e.target.value)} rows={2} placeholder={isRtl ? 'اكتب تقييمك...' : 'Write your review...'} className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-900 dark:text-white text-sm outline-none focus:ring-2 focus:ring-brand-500" />
              <button onClick={submitReview} disabled={submittingReview || !reviewComment.trim()} className="mt-2 bg-brand-600 hover:bg-brand-700 disabled:opacity-50 text-white px-4 py-2 rounded-xl text-sm font-bold">{isRtl ? 'إرسال التقييم' : 'Submit review'}</button>
            </div>
            <div className="space-y-3">
              {reviews.map(r => (
                <div key={r.id} className="bg-white dark:bg-slate-900 border border-slate-100 dark:border-slate-800 rounded-xl p-3">
                  <div className="flex items-center justify-between">
                    <span className="font-bold text-sm text-slate-900 dark:text-white">{r.userName}</span>
                    <span className="flex items-center gap-0.5">{Array.from({ length: 5 }).map((_, i) => <Star key={i} size={13} fill={i < r.rating ? 'currentColor' : 'none'} className={i < r.rating ? 'text-amber-500' : 'text-slate-300 dark:text-slate-600'} />)}</span>
                  </div>
                  <p className="text-sm text-slate-600 dark:text-slate-300 mt-1 whitespace-pre-wrap">{r.comment}</p>
                </div>
              ))}
              {reviews.length === 0 && <p className="text-sm text-slate-400">{isRtl ? 'مفيش تقييمات لسه — كن أول واحد.' : 'No reviews yet — be the first.'}</p>}
            </div>
          </div>

          <button onClick={handleReport} disabled={reporting} className="w-full text-center text-xs font-bold text-slate-400 hover:text-red-500 transition-colors py-2 flex items-center justify-center gap-1.5 disabled:opacity-50">
            <Shield size={13} /> {isRtl ? 'بلّغ عن هذا الإعلان' : 'Report this listing'}
          </button>
        </div>

        {/* AI assistant column (always visible) */}
        <div className="lg:col-span-1">
          <div className="lg:sticky lg:top-24 bg-white dark:bg-slate-900 rounded-3xl border border-slate-200 dark:border-slate-800 shadow-xl overflow-hidden flex flex-col h-[32rem] lg:h-[calc(100dvh-8rem)]">
            <div className="p-4 border-b border-slate-100 dark:border-slate-800 bg-slate-50 dark:bg-slate-800/50 flex items-center gap-2 shrink-0">
              <div className="w-8 h-8 rounded-full bg-accent-500/10 text-accent-500 flex items-center justify-center"><MessageSquare size={16} /></div>
              <div>
                <h3 className="font-black text-slate-900 dark:text-white text-sm">{isRtl ? 'المساعد الذكي للوحدة' : 'Unit AI Assistant'}</h3>
                <p className="text-[11px] text-slate-500 dark:text-slate-400">{isRtl ? 'اسأل أي حاجة عن العقار ده' : 'Ask anything about this property'}</p>
              </div>
            </div>
            <div className="flex-1 overflow-y-auto p-4 space-y-4 bg-slate-50/50 dark:bg-slate-900/50" ref={scrollRef}>
              {messages.map((msg, i) => (
                <div key={i} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'} animate-fade-in`}>
                  <div className={`max-w-[88%] p-3 rounded-2xl shadow-sm text-[14px] ${msg.role === 'user' ? 'bg-brand-600 text-white rounded-tr-none' : 'bg-white dark:bg-slate-800 text-slate-800 dark:text-slate-200 rounded-tl-none border border-slate-100 dark:border-slate-700'}`}>
                    {msg.text.match(/!\[.*?\]\((.*?)\)/) ? (
                      <>
                        <p className="whitespace-pre-wrap leading-relaxed">{msg.text.replace(/!\[.*?\]\((.*?)\)/g, '')}</p>
                        {msg.text.match(/!\[.*?\]\((.*?)\)/g)?.map((imgMatch, idx) => {
                          const url = imgMatch.match(/\((.*?)\)/)?.[1];
                          return url ? <img key={idx} src={url} alt="Property" className="mt-2 rounded-xl border border-slate-200 dark:border-slate-700 w-full object-cover" /> : null;
                        })}
                      </>
                    ) : (
                      <p className="whitespace-pre-wrap leading-relaxed">{msg.text}</p>
                    )}
                  </div>
                </div>
              ))}
              {isLoading && (
                <div className="flex justify-start animate-fade-in">
                  <div className="bg-white dark:bg-slate-800 p-3 rounded-2xl rounded-tl-none border border-slate-100 dark:border-slate-700">
                    <Loader2 className="w-5 h-5 text-brand-500 animate-spin" />
                  </div>
                </div>
              )}
            </div>
            <div className="p-3 bg-white dark:bg-slate-800 border-t border-slate-100 dark:border-slate-700 shrink-0">
              <form onSubmit={handleSendMessage} className="relative flex items-center">
                <input
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  placeholder={isRtl ? 'اسأل عن العقار...' : 'Ask about this property...'}
                  className={`w-full bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl py-3 px-4 pe-12 focus:outline-none focus:ring-2 focus:ring-accent-500 text-slate-900 dark:text-white`}
                />
                <button type="submit" disabled={!input.trim() || isLoading} className={`absolute end-2 p-2 bg-brand-600 hover:bg-brand-700 text-white rounded-lg disabled:opacity-50 transition-colors cursor-pointer`}>
                  <Send size={18} className={isRtl ? 'rotate-180' : ''} />
                </button>
              </form>
            </div>
          </div>
        </div>
      </div>

      {show3D && (
        <LoadErrorBoundary onClose={() => setShow3D(false)} isRtl={isRtl}>
          <React.Suspense fallback={<Loading3DFallback />}>
            <Property3DViewer
              images={displayImages}
              depthMaps={property.depthMaps}
              panoramas={property.panoramas}
              tourUrl={property.digitalTwinUrl ? safeTourUrl(property.digitalTwinUrl) : null}
              threeDTour={property.threeDTour}
              title={property.title}
              onClose={() => setShow3D(false)}
              isRtl={isRtl}
            />
          </React.Suspense>
        </LoadErrorBoundary>
      )}
    </div>
  );
};

/**
 * Recovers a Storage object path from a download URL, so deleting a listing can
 * clean up its media. Firebase encodes the path between /o/ and the query string.
 * Returns null for base64 fallbacks and for anything that isn't a Storage URL.
 */
const storagePathFromUrl = (url?: string): string | null => {
  if (!url || !url.startsWith('https://firebasestorage.googleapis.com/')) return null;
  const m = url.match(/\/o\/([^?]+)/);
  if (!m) return null;
  try { return decodeURIComponent(m[1]); } catch { return null; }
};

/** How a listing's review state is shown to a buyer. */
const listingReviewInfo = (p: Property, t: any) => {
  if (p.verificationStatus === 'Verified') {
    return { label: t.listing_review_done, note: t.listing_review_note,
             chip: 'bg-green-500 text-white' };
  }
  if (p.verificationStatus === 'Rejected') {
    return { label: t.listing_review_rejected, note: p.reviewNote || '',
             chip: 'bg-red-500 text-white' };
  }
  return { label: t.listing_review_pending, note: '',
           chip: 'bg-slate-500/90 text-white' };
};

const ProfilePage = ({ t, isRtl, onBrowse, onLogout, onLogin, userEmail, userFavorites, allProperties, onToggleFavorite, open3D, onOpenProperty, onEditListing, refreshProperties }: { t: any, isRtl: boolean, onBrowse: () => void, onLogout: () => void, onLogin: () => void, userEmail: string | null, userFavorites: string[], allProperties: Property[], onToggleFavorite: (id: string) => void, open3D: (id: string) => void, onOpenProperty: (id: string) => void, onEditListing?: (id: string) => void, refreshProperties?: () => Promise<void> }) => {
  const [profile, setProfile] = useState<any>(null);
  const [purchases, setPurchases] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [isEditing, setIsEditing] = useState(false);
  const [editForm, setEditForm] = useState<any>({});
  const [saving, setSaving] = useState(false);
  const [activeSubTab, setActiveSubTab] = useState<'purchases' | 'favorites' | 'listings'>('purchases');
  const [listingBusy, setListingBusy] = useState<string | null>(null);
  const [listingError, setListingError] = useState<string | null>(null);

  const myListings = allProperties.filter(p => p.authorUid && p.authorUid === auth.currentUser?.uid);

  /** Hide or re-publish a listing. Reversible, and nothing referencing it breaks. */
  const setListingState = async (id: string, next: 'Live' | 'Removed') => {
    setListingBusy(id);
    setListingError(null);
    try {
      await updateDoc(doc(db, 'properties', id), { listingState: next });
      await refreshProperties?.();
    } catch (err) {
      console.error('Listing state change failed:', err);
      setListingError(isRtl ? 'تعذّر تغيير حالة الإعلان.' : 'Could not change the listing state.');
    } finally {
      setListingBusy(null);
    }
  };

  /**
   * Hard delete. Media uploaded before paths were namespaced by uid cannot be
   * removed from the browser, so the owner is told rather than reassured.
   */
  const deleteListing = async (p: Property) => {
    // legalDocs belongs here above all: a title deed left in Storage after the
    // listing is gone is unreachable, undeletable, and still world-readable —
    // and deleting the document destroys the only record of its URL.
    const urls = [p.imageUrl, ...(p.images || []), ...(p.panoramas || []), ...(p.legalDocs || []), p.videoUrl]
      .filter(Boolean) as string[];
    const paths = urls.map(storagePathFromUrl).filter(Boolean) as string[];
    const legacy = paths.filter(path => !path.startsWith(`properties/${auth.currentUser?.uid}/`));
    const warning = legacy.length
      ? (isRtl
          ? `\n\nملحوظة: ${legacy.length} من ملفات الإعلان اترفعت قبل تعديل مسارات التخزين، فمش هتتمسح من السيرفر. لازم تتشال يدوي.`
          : `\n\nNote: ${legacy.length} of this listing's files predate the current storage layout and will stay on the server. They have to be removed manually.`)
      : '';
    if (!window.confirm((isRtl
      ? 'حذف الإعلان ده نهائياً؟ مش هينفع ترجّعه.'
      : 'Delete this listing permanently? This cannot be undone.') + warning)) return;

    setListingBusy(p.id);
    setListingError(null);
    const removable = paths.filter(path => !legacy.includes(path));  // rules refuse the legacy prefix
    let removed = 0;
    try {
      // Files first and in parallel: a serial loop over 40+ objects widens the
      // window in which a mid-flight failure strands the listing.
      await Promise.all(removable.map(path =>
        deleteObject(ref(storage, path))
          .then(() => { removed += 1; })
          .catch((err: any) => {
            if (err?.code === 'storage/object-not-found') return;  // already gone
            console.error('Storage delete failed for', path, err);
            throw err;
          })
      ));
      await deleteDoc(doc(db, 'properties', p.id));
    } catch (err) {
      console.error('Listing delete failed:', err);
      // Never claim nothing happened when files are already gone.
      setListingError(removed > 0
        ? (isRtl
            ? `تعذّر حذف الإعلان بالكامل. ${removed} من ملفاته اتشالوا فعلاً — جرّب تاني عشان يتشال الباقي.`
            : `Could not finish deleting the listing. ${removed} of its files were already removed — try again to finish.`)
        : (isRtl
            ? 'تعذّر حذف الإعلان. ما اتشالش حاجة — جرّب تاني.'
            : 'Could not delete the listing. Nothing was removed — please try again.'));
      return;
    } finally {
      setListingBusy(null);
    }
    // Outside the try: a failed refetch is a stale screen, not a failed delete.
    await refreshProperties?.().catch(err => console.warn('Refresh after delete failed:', err));
  };

  const favoriteProperties = allProperties.filter(p => userFavorites.includes(p.id));
  const completedPurchases = purchases.filter(p => p.status?.toLowerCase() === 'completed' || p.status?.toLowerCase() === 'finished');
  const inProgressPurchases = purchases.filter(p => p.status?.toLowerCase() === 'processing' || p.status?.toLowerCase() === 'pending');

  useEffect(() => {
    if (!auth.currentUser) {
      setLoading(false);
      return;
    }
    
    const fetchProfile = async () => {
      try {
        const userDoc = await getDoc(doc(db, 'users', auth.currentUser!.uid));
        // A signed-in account whose /users doc was never written still has a
        // profile — it just isn't in Firestore yet. Falling through to null here
        // used to tell them they weren't signed in, and hid their own listings.
        const fallback = { name: auth.currentUser!.displayName || '', email: auth.currentUser!.email || '', phone: '', preferences: '' };
        const data = userDoc.exists() ? userDoc.data() : fallback;
        setProfile(data);
        setEditForm(data);
        
        // Fetch real purchases from Firestore
        const q = query(
          collection(db, 'purchases'), 
          where('userId', '==', auth.currentUser!.uid)
        );
        const querySnapshot = await getDocs(q);
        const purchaseData = querySnapshot.docs.map(doc => ({
          id: doc.id,
          ...doc.data(),
          property: allProperties.find(p => p.id === (doc.data() as any).propertyId)
        }));
        setPurchases(purchaseData);
      } catch (err) {
        console.error("Error fetching purchases:", err);
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
      // setDoc(merge) rather than updateDoc: an account whose /users document was
      // never written has nothing to update, and the failure surfaced nowhere.
      const syncedProfile = {
        ...editForm,
        uid: auth.currentUser.uid,
        email: auth.currentUser.email || editForm.email || '',
        role: profile?.role || (SUPER_ADMIN_EMAILS.includes((auth.currentUser.email || '').toLowerCase()) ? 'admin' : 'user'),
      };
      await setDoc(doc(db, 'users', auth.currentUser.uid), syncedProfile, { merge: true });
      setProfile(syncedProfile);
      setIsEditing(false);
    } catch (err) {
      handleFirestoreError(err, OperationType.UPDATE, `users/${auth.currentUser.uid}`);
    } finally {
      setSaving(false);
    }
  };

  if (loading) return <div className="py-20 text-center"><Loader2 className="animate-spin mx-auto text-brand-500 w-8 h-8"/></div>;
  // Gate on the auth session, not on whether a Firestore document happens to exist.
  if (!auth.currentUser || !profile) return (
    <div className="py-20 text-center">
      <h2 className="text-2xl font-bold text-slate-900 mb-4">{isRtl ? 'يرجى تسجيل الدخول' : 'Please Sign In'}</h2>
      <p className="text-slate-500 mb-8">{isRtl ? 'يجب تسجيل الدخول لعرض الملف الشخصي.' : 'You must be signed in to view your profile.'}</p>
      <Button onClick={onLogin}>{isRtl ? 'تسجيل الدخول' : 'Sign In'}</Button>
    </div>
  );

  return (
    <div className="max-w-5xl mx-auto px-4 py-12 animate-fade-in transition-colors duration-500">
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center mb-8 gap-4">
        <h1 className="text-3xl font-bold text-slate-900 dark:text-white">{isRtl ? 'الملف الشخصي' : 'Personal Profile'}</h1>
        <div className="flex gap-2 flex-wrap justify-end">
          {!isEditing ? (
            <Button onClick={() => setIsEditing(true)} variant="outline" className="gap-2 dark:bg-slate-800 dark:border-slate-700 dark:text-slate-300">
              <Edit2 size={16} /> {isRtl ? 'تعديل البيانات' : 'Edit Profile'}
            </Button>
          ) : (
            <>
              <Button onClick={() => { setIsEditing(false); setEditForm(profile); }} variant="outline" className="dark:bg-slate-800 dark:border-slate-700 dark:text-slate-300">
                {isRtl ? 'إلغاء' : 'Cancel'}
              </Button>
              <Button onClick={handleSave} disabled={saving} className="gap-2">
                {saving ? <Loader2 size={16} className="animate-spin" /> : <Save size={16} />}
                {isRtl ? 'حفظ' : 'Save'}
              </Button>
            </>
          )}
          <Button onClick={onLogout} variant="outline" className="gap-2 text-red-600 dark:text-red-400 hover:text-red-700 hover:bg-red-50 dark:hover:bg-red-900/20 border-red-200 dark:border-red-900/50">
            <LogOut size={16} /> {isRtl ? 'تسجيل الخروج' : 'Sign Out'}
          </Button>
        </div>
      </div>
      
      <div className="grid md:grid-cols-3 gap-8">
        <div className="md:col-span-1 space-y-6">
          <div className="bg-white dark:bg-slate-900 p-6 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-sm">
            <div className="w-20 h-20 bg-brand-100 dark:bg-brand-900 text-brand-600 dark:text-brand-400 rounded-full flex items-center justify-center text-2xl font-bold mb-4 relative">
              {profile.name.charAt(0)}
              {SUPER_ADMIN_EMAILS.includes(userEmail || '') && (
                <div className="absolute -bottom-1 -right-1 bg-brand-600 text-white p-1 rounded-full border-2 border-white dark:border-slate-900" title="Admin">
                  <Shield size={14} />
                </div>
              )}
            </div>
            {isEditing ? (
              <div className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">{isRtl ? 'الاسم' : 'Name'}</label>
                  <input 
                    type="text" 
                    value={editForm.name} 
                    onChange={e => setEditForm({...editForm, name: e.target.value})}
                    className="w-full px-3 py-2 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg focus:ring-2 focus:ring-brand-500 focus:border-brand-500 outline-none text-slate-900 dark:text-white"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">{isRtl ? 'البريد الإلكتروني' : 'Email'}</label>
                  <input 
                    type="email" 
                    value={editForm.email} 
                    onChange={e => setEditForm({...editForm, email: e.target.value})}
                    className="w-full px-3 py-2 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg focus:ring-2 focus:ring-brand-500 focus:border-brand-500 outline-none text-slate-900 dark:text-white"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">{isRtl ? 'رقم الهاتف' : 'Phone'}</label>
                  <input 
                    type="tel" 
                    value={editForm.phone} 
                    onChange={e => setEditForm({...editForm, phone: e.target.value})}
                    className="w-full px-3 py-2 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg focus:ring-2 focus:ring-brand-500 focus:border-brand-500 outline-none text-slate-900 dark:text-white"
                  />
                </div>
              </div>
            ) : (
              <>
                <h2 className="text-xl font-bold text-slate-900 dark:text-white">{profile.name}</h2>
                <p className="text-slate-500 dark:text-slate-400 text-sm mb-4">{profile.email}</p>
                <div className="space-y-3 pt-4 border-t border-slate-100 dark:border-slate-800">
                  <div className="flex items-center gap-3 text-sm text-slate-600 dark:text-slate-400"><Phone size={16}/> {profile.phone}</div>
                </div>
              </>
            )}
          </div>

          <div className="bg-brand-50 p-6 rounded-2xl border border-brand-100">
            <h3 className="font-bold text-brand-900 flex items-center gap-2 mb-3"><Target size={18}/> {isRtl ? 'تفضيلاتك' : 'Your Preferences'}</h3>
            {isEditing ? (
              <textarea 
                value={editForm.preferences} 
                onChange={e => setEditForm({...editForm, preferences: e.target.value})}
                className="w-full px-3 py-2 border border-brand-200 rounded-lg focus:ring-2 focus:ring-brand-500 focus:border-brand-500 outline-none min-h-[100px] text-sm"
              />
            ) : (
              <p className="text-sm text-brand-700 leading-relaxed">{profile.preferences}</p>
            )}
          </div>
        </div>

        <div className="md:col-span-2">
          {/* Sub Navigation */}
          <div className="flex gap-4 mb-8 border-b border-slate-100 dark:border-slate-800">
            <button 
              onClick={() => setActiveSubTab('purchases')}
              className={`pb-4 px-2 font-bold text-sm uppercase tracking-wider transition-all relative ${activeSubTab === 'purchases' ? 'text-brand-600' : 'text-slate-400 hover:text-slate-600'}`}
            >
              {t.prof_purchases}
              {activeSubTab === 'purchases' && <motion.div layoutId="subtab" className="absolute bottom-0 left-0 right-0 h-1 bg-brand-600 rounded-full" />}
            </button>
            <button 
              onClick={() => setActiveSubTab('favorites')}
              className={`pb-4 px-2 font-bold text-sm uppercase tracking-wider transition-all relative ${activeSubTab === 'favorites' ? 'text-brand-600' : 'text-slate-400 hover:text-slate-600'}`}
            >
              {t.prof_favorites}
              {activeSubTab === 'favorites' && <motion.div layoutId="subtab" className="absolute bottom-0 left-0 right-0 h-1 bg-brand-600 rounded-full" />}
            </button>
            <button
              onClick={() => setActiveSubTab('listings')}
              className={`pb-4 px-2 font-bold text-sm uppercase tracking-wider transition-all relative ${activeSubTab === 'listings' ? 'text-brand-600' : 'text-slate-400 hover:text-slate-600'}`}
            >
              {t.prof_listings}
              <span className="ml-1.5 text-xs font-normal text-slate-400">({myListings.length})</span>
              {activeSubTab === 'listings' && <motion.div layoutId="subtab" className="absolute bottom-0 left-0 right-0 h-1 bg-brand-600 rounded-full" />}
            </button>
          </div>

          {activeSubTab === 'purchases' && (
            <div className="space-y-12">
              {/* Completed Section */}
              <section>
                <h2 className="text-xl font-bold text-slate-900 dark:text-white mb-6 flex items-center gap-2">
                  <div className="p-2 bg-green-50 dark:bg-green-900/20 text-green-600 rounded-lg">
                    <CheckCircle size={18} />
                  </div>
                  {t.prof_completed} 
                  <span className="text-sm font-normal text-slate-400 font-sans">({completedPurchases.length})</span>
                </h2>
                {completedPurchases.length > 0 ? (
                  <div className="space-y-4">
                    {completedPurchases.map(p => (
                      <div key={p.id} className="bg-white dark:bg-slate-900 p-5 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-sm flex flex-col sm:flex-row gap-5 items-start sm:items-center">
                        <PropertyImage src={p.property?.imageUrl} alt={p.property?.title || (isRtl ? 'صورة العقار' : 'Property image')} className="w-full sm:w-32 aspect-video sm:aspect-auto sm:h-24 rounded-xl object-cover" />
                        <div className="flex-1">
                          <div className="flex justify-between items-start mb-2">
                            <h4 className="font-bold text-slate-900 dark:text-white text-lg">{p.property?.title}</h4>
                            <span className="px-3 py-1 bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400 text-[10px] font-black rounded-lg uppercase tracking-wider">{p.status}</span>
                          </div>
                          <p className="text-sm text-slate-500 dark:text-slate-400 flex items-center gap-1.5 mb-3"><MapPin size={14}/> {p.property?.location}</p>
                          <div className="flex justify-between items-center text-sm">
                            <span className="font-bold text-brand-600 dark:text-brand-400">{p.property?.price.toLocaleString()} EGP</span>
                            <span className="text-slate-400 text-xs flex items-center gap-1"><Clock size={12}/> {p.purchaseDate}</span>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="bg-slate-50 dark:bg-slate-900/50 p-10 rounded-2xl border border-dashed border-slate-200 dark:border-slate-800 text-center">
                    <History className="mx-auto text-slate-300 dark:text-slate-700 mb-3" size={40} />
                    <p className="text-slate-500 dark:text-slate-400 font-medium">{isRtl ? 'لا توجد مشتريات مكتملة بعد.' : 'No completed purchases yet.'}</p>
                  </div>
                )}
              </section>

              {/* In Progress Section */}
              <section>
                <h2 className="text-xl font-bold text-slate-900 dark:text-white mb-6 flex items-center gap-2">
                  <div className="p-2 bg-amber-50 dark:bg-amber-900/20 text-amber-600 rounded-lg">
                    <RefreshCw size={18} className="animate-spin-slow" />
                  </div>
                  {t.prof_in_progress}
                  <span className="text-sm font-normal text-slate-400 font-sans">({inProgressPurchases.length})</span>
                </h2>
                {inProgressPurchases.length > 0 ? (
                  <div className="space-y-4">
                    {inProgressPurchases.map(p => (
                      <div key={p.id} className="bg-white dark:bg-slate-900 p-5 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-sm flex flex-col sm:flex-row gap-5 items-start sm:items-center relative overflow-hidden group">
                        <div className="absolute top-0 left-0 w-1 h-full bg-amber-500"></div>
                        <PropertyImage src={p.property?.imageUrl} alt={p.property?.title || (isRtl ? 'صورة العقار' : 'Property image')} className="w-full sm:w-32 aspect-video sm:aspect-auto sm:h-24 rounded-xl object-cover" />
                        <div className="flex-1">
                          <div className="flex justify-between items-start mb-2">
                            <h4 className="font-bold text-slate-900 dark:text-white text-lg">{p.property?.title}</h4>
                            <span className="px-3 py-1 bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-400 text-[10px] font-black rounded-lg uppercase tracking-wider animate-pulse">{p.status}</span>
                          </div>
                          <p className="text-sm text-slate-500 dark:text-slate-400 flex items-center gap-1.5 mb-3"><MapPin size={14}/> {p.property?.location}</p>
                          <div className="flex justify-between items-center text-sm">
                            <span className="font-bold text-brand-600 dark:text-brand-400">{p.property?.price.toLocaleString()} EGP</span>
                            <span className="text-slate-400 text-xs">{p.purchaseDate}</span>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="bg-slate-50 dark:bg-slate-900/50 p-10 rounded-2xl border border-dashed border-slate-200 dark:border-slate-800 text-center">
                    <Clock className="mx-auto text-slate-300 dark:text-slate-700 mb-3" size={40} />
                    <p className="text-slate-500 dark:text-slate-400 font-medium">{isRtl ? 'لا توجد طلبات قيد التنفيذ.' : 'No in-progress requests.'}</p>
                  </div>
                )}
              </section>
            </div>
          )}

          {activeSubTab === 'favorites' && (
            <div className="animate-fade-in">
              <h2 className="text-xl font-bold text-slate-900 dark:text-white mb-6 flex items-center gap-2">
                <div className="p-2 bg-red-50 dark:bg-red-900/20 text-red-600 rounded-lg">
                  <Heart size={18} fill="currentColor" />
                </div>
                {t.prof_fav_title}
                <span className="text-sm font-normal text-slate-400 font-sans">({favoriteProperties.length})</span>
              </h2>
              {favoriteProperties.length > 0 ? (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
                  {favoriteProperties.map(p => (
                    <PropertyCard
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
          {activeSubTab === 'listings' && (
            <div className="animate-fade-in">
              <h2 className="text-xl font-bold text-slate-900 dark:text-white mb-2 flex items-center gap-2">
                <div className="p-2 bg-brand-50 dark:bg-brand-900/20 text-brand-600 rounded-lg">
                  <Building2 size={18} aria-hidden="true" />
                </div>
                {t.prof_listings}
                <span className="text-sm font-normal text-slate-400 font-sans">({myListings.length})</span>
              </h2>
              <p className="text-xs text-slate-500 dark:text-slate-400 mb-6">{t.listing_draft_note}</p>

              {listingError && (
                <p className="mb-4 p-3 rounded-xl bg-red-50 dark:bg-red-900/20 text-red-700 dark:text-red-400 text-sm font-medium">{listingError}</p>
              )}

              {myListings.length === 0 ? (
                <EmptyState
                  variant="favorites"
                  title={t.listing_none}
                  description={t.listing_draft_note}
                  actionLabel={t.prof_start_browsing}
                  onAction={onBrowse}
                  isRtl={isRtl}
                />
              ) : (
                <div className="space-y-4">
                  {myListings.map(p => {
                    const state = p.listingState || 'Live';
                    const rev = listingReviewInfo(p, t);
                    const stateLabel = state === 'Draft' ? t.listing_state_draft : state === 'Removed' ? t.listing_state_removed : t.listing_state_live;
                    return (
                      <div key={p.id} className="bg-white dark:bg-slate-900 p-4 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-sm">
                        <div className="flex flex-col sm:flex-row gap-4">
                          <button onClick={() => onOpenProperty(p.id)} className="shrink-0 cursor-pointer text-start">
                            <PropertyImage src={p.imageUrl} alt={p.title} iconSize={22} className="w-full sm:w-28 h-24 rounded-xl object-cover" />
                          </button>
                          <div className="flex-1 min-w-0">
                            <button onClick={() => onOpenProperty(p.id)} className="font-bold text-slate-900 dark:text-white hover:text-brand-600 cursor-pointer text-start truncate block w-full">
                              {p.title}
                            </button>
                            <p className="text-sm text-slate-500 dark:text-slate-400">
                              {priceLabel(p, isRtl)} • {p.location}
                            </p>
                            <div className="flex items-center gap-2 mt-2 flex-wrap">
                              <span className={`px-2.5 py-0.5 rounded-full text-[11px] font-bold ${state === 'Live' ? 'bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400' : 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300'}`}>
                                {stateLabel}
                              </span>
                              <span className={`px-2.5 py-0.5 rounded-full text-[11px] font-bold ${rev.chip}`}>{rev.label}</span>
                              {p.rejectedAt && p.verificationStatus !== 'Verified' && (
                                <span className="px-2.5 py-0.5 rounded-full text-[11px] font-bold bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-400">
                                  {isRtl ? 'مخفي لحد المراجعة' : 'Held until reviewed'}
                                </span>
                              )}
                            </div>
                            {p.reviewNote && (
                              <p className="mt-2 text-xs text-red-600 dark:text-red-400">
                                <strong>{t.doc_review_note}:</strong> {p.reviewNote}
                              </p>
                            )}
                          </div>
                          <div className="flex sm:flex-col gap-2 shrink-0">
                            <button
                              onClick={() => onEditListing?.(p.id)}
                              disabled={listingBusy === p.id}
                              className="px-3 py-1.5 rounded-lg text-xs font-bold bg-brand-50 dark:bg-brand-900/30 text-brand-700 dark:text-brand-400 hover:bg-brand-600 hover:text-white transition-all cursor-pointer disabled:opacity-50"
                            >
                              {t.listing_edit}
                            </button>
                            <button
                              onClick={() => setListingState(p.id, state === 'Live' ? 'Removed' : 'Live')}
                              disabled={listingBusy === p.id}
                              className="px-3 py-1.5 rounded-lg text-xs font-bold bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 hover:bg-slate-700 hover:text-white transition-all cursor-pointer disabled:opacity-50"
                            >
                              {state === 'Live' ? t.listing_unpublish : t.listing_publish}
                            </button>
                            <button
                              onClick={() => deleteListing(p)}
                              disabled={listingBusy === p.id}
                              className="px-3 py-1.5 rounded-lg text-xs font-bold bg-red-50 dark:bg-red-900/30 text-red-700 dark:text-red-400 hover:bg-red-600 hover:text-white transition-all cursor-pointer disabled:opacity-50"
                            >
                              {t.listing_delete}
                            </button>
                          </div>
                        </div>
                      </div>
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

const PaymentPage = ({ property, onConfirm, onCancel, t, isRtl }: { property: Property, onConfirm: () => void | Promise<void>, onCancel: () => void, t: any, isRtl: boolean }) => {
  const [processing, setProcessing] = useState(false);
  const [error, setError] = useState('');

  const handlePay = async () => {
    if (processing) return; // no double-submit -> no duplicate request
    setProcessing(true);
    setError('');
    try {
      await onConfirm();
    } catch (err: any) {
      // Previously the failure was swallowed and the user was navigated away as
      // if the request had gone through.
      console.error('Purchase request failed:', err);
      setError(isRtl
        ? 'تعذّر إرسال الطلب. حاول تاني أو كلّمنا على واتساب.'
        : 'Could not send your request. Please try again, or contact us on WhatsApp.');
    } finally {
      setProcessing(false);
    }
  };

  return (
    <div className="max-w-3xl mx-auto px-4 py-12 animate-fade-in transition-colors duration-500">
      <h1 className="text-3xl font-black text-slate-900 dark:text-white mb-8 tracking-tight uppercase">{isRtl ? 'طلب شراء وحدة' : 'Request to Purchase'}</h1>
      <div className="bg-white dark:bg-slate-900 p-8 rounded-3xl border border-slate-200 dark:border-slate-800 shadow-xl overflow-hidden relative">
        <div className="absolute top-0 right-0 p-8 opacity-5">
           <CreditCard size={120} />
        </div>
        <div className="flex items-center gap-6 mb-8 pb-8 border-b border-slate-100 dark:border-slate-800 relative z-10">
          <PropertyImage src={property.imageUrl} alt={property.title || (isRtl ? 'صورة العقار' : 'Property image')} iconSize={32} className="w-28 h-28 rounded-2xl object-cover shadow-md border border-white dark:border-slate-700" />
          <div className="flex-1">
            <h2 className="text-2xl font-black text-slate-900 dark:text-white leading-tight mb-1">{property.title}</h2>
            <p className="text-slate-500 dark:text-slate-400 font-medium flex items-center gap-1 text-sm"><MapPin size={14}/> {property.location}</p>
            <div className="text-2xl font-black text-brand-600 dark:text-brand-400 mt-3 flex items-baseline gap-1">
              <span>{property.price.toLocaleString()}</span>
              <span className="text-sm uppercase tracking-widest">{isRtl ? 'ج.م' : 'EGP'}</span>
            </div>
          </div>
        </div>
        
        <div className="space-y-6 relative z-10">
          {/* No card fields: nothing here charges a card. Collecting real card
              numbers that go nowhere is a liability, so this is an enquiry. */}
          <div className="bg-brand-50 dark:bg-brand-900/20 border border-brand-100 dark:border-brand-800 rounded-2xl p-5">
            <h3 className="font-black text-slate-900 dark:text-white mb-2 flex items-center gap-2">
              <FileCheck size={18} className="text-brand-600 dark:text-brand-400" aria-hidden="true" />
              {isRtl ? 'إيه اللي هيحصل دلوقتي؟' : 'What happens next?'}
            </h3>
            <ol className="text-sm text-slate-600 dark:text-slate-300 space-y-2 list-decimal ps-5 leading-relaxed">
              <li>{isRtl ? 'بنسجّل طلبك على الوحدة دي ويوصلك تأكيد.' : 'We register your request for this unit and send you a confirmation.'}</li>
              <li>{isRtl ? 'فريق هيتيتي بيراجع الطلب ويتواصل معاك.' : 'The HETTETY team reviews it and contacts you.'}</li>
              <li>{isRtl ? 'بنتفق على المعاينة والتفاصيل والدفع بعد كده — مفيش أي فلوس بتتدفع من هنا.' : 'Viewing, terms and payment are arranged with you directly — no money is taken here.'}</li>
            </ol>
          </div>

          <p className="text-xs text-slate-500 dark:text-slate-400 leading-relaxed">
            {isRtl
              ? 'إرسال الطلب مجاني ومش بيلزمك بأي حاجة، ومش بنطلب أي بيانات بنكية على الموقع.'
              : 'Sending a request is free and non-binding. We never ask for card or bank details on the site.'}
          </p>

          {error && (
            <p role="alert" className="text-sm font-bold text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-xl px-4 py-3">
              {error}
            </p>
          )}

          <div className="pt-4 flex flex-col sm:flex-row gap-4">
            <Button onClick={handlePay} disabled={processing} className="flex-1 py-4 text-lg font-black">
              {processing
                ? <Loader2 className="animate-spin mx-auto" aria-label={isRtl ? 'جاري الإرسال' : 'Sending'} />
                : (isRtl ? 'أرسل طلب الشراء' : 'Send purchase request')}
            </Button>
            <button onClick={onCancel} className="px-8 py-4 rounded-xl font-bold text-slate-600 dark:text-slate-400 bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 transition-colors cursor-pointer">
              {isRtl ? 'رجوع' : 'Cancel'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};



// --- Admin Dashboard ---
// Operations center for admins: live stats, property management, the
// verification queue and purchase requests. Role management is super-admin only.
const AdminDashboard = ({ isRtl, isSuperAdmin }: { isRtl: boolean; isSuperAdmin: boolean }) => {
  const [users, setUsers] = useState<any[]>([]);
  const [allProperties, setAllProperties] = useState<Property[]>([]);
  const [purchases, setPurchases] = useState<any[]>([]);
  const [reports, setReports] = useState<any[]>([]);
  const [reviewDocs, setReviewDocs] = useState<UserDocument[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<'stats' | 'properties' | 'verifications' | 'purchases' | 'users' | 'reports' | 'documents'>('stats');
  const [updating, setUpdating] = useState<string | null>(null);
  // Document being reviewed, plus the note the reviewer is writing about it.
  const [reviewingDoc, setReviewingDoc] = useState<UserDocument | null>(null);
  const [reviewNote, setReviewNote] = useState('');
  const [reviewFileUrl, setReviewFileUrl] = useState<string | null>(null);
  const [reviewError, setReviewError] = useState<string | null>(null);

  useEffect(() => {
    const fetchData = async () => {
      // Each collection is fetched independently so one denied read
      // doesn't blank the entire dashboard.
      const safeGet = async (name: string) => {
        try {
          const snap = await getDocs(collection(db, name));
          return snap.docs.map(d => ({ id: d.id, ...d.data() }));
        } catch (error) {
          console.error(`Error fetching ${name}:`, error);
          return [] as any[];
        }
      };
      // Only the documents actually waiting on a reviewer — the rules run isAdmin()
      // per returned doc, so pulling the whole collection would cost reads for nothing.
      const safeQueue = async () => {
        try {
          const snap = await getDocs(query(
            collection(db, 'user_documents'),
            where('reviewStatus', 'in', ['Uploaded', 'InReview'])
          ));
          return snap.docs.map(d => ({ id: d.id, ...d.data() })) as UserDocument[];
        } catch (error) {
          console.error('Error fetching document review queue:', error);
          return [] as UserDocument[];
        }
      };
      const [usersList, propsList, purchasesList, reportsList, docsList] = await Promise.all([
        safeGet('users'),
        safeGet('properties'),
        safeGet('purchases'),
        safeGet('reports'),
        safeQueue(),
      ]);
      setReviewDocs(docsList);
      setUsers(usersList);
      setAllProperties(propsList as Property[]);
      setPurchases(purchasesList);
      setReports(reportsList.sort((a: any, b: any) => (b.createdAt || '').localeCompare(a.createdAt || '')));
      setLoading(false);
    };
    fetchData();
  }, []);

  const pendingProperties = allProperties.filter(p => p.verificationStatus === 'Pending');
  const verifiedCount = allProperties.filter(p => p.isVerified).length;
  const forSaleCount = allProperties.filter(p => p.status === 'For Sale').length;
  const forRentCount = allProperties.filter(p => p.status === 'For Rent').length;
  const openPurchases = purchases.filter(p => p.status === 'processing');

  const propertyTitle = (id: string) => allProperties.find(p => p.id === id)?.title || `#${id.slice(0, 8)}`;
  const purchaserEmail = (uid: string) => users.find(u => u.id === uid)?.email || `#${uid.slice(0, 8)}`;

  const handleDeleteReport = async (id: string) => {
    setUpdating(id);
    try { await deleteDoc(doc(db, 'reports', id)); setReports(prev => prev.filter(r => r.id !== id)); }
    catch (e) { console.error('delete report failed', e); }
    finally { setUpdating(null); }
  };

  // Firestore stores dates as ISO strings or Timestamps depending on writer
  const toDate = (v: any): Date | null => {
    if (!v) return null;
    if (typeof v?.toDate === 'function') return v.toDate();
    const d = new Date(v);
    return isNaN(d.getTime()) ? null : d;
  };
  const lastSeen = (u: any) => toDate(u.lastLoginAt) ?? toDate(u.createdAt);

  // One person can end up with several auth accounts on the same email
  // (e.g. Google sign-in + email/password). Collapse them into a single row:
  // the admin account wins as the primary doc, the freshest login date is kept.
  const mergedUsers = (() => {
    const byEmail = new Map<string, any>();
    for (const u of users) {
      const key = (u.email || u.id).toLowerCase();
      const prev = byEmail.get(key);
      if (!prev) {
        byEmail.set(key, { ...u, accounts: 1, accountIds: [u.id] });
        continue;
      }
      const primary = prev.role === 'admin' ? prev
        : u.role === 'admin' ? u
        : (lastSeen(u)?.getTime() ?? 0) > (lastSeen(prev)?.getTime() ?? 0) ? u : prev;
      const latest = [prev, u].map(lastSeen).filter((d): d is Date => !!d).sort((a, b) => b.getTime() - a.getTime())[0];
      byEmail.set(key, { ...primary, accounts: prev.accounts + 1, accountIds: [...prev.accountIds, u.id], lastLoginAt: latest?.toISOString() ?? primary.lastLoginAt });
    }
    // Most recently active first
    return Array.from(byEmail.values()).sort((a, b) => (lastSeen(b)?.getTime() ?? 0) - (lastSeen(a)?.getTime() ?? 0));
  })();

  const toggleRole = async (userId: string, currentRole: string) => {
    setUpdating(userId);
    const newRole = currentRole === 'admin' ? 'user' : 'admin';
    try {
      await updateDoc(doc(db, 'users', userId), { role: newRole });
      setUsers(users.map(u => u.id === userId ? { ...u, role: newRole } : u));
    } catch (error) {
      console.error("Error updating role:", error);
    } finally {
      setUpdating(null);
    }
  };

  // Removes a person's user document(s). Note: this only clears their Firestore
  // profile (so they lose admin rights and vanish from the dashboard); their
  // Firebase Auth login still exists and can only be removed from the Firebase
  // Console or a Cloud Function with the Admin SDK.
  const handleDeleteUser = async (mUser: any) => {
    const email = mUser.email || mUser.id;
    if (!window.confirm(isRtl
      ? `متأكد إنك عايز تحذف المستخدم ${email} نهائيًا؟`
      : `Permanently delete user ${email}?`)) return;
    setUpdating(mUser.id);
    const ids: string[] = mUser.accountIds?.length ? mUser.accountIds : [mUser.id];
    try {
      await Promise.all(ids.map(id => deleteDoc(doc(db, 'users', id))));
      setUsers(prev => prev.filter(u => !ids.includes(u.id)));
    } catch (error) {
      console.error("Error deleting user:", error);
      alert(isRtl ? 'فشل حذف المستخدم' : 'Failed to delete the user');
    } finally {
      setUpdating(null);
    }
  };

  const handleSetAvailability = async (propId: string, availability: 'Available' | 'Sold' | 'Reserved') => {
    setUpdating(propId);
    try {
      await updateDoc(doc(db, 'properties', propId), { availability });
      setAllProperties(prev => prev.map(p => p.id === propId ? { ...p, availability } : p));
    } catch (error) {
      console.error("Error updating availability:", error);
      alert(isRtl ? 'فشل تحديث حالة التوفر' : 'Failed to update availability');
    } finally {
      setUpdating(null);
    }
  };

  const handleVerifyProperty = async (propId: string, status: 'Verified' | 'Rejected' | 'Pending', note?: string) => {
    setUpdating(propId);
    try {
      // Who decided, and when — so a badge is always traceable to a person.
      const patch: Record<string, unknown> = {
        verificationStatus: status,
        isVerified: status === 'Verified',
        verifiedBy: auth.currentUser?.email || '',
        verifiedAt: new Date().toISOString(),
      };
      // Only overwrite the note when this verdict carries one — otherwise a
      // Verify click would silently erase the reason a listing was pulled.
      if (note !== undefined) patch.reviewNote = note;
      if (status === 'Rejected') patch.rejectedAt = new Date().toISOString();
      if (status === 'Verified') patch.rejectedAt = '';   // approved: the pull is lifted
      await updateDoc(doc(db, 'properties', propId), patch);
      setAllProperties(prev => prev.map(p => p.id === propId ? { ...p, ...patch } as Property : p));

      // Tell the owner. isValidNotification allows exactly five keys and there is no
      // locale field, so both languages go into the one message, Arabic first.
      const prop = allProperties.find(p => p.id === propId);
      if (prop?.authorUid && prop.authorUid !== 'anonymous') {
        const msg = status === 'Verified'
          ? `راجع فريق حتتي مستندات إعلانك «${prop.title}». — A HETTETY reviewer has reviewed the documents for your listing "${prop.title}".`
          : status === 'Rejected'
            ? `إعلانك «${prop.title}» محتاج تعديل. ${note || ''} — Your listing "${prop.title}" needs changes. ${note || ''}`
            : `رجع إعلانك «${prop.title}» لحالة «لم تتم المراجعة». — Your listing "${prop.title}" is back to "not reviewed".`;
        await addDoc(collection(db, 'notifications'), {
          userId: prop.authorUid,
          title: status === 'Rejected' ? 'إعلانك يحتاج تعديل / Listing needs changes' : 'تحديث مراجعة إعلانك / Listing review update',
          message: msg.slice(0, 999),
          date: new Date().toISOString(),
          read: false,
        }).catch(err => console.error('Owner notification failed:', err));
      }
    } catch (error) {
      console.error("Error verifying property:", error);
      // Silence here left the admin staring at a row that never changed.
      alert(isRtl
        ? 'تعذّر حفظ القرار. الإعلان زي ما هو — جرّب تاني.'
        : 'Could not save the verdict. The listing is unchanged — please try again.');
    } finally {
      setUpdating(null);
    }
  };

  /**
   * Move a document through the review queue. Only an admin can reach this — the
   * user_documents rules pin an owner's create to 'Uploaded' and let them change
   * nothing but the file name afterwards.
   */
  const handleReviewDoc = async (target: UserDocument, next: 'InReview' | 'Checked' | 'NeedsAttention', note: string) => {
    if (next === 'NeedsAttention' && !note.trim()) {
      setReviewError(isRtl ? 'اكتب سبب الرفض قبل الإرسال.' : 'Write what needs fixing before sending it back.');
      return;
    }
    setUpdating(target.id);
    setReviewError(null);
    try {
      const patch: Record<string, unknown> = {
        reviewStatus: next,
        reviewedBy: auth.currentUser?.email || '',
        reviewedAt: new Date().toISOString(),
      };
      if (next !== 'InReview') patch.reviewNote = note.trim();
      await updateDoc(doc(db, 'user_documents', target.id), patch);

      setReviewDocs(prev => next === 'InReview'
        ? prev.map(d => d.id === target.id ? { ...d, ...patch } as UserDocument : d)
        : prev.filter(d => d.id !== target.id));  // leaves the queue once decided
      if (next !== 'InReview') { setReviewingDoc(null); setReviewNote(''); setReviewFileUrl(null); }
      else setReviewingDoc(prev => prev && prev.id === target.id ? { ...prev, ...patch } as UserDocument : prev);

      if (next !== 'InReview' && target.ownerUid) {
        const label = next === 'Checked'
          ? 'راجع فريق حتتي مستندك. المراجعة مش إثبات إن المستند سليم أو مسجّل في الشهر العقاري. — A HETTETY reviewer read your document. A review is not proof the document is genuine or registered.'
          : `مستندك محتاج إجراء: ${note.trim()} — Your document needs attention: ${note.trim()}`;
        await addDoc(collection(db, 'notifications'), {
          userId: target.ownerUid,
          title: 'تحديث مراجعة المستند / Document review update',
          message: `${target.name} — ${label}`.slice(0, 999),
          date: new Date().toISOString(),
          read: false,
        }).catch(err => console.error('Owner notification failed:', err));
      }
    } catch (error) {
      console.error('Error reviewing document:', error);
      setReviewError(isRtl ? 'تعذّر حفظ المراجعة.' : 'Could not save the review.');
    } finally {
      setUpdating(null);
    }
  };

  /**
   * Resolve the file from its Storage path under the reviewer's own auth rather
   * than from the stored download URL, which is a bearer token.
   */
  const openDocForReview = async (target: UserDocument) => {
    setReviewingDoc(target);
    setReviewNote(target.reviewNote || '');
    setReviewError(null);
    setReviewFileUrl(null);
    try {
      if (target.storagePath) setReviewFileUrl(await getDownloadURL(ref(storage, target.storagePath)));
      else setReviewError(isRtl ? 'المستند ده اترفع قبل تسجيل المسار — افتحه من الكونسول.' : 'This document predates path tracking — open it from the Firebase console.');
    } catch (error) {
      console.error('Could not resolve document file:', error);
      setReviewError(isRtl ? 'تعذّر فتح الملف.' : 'Could not open the file.');
    }
  };

  /** Take a listing off the public site without destroying it. Reversible. */
  const handleHideProperty = async (propId: string, next: 'Live' | 'Removed') => {
    setUpdating(propId);
    try {
      await updateDoc(doc(db, 'properties', propId), { listingState: next });
      setAllProperties(prev => prev.map(p => p.id === propId ? { ...p, listingState: next } : p));
    } catch (error) {
      console.error('Error changing listing state:', error);
      alert(isRtl ? 'تعذّر تغيير حالة الإعلان.' : 'Could not change the listing state.');
    } finally {
      setUpdating(null);
    }
  };

  const handleDeleteProperty = async (propId: string) => {
    const prop = allProperties.find(p => p.id === propId);
    const name = prop?.title || propId;
    // A listing deleted here is unrecoverable — there is no trash and no undo.
    // Name what is going, and point at the reversible option first.
    if (!window.confirm(isRtl
      ? `حذف «${name}» نهائيًا؟\n\nمفيش تراجع ومفيش سلة محذوفات — الإعلان وبياناته هيروحوا خالص.\nلو عايز تشيله من الموقع بس، اقفل واستخدم «إخفاء» — دي بترجع.`
      : `Permanently delete "${name}"?\n\nThere is no undo and no trash — the listing and its data are gone.\nIf you only want it off the site, cancel and use Hide instead — that is reversible.`)) return;
    setUpdating(propId);
    try {
      await deleteDoc(doc(db, 'properties', propId));
      setAllProperties(prev => prev.filter(p => p.id !== propId));
    } catch (error) {
      console.error("Error deleting property:", error);
      alert(isRtl ? 'فشل حذف العقار' : 'Failed to delete the property');
    } finally {
      setUpdating(null);
    }
  };

  const handlePurchaseStatus = async (purchaseId: string, status: 'completed' | 'cancelled') => {
    setUpdating(purchaseId);
    try {
      await updateDoc(doc(db, 'purchases', purchaseId), { status });
      setPurchases(prev => prev.map(p => p.id === purchaseId ? { ...p, status } : p));
    } catch (error) {
      console.error("Error updating purchase:", error);
    } finally {
      setUpdating(null);
    }
  };

  if (loading) return (
    <div className="flex flex-col items-center justify-center min-h-[60vh]">
      <Loader2 className="animate-spin text-brand-600 mb-4" size={48} />
      <p className="text-slate-500 font-medium">Initializing HETTETY Command Center...</p>
    </div>
  );

  return (
    <div className="max-w-7xl mx-auto py-12 px-4 animate-fade-in transition-colors duration-500">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-6 mb-12">
        <div className="flex items-center gap-4">
          <div className="w-14 h-14 bg-slate-900 dark:bg-black rounded-2xl flex items-center justify-center shadow-lg border border-slate-800 dark:border-slate-700">
            <Shield className="text-accent-500" size={32} />
          </div>
          <div>
            <h1 className="text-4xl font-heading font-black text-slate-900 dark:text-white tracking-tight">
              {isSuperAdmin ? (isRtl ? 'لوحة تحكم السوبر أدمن' : 'Super Admin Dashboard') : (isRtl ? 'لوحة تحكم الأدمن' : 'Admin Dashboard')}
            </h1>
            <p className="text-slate-500 dark:text-slate-400 font-medium">{isRtl ? 'مركز إدارة عمليات HETTETY' : 'HETTETY Operations Command Center'}</p>
          </div>
        </div>

        <div className="flex overflow-x-auto no-scrollbar gap-1 bg-slate-100 dark:bg-slate-800 p-1 rounded-xl border border-slate-200 dark:border-slate-700 max-w-full" role="tablist" aria-label={isRtl ? 'أقسام لوحة التحكم' : 'Admin dashboard sections'}>
          {[
            { id: 'stats', label: isRtl ? 'الإحصائيات' : 'Stats', icon: <Target size={16} aria-hidden="true" /> },
            { id: 'properties', label: isRtl ? 'العقارات' : 'Properties', icon: <Building2 size={16} aria-hidden="true" /> },
            { id: 'verifications', label: isRtl ? 'التوثيقات' : 'Verifications', icon: <Shield size={16} aria-hidden="true" />, badge: pendingProperties.length },
            { id: 'purchases', label: isRtl ? 'طلبات الشراء' : 'Purchases', icon: <CreditCard size={16} aria-hidden="true" />, badge: openPurchases.length },
            { id: 'reports', label: isRtl ? 'البلاغات' : 'Reports', icon: <Shield size={16} aria-hidden="true" />, badge: reports.length },
            { id: 'documents', label: isRtl ? 'المستندات' : 'Documents', icon: <FileText size={16} aria-hidden="true" />, badge: reviewDocs.length },
            ...(isSuperAdmin ? [{ id: 'users', label: isRtl ? 'المستخدمين' : 'Users', icon: <Users size={16} aria-hidden="true" /> }] : []),
          ].map(tab => (
            <button
              key={tab.id}
              role="tab"
              aria-selected={activeTab === tab.id}
              onClick={() => setActiveTab(tab.id as any)}
              className={`flex items-center gap-2 px-4 sm:px-6 py-2.5 rounded-lg text-sm font-bold transition-all whitespace-nowrap shrink-0 focus:outline-none focus:ring-2 focus:ring-brand-500 ${
                activeTab === tab.id 
                ? 'bg-white dark:bg-slate-700 text-brand-900 dark:text-white shadow-sm border border-slate-200 dark:border-slate-600' 
                : 'text-slate-500 dark:text-slate-400 hover:text-brand-600 dark:hover:text-brand-400 cursor-pointer'
              }`}
            >
              {tab.icon} {tab.label}
              {tab.badge !== undefined && tab.badge > 0 && (
                <span className="bg-accent-500 text-white text-[10px] w-5 h-5 rounded-full flex items-center justify-center animate-pulse">
                  {tab.badge}
                </span>
              )}
            </button>
          ))}
        </div>
      </div>

      {activeTab === 'stats' && (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
          {[
            { label: isRtl ? 'إجمالي المستخدمين' : 'Total Users', value: mergedUsers.length, icon: <Users />, color: 'bg-blue-50 dark:bg-blue-900/20 text-blue-600 dark:text-blue-400' },
            { label: isRtl ? 'إجمالي العقارات' : 'Total Properties', value: allProperties.length, icon: <Building2 />, color: 'bg-brand-50 dark:bg-brand-900/20 text-brand-600 dark:text-brand-400' },
            { label: isRtl ? 'العقارات الموثقة' : 'Verified Units', value: verifiedCount, icon: <CheckCircle />, color: 'bg-green-50 dark:bg-green-900/20 text-green-600 dark:text-green-400' },
            { label: isRtl ? 'طلبات التوثيق' : 'Pending Verifications', value: pendingProperties.length, icon: <Clock />, color: 'bg-orange-50 dark:bg-orange-900/20 text-orange-600 dark:text-orange-400' },
            { label: isRtl ? 'بيع / إيجار' : 'For Sale / Rent', value: `${forSaleCount} / ${forRentCount}`, icon: <Key />, color: 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300' },
            { label: isRtl ? 'طلبات شراء جديدة' : 'Open Purchase Requests', value: openPurchases.length, icon: <CreditCard />, color: 'bg-accent-50 dark:bg-accent-900/20 text-accent-600 dark:text-accent-400' },
          ].map((stat, i) => (
            <div key={i} className="bg-white dark:bg-slate-900 p-8 rounded-3xl border border-slate-100 dark:border-slate-800 shadow-sm transition-colors duration-500">
              <div className={`w-12 h-12 ${stat.color} rounded-2xl flex items-center justify-center mb-6`}>
                {stat.icon}
              </div>
              <p className="text-slate-500 dark:text-slate-400 font-bold text-sm uppercase tracking-wider mb-2">{stat.label}</p>
              <h3 className="text-4xl font-black text-slate-900 dark:text-white">{stat.value}</h3>
            </div>
          ))}
        </div>
      )}

      {activeTab === 'verifications' && (
        <div className="bg-white dark:bg-slate-900 rounded-3xl border border-slate-200 dark:border-slate-800 overflow-hidden shadow-xl animate-scale-up">
          <div className="p-6 border-b border-slate-100 dark:border-slate-800 bg-slate-50 dark:bg-slate-800/50">
            <h2 className="font-bold text-slate-800 dark:text-white flex items-center gap-2">
              <ShieldCheck className="text-green-600 dark:text-green-400" />
              {isRtl ? 'طلبات التوثيق المعلقة' : 'Pending Verification Requests'}
            </h2>
          </div>
          {pendingProperties.length === 0 ? (
            <div className="p-20 text-center text-slate-400 dark:text-slate-600">
              <CheckCircle size={48} className="mx-auto mb-4 opacity-20" />
              <p className="font-medium">{isRtl ? 'لا توجد طلبات معلقة حالياً' : 'No pending requests at the moment.'}</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left">
                <thead className="bg-slate-50 dark:bg-slate-800 text-slate-500 dark:text-slate-400 text-xs font-black uppercase tracking-widest">
                  <tr>
                    <th className="px-8 py-4">{isRtl ? 'العقار' : 'Property'}</th>
                    <th className="px-8 py-4">{isRtl ? 'الموقع' : 'Location'}</th>
                    <th className="px-8 py-4">{isRtl ? 'التاريخ' : 'Date'}</th>
                    <th className="px-8 py-4 text-right">{isRtl ? 'الإجراءات' : 'Actions'}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                  {pendingProperties.map((prop) => (
                    <tr key={prop.id} className="hover:bg-slate-50/50 dark:hover:bg-slate-800/50 transition-colors">
                      <td className="px-8 py-6">
                        <div className="flex items-center gap-4">
                          <PropertyImage src={prop.imageUrl} alt={prop.title || (isRtl ? 'صورة العقار' : 'Property thumbnail')} iconSize={18} className="w-12 h-12 rounded-lg object-cover" />
                          <div>
                            <div className="font-bold text-slate-900 dark:text-white">{prop.title}</div>
                            <div className="text-xs text-brand-600 dark:text-brand-400 font-medium">{prop.unitCode}</div>
                          </div>
                        </div>
                      </td>
                      <td className="px-8 py-6 text-slate-600 dark:text-slate-400 text-sm">{prop.location}</td>
                      <td className="px-8 py-6 text-slate-400 dark:text-slate-500 text-xs">
                        <div>{prop.publishDate}</div>
                        {/* The verdict says "a reviewer read the documents this seller
                            uploaded". The reviewer has to be able to open them. */}
                        {prop.legalDocs?.length ? (
                          <div className="mt-1 flex flex-col gap-0.5">
                            {prop.legalDocs.map((docUrl, i) => (
                              <a key={i} href={docUrl} target="_blank" rel="noopener noreferrer" className="text-brand-600 dark:text-brand-400 font-bold hover:underline">
                                {isRtl ? `مستند ${i + 1}` : `Document ${i + 1}`}
                              </a>
                            ))}
                          </div>
                        ) : (
                          <div className="mt-1 font-bold text-amber-600 dark:text-amber-400">
                            {isRtl ? 'مفيش مستندات' : 'No documents'}
                          </div>
                        )}
                      </td>
                      <td className="px-8 py-6 text-right">
                        <div className="flex justify-end gap-2">
                          <button 
                            onClick={() => handleVerifyProperty(prop.id, 'Verified')}
                            disabled={!prop.legalDocs?.length}
                            title={!prop.legalDocs?.length ? (isRtl ? 'الإعلان ده مرفقش أي مستندات' : 'This listing has no documents attached') : undefined}
                            className="bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400 hover:bg-green-600 dark:hover:bg-green-600 hover:text-white px-4 py-2 rounded-lg text-xs font-bold transition-all cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:bg-green-100"
                          >
                            {isRtl ? 'توثيق' : 'Verify'}
                          </button>
                          <button 
                            onClick={() => {
                              // A rejection with no reason leaves the owner staring at
                              // a red chip and nothing else.
                              const note = window.prompt(isRtl
                                ? 'اكتب سبب الرفض — هيوصل لصاحب الإعلان.'
                                : "Why is this being rejected? The owner will see this.");
                              if (note === null) return;          // cancelled
                              if (!note.trim()) {
                                alert(isRtl ? 'لازم تكتب سبب.' : 'A reason is required.');
                                return;
                              }
                              handleVerifyProperty(prop.id, 'Rejected', note.trim());
                            }}
                            className="bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-400 hover:bg-red-600 dark:hover:bg-red-600 hover:text-white px-4 py-2 rounded-lg text-xs font-bold transition-all cursor-pointer"
                          >
                            {isRtl ? 'رفض' : 'Reject'}
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {activeTab === 'documents' && (
        <div className="bg-white dark:bg-slate-900 rounded-3xl border border-slate-200 dark:border-slate-800 overflow-hidden shadow-xl animate-scale-up">
          <div className="p-6 border-b border-slate-100 dark:border-slate-800 bg-slate-50 dark:bg-slate-800/50">
            <h2 className="font-bold text-slate-800 dark:text-white flex items-center gap-2">
              <FileText className="text-brand-600 dark:text-brand-400" aria-hidden="true" />
              {isRtl ? `مستندات في انتظار المراجعة (${reviewDocs.length})` : `Documents awaiting review (${reviewDocs.length})`}
            </h2>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
              {isRtl
                ? 'المراجعة معناها إن حد من الفريق قرأ النسخة المرفوعة. مش إثبات إن المستند سليم ولا إنه مسجّل في الشهر العقاري.'
                : 'A review means a person read the uploaded copy. It is not proof the document is genuine or registered with the Real Estate Publicity Department.'}
            </p>
          </div>
          {reviewDocs.length === 0 ? (
            <div className="p-20 text-center text-slate-400 dark:text-slate-600">
              <FileText size={48} className="mx-auto mb-4 opacity-20" aria-hidden="true" />
              <p className="font-medium">{isRtl ? 'مفيش مستندات مستنية مراجعة.' : 'Nothing waiting for review.'}</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left">
                <thead className="bg-slate-50 dark:bg-slate-800 text-slate-500 dark:text-slate-400 text-xs font-black uppercase tracking-widest">
                  <tr>
                    <th className="px-8 py-4">{isRtl ? 'الملف' : 'File'}</th>
                    <th className="px-8 py-4">{isRtl ? 'صاحبه' : 'Owner'}</th>
                    <th className="px-8 py-4">{isRtl ? 'التاريخ' : 'Date'}</th>
                    <th className="px-8 py-4">{isRtl ? 'الحالة' : 'State'}</th>
                    <th className="px-8 py-4 text-right">{isRtl ? 'الإجراءات' : 'Actions'}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                  {reviewDocs.map((d) => (
                    <tr key={d.id} className="hover:bg-slate-50/50 dark:hover:bg-slate-800/50 transition-colors">
                      <td className="px-8 py-6">
                        <div className="font-bold text-slate-900 dark:text-white">{d.name}</div>
                        <div className="text-xs text-brand-600 dark:text-brand-400 font-mono">{d.fileId} • {d.type}</div>
                      </td>
                      <td className="px-8 py-6 text-slate-600 dark:text-slate-400 text-sm">{users.find(u => u.id === d.ownerUid)?.email || `#${(d.ownerUid || '').slice(0, 8)}`}</td>
                      <td className="px-8 py-6 text-slate-400 dark:text-slate-500 text-xs">{d.uploadDate}</td>
                      <td className="px-8 py-6">
                        <span className={`px-3 py-1 rounded-full text-xs font-bold border ${d.reviewStatus === 'InReview' ? 'bg-amber-50 dark:bg-amber-900/20 text-amber-700 dark:text-amber-400 border-amber-200 dark:border-amber-800' : 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 border-slate-200 dark:border-slate-700'}`}>
                          {d.reviewStatus === 'InReview' ? (isRtl ? 'قيد المراجعة' : 'Under review') : (isRtl ? 'لم تتم مراجعته' : 'Not reviewed')}
                        </span>
                      </td>
                      <td className="px-8 py-6 text-right">
                        <button
                          onClick={() => openDocForReview(d)}
                          disabled={updating === d.id}
                          className="bg-brand-100 dark:bg-brand-900/30 text-brand-700 dark:text-brand-400 hover:bg-brand-600 dark:hover:bg-brand-600 hover:text-white px-4 py-2 rounded-lg text-xs font-bold transition-all cursor-pointer disabled:opacity-50"
                        >
                          {isRtl ? 'مراجعة' : 'Review'}
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {reviewingDoc && (
        <div className="fixed inset-0 z-[100] bg-slate-900/60 backdrop-blur-sm flex items-center justify-center p-4 animate-fade-in" onClick={() => { setReviewingDoc(null); setReviewFileUrl(null); }}>
          <div role="dialog" aria-modal="true" aria-label={isRtl ? 'مراجعة مستند' : 'Review document'} className="bg-white dark:bg-slate-900 rounded-2xl w-full max-w-4xl max-h-[90vh] flex flex-col overflow-hidden shadow-2xl border border-slate-200 dark:border-slate-800" onClick={(e) => e.stopPropagation()}>
            <div className="flex justify-between items-center p-4 border-b border-slate-100 dark:border-slate-800 bg-slate-50 dark:bg-slate-800">
              <div className="min-w-0">
                <h3 className="font-bold text-slate-900 dark:text-white truncate">{reviewingDoc.name}</h3>
                <p className="text-xs text-slate-500 dark:text-slate-400 font-mono">{reviewingDoc.fileId} • {reviewingDoc.type}</p>
              </div>
              <button type="button" onClick={() => { setReviewingDoc(null); setReviewFileUrl(null); }} aria-label={isRtl ? 'إغلاق' : 'Close'} className="min-w-[48px] min-h-[48px] p-3 text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200 hover:bg-slate-200 dark:hover:bg-slate-700 rounded-full transition-colors cursor-pointer flex items-center justify-center">
                <X size={20} aria-hidden="true" />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto bg-slate-100 dark:bg-slate-950 p-4">
              {reviewError && <p className="mb-4 p-3 rounded-xl bg-red-50 dark:bg-red-900/20 text-red-700 dark:text-red-400 text-sm font-medium">{reviewError}</p>}
              {reviewFileUrl ? (
                reviewingDoc.type === 'Image' ? (
                  <img src={reviewFileUrl} alt={reviewingDoc.name} className="max-w-full mx-auto rounded-xl" referrerPolicy="no-referrer" />
                ) : (
                  <iframe src={reviewFileUrl} title={reviewingDoc.name} className="w-full min-h-[55vh] border-0 rounded-xl bg-white" />
                )
              ) : !reviewError ? (
                <div className="py-20 text-center text-slate-400"><Loader2 className="animate-spin w-6 h-6 mx-auto" aria-hidden="true" /></div>
              ) : null}
            </div>

            <div className="p-4 border-t border-slate-100 dark:border-slate-800 space-y-3">
              <label htmlFor="admin-review-note" className="block text-sm font-bold text-slate-700 dark:text-slate-300">
                {isRtl ? 'ملاحظة المراجع (إجبارية عند طلب تعديل)' : "Reviewer's note (required when sending back)"}
              </label>
              <textarea
                id="admin-review-note"
                value={reviewNote}
                onChange={(e) => setReviewNote(e.target.value)}
                rows={2}
                maxLength={1999}
                placeholder={isRtl ? 'اكتب اللي شفته بالظبط.' : 'Write exactly what you saw.'}
                className="w-full px-4 py-2.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-900 dark:text-white outline-none focus:ring-2 focus:ring-brand-500"
              />
              <div className="flex flex-wrap gap-2 justify-end">
                {reviewingDoc.reviewStatus !== 'InReview' && (
                  <button onClick={() => handleReviewDoc(reviewingDoc, 'InReview', reviewNote)} disabled={updating === reviewingDoc.id} className="px-4 py-2 rounded-lg text-xs font-bold bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-400 hover:bg-amber-600 hover:text-white transition-all cursor-pointer disabled:opacity-50">
                    {isRtl ? 'بدء المراجعة' : 'Start review'}
                  </button>
                )}
                <button onClick={() => handleReviewDoc(reviewingDoc, 'NeedsAttention', reviewNote)} disabled={updating === reviewingDoc.id || !reviewFileUrl} className="px-4 py-2 rounded-lg text-xs font-bold bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-400 hover:bg-red-600 hover:text-white transition-all cursor-pointer disabled:opacity-50">
                  {isRtl ? 'يحتاج إجراء' : 'Needs attention'}
                </button>
                <button onClick={() => handleReviewDoc(reviewingDoc, 'Checked', reviewNote)} disabled={updating === reviewingDoc.id || !reviewFileUrl} className="px-4 py-2 rounded-lg text-xs font-bold bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400 hover:bg-green-600 hover:text-white transition-all cursor-pointer disabled:opacity-50">
                  {isRtl ? 'تمت المراجعة' : 'Mark reviewed'}
                </button>
              </div>
              <p className="text-[11px] text-slate-400 dark:text-slate-500">
                {isRtl
                  ? '«تمت المراجعة» معناها إنك قريت النسخة دي. مش شهادة بصحة المستند ولا بتسجيله في الشهر العقاري.'
                  : '"Reviewed" means you read this copy. It is not a certificate of authenticity, nor of registration with the Real Estate Publicity Department.'}
              </p>
              {!reviewFileUrl && (
                <p className="text-[11px] font-bold text-amber-600 dark:text-amber-400">
                  {isRtl
                    ? 'مينفعش تسجّل مراجعة لملف ما اتفتحش. مستندات المستخدمين مفتوحة للحسابات الرئيسية بس (SUPER_ADMIN_EMAILS).'
                    : 'You cannot record a review of a file that did not open. User documents are readable only by the accounts in SUPER_ADMIN_EMAILS.'}
                </p>
              )}
            </div>
          </div>
        </div>
      )}

      {activeTab === 'properties' && (
        <div className="bg-white dark:bg-slate-900 rounded-3xl border border-slate-200 dark:border-slate-800 overflow-hidden shadow-xl animate-scale-up">
          <div className="p-6 border-b border-slate-100 dark:border-slate-800 bg-slate-50 dark:bg-slate-800/50 flex items-center justify-between">
            <h2 className="font-bold text-slate-800 dark:text-white flex items-center gap-2">
              <Building2 className="text-brand-600 dark:text-brand-400" />
              {isRtl ? `كل العقارات (${allProperties.length})` : `All Properties (${allProperties.length})`}
            </h2>
            {allProperties.length > 0 && (
              <button onClick={() => downloadCsv('properties.csv', allProperties.map(p => ({ id: p.id, title: p.title, type: p.propertyType, price: p.price, currency: p.currency || 'EGP', location: p.location, compound: p.compound, developer: p.developer, bedrooms: p.bedrooms, bathrooms: p.bathrooms, area: p.area, status: p.status, availability: p.availability, verification: p.verificationStatus, unitCode: p.unitCode, publishDate: p.publishDate })))} className="text-xs bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-300 px-3 py-1.5 rounded-lg font-bold flex items-center gap-1.5 hover:bg-slate-100 dark:hover:bg-slate-700">
                <Upload size={14} className="rotate-180" /> {isRtl ? 'تصدير CSV' : 'Export CSV'}
              </button>
            )}
          </div>
          {allProperties.length === 0 ? (
            <div className="p-20 text-center text-slate-400 dark:text-slate-600">
              <Building2 size={48} className="mx-auto mb-4 opacity-20" />
              <p className="font-medium">{isRtl ? 'لا توجد عقارات بعد' : 'No properties yet.'}</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left">
                <thead className="bg-slate-50 dark:bg-slate-800 text-slate-500 dark:text-slate-400 text-xs font-black uppercase tracking-widest">
                  <tr>
                    <th className="px-8 py-4">{isRtl ? 'العقار' : 'Property'}</th>
                    <th className="px-8 py-4">{isRtl ? 'الموقع' : 'Location'}</th>
                    <th className="px-8 py-4">{isRtl ? 'السعر' : 'Price'}</th>
                    <th className="px-8 py-4">{isRtl ? 'الحالة' : 'Status'}</th>
                    <th className="px-8 py-4">{isRtl ? 'التوفر' : 'Availability'}</th>
                    <th className="px-8 py-4">{isRtl ? 'التوثيق' : 'Verification'}</th>
                    <th className="px-8 py-4 text-right">{isRtl ? 'الإجراءات' : 'Actions'}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                  {allProperties.map((prop) => (
                    <tr key={prop.id} className="hover:bg-slate-50/50 dark:hover:bg-slate-800/50 transition-colors">
                      <td className="px-8 py-5">
                        <div className="flex items-center gap-4">
                          {prop.imageUrl
                            ? <PropertyImage src={prop.imageUrl} alt={prop.title || (isRtl ? 'صورة العقار' : 'Property thumbnail')} iconSize={18} className="w-12 h-12 rounded-lg object-cover" />
                            : <div className="w-12 h-12 rounded-lg bg-slate-100 dark:bg-slate-800 flex items-center justify-center text-slate-400"><Building2 size={20} aria-hidden="true" /></div>}
                          <div>
                            <div className="font-bold text-slate-900 dark:text-white line-clamp-1 max-w-[16rem]">{prop.title}</div>
                            <div className="text-xs text-brand-600 dark:text-brand-400 font-medium">{prop.unitCode}</div>
                          </div>
                        </div>
                      </td>
                      <td className="px-8 py-5 text-slate-600 dark:text-slate-400 text-sm">{prop.location}</td>
                      <td className="px-8 py-5 text-slate-900 dark:text-white text-sm font-bold whitespace-nowrap">{prop.price?.toLocaleString(isRtl ? 'ar-EG' : 'en-US')} {isRtl ? 'ج.م' : 'EGP'}</td>
                      <td className="px-8 py-5">
                        <span className={`px-3 py-1 rounded-full text-[10px] font-black uppercase tracking-wider whitespace-nowrap ${prop.status === 'For Sale' ? 'bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-400' : 'bg-purple-100 dark:bg-purple-900/30 text-purple-700 dark:text-purple-400'}`}>
                          {prop.status === 'For Sale' ? (isRtl ? 'للبيع' : 'For Sale') : (isRtl ? 'للإيجار' : 'For Rent')}
                        </span>
                      </td>
                      <td className="px-8 py-5">
                        <select
                          value={prop.availability || 'Available'}
                          disabled={updating === prop.id}
                          onChange={(e) => handleSetAvailability(prop.id, e.target.value as 'Available' | 'Sold' | 'Reserved')}
                          className="px-3 py-1.5 rounded-lg text-xs font-bold bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-200 outline-none cursor-pointer"
                        >
                          <option value="Available">{isRtl ? 'متاح' : 'Available'}</option>
                          <option value="Reserved">{isRtl ? 'محجوز' : 'Reserved'}</option>
                          <option value="Sold">{prop.status === 'For Rent' ? (isRtl ? 'مؤجَّر' : 'Rented') : (isRtl ? 'مباع' : 'Sold')}</option>
                        </select>
                      </td>
                      <td className="px-8 py-5">
                        <span className={`px-3 py-1 rounded-full text-[10px] font-black uppercase tracking-wider whitespace-nowrap ${
                          prop.verificationStatus === 'Verified' ? 'bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400'
                          : prop.verificationStatus === 'Rejected' ? 'bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-400'
                          : 'bg-orange-100 dark:bg-orange-900/30 text-orange-700 dark:text-orange-400'
                        }`}>
                          {prop.verificationStatus === 'Verified' ? (isRtl ? 'موثق' : 'Verified') : prop.verificationStatus === 'Rejected' ? (isRtl ? 'مرفوض' : 'Rejected') : (isRtl ? 'معلق' : 'Pending')}
                        </span>
                      </td>
                      <td className="px-8 py-5 text-right">
                        <div className="flex justify-end gap-2">
                          {prop.verificationStatus === 'Verified' ? (
                            <button
                              onClick={() => handleVerifyProperty(prop.id, 'Pending')}
                              disabled={updating === prop.id}
                              className="bg-orange-100 dark:bg-orange-900/30 text-orange-700 dark:text-orange-400 hover:bg-orange-500 hover:text-white px-4 py-2 rounded-lg text-xs font-bold transition-all cursor-pointer whitespace-nowrap"
                            >
                              {isRtl ? 'إلغاء التوثيق' : 'Unverify'}
                            </button>
                          ) : (
                            <button
                              onClick={() => handleVerifyProperty(prop.id, 'Verified')}
                              disabled={updating === prop.id}
                              className="bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400 hover:bg-green-600 hover:text-white px-4 py-2 rounded-lg text-xs font-bold transition-all cursor-pointer whitespace-nowrap"
                            >
                              {isRtl ? 'توثيق' : 'Verify'}
                            </button>
                          )}
                          <button
                            type="button"
                            onClick={() => handleHideProperty(prop.id, (prop.listingState || 'Live') === 'Live' ? 'Removed' : 'Live')}
                            disabled={updating === prop.id}
                            className="bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 hover:bg-slate-700 hover:text-white px-4 py-2 rounded-lg text-xs font-bold transition-all cursor-pointer whitespace-nowrap disabled:opacity-50"
                          >
                            {(prop.listingState || 'Live') === 'Live' ? (isRtl ? 'إخفاء' : 'Hide') : (isRtl ? 'إظهار' : 'Show')}
                          </button>
                          <button
                            type="button"
                            onClick={() => { window.location.hash = `edit-listing/${prop.id}`; }}
                            aria-label={isRtl ? `تعديل العقار ${prop.title}` : `Edit property ${prop.title}`}
                            className="bg-brand-100 dark:bg-brand-900/30 text-brand-700 dark:text-brand-400 hover:bg-brand-600 hover:text-white px-4 py-2 rounded-lg text-xs font-bold transition-all cursor-pointer whitespace-nowrap"
                          >
                            {isRtl ? 'تعديل' : 'Edit'}
                          </button>
                          <button
                            type="button"
                            onClick={() => handleDeleteProperty(prop.id)}
                            disabled={updating === prop.id}
                            aria-label={isRtl ? `حذف العقار ${prop.title}` : `Delete property ${prop.title}`}
                            className="bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-400 hover:bg-red-600 hover:text-white px-3 py-2 rounded-lg text-xs font-bold transition-all cursor-pointer"
                            title={isRtl ? 'حذف' : 'Delete'}
                          >
                            {updating === prop.id ? <Loader2 className="animate-spin" size={14} aria-hidden="true" /> : <Trash2 size={14} aria-hidden="true" />}
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {activeTab === 'purchases' && (
        <div className="bg-white dark:bg-slate-900 rounded-3xl border border-slate-200 dark:border-slate-800 overflow-hidden shadow-xl animate-scale-up">
          <div className="p-6 border-b border-slate-100 dark:border-slate-800 bg-slate-50 dark:bg-slate-800/50">
            <h2 className="font-bold text-slate-800 dark:text-white flex items-center gap-2">
              <CreditCard className="text-accent-600 dark:text-accent-400" />
              {isRtl ? 'طلبات الشراء' : 'Purchase Requests'}
            </h2>
          </div>
          {purchases.length === 0 ? (
            <div className="p-20 text-center text-slate-400 dark:text-slate-600">
              <CreditCard size={48} className="mx-auto mb-4 opacity-20" />
              <p className="font-medium">{isRtl ? 'لا توجد طلبات شراء بعد' : 'No purchase requests yet.'}</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left">
                <thead className="bg-slate-50 dark:bg-slate-800 text-slate-500 dark:text-slate-400 text-xs font-black uppercase tracking-widest">
                  <tr>
                    <th className="px-8 py-4">{isRtl ? 'العقار' : 'Property'}</th>
                    <th className="px-8 py-4">{isRtl ? 'المشتري' : 'Buyer'}</th>
                    <th className="px-8 py-4">{isRtl ? 'التاريخ' : 'Date'}</th>
                    <th className="px-8 py-4">{isRtl ? 'الحالة' : 'Status'}</th>
                    <th className="px-8 py-4 text-right">{isRtl ? 'الإجراءات' : 'Actions'}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                  {purchases.map((purchase) => (
                    <tr key={purchase.id} className="hover:bg-slate-50/50 dark:hover:bg-slate-800/50 transition-colors">
                      <td className="px-8 py-5 font-bold text-slate-900 dark:text-white text-sm">{propertyTitle(purchase.propertyId)}</td>
                      <td className="px-8 py-5 text-slate-600 dark:text-slate-400 text-sm">{purchaserEmail(purchase.userId)}</td>
                      <td className="px-8 py-5 text-slate-400 dark:text-slate-500 text-xs whitespace-nowrap">{purchase.createdAt ? new Date(purchase.createdAt).toLocaleDateString(isRtl ? 'ar-EG' : 'en-US') : '—'}</td>
                      <td className="px-8 py-5">
                        <span className={`px-3 py-1 rounded-full text-[10px] font-black uppercase tracking-wider whitespace-nowrap ${
                          purchase.status === 'completed' ? 'bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400'
                          : purchase.status === 'cancelled' ? 'bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-400'
                          : 'bg-orange-100 dark:bg-orange-900/30 text-orange-700 dark:text-orange-400'
                        }`}>
                          {purchase.status === 'completed' ? (isRtl ? 'مكتمل' : 'Completed') : purchase.status === 'cancelled' ? (isRtl ? 'ملغي' : 'Cancelled') : (isRtl ? 'قيد المعالجة' : 'Processing')}
                        </span>
                      </td>
                      <td className="px-8 py-5 text-right">
                        {purchase.status === 'processing' ? (
                          <div className="flex justify-end gap-2">
                            <button
                              onClick={() => handlePurchaseStatus(purchase.id, 'completed')}
                              disabled={updating === purchase.id}
                              className="bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400 hover:bg-green-600 hover:text-white px-4 py-2 rounded-lg text-xs font-bold transition-all cursor-pointer whitespace-nowrap"
                            >
                              {isRtl ? 'إتمام' : 'Complete'}
                            </button>
                            <button
                              onClick={() => handlePurchaseStatus(purchase.id, 'cancelled')}
                              disabled={updating === purchase.id}
                              className="bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-400 hover:bg-red-600 hover:text-white px-4 py-2 rounded-lg text-xs font-bold transition-all cursor-pointer whitespace-nowrap"
                            >
                              {isRtl ? 'إلغاء' : 'Cancel'}
                            </button>
                          </div>
                        ) : (
                          <span className="text-xs text-slate-400">—</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {activeTab === 'reports' && (
        <div className="bg-white dark:bg-slate-900 rounded-3xl border border-slate-200 dark:border-slate-800 overflow-hidden shadow-xl animate-scale-up p-6">
          <div className="flex items-center justify-between mb-4">
            <h3 className="font-bold text-slate-900 dark:text-white">{isRtl ? 'بلاغات على الإعلانات' : 'Listing Reports'} ({reports.length})</h3>
            {reports.length > 0 && (
              <button onClick={() => downloadCsv('reports.csv', reports.map(r => ({ property: propertyTitle(r.propertyId), reason: r.reason, reporter: purchaserEmail(r.userId), date: r.createdAt })))} className="text-xs bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 px-3 py-1.5 rounded-lg font-bold flex items-center gap-1.5 hover:bg-slate-200 dark:hover:bg-slate-700">
                <Upload size={14} className="rotate-180" /> {isRtl ? 'تصدير CSV' : 'Export CSV'}
              </button>
            )}
          </div>
          {reports.length === 0 ? (
            <p className="text-slate-400 text-sm">{isRtl ? 'مفيش بلاغات.' : 'No reports.'}</p>
          ) : (
            <div className="space-y-3">
              {reports.map(r => (
                <div key={r.id} className="flex items-start justify-between gap-4 bg-slate-50 dark:bg-slate-800/50 rounded-xl p-4 border border-slate-100 dark:border-slate-800">
                  <div className="flex-1 min-w-0">
                    <div className="font-bold text-slate-900 dark:text-white text-sm">{propertyTitle(r.propertyId)}</div>
                    <p className="text-sm text-slate-600 dark:text-slate-300 mt-1 whitespace-pre-wrap">{r.reason}</p>
                    <div className="text-[11px] text-slate-400 mt-1">{purchaserEmail(r.userId)} · {(r.createdAt || '').slice(0, 10)}</div>
                  </div>
                  <button 
                    type="button"
                    onClick={() => handleDeleteReport(r.id)} 
                    disabled={updating === r.id} 
                    aria-label={isRtl ? 'حذف البلاغ' : 'Dismiss report'}
                    className="shrink-0 text-red-500 hover:text-red-600 p-2 disabled:opacity-50 cursor-pointer focus:outline-none focus:ring-2 focus:ring-red-400 rounded-lg min-w-[36px] min-h-[36px] flex items-center justify-center" 
                    title={isRtl ? 'حذف البلاغ' : 'Dismiss report'}
                  >
                    {updating === r.id ? <Loader2 size={16} className="animate-spin" aria-hidden="true" /> : <Trash2 size={16} aria-hidden="true" />}
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {activeTab === 'users' && isSuperAdmin && (
        <div className="bg-white dark:bg-slate-900 rounded-3xl border border-slate-200 dark:border-slate-800 overflow-hidden shadow-xl animate-scale-up">
           <div className="p-4 border-b border-slate-100 dark:border-slate-800 flex justify-end">
             <button onClick={() => downloadCsv('users.csv', users.map(u => ({ id: u.id, name: u.name, email: u.email, phone: u.phone, role: u.role, createdAt: u.createdAt, lastLoginAt: u.lastLoginAt })))} className="text-xs bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 px-3 py-1.5 rounded-lg font-bold flex items-center gap-1.5 hover:bg-slate-200 dark:hover:bg-slate-700">
               <Upload size={14} className="rotate-180" /> {isRtl ? 'تصدير CSV' : 'Export CSV'}
             </button>
           </div>
           <div className="overflow-x-auto">
             <table className="w-full text-left border-collapse">
               <thead className="bg-slate-50 dark:bg-slate-800 text-slate-500 dark:text-slate-400 text-xs font-black uppercase tracking-widest">
                 <tr>
                   <th className="px-8 py-4">{isRtl ? 'المستخدم' : 'User'}</th>
                   <th className="px-8 py-4">{isRtl ? 'البريد الإلكتروني' : 'Email'}</th>
                   <th className="px-8 py-4">{isRtl ? 'آخر دخول' : 'Last Login'}</th>
                   <th className="px-8 py-4">{isRtl ? 'الدور' : 'Role'}</th>
                   <th className="px-8 py-4 text-right">{isRtl ? 'تغيير الامتيازات' : 'Permissions'}</th>
                 </tr>
               </thead>
               <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                 {mergedUsers.map((user) => (
                   <tr key={user.id} className="hover:bg-slate-50 dark:hover:bg-slate-800/50 transition-colors">
                     <td className="px-8 py-6">
                       <div className="flex items-center gap-3">
                         <div className="w-8 h-8 rounded-full bg-brand-100 dark:bg-brand-900/30 text-brand-600 dark:text-brand-400 flex items-center justify-center font-bold text-xs uppercase">
                           {user.name?.charAt(0) || 'U'}
                         </div>
                         <div className="font-bold text-slate-900 dark:text-white">{user.name || 'Anonymous'}</div>
                         {user.accounts > 1 && (
                           <span
                             className="bg-slate-100 dark:bg-slate-800 text-slate-500 dark:text-slate-400 text-[10px] font-black px-2 py-0.5 rounded-full"
                             title={isRtl ? `${user.accounts} حسابات بنفس البريد تم دمجها` : `${user.accounts} accounts with this email merged`}
                           >
                             ×{user.accounts}
                           </span>
                         )}
                       </div>
                     </td>
                     <td className="px-8 py-6 text-slate-600 dark:text-slate-400 text-sm">{user.email}</td>
                     <td className="px-8 py-6 text-slate-500 dark:text-slate-400 text-xs whitespace-nowrap">
                       {lastSeen(user)?.toLocaleString(isRtl ? 'ar-EG' : 'en-US', { dateStyle: 'medium', timeStyle: 'short' }) ?? (isRtl ? 'غير مسجل' : '—')}
                     </td>
                     <td className="px-8 py-6">
                       <span className={`px-3 py-1 rounded-full text-[10px] font-black uppercase tracking-wider ${
                         user.role === 'admin' ? 'bg-accent-100 dark:bg-accent-900/30 text-accent-700 dark:text-accent-400' : 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400'
                       }`}>
                         {user.role}
                       </span>
                     </td>
                     <td className="px-8 py-6 text-right">
                       {!SUPER_ADMIN_EMAILS.includes((user.email || '').toLowerCase()) ? (
                         <div className="flex justify-end gap-2">
                           <Button
                             onClick={() => toggleRole(user.id, user.role)}
                             disabled={updating === user.id}
                             variant="outline"
                             className="text-xs py-1.5 px-4 rounded-lg font-bold"
                           >
                             {updating === user.id ? <Loader2 className="animate-spin" size={14} /> : (user.role === 'admin' ? (isRtl ? 'إزالة مشرف' : 'Demote') : (isRtl ? 'ترقية لمشرف' : 'Promote'))}
                           </Button>
                           <button
                             type="button"
                             onClick={() => handleDeleteUser(user)}
                             disabled={updating === user.id}
                             aria-label={isRtl ? `حذف المستخدم ${user.name || user.email}` : `Delete user ${user.name || user.email}`}
                             className="bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-400 hover:bg-red-600 hover:text-white px-3 py-2 rounded-lg text-xs font-bold transition-all cursor-pointer disabled:opacity-50 min-w-[36px] min-h-[36px] flex items-center justify-center focus:outline-none focus:ring-2 focus:ring-red-400"
                             title={isRtl ? 'حذف المستخدم' : 'Delete user'}
                           >
                             <Trash2 size={14} aria-hidden="true" />
                           </button>
                         </div>
                       ) : (
                         <div className="flex items-center justify-end gap-2 text-xs font-bold text-brand-600 dark:text-brand-400 uppercase">
                            <Sparkles size={12} className="text-accent-500" />
                            <span>{isRtl ? 'سوبر أدمن' : 'Super Admin'}</span>
                         </div>
                       )}
                     </td>
                   </tr>
                 ))}
               </tbody>
             </table>
           </div>
        </div>
      )}
    </div>
  );
};


// --- Legal Sessions Page ---
// --- Main App ---

export default function App() {
  const [showSplash, setShowSplash] = useState(() => !import.meta.env.MODE?.includes('test') && (typeof process === 'undefined' || process.env.NODE_ENV !== 'test'));
  const [currentPage, setCurrentPage] = useState<Page>('home');
  const [isAdmin, setIsAdmin] = useState(false);
  const [selectedPropertyId, setSelectedPropertyId] = useState<string | null>(null);
  const [selectedProject, setSelectedProject] = useState<string | null>(null);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [properties, setProperties] = useState<Property[]>([]);
  const [editingPropertyId, setEditingPropertyId] = useState<string | null>(null);
  const [loadingProps, setLoadingProps] = useState(true);
  const [lang, setLang] = useState<'en' | 'ar'>('en');
  const [listingSearchQuery, setListingSearchQuery] = useState('');
  const [minPrice, setMinPrice] = useState<number | ''>('');
  const [maxPrice, setMaxPrice] = useState<number | ''>('');
  const [sortBy, setSortBy] = useState<'default' | 'newest' | 'price-asc' | 'price-desc' | 'name-asc' | 'name-desc'>('default');
  const [typeFilter, setTypeFilter] = useState('all');
  const [listingView, setListingView] = useState<'units' | 'projects'>('units');
  const [savedSearches, setSavedSearches] = useState<any[]>(() => { try { return JSON.parse(localStorage.getItem('hettety_saved_searches') || '[]'); } catch { return []; } });
  const saveCurrentSearch = () => {
    const s = { id: `${minPrice}-${maxPrice}-${typeFilter}-${sortBy}-${listingSearchQuery}`.slice(0, 60) || 'search', q: listingSearchQuery, minPrice, maxPrice, typeFilter, sortBy };
    const next = [s, ...savedSearches.filter(x => x.id !== s.id)].slice(0, 10);
    setSavedSearches(next);
    localStorage.setItem('hettety_saved_searches', JSON.stringify(next));
  };
  const applySavedSearch = (s: any) => { setListingSearchQuery(s.q || ''); setMinPrice(s.minPrice ?? ''); setMaxPrice(s.maxPrice ?? ''); setTypeFilter(s.typeFilter || 'all'); setSortBy(s.sortBy || 'default'); setAiFilteredIds(null); };
  const removeSavedSearch = (id: string) => { const next = savedSearches.filter(x => x.id !== id); setSavedSearches(next); localStorage.setItem('hettety_saved_searches', JSON.stringify(next)); };
  const subscribeAlert = async () => {
    if (!auth.currentUser) { alert(isRtl ? 'سجّل الدخول عشان تفعّل التنبيهات.' : 'Sign in to enable email alerts.'); return; }
    // Must be the account's own verified email (the security rule enforces this).
    const email = auth.currentUser.email || '';
    if (!/.+@.+\..+/.test(email)) { alert(isRtl ? 'حسابك ملوش إيميل. سجّل دخول بإيميل عشان تفعّل التنبيهات.' : 'Your account has no email. Sign in with an email to enable alerts.'); return; }
    try {
      await addDoc(collection(db, 'alertSubscriptions'), {
        userId: auth.currentUser.uid,
        email,
        q: listingSearchQuery,
        minPrice: minPrice === '' ? null : minPrice,
        maxPrice: maxPrice === '' ? null : maxPrice,
        typeFilter,
        createdAt: new Date().toISOString(),
      });
      alert(isRtl ? 'تم تفعيل التنبيهات ✅ هيوصلك إيميل لما يظهر عقار مطابق.' : "Alerts enabled ✅ you'll get an email when a matching listing appears.");
    } catch (e) { console.error('alert subscribe failed', e); alert(isRtl ? 'تعذّر تفعيل التنبيهات.' : 'Could not enable alerts.'); }
  };
  const [paymentProperty, setPaymentProperty] = useState<Property | null>(null);
  const [aiFilteredIds, setAiFilteredIds] = useState<string[] | null>(null);
  const [isAiSearching, setIsAiSearching] = useState(false);
  const [userEmail, setUserEmail] = useState<string | null>(null);
  const [userName, setUserName] = useState<string | null>(null);
  const [userFavorites, setUserFavorites] = useState<string[]>([]);
  const [compareIds, setCompareIds] = useState<string[]>([]);
  const [showCompare, setShowCompare] = useState(false);
  const [sahelVillage, setSahelVillage] = useState('all');
  const [sahelGuests, setSahelGuests] = useState(0);
  // When true, the Add Listing form opens with the "Yalla Sahel" toggle pre-checked
  // (set by the CTAs on the Sahel Hettety page).
  const [prefillSahel, setPrefillSahel] = useState(false);

  // Contact form — previously the form had no state and no handler, so every
  // message the user typed was silently discarded.
  const [contactEmail, setContactEmail] = useState('');
  const [contactMessage, setContactMessage] = useState('');
  const [contactStatus, setContactStatus] = useState<'idle' | 'sending' | 'sent' | 'error'>('idle');
  const [contactError, setContactError] = useState('');

  const handleContactSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (contactStatus === 'sending') return;
    const email = contactEmail.trim();
    const message = contactMessage.trim();
    if (!/.+@.+\..+/.test(email)) {
      setContactStatus('error');
      setContactError(isRtl ? 'من فضلك اكتب بريد إلكتروني صحيح.' : 'Please enter a valid email address.');
      return;
    }
    if (!message) {
      setContactStatus('error');
      setContactError(isRtl ? 'من فضلك اكتب رسالتك.' : 'Please write your message.');
      return;
    }
    setContactStatus('sending');
    setContactError('');
    try {
      await addDoc(collection(db, 'contactMessages'), {
        email: email.slice(0, 199),
        // Kept under the 5000-char rule limit so a long message can't be rejected.
        message: message.slice(0, 4999),
        userId: auth.currentUser?.uid || '',
        createdAt: new Date().toISOString(),
      });
      setContactStatus('sent');
      setContactEmail('');
      setContactMessage('');
    } catch (err) {
      console.error('Contact message failed:', err);
      setContactStatus('error');
      setContactError(isRtl
        ? 'تعذّر إرسال رسالتك. حاول تاني أو كلّمنا على واتساب.'
        : 'Could not send your message. Please try again or reach us on WhatsApp.');
    }
  };
  const toggleCompare = (id: string) => setCompareIds(prev => prev.includes(id) ? prev.filter(x => x !== id) : (prev.length >= 4 ? prev : [...prev, id]));
  const [isAuthReady, setIsAuthReady] = useState(false);
  const [isSuperAdmin, setIsSuperAdmin] = useState(false);
  const [showNotifications, setShowNotifications] = useState(false);
  const [showProfileMenu, setShowProfileMenu] = useState(false);
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [isDarkMode, setIsDarkMode] = useState(false);

  const mobileMenuRef = useFocusTrap<HTMLDivElement>(mobileMenuOpen, () => setMobileMenuOpen(false));
  const compareModalRef = useFocusTrap<HTMLDivElement>(showCompare, () => setShowCompare(false));

  const t = TRANSLATIONS[lang];
  const isRtl = lang === 'ar';

  // How many pages this visit has pushed. Only if we pushed at least one is
  // there somewhere of ours to go back to — otherwise Back would leave the site.
  const navDepth = useRef(0);
  // Where the reader was on each page, so returning does not dump them at the top.
  const scrollByHash = useRef<Record<string, number>>({});
  const returningViaHistory = useRef(false);

  useEffect(() => {
    const onPop = () => { returningViaHistory.current = true; };
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);

  /**
   * Puts the reader back at the height they left a page at. The grid may still be
   * rendering when this runs, so it retries briefly until the document is tall
   * enough to hold that position.
   */
  const restoreScroll = (y: number) => {
    if (y <= 0) { window.scrollTo(0, 0); return; }
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
      // Property pages carry their id in the hash: #property/<id>
      const [page, param] = raw.split('/');
      if (page === 'property' && param) {
        setSelectedPropertyId(param);
        setCurrentPage('property');
      } else if (page === 'edit-listing' && param) {
        // Editing a listing: #edit-listing/<id>
        setEditingPropertyId(param);
        setCurrentPage('edit-listing');
      } else if (page === 'project' && param) {
        // Project pages carry the compound name: #project/<encoded name>
        setSelectedProject(decodeURIComponent(param));
        setCurrentPage('project');
      } else if (page) {
        setCurrentPage(page as Page);
      } else {
        setCurrentPage('home');
      }

      // Forward navigation starts at the top; coming back resumes where you were.
      // A hash we have never scrolled on restores to 0, which is the same thing.
      if (returningViaHistory.current) {
        returningViaHistory.current = false;
        restoreScroll(scrollByHash.current[window.location.hash] ?? 0);
      } else {
        window.scrollTo(0, 0);
      }
    };

    // Initial check on load
    handleHashChange();

    window.addEventListener('hashchange', handleHashChange);
    return () => window.removeEventListener('hashchange', handleHashChange);
  }, []);

  // Close the profile / notification dropdowns when clicking anywhere outside them
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

  // --- Theme Management ---
  useEffect(() => {
    let savedTheme = null;
    try {
      savedTheme = localStorage.getItem('theme');
    } catch (e) {
      // Ignore localStorage errors in iframes
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

    if (savedTheme === 'dark') {
      applyTheme(true);
    } else if (savedTheme === 'light') {
      applyTheme(false);
    } else {
      applyTheme(mediaQuery.matches);
    }

    const handleChange = (e: MediaQueryListEvent) => {
      let currentStored = null;
      try { currentStored = localStorage.getItem('theme'); } catch(e) {}
      if (!currentStored) {
        applyTheme(e.matches);
      }
    };

    mediaQuery.addEventListener('change', handleChange);
    return () => mediaQuery.removeEventListener('change', handleChange);
  }, []);

  const toggleDarkMode = () => {
    const newMode = !isDarkMode;
    setIsDarkMode(newMode);
    if (newMode) {
      document.documentElement.classList.add('dark');
      try { localStorage.setItem('theme', 'dark'); } catch(e) {}
    } else {
      document.documentElement.classList.remove('dark');
      try { localStorage.setItem('theme', 'light'); } catch(e) {}
    }
  };

  // Sync document root attributes with active language & direction
  useEffect(() => {
    document.documentElement.lang = lang;
    document.documentElement.dir = isRtl ? 'rtl' : 'ltr';
    if (isRtl) {
      document.documentElement.classList.add('font-cairo');
    } else {
      document.documentElement.classList.remove('font-cairo');
    }
  }, [lang, isRtl]);

  // Firebase Auth Listener
  useEffect(() => {
    // Show splash for at least 3.5 seconds
    const timer = setTimeout(() => {
      setShowSplash(false);
    }, 3500);
    return () => clearTimeout(timer);
  }, []);

  useEffect(() => {
    // Keep the active notifications listener in a closure-scoped variable so it
    // is reliably cleaned up on user switch AND on unmount (previously it was
    // stashed on `window`, leaking the listener when the component unmounted).
    let unsubNotifications: (() => void) | null = null;

    const unsubscribe = onAuthStateChanged(auth, async (user) => {
      // Always drop the previous user's listener before doing anything else
      unsubNotifications?.();
      unsubNotifications = null;

      if (user) {
        setUserEmail(user.email);
        const isSuper = SUPER_ADMIN_EMAILS.includes((user.email || "").toLowerCase());
        setIsSuperAdmin(isSuper);

        // Fetch user data from Firestore to get role and name
        try {
          const userDoc = await getDoc(doc(db, 'users', user.uid));
          if (userDoc.exists()) {
            const userData = userDoc.data();
            setIsAdmin(userData.role === 'admin' || isSuper);
            setUserName(userData.name || user.displayName);
            setUserFavorites(userData.favorites || []);
            // Record last seen (fire-and-forget — purely informational for the
            // admin dashboard, so a failed write must never block sign-in).
            updateDoc(doc(db, 'users', user.uid), { lastLoginAt: new Date().toISOString() })
              .catch((err) => console.warn('Could not record lastLoginAt:', err));
          } else {
            setIsAdmin(isSuper);
            setUserName(user.displayName);
            setUserFavorites([]);
          }
        } catch (error) {
          console.error("Error fetching user data:", error);
          setIsAdmin(isSuper);
          setUserName(user.displayName);
        }

        // Fetch notifications
        const q = query(collection(db, 'notifications'), where('userId', '==', user.uid));
        unsubNotifications = onSnapshot(q, (snapshot) => {
          const notifs = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Notification));
          setNotifications(notifs.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime()));
        }, (error) => {
          console.error('Error fetching notifications:', error);
        });
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

  const handleLogout = async () => {
    try {
      await signOut(auth);
      setUserFavorites([]);
      handleNav('home');
    } catch (error) {
      console.error("Logout error:", error);
    }
  };

  const toggleFavorite = async (propertyId: string) => {
    if (!auth.currentUser) {
      handleNav('login');
      return;
    }

    const newFavorites = userFavorites.includes(propertyId)
      ? userFavorites.filter(id => id !== propertyId)
      : [...userFavorites, propertyId];

    setUserFavorites(newFavorites);

    try {
      await updateDoc(doc(db, 'users', auth.currentUser.uid), {
        favorites: newFavorites
      });
    } catch (err) {
      console.error("Error updating favorites:", err);
    }
  };

  const handleAiSearch = async () => {
    if (!listingSearchQuery.trim()) {
      setAiFilteredIds(null);
      return;
    }
    
    setIsAiSearching(true);
    try {
      // Grounded Natural Language Structured Filter Extraction & Ranking
      const parsedFilters = parseNaturalLanguageQuery(listingSearchQuery);
      const ranked = rankAndFilterProperties(publicProperties, parsedFilters);

      if (ranked.length > 0) {
        setAiFilteredIds(ranked.map(r => r.property.id));
      } else {
        // Fallback: match title, location, or compound substrings
        const q = listingSearchQuery.toLowerCase();
        const fallback = publicProperties.filter(p =>
          p.title.toLowerCase().includes(q) ||
          p.location.toLowerCase().includes(q) ||
          (p.compound || '').toLowerCase().includes(q)
        );
        setAiFilteredIds(fallback.map(p => p.id));
      }
    } catch (err: any) {
      console.error("AI Search Error:", err);
      // Fall back to plain text search instead of interrupting the user with an alert
      setAiFilteredIds(null);
    } finally {
      setIsAiSearching(false);
    }
  };

  // What a visitor is allowed to see. `properties` stays complete because My
  // Listings needs the owner's own drafts. This is a UI-level hide, not a privacy
  // boundary — the collection is world-readable by design so the list query works.
  const publicProperties = properties.filter(p => {
    if ((p.listingState || 'Live') !== 'Live') return false;
    if (p.verificationStatus === 'Rejected') return false;
    // Once a reviewer has pulled a listing, editing it puts it back in the queue —
    // not back in front of buyers. Only a reviewer's approval does that.
    if (p.rejectedAt && p.verificationStatus !== 'Verified') return false;
    return true;
  });

  let filteredProperties = publicProperties.filter(p => {
    const matchesPrice = (minPrice === '' || p.price >= Number(minPrice)) &&
                         (maxPrice === '' || p.price <= Number(maxPrice));
    const matchesType = typeFilter === 'all' || p.propertyType === typeFilter;

    if (aiFilteredIds !== null) {
      return aiFilteredIds.includes(p.id) && matchesPrice && matchesType;
    }
    const q = listingSearchQuery.toLowerCase();
    const matchesSearch = p.title.toLowerCase().includes(q) ||
      p.location.toLowerCase().includes(q) ||
      (p.compound || '').toLowerCase().includes(q) ||
      (p.developer || '').toLowerCase().includes(q);
    return matchesSearch && matchesPrice && matchesType;
  });

  if (sortBy === 'newest') {
    filteredProperties.sort((a, b) => (b.publishDate || '').localeCompare(a.publishDate || ''));
  } else if (sortBy === 'price-asc') {
    filteredProperties.sort((a, b) => a.price - b.price);
  } else if (sortBy === 'price-desc') {
    filteredProperties.sort((a, b) => b.price - a.price);
  } else if (sortBy === 'name-asc') {
    filteredProperties.sort((a, b) => a.title.localeCompare(b.title));
  } else if (sortBy === 'name-desc') {
    filteredProperties.sort((a, b) => b.title.localeCompare(a.title));
  }

  /**
   * Reload every property. Owner edits and deletes happen inside ProfilePage, so
   * without a shared refresh the listings, home and 3D pages would stay stale
   * until a full reload.
   */
  const refreshProperties = useCallback(async () => {
    const snap = await getDocs(collection(db, 'properties'));
    setProperties(snap.docs.map(d => ({ id: d.id, ...d.data() })) as Property[]);
  }, []);

  // Initial Fetch from Firestore
  useEffect(() => {
    const fetchProps = async () => {
      setLoadingProps(true);
      try {
        // Real data only — load every property straight from Firestore.
        await refreshProperties();
      } catch (err) {
        console.error("Error fetching properties from Firestore:", err);
        setProperties([]);
      } finally {
        setLoadingProps(false);
      }
    };
    fetchProps();
  }, [refreshProperties]);

  // SEO Schema
  useEffect(() => {
    if (document.getElementById('schema-json-ld')) return;
    const script = document.createElement('script');
    script.id = 'schema-json-ld';
    script.type = 'application/ld+json';
    script.text = JSON.stringify({
      "@context": "https://schema.org",
      "@type": "RealEstateAgent",
      "name": "HETTETY",
      "image": "https://www.hettety.com/logo.png",
      "description": INITIAL_ENTITY_DATA.shortDescription,
      "address": { "@type": "PostalAddress", "addressCountry": "EG" }
    });
    document.head.appendChild(script);
  }, []);

  /**
   * The single place a page is pushed. Records where the reader was on the page
   * they are leaving, so Back can put them there again.
   */
  const pushHash = (hash: string) => {
    scrollByHash.current[window.location.hash] = window.scrollY;
    navDepth.current += 1;
    window.location.hash = hash;
  };

  /**
   * Back goes where the reader actually came from, not to a fixed page.
   *
   * navDepth counts the pages this visit pushed and each Back consumes one. It is
   * deliberately not driven by popstate: that event is not a dependable
   * "went back" signal, and treating it as one made every forward navigation
   * cancel out a push.
   */
  const goBack = () => {
    if (navDepth.current > 0) {
      navDepth.current -= 1;
      returningViaHistory.current = true;
      window.history.back();
    } else {
      handleNav('listings');   // arrived on a deep link: nothing of ours behind
    }
  };

  const handleNav = (page: Page) => {
    pushHash(page);
    setCurrentPage(page);
    setMobileMenuOpen(false);
  };

  const open3D = (id: string) => {
    setSelectedPropertyId(id);
    handleNav('3d');
  };

  // Opens a property's full dedicated page (id encoded in the hash for deep links).
  const openProperty = (id: string) => {
    setSelectedPropertyId(id);
    pushHash(`property/${id}`);
    setCurrentPage('property');
    setMobileMenuOpen(false);
  };

  // Opens a compound's project page, grouping all of its units in one place.
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

  const NavLink = ({ page, label }: { page: Page, label: string }) => (
    <button 
      type="button"
      onClick={() => handleNav(page)} 
      aria-current={currentPage === page ? 'page' : undefined}
      className={`text-sm font-bold transition-all cursor-pointer relative group py-2 focus:outline-none focus:ring-2 focus:ring-brand-500 rounded-lg px-2
        ${currentPage === page ? 'text-brand-600 dark:text-brand-400' : 'text-slate-600 dark:text-slate-400 hover:text-brand-600 dark:hover:text-brand-400'}`}
    >
      {label}
    </button>
  );

  if (!isAuthReady) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50 dark:bg-slate-950 transition-colors duration-500">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-brand-600"></div>
      </div>
    );
  }

  return (
    <div className={`min-h-screen flex flex-col font-sans ${isRtl ? 'font-cairo' : ''} bg-[#f8fafc] dark:bg-slate-900 transition-colors duration-500`} dir={isRtl ? 'rtl' : 'ltr'}>
      {showSplash ? (
        <SplashScreen onFinish={() => setShowSplash(false)} />
      ) : (
        <>
      <nav className="sticky top-0 z-50 bg-white/95 dark:bg-slate-900/95 backdrop-blur-xl border-none text-slate-900 dark:text-white shadow-sm dark:shadow-slate-950 transition-all duration-500">
        <div className="w-full px-4 sm:px-10 h-20 flex items-center justify-between">
          {/* Logo Group - Left side */}
          <div className="flex items-center shrink-0">
            <button 
              type="button"
              className="cursor-pointer transform hover:scale-105 transition-all duration-300 focus:outline-none focus:ring-2 focus:ring-brand-500 rounded-xl p-1" 
              onClick={() => handleNav('home')}
              aria-label="HETTETY Home"
            >
              <Logo className="h-14 w-auto text-brand-900 dark:text-white transition-colors" />
            </button>
          </div>

          {/* Menu & Actions Group - Right side (Opposite to logo) */}
          <div className="flex items-center gap-6 xl:gap-10">
            {/* Desktop Menu */}
            <div className="hidden lg:flex items-center gap-8 xl:gap-12">
              <NavLink page="home" label={t.nav_home} />
              <NavLink page="listings" label={t.nav_listings} />
              <NavLink page="yalla-sahel" label={isRtl ? '🌊 ساحل حتتي' : '🌊 Sahel Hettety'} />
              <NavLink page="3d-experience" label={isRtl ? 'جولات 3D' : '3D Tours'} />
              <NavLink page="legal" label={t.nav_trust} />
              {isAdmin && <NavLink page="manage-users" label={isRtl ? 'لوحة التحكم' : 'Dashboard'} />}
              <button 
                type="button"
                onClick={() => handleNav('ai-chat')} 
                aria-current={currentPage === 'ai-chat' ? 'page' : undefined}
                className={`font-black text-xs transition-all flex items-center gap-2 cursor-pointer px-5 py-2.5 rounded-full uppercase tracking-[0.1em] shadow-sm focus:outline-none focus:ring-2 focus:ring-brand-500 ${currentPage === 'ai-chat' ? 'bg-brand-600 text-white shadow-brand-200' : 'bg-slate-100 dark:bg-slate-800 text-slate-900 dark:text-slate-200 hover:bg-brand-50 dark:hover:bg-brand-900/30 hover:text-brand-600'}`}
              >
                <Sparkles size={16} className="animate-pulse" aria-hidden="true" />
                {t.advisor_nav || t.nav_ai}
              </button>
              <NavLink page="about" label={t.footer_about} />
            </div>

            {/* Actions */}
            <div className="flex items-center gap-3 sm:gap-4 shrink-0">
              <div className="hidden md:flex items-center gap-2">
                <button 
                  type="button"
                  onClick={() => toggleDarkMode()} 
                  className="w-12 h-12 rounded-2xl bg-white dark:bg-slate-800 hover:bg-slate-50 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-300 transition-all flex items-center justify-center cursor-pointer border border-slate-200 dark:border-slate-800 hover:border-brand-300 dark:hover:border-brand-700 shadow-sm active:scale-90 focus:outline-none focus:ring-2 focus:ring-brand-500"
                  aria-label="Toggle Theme"
                >
                  <div className="transform transition-transform duration-500 hover:rotate-12">
                    {isDarkMode ? <Sun size={24} className="text-amber-500" aria-hidden="true" /> : <Moon size={24} className="text-slate-600" aria-hidden="true" />}
                  </div>
                </button>
                <button 
                  type="button"
                  onClick={() => setLang(lang === 'en' ? 'ar' : 'en')} 
                  aria-label={isRtl ? 'Switch language to English' : 'تغيير اللغة إلى العربية'}
                  className="w-10 h-10 rounded-xl hover:bg-slate-50 dark:hover:bg-slate-800 text-slate-600 dark:text-slate-400 transition-all flex items-center justify-center cursor-pointer border border-transparent hover:border-slate-100 dark:hover:border-slate-700 focus:outline-none focus:ring-2 focus:ring-brand-500"
                >
                  <span className="text-xs font-black tracking-widest leading-none">{lang === 'en' ? 'AR' : 'EN'}</span>
                </button>
              </div>
            
            {userEmail && (
              <div className="relative" data-menu>
                <button
                  type="button"
                  onClick={() => { setShowNotifications(!showNotifications); setShowProfileMenu(false); }}
                  className="relative min-w-[48px] min-h-[48px] p-2.5 rounded-xl hover:bg-slate-50 dark:hover:bg-slate-800 text-slate-600 dark:text-slate-400 transition-all cursor-pointer border border-transparent hover:border-slate-100 dark:hover:border-slate-700 flex items-center justify-center focus:outline-none focus:ring-2 focus:ring-brand-500"
                  aria-label={isRtl ? `الإشعارات (${notifications.filter(n => !n.read).length} غير مقروء)` : `Notifications (${notifications.filter(n => !n.read).length} unread)`}
                  aria-haspopup="dialog"
                  aria-expanded={showNotifications}
                >
                  <Bell size={22} className="text-slate-500 dark:text-slate-400" aria-hidden="true" />
                  {notifications.filter(n => !n.read).length > 0 && (
                    <span className="absolute top-2 right-2 w-2.5 h-2.5 bg-brand-500 rounded-full border-2 border-white dark:border-slate-900 animate-pulse"></span>
                  )}
                </button>
                {showNotifications && (
                  <div className={`absolute top-full mt-4 w-96 bg-white dark:bg-slate-900 rounded-3xl shadow-2xl border border-slate-100 dark:border-slate-800 overflow-hidden z-50 ${isRtl ? 'left-0' : 'right-0'} animate-fade-in`}>
                    <div className="p-6 border-b border-slate-50 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-900/50 flex justify-between items-center">
                      <h3 className="font-black text-slate-900 dark:text-white text-xs uppercase tracking-widest italic">{isRtl ? 'الإشعارات' : 'Notifications'}</h3>
                      <span className="text-[10px] bg-brand-100 dark:bg-brand-900 text-brand-700 dark:text-brand-300 px-3 py-1.5 rounded-full font-black tracking-widest">
                        {notifications.filter(n => !n.read).length} {isRtl ? 'جديد' : 'NEW'}
                      </span>
                    </div>
                    <div className="max-h-[30rem] overflow-y-auto custom-scrollbar">
                      {notifications.length === 0 ? (
                        <div className="p-16 text-center text-slate-400">
                          <Bell className="w-12 h-12 mx-auto mb-4 opacity-10" aria-hidden="true" />
                          <p className="text-xs font-bold uppercase tracking-widest opacity-60">{isRtl ? 'لا توجد إشعارات حالياً' : 'Inbox is empty'}</p>
                        </div>
                      ) : (
                        notifications.map(notif => (
                          <div key={notif.id} className={`p-5 border-b border-slate-50 dark:border-slate-800 hover:bg-slate-50 dark:hover:bg-slate-800/50 transition-colors cursor-pointer ${!notif.read ? 'bg-brand-50/20 dark:bg-brand-900/10' : ''}`}>
                            <h4 className="font-black text-slate-900 dark:text-white text-sm mb-1.5 tracking-tight">{notif.title}</h4>
                            <p className="text-slate-600 dark:text-slate-400 text-sm leading-relaxed mb-3">{notif.message}</p>
                            <span className="text-[10px] text-slate-400 dark:text-slate-500 font-bold uppercase tracking-widest">{new Date(notif.date).toLocaleDateString(isRtl ? 'ar-EG' : 'en-US')}</span>
                          </div>
                        ))
                      )}
                    </div>
                  </div>
                )}
              </div>
            )}
            
            {/* Profile dropdown (desktop) */}
            <div className="hidden lg:block relative" data-menu>
              {userEmail ? (
                <>
                  <button
                    type="button"
                    onClick={() => { setShowProfileMenu(!showProfileMenu); setShowNotifications(false); }}
                    aria-label={isRtl ? "قائمة الملف الشخصي" : "User Profile Menu"}
                    aria-haspopup="menu"
                    aria-expanded={showProfileMenu}
                    className="flex items-center gap-2.5 pl-1.5 pr-3 py-1.5 rounded-full bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 border border-slate-200 dark:border-slate-700 transition-all cursor-pointer focus:outline-none focus:ring-2 focus:ring-brand-500"
                  >
                    <div className="w-9 h-9 rounded-full bg-gradient-to-br from-brand-500 to-brand-700 text-white flex items-center justify-center font-black text-sm uppercase shrink-0">
                      {(userName || userEmail || 'U').charAt(0)}
                    </div>
                    <span className="text-sm font-bold text-slate-900 dark:text-white max-w-[8rem] truncate">{userName || userEmail.split('@')[0]}</span>
                    <ChevronRight size={16} className={`text-slate-400 transition-transform ${showProfileMenu ? '-rotate-90' : 'rotate-90'}`} aria-hidden="true" />
                  </button>
                  {showProfileMenu && (
                    <div className={`absolute top-full mt-4 w-72 bg-white dark:bg-slate-900 rounded-3xl shadow-2xl border border-slate-100 dark:border-slate-800 overflow-hidden z-50 ${isRtl ? 'left-0' : 'right-0'} animate-fade-in`}>
                      {/* Header */}
                      <div className="p-5 border-b border-slate-50 dark:border-slate-800">
                        <div className="font-black text-slate-900 dark:text-white truncate">{userName || (isRtl ? 'مستخدم' : 'User')}</div>
                        <div className="text-xs text-slate-500 dark:text-slate-400 truncate mt-0.5">{userEmail}</div>
                        {isAdmin && (
                          <span className={`inline-flex items-center gap-1.5 mt-3 px-3 py-1 rounded-full text-[10px] font-black uppercase tracking-wider ${isSuperAdmin ? 'bg-accent-100 dark:bg-accent-900/30 text-accent-700 dark:text-accent-400' : 'bg-brand-100 dark:bg-brand-900/30 text-brand-700 dark:text-brand-400'}`}>
                            <Shield size={11} aria-hidden="true" /> {isSuperAdmin ? (isRtl ? 'سوبر أدمن' : 'Super Admin') : (isRtl ? 'أدمن' : 'Admin')}
                          </span>
                        )}
                      </div>
                      {/* Items */}
                      <div className="py-2">
                        <button onClick={() => { setShowProfileMenu(false); handleNav('profile'); }} className="w-full flex items-center gap-3 px-5 py-3 text-sm font-bold text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors cursor-pointer">
                          <User size={16} className="text-slate-400" aria-hidden="true" /> {isRtl ? 'الملف الشخصي' : 'Personal Profile'}
                        </button>
                        {isAdmin && (
                          <button onClick={() => { setShowProfileMenu(false); handleNav('manage-users'); }} className="w-full flex items-center gap-3 px-5 py-3 text-sm font-bold text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors cursor-pointer">
                            <Shield size={16} className="text-slate-400" aria-hidden="true" /> {isRtl ? 'لوحة التحكم' : 'Operations Command Center'}
                          </button>
                        )}
                        <button onClick={() => { setShowProfileMenu(false); handleNav('add-listing'); }} className="w-full flex items-center gap-3 px-5 py-3 text-sm font-bold text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors cursor-pointer">
                          <PlusCircle size={16} className="text-slate-400" aria-hidden="true" /> {isRtl ? 'إضافة عقار' : 'Add New Listing'}
                        </button>
                        <div className="my-2 border-t border-slate-50 dark:border-slate-800"></div>
                        <button onClick={() => { setShowProfileMenu(false); handleLogout(); }} className="w-full flex items-center gap-3 px-5 py-3 text-sm font-bold text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors cursor-pointer">
                          <LogOut size={16} aria-hidden="true" /> {isRtl ? 'تسجيل الخروج' : 'Sign Out'}
                        </button>
                      </div>
                    </div>
                  )}
                </>
              ) : (
                <button onClick={() => handleNav('login')} className="bg-slate-900 dark:bg-brand-600 text-white px-6 py-2.5 rounded-full font-bold text-sm hover:bg-slate-800 dark:hover:bg-brand-700 transition-colors cursor-pointer focus:outline-none focus:ring-2 focus:ring-brand-500">
                  {isRtl ? 'تسجيل الدخول' : 'Sign In'}
                </button>
              )}
            </div>

            <div className="h-10 w-px bg-slate-100 dark:bg-slate-800 mx-2 hidden sm:block lg:hidden"></div>

            <button 
              type="button"
              id="mobile-menu-toggle"
              aria-label={mobileMenuOpen ? (isRtl ? "إغلاق القائمة الرئيسية" : "Close main navigation menu") : (isRtl ? "فتح القائمة الرئيسية" : "Open main navigation menu")}
              aria-expanded={mobileMenuOpen}
              aria-controls="mobile-navigation-menu"
              className="lg:hidden min-w-[48px] min-h-[48px] cursor-pointer text-slate-900 dark:text-white p-3 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-2xl transition-all flex items-center justify-center focus:outline-none focus:ring-2 focus:ring-brand-500" 
              onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
            >
              {mobileMenuOpen ? <X size={26} aria-hidden="true" /> : <Menu size={26} aria-hidden="true" />}
            </button>
          </div>
        </div>
      </div>
      </nav>

      {/* Mobile Menu Overlay - Move out of nav for better compatibility */}
      {mobileMenuOpen && (
        <div 
          ref={mobileMenuRef}
          id="mobile-navigation-menu"
          role="dialog"
          aria-modal="true"
          aria-label={isRtl ? "قائمة التنقل للجوال" : "Mobile Navigation Menu"}
          className="lg:hidden fixed inset-0 z-[100] bg-white dark:bg-slate-950 p-6 flex flex-col items-center justify-start overflow-y-auto animate-fade-in shadow-2xl"
        >
          <div className="w-full flex justify-between items-center mb-10">
             <button 
               type="button"
               onClick={() => handleNav('home')} 
               aria-label="HETTETY Home"
               className="cursor-pointer focus:outline-none focus:ring-2 focus:ring-brand-500 rounded-xl"
             >
               <Logo className="h-10 w-auto text-brand-900 dark:text-white" />
             </button>
             <button 
               type="button"
               aria-label={isRtl ? "إغلاق القائمة" : "Close navigation menu"}
               className="min-w-[48px] min-h-[48px] p-3 bg-slate-100 dark:bg-slate-900 rounded-full text-slate-900 dark:text-white active:scale-90 transition-transform flex items-center justify-center cursor-pointer focus:outline-none focus:ring-2 focus:ring-brand-500" 
               onClick={() => setMobileMenuOpen(false)}
             >
                <X size={24} aria-hidden="true" />
             </button>
          </div>
          
          <div className="w-full space-y-2 flex flex-col items-center text-center">
            <button onClick={() => handleNav('home')} className="w-full py-4 text-2xl font-black text-slate-900 dark:text-white uppercase tracking-tighter hover:text-brand-600 transition-colors focus:outline-none focus:ring-2 focus:ring-brand-500 rounded-xl">
              {t.nav_home}
            </button>
            <button onClick={() => handleNav('listings')} className="w-full py-4 text-2xl font-black text-slate-900 dark:text-white uppercase tracking-tighter hover:text-brand-600 transition-colors focus:outline-none focus:ring-2 focus:ring-brand-500 rounded-xl">
              {t.nav_listings}
            </button>
            <button onClick={() => handleNav('3d-experience')} className="w-full py-4 text-2xl font-black text-slate-900 dark:text-white uppercase tracking-tighter hover:text-brand-600 transition-colors focus:outline-none focus:ring-2 focus:ring-brand-500 rounded-xl">
              {isRtl ? 'جولات 3D' : '3D Tours'}
            </button>
            <button onClick={() => handleNav('legal')} className="w-full py-4 text-2xl font-black text-slate-900 dark:text-white uppercase tracking-tighter hover:text-brand-600 transition-colors focus:outline-none focus:ring-2 focus:ring-brand-500 rounded-xl">
              {t.nav_trust}
            </button>
            {userEmail && (
              <button onClick={() => handleNav('add-listing')} className="w-full py-4 text-2xl font-black text-slate-900 dark:text-white uppercase tracking-tighter hover:text-brand-600 transition-colors focus:outline-none focus:ring-2 focus:ring-brand-500 rounded-xl">
                {isRtl ? 'إضافة عقار' : 'Add Listing'}
              </button>
            )}
            {isAdmin && (
              <button onClick={() => handleNav('manage-users')} className="w-full py-4 text-2xl font-black text-brand-600 dark:text-brand-400 uppercase tracking-tighter hover:text-brand-700 transition-colors focus:outline-none focus:ring-2 focus:ring-brand-500 rounded-xl">
                {isRtl ? 'لوحة التحكم' : 'Dashboard'}
              </button>
            )}
            <button onClick={() => handleNav('ai-chat')} className="w-full py-6 mt-6 bg-brand-600 text-white rounded-[2rem] font-black text-2xl uppercase tracking-widest flex items-center justify-center gap-4 shadow-2xl shadow-brand-500/40 active:scale-95 transition-transform focus:outline-none focus:ring-2 focus:ring-brand-500">
              <Sparkles size={24} aria-hidden="true" /> {t.advisor_nav || t.nav_ai}
            </button>
            <button onClick={() => handleNav('about')} className="w-full py-6 text-lg font-bold text-slate-500 dark:text-slate-400 uppercase tracking-widest focus:outline-none focus:ring-2 focus:ring-brand-500 rounded-xl">
              {t.footer_about}
            </button>

            <div className="w-full pt-10 mt-10 border-t border-slate-100 dark:border-slate-800 flex flex-col gap-4">
              <div className="flex gap-4">
                <button 
                  type="button"
                  onClick={() => setLang(lang === 'en' ? 'ar' : 'en')} 
                  aria-label={isRtl ? 'Switch language to English' : 'تغيير اللغة إلى العربية'}
                  className="flex-1 min-h-[48px] py-4 rounded-2xl bg-slate-50 dark:bg-slate-900 text-slate-900 dark:text-white font-black uppercase tracking-widest text-xs border border-slate-100 dark:border-slate-800 focus:outline-none focus:ring-2 focus:ring-brand-500"
                >
                  {lang === 'en' ? 'اللغة العربية' : 'English Language'}
                </button>
                <button 
                  type="button"
                  onClick={() => toggleDarkMode()}
                  aria-label="Toggle Theme"
                  className="w-20 min-h-[48px] flex items-center justify-center rounded-2xl bg-slate-100 dark:bg-slate-900 text-slate-900 dark:text-white border border-slate-200 dark:border-slate-800 py-4 active:scale-95 transition-transform focus:outline-none focus:ring-2 focus:ring-brand-500"
                >
                  {isDarkMode ? <Sun size={28} className="text-amber-500" aria-hidden="true" /> : <Moon size={28} aria-hidden="true" />}
                </button>
              </div>
              <button 
                type="button"
                onClick={() => handleNav(userEmail ? 'profile' : 'login')} 
                className="w-full min-h-[48px] py-5 rounded-2xl bg-slate-900 dark:bg-brand-600 text-white font-black uppercase tracking-[0.2em] text-sm shadow-xl active:scale-[0.98] transition-all focus:outline-none focus:ring-2 focus:ring-brand-500"
              >
                 {userEmail ? (isRtl ? 'الملف الشخصي' : 'Go to Profile') : (isRtl ? 'تسجيل الدخول' : 'Sign In Now')}
              </button>
            </div>
          </div>
        </div>
      )}

      <main className="flex-1 bg-slate-50 dark:bg-slate-950 transition-colors duration-500">
        {currentPage === 'home' && (
          <>
            <PremiumHero 
              onPrimaryCta={() => handleNav('register')} 
              onSecondaryCta={() => handleNav('listings')} 
              t={t}
              isRtl={isRtl}
            />
            <Features t={t} />
            <div className="bg-slate-100 dark:bg-slate-900/50 py-10">
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
            <div className="py-20 max-w-7xl mx-auto px-4">
              <div className="flex justify-between items-end mb-10">
                <div><h2 className="text-3xl font-heading font-bold text-brand-900 dark:text-white mb-2">{t.prop_featured}</h2><p className="text-slate-600 dark:text-slate-400">{t.prop_subtitle}</p></div>
                <button onClick={() => handleNav('listings')} className="text-accent-600 dark:text-accent-400 font-bold flex items-center gap-1 hover:gap-2 transition-all cursor-pointer">{t.prop_view_all} {isRtl ? <ArrowLeft size={18} /> : <ArrowRight size={18} />}</button>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-8">
                {loadingProps 
                  ? [1,2,3].map(i => <div key={i} className="h-96 bg-slate-200 rounded-2xl animate-pulse"></div>)
                  : publicProperties.slice(0, 3).map(p => (
                    <PropertyCard 
                      key={p.id} 
                      property={p} 
                      onView3D={() => open3D(p.id)} 
                      onToggleFavorite={() => toggleFavorite(p.id)}
                      isFavorited={userFavorites.includes(p.id)}
                      onToggleCompare={() => toggleCompare(p.id)}
                      isComparing={compareIds.includes(p.id)}
                      onClick={() => openProperty(p.id)}
                      t={t}
                      isRtl={isRtl}
                    />
                  ))
                }
              </div>
            </div>
          </>
        )}

        {currentPage === 'listings' && (
          <div className="py-12 max-w-7xl mx-auto px-4">
            <div className="mb-8 flex flex-col lg:flex-row gap-6 justify-between items-start lg:items-center">
               <h1 className="text-3xl lg:text-4xl font-heading font-black text-slate-900 dark:text-white uppercase tracking-tight">{t.prop_avail}</h1>
               <div className="flex flex-col sm:flex-row flex-wrap gap-4 w-full lg:w-auto">
                 <div className="relative flex-1 min-w-[240px] flex gap-2">
                   <div className="relative flex-1">
                     <Search className={"absolute top-3 text-slate-400 w-4 h-4 start-3"} />
                     <input 
                       placeholder={t.prop_search} 
                       value={listingSearchQuery}
                       onChange={(e) => {
                         setListingSearchQuery(e.target.value);
                         setAiFilteredIds(null);
                       }}
                       onKeyDown={(e) => e.key === 'Enter' && handleAiSearch()}
                       className={`w-full py-2.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 focus:ring-2 focus:ring-brand-500 outline-none text-black dark:text-white ps-10 pe-4`} 
                     />
                   </div>
                   <button 
                     onClick={handleAiSearch}
                     disabled={isAiSearching || !listingSearchQuery.trim()}
                     className="bg-brand-600 hover:bg-brand-700 text-white px-4 py-2.5 rounded-lg flex items-center gap-2 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                     title={isRtl ? 'بحث بالذكاء الاصطناعي' : 'AI Search'}
                   >
                     {isAiSearching ? <Loader2 className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4" />}
                   </button>
                 </div>
                 <div className="relative flex-1 md:w-32">
                   <DollarSign className={"absolute top-3 text-slate-400 w-4 h-4 start-3"} />
                   <input 
                     type="number"
                     min="0"
                     placeholder={isRtl ? 'الحد الأدنى' : 'Min Price'} 
                     value={minPrice}
                     onChange={(e) => {
                       const val = e.target.value;
                       if (val === '') setMinPrice('');
                       else if (Number(val) >= 0) setMinPrice(Number(val));
                     }}
                     className={`w-full py-2.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 focus:ring-2 focus:ring-brand-500 outline-none text-black dark:text-white ps-10 pe-4`} 
                   />
                 </div>
                 <div className="relative flex-1 md:w-32">
                   <DollarSign className={"absolute top-3 text-slate-400 w-4 h-4 start-3"} />
                   <input 
                     type="number"
                     min="0"
                     placeholder={isRtl ? 'الحد الأقصى' : 'Max Price'} 
                     value={maxPrice}
                     onChange={(e) => {
                       const val = e.target.value;
                       if (val === '') setMaxPrice('');
                       else if (Number(val) >= 0) setMaxPrice(Number(val));
                     }}
                     className={`w-full py-2.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 focus:ring-2 focus:ring-brand-500 outline-none text-black dark:text-white ps-10 pe-4`} 
                   />
                 </div>
                 <select
                   value={typeFilter}
                   onChange={(e) => setTypeFilter(e.target.value)}
                   className="py-2.5 px-4 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 focus:ring-2 focus:ring-brand-500 outline-none text-black dark:text-white flex-1 sm:flex-none sm:min-w-[150px]"
                 >
                   <option value="all">{isRtl ? 'كل الأنواع' : 'All Types'}</option>
                   {PROPERTY_TYPES.map(o => <option key={o.value} value={o.value}>{isRtl ? o.ar : o.en}</option>)}
                 </select>
                 <select
                   value={sortBy}
                   onChange={(e) => setSortBy(e.target.value as any)}
                   className="py-2.5 px-4 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 focus:ring-2 focus:ring-brand-500 outline-none text-black dark:text-white flex-1 sm:flex-none sm:min-w-[180px]"
                 >
                   <option value="default">{isRtl ? 'الترتيب الافتراضي' : 'Default Sort'}</option>
                   <option value="newest">{isRtl ? 'الأحدث' : 'Newest'}</option>
                   <option value="price-asc">{isRtl ? 'السعر: من الأقل للأعلى' : 'Price: Low to High'}</option>
                   <option value="price-desc">{isRtl ? 'السعر: من الأعلى للأقل' : 'Price: High to Low'}</option>
                   <option value="name-asc">{isRtl ? 'الاسم: أ إلى ي' : 'Name: A to Z'}</option>
                   <option value="name-desc">{isRtl ? 'الاسم: ي إلى أ' : 'Name: Z to A'}</option>
                 </select>
                 <button onClick={saveCurrentSearch} className="py-2.5 px-4 rounded-lg border border-brand-200 dark:border-brand-800 bg-brand-50 dark:bg-brand-900/20 text-brand-700 dark:text-brand-300 font-bold text-sm flex items-center gap-1.5 hover:bg-brand-100 dark:hover:bg-brand-900/40 transition-colors">
                   <Save size={15} /> {isRtl ? 'احفظ البحث' : 'Save search'}
                 </button>
                 <button onClick={subscribeAlert} className="py-2.5 px-4 rounded-lg border border-accent-200 dark:border-accent-800 bg-accent-50 dark:bg-accent-900/20 text-accent-700 dark:text-accent-300 font-bold text-sm flex items-center gap-1.5 hover:bg-accent-100 dark:hover:bg-accent-900/40 transition-colors">
                   <Bell size={15} /> {isRtl ? 'نبّهني بالإيميل' : 'Email alert'}
                 </button>
               </div>
            </div>
            {savedSearches.length > 0 && (
              <div className="flex flex-wrap gap-2 mb-6 -mt-2">
                {savedSearches.map(s => (
                  <span key={s.id} className="inline-flex items-center gap-1.5 bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 text-xs font-bold px-3 py-1.5 rounded-full">
                    <button onClick={() => applySavedSearch(s)} className="hover:text-brand-600 dark:hover:text-brand-400">{s.q || (s.typeFilter !== 'all' ? s.typeFilter : (isRtl ? 'بحث محفوظ' : 'Saved search'))}</button>
                    <button 
                      type="button"
                      onClick={() => removeSavedSearch(s.id)} 
                      aria-label={isRtl ? `حذف البحث المحفوظ ${s.q || 'بحث'}` : `Delete saved search ${s.q || 'search'}`}
                      className="text-slate-400 hover:text-red-500 p-1 focus:outline-none focus:ring-2 focus:ring-red-400 rounded-full cursor-pointer"
                    >
                      <X size={12} aria-hidden="true" />
                    </button>
                  </span>
                ))}
              </div>
            )}
            {/* View toggle: individual units vs grouped projects */}
            <div className="flex gap-1 bg-slate-100 dark:bg-slate-800 p-1 rounded-xl w-fit mb-6" role="tablist" aria-label={isRtl ? 'طريقة العرض' : 'Listing view'}>
              {(['units', 'projects'] as const).map(v => (
                <button 
                  key={v} 
                  type="button"
                  role="tab"
                  aria-selected={listingView === v}
                  onClick={() => setListingView(v)} 
                  className={`px-4 py-1.5 rounded-lg text-sm font-bold transition-all focus:outline-none focus:ring-2 focus:ring-brand-500 ${listingView === v ? 'bg-white dark:bg-slate-900 text-brand-600 dark:text-brand-400 shadow' : 'text-slate-600 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-300'}`}
                >
                  {v === 'units' ? (isRtl ? 'الوحدات' : 'Units') : (isRtl ? 'المشاريع' : 'Projects')}
                </button>
              ))}
            </div>

            {listingView === 'projects' ? (
              (() => {
                const groups = new Map<string, Property[]>();
                filteredProperties.forEach(p => { const k = p.compound || (isRtl ? 'وحدات فردية' : 'Individual units'); if (!groups.has(k)) groups.set(k, []); groups.get(k)!.push(p); });
                const projects = [...groups.entries()];
                return (
                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-8">
                    {projects.map(([name, units]) => {
                      const prices = units.map(u => u.price).filter(Boolean);
                      const min = prices.length ? Math.min(...prices) : 0;
                      const max = prices.length ? Math.max(...prices) : 0;
                      const cur = units[0].currency || 'EGP';
                      // Real compounds get their own page; the "individual units" bucket
                      // isn't a project, so it just filters the units list as before.
                      const openGroup = () => {
                        if (units[0].compound) { openProject(name); return; }
                        setListingView('units');
                        setListingSearchQuery(name);
                        setAiFilteredIds(null);
                      };
                      return (
                        <div 
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
                          className="group bg-white dark:bg-slate-900 rounded-2xl border border-slate-100 dark:border-slate-800 shadow-sm hover:shadow-xl transition-all overflow-hidden cursor-pointer animate-fade-in focus:outline-none focus:ring-2 focus:ring-brand-500"
                        >
                          <div className="relative h-56 overflow-hidden">
                            <PropertyImage src={units[0].imageUrl} alt={name} iconSize={48} className="w-full h-full object-cover transition-transform duration-700 group-hover:scale-110" />
                            <div className="absolute bottom-0 left-0 right-0 p-4 bg-gradient-to-t from-black/80 to-transparent">
                              <h3 className="text-white font-heading font-black text-lg line-clamp-1">{name}</h3>
                              {units[0].developer && <p className="text-white/70 text-xs">{units[0].developer}</p>}
                            </div>
                            <span className="absolute top-4 right-4 bg-brand-600 text-white text-xs font-bold px-3 py-1 rounded-full">{units.length} {isRtl ? 'وحدة' : 'units'}</span>
                          </div>
                          <div className="p-5">
                            <p className="flex items-center text-slate-500 dark:text-slate-400 text-sm mb-2"><MapPin size={14} className="me-1" /> {units[0].location}</p>
                            <div className="font-bold text-brand-600 dark:text-brand-400">{min === max ? min.toLocaleString() : `${min.toLocaleString()} – ${max.toLocaleString()}`} {cur}</div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                );
              })()
            ) : filteredProperties.length === 0 && !loadingProps ? (
              <EmptyState
                variant="search"
                title={isRtl ? 'لم نجد أي عقارات تطابق بحثك' : 'No properties found'}
                description={isRtl ? 'جرب تغيير معايير البحث أو تصفير الفلاتر لرؤية جميع العقارات المتاحة.' : 'Try adjusting your filters or clearing search criteria to see available properties.'}
                actionLabel={isRtl ? 'إعادة ضبط الفلاتر' : 'Clear All Filters'}
                onAction={() => {
                  setListingSearchQuery('');
                  setMinPrice('');
                  setMaxPrice('');
                  setTypeFilter('all');
                  setSortBy('default');
                  setAiFilteredIds(null);
                }}
                isRtl={isRtl}
              />
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-8">
                {loadingProps
                  ? [1,2,3,4,5,6].map(i => <div key={i} className="h-96 bg-slate-200 dark:bg-slate-800 rounded-2xl animate-pulse"></div>)
                  : filteredProperties.map(p => (
                    <PropertyCard
                      key={p.id}
                      property={p}
                      onView3D={() => open3D(p.id)}
                      onToggleFavorite={() => toggleFavorite(p.id)}
                      isFavorited={userFavorites.includes(p.id)}
                      onToggleCompare={() => toggleCompare(p.id)}
                      isComparing={compareIds.includes(p.id)}
                      onClick={() => openProperty(p.id)}
                      t={t}
                      isRtl={isRtl}
                    />
                  ))
                }
              </div>
            )}
          </div>
        )}

        {currentPage === 'manage-users' && isAdmin && <AdminDashboard isRtl={isRtl} isSuperAdmin={isSuperAdmin} />}
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
        {currentPage === 'legal' && <LegalCenter t={t} isRtl={isRtl} userEmail={userEmail} />}
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
            units={publicProperties.filter(p => (p.compound || '') === selectedProject)}
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

        {currentPage === 'yalla-sahel' && (() => {
          const coastalKeywords = /ساحل|sahel|north coast|الساحل|مارينا|marina|marassi|مراسي|راس الحكمة|ras el|hacienda|هاسيندا|العلمين|alamein|بورتو|porto|جايا|جاردينيا|سيدي عبد|فوكا|fouka/i;
          // Explicitly flagged units always belong here; the keyword/type heuristics
          // just catch coastal listings added before the flag existed.
          const allSahel = publicProperties.filter(p => p.yallaSahel === true || p.propertyType === 'Chalet' || coastalKeywords.test(p.location || '') || coastalKeywords.test(p.compound || '') || !!p.village);
          const villages = Array.from(new Set(allSahel.map(p => p.village).filter(Boolean))) as string[];
          const sahelUnits = allSahel.filter(p =>
            (sahelVillage === 'all' || p.village === sahelVillage) &&
            (sahelGuests === 0 || (p.guests || 0) >= sahelGuests)
          );
          return (
            <div className="animate-fade-in">
              <div className="relative overflow-hidden bg-gradient-to-br from-cyan-500 via-blue-500 to-brand-700 text-white">
                <div className="absolute inset-0 opacity-20" style={{ backgroundImage: 'radial-gradient(circle at 20% 30%, white 1.5px, transparent 1.5px)', backgroundSize: '42px 42px' }} />
                <div className="relative max-w-6xl mx-auto px-4 py-20 text-center">
                  <div className="text-6xl mb-4">🌊</div>
                  <h1 className="text-4xl md:text-6xl font-heading font-black mb-4">{isRtl ? 'ساحل حتتي' : 'Sahel Hettety'}</h1>
                  <p className="text-lg md:text-2xl font-bold text-white/90 max-w-3xl mx-auto mb-3">{isRtl ? 'شاليهات الساحل الشمالي — تلف جواها 3D قبل ما تحجز.' : 'North Coast chalets — walk through them in 3D before you book.'}</p>
                  <p className="text-white/80 max-w-2xl mx-auto mb-8">{isRtl ? 'معاينة ثلاثية الأبعاد وتواصل مباشر مع صاحب الوحدة. بص على شارة المراجعة في كل شاليه قبل ما تحجز.' : 'A 3D walkthrough and direct contact with the owner. Check the review badge on each chalet before you book.'}</p>
                  <div className="flex flex-wrap gap-3 justify-center">
                    <button onClick={() => document.getElementById('sahel-units')?.scrollIntoView({ behavior: 'smooth' })} className="bg-white text-brand-700 font-black px-8 py-3.5 rounded-full shadow-lg hover:scale-105 transition-transform">{isRtl ? 'شوف الشاليهات المتاحة' : 'Browse chalets'}</button>
                    <button onClick={() => { setPrefillSahel(true); handleNav('add-listing'); }} className="bg-white/20 backdrop-blur border border-white/40 text-white font-bold px-8 py-3.5 rounded-full hover:bg-white/30 transition-colors">{isRtl ? 'عندك شاليه؟ أجّره معانا' : 'List your chalet'}</button>
                  </div>
                </div>
              </div>

              <div className="max-w-6xl mx-auto px-4 py-12 grid sm:grid-cols-3 gap-6">
                {[
                  { icon: '🏠', ti: isRtl ? 'معاينة 3D' : '3D Preview', d: isRtl ? 'لف جوه الشاليه وشوف الفيو قبل الحجز' : 'Walk inside and see the view before booking' },
                  { icon: '⚡', ti: isRtl ? 'حجز أسرع' : 'Faster booking', d: isRtl ? 'تواصل واتساب/اتصال مباشر مع المالك' : 'Direct WhatsApp/call with the owner' },
                  { icon: '⭐', ti: isRtl ? 'تقييمات' : 'Reviews', d: isRtl ? 'آراء المستخدمين — إحنا ما بنتأكدش إنهم سكنوا' : "Ratings from signed-in users — we can't confirm they stayed" },
                ].map((c, i) => (
                  <div key={i} className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-100 dark:border-slate-800 p-6 text-center shadow-sm">
                    <div className="text-4xl mb-3">{c.icon}</div>
                    <h3 className="font-bold text-slate-900 dark:text-white mb-1">{c.ti}</h3>
                    <p className="text-sm text-slate-500 dark:text-slate-400">{c.d}</p>
                  </div>
                ))}
              </div>

              <div id="sahel-units" className="max-w-7xl mx-auto px-4 pb-16">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-6">
                  <h2 className="text-2xl md:text-3xl font-heading font-black text-slate-900 dark:text-white">{isRtl ? `شاليهات متاحة (${sahelUnits.length})` : `Available chalets (${sahelUnits.length})`}</h2>
                  <div className="flex gap-3 flex-wrap">
                    <select value={sahelVillage} onChange={e => setSahelVillage(e.target.value)} className="py-2 px-3 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-sm text-slate-800 dark:text-white outline-none">
                      <option value="all">{isRtl ? 'كل القرى' : 'All villages'}</option>
                      {villages.map(v => <option key={v} value={v}>{v}</option>)}
                    </select>
                    <select value={sahelGuests} onChange={e => setSahelGuests(Number(e.target.value))} className="py-2 px-3 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-sm text-slate-800 dark:text-white outline-none">
                      <option value={0}>{isRtl ? 'أي عدد أفراد' : 'Any guests'}</option>
                      {[2, 4, 6, 8, 10].map(n => <option key={n} value={n}>{isRtl ? `${n}+ أفراد` : `${n}+ guests`}</option>)}
                    </select>
                  </div>
                </div>
                {sahelUnits.length === 0 ? (
                  <div className="text-center py-16 text-slate-400">
                    <div className="text-5xl mb-3">🏖️</div>
                    <p className="font-bold">{isRtl ? 'مفيش شاليهات مضافة لسه — كن أول مالك!' : 'No chalets yet — be the first owner!'}</p>
                    <button onClick={() => { setPrefillSahel(true); handleNav('add-listing'); }} className="mt-4 bg-brand-600 text-white px-6 py-2.5 rounded-full font-bold">{isRtl ? 'أضف شاليهك' : 'Add your chalet'}</button>
                  </div>
                ) : (
                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-8">
                    {sahelUnits.map(p => (
                      <PropertyCard key={p.id} property={p} onView3D={() => open3D(p.id)} onToggleFavorite={() => toggleFavorite(p.id)} isFavorited={userFavorites.includes(p.id)} onToggleCompare={() => toggleCompare(p.id)} isComparing={compareIds.includes(p.id)} onClick={() => openProperty(p.id)} t={t} isRtl={isRtl} />
                    ))}
                  </div>
                )}
              </div>
            </div>
          );
        })()}
        {currentPage === '3d' && selectedPropertyId && <Viewer3D property={properties.find(p => p.id === selectedPropertyId)} onClose={() => { setSelectedPropertyId(null); handleNav('listings'); }} t={t} isRtl={isRtl} />}
        {currentPage === 'property' && selectedPropertyId && (() => {
          const prop = properties.find(p => p.id === selectedPropertyId);
          if (!prop) {
            return (
              <div className="max-w-3xl mx-auto px-4 py-24 text-center">
                {loadingProps ? (
                  <Loader2 className="w-10 h-10 text-brand-500 animate-spin mx-auto" />
                ) : (
                  <>
                    <Building2 className="w-16 h-16 text-slate-300 dark:text-slate-700 mx-auto mb-4" />
                    <p className="text-slate-500 dark:text-slate-400 mb-6">{isRtl ? 'العقار غير موجود أو تم حذفه.' : 'This property was not found or has been removed.'}</p>
                    <Button onClick={() => handleNav('listings')}>{isRtl ? 'تصفح العقارات' : 'Browse Listings'}</Button>
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
              onPurchase={(id) => { setPaymentProperty(prop); handleNav('payment'); }}
              onOpenProject={openProject}
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
            refreshProperties={refreshProperties}
          />
        )}
        {currentPage === 'payment' && paymentProperty && (
          <PaymentPage 
            property={paymentProperty} 
            onConfirm={async () => {
              // Signed-out users used to sail through this and have the request
              // silently dropped — send them to sign in instead.
              if (!auth.currentUser) {
                alert(isRtl
                  ? 'سجّل الدخول الأول عشان نقدر نتواصل معاك بخصوص الطلب.'
                  : 'Please sign in first so we can contact you about this request.');
                handleNav('login');
                return;
              }
              if (paymentProperty.availability === 'Sold') {
                alert(isRtl ? 'عذراً، هذا العقار تم بيعه بالفعل.' : 'Sorry, this property is already sold.');
                setPaymentProperty(null);
                return;
              }
              // Idempotent purchase request with frozen price snapshot
              const purchaseId = `purchase_${auth.currentUser.uid}_${paymentProperty.id}`;
              await setDoc(doc(db, 'purchases', purchaseId), {
                userId: auth.currentUser.uid,
                propertyId: paymentProperty.id,
                propertyTitle: paymentProperty.title,
                frozenPrice: paymentProperty.price || paymentProperty.projectPriceFrom || 0,
                currency: paymentProperty.currency || 'EGP',
                status: 'processing',
                createdAt: new Date().toISOString()
              });
              // Best-effort confirmation notification — a failure here must never
              // undo or duplicate the request that already succeeded.
              try {
                await addDoc(collection(db, 'notifications'), {
                  userId: auth.currentUser.uid,
                  title: isRtl ? 'طلب شراء قيد المراجعة' : 'Purchase Request Received',
                  message: isRtl
                    ? `تم استلام طلبك للعقار ${paymentProperty.title}. سيقوم أحد خبرائنا بالتواصل معك قريباً.`
                    : `Your request for ${paymentProperty.title} has been received. Our expert will contact you shortly.`,
                  date: new Date().toISOString(),
                  read: false
                });
              } catch (notifyErr) {
                console.warn('Purchase saved, but the confirmation notification failed:', notifyErr);
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
        {/* Posting requires an account: the listing is written under the poster's
            uid, and the rules reject an anonymous write. Better to say so before
            someone uploads twenty photos. */}
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
            <button onClick={() => handleNav('login')} className="bg-brand-600 hover:bg-brand-700 text-white px-8 py-3 rounded-full font-bold cursor-pointer">
              {isRtl ? 'تسجيل الدخول' : 'Sign in'}
            </button>
          </div>
        )}

        {/* Editing a listing you own. The ownership check here is convenience —
            firestore.rules is the actual gate. */}
        {currentPage === 'edit-listing' && editingPropertyId && (() => {
          const prop = properties.find(pr => pr.id === editingPropertyId);
          // On a fresh load properties is still empty; saying "no longer exists"
          // before the fetch resolves is just wrong.
          if (loadingProps) {
            return <div className="py-24 text-center"><Loader2 className="animate-spin mx-auto text-brand-500 w-8 h-8" aria-hidden="true" /></div>;
          }
          if (!prop) {
            return (
              <div className="max-w-lg mx-auto px-4 py-24 text-center animate-fade-in">
                <p className="text-slate-500 dark:text-slate-400 mb-6">{isRtl ? 'الإعلان ده مش موجود.' : 'That listing no longer exists.'}</p>
                <button onClick={() => handleNav('profile')} className="bg-brand-600 hover:bg-brand-700 text-white px-6 py-2.5 rounded-full font-bold cursor-pointer">
                  {isRtl ? 'رجوع لإعلاناتي' : 'Back to my listings'}
                </button>
              </div>
            );
          }
          // Admins may correct any listing — firestore.rules already allows it, and
          // there is otherwise no way to fix a typo in a listing someone else posted.
          // The verification downgrade on a material change applies to them too, so
          // a badge never outlives the content it was granted for.
          if (!auth.currentUser || (prop.authorUid !== auth.currentUser.uid && !isAdmin)) {
            return (
              <div className="max-w-lg mx-auto px-4 py-24 text-center animate-fade-in">
                <LockIcon size={40} className="mx-auto mb-4 text-slate-300 dark:text-slate-700" aria-hidden="true" />
                <p className="text-slate-500 dark:text-slate-400 mb-6">{isRtl ? 'الإعلان ده مش بتاعك.' : "This listing isn't yours to edit."}</p>
                <button onClick={() => handleNav('listings')} className="bg-brand-600 hover:bg-brand-700 text-white px-6 py-2.5 rounded-full font-bold cursor-pointer">
                  {isRtl ? 'تصفّح العقارات' : 'Browse listings'}
                </button>
              </div>
            );
          }
          return (
            <AddListingPage
              mode="edit"
              initialProperty={prop}
              isAdmin={isAdmin}
              isSuperAdmin={isSuperAdmin}
              onAdd={async () => { /* unreachable in edit mode */ }}
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
                  authorUid: auth.currentUser?.uid || 'anonymous'
                });
                await refreshProperties();
                handleNav('listings');
              } catch (err) {
                // Re-throw so AddListingPage's own catch keeps the form intact and
                // never shows the "Published" success screen on a failed save.
                console.error("Error adding property to Firestore:", err);
                throw err;
              }
            }}
            onAddMany={async (props) => {
              // Atomic: either every project unit is saved or none — avoids orphan
              // units and duplicate-on-retry when a partial write fails.
              const uid = auth.currentUser?.uid || 'anonymous';
              const batch = writeBatch(db);
              props.forEach(p => batch.set(doc(collection(db, 'properties')), { ...p, authorUid: uid }));
              try {
                await batch.commit();
                await refreshProperties();
                handleNav('listings');
              } catch (err) {
                console.error("Error adding project units to Firestore:", err);
                throw err;
              }
            }}
            t={t}
            isRtl={isRtl}
          />
        )}
        
        {currentPage === 'login' && <AuthForm type="login" onSwitch={() => handleNav('register')} onSubmit={(email) => { setUserEmail(email); handleNav('home'); }} t={t} isRtl={isRtl} />}
        {currentPage === 'register' && <AuthForm type="register" onSwitch={() => handleNav('login')} onSubmit={(email) => { setUserEmail(email); handleNav('home'); }} t={t} isRtl={isRtl} />}

        {currentPage === 'contact' && (
           <div className="max-w-4xl mx-auto px-4 py-16">
             <div className="bg-white rounded-2xl shadow-xl overflow-hidden flex flex-col md:flex-row">
               <div className="bg-slate-900 p-10 text-white md:w-2/5 flex flex-col justify-between">
                  <div><h2 className="text-2xl font-heading font-bold mb-6">{t.contact_title}</h2><p className="text-slate-400 mb-8">{t.contact_desc}</p></div>
                  <div className="pt-10"><Logo color="white" className="h-10" /></div>
               </div>
               <div className="p-10 md:w-3/5">
                 <form className="space-y-6" onSubmit={handleContactSubmit} noValidate>
                   <div>
                     <label htmlFor="contact-email" className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">{t.auth_email}</label>
                     <input
                       id="contact-email"
                       name="email"
                       type="email"
                       required
                       autoComplete="email"
                       value={contactEmail}
                       onChange={(e) => { setContactEmail(e.target.value); if (contactStatus !== 'idle') setContactStatus('idle'); }}
                       className="w-full px-4 py-2 rounded-lg border border-slate-300 dark:border-slate-700 dark:bg-slate-800 focus:ring-2 focus:ring-brand-500 outline-none text-black dark:text-white"
                       placeholder="you@example.com"
                       dir="ltr"
                     />
                   </div>
                   <div>
                     <label htmlFor="contact-message" className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">{t.contact_msg}</label>
                     <textarea
                       id="contact-message"
                       name="message"
                       rows={4}
                       required
                       maxLength={4999}
                       value={contactMessage}
                       onChange={(e) => { setContactMessage(e.target.value); if (contactStatus !== 'idle') setContactStatus('idle'); }}
                       className="w-full px-4 py-2 rounded-lg border border-slate-300 dark:border-slate-700 dark:bg-slate-800 focus:ring-2 focus:ring-brand-500 outline-none text-black dark:text-white"
                       placeholder={isRtl ? 'أنا مهتم بـ...' : "I'm interested in..."}
                     />
                   </div>

                   {/* Status is announced to screen readers as well as shown visually. */}
                   <div aria-live="polite" role="status">
                     {contactStatus === 'sent' && (
                       <p className="flex items-center gap-2 text-sm font-bold text-green-700 dark:text-green-400">
                         <CheckCircle size={16} aria-hidden="true" />
                         {isRtl ? 'تم إرسال رسالتك ✅ هنرد عليك في أقرب وقت.' : "Message sent ✅ we'll get back to you shortly."}
                       </p>
                     )}
                     {contactStatus === 'error' && (
                       <p className="text-sm font-bold text-red-600 dark:text-red-400">{contactError}</p>
                     )}
                   </div>

                   <Button type="submit" disabled={contactStatus === 'sending'} className="w-full">
                     {contactStatus === 'sending'
                       ? (isRtl ? 'جاري الإرسال...' : 'Sending...')
                       : t.contact_btn}
                   </Button>
                 </form>
               </div>
             </div>
           </div>
        )}
      </main>

      {/* Compare bar */}
      {compareIds.length > 0 && !showCompare && (
        <div className="fixed bottom-4 left-1/2 -translate-x-1/2 z-40 bg-slate-900 text-white rounded-2xl shadow-2xl border border-white/10 px-4 py-3 flex items-center gap-4 animate-fade-in">
          <span className="text-sm font-bold">{isRtl ? `مقارنة ${compareIds.length}` : `Compare ${compareIds.length}`}</span>
          <button onClick={() => setShowCompare(true)} disabled={compareIds.length < 2} className="bg-brand-600 hover:bg-brand-700 disabled:opacity-40 text-white text-sm font-bold px-4 py-2 min-h-[44px] rounded-lg cursor-pointer focus:outline-none focus:ring-2 focus:ring-brand-400">{isRtl ? 'قارن الآن' : 'Compare now'}</button>
          <button 
            type="button"
            onClick={() => setCompareIds([])} 
            aria-label={isRtl ? 'مسح كل العقارات من المقارنة' : 'Clear all properties from comparison'}
            className="text-white/60 hover:text-white p-2 min-w-[36px] min-h-[36px] flex items-center justify-center cursor-pointer focus:outline-none focus:ring-2 focus:ring-brand-400 rounded-lg"
          >
            <X size={18} aria-hidden="true" />
          </button>
        </div>
      )}

      {/* Compare modal */}
      {showCompare && (
        <div className="fixed inset-0 z-[75] bg-black/70 backdrop-blur-sm flex items-center justify-center p-4" onClick={() => setShowCompare(false)}>
          <div 
            ref={compareModalRef}
            role="dialog"
            aria-modal="true"
            aria-labelledby="compare-modal-title"
            className="bg-white dark:bg-slate-900 rounded-3xl shadow-2xl max-w-5xl w-full max-h-[90vh] overflow-auto" 
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between p-5 border-b border-slate-100 dark:border-slate-800 sticky top-0 bg-white dark:bg-slate-900 z-10">
              <h3 id="compare-modal-title" className="font-black text-lg text-slate-900 dark:text-white">{isRtl ? 'مقارنة العقارات' : 'Compare Properties'}</h3>
              <button 
                type="button"
                onClick={() => setShowCompare(false)} 
                aria-label={isRtl ? 'إغلاق نافذة المقارنة' : 'Close comparison dialog'}
                className="min-w-[48px] min-h-[48px] p-3 text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-white rounded-full flex items-center justify-center focus:outline-none focus:ring-2 focus:ring-brand-500 cursor-pointer"
              >
                <X size={20} aria-hidden="true" />
              </button>
            </div>
            <div className="overflow-x-auto">
              {(() => {
                const items = compareIds.map(id => properties.find(p => p.id === id)).filter(Boolean) as Property[];
                const rows: [string, (p: Property) => React.ReactNode][] = [
                  [isRtl ? 'السعر' : 'Price', p => `${p.price.toLocaleString()} ${p.currency || 'EGP'}`],
                  [isRtl ? 'النوع' : 'Type', p => p.propertyType || '—'],
                  [isRtl ? 'الموقع' : 'Location', p => p.location],
                  [isRtl ? 'الغرف' : 'Beds', p => p.bedrooms],
                  [isRtl ? 'الحمامات' : 'Baths', p => p.bathrooms],
                  [isRtl ? 'المساحة' : 'Area', p => `${p.area}${p.areaTo ? `–${p.areaTo}` : ''} m²`],
                  [isRtl ? 'التشطيب' : 'Finishing', p => p.finishing || '—'],
                  [isRtl ? 'الاستلام' : 'Delivery', p => p.deliveryDate || '—'],
                  [isRtl ? 'الحالة' : 'Status', p => p.status === 'For Sale' ? (isRtl ? 'للبيع' : 'For Sale') : (isRtl ? 'للإيجار' : 'For Rent')],
                ];
                return (
                  <table className="w-full text-sm">
                    <thead>
                      <tr>
                        <th className={`p-3 sticky start-0 bg-white dark:bg-slate-900 z-10`}></th>
                        {items.map(p => (
                          <th key={p.id} className="p-3 min-w-[160px]">
                            <PropertyImage src={p.imageUrl} alt={p.title || (isRtl ? 'صورة العقار' : 'Property thumbnail')} className="w-full h-24 object-cover rounded-xl mb-2" />
                            <div className="font-bold text-slate-900 dark:text-white text-xs line-clamp-2">{p.title}</div>
                            <button 
                              type="button"
                              onClick={() => toggleCompare(p.id)} 
                              aria-label={isRtl ? `إزالة ${p.title} من المقارنة` : `Remove ${p.title} from comparison`}
                              className="text-red-500 hover:text-red-600 font-semibold text-xs mt-1 p-1 focus:outline-none focus:ring-2 focus:ring-red-400 rounded cursor-pointer"
                            >
                              {isRtl ? 'إزالة' : 'Remove'}
                            </button>
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {rows.map(([label, fn], ri) => (
                        <tr key={ri} className={ri % 2 ? 'bg-slate-50 dark:bg-slate-800/40' : ''}>
                          <td className={`p-3 font-bold text-slate-600 dark:text-slate-400 whitespace-nowrap sticky start-0 bg-white dark:bg-slate-900 z-10`}>{label}</td>
                          {items.map(p => <td key={p.id} className="p-3 text-center font-medium text-slate-800 dark:text-slate-200">{fn(p)}</td>)}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                );
              })()}
            </div>
          </div>
        </div>
      )}

      {/* Cookie Consent Modal */}
      <CookieConsent t={t} isRtl={isRtl} onNavigateToLegal={handleNav} />

      <footer className="bg-slate-900 dark:bg-black text-slate-400 py-12 border-t border-slate-800 transition-colors duration-500">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-12">
          <div><div className="flex items-center gap-2 mb-4 text-white"><Logo color="white" className="h-8" /></div><p className="text-sm">{t.footer_desc}</p></div>
          <div>
            <h4 className="text-white font-bold mb-4">{t.footer_services}</h4>
            <ul className="space-y-2 text-sm">
              <li><button onClick={() => handleNav('buy')} className="hover:text-white transition-colors">{t.footer_buy}</button></li>
              <li><button onClick={() => handleNav('verification')} className="hover:text-white transition-colors">{t.footer_verify}</button></li>
              <li><button onClick={() => handleNav('tours')} className="hover:text-white transition-colors">{t.footer_3d}</button></li>
            </ul>
          </div>
          <div>
            <h4 className="text-white font-bold mb-4">{t.footer_company}</h4>
            <ul className="space-y-2 text-sm">
              <li><button onClick={() => handleNav('about')} className="hover:text-white transition-colors">{t.footer_about}</button></li>
              <li><button onClick={() => handleNav('terms')} className="hover:text-white transition-colors">{t.footer_terms}</button></li>
              <li><button onClick={() => handleNav('privacy')} className="hover:text-white transition-colors">{t.nav_privacy}</button></li>
              <li><button onClick={() => handleNav('cookie-policy')} className="hover:text-white transition-colors">{t.nav_cookie}</button></li>
            </ul>
          </div>
          <div>
            <h4 className="text-white font-bold mb-4">{t.footer_connect}</h4>
            <div className="flex gap-4">
              <a 
                href="https://www.tiktok.com/@hettety5?_r=1&_t=ZS-95rJ2NUzN2b" 
                target="_blank" 
                rel="noreferrer" 
                aria-label="HETTETY on TikTok (opens in new window)"
                className="w-12 h-12 min-w-[48px] min-h-[48px] bg-slate-800 rounded-full hover:bg-brand-500 cursor-pointer flex items-center justify-center text-white transition-colors focus:outline-none focus:ring-2 focus:ring-brand-400"
              >
                <svg aria-hidden="true" viewBox="0 0 24 24" width="20" height="20" stroke="currentColor" strokeWidth="2" fill="none" strokeLinecap="round" strokeLinejoin="round"><path d="M9 12a4 4 0 1 0 4 4V4a5 5 0 0 0 5 5"/></svg>
              </a>
              <a 
                href="https://www.instagram.com/hettety_realstate?igsh=Z3Y4NXB4ZHN3cXFu" 
                target="_blank" 
                rel="noreferrer" 
                aria-label="HETTETY on Instagram (opens in new window)"
                className="w-12 h-12 min-w-[48px] min-h-[48px] bg-slate-800 rounded-full hover:bg-brand-500 cursor-pointer flex items-center justify-center text-white transition-colors focus:outline-none focus:ring-2 focus:ring-brand-400"
              >
                <svg aria-hidden="true" viewBox="0 0 24 24" width="20" height="20" stroke="currentColor" strokeWidth="2" fill="none" strokeLinecap="round" strokeLinejoin="round"><rect x="2" y="2" width="20" height="20" rx="5" ry="5"/><path d="M16 11.37A4 4 0 1 1 12.63 8 4 4 0 0 1 16 11.37z"/><line x1="17.5" y1="6.5" x2="17.51" y2="6.5"/></svg>
              </a>
              <a 
                href="https://linkedin.com" 
                target="_blank" 
                rel="noreferrer" 
                aria-label="HETTETY on LinkedIn (opens in new window)"
                className="w-12 h-12 min-w-[48px] min-h-[48px] bg-slate-800 rounded-full hover:bg-brand-500 cursor-pointer flex items-center justify-center text-white transition-colors focus:outline-none focus:ring-2 focus:ring-brand-400"
              >
                <svg aria-hidden="true" viewBox="0 0 24 24" width="20" height="20" stroke="currentColor" strokeWidth="2" fill="none" strokeLinecap="round" strokeLinejoin="round"><path d="M16 8a6 6 0 0 1 6 6v7h-4v-7a2 2 0 0 0-2-2 2 2 0 0 0-2 2v7h-4v-7a6 6 0 0 1 6-6z"/><rect x="2" y="9" width="4" height="12"/><circle cx="4" cy="4" r="2"/></svg>
              </a>
            </div>
          </div>
        </div>
      </footer>
      </>
      )}
    </div>
  );
}
