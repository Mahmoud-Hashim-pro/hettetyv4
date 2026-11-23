/**
 * HETTETY Technical SEO & Structured Data Engine
 *
 * Implements ISeoService (DIP):
 * - Manages document title, meta description, canonical URL, Open Graph,
 *   Twitter Cards, and robots indexation directives (noindex on private/admin routes).
 * - Injects and updates Schema.org JSON-LD graphs: Organization, WebSite (SearchAction),
 *   RealEstateListing (Offer + FloorSize + PostalAddress), and BreadcrumbList.
 */

import { Property, SeoMetadata } from '../../core/domain/entities';
import { ISeoService } from '../../core/domain/repositories';
import { Page } from '../../types';

export const DEFAULT_SITE_URL = 'https://hettety.vercel.app';
export const DEFAULT_OG_IMAGE = 'https://hettety.vercel.app/logo.jpg';
export const SEO_JSONLD_SCRIPT_ID = 'hettety-seo-jsonld';

function normalizeSiteUrl(siteUrl: string): string {
  return (siteUrl || DEFAULT_SITE_URL).replace(/\/+$/, '');
}

function resolveAbsoluteUrl(siteUrl: string, path?: string): string {
  const base = normalizeSiteUrl(siteUrl);
  if (!path || path === '/') return `${base}/`;
  if (/^https?:\/\//i.test(path)) return path;
  if (path.startsWith('#')) return `${base}/${path}`;
  return `${base}/${path.replace(/^\/+/, '')}`;
}

function upsertMetaTag(attr: 'name' | 'property', key: string, content: string): void {
  if (typeof document === 'undefined' || !document.head) return;
  let el = document.head.querySelector(`meta[${attr}="${key}"]`) as HTMLMetaElement | null;
  if (!el) {
    el = document.createElement('meta');
    el.setAttribute(attr, key);
    document.head.appendChild(el);
  }
  el.setAttribute('content', content);
}

function upsertCanonicalLink(href: string): void {
  if (typeof document === 'undefined' || !document.head) return;
  let link = document.head.querySelector('link[rel="canonical"]') as HTMLLinkElement | null;
  if (!link) {
    link = document.createElement('link');
    link.setAttribute('rel', 'canonical');
    document.head.appendChild(link);
  }
  link.setAttribute('href', href);
}

function upsertJsonLdGraph(
  payload: Record<string, unknown> | Record<string, unknown>[]
): void {
  if (typeof document === 'undefined' || !document.head) return;
  let script = document.getElementById(SEO_JSONLD_SCRIPT_ID) as HTMLScriptElement | null;
  if (!script) {
    script = document.createElement('script');
    script.id = SEO_JSONLD_SCRIPT_ID;
    script.type = 'application/ld+json';
    document.head.appendChild(script);
  }

  let structuredData: Record<string, unknown>;
  if (Array.isArray(payload)) {
    structuredData = {
      '@context': 'https://schema.org',
      '@graph': payload.map((item) => {
        const { ['@context']: _ctx, ...rest } = item;
        return rest;
      }),
    };
  } else {
    structuredData = payload['@context']
      ? payload
      : { '@context': 'https://schema.org', ...payload };
  }

  script.textContent = JSON.stringify(structuredData);
}

function mapAvailabilitySchema(availability?: Property['availability']): string {
  switch (availability) {
    case 'Sold':
      return 'https://schema.org/SoldOut';
    case 'Reserved':
      return 'https://schema.org/LimitedAvailability';
    default:
      return 'https://schema.org/InStock';
  }
}

export class SeoManager implements ISeoService {
  private readonly siteUrl: string;

  constructor(siteUrl: string = DEFAULT_SITE_URL) {
    this.siteUrl = normalizeSiteUrl(siteUrl);
  }

  public apply(meta: SeoMetadata): void {
    if (typeof document === 'undefined') return;

    const canonicalUrl = resolveAbsoluteUrl(this.siteUrl, meta.canonicalPath);
    const ogImage = meta.ogImage
      ? resolveAbsoluteUrl(this.siteUrl, meta.ogImage)
      : DEFAULT_OG_IMAGE;
    const ogType = meta.ogType || 'website';
    const robotsDirective = meta.noIndex
      ? 'noindex, nofollow'
      : 'index, follow, max-image-preview:large, max-snippet:-1';
    const locale = meta.lang === 'ar' ? 'ar_EG' : 'en_US';

    document.title = meta.title;

    // Standard Meta & Canonical
    upsertMetaTag('name', 'description', meta.description);
    upsertMetaTag('name', 'robots', robotsDirective);
    upsertCanonicalLink(canonicalUrl);

    // Open Graph Tags
    upsertMetaTag('property', 'og:site_name', 'HETTETY');
    upsertMetaTag('property', 'og:title', meta.title);
    upsertMetaTag('property', 'og:description', meta.description);
    upsertMetaTag('property', 'og:type', ogType);
    upsertMetaTag('property', 'og:url', canonicalUrl);
    upsertMetaTag('property', 'og:image', ogImage);
    upsertMetaTag('property', 'og:locale', locale);

    // Twitter Cards
    upsertMetaTag('name', 'twitter:card', 'summary_large_image');
    upsertMetaTag('name', 'twitter:title', meta.title);
    upsertMetaTag('name', 'twitter:description', meta.description);
    upsertMetaTag('name', 'twitter:image', ogImage);

    // Structured Data (JSON-LD)
    const graph = meta.jsonLd ?? [
      this.buildOrganizationJsonLd(this.siteUrl),
      this.buildWebSiteJsonLd(this.siteUrl),
    ];
    upsertJsonLdGraph(graph);
  }

  public buildOrganizationJsonLd(siteUrl: string = this.siteUrl): Record<string, unknown> {
    const base = normalizeSiteUrl(siteUrl);
    return {
      '@context': 'https://schema.org',
      '@type': ['Organization', 'RealEstateAgent'],
      '@id': `${base}/#organization`,
      name: 'HETTETY',
      alternateName: 'حِتّتي',
      url: `${base}/`,
      logo: {
        '@type': 'ImageObject',
        url: `${base}/logo.jpg`,
      },
      image: `${base}/logo.jpg`,
      description:
        'HETTETY is a luxury Egyptian real estate platform featuring verified listings, interactive 3D walkthroughs, and an AI Real Estate Advisor.',
      areaServed: {
        '@type': 'Country',
        name: 'Egypt',
      },
      address: {
        '@type': 'PostalAddress',
        addressLocality: 'New Cairo',
        addressRegion: 'Cairo',
        addressCountry: 'EG',
      },
      contactPoint: {
        '@type': 'ContactPoint',
        contactType: 'customer support',
        email: 'privacy@hettety.com',
        availableLanguage: ['Arabic', 'English'],
      },
    };
  }

  public buildWebSiteJsonLd(siteUrl: string = this.siteUrl): Record<string, unknown> {
    const base = normalizeSiteUrl(siteUrl);
    return {
      '@context': 'https://schema.org',
      '@type': 'WebSite',
      '@id': `${base}/#website`,
      name: 'HETTETY',
      alternateName: 'حِتّتي للعقارات',
      url: `${base}/`,
      inLanguage: ['ar-EG', 'en-US'],
      publisher: {
        '@id': `${base}/#organization`,
      },
      potentialAction: {
        '@type': 'SearchAction',
        target: {
          '@type': 'EntryPoint',
          urlTemplate: `${base}/#listings?q={search_term_string}`,
        },
        'query-input': 'required name=search_term_string',
      },
    };
  }

  public buildPropertyJsonLd(
    property: Property,
    siteUrl: string = this.siteUrl
  ): Record<string, unknown> {
    const base = normalizeSiteUrl(siteUrl);
    const listingUrl = `${base}/#property/${encodeURIComponent(property.id)}`;
    const images = [
      ...(Array.isArray(property.images) ? property.images.filter(Boolean) : []),
      ...(property.imageUrl ? [property.imageUrl] : []),
    ];
    const uniqueImages = Array.from(new Set(images));
    const quotedPrice = property.price || property.projectPriceFrom || 0;
    const currency = property.currency || 'EGP';

    const listing: Record<string, unknown> = {
      '@context': 'https://schema.org',
      '@type': 'RealEstateListing',
      '@id': listingUrl,
      name: property.title,
      description:
        property.description ||
        `${property.propertyType || 'Property'} in ${property.location}${
          property.compound ? ` — ${property.compound}` : ''
        }`,
      url: listingUrl,
      datePosted: property.publishDate || undefined,
      image: uniqueImages.length > 0 ? uniqueImages : [`${base}/logo.jpg`],
      address: {
        '@type': 'PostalAddress',
        streetAddress: property.compound || undefined,
        addressLocality: property.location,
        addressCountry: 'EG',
      },
      offers: {
        '@type': 'Offer',
        url: listingUrl,
        price: quotedPrice > 0 ? quotedPrice : undefined,
        priceCurrency: currency,
        availability: mapAvailabilitySchema(property.availability),
        businessFunction:
          property.status === 'For Rent'
            ? 'http://purl.org/goodrelations/v1#LeaseOut'
            : 'http://purl.org/goodrelations/v1#Sell',
      },
    };

    if (property.area > 0) {
      listing.floorSize = {
        '@type': 'QuantitativeValue',
        value: property.area,
        unitCode: 'MTK',
        unitText: 'm²',
      };
    }

    if (typeof property.bedrooms === 'number' && property.bedrooms > 0) {
      listing.numberOfRooms = property.bedrooms;
      listing.numberOfBedrooms = property.bedrooms;
    }

    if (typeof property.bathrooms === 'number' && property.bathrooms > 0) {
      listing.numberOfBathroomsTotal = property.bathrooms;
    }

    if (typeof property.lat === 'number' && typeof property.lng === 'number') {
      listing.geo = {
        '@type': 'GeoCoordinates',
        latitude: property.lat,
        longitude: property.lng,
      };
    }

    if (property.developer) {
      listing.provider = {
        '@type': 'Organization',
        name: property.developer,
      };
    }

    return listing;
  }

  public buildBreadcrumbJsonLd(
    items: Array<{ name: string; url: string }>
  ): Record<string, unknown> {
    return {
      '@context': 'https://schema.org',
      '@type': 'BreadcrumbList',
      itemListElement: items.map((item, idx) => ({
        '@type': 'ListItem',
        position: idx + 1,
        name: item.name,
        item: resolveAbsoluteUrl(this.siteUrl, item.url),
      })),
    };
  }
}

const NOINDEX_PAGES: ReadonlySet<Page> = new Set<Page>([
  'manage-users',
  'login',
  'register',
  'profile',
  'add-listing',
  'edit-listing',
  'payment',
]);

export interface PageSeoContext {
  isRtl: boolean;
  property?: Property | null;
  projectName?: string | null;
  siteUrl?: string;
}

/**
 * Produces complete localized SEO metadata + JSON-LD graphs for any HETTETY route.
 */
export function buildPageSeoMetadata(page: Page, ctx: PageSeoContext): SeoMetadata {
  const siteUrl = normalizeSiteUrl(ctx.siteUrl || DEFAULT_SITE_URL);
  const manager = new SeoManager(siteUrl);
  const lang: 'ar' | 'en' = ctx.isRtl ? 'ar' : 'en';
  const noIndex = NOINDEX_PAGES.has(page);

  const orgGraph = manager.buildOrganizationJsonLd(siteUrl);
  const webSiteGraph = manager.buildWebSiteJsonLd(siteUrl);
  const homeCrumb = { name: ctx.isRtl ? 'الرئيسية' : 'Home', url: '/' };

  if (page === 'property' && ctx.property) {
    const p = ctx.property;
    const pricePart = p.price
      ? `${p.price.toLocaleString()} ${p.currency || 'EGP'}`
      : ctx.isRtl
        ? 'السعر عند الطلب'
        : 'Price on request';
    const title = `${p.title} | ${p.location} — HETTETY`;
    const description =
      p.description?.slice(0, 155) ||
      (ctx.isRtl
        ? `${p.title} في ${p.location} — ${pricePart}، مساحة ${p.area} م² عبر منصة حِتّتي العقارية.`
        : `${p.title} in ${p.location} — ${pricePart}, ${p.area} m² on HETTETY luxury Egyptian real estate platform.`);

    const breadcrumbs = manager.buildBreadcrumbJsonLd([
      homeCrumb,
      { name: ctx.isRtl ? 'العقارات' : 'Listings', url: '#listings' },
      { name: p.title, url: `#property/${encodeURIComponent(p.id)}` },
    ]);

    return {
      title,
      description,
      canonicalPath: `#property/${encodeURIComponent(p.id)}`,
      ogType: 'product',
      ogImage: p.imageUrl || DEFAULT_OG_IMAGE,
      noIndex: false,
      lang,
      jsonLd: [orgGraph, manager.buildPropertyJsonLd(p, siteUrl), breadcrumbs],
    };
  }

  if (page === 'project' && ctx.projectName) {
    const encoded = encodeURIComponent(ctx.projectName);
    const breadcrumbs = manager.buildBreadcrumbJsonLd([
      homeCrumb,
      { name: ctx.isRtl ? 'المشاريع' : 'Projects', url: '#listings' },
      { name: ctx.projectName, url: `#project/${encoded}` },
    ]);
    return {
      title: ctx.isRtl
        ? `مشروع ${ctx.projectName} — وحدات وأسعار وجولات 3D | حِتّتي`
        : `${ctx.projectName} — Units, Prices & 3D Tours | HETTETY`,
      description: ctx.isRtl
        ? `استكشف جميع الوحدات المتاحة وأنظمة السداد في مشروع ${ctx.projectName} عبر منصة حِتّتي.`
        : `Explore available units, prices, payment plans, and 3D tours in ${ctx.projectName} on HETTETY.`,
      canonicalPath: `#project/${encoded}`,
      ogType: 'website',
      noIndex: false,
      lang,
      jsonLd: [orgGraph, webSiteGraph, breadcrumbs],
    };
  }

  const pageMetaMap: Record<Page, { titleAr: string; titleEn: string; descAr: string; descEn: string; path: string }> = {
    home: {
      titleAr: 'حِتّتي HETTETY — منصة العقارات الذكية وجولات 3D في مصر',
      titleEn: 'HETTETY — Luxury Egyptian Real Estate, 3D Tours & AI Advisor',
      descAr: 'اكتشف أفضل العقارات والكمبوندات في مصر مع جولات ثلاثية الأبعاد، مراجعة المستندات، والمستشار العقاري الذكي.',
      descEn: 'FIND. TRUST. OWN. Discover verified Egyptian properties with real 3D walkthroughs, document review, and an AI Real Estate Advisor.',
      path: '/',
    },
    listings: {
      titleAr: 'تصفح العقارات المتاحة للبيع والإيجار في مصر | حِتّتي',
      titleEn: 'Verified Properties for Sale & Rent in Egypt | HETTETY',
      descAr: 'ابحث وفلتر بين شقق، فيلات، تاون هاوس، وشاليهات في التجمع الخامس، الشيخ زايد، الساحل الشمالي، والعاصمة الإدارية.',
      descEn: 'Search and filter apartments, villas, townhouses, and chalets across New Cairo, Sheikh Zayed, North Coast, and New Capital.',
      path: '#listings',
    },
    'yalla-sahel': {
      titleAr: 'ساحل حِتّتي — شاليهات وفيلات الساحل الشمالي ورأس الحكمة',
      titleEn: 'Sahel HETTETY — North Coast & Ras El Hekma Chalets & Villas',
      descAr: 'استكشف شاليهات مراسي، هاسيندا، ورأس الحكمة مع معاينة 3D وتواصل مباشر مع المالك.',
      descEn: 'Explore coastal chalets and beachfront villas in Marassi, Hacienda, and Ras El Hekma with immersive 3D previews.',
      path: '#yalla-sahel',
    },
    '3d-experience': {
      titleAr: 'تجربة الجولات ثلاثية الأبعاد 3D والبانوراما 360° | حِتّتي',
      titleEn: 'Interactive 3D Property Walkthroughs & 360° Tours | HETTETY',
      descAr: 'تجوّل داخل الوحدات العقارية بتقنية 3D Gaussian Splatting و360° قبل الزيارة الميدانية.',
      descEn: 'Step inside Egyptian properties remotely using interactive 3D walkthroughs and 360° immersive panoramas.',
      path: '#3d-experience',
    },
    'ai-chat': {
      titleAr: 'المستشار العقاري الذكي في مصر | حِتّتي',
      titleEn: 'AI Smart Real Estate Advisor Egypt | HETTETY',
      descAr: 'استشارات عقارية محايدة، مقارنة كمبوندات التجمع وزايد والساحل، وحساب الأقساط والعائد الإيجاري.',
      descEn: 'Unbiased Egyptian real estate intelligence, developer due diligence, district yield benchmarks, and payment planning.',
      path: '#ai-chat',
    },
    legal: {
      titleAr: 'المركز القانوني ومراجعة مستندات الملكية | حِتّتي',
      titleEn: 'Trust & Legal Document Review Center | HETTETY',
      descAr: 'ارفع وراجع مستندات الملكية والعقود في خزنة رقمية مشفرة مع إرشادات الشهر العقاري المصري.',
      descEn: 'Secure encrypted vault for reviewing property deeds and contracts with Egyptian Real Estate Publicity guidance.',
      path: '#legal',
    },
    about: {
      titleAr: 'عن منصة حِتّتي العقارية | HETTETY',
      titleEn: 'About HETTETY — Future of Smart Real Estate in Egypt',
      descAr: 'تعرف على رؤية ومهمة حِتّتي في رفع الشفافية والأمان في السوق العقاري المصري.',
      descEn: 'Learn about HETTETY’s mission to bring transparency, 3D technology, and AI advisory to Egyptian real estate.',
      path: '#about',
    },
    buy: {
      titleAr: 'شراء عقار ذكي في مصر | حِتّتي',
      titleEn: 'Smart Property Buying in Egypt | HETTETY',
      descAr: 'دليلك الذكي لشراء وحدة سكنية أو استثمارية في مصر ببيانات دقيقة للمتر والمطورين.',
      descEn: 'Data-driven property buying in Egypt with accurate price-per-sqm analysis and payment comparison.',
      path: '#buy',
    },
    verification: {
      titleAr: 'مراجعة وتدقيق المستندات العقارية | حِتّتي',
      titleEn: 'Property Document Verification | HETTETY',
      descAr: 'شفافية كاملة في مراجعة عقود الملكية وتوضيح خطوات الشهر العقاري في مصر.',
      descEn: 'Transparent document review workflows clarifying what is checked and official registration steps.',
      path: '#verification',
    },
    tours: {
      titleAr: 'جولات العقارات الافتراضية 3D | حِتّتي',
      titleEn: 'Virtual 3D Property Tours | HETTETY',
      descAr: 'استعرض التشطيبات والمساحات بتقنية الجولات ثلاثية الأبعاد قبل المعاينة.',
      descEn: 'Inspect finishes, floor layouts, and views remotely via high-fidelity 3D property tours.',
      path: '#tours',
    },
    privacy: {
      titleAr: 'سياسة الخصوصية وحماية البيانات | حِتّتي',
      titleEn: 'Privacy & Data Protection Policy | HETTETY',
      descAr: 'التزام حِتّتي بحماية بياناتك ومستنداتك وفق القانون المصري رقم 151 لسنة 2020.',
      descEn: 'HETTETY Privacy Policy complying with Egyptian Personal Data Protection Law No. 151 of 2020.',
      path: '#privacy',
    },
    terms: {
      titleAr: 'الشروط والأحكام | حِتّتي',
      titleEn: 'Terms & Conditions | HETTETY',
      descAr: 'الشروط والأحكام المنظمة لاستخدام منصة حِتّتي العقارية.',
      descEn: 'Terms and conditions governing the use of HETTETY real estate services.',
      path: '#terms',
    },
    'cookie-policy': {
      titleAr: 'سياسة ملفات تعريف الارتباط | حِتّتي',
      titleEn: 'Cookie Policy | HETTETY',
      descAr: 'تفاصيل استخدام ملفات تعريف الارتباط وتفضيلات الخصوصية في منصة حِتّتي.',
      descEn: 'Details on how HETTETY uses cookies and privacy preferences.',
      path: '#cookie-policy',
    },
    contact: {
      titleAr: 'تواصل معنا | حِتّتي',
      titleEn: 'Contact Us | HETTETY',
      descAr: 'تواصل مع فريق دعم ومستشاري منصة حِتّتي العقارية.',
      descEn: 'Reach HETTETY real estate support and advisory specialists.',
      path: '#contact',
    },
    'manage-users': {
      titleAr: 'لوحة التحكم الإدارية | حِتّتي',
      titleEn: 'Admin Operations Command Center | HETTETY',
      descAr: 'لوحة إدارة العمليات والمنصة الداخلية لحِتّتي.',
      descEn: 'Internal administrative command center for HETTETY operations.',
      path: '#manage-users',
    },
    login: {
      titleAr: 'تسجيل الدخول | حِتّتي',
      titleEn: 'Sign In | HETTETY',
      descAr: 'سجّل الدخول إلى حسابك في منصة حِتّتي.',
      descEn: 'Sign in to your HETTETY account.',
      path: '#login',
    },
    register: {
      titleAr: 'إنشاء حساب جديد | حِتّتي',
      titleEn: 'Create Account | HETTETY',
      descAr: 'أنشئ حسابك على منصة حِتّتي لحفظ العقارات والاستفادة من المستشار الذكي.',
      descEn: 'Create a HETTETY account to save properties and unlock AI advisory.',
      path: '#register',
    },
    profile: {
      titleAr: 'الملف الشخصي | حِتّتي',
      titleEn: 'Personal Profile | HETTETY',
      descAr: 'إدارة إعلاناتك، مفضلاتك، ومشترياتك على منصة حِتّتي.',
      descEn: 'Manage your listings, favorites, and reservations on HETTETY.',
      path: '#profile',
    },
    'add-listing': {
      titleAr: 'إضافة عقار جديد | حِتّتي',
      titleEn: 'Add Property Listing | HETTETY',
      descAr: 'أضف عقارك على منصة حِتّتي مع صور وجولة ثلاثية الأبعاد.',
      descEn: 'List your property on HETTETY with photos, legal docs, and 3D scans.',
      path: '#add-listing',
    },
    'edit-listing': {
      titleAr: 'تعديل إعلان عقاري | حِتّتي',
      titleEn: 'Edit Property Listing | HETTETY',
      descAr: 'تحديث بيانات وسائط وتفاصيل وحدتك العقارية.',
      descEn: 'Update property listing details and media.',
      path: '#edit-listing',
    },
    payment: {
      titleAr: 'حجز وحدة وطلب السداد | حِتّتي',
      titleEn: 'Unit Reservation & Payment | HETTETY',
      descAr: 'إتمام طلب حجز الوحدة العقارية عبر حِتّتي.',
      descEn: 'Complete your property reservation request on HETTETY.',
      path: '#payment',
    },
    '3d': {
      titleAr: 'عارض الجولة ثلاثية الأبعاد | حِتّتي',
      titleEn: 'Interactive 3D Tour Viewer | HETTETY',
      descAr: 'استكشف العقار بتجربة ثلاثية الأبعاد تفاعلية.',
      descEn: 'Explore the property inside HETTETY’s interactive 3D viewer.',
      path: '#3d',
    },
    property: {
      titleAr: 'تفاصيل العقار | حِتّتي',
      titleEn: 'Property Details | HETTETY',
      descAr: 'استعرض مواصفات، أسعار، ومستندات العقار على منصة حِتّتي.',
      descEn: 'Inspect property specifications, pricing, and reviewed documents on HETTETY.',
      path: '#property',
    },
    project: {
      titleAr: 'تفاصيل المشروع | حِتّتي',
      titleEn: 'Compound & Project Overview | HETTETY',
      descAr: 'استعرض وحدات ومرافق المشروع السكني عبر حِتّتي.',
      descEn: 'Explore residential project units and masterplan highlights on HETTETY.',
      path: '#project',
    },
  };

  const entry = pageMetaMap[page] || pageMetaMap.home;
  const title = ctx.isRtl ? entry.titleAr : entry.titleEn;
  const description = ctx.isRtl ? entry.descAr : entry.descEn;

  const breadcrumbs =
    page === 'home'
      ? null
      : manager.buildBreadcrumbJsonLd([
          homeCrumb,
          { name: title.split('|')[0].trim(), url: entry.path },
        ]);

  const jsonLd: Record<string, unknown>[] = [orgGraph, webSiteGraph];
  if (breadcrumbs && !noIndex) {
    jsonLd.push(breadcrumbs);
  }

  return {
    title,
    description,
    canonicalPath: entry.path,
    ogType: 'website',
    noIndex,
    lang,
    jsonLd,
  };
}

export const seoManager = new SeoManager(DEFAULT_SITE_URL);
export default seoManager;
