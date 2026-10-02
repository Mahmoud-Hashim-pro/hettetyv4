export type Page = 'home' | 'listings' | '3d-experience' | 'legal' | 'ai-chat' | 'login' | 'register' | 'contact' | '3d' | 'about' | 'buy' | 'verification' | 'tours' | 'terms' | 'privacy' | 'cookie-policy' | 'profile' | 'add-listing' | 'payment' | 'manage-users' | 'property' | 'yalla-sahel' | 'project' | 'edit-listing';

export interface Property {
  id: string;
  title: string;
  description?: string;
  price: number;
  location: string;
  bedrooms: number;
  bathrooms: number;
  area: number;
  propertyType?: string;   // Apartment / Villa / Duplex / Chalet / Studio / Townhouse / Penthouse / Office / Retail / Land
  compound?: string;       // Project / compound name (Egyptian primary market)
  developer?: string;      // Developer / company
  deliveryDate?: string;   // Handover date, or "Ready"
  deliveryTimeline?: string; // Delivery timeline (e.g. "ready", "1-2years", "3+years")
  finishing?: string;      // Not Finished / Semi Finished / Finished / Fully Finished
  floor?: string;          // Floor number / "Ground" / "Roof"
  view?: string;           // Garden / Sea / Pool / Street ...
  furnished?: boolean;     // Mainly relevant for rentals
  contactPhone?: string;   // Seller/agent phone — powers call + WhatsApp lead buttons
  amenities?: string[];    // Clubhouse, Pools, Gym, Security, Lagoons, Garage ...
  areaTo?: number;         // Upper bound when a unit type spans an area range (area = from)
  paymentPlans?: { downPayment?: number; years?: number; note?: string }[]; // Structured installment plans
  currency?: 'EGP' | 'USD'; // Currency the price is quoted in (label only, no conversion)
  // The lowest advertised price across the whole project. Shown only where this
  // unit has no price of its own, and always labelled as the project's floor —
  // it is never a price for this unit.
  projectPriceFrom?: number;
  priceSource?: string;    // Who published it, so the figure can be checked
  priceAsOf?: string;      // When they published it (YYYY-MM-DD)
  pricePeriod?: 'total' | 'night' | 'week' | 'month'; // How the price is quoted (rentals)
  guests?: number;         // Max guests the unit sleeps (coastal rentals)
  village?: string;        // Coastal village / resort (Marassi, Hacienda, Marina ...)
  yallaSahel?: boolean;    // Explicitly listed under the "Yalla Sahel" coastal programme
  lat?: number;            // Optional geolocation for the map
  lng?: number;
  // Publication state, controlled by the owner. Absent means 'Live' (legacy listings).
  // NOTE: this is a UI-level hide, not a privacy boundary — the properties collection
  // is world-readable, so a Draft is hidden, never secret.
  listingState?: 'Draft' | 'Live' | 'Removed';
  verifiedBy?: string;     // Reviewer email — written by an admin only
  verifiedAt?: string;     // ISO timestamp of the review
  reviewNote?: string;     // What the reviewer saw / what needs fixing

  // ---- Unit detail, as developer brochures actually express it ----
  gardenArea?: number;     // Private garden in m² — a separate column in unit tables
  roofArea?: number;       // Private roof/terrace in m²
  unitModel?: string;      // The developer's own code: "T-51B", "نموذج ب٣", "Loft A"
  buildingType?: string;   // "Building A", "Loft", "S-Villa B"
  floorsDescription?: string; // "G+6", "٥ أدوار + أرضي"
  maintenanceFee?: number; // Percent of unit price, payable on delivery
  phase?: string;          // Phase / zone / منطقة within the project

  // ---- Project-level facts, shared by every unit in a compound ----
  projectAreaFeddan?: number;  // Total project size in feddan
  greenSpacePercent?: number;  // Share of the project that is open/green
  financing?: string[];        // e.g. mortgage initiative, social housing fund
  masterPlanUrl?: string;      // The master-plan drawing
  floorPlanUrls?: string[];    // Floor plans / unit layouts
  /**
   * One depth map per entry in images[], as a 128x128 grayscale PNG data URL
   * where brighter means nearer. Predicted once from the photo and stored, so
   * the 3D view gets real depth without anyone downloading a model.
   */
  depthMaps?: string[];
  rejectedAt?: string;     // Set when a reviewer pulls the listing. Owner-immutable:
                           // an owner may edit and resubmit, but not un-pull it.
  imageUrl: string;
  images?: string[];
  panoramas?: string[]; // Equirectangular 360° photos for the immersive look-around viewer
  videoUrl?: string;
  digitalTwinUrl?: string; // For 3D Digital Twin or Polycam/Matterport walkthrough link
  threeDTour?: ThreeDTourAsset; // Real 3D Reconstruction Asset (3DGS / SPZ / GLB) with waypoints
  status: 'For Sale' | 'For Rent';
  // Listing lifecycle: still on the market, taken, or reserved.
  availability?: 'Available' | 'Sold' | 'Reserved';
  isVerified: boolean;
  verificationStatus?: 'Pending' | 'Verified' | 'Rejected';
  paymentMethods?: string[];
  publishDate?: string;
  unitCode?: string;
  legalDocs?: string[]; // URLs or IDs
  authorUid?: string;
  
  // Additional Legal / Details Info
  registrationNumber?: string; // raqm el shahr el 3aqary
  courtSignatureValidity?: boolean; // s7t tawqe3
  isResale?: boolean;
}

export interface Notification {
  id: string;
  userId: string;
  title: string;
  message: string;
  date: string;
  read: boolean;
}

export interface UserProfile {
  id: string;
  name: string;
  email: string;
  phone: string;
  preferences: string;
}

export interface Purchase {
  id: string;
  propertyId: string;
  purchaseDate: string;
  status: string;
  property?: Property;
}

export interface ChatMessage {
  role: 'model' | 'user';
  text: string;
  timestamp: Date;
}

export interface ChatSession {
  id: string;
  userId: string;
  title: string;
  messages: ChatMessage[];
  lastUpdatedAt: string;
}

/**
 * Where a document is in the review queue.
 * 'Checked' means a reviewer read the copy that was uploaded — it is NOT a claim
 * that the document is genuine or registered with the Real Estate Publicity
 * Department (الشهر العقاري). Nothing in this app can establish that.
 */
export type DocReviewStatus = 'Uploaded' | 'InReview' | 'Checked' | 'NeedsAttention';

export interface UserDocument {
  id: string;
  fileId?: string;
  name: string;
  type: string;
  /** @deprecated Legacy self-asserted field. Every old document says 'Verified'
   *  without anything having checked it. Read reviewStatus instead. */
  status?: string;
  reviewStatus?: DocReviewStatus; // absent => 'Uploaded' (never reviewed)
  reviewedBy?: string;            // reviewer email — admin-written only
  reviewedAt?: string;            // ISO timestamp
  reviewNote?: string;            // what the reviewer saw / what needs fixing
  uploadDate: string;
  accessStatus?: 'Locked' | 'Requested' | 'Granted';
  size?: number;
  content?: string; // Base64 data URL for viewing (if small) or download URL
  ownerUid: string;
  storagePath?: string;
}

export type InvestmentPurpose = 'all' | 'residential' | 'investment' | 'resale' | 'coastal';

export interface AdvisorFinancialProfile {
  budget: number;
  downPayment: number;
  monthlyCapacity: number;
  currency: 'EGP' | 'USD';
  purpose: InvestmentPurpose;
  preferredLocation: string;
  propertyType: string;
  deliveryTimeline: 'all' | 'ready' | '1-2years' | '3+years';
  preferredPaymentPlan?: string;
  bedrooms?: string;
}

export interface AdvisorPropertyFit {
  property: Property;
  matchScore: number;
  category: 'perfect' | 'stretch' | 'mismatch';
  reasons: string[];
  downPaymentRequired: number;
  monthlyInstallment: number;
  yearsOfInstallments: number;
  estimatedAnnualRent: number;
  rentalYieldPercent: number;
  capitalAppreciationPercent: number;
  totalAnnualReturnPercent: number;
  paybackYears: number;
}


export interface TourRoomWaypoint {
  id: string;
  name: string;
  nameAr?: string;
  position: [number, number, number];
  camera?: {
    position: [number, number, number];
    target?: [number, number, number];
    rotation?: [number, number, number];
  };
}

export interface ThreeDTourQualityReport {
  coverageScore: number;     // 0-100%
  cameraMotionScore: number; // 0-100%
  blurScore: number;         // 0-100%
  lightingScore: number;     // 0-100%
  roomCompleteness: number;  // 0-100%
  warnings?: string[];
  warningsAr?: string[];
}

export interface ThreeDTourAsset {
  status: 'none' | 'processing' | 'ready' | 'failed';
  provider: 'hettety' | 'matterport' | 'polycam' | 'kuula';
  assetUrl?: string;
  format?: 'spz' | 'ply' | 'glb';
  thumbnailUrl?: string;
  duration?: number;
  rooms?: TourRoomWaypoint[];
  processingJobId?: string;
  qualityReport?: ThreeDTourQualityReport;
}
