/**
 * HETTETY Egyptian Real Estate Market Intelligence & District Benchmarks
 * Authoritative ground truth for Egyptian primary and resale property markets.
 */

export interface DeveloperProfile {
  name: string;
  nameAr: string;
  tier: 'Blue Chip' | 'Upper Tier' | 'High Growth';
  flagshipProjects: string[];
  priceRangePerSqm: { min: number; max: number; currency: 'EGP' };
  typicalPaymentPlan: { downPaymentPercent: number; maxYears: number; quarterlyInstallments: boolean };
  maintenanceDepositPercent: number; // وديعة الصيانة
  legalStatus: string;
  strengths: string[];
  strengthsAr: string[];
}

export interface DistrictBenchmark {
  rentalYield: number; // Mandatory for existing unit test assertions
  capitalGrowth: number; // Mandatory for existing unit test assertions
  avgPricePerSqmPrimary: number;
  avgPricePerSqmResale: number;
  minPricePerSqm: number;
  maxPricePerSqm: number;
  subHubs: string[];
  subHubsAr: string[];
  typicalDownPayment: number; // percentage
  typicalInstallmentYears: number;
  maintenanceDepositRate: number; // percentage (typically 8-10%)
  legalStatusSummary: string;
  legalStatusSummaryAr: string;
}

export const TOP_DEVELOPERS: Record<string, DeveloperProfile> = {
  'Emaar Misr': {
    name: 'Emaar Misr',
    nameAr: 'إعمار مصر',
    tier: 'Blue Chip',
    flagshipProjects: ['Cairo Gate (Sheikh Zayed)', 'Belle Vie (New Zayed)', 'Marassi (Sidi Abdel Rahman)', 'Uptown Cairo (Mokattam)', 'Mivida (New Cairo)'],
    priceRangePerSqm: { min: 110_000, max: 220_000, currency: 'EGP' },
    typicalPaymentPlan: { downPaymentPercent: 5, maxYears: 8, quarterlyInstallments: true },
    maintenanceDepositPercent: 8,
    legalStatus: 'Fully registered ministerial decree with pristine title deed track record (شهرة قانونية تامة وقرار وزاري مرخص).',
    strengths: ['Highest expat rental yields in Egypt', 'World-class facility management (Emaar Community Management)', 'Flawless resale liquidity'],
    strengthsAr: ['أعلى عوائد إيجارية للأجانب والمغتربين', 'إدارة مرافق مجتمعية بمعايير عالمية', 'سيولة فائقة وسرعة في إعادة البيع']
  },
  'Mountain View': {
    name: 'Mountain View (DMG)',
    nameAr: 'ماونتن فيو (دار المعمار)',
    tier: 'Blue Chip',
    flagshipProjects: ['Mountain View iCity (New Cairo)', 'Mountain View iCity (October)', 'Chillout Park', 'LVLS (Ras El Hekma)', 'Mountain View Ras El Hekma (Paros/Rhodes)', 'Plage (Sidi Abdel Rahman)', 'Aliva (Mostakbal City)'],
    priceRangePerSqm: { min: 65_000, max: 145_000, currency: 'EGP' },
    typicalPaymentPlan: { downPaymentPercent: 5, maxYears: 9, quarterlyInstallments: true },
    maintenanceDepositPercent: 8,
    legalStatus: 'Ministerial decrees approved, partnership agreements with NUCA / Ministry of Housing.',
    strengths: ['Innovative family-first masterplans with 4D islands', 'Crystal lagoons and vast green corridors', 'Flexible 8 to 9 year payment terms with zero interest'],
    strengthsAr: ['تصميمات جزر رباعية الأبعاد ذكية للمجتمعات العائلية', 'لاجونز قابلة للسباحة ومساحات خضراء مفتوحة', 'أنظمة سداد مرنة تمتد حتى 9 سنوات بدون فوائد']
  },
  'Hyde Park Developments': {
    name: 'Hyde Park Developments',
    nameAr: 'هايد بارك للتطوير العقاري',
    tier: 'Blue Chip',
    flagshipProjects: ['One Hyde Park (New Cairo)', 'Hyde Park New Cairo (Golden Square)', 'Tawny (6th of October)', 'Seashore (Ras El Hekma)', 'Garden Lakes (October)'],
    priceRangePerSqm: { min: 75_000, max: 160_000, currency: 'EGP' },
    typicalPaymentPlan: { downPaymentPercent: 5, maxYears: 8, quarterlyInstallments: true },
    maintenanceDepositPercent: 8.5,
    legalStatus: 'Institutional bank backing (National Bank of Egypt & Housing and Development Bank) with full title registration.',
    strengths: ['One of Egypt’s largest private parks (141 feddans)', 'Prime Golden Square South 90th location', 'High institutional stability and guaranteed delivery'],
    strengthsAr: ['أكبر حديقة مركزية خاصة بمصر على مساحة 141 فدان', 'موقع استثنائي بالمربع الذهبي على شارع التسعين الجنوبي', 'ملاءة مالية ودعم مؤسسي مباشر من أكبر البنوك القومية']
  },
  'SODIC': {
    name: 'SODIC (Aldar Properties PJSC)',
    nameAr: 'سوديك (تحالف الدار العقارية)',
    tier: 'Blue Chip',
    flagshipProjects: ['Villette (New Cairo)', 'Eastown Residences (South 90th)', 'October Plaza (6th of October)', 'Karmell (New Zayed)', 'June (Ras El Hekma)', 'Vye (New Zayed)'],
    priceRangePerSqm: { min: 85_000, max: 180_000, currency: 'EGP' },
    typicalPaymentPlan: { downPaymentPercent: 5, maxYears: 8, quarterlyInstallments: true },
    maintenanceDepositPercent: 8,
    legalStatus: 'Listed company governance, backed by Aldar UAE sovereign funds, licensed and registered.',
    strengths: ['Premier commercial hubs (The Strip, EDNC) with exceptional footfall', 'Exquisite architectural finishes and European-style landscaping', 'High corporate and multinational tenant demand'],
    strengthsAr: ['مراكز تجارية وأعمال رائدة (The Strip, EDNC)', 'جودة تشطيبات ومعمار أوروبي راقٍ', 'طلب إيجاري مرتفع جداً من الشركات المتعددة الجنسيات']
  },
  'Palm Hills Developments': {
    name: 'Palm Hills Developments (PHD)',
    nameAr: 'بالم هيلز للتعمير',
    tier: 'Blue Chip',
    flagshipProjects: ['Badya (Creative City - October)', 'Palm Hills October', 'Palm Hills New Cairo', 'Hacienda Bay (North Coast)', 'Hacienda White', 'Hacienda Waters (Ras El Hekma)'],
    priceRangePerSqm: { min: 70_000, max: 175_000, currency: 'EGP' },
    typicalPaymentPlan: { downPaymentPercent: 5, maxYears: 10, quarterlyInstallments: true },
    maintenanceDepositPercent: 9,
    legalStatus: 'Publicly traded on EGX, registered concession lands with full urban planning authority approvals.',
    strengths: ['Iconic golf communities and sports academies', 'Badya smart cognitive 3,000 feddan city', 'Legendary coastal brand with Hacienda luxury pedigree'],
    strengthsAr: ['مجتمعات جولف متكاملة وأكاديميات رياضية عالمية', 'مدينة باديا الذكية المتكاملة على 3000 فدان', 'علامة هاسيندا الساحلية الأكثر فخامة ورغبة بالساحل']
  },
  'Tatweer Misr': {
    name: 'Tatweer Misr',
    nameAr: 'تطوير مصر',
    tier: 'Upper Tier',
    flagshipProjects: ['Bloomfields (Mostakbal City)', 'Il Monte Galala (Ain Sokhna)', 'Fouka Bay (Ras El Hekma)', 'Salt (Ras El Hekma)', 'Rivers (New Zayed)'],
    priceRangePerSqm: { min: 60_000, max: 150_000, currency: 'EGP' },
    typicalPaymentPlan: { downPaymentPercent: 5, maxYears: 8, quarterlyInstallments: true },
    maintenanceDepositPercent: 10,
    legalStatus: 'Approved ministerial decrees and coastal tourist development agency licenses.',
    strengths: ['Mountain and sea integrated architecture in Galala', 'First college town educational hub in Mostakbal City', 'Consistently strong rental returns on summer coastal units'],
    strengthsAr: ['معمار جبلي وبحري مبتكر في المونت جلالة', 'أول منطقة تعليمية ومجمّع جامعات في مدينة المستقبل', 'عوائد إيجارية موسمية قوية جداً بالساحل والشروق']
  },
  'Talaat Moustafa Group': {
    name: 'Talaat Moustafa Group (TMG)',
    nameAr: 'مجموعة طلعت مصطفى',
    tier: 'Blue Chip',
    flagshipProjects: ['Madinaty (New Cairo)', 'Al Rehab City (New Cairo)', 'Noor City (Capital Gardens)', 'SouthMED (Mediterranean Coast)', 'Celia (New Capital)'],
    priceRangePerSqm: { min: 55_000, max: 135_000, currency: 'EGP' },
    typicalPaymentPlan: { downPaymentPercent: 10, maxYears: 12, quarterlyInstallments: true },
    maintenanceDepositPercent: 8,
    legalStatus: 'Completely sovereign legal status, self-contained civil municipalities with independent infrastructure.',
    strengths: ['Complete self-contained cities with internal transit and shopping malls', 'Longest payment facilities in Egypt (up to 10-12 years)', 'Highest rental occupancy rates across all of Greater Cairo'],
    strengthsAr: ['مدن متكاملة الخدمات مع مواصلات ومراكز تسوق خاصة', 'أطول فترات سداد مريحة في مصر حتى 10 و 12 سنة', 'أعلى نسب إشغال إيجاري دائم على مستوى القاهرة']
  },
  'Ora Developers': {
    name: 'Ora Developers (Naguib Sawiris)',
    nameAr: 'أورا ديفلوبرز (نجيب ساويرس)',
    tier: 'Blue Chip',
    flagshipProjects: ['Zed Towers (Sheikh Zayed)', 'Zed East (New Cairo)', 'Silversands (North Coast)', 'Solana (New Zayed)'],
    priceRangePerSqm: { min: 90_000, max: 230_000, currency: 'EGP' },
    typicalPaymentPlan: { downPaymentPercent: 5, maxYears: 8, quarterlyInstallments: true },
    maintenanceDepositPercent: 8,
    legalStatus: 'High-tier urban authority partnerships with bespoke architectural approvals for tower heights.',
    strengths: ['Signature 20+ storey residential park towers in Sheikh Zayed', 'Exclusive high-net-worth boutique communities', 'Fully finished units delivered to ultra-luxury standards'],
    strengthsAr: ['أبراج سكنية بإطلالة بانورامية على حديقة زايد المركزية', 'مجتمعات حصرية للنخبة والصفوة', 'تسليم كافة الوحدات بتشطيب ألترا سوبر لوكس بالتكييفات']
  },
  'Al Ahly Sabbour': {
    name: 'Al Ahly Sabbour Developments',
    nameAr: 'الأهلي صبور للتنمية العقارية',
    tier: 'Upper Tier',
    flagshipProjects: ['L\'Avenir (Mostakbal City)', 'The City of Odyssia', 'Gaia (Ras El Hekma)', 'Amwaj (Sidi Abdel Rahman)', 'Keeva (6th of October)'],
    priceRangePerSqm: { min: 50_000, max: 125_000, currency: 'EGP' },
    typicalPaymentPlan: { downPaymentPercent: 5, maxYears: 9, quarterlyInstallments: true },
    maintenanceDepositPercent: 8,
    legalStatus: 'Longest private engineering lineage in Egypt with state bank partnership (National Bank of Egypt).',
    strengths: ['Pioneering presence in Mostakbal City', 'Reliable engineering delivery through Sabbour Consulting', 'Competitive pricing with high capital appreciation potential'],
    strengthsAr: ['ريادة التواجد في مستقبل سيتي وبدايات التجمع', 'جودة هندسية استشارية عريقة بإشراف مكتب صبور', 'أسعار تنافسية بهامش ربح ونمو رأسمالي واعد']
  }
};

export const PRIME_HUBS = {
  'New Cairo': {
    name: 'New Cairo & Mostakbal City',
    nameAr: 'القاهرة الجديدة ومدينة المستقبل',
    subHubs: ['Golden Square (المربع الذهبي)', 'Fifth Settlement (التجمع الخامس)', 'Beit El Watan (بيت الوطن)', 'South 90th & North 90th (التسعين الجنوبي والشمالي)', 'Mostakbal City (مدينة المستقبل)'],
    avgPricePerSqmPrimary: 95_000,
    avgPricePerSqmResale: 65_000,
    annualRentalYield: 8.5,
    annualCapitalGrowth: 20.0,
    dynamics: 'Core commercial and educational artery of Greater Cairo with AUC, GUC, and multinational headquarters. Golden Square commands the highest premium for ready-to-move units.'
  },
  'Sheikh Zayed & 6th of October': {
    name: 'Sheikh Zayed & 6th of October',
    nameAr: 'الشيخ زايد و 6 أكتوبر',
    subHubs: ['Central Zayed (زايد القديمة)', 'New Zayed / Green Belt (زايد الجديدة)', 'Dahshur Link (وصلة دهشور)', 'October Gardens (حدائق أكتوبر)', 'Westown (غرب القاهرة)'],
    avgPricePerSqmPrimary: 85_000,
    avgPricePerSqmResale: 55_000,
    annualRentalYield: 8.0,
    annualCapitalGrowth: 19.0,
    dynamics: 'The Western luxury epicenter with high expat community presence, Arkan Plaza, Mall of Arabia, and seamless connection via 26th July Corridor and Rod El Farag Axis.'
  },
  'North Coast (Sahel)': {
    name: 'North Coast (Sahel) & Ras El Hekma',
    nameAr: 'الساحل الشمالي ورأس الحكمة',
    subHubs: ['Ras El Hekma (رأس الحكمة - صفقة الـ 35 مليار دولار)', 'Sidi Abdel Rahman (سيدي عبد الرحمن)', 'New Alamein City (العلمين الجديدة)', 'Sidi Heneish (سيدي حنيش)'],
    avgPricePerSqmPrimary: 140_000,
    avgPricePerSqmResale: 85_000,
    annualRentalYield: 14.0, // High summer seasonal yield
    annualCapitalGrowth: 24.0,
    dynamics: 'Global tourist hotspot bolstered by the UAE ADQ $35B master development at Ras El Hekma. Premium chalets and beachfront villas yield 12-16% during the 12-week summer surge.'
  },
  'New Administrative Capital': {
    name: 'New Administrative Capital',
    nameAr: 'العاصمة الإدارية الجديدة',
    subHubs: ['R7 & R8 Residential Districts (الحي السكني R7 و R8)', 'Central Business District - CBD & Iconic Tower (منطقة الأعمال المركزية)', 'Downtown & MU23 (الداون تاون)', 'Government District & Green River (الحي الحكومي والنهر الأخضر)'],
    avgPricePerSqmPrimary: 58_000,
    avgPricePerSqmResale: 38_000,
    annualRentalYield: 11.5, // Driven by commercial and corporate offices
    annualCapitalGrowth: 22.0,
    dynamics: 'Seat of government and ministerial headquarters. Highest commercial office and retail yields (11-14%), with long-term capital upside linked to monorail and high-speed rail completion.'
  }
};

/**
 * Backwards-compatible district benchmarks mapped to both English and Arabic keys.
 * Preserves exact numerical values required by existing test suites (e.g. tests/tier1-features/real-estate-advisor.test.tsx).
 */
export const DISTRICT_BENCHMARKS: Record<string, DistrictBenchmark> = {
  'New Cairo': {
    rentalYield: 8.5,
    capitalGrowth: 20,
    avgPricePerSqmPrimary: 95_000,
    avgPricePerSqmResale: 65_000,
    minPricePerSqm: 45_000,
    maxPricePerSqm: 180_000,
    subHubs: ['Golden Square', 'Fifth Settlement', 'Beit El Watan', 'South 90th', 'Mostakbal City'],
    subHubsAr: ['المربع الذهبي', 'التجمع الخامس', 'بيت الوطن', 'التسعين الجنوبي', 'مدينة المستقبل'],
    typicalDownPayment: 10,
    typicalInstallmentYears: 8,
    maintenanceDepositRate: 8,
    legalStatusSummary: 'Ministerial decrees and NUCA allocated registered deeds.',
    legalStatusSummaryAr: 'قرارات وزارية وتراخيص هيئة المجتمعات العمرانية قابلة للتسجيل الفوري.'
  },
  'التجمع': {
    rentalYield: 8.5,
    capitalGrowth: 20,
    avgPricePerSqmPrimary: 95_000,
    avgPricePerSqmResale: 65_000,
    minPricePerSqm: 45_000,
    maxPricePerSqm: 180_000,
    subHubs: ['Golden Square', 'Fifth Settlement', 'Beit El Watan', 'South 90th', 'Mostakbal City'],
    subHubsAr: ['المربع الذهبي', 'التجمع الخامس', 'بيت الوطن', 'التسعين الجنوبي', 'مدينة المستقبل'],
    typicalDownPayment: 10,
    typicalInstallmentYears: 8,
    maintenanceDepositRate: 8,
    legalStatusSummary: 'Ministerial decrees and NUCA allocated registered deeds.',
    legalStatusSummaryAr: 'قرارات وزارية وتراخيص هيئة المجتمعات العمرانية قابلة للتسجيل الفوري.'
  },
  'التجمع الخامس': {
    rentalYield: 8.5,
    capitalGrowth: 20,
    avgPricePerSqmPrimary: 95_000,
    avgPricePerSqmResale: 65_000,
    minPricePerSqm: 45_000,
    maxPricePerSqm: 180_000,
    subHubs: ['Golden Square', 'Fifth Settlement', 'Beit El Watan', 'South 90th'],
    subHubsAr: ['المربع الذهبي', 'التجمع الخامس', 'بيت الوطن', 'التسعين الجنوبي'],
    typicalDownPayment: 10,
    typicalInstallmentYears: 8,
    maintenanceDepositRate: 8,
    legalStatusSummary: 'Ministerial decrees and NUCA allocated registered deeds.',
    legalStatusSummaryAr: 'قرارات وزارية وتراخيص هيئة المجتمعات العمرانية قابلة للتسجيل الفوري.'
  },
  'القاهرة الجديدة': {
    rentalYield: 8.5,
    capitalGrowth: 20,
    avgPricePerSqmPrimary: 95_000,
    avgPricePerSqmResale: 65_000,
    minPricePerSqm: 45_000,
    maxPricePerSqm: 180_000,
    subHubs: ['Golden Square', 'Fifth Settlement', 'Beit El Watan', 'Mostakbal City'],
    subHubsAr: ['المربع الذهبي', 'التجمع الخامس', 'بيت الوطن', 'مدينة المستقبل'],
    typicalDownPayment: 10,
    typicalInstallmentYears: 8,
    maintenanceDepositRate: 8,
    legalStatusSummary: 'Ministerial decrees and NUCA allocated registered deeds.',
    legalStatusSummaryAr: 'قرارات وزارية وتراخيص هيئة المجتمعات العمرانية قابلة للتسجيل الفوري.'
  },
  'Sheikh Zayed': {
    rentalYield: 8.0,
    capitalGrowth: 19,
    avgPricePerSqmPrimary: 85_000,
    avgPricePerSqmResale: 58_000,
    minPricePerSqm: 42_000,
    maxPricePerSqm: 210_000,
    subHubs: ['Central Zayed', 'New Zayed', 'Dahshur Link', 'Westown'],
    subHubsAr: ['زايد المركزية', 'زايد الجديدة', 'وصلة دهشور', 'ويست تاون'],
    typicalDownPayment: 10,
    typicalInstallmentYears: 8,
    maintenanceDepositRate: 8,
    legalStatusSummary: 'High percentage of fully registered deeds (شهر عقاري) in Central Zayed.',
    legalStatusSummaryAr: 'نسبة عالية من العقارات مسجلة شهر عقاري بزايد المركزية وقرارات وزارية بزايد الجديدة.'
  },
  'الشيخ زايد': {
    rentalYield: 8.0,
    capitalGrowth: 19,
    avgPricePerSqmPrimary: 85_000,
    avgPricePerSqmResale: 58_000,
    minPricePerSqm: 42_000,
    maxPricePerSqm: 210_000,
    subHubs: ['Central Zayed', 'New Zayed', 'Dahshur Link', 'Westown'],
    subHubsAr: ['زايد المركزية', 'زايد الجديدة', 'وصلة دهشور', 'ويست تاون'],
    typicalDownPayment: 10,
    typicalInstallmentYears: 8,
    maintenanceDepositRate: 8,
    legalStatusSummary: 'High percentage of fully registered deeds (شهر عقاري) in Central Zayed.',
    legalStatusSummaryAr: 'نسبة عالية من العقارات مسجلة شهر عقاري بزايد المركزية وقرارات وزارية بزايد الجديدة.'
  },
  '6th of October': {
    rentalYield: 7.5,
    capitalGrowth: 18,
    avgPricePerSqmPrimary: 62_000,
    avgPricePerSqmResale: 42_000,
    minPricePerSqm: 28_000,
    maxPricePerSqm: 110_000,
    subHubs: ['October Gardens', 'Northern Expansions', 'Chillout Area', 'South Oasis'],
    subHubsAr: ['حدائق أكتوبر', 'التوسعات الشمالية', 'منطقة النوادي', 'جنوب الواحات'],
    typicalDownPayment: 10,
    typicalInstallmentYears: 8,
    maintenanceDepositRate: 8,
    legalStatusSummary: 'Mixed registration; secondary market often relies on court validity.',
    legalStatusSummaryAr: 'متنوع؛ إعادة البيع تتطلب التحقق من صحة ونفاذ أو خطاب مخالصة الجهاز.'
  },
  'أكتوبر': {
    rentalYield: 7.5,
    capitalGrowth: 18,
    avgPricePerSqmPrimary: 62_000,
    avgPricePerSqmResale: 42_000,
    minPricePerSqm: 28_000,
    maxPricePerSqm: 110_000,
    subHubs: ['October Gardens', 'Northern Expansions', 'Chillout Area'],
    subHubsAr: ['حدائق أكتوبر', 'التوسعات الشمالية', 'منطقة النوادي'],
    typicalDownPayment: 10,
    typicalInstallmentYears: 8,
    maintenanceDepositRate: 8,
    legalStatusSummary: 'Mixed registration; secondary market often relies on court validity.',
    legalStatusSummaryAr: 'متنوع؛ إعادة البيع تتطلب التحقق من صحة ونفاذ أو خطاب مخالصة الجهاز.'
  },
  'North Coast': {
    rentalYield: 14.0,
    capitalGrowth: 24,
    avgPricePerSqmPrimary: 140_000,
    avgPricePerSqmResale: 85_000,
    minPricePerSqm: 60_000,
    maxPricePerSqm: 280_000,
    subHubs: ['Ras El Hekma', 'Sidi Abdel Rahman', 'New Alamein', 'Sidi Heneish'],
    subHubsAr: ['رأس الحكمة', 'سيدي عبد الرحمن', 'العلمين الجديدة', 'سيدي حنيش'],
    typicalDownPayment: 10,
    typicalInstallmentYears: 7,
    maintenanceDepositRate: 10,
    legalStatusSummary: 'Supervised by Urban Communities and Ministry of Tourism; international investment zone.',
    legalStatusSummaryAr: 'إشراف مباشر من هيئة المجتمعات العمرانية والتنمية السياحية، ومنطقة استثمار دولي كبرى.'
  },
  'الساحل': {
    rentalYield: 14.0,
    capitalGrowth: 24,
    avgPricePerSqmPrimary: 140_000,
    avgPricePerSqmResale: 85_000,
    minPricePerSqm: 60_000,
    maxPricePerSqm: 280_000,
    subHubs: ['Ras El Hekma', 'Sidi Abdel Rahman', 'New Alamein'],
    subHubsAr: ['رأس الحكمة', 'سيدي عبد الرحمن', 'العلمين الجديدة'],
    typicalDownPayment: 10,
    typicalInstallmentYears: 7,
    maintenanceDepositRate: 10,
    legalStatusSummary: 'Supervised by Urban Communities and Ministry of Tourism.',
    legalStatusSummaryAr: 'إشراف مباشر من هيئة المجتمعات العمرانية والتنمية السياحية.'
  },
  'الساحل الشمالي': {
    rentalYield: 14.0,
    capitalGrowth: 24,
    avgPricePerSqmPrimary: 140_000,
    avgPricePerSqmResale: 85_000,
    minPricePerSqm: 60_000,
    maxPricePerSqm: 280_000,
    subHubs: ['Ras El Hekma', 'Sidi Abdel Rahman', 'New Alamein'],
    subHubsAr: ['رأس الحكمة', 'سيدي عبد الرحمن', 'العلمين الجديدة'],
    typicalDownPayment: 10,
    typicalInstallmentYears: 7,
    maintenanceDepositRate: 10,
    legalStatusSummary: 'Supervised by Urban Communities and Ministry of Tourism.',
    legalStatusSummaryAr: 'إشراف مباشر من هيئة المجتمعات العمرانية والتنمية السياحية.'
  },
  'New Capital': {
    rentalYield: 11.5,
    capitalGrowth: 22,
    avgPricePerSqmPrimary: 58_000,
    avgPricePerSqmResale: 38_000,
    minPricePerSqm: 32_000,
    maxPricePerSqm: 145_000,
    subHubs: ['R7', 'R8', 'CBD Iconic Tower', 'Downtown', 'Government Quarter'],
    subHubsAr: ['الحي السكني R7', 'الحي السكني R8', 'منطقة الأعمال المركزية CBD', 'الداون تاون', 'الحي الحكومي'],
    typicalDownPayment: 10,
    typicalInstallmentYears: 10,
    maintenanceDepositRate: 8,
    legalStatusSummary: 'Governed by ACUD (Administrative Capital for Urban Development); guaranteed contracts.',
    legalStatusSummaryAr: 'خاضع لشركة العاصمة الإدارية للتنمية العمرانية (ACUD) وعقود ثلاثية موثقة رسمياً.'
  },
  'العاصمة الإدارية': {
    rentalYield: 11.5,
    capitalGrowth: 22,
    avgPricePerSqmPrimary: 58_000,
    avgPricePerSqmResale: 38_000,
    minPricePerSqm: 32_000,
    maxPricePerSqm: 145_000,
    subHubs: ['R7', 'R8', 'CBD', 'Downtown'],
    subHubsAr: ['الحي السكني R7', 'الحي السكني R8', 'منطقة الأعمال المركزية', 'الداون تاون'],
    typicalDownPayment: 10,
    typicalInstallmentYears: 10,
    maintenanceDepositRate: 8,
    legalStatusSummary: 'Governed by ACUD; guaranteed contracts.',
    legalStatusSummaryAr: 'خاضع لشركة العاصمة الإدارية للتنمية العمرانية (ACUD).'
  },
  'Maadi': {
    rentalYield: 7.5,
    capitalGrowth: 16,
    avgPricePerSqmPrimary: 45_000,
    avgPricePerSqmResale: 35_000,
    minPricePerSqm: 25_000,
    maxPricePerSqm: 90_000,
    subHubs: ['Degla', 'Sarayat Maadi', 'Zahraa Maadi', 'Corniche'],
    subHubsAr: ['دجلة', 'سرايات المعادي', 'زهراء المعادي', 'الكورنيش'],
    typicalDownPayment: 25,
    typicalInstallmentYears: 3,
    maintenanceDepositRate: 5,
    legalStatusSummary: 'High prevalence of fully registered heritage and modern titles in الشهر العقاري.',
    legalStatusSummaryAr: 'أغلبية الوحدات مسجلة شهر عقاري نهائي وخاصة بالسرايات ودجلة.'
  },
  'المعادي': {
    rentalYield: 7.5,
    capitalGrowth: 16,
    avgPricePerSqmPrimary: 45_000,
    avgPricePerSqmResale: 35_000,
    minPricePerSqm: 25_000,
    maxPricePerSqm: 90_000,
    subHubs: ['Degla', 'Sarayat Maadi', 'Zahraa Maadi'],
    subHubsAr: ['دجلة', 'سرايات المعادي', 'زهراء المعادي'],
    typicalDownPayment: 25,
    typicalInstallmentYears: 3,
    maintenanceDepositRate: 5,
    legalStatusSummary: 'High prevalence of fully registered heritage and modern titles.',
    legalStatusSummaryAr: 'أغلبية الوحدات مسجلة شهر عقاري نهائي وخاصة بالسرايات ودجلة.'
  },
  'Shorouk': {
    rentalYield: 8.0,
    capitalGrowth: 18,
    avgPricePerSqmPrimary: 42_000,
    avgPricePerSqmResale: 30_000,
    minPricePerSqm: 22_000,
    maxPricePerSqm: 75_000,
    subHubs: ['Shorouk City Center', 'Nakhil', 'Youth District'],
    subHubsAr: ['مركز المدينة بالشروق', 'حي النخيل', 'إسكان الشباب'],
    typicalDownPayment: 15,
    typicalInstallmentYears: 6,
    maintenanceDepositRate: 7,
    legalStatusSummary: 'Urban development authority registered allocations.',
    legalStatusSummaryAr: 'تخصيصات مسجلة بجهاز مدينة الشروق.'
  },
  'الشروق': {
    rentalYield: 8.0,
    capitalGrowth: 18,
    avgPricePerSqmPrimary: 42_000,
    avgPricePerSqmResale: 30_000,
    minPricePerSqm: 22_000,
    maxPricePerSqm: 75_000,
    subHubs: ['Shorouk City Center', 'Nakhil'],
    subHubsAr: ['مركز المدينة بالشروق', 'حي النخيل'],
    typicalDownPayment: 15,
    typicalInstallmentYears: 6,
    maintenanceDepositRate: 7,
    legalStatusSummary: 'Urban development authority registered allocations.',
    legalStatusSummaryAr: 'تخصيصات مسجلة بجهاز مدينة الشروق.'
  },
  'Default': {
    rentalYield: 8.0,
    capitalGrowth: 19,
    avgPricePerSqmPrimary: 70_000,
    avgPricePerSqmResale: 48_000,
    minPricePerSqm: 30_000,
    maxPricePerSqm: 150_000,
    subHubs: ['Prime Corridors'],
    subHubsAr: ['المحاور الرئيسية'],
    typicalDownPayment: 10,
    typicalInstallmentYears: 8,
    maintenanceDepositRate: 8,
    legalStatusSummary: 'Standard Egyptian property legal due diligence applies.',
    legalStatusSummaryAr: 'تنطبق معايير الفحص القانوني والتسجيل العقاري المعتادة.'
  }
};


export const EGYPTIAN_DEVELOPERS = Object.entries(TOP_DEVELOPERS).map(([id, dev]) => ({
  id,
  ...dev,
  avgAnnualAppreciation: 22
}));

export const PRIME_GROWTH_HUBS = Object.entries(PRIME_HUBS).map(([id, hub]) => ({
  id,
  ...hub,
  expectedRentalYield: (DISTRICT_BENCHMARKS[id] || DISTRICT_BENCHMARKS['Default']).rentalYield
}));

export interface FinancialPlanInput {
  budget: number;
  downPayment: number;
  monthlyCapacity: number;
  targetDistrict?: string;
  horizonYears?: number;
}

export function calculateFinancialPlan({
  budget,
  downPayment,
  monthlyCapacity,
  targetDistrict = 'Default',
  horizonYears = 5
}: FinancialPlanInput) {
  const benchmark = DISTRICT_BENCHMARKS[targetDistrict] || DISTRICT_BENCHMARKS['Default'];
  const annualRentalYieldPercent = benchmark.rentalYield;
  const annualCapitalGrowthPercent = benchmark.capitalGrowth;

  const annualRentalYieldEgp = Math.round(budget * (annualRentalYieldPercent / 100));
  const estimatedCapitalGrowthEgp = Math.round(budget * Math.pow(1 + annualCapitalGrowthPercent / 100, horizonYears) - budget);
  const netTotalReturnEgp = Math.round(annualRentalYieldEgp * horizonYears + estimatedCapitalGrowthEgp);
  const paybackYears = annualRentalYieldEgp > 0 ? Number((budget / annualRentalYieldEgp).toFixed(1)) : 12;

  const recommendedDevelopers = Object.values(TOP_DEVELOPERS)
    .filter(d => d.tier === 'Blue Chip')
    .slice(0, 3)
    .map(d => d.name);

  return {
    annualRentalYieldEgp,
    estimatedCapitalGrowthEgp,
    netTotalReturnEgp,
    paybackYears,
    recommendedDevelopers,
    benchmark
  };
}
