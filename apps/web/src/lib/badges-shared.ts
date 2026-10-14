export const BADGE_SUBJECTS = ['property', 'owner', 'tenant', 'staff', 'worker'] as const;
export type BadgeSubject = (typeof BADGE_SUBJECTS)[number];

export const BADGE_TIERS = ['badge', 'shield', 'certificate', 'medal'] as const;
export type BadgeTier = (typeof BADGE_TIERS)[number];

export const BADGE_LEVELS = ['bronze', 'silver', 'gold', 'platinum', 'diamond'] as const;
export type BadgeLevel = (typeof BADGE_LEVELS)[number];

export const BADGE_GRANT_MODES = ['auto', 'approval', 'manual'] as const;
export type BadgeGrantMode = (typeof BADGE_GRANT_MODES)[number];

export const BADGE_ICONS = [
  'star',
  'crown',
  'shield',
  'bolt',
  'check',
  'heart',
  'clock',
  'wrench',
  'home',
  'key',
  'trophy',
  'leaf',
  'handshake',
  'gem',
  'rocket',
  'calendar',
] as const;
export type BadgeIcon = (typeof BADGE_ICONS)[number];

export type AwardStatus = 'pending' | 'active' | 'expired' | 'revoked' | 'rejected';

export const SUBJECT_LABELS: Record<BadgeSubject, { ar: string; en: string; arMany: string }> = {
  property: { ar: 'المبنى / العقار', en: 'Property', arMany: 'شارات المباني' },
  owner: { ar: 'المالك', en: 'Owner', arMany: 'شارات الملاك' },
  tenant: { ar: 'المستأجر', en: 'Tenant', arMany: 'شارات المستأجرين' },
  staff: { ar: 'الموظف', en: 'Staff', arMany: 'شارات الموظفين' },
  worker: { ar: 'العامل / المقاول', en: 'Worker', arMany: 'شارات العمال' },
};

export const TIER_LABELS: Record<BadgeTier, { ar: string; en: string }> = {
  badge: { ar: 'شارة', en: 'Badge' },
  shield: { ar: 'درع', en: 'Shield' },
  certificate: { ar: 'شهادة', en: 'Certificate' },
  medal: { ar: 'وسام', en: 'Medal' },
};

export const LEVEL_LABELS: Record<BadgeLevel, { ar: string; en: string }> = {
  bronze: { ar: 'برونزي', en: 'Bronze' },
  silver: { ar: 'فضي', en: 'Silver' },
  gold: { ar: 'ذهبي', en: 'Gold' },
  platinum: { ar: 'بلاتيني', en: 'Platinum' },
  diamond: { ar: 'ماسي', en: 'Diamond' },
};

export const GRANT_LABELS: Record<BadgeGrantMode, { ar: string; en: string }> = {
  auto: { ar: 'تلقائي عند تحقق الشروط', en: 'Automatic when criteria hold' },
  approval: { ar: 'يقترحه النظام ويعتمده المالك', en: 'Proposed, then approved' },
  manual: { ar: 'يُمنح يدوياً فقط', en: 'Granted by hand only' },
};

export const AWARD_STATUS_LABELS: Record<AwardStatus, { ar: string; en: string }> = {
  pending: { ar: 'بانتظار الاعتماد', en: 'Awaiting approval' },
  active: { ar: 'سارية', en: 'Active' },
  expired: { ar: 'منتهية', en: 'Expired' },
  revoked: { ar: 'مسحوبة', en: 'Revoked' },
  rejected: { ar: 'مرفوضة', en: 'Rejected' },
};

export type MetricUnit = 'rating' | 'percent' | 'count' | 'days' | 'months' | 'flag';

export type MetricInfo = {
  subjects: readonly BadgeSubject[];
  ar: string;
  en: string;
  unit: MetricUnit;
  /** Whether a larger value is the better one; drives the default comparison. */
  higherIsBetter: boolean;
  /** Measured over the badge's window (otherwise a current snapshot). */
  windowed: boolean;
};

export const BADGE_METRICS = {
  verified: {
    subjects: ['owner', 'tenant', 'staff', 'worker'],
    ar: 'حساب موثّق',
    en: 'Verified account',
    unit: 'flag',
    higherIsBetter: true,
    windowed: false,
  },
  owner_verified: {
    subjects: ['property'],
    ar: 'مالكه موثّق',
    en: 'Owner verified',
    unit: 'flag',
    higherIsBetter: true,
    windowed: false,
  },
  rating_avg: {
    subjects: ['property', 'owner'],
    ar: 'متوسط التقييم (من 5)',
    en: 'Average rating (of 5)',
    unit: 'rating',
    higherIsBetter: true,
    windowed: true,
  },
  rating_count: {
    subjects: ['property', 'owner'],
    ar: 'عدد التقييمات',
    en: 'Number of ratings',
    unit: 'count',
    higherIsBetter: true,
    windowed: true,
  },
  occupancy_pct: {
    subjects: ['property', 'owner'],
    ar: 'نسبة الإشغال الحالية',
    en: 'Current occupancy',
    unit: 'percent',
    higherIsBetter: true,
    windowed: false,
  },
  open_maintenance: {
    subjects: ['property', 'owner'],
    ar: 'طلبات صيانة مفتوحة',
    en: 'Open maintenance tickets',
    unit: 'count',
    higherIsBetter: false,
    windowed: false,
  },
  maintenance_resolved: {
    subjects: ['property', 'owner'],
    ar: 'طلبات صيانة أُنجزت',
    en: 'Maintenance tickets resolved',
    unit: 'count',
    higherIsBetter: true,
    windowed: true,
  },
  resolution_days: {
    subjects: ['property', 'owner'],
    ar: 'متوسط مدة إنجاز الصيانة',
    en: 'Average resolution time',
    unit: 'days',
    higherIsBetter: false,
    windowed: true,
  },
  properties_count: {
    subjects: ['owner'],
    ar: 'عدد العقارات',
    en: 'Properties owned',
    unit: 'count',
    higherIsBetter: true,
    windowed: false,
  },
  active_months: {
    subjects: ['property'],
    ar: 'أشهر على المنصة',
    en: 'Months on the platform',
    unit: 'months',
    higherIsBetter: true,
    windowed: false,
  },
  tenure_months: {
    subjects: ['owner', 'tenant', 'staff', 'worker'],
    ar: 'مدة التعامل',
    en: 'Tenure',
    unit: 'months',
    higherIsBetter: true,
    windowed: false,
  },
  on_time_pct: {
    subjects: ['tenant', 'staff', 'worker'],
    ar: 'نسبة الالتزام بالموعد',
    en: 'On-time rate',
    unit: 'percent',
    higherIsBetter: true,
    windowed: true,
  },
  invoices_count: {
    subjects: ['tenant'],
    ar: 'فواتير مستحقة في الفترة',
    en: 'Invoices due in the period',
    unit: 'count',
    higherIsBetter: true,
    windowed: true,
  },
  overdue_count: {
    subjects: ['tenant'],
    ar: 'فواتير متأخرة الآن',
    en: 'Overdue invoices now',
    unit: 'count',
    higherIsBetter: false,
    windowed: false,
  },
  guest_rating_avg: {
    subjects: ['tenant'],
    ar: 'تقييم المضيفين له (من 5)',
    en: 'Host rating (of 5)',
    unit: 'rating',
    higherIsBetter: true,
    windowed: true,
  },
  guest_rating_count: {
    subjects: ['tenant'],
    ar: 'عدد تقييمات المضيفين',
    en: 'Host ratings',
    unit: 'count',
    higherIsBetter: true,
    windowed: true,
  },
  stays_count: {
    subjects: ['tenant'],
    ar: 'إقامات مكتملة',
    en: 'Completed stays',
    unit: 'count',
    higherIsBetter: true,
    windowed: true,
  },
  active_leases: {
    subjects: ['tenant'],
    ar: 'إيجارات سارية',
    en: 'Active leases',
    unit: 'count',
    higherIsBetter: true,
    windowed: false,
  },
  legal_cases: {
    subjects: ['tenant'],
    ar: 'قضايا ضده',
    en: 'Legal cases against',
    unit: 'count',
    higherIsBetter: false,
    windowed: true,
  },
  tasks_completed: {
    subjects: ['staff'],
    ar: 'مهام أُنجزت',
    en: 'Tasks completed',
    unit: 'count',
    higherIsBetter: true,
    windowed: true,
  },
  overdue_open: {
    subjects: ['staff'],
    ar: 'مهام متأخرة الآن',
    en: 'Overdue tasks now',
    unit: 'count',
    higherIsBetter: false,
    windowed: false,
  },
  jobs_completed: {
    subjects: ['worker'],
    ar: 'أعمال أُنجزت',
    en: 'Jobs completed',
    unit: 'count',
    higherIsBetter: true,
    windowed: true,
  },
  verified_jobs_pct: {
    subjects: ['worker'],
    ar: 'أعمال اعتُمدت جودتها',
    en: 'Jobs quality-verified',
    unit: 'percent',
    higherIsBetter: true,
    windowed: true,
  },
  cost_accuracy_pct: {
    subjects: ['worker'],
    ar: 'التزام بالتكلفة المعتمدة',
    en: 'Within approved cost',
    unit: 'percent',
    higherIsBetter: true,
    windowed: true,
  },
  vendor_rating: {
    subjects: ['worker'],
    ar: 'تقييم المقاول (من 5)',
    en: 'Vendor rating (of 5)',
    unit: 'rating',
    higherIsBetter: true,
    windowed: false,
  },
} as const satisfies Record<string, MetricInfo>;

export type MetricKey = keyof typeof BADGE_METRICS;
export const METRIC_KEYS = Object.keys(BADGE_METRICS) as MetricKey[];

export function isMetricKey(value: string): value is MetricKey {
  return Object.prototype.hasOwnProperty.call(BADGE_METRICS, value);
}

export function metricsFor(subject: BadgeSubject): MetricKey[] {
  return METRIC_KEYS.filter((key) =>
    (BADGE_METRICS[key].subjects as readonly string[]).includes(subject),
  );
}

export type MetricValues = Partial<Record<MetricKey, number | null>>;

export type BadgeCriterion = { metric: MetricKey; op: 'gte' | 'lte'; value: number };

export function criterionMet(criterion: BadgeCriterion, metrics: MetricValues): boolean {
  const actual = metrics[criterion.metric];
  if (actual === null || actual === undefined || !Number.isFinite(actual)) return false;
  return criterion.op === 'gte' ? actual >= criterion.value : actual <= criterion.value;
}

export function criteriaMet(criteria: readonly BadgeCriterion[], metrics: MetricValues): boolean {
  return criteria.length > 0 && criteria.every((criterion) => criterionMet(criterion, metrics));
}

/** How close a subject is to one criterion, 0–1, for progress bars. */
export function criterionProgress(criterion: BadgeCriterion, metrics: MetricValues): number {
  const actual = metrics[criterion.metric];
  if (actual === null || actual === undefined || !Number.isFinite(actual)) return 0;
  if (criterionMet(criterion, metrics)) return 1;
  if (criterion.op === 'gte')
    return criterion.value > 0 ? Math.max(0, actual / criterion.value) : 0;
  return actual > 0 ? Math.max(0, Math.min(1, criterion.value / actual)) : 0;
}

export function formatMetric(
  key: MetricKey,
  value: number | null | undefined,
  ar: boolean,
): string {
  if (value === null || value === undefined || !Number.isFinite(value))
    return ar ? 'لا بيانات' : 'No data';
  const unit = BADGE_METRICS[key].unit;
  const number = (digits: number) =>
    value.toLocaleString(ar ? 'ar-OM' : 'en-GB', { maximumFractionDigits: digits });
  switch (unit) {
    case 'flag':
      return value >= 1 ? (ar ? 'نعم' : 'Yes') : ar ? 'لا' : 'No';
    case 'rating':
      return `${number(2)} / 5`;
    case 'percent':
      return `${number(0)}%`;
    case 'days':
      return ar ? `${number(1)} يوم` : `${number(1)} days`;
    case 'months':
      return ar ? `${number(0)} شهر` : `${number(0)} months`;
    default:
      return number(0);
  }
}

export function describeCriterion(criterion: BadgeCriterion, ar: boolean): string {
  const info = BADGE_METRICS[criterion.metric];
  if (info.unit === 'flag') {
    const wanted = criterion.op === 'gte' ? criterion.value >= 1 : criterion.value < 1;
    return wanted ? info[ar ? 'ar' : 'en'] : `${ar ? 'ليس' : 'Not'}: ${info[ar ? 'ar' : 'en']}`;
  }
  const sign = criterion.op === 'gte' ? '≥' : '≤';
  return `${info[ar ? 'ar' : 'en']} ${sign} ${formatMetric(criterion.metric, criterion.value, ar)}`;
}

export function badgeSerial(serialNo: number): string {
  return `BDG-${String(serialNo).padStart(3, '0')}`;
}

export function awardSerial(year: number, serialNo: number): string {
  return `AWD-${year}-${String(serialNo).padStart(6, '0')}`;
}

export function parseAwardSerial(value: string): { year: number; no: number } | null {
  const match = /^AWD-(\d{4})-(\d{1,9})$/i.exec(value.trim());
  if (!match) return null;
  return { year: Number(match[1]), no: Number(match[2]) };
}

export type BadgeDefinitionInput = {
  subjectType: BadgeSubject;
  tier: BadgeTier;
  level: BadgeLevel;
  nameAr: string;
  nameEn: string;
  descriptionAr: string | null;
  descriptionEn: string | null;
  icon: BadgeIcon;
  criteria: BadgeCriterion[];
  windowDays: number;
  sustainDays: number;
  validityDays: number | null;
  autoRevoke: boolean;
  grantMode: BadgeGrantMode;
};

export type BadgeDefinitionView = BadgeDefinitionInput & {
  id: string;
  code: string;
  serial: string;
  status: 'active' | 'inactive' | 'archived' | 'draft';
  holders: number;
  pending: number;
  everAwarded: number;
};

export type BadgeAwardView = {
  id: string;
  serial: string;
  badgeId: string;
  badgeSerial: string;
  badgeNameAr: string;
  badgeNameEn: string;
  tier: BadgeTier;
  level: BadgeLevel;
  icon: BadgeIcon;
  subjectType: BadgeSubject;
  subjectId: string;
  subjectName: string;
  status: AwardStatus;
  awardedAt: string | null;
  expiresAt: string | null;
  endedAt: string | null;
  endReason: string | null;
  createdAt: string;
  rationaleAr: string | null;
  rationaleEn: string | null;
  aiEngine: string;
  metrics: MetricValues;
};

export type BadgeProgressView = {
  badgeId: string;
  badgeSerial: string;
  nameAr: string;
  nameEn: string;
  tier: BadgeTier;
  level: BadgeLevel;
  icon: BadgeIcon;
  criteria: { text: string; met: boolean; progress: number; actual: string }[];
  progress: number;
  qualifiedSince: string | null;
  sustainDays: number;
  held: boolean;
};

export type SubjectBadges = {
  subjectType: BadgeSubject;
  subjectId: string;
  awards: BadgeAwardView[];
  progress: BadgeProgressView[];
  metrics: MetricValues;
};

export type EvaluationSummary = {
  subjects: number;
  awarded: number;
  pending: number;
  revoked: number;
  expired: number;
  renewed: number;
};

export type BadgesCenter = {
  canManage: boolean;
  definitions: BadgeDefinitionView[];
  pending: BadgeAwardView[];
  recent: BadgeAwardView[];
  lastEvaluatedAt: string | null;
};

type Seed = Omit<BadgeDefinitionInput, 'descriptionEn'> & { code: string; descriptionEn: string };

const c = (metric: MetricKey, op: 'gte' | 'lte', value: number): BadgeCriterion => ({
  metric,
  op,
  value,
});

/** The starter catalogue every organization receives; each one can then be edited or paused. */
export const DEFAULT_BADGES: readonly Seed[] = [
  {
    code: 'property.top_rated',
    subjectType: 'property',
    tier: 'badge',
    level: 'gold',
    icon: 'star',
    nameAr: 'نجم التقييم',
    nameEn: 'Top rated',
    descriptionAr: 'عقار يحافظ على تقييم 4.5 فأعلى من خمسة تقييمات على الأقل.',
    descriptionEn: 'Keeps a rating of 4.5+ across at least five reviews.',
    criteria: [c('rating_avg', 'gte', 4.5), c('rating_count', 'gte', 5)],
    windowDays: 365,
    sustainDays: 30,
    validityDays: 180,
    autoRevoke: true,
    grantMode: 'auto',
  },
  {
    code: 'property.full_house',
    subjectType: 'property',
    tier: 'badge',
    level: 'silver',
    icon: 'home',
    nameAr: 'إشغال كامل',
    nameEn: 'Full house',
    descriptionAr: 'نسبة إشغال 90% فأكثر لمدة شهرين متواصلين.',
    descriptionEn: '90%+ occupancy held for two months.',
    criteria: [c('occupancy_pct', 'gte', 90)],
    windowDays: 90,
    sustainDays: 60,
    validityDays: 90,
    autoRevoke: true,
    grantMode: 'auto',
  },
  {
    code: 'property.fast_care',
    subjectType: 'property',
    tier: 'badge',
    level: 'silver',
    icon: 'wrench',
    nameAr: 'صيانة سريعة',
    nameEn: 'Fast care',
    descriptionAr: 'تُنجز الصيانة خلال 3 أيام في المتوسط، ولا يتراكم أكثر من طلب مفتوح.',
    descriptionEn: 'Maintenance resolved within 3 days on average, at most one open ticket.',
    criteria: [
      c('resolution_days', 'lte', 3),
      c('maintenance_resolved', 'gte', 3),
      c('open_maintenance', 'lte', 1),
    ],
    windowDays: 180,
    sustainDays: 14,
    validityDays: 180,
    autoRevoke: true,
    grantMode: 'auto',
  },
  {
    code: 'property.excellence_shield',
    subjectType: 'property',
    tier: 'shield',
    level: 'platinum',
    icon: 'shield',
    nameAr: 'درع العقار المتميز',
    nameEn: 'Property excellence shield',
    descriptionAr: 'تقييم 4.7+ من 15 تقييماً وإشغال 85%+ لمدة ثلاثة أشهر. يعتمده المالك.',
    descriptionEn: '4.7+ over 15 reviews and 85%+ occupancy for three months. Owner-approved.',
    criteria: [
      c('rating_avg', 'gte', 4.7),
      c('rating_count', 'gte', 15),
      c('occupancy_pct', 'gte', 85),
    ],
    windowDays: 365,
    sustainDays: 90,
    validityDays: 365,
    autoRevoke: true,
    grantMode: 'approval',
  },
  {
    code: 'owner.trusted',
    subjectType: 'owner',
    tier: 'badge',
    level: 'silver',
    icon: 'check',
    nameAr: 'مالك موثوق',
    nameEn: 'Trusted owner',
    descriptionAr: 'حساب موثّق يتعامل معنا منذ ثلاثة أشهر على الأقل.',
    descriptionEn: 'A verified account working with us for at least three months.',
    criteria: [c('verified', 'gte', 1), c('tenure_months', 'gte', 3)],
    windowDays: 365,
    sustainDays: 0,
    validityDays: null,
    autoRevoke: true,
    grantMode: 'auto',
  },
  {
    code: 'owner.responsive',
    subjectType: 'owner',
    tier: 'badge',
    level: 'gold',
    icon: 'bolt',
    nameAr: 'مالك متجاوب',
    nameEn: 'Responsive owner',
    descriptionAr: 'صيانة عقاراته تُنجز خلال 3 أيام في المتوسط.',
    descriptionEn: 'Maintenance on their properties resolved within 3 days on average.',
    criteria: [c('resolution_days', 'lte', 3), c('maintenance_resolved', 'gte', 3)],
    windowDays: 180,
    sustainDays: 30,
    validityDays: 180,
    autoRevoke: true,
    grantMode: 'auto',
  },
  {
    code: 'owner.portfolio_star',
    subjectType: 'owner',
    tier: 'badge',
    level: 'gold',
    icon: 'crown',
    nameAr: 'محفظة متميزة',
    nameEn: 'Star portfolio',
    descriptionAr: 'متوسط تقييم عقاراته 4.5 فأعلى من عشرة تقييمات.',
    descriptionEn: 'Their properties average 4.5+ over ten reviews.',
    criteria: [c('rating_avg', 'gte', 4.5), c('rating_count', 'gte', 10)],
    windowDays: 365,
    sustainDays: 30,
    validityDays: 180,
    autoRevoke: true,
    grantMode: 'auto',
  },
  {
    code: 'owner.partner_certificate',
    subjectType: 'owner',
    tier: 'certificate',
    level: 'platinum',
    icon: 'handshake',
    nameAr: 'شهادة شريك التميز',
    nameEn: 'Excellence partner certificate',
    descriptionAr: 'سنة من التعامل، تقييم 4.6+ وإشغال 85%+ لثلاثة أشهر. يعتمدها المالك.',
    descriptionEn: 'A year with us, 4.6+ rating and 85%+ occupancy for three months.',
    criteria: [
      c('tenure_months', 'gte', 12),
      c('rating_avg', 'gte', 4.6),
      c('occupancy_pct', 'gte', 85),
    ],
    windowDays: 365,
    sustainDays: 90,
    validityDays: 365,
    autoRevoke: true,
    grantMode: 'approval',
  },
  {
    code: 'tenant.punctual',
    subjectType: 'tenant',
    tier: 'badge',
    level: 'gold',
    icon: 'clock',
    nameAr: 'ملتزم بالسداد',
    nameEn: 'Punctual payer',
    descriptionAr: 'يسدد 95% من فواتيره في موعدها، بلا متأخرات حالية.',
    descriptionEn: 'Pays 95% of invoices on time, nothing overdue.',
    criteria: [
      c('on_time_pct', 'gte', 95),
      c('invoices_count', 'gte', 6),
      c('overdue_count', 'lte', 0),
    ],
    windowDays: 365,
    sustainDays: 0,
    validityDays: 180,
    autoRevoke: true,
    grantMode: 'auto',
  },
  {
    code: 'tenant.ideal_guest',
    subjectType: 'tenant',
    tier: 'badge',
    level: 'gold',
    icon: 'heart',
    nameAr: 'ضيف مثالي',
    nameEn: 'Ideal guest',
    descriptionAr: 'يقيّمه المضيفون 4.5 فأعلى بعد ثلاث إقامات على الأقل.',
    descriptionEn: 'Hosts rate them 4.5+ after at least three stays.',
    criteria: [
      c('guest_rating_avg', 'gte', 4.5),
      c('guest_rating_count', 'gte', 3),
      c('stays_count', 'gte', 3),
    ],
    windowDays: 365,
    sustainDays: 0,
    validityDays: 365,
    autoRevoke: true,
    grantMode: 'auto',
  },
  {
    code: 'tenant.long_term',
    subjectType: 'tenant',
    tier: 'badge',
    level: 'silver',
    icon: 'key',
    nameAr: 'مستأجر طويل الأمد',
    nameEn: 'Long-term tenant',
    descriptionAr: 'سنتان من الإيجار المتواصل بلا متأخرات.',
    descriptionEn: 'Two years of renting with nothing overdue.',
    criteria: [
      c('tenure_months', 'gte', 24),
      c('active_leases', 'gte', 1),
      c('overdue_count', 'lte', 0),
    ],
    windowDays: 365,
    sustainDays: 0,
    validityDays: null,
    autoRevoke: true,
    grantMode: 'auto',
  },
  {
    code: 'tenant.clean_record',
    subjectType: 'tenant',
    tier: 'badge',
    level: 'bronze',
    icon: 'leaf',
    nameAr: 'سجل نظيف',
    nameEn: 'Clean record',
    descriptionAr: 'ستة أشهر بلا قضايا ولا متأخرات.',
    descriptionEn: 'Six months with no legal cases and nothing overdue.',
    criteria: [
      c('tenure_months', 'gte', 6),
      c('legal_cases', 'lte', 0),
      c('overdue_count', 'lte', 0),
    ],
    windowDays: 365,
    sustainDays: 0,
    validityDays: 365,
    autoRevoke: true,
    grantMode: 'auto',
  },
  {
    code: 'tenant.ideal_shield',
    subjectType: 'tenant',
    tier: 'shield',
    level: 'platinum',
    icon: 'shield',
    nameAr: 'درع المستأجر المثالي',
    nameEn: 'Ideal tenant shield',
    descriptionAr: 'سداد 98% في الموعد على 12 فاتورة وبلا قضايا لستة أشهر. يعتمده المالك.',
    descriptionEn: '98% on time over 12 invoices and no cases for six months. Owner-approved.',
    criteria: [
      c('on_time_pct', 'gte', 98),
      c('invoices_count', 'gte', 12),
      c('legal_cases', 'lte', 0),
    ],
    windowDays: 365,
    sustainDays: 180,
    validityDays: 365,
    autoRevoke: true,
    grantMode: 'approval',
  },
  {
    code: 'staff.on_time',
    subjectType: 'staff',
    tier: 'badge',
    level: 'gold',
    icon: 'clock',
    nameAr: 'إنجاز في الموعد',
    nameEn: 'On time',
    descriptionAr: 'ينجز 90% من مهامه في موعدها، من عشر مهام على الأقل.',
    descriptionEn: 'Completes 90% of tasks on time, at least ten tasks.',
    criteria: [c('on_time_pct', 'gte', 90), c('tasks_completed', 'gte', 10)],
    windowDays: 90,
    sustainDays: 14,
    validityDays: 90,
    autoRevoke: true,
    grantMode: 'auto',
  },
  {
    code: 'staff.zero_backlog',
    subjectType: 'staff',
    tier: 'badge',
    level: 'silver',
    icon: 'check',
    nameAr: 'صفر متأخرات',
    nameEn: 'Zero backlog',
    descriptionAr: 'لا مهام متأخرة لديه لمدة شهر كامل.',
    descriptionEn: 'No overdue tasks for a full month.',
    criteria: [c('overdue_open', 'lte', 0), c('tasks_completed', 'gte', 5)],
    windowDays: 90,
    sustainDays: 30,
    validityDays: 60,
    autoRevoke: true,
    grantMode: 'auto',
  },
  {
    code: 'staff.month_medal',
    subjectType: 'staff',
    tier: 'medal',
    level: 'gold',
    icon: 'trophy',
    nameAr: 'وسام موظف الشهر',
    nameEn: 'Employee of the month',
    descriptionAr: '30 مهمة في شهر بنسبة التزام 95%. يعتمده المالك.',
    descriptionEn: '30 tasks in a month at 95% on time. Owner-approved.',
    criteria: [c('tasks_completed', 'gte', 30), c('on_time_pct', 'gte', 95)],
    windowDays: 30,
    sustainDays: 0,
    validityDays: 30,
    autoRevoke: false,
    grantMode: 'approval',
  },
  {
    code: 'staff.one_year',
    subjectType: 'staff',
    tier: 'badge',
    level: 'bronze',
    icon: 'calendar',
    nameAr: 'خبرة سنة',
    nameEn: 'One year',
    descriptionAr: 'سنة كاملة في الفريق.',
    descriptionEn: 'A full year on the team.',
    criteria: [c('tenure_months', 'gte', 12)],
    windowDays: 365,
    sustainDays: 0,
    validityDays: null,
    autoRevoke: true,
    grantMode: 'auto',
  },
  {
    code: 'worker.reliable',
    subjectType: 'worker',
    tier: 'badge',
    level: 'gold',
    icon: 'bolt',
    nameAr: 'فني موثوق',
    nameEn: 'Reliable worker',
    descriptionAr: 'ينجز 90% من أعماله في موعدها، من خمسة أعمال على الأقل.',
    descriptionEn: 'Completes 90% of jobs on schedule, at least five jobs.',
    criteria: [c('on_time_pct', 'gte', 90), c('jobs_completed', 'gte', 5)],
    windowDays: 180,
    sustainDays: 0,
    validityDays: 180,
    autoRevoke: true,
    grantMode: 'auto',
  },
  {
    code: 'worker.quality',
    subjectType: 'worker',
    tier: 'badge',
    level: 'silver',
    icon: 'gem',
    nameAr: 'جودة معتمدة',
    nameEn: 'Verified quality',
    descriptionAr: '90% من أعماله اعتُمدت جودتها بعد الإنجاز.',
    descriptionEn: '90% of jobs quality-verified after completion.',
    criteria: [c('verified_jobs_pct', 'gte', 90), c('jobs_completed', 'gte', 5)],
    windowDays: 180,
    sustainDays: 0,
    validityDays: 180,
    autoRevoke: true,
    grantMode: 'auto',
  },
  {
    code: 'worker.on_budget',
    subjectType: 'worker',
    tier: 'badge',
    level: 'silver',
    icon: 'handshake',
    nameAr: 'التزام بالتكلفة',
    nameEn: 'On budget',
    descriptionAr: '95% من أعماله ضمن التكلفة المعتمدة.',
    descriptionEn: '95% of jobs within the approved cost.',
    criteria: [c('cost_accuracy_pct', 'gte', 95), c('jobs_completed', 'gte', 5)],
    windowDays: 180,
    sustainDays: 0,
    validityDays: 180,
    autoRevoke: true,
    grantMode: 'auto',
  },
  {
    code: 'worker.master_certificate',
    subjectType: 'worker',
    tier: 'certificate',
    level: 'platinum',
    icon: 'rocket',
    nameAr: 'شهادة مقاول متميز',
    nameEn: 'Master contractor certificate',
    descriptionAr: '20 عملاً بنسبة التزام 95% وتقييم 4.5+. يعتمدها المالك.',
    descriptionEn: '20 jobs at 95% on time and a 4.5+ rating. Owner-approved.',
    criteria: [
      c('jobs_completed', 'gte', 20),
      c('on_time_pct', 'gte', 95),
      c('vendor_rating', 'gte', 4.5),
    ],
    windowDays: 365,
    sustainDays: 30,
    validityDays: 365,
    autoRevoke: true,
    grantMode: 'approval',
  },
];

/** A plain-language reason for an award, used when the AI is unavailable. */
export function rulesRationale(
  definition: Pick<BadgeDefinitionInput, 'criteria' | 'windowDays' | 'sustainDays'>,
  metrics: MetricValues,
  ar: boolean,
): string {
  const parts = definition.criteria.map(
    (criterion) =>
      `${BADGE_METRICS[criterion.metric][ar ? 'ar' : 'en']}: ${formatMetric(criterion.metric, metrics[criterion.metric], ar)}`,
  );
  const held = definition.sustainDays
    ? ar
      ? ` واستمر ذلك ${definition.sustainDays} يوماً.`
      : ` Held for ${definition.sustainDays} days.`
    : '';
  return ar
    ? `استوفى الشروط خلال آخر ${definition.windowDays} يوماً — ${parts.join('، ')}.${held}`
    : `Met the criteria over the last ${definition.windowDays} days — ${parts.join(', ')}.${held}`;
}

export function endReasonText(reason: string | null, ar: boolean): string | null {
  if (!reason) return null;
  if (reason.startsWith('criteria:')) {
    const keys = reason.slice('criteria:'.length).split(',').filter(isMetricKey);
    const names = keys.map((key) => BADGE_METRICS[key][ar ? 'ar' : 'en']).join(ar ? '، ' : ', ');
    return ar ? `انخفض الأداء عن المعيار: ${names}` : `Fell below the standard: ${names}`;
  }
  if (reason === 'expired') return ar ? 'انتهت مدة الصلاحية' : 'Validity ended';
  if (reason === 'badge_paused') return ar ? 'أُوقفت الشارة' : 'Badge paused';
  return reason;
}
