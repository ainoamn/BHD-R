/**
 * Off-plan / development projects catalogue (adapted from Ain Oman development.projects.json).
 * Branded for BHD R — seed until Neon project entities ship.
 */

export type ProjectStatus = 'planned' | 'selling' | 'delivered';
export type ProjectUnitStatus = 'available' | 'reserved' | 'sold';

export type DevelopmentUnit = {
  id: string;
  typeAr: string;
  typeEn: string;
  area: number;
  bedrooms?: number;
  bathrooms?: number;
  priceOmr: number;
  status: ProjectUnitStatus;
};

export type DevelopmentMilestone = {
  id: string;
  nameAr: string;
  nameEn: string;
  dueAt: string;
  progress: number;
};

export type DevelopmentPaymentPlan = {
  id: string;
  nameAr: string;
  nameEn: string;
  schedule: { labelAr: string; labelEn: string; pct: number }[];
};

export type DevelopmentProject = {
  id: string;
  titleAr: string;
  titleEn: string;
  cityAr: string;
  cityEn: string;
  status: ProjectStatus;
  deliveryDate: string;
  descriptionAr: string;
  descriptionEn: string;
  amenitiesAr: string[];
  amenitiesEn: string[];
  developerNameAr: string;
  developerNameEn: string;
  coverGradient: string;
  paymentPlans: DevelopmentPaymentPlan[];
  milestones: DevelopmentMilestone[];
  units: DevelopmentUnit[];
};

export const DEVELOPMENT_PROJECTS: DevelopmentProject[] = [
  {
    id: 'prj-alfursan',
    titleAr: 'مجمع الفرسان السكني',
    titleEn: 'Al Fursan Residential Complex',
    cityAr: 'مسقط — الخوض',
    cityEn: 'Muscat — Al Khoud',
    status: 'selling',
    deliveryDate: '2026-03-31',
    descriptionAr:
      'مجمع سكني عائلي متكامل الخدمات قرب جامعة السلطان قابوس. حدائق وممشى ونادٍ صحي.',
    descriptionEn:
      'Family residential complex near SQU with gardens, a promenade and a wellness club.',
    amenitiesAr: ['مسبح', 'نادي رياضي', 'حديقة', 'أمن 24/7', 'مواقف مظللة'],
    amenitiesEn: ['Pool', 'Gym', 'Garden', '24/7 security', 'Shaded parking'],
    developerNameAr: 'بن حمود للتطوير',
    developerNameEn: 'Bin Hamood Development',
    coverGradient: 'linear-gradient(135deg, #0b5f5c 0%, #08a39f 55%, #c4a35a 100%)',
    paymentPlans: [
      {
        id: 'pp-alf-1',
        nameAr: 'خطة 30/70',
        nameEn: '30/70 plan',
        schedule: [
          { labelAr: 'حجز', labelEn: 'Reservation', pct: 10 },
          { labelAr: 'عند توقيع العقد', labelEn: 'On contract', pct: 20 },
          { labelAr: 'عند التسليم', labelEn: 'On handover', pct: 70 },
        ],
      },
    ],
    milestones: [
      { id: 'ms-1', nameAr: 'الأساسات', nameEn: 'Foundations', dueAt: '2025-01-31', progress: 100 },
      { id: 'ms-2', nameAr: 'الهيكل', nameEn: 'Structure', dueAt: '2025-08-31', progress: 70 },
      { id: 'ms-3', nameAr: 'التشطيبات', nameEn: 'Finishes', dueAt: '2026-02-28', progress: 20 },
    ],
    units: [
      {
        id: 'u-alf-101',
        typeAr: 'شقة 2 غرف',
        typeEn: '2-bed apartment',
        area: 115,
        bedrooms: 2,
        bathrooms: 2,
        priceOmr: 52000,
        status: 'available',
      },
      {
        id: 'u-alf-102',
        typeAr: 'شقة 3 غرف',
        typeEn: '3-bed apartment',
        area: 145,
        bedrooms: 3,
        bathrooms: 3,
        priceOmr: 68000,
        status: 'reserved',
      },
      {
        id: 'u-alf-201',
        typeAr: 'شقة 1 غرفة',
        typeEn: '1-bed apartment',
        area: 80,
        bedrooms: 1,
        bathrooms: 1,
        priceOmr: 39000,
        status: 'sold',
      },
    ],
  },
  {
    id: 'prj-albahr',
    titleAr: 'أبراج البحر الفاخرة',
    titleEn: 'Al Bahr Luxury Towers',
    cityAr: 'مسقط — القرم',
    cityEn: 'Muscat — Qurum',
    status: 'selling',
    deliveryDate: '2027-06-30',
    descriptionAr: 'أبراج بإطلالة بحرية مباشرة، شقق مخدومة ومرافق راقية.',
    descriptionEn: 'Seafront towers with serviced apartments and premium amenities.',
    amenitiesAr: ['إطلالة بحرية', 'سبا', 'مطاعم', 'مواقف ضيوف'],
    amenitiesEn: ['Sea view', 'Spa', 'Restaurants', 'Guest parking'],
    developerNameAr: 'بن حمود للتطوير',
    developerNameEn: 'Bin Hamood Development',
    coverGradient: 'linear-gradient(135deg, #092d24 0%, #1a6b8a 60%, #08a39f 100%)',
    paymentPlans: [
      {
        id: 'pp-sea-1',
        nameAr: 'خطة 10/20/70',
        nameEn: '10/20/70 plan',
        schedule: [
          { labelAr: 'حجز', labelEn: 'Reservation', pct: 10 },
          { labelAr: 'بعد 6 أشهر', labelEn: 'After 6 months', pct: 20 },
          { labelAr: 'التسليم', labelEn: 'Handover', pct: 70 },
        ],
      },
    ],
    milestones: [
      {
        id: 'ms-sea-1',
        nameAr: 'تصاريح وبنية تحتية',
        nameEn: 'Permits & infrastructure',
        dueAt: '2025-12-31',
        progress: 60,
      },
      {
        id: 'ms-sea-2',
        nameAr: 'الهيكل العلوي',
        nameEn: 'Superstructure',
        dueAt: '2026-11-30',
        progress: 25,
      },
    ],
    units: [
      {
        id: 'u-sea-ph1',
        typeAr: 'بنتهاوس 4 غرف',
        typeEn: '4-bed penthouse',
        area: 320,
        bedrooms: 4,
        bathrooms: 5,
        priceOmr: 320000,
        status: 'available',
      },
      {
        id: 'u-sea-1203',
        typeAr: 'شقة 2 غرف',
        typeEn: '2-bed apartment',
        area: 130,
        bedrooms: 2,
        bathrooms: 2,
        priceOmr: 120000,
        status: 'available',
      },
    ],
  },
  {
    id: 'prj-alnakhil',
    titleAr: 'مساكن النخيل',
    titleEn: 'Al Nakhil Residences',
    cityAr: 'صحار',
    cityEn: 'Sohar',
    status: 'planned',
    deliveryDate: '2026-12-31',
    descriptionAr: 'حي سكني متوسط الكثافة مع تاون هاوس وحدائق ومدارس قريبة.',
    descriptionEn: 'Mid-density neighbourhood with townhouses, gardens and nearby schools.',
    amenitiesAr: ['مدرسة قريبة', 'مسجد', 'حدائق', 'مضامير جري'],
    amenitiesEn: ['Nearby school', 'Mosque', 'Gardens', 'Jogging tracks'],
    developerNameAr: 'بن حمود للتطوير',
    developerNameEn: 'Bin Hamood Development',
    coverGradient: 'linear-gradient(135deg, #1e4d3a 0%, #3d8b6e 55%, #c4a35a 100%)',
    paymentPlans: [
      {
        id: 'pp-nkh-1',
        nameAr: 'خطة 20/80',
        nameEn: '20/80 plan',
        schedule: [
          { labelAr: 'حجز', labelEn: 'Reservation', pct: 20 },
          { labelAr: 'التسليم', labelEn: 'Handover', pct: 80 },
        ],
      },
    ],
    milestones: [
      {
        id: 'ms-nkh-1',
        nameAr: 'تصميم تفصيلي',
        nameEn: 'Detailed design',
        dueAt: '2025-10-31',
        progress: 40,
      },
    ],
    units: [
      {
        id: 'u-nkh-t1',
        typeAr: 'تاون هاوس 3 غرف',
        typeEn: '3-bed townhouse',
        area: 180,
        bedrooms: 3,
        bathrooms: 3,
        priceOmr: 78000,
        status: 'available',
      },
      {
        id: 'u-nkh-v1',
        typeAr: 'فيلا مستقلة 4 غرف',
        typeEn: '4-bed villa',
        area: 280,
        bedrooms: 4,
        bathrooms: 5,
        priceOmr: 155000,
        status: 'available',
      },
    ],
  },
  {
    id: 'prj-downtown',
    titleAr: 'وسط المدينة للأعمال',
    titleEn: 'Downtown Business Hub',
    cityAr: 'مسقط — روي',
    cityEn: 'Muscat — Ruwi',
    status: 'delivered',
    deliveryDate: '2024-11-30',
    descriptionAr: 'مكاتب حديثة مع مساحات عمل مشتركة وقاعات اجتماعات.',
    descriptionEn: 'Modern offices with coworking spaces and meeting rooms.',
    amenitiesAr: ['قاعات اجتماعات', 'مواقف متعددة', 'خدمات تقنية'],
    amenitiesEn: ['Meeting rooms', 'Multi-level parking', 'Tech services'],
    developerNameAr: 'بن حمود للتطوير',
    developerNameEn: 'Bin Hamood Development',
    coverGradient: 'linear-gradient(135deg, #243447 0%, #4a6fa5 60%, #08a39f 100%)',
    paymentPlans: [],
    milestones: [
      {
        id: 'ms-dtn-1',
        nameAr: 'التسليم النهائي',
        nameEn: 'Final handover',
        dueAt: '2024-11-30',
        progress: 100,
      },
    ],
    units: [
      {
        id: 'u-dtn-5a',
        typeAr: 'مكتب 85م²',
        typeEn: 'Office 85 m²',
        area: 85,
        priceOmr: 52000,
        status: 'sold',
      },
      {
        id: 'u-dtn-9c',
        typeAr: 'مكتب 120م²',
        typeEn: 'Office 120 m²',
        area: 120,
        priceOmr: 78000,
        status: 'sold',
      },
    ],
  },
  {
    id: 'prj-alrawda',
    titleAr: 'روضة التلال',
    titleEn: 'Al Rawda Hills',
    cityAr: 'نزوى',
    cityEn: 'Nizwa',
    status: 'selling',
    deliveryDate: '2026-09-30',
    descriptionAr: 'فلل عائلية بإطلالات جبلية هادئة وتشطيبات فاخرة.',
    descriptionEn: 'Family villas with calm mountain views and premium finishes.',
    amenitiesAr: ['مسبح عائلي', 'مركز مجتمعي', 'مسارات دراجات'],
    amenitiesEn: ['Family pool', 'Community centre', 'Bike trails'],
    developerNameAr: 'بن حمود للتطوير',
    developerNameEn: 'Bin Hamood Development',
    coverGradient: 'linear-gradient(135deg, #5c4033 0%, #8b6b4a 50%, #c4a35a 100%)',
    paymentPlans: [
      {
        id: 'pp-rwd-1',
        nameAr: 'خطة 5/45/50',
        nameEn: '5/45/50 plan',
        schedule: [
          { labelAr: 'حجز', labelEn: 'Reservation', pct: 5 },
          { labelAr: 'دفعات أثناء التنفيذ', labelEn: 'During construction', pct: 45 },
          { labelAr: 'التسليم', labelEn: 'Handover', pct: 50 },
        ],
      },
    ],
    milestones: [
      {
        id: 'ms-rwd-1',
        nameAr: 'تمهيد الموقع',
        nameEn: 'Site prep',
        dueAt: '2025-05-31',
        progress: 100,
      },
      {
        id: 'ms-rwd-2',
        nameAr: 'أعمال إنشائية',
        nameEn: 'Construction',
        dueAt: '2025-12-31',
        progress: 50,
      },
    ],
    units: [
      {
        id: 'u-rwd-v101',
        typeAr: 'فيلا 4 غرف',
        typeEn: '4-bed villa',
        area: 300,
        bedrooms: 4,
        bathrooms: 5,
        priceOmr: 165000,
        status: 'available',
      },
      {
        id: 'u-rwd-v102',
        typeAr: 'فيلا 5 غرف',
        typeEn: '5-bed villa',
        area: 360,
        bedrooms: 5,
        bathrooms: 6,
        priceOmr: 189000,
        status: 'available',
      },
    ],
  },
];

export function getDevelopmentProject(id: string): DevelopmentProject | null {
  return DEVELOPMENT_PROJECTS.find((p) => p.id === id) ?? null;
}

export function projectStatusLabel(status: ProjectStatus, ar: boolean): string {
  if (status === 'planned') return ar ? 'مخطط' : 'Planned';
  if (status === 'selling') return ar ? 'للبيع' : 'Selling';
  return ar ? 'مُسلَّم' : 'Delivered';
}

export function unitStatusLabel(status: ProjectUnitStatus, ar: boolean): string {
  if (status === 'available') return ar ? 'متاح' : 'Available';
  if (status === 'reserved') return ar ? 'محجوز' : 'Reserved';
  return ar ? 'مباع' : 'Sold';
}
