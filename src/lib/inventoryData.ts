import { Property } from '../types';

/**
 * Premier Egyptian Landmark Compound Units
 * High-fidelity inventory for Hyde Park, Mountain View, and SODIC
 * Equipped with full payment plans, 3D digital twins, and 360° panoramas.
 */
export const PREMIER_LANDMARK_PROPERTIES: Property[] = [
  {
    id: 'hyde-park-one-1',
    isDemo: true,
    source: 'fixture',
    title: 'One Hyde Park Luxury Park Villa',
    description: 'Exclusive standalone villa in One Hyde Park New Cairo overlooking the grand 141-feddan central park. Delivered semi-finished with private pool garden.',
    price: 18_500_000,
    currency: 'EGP',
    location: 'New Cairo, Egypt',
    bedrooms: 5,
    bathrooms: 5,
    area: 420,
    gardenArea: 250,
    propertyType: 'Villa',
    compound: 'One Hyde Park',
    developer: 'Hyde Park Developments',
    deliveryDate: '2027-06-30',
    deliveryTimeline: '1-2years',
    finishing: 'Semi Finished',
    floor: 'G+2',
    view: 'Central Park & Water Feature',
    furnished: false,
    contactPhone: '+201022233445',
    amenities: ['141-Feddan Central Park', 'Clubhouse', 'Swimming Pools', '24/7 Security', 'Underground Garage'],
    paymentPlans: [
      { downPayment: 925_000, years: 8, note: '5% Down Payment, 8 Years Equal Quarterly Installments' },
      { downPayment: 1_850_000, years: 8, note: '10% Down Payment, 5% on Handover, Extended 8 Years' }
    ],
    status: 'For Sale',
    availability: 'Available',
    isVerified: true,
    verificationStatus: 'Verified',
    imageUrl: 'https://images.unsplash.com/photo-1613977257363-707ba9348227?auto=format&fit=crop&w=1200&q=80',
    images: [
      'https://images.unsplash.com/photo-1613977257363-707ba9348227?auto=format&fit=crop&w=1200&q=80',
      'https://images.unsplash.com/photo-1600585154340-be6161a56a0c?auto=format&fit=crop&w=1200&q=80',
      'https://images.unsplash.com/photo-1600607687939-ce8a6c25118c?auto=format&fit=crop&w=1200&q=80'
    ],
    panoramas: [
      'https://images.unsplash.com/photo-1600585154340-be6161a56a0c?auto=format&fit=crop&w=1600&q=80'
    ],
    digitalTwinUrl: 'https://my.matterport.com/show/?m=hydepark_one_sample',
    threeDTour: {
      status: 'ready',
      provider: 'hettety',
      source: 'hettety_capture',
      format: 'spz',
      assetUrl: 'https://cdn.hettety.com/tours/hp-ohp-v09/scene.spz',
      representation: {
        gaussianSplat: {
          format: 'spz',
          url: 'https://cdn.hettety.com/tours/hp-ohp-v09/scene.spz',
          sizeBytes: 8.7 * 1024 * 1024,
          splatCount: 1250000,
        },
        mesh: {
          format: 'glb',
          url: 'https://cdn.hettety.com/tours/hp-ohp-v09/mesh.glb',
          sizeBytes: 12.3 * 1024 * 1024,
          isCalibratedMetric: true,
        },
      },
      bounds: { min: [-6, 0, -8], max: [6, 6, 4] },
      rooms: [
        { id: 'reception', name: 'Grand Reception Salon', nameAr: 'صالون الاستقبال الرئيسي', position: [0, 1.6, 0] },
        { id: 'master_suite', name: 'Master Suite & Dressing', nameAr: 'جناح الماستر وغرفة الملابس', position: [4.2, 4.8, -2.1] },
        { id: 'kitchen', name: 'Open Island Kitchen', nameAr: 'المطبخ الأمريكي المفتوح', position: [-3.5, 1.6, 1.8] },
        { id: 'garden_pool', name: 'Private Garden & Pool Deck', nameAr: 'حديقة الفيلا وحمام السباحة', position: [0.5, 0.2, -6.5] }
      ],
      qualityReport: {
        coverageScore: 96,
        cameraMotionScore: 92,
        blurScore: 94,
        lightingScore: 95,
        roomCompleteness: 98
      }
    },
    unitCode: 'HP-OHP-V09',
    registrationNumber: 'HP-MIN-2022/98',
    courtSignatureValidity: true,
    isResale: false,
    paymentMethods: ['Installments', 'Cash'],
    publishDate: '2026-03-01'
  },
  {
    id: 'mv-icity-lagoon-1',
    isDemo: true,
    source: 'fixture',
    title: 'Mountain View iCity Lagoon iVilla',
    description: 'Innovative iVilla with roof and crystal lagoon view in Mountain View iCity New Cairo. Smart 4D island living with direct club park access.',
    price: 9_400_000,
    currency: 'EGP',
    location: 'New Cairo, Egypt',
    bedrooms: 3,
    bathrooms: 3,
    area: 235,
    roofArea: 65,
    propertyType: 'Duplex',
    compound: 'Mountain View iCity',
    developer: 'Mountain View',
    deliveryDate: '2026-11-30',
    deliveryTimeline: '1-2years',
    finishing: 'Semi Finished',
    floor: '3rd + Roof',
    view: 'Crystal Lagoon & Central Park',
    furnished: false,
    contactPhone: '+201011122334',
    amenities: ['Swimmable Crystal Lagoon', 'The Club Park', 'Jogging Track', 'Smart Gate Access', 'Kids Wonderland'],
    paymentPlans: [
      { downPayment: 940_000, years: 9, note: '10% Down Payment, 9 Years Flexible Equal Payments' },
      { downPayment: 470_000, years: 8, note: '5% Down Payment, 8 Years with Zero Interest' }
    ],
    status: 'For Sale',
    availability: 'Available',
    isVerified: true,
    verificationStatus: 'Verified',
    imageUrl: 'https://images.unsplash.com/photo-1545324418-cc1a3fa10c00?auto=format&fit=crop&w=1200&q=80',
    images: [
      'https://images.unsplash.com/photo-1545324418-cc1a3fa10c00?auto=format&fit=crop&w=1200&q=80',
      'https://images.unsplash.com/photo-1512917774080-9991f1c4c750?auto=format&fit=crop&w=1200&q=80'
    ],
    panoramas: [
      'https://images.unsplash.com/photo-1545324418-cc1a3fa10c00?auto=format&fit=crop&w=1600&q=80'
    ],
    digitalTwinUrl: 'https://my.matterport.com/show/?m=mv_icity_sample',
    threeDTour: {
      status: 'ready',
      provider: 'hettety',
      source: 'hettety_capture',
      format: 'spz',
      assetUrl: 'https://cdn.hettety.com/tours/mv-icity-lagoon-1/scene.spz',
      representation: {
        gaussianSplat: {
          format: 'spz',
          url: 'https://cdn.hettety.com/tours/mv-icity-lagoon-1/scene.spz',
          sizeBytes: 9.1 * 1024 * 1024,
          splatCount: 1380000,
        },
        mesh: {
          format: 'glb',
          url: 'https://cdn.hettety.com/tours/mv-icity-lagoon-1/mesh.glb',
          sizeBytes: 13.8 * 1024 * 1024,
          isCalibratedMetric: true,
        },
      },
      bounds: { min: [-5, 0, -6], max: [5, 8, 4] },
      rooms: [
        { id: 'living', name: 'Lagoon View Living Area', nameAr: 'صالة المعيشة بإطلالة اللاجون', position: [0, 1.6, 0] },
        { id: 'sky_roof', name: 'Panoramic Sky Roof Terrace', nameAr: 'روف التراس البانورامي', position: [0, 7.2, -3.0] },
        { id: 'master_bedroom', name: 'Master Bedroom', nameAr: 'غرفة النوم الرئيسية', position: [3.2, 4.5, 1.2] }
      ],
      qualityReport: {
        coverageScore: 94,
        cameraMotionScore: 90,
        blurScore: 92,
        lightingScore: 91,
        roomCompleteness: 95
      }
    },
    unitCode: 'MV-IC-IV42',
    registrationNumber: 'MV-NUCA-2023/15',
    courtSignatureValidity: true,
    isResale: false,
    paymentMethods: ['Installments', 'Cash'],
    publishDate: '2026-03-05'
  },
  {
    id: 'mv-ras-el-hekma-1',
    isDemo: true,
    source: 'fixture',
    title: 'Mountain View Ras El Hekma Seafront Chalet',
    description: 'Charming Greek-island style chalet in Paros / Rhodes Island at Mountain View Ras El Hekma. Direct panoramic Mediterranean views and private beach club.',
    price: 12_800_000,
    currency: 'EGP',
    location: 'North Coast, Egypt',
    bedrooms: 3,
    bathrooms: 2,
    area: 165,
    propertyType: 'Chalet',
    compound: 'Mountain View Ras El Hekma',
    developer: 'Mountain View',
    deliveryDate: 'Ready',
    deliveryTimeline: 'ready',
    finishing: 'Fully Finished',
    floor: '1st Floor',
    view: 'Direct Sea & White Sandy Beach',
    furnished: true,
    yallaSahel: true,
    village: 'Mountain View Ras El Hekma',
    contactPhone: '+201099887766',
    amenities: ['Private Beach', 'Infinity Pools', 'Greek Village Dining', 'Ladies Beach', 'Kids Island'],
    paymentPlans: [
      { downPayment: 1_280_000, years: 8, note: '10% Down Payment, 8 Years Installments' },
      { downPayment: 3_840_000, years: 0, note: 'Cash Deal with 25% Upfront Incentive' }
    ],
    status: 'For Sale',
    availability: 'Available',
    isVerified: true,
    verificationStatus: 'Verified',
    imageUrl: 'https://images.unsplash.com/photo-1507525428034-b723cf961d3e?auto=format&fit=crop&w=1200&q=80',
    images: [
      'https://images.unsplash.com/photo-1507525428034-b723cf961d3e?auto=format&fit=crop&w=1200&q=80',
      'https://images.unsplash.com/photo-1499793983690-e29da59ef1c2?auto=format&fit=crop&w=1200&q=80'
    ],
    panoramas: [
      'https://images.unsplash.com/photo-1507525428034-b723cf961d3e?auto=format&fit=crop&w=1600&q=80'
    ],
    digitalTwinUrl: 'https://my.matterport.com/show/?m=mv_ras_el_hekma_sample',
    unitCode: 'MV-RH-CH18',
    registrationNumber: 'MV-TOUR-2024/04',
    courtSignatureValidity: true,
    isResale: false,
    paymentMethods: ['Cash', 'Installments'],
    publishDate: '2026-03-08'
  },
  {
    id: 'sodic-villette-sky-1',
    isDemo: true,
    source: 'fixture',
    title: 'SODIC Villette Sky Condo Residence',
    description: 'Signature Sky Condo apartment in Villette New Cairo by SODIC. Steps from Club S, commercial EDNC center, and pocket parks. Prime Golden Square location.',
    price: 14_200_000,
    currency: 'EGP',
    location: 'New Cairo, Egypt',
    bedrooms: 3,
    bathrooms: 3,
    area: 215,
    propertyType: 'Apartment',
    compound: 'Villette',
    developer: 'SODIC',
    deliveryDate: 'Ready',
    deliveryTimeline: 'ready',
    finishing: 'Fully Finished',
    floor: '2nd Floor',
    view: 'Villette Central Spine & Pocket Parks',
    furnished: false,
    contactPhone: '+201055443322',
    amenities: ['Club S', 'EDNC Commercial District', 'Sports Hub', 'Bicycle Lanes', 'Heated Pools'],
    paymentPlans: [
      { downPayment: 710_000, years: 8, note: '5% Down Payment, 8 Years Structured Installments' },
      { downPayment: 1_420_000, years: 7, note: '10% Down Payment, 7 Years Equal Installments' }
    ],
    status: 'For Sale',
    availability: 'Available',
    isVerified: true,
    verificationStatus: 'Verified',
    imageUrl: 'https://images.unsplash.com/photo-1512918728675-ed5a9ecdebfd?auto=format&fit=crop&w=1200&q=80',
    images: [
      'https://images.unsplash.com/photo-1512918728675-ed5a9ecdebfd?auto=format&fit=crop&w=1200&q=80',
      'https://images.unsplash.com/photo-1600607687920-4e2a09cf159d?auto=format&fit=crop&w=1200&q=80'
    ],
    panoramas: [
      'https://images.unsplash.com/photo-1512918728675-ed5a9ecdebfd?auto=format&fit=crop&w=1600&q=80'
    ],
    digitalTwinUrl: 'https://my.matterport.com/show/?m=sodic_villette_sample',
    unitCode: 'SD-VIL-SC04',
    registrationNumber: 'SDC-EGX-2022/88',
    courtSignatureValidity: true,
    isResale: false,
    paymentMethods: ['Cash', 'Installments'],
    publishDate: '2026-03-10'
  },
  {
    id: 'sodic-october-plaza-1',
    isDemo: true,
    source: 'fixture',
    title: 'SODIC October Plaza Garden Apartment',
    description: 'Ground floor luxury apartment with private garden in October Plaza by SODIC. Located in Northern Expansions behind Mall of Arabia and Shooting Club.',
    price: 7_600_000,
    currency: 'EGP',
    location: '6th of October, Egypt',
    bedrooms: 3,
    bathrooms: 2,
    area: 180,
    gardenArea: 85,
    propertyType: 'Apartment',
    compound: 'October Plaza',
    developer: 'SODIC',
    deliveryDate: 'Ready',
    deliveryTimeline: 'ready',
    finishing: 'Fully Finished',
    floor: 'Ground',
    view: 'Private Garden & Landscaped Promenade',
    furnished: false,
    contactPhone: '+201066778899',
    amenities: ['1.7km Jogging Track', 'BBQ Zones', 'Swimming Pools', 'Kids Play Area', 'Clubhouse'],
    paymentPlans: [
      { downPayment: 760_000, years: 8, note: '10% Down Payment, 8 Years Flexible Quarterly Installments' },
      { downPayment: 380_000, years: 7, note: '5% Down Payment, 7 Years Installments' }
    ],
    status: 'For Sale',
    availability: 'Available',
    isVerified: true,
    verificationStatus: 'Verified',
    imageUrl: 'https://images.unsplash.com/photo-1560448204-e02f11c3d0e2?auto=format&fit=crop&w=1200&q=80',
    images: [
      'https://images.unsplash.com/photo-1560448204-e02f11c3d0e2?auto=format&fit=crop&w=1200&q=80',
      'https://images.unsplash.com/photo-1560185127-6ed189bf02f4?auto=format&fit=crop&w=1200&q=80'
    ],
    panoramas: [
      'https://images.unsplash.com/photo-1560448204-e02f11c3d0e2?auto=format&fit=crop&w=1600&q=80'
    ],
    digitalTwinUrl: 'https://my.matterport.com/show/?m=sodic_october_sample',
    unitCode: 'SD-OCT-G12',
    registrationNumber: 'SDC-OCT-2023/41',
    courtSignatureValidity: true,
    isResale: false,
    paymentMethods: ['Cash', 'Installments'],
    publishDate: '2026-03-12'
  }
];
