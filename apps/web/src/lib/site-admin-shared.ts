/** What a delegated administrator may run on behalf of the site administration. */
export const ADMIN_SCOPES = [
  'complaints',
  'verification',
  'plans',
  'users',
  'accounting',
  'delegates',
] as const;
export type AdminScope = (typeof ADMIN_SCOPES)[number];

export const SCOPE_LABELS: Record<
  AdminScope,
  { ar: string; en: string; hintAr: string; hintEn: string }
> = {
  complaints: {
    ar: 'شكاوى التأمين',
    en: 'Deposit complaints',
    hintAr: 'البتّ في شكاوى الضيوف على مبالغ التأمين',
    hintEn: 'Decide guests’ deposit complaints',
  },
  verification: {
    ar: 'توثيق الحسابات',
    en: 'Account verification',
    hintAr: 'مراجعة طلبات التوثيق واعتمادها',
    hintEn: 'Review and approve verification requests',
  },
  plans: {
    ar: 'الباقات والاشتراكات',
    en: 'Plans & subscriptions',
    hintAr: 'أسعار الباقات وحدودها واشتراك كل منشأة',
    hintEn: 'Plan prices and limits, and each organization’s subscription',
  },
  users: {
    ar: 'المستخدمون',
    en: 'Users',
    hintAr: 'إيقاف الحسابات وإعادة تفعيلها',
    hintEn: 'Suspend and restore accounts',
  },
  accounting: {
    ar: 'محاسبة المنصة',
    en: 'Platform accounting',
    hintAr: 'دخل العملاء وصرفهم ودفاتر الموقع وتحليل الذكاء الاصطناعي',
    hintEn: 'Client income/spend, site ledger, and AI analysis',
  },
  delegates: {
    ar: 'التفويض',
    en: 'Delegation',
    hintAr: 'إضافة مفوضين وتحديد صلاحياتهم',
    hintEn: 'Add delegates and set what they may do',
  },
};

export const ADMIN_SECTIONS: { scope: AdminScope; path: string }[] = [
  { scope: 'complaints', path: '/admin/complaints' },
  { scope: 'verification', path: '/admin/verification' },
  { scope: 'plans', path: '/admin/plans' },
  { scope: 'users', path: '/admin/users' },
  { scope: 'accounting', path: '/admin/accounting' },
  { scope: 'delegates', path: '/admin/delegates' },
];

/**
 * Full site-console navigation (system control only — never mixed with owner/tenant portals).
 * `scope: null` = any account that already has site-admin access may open it.
 */
export type SiteConsoleSectionId =
  | 'overview'
  | 'diagnostics'
  | 'security'
  | 'billing'
  | 'accounting'
  | 'payments'
  | 'pages'
  | 'maintenance'
  | 'notifications'
  | 'emailWishes'
  | 'greetings'
  | 'badges'
  | 'apiKeys'
  | 'labReset'
  | AdminScope;

export type SiteConsoleNavGroup = 'home' | 'ops' | 'growth' | 'service' | 'content' | 'tools';

export const SITE_CONSOLE_NAV_GROUPS: Record<
  SiteConsoleNavGroup,
  { ar: string; en: string; order: number }
> = {
  home: { ar: 'الرئيسية', en: 'Home', order: 0 },
  ops: { ar: 'التشغيل', en: 'Operations', order: 1 },
  growth: { ar: 'النمو', en: 'Growth', order: 2 },
  service: { ar: 'الخدمة', en: 'Service', order: 3 },
  content: { ar: 'المحتوى', en: 'Content', order: 4 },
  tools: { ar: 'الأدوات', en: 'Tools', order: 5 },
};

export const SITE_CONSOLE_SECTIONS: Array<{
  id: SiteConsoleSectionId;
  path: string;
  scope: AdminScope | null;
  /** Root-only sections (site owner / complaint-inbox emails). */
  rootOnly?: boolean;
  group: SiteConsoleNavGroup;
  ar: string;
  en: string;
  hintAr: string;
  hintEn: string;
}> = [
  {
    id: 'overview',
    path: '/admin',
    scope: null,
    group: 'home',
    ar: 'نظرة عامة',
    en: 'Overview',
    hintAr: 'لوحة مالك الموقع ومؤشرات التشغيل',
    hintEn: 'Site-owner hub and live pulse',
  },
  {
    id: 'diagnostics',
    path: '/admin/diagnostics',
    scope: null,
    group: 'ops',
    ar: 'تشخيص النظام',
    en: 'Diagnostics',
    hintAr: 'صحة القاعدة والهوية والطوابير والجلسات',
    hintEn: 'Database, identity, queues, sessions',
  },
  {
    id: 'security',
    path: '/admin/security',
    scope: null,
    group: 'ops',
    ar: 'الأمن والتدقيق',
    en: 'Security',
    hintAr: 'سجل التدقيق وبصمات IP والجلسات',
    hintEn: 'Audit log, IP fingerprints, sessions',
  },
  {
    id: 'payments',
    path: '/admin/payments',
    scope: null,
    rootOnly: true,
    group: 'ops',
    ar: 'بوابات الدفع',
    en: 'Payment gateways',
    hintAr: 'تفعيل البوابات وطرق الدفع وإدخال المفاتيح',
    hintEn: 'Enable gateways and methods, enter keys',
  },
  {
    id: 'pages',
    path: '/admin/pages',
    scope: null,
    rootOnly: true,
    group: 'ops',
    ar: 'صفحات الموقع',
    en: 'Site pages',
    hintAr: 'تفعيل أو إيقاف الصفحات العامة',
    hintEn: 'Turn public pages on or off',
  },
  {
    id: 'maintenance',
    path: '/admin/maintenance',
    scope: null,
    rootOnly: true,
    group: 'ops',
    ar: 'الصيانة والتنبيه',
    en: 'Maintenance',
    hintAr: 'وضع الصيانة ورسالة الزوار',
    hintEn: 'Maintenance mode and visitor notice',
  },
  {
    id: 'plans',
    path: '/admin/plans',
    scope: 'plans',
    group: 'growth',
    ar: 'الاشتراكات',
    en: 'Subscriptions',
    hintAr: 'أسعار الباقات وحالة اشتراك كل منشأة',
    hintEn: 'Plan prices and each organization’s subscription',
  },
  {
    id: 'billing',
    path: '/admin/billing',
    scope: 'plans',
    group: 'growth',
    ar: 'إحصائيات الاشتراك',
    en: 'Billing stats',
    hintAr: 'تقدير شهري وحالات السداد',
    hintEn: 'Estimated MRR and payment statuses',
  },
  {
    id: 'accounting',
    path: '/admin/accounting',
    scope: 'accounting',
    group: 'growth',
    ar: 'محاسبة المنصة',
    en: 'Platform accounting',
    hintAr: 'دخل وصرف العملاء ودفاتر الموقع والتسويق',
    hintEn: 'Client income/spend, site books, and marketing pulse',
  },
  {
    id: 'users',
    path: '/admin/users',
    scope: 'users',
    group: 'growth',
    ar: 'المستخدمون',
    en: 'Users',
    hintAr: 'إيقاف الحسابات وإعادة تفعيلها',
    hintEn: 'Suspend and restore accounts',
  },
  {
    id: 'complaints',
    path: '/admin/complaints',
    scope: 'complaints',
    group: 'service',
    ar: 'شكاوى التأمين',
    en: 'Deposit complaints',
    hintAr: 'تشغيل يومي لشكاوى الضيوف',
    hintEn: 'Day-to-day guest deposit complaints',
  },
  {
    id: 'verification',
    path: '/admin/verification',
    scope: 'verification',
    group: 'service',
    ar: 'توثيق الحسابات',
    en: 'Verification',
    hintAr: 'مراجعة طلبات التوثيق',
    hintEn: 'Review verification requests',
  },
  {
    id: 'notifications',
    path: '/admin/notifications',
    scope: null,
    group: 'content',
    ar: 'قوالب الإشعارات',
    en: 'Notification templates',
    hintAr: 'معاينة قوالب البريد والواتساب',
    hintEn: 'Preview email and WhatsApp templates',
  },
  {
    id: 'emailWishes',
    path: '/admin/email-wishes',
    scope: null,
    rootOnly: true,
    group: 'content',
    ar: 'العبارات التحفيزية',
    en: 'Motivational phrases',
    hintAr: 'عبارات التحية والتحفيز في ذيل الإيميلات',
    hintEn: 'Greeting and wish lines in email footers',
  },
  {
    id: 'greetings',
    path: '/admin/greetings',
    scope: null,
    rootOnly: true,
    group: 'content',
    ar: 'التهاني المجدولة',
    en: 'Scheduled greetings',
    hintAr: 'رفع صورة ونص، معاينة، إرسال وجدولة',
    hintEn: 'Image & copy, preview, send or schedule',
  },
  {
    id: 'badges',
    path: '/admin/badges',
    scope: null,
    group: 'content',
    ar: 'الشارات',
    en: 'Badges',
    hintAr: 'كتالوج الشارات والاعتماد',
    hintEn: 'Badge catalogue and approvals',
  },
  {
    id: 'apiKeys',
    path: '/admin/api-keys',
    scope: null,
    group: 'tools',
    ar: 'مفاتيح API',
    en: 'API keys',
    hintAr: 'وصول برمجي للمنشأة النشطة',
    hintEn: 'Programmatic access for the active org',
  },
  {
    id: 'labReset',
    path: '/admin/lab-reset',
    scope: null,
    group: 'tools',
    ar: 'إعادة ضبط التجارب',
    en: 'Lab reset',
    hintAr: 'مسح بيانات التجريب مع الإبقاء على العقارات',
    hintEn: 'Wipe test data while keeping properties',
  },
  {
    id: 'delegates',
    path: '/admin/delegates',
    scope: 'delegates',
    group: 'tools',
    ar: 'التفويض',
    en: 'Delegation',
    hintAr: 'مَن يدير الموقع نيابةً عنك',
    hintEn: 'Who may manage the site for you',
  },
];

export type SiteAdminAccess = {
  /** Platform administrators and the complaint-inbox emails; they may grant any scope. */
  root: boolean;
  scopes: AdminScope[];
};

/** Sections this account may see in the site console (never shown in owner/tenant portals). */
export function siteConsoleSectionsFor(access: SiteAdminAccess) {
  return SITE_CONSOLE_SECTIONS.filter((section) => {
    if (section.rootOnly && !access.root) return false;
    return section.scope === null || access.scopes.includes(section.scope);
  });
}

export type AdminDelegate = {
  email: string;
  scopes: AdminScope[];
  note: string | null;
  grantedBy: string | null;
  grantedAt: string;
};

export const DELEGATE_LIMIT = 25;

export function isAdminScope(value: unknown): value is AdminScope {
  return typeof value === 'string' && (ADMIN_SCOPES as readonly string[]).includes(value);
}

export const SUBSCRIPTION_STATUSES = [
  'active',
  'trial',
  'past_due',
  'suspended',
  'cancelled',
] as const;
export type SubscriptionStatus = (typeof SUBSCRIPTION_STATUSES)[number];

export const SUBSCRIPTION_LABELS: Record<
  SubscriptionStatus,
  { ar: string; en: string; tone: string }
> = {
  active: { ar: 'فعّال', en: 'Active', tone: 'ready' },
  trial: { ar: 'تجريبي', en: 'Trial', tone: 'info' },
  past_due: { ar: 'متأخر السداد', en: 'Past due', tone: 'warn' },
  suspended: { ar: 'موقوف', en: 'Suspended', tone: 'danger' },
  cancelled: { ar: 'ملغى', en: 'Cancelled', tone: 'muted' },
};

/** A suspended or cancelled subscription keeps its data but cannot add seats. */
export function subscriptionBlocksGrowth(status: SubscriptionStatus | null | undefined): boolean {
  return status === 'suspended' || status === 'cancelled';
}

export type PlanDefinition = {
  key: string;
  nameAr: string;
  nameEn: string;
  /** Price per period in Omani rials, three decimals, e.g. "15.000". */
  price: string;
  period: 'month' | 'year';
  properties: number;
  units: number;
  representatives: number;
  storageGb: number;
  active: boolean;
};

export const PLAN_LIMIT = 12;
export const PLAN_KEY_PATTERN = /^[a-z][a-z0-9_-]{1,23}$/;

/** Same limits as `PLAN_ENTITLEMENTS` in @bhd-r/domain until the administration edits them. */
export const DEFAULT_PLANS: PlanDefinition[] = [
  {
    key: 'starter',
    nameAr: 'الأساسية',
    nameEn: 'Starter',
    price: '0.000',
    period: 'month',
    properties: 5,
    units: 25,
    representatives: 2,
    storageGb: 5,
    active: true,
  },
  {
    key: 'growth',
    nameAr: 'النمو',
    nameEn: 'Growth',
    price: '0.000',
    period: 'month',
    properties: 50,
    units: 500,
    representatives: 10,
    storageGb: 50,
    active: true,
  },
  {
    key: 'enterprise',
    nameAr: 'المؤسسات',
    nameEn: 'Enterprise',
    price: '0.000',
    period: 'month',
    properties: 10_000,
    units: 100_000,
    representatives: 100,
    storageGb: 500,
    active: true,
  },
];

const PRICE = /^\d{1,7}(\.\d{1,3})?$/;

function whole(value: unknown, max: number): number | null {
  const parsed = typeof value === 'number' ? value : Number(value);
  return Number.isInteger(parsed) && parsed >= 0 && parsed <= max ? parsed : null;
}

/** One plan from stored or submitted JSON, or null when anything is off. */
export function parsePlan(value: unknown): PlanDefinition | null {
  if (!value || typeof value !== 'object') return null;
  const row = value as Record<string, unknown>;
  const key = typeof row.key === 'string' ? row.key.trim().toLowerCase() : '';
  const nameAr = typeof row.nameAr === 'string' ? row.nameAr.trim() : '';
  const nameEn = typeof row.nameEn === 'string' ? row.nameEn.trim() : '';
  const price =
    typeof row.price === 'string'
      ? row.price.trim()
      : typeof row.price === 'number'
        ? String(row.price)
        : '';
  const properties = whole(row.properties, 1_000_000);
  const units = whole(row.units, 10_000_000);
  const representatives = whole(row.representatives, 100_000);
  const storageGb = whole(row.storageGb, 100_000);
  if (
    !PLAN_KEY_PATTERN.test(key) ||
    !nameAr ||
    nameAr.length > 60 ||
    !nameEn ||
    nameEn.length > 60 ||
    !PRICE.test(price) ||
    properties === null ||
    units === null ||
    representatives === null ||
    storageGb === null
  ) {
    return null;
  }
  return {
    key,
    nameAr,
    nameEn,
    price: Number(price).toFixed(3),
    period: row.period === 'year' ? 'year' : 'month',
    properties,
    units,
    representatives,
    storageGb,
    active: row.active !== false,
  };
}

export type AdminOrganization = {
  id: string;
  nameAr: string;
  nameEn: string | null;
  type: string;
  status: string;
  planKey: string;
  createdAt: string | null;
  contactEmail: string | null;
  members: number;
  properties: number;
  units: number;
  subscription: {
    status: SubscriptionStatus;
    endsOn: string | null;
    note: string | null;
    updatedAt: string | null;
  };
};

export type AdminUser = {
  id: string;
  email: string | null;
  displayName: string;
  createdAt: string | null;
  disabledAt: string | null;
  organizations: { nameAr: string; role: string }[];
  isSiteAdmin: boolean;
  /** Best-known country: latest session, else primary org country. */
  countryCode: string | null;
  countryNameAr: string | null;
  countryNameEn: string | null;
  planKey: string | null;
  planNameAr: string | null;
  planNameEn: string | null;
  subscriptionStatus: SubscriptionStatus | null;
  subscriptionEndsOn: string | null;
};

export type AdminUserOrg = {
  id: string;
  nameAr: string;
  nameEn: string | null;
  role: string;
  countryCode: string;
  planKey: string;
  planNameAr: string;
  planNameEn: string;
  subscriptionStatus: SubscriptionStatus;
  subscriptionEndsOn: string | null;
  storageUsedBytes: number;
  storageLimitBytes: number;
};

export type AdminUserProperty = {
  id: string;
  nameAr: string;
  nameEn: string;
  status: string;
  kind: string;
  organizationId: string;
  organizationNameAr: string;
  listingSlug: string | null;
  units: number;
};

export type AdminUserLease = {
  id: string;
  status: string;
  startsOn: string;
  endsOn: string;
  propertyId: string;
  propertyNameAr: string;
  propertyNameEn: string;
  unitId: string;
  unitNameAr: string;
  ownerName: string;
  contractId: string | null;
  organizationId: string;
};

export type AdminUserContract = {
  id: string;
  reference: string | null;
  kind: string;
  status: string;
  propertyId: string;
  propertyNameAr: string;
  unitId: string;
  role: 'owner' | 'tenant';
  counterpartyName: string;
  completedAt: string | null;
};

export type AdminUserReview = {
  id: string;
  source: 'reviews' | 'stay' | 'booking';
  direction: 'authored' | 'received';
  score: number;
  targetLabel: string;
  status: string;
  createdAt: string | null;
  comment: string | null;
};

export type AdminUserSession = {
  id: string;
  countryCode: string | null;
  ipHash: string | null;
  deviceHash: string | null;
  createdAt: string | null;
  expiresAt: string | null;
  revokedAt: string | null;
  active: boolean;
};

export type AdminUserAuthAttempt = {
  id: string;
  at: string | null;
  outcome: string;
  ipAddress: string | null;
  ipHash: string;
  countryCode: string | null;
  deviceHash: string | null;
  reason: string | null;
};

export type AdminUserAudit = {
  at: string | null;
  action: string;
  resourceType: string;
  resourceId: string | null;
};

export type AdminUserDetail = {
  id: string;
  email: string | null;
  username: string;
  displayName: string;
  locale: string;
  createdAt: string | null;
  disabledAt: string | null;
  securityLockedAt: string | null;
  isSiteAdmin: boolean;
  phone: string | null;
  partyEmail: string | null;
  countryCode: string | null;
  countryNameAr: string | null;
  countryNameEn: string | null;
  organizations: AdminUserOrg[];
  propertiesOwned: AdminUserProperty[];
  leasesAsTenant: AdminUserLease[];
  contracts: AdminUserContract[];
  reviews: AdminUserReview[];
  storage: {
    uploadedBytes: number;
    byOrganization: Array<{ organizationId: string; nameAr: string; bytes: number }>;
  };
  sessions: AdminUserSession[];
  authAttempts: AdminUserAuthAttempt[];
  audit: AdminUserAudit[];
};

export type AdminPropertyInspect = {
  id: string;
  nameAr: string;
  nameEn: string;
  status: string;
  kind: string;
  category: string;
  organizationId: string;
  organizationNameAr: string;
  ownerName: string;
  countryCode: string | null;
  listingSlug: string | null;
  units: Array<{ id: string; nameAr: string; nameEn: string; status: string }>;
  contracts: Array<{
    id: string;
    reference: string | null;
    status: string;
    kind: string;
    tenantName: string;
    ownerName: string;
  }>;
  leases: Array<{
    id: string;
    status: string;
    startsOn: string;
    endsOn: string;
    tenantName: string;
    contractId: string | null;
  }>;
};

export type AdminContractInspect = {
  id: string;
  reference: string | null;
  kind: string;
  status: string;
  organizationId: string;
  organizationNameAr: string;
  propertyId: string;
  propertyNameAr: string;
  propertyNameEn: string;
  unitId: string;
  unitNameAr: string;
  ownerName: string;
  tenantName: string;
  sentAt: string | null;
  completedAt: string | null;
  hasPdf: boolean;
  relatedUserIds: string[];
};

export const PLATFORM_LEDGER_KINDS = [
  'subscription_in',
  'other_in',
  'expense',
  'adjustment',
] as const;
export type PlatformLedgerKind = (typeof PLATFORM_LEDGER_KINDS)[number];

export const PLATFORM_LEDGER_KIND_LABELS: Record<
  PlatformLedgerKind,
  { ar: string; en: string; tone: 'ready' | 'info' | 'danger' | 'warn' }
> = {
  subscription_in: { ar: 'تحصيل اشتراك', en: 'Subscription collected', tone: 'ready' },
  other_in: { ar: 'دخل آخر', en: 'Other income', tone: 'info' },
  expense: { ar: 'مصروف موقع', en: 'Site expense', tone: 'danger' },
  adjustment: { ar: 'تسوية', en: 'Adjustment', tone: 'warn' },
};

export type PlatformLedgerEntry = {
  id: string;
  occurredOn: string;
  kind: PlatformLedgerKind;
  category: string;
  description: string;
  amountMinor: number;
  currency: string;
  organizationId: string | null;
  organizationNameAr: string | null;
  reference: string | null;
  status: 'draft' | 'posted' | 'void';
  createdAt: string | null;
};

export type PlatformAccountRow = {
  organizationId: string;
  nameAr: string;
  nameEn: string | null;
  planKey: string;
  incomeMinor: number;
  rentIncomeMinor: number;
  stayIncomeMinor: number;
  expenseMinor: number;
  properties: number;
  units: number;
  members: number;
};

export type PlatformAccountingPulse = {
  clientIncomeMinor: number;
  clientExpenseMinor: number;
  siteIncomeMinor: number;
  siteExpenseMinor: number;
  estimatedSubscriptionMonthlyMinor: number;
  organizations: number;
  users: number;
  properties: number;
  units: number;
};

export type PlatformAccountingView = {
  generatedAt: string;
  currency: 'OMR';
  pulse: PlatformAccountingPulse;
  accounts: PlatformAccountRow[];
  ledger: PlatformLedgerEntry[];
  ledgerReady: boolean;
};

export type PlatformAccountingNarrative = {
  engine: 'ai' | 'rules';
  summaryAr: string;
  summaryEn: string;
  highlights: Array<{ ar: string; en: string }>;
  risks: Array<{ ar: string; en: string }>;
  rankedOrganizationIds: string[];
  marketingTips: Array<{ ar: string; en: string }>;
};

const ERRORS: Record<string, { status: number; ar: string; en: string }> = {
  forbidden: {
    status: 403,
    ar: 'لا تملك هذه الصلاحية في إدارة الموقع.',
    en: 'You do not have this site-admin permission.',
  },
  invalid_body: { status: 400, ar: 'البيانات المرسلة غير صحيحة.', en: 'The request is invalid.' },
  delegates_invalid: {
    status: 400,
    ar: 'تحقق من البريد والصلاحيات لكل مفوَّض.',
    en: 'Check each delegate’s email and permissions.',
  },
  delegate_scope_denied: {
    status: 403,
    ar: 'منح صلاحية «التفويض» لغيرك متاح للإدارة العليا فقط.',
    en: 'Only top-level admins can grant the delegation permission.',
  },
  plans_invalid: {
    status: 400,
    ar: 'تحقق من بيانات الباقات: الرمز والاسمان والسعر والحدود.',
    en: 'Check the plans: key, names, price and limits.',
  },
  plan_in_use: {
    status: 409,
    ar: 'لا يمكن حذف باقة مشترك فيها منشآت؛ أوقفها بدلاً من ذلك.',
    en: 'A plan with subscribers cannot be removed; deactivate it instead.',
  },
  plan_unknown: {
    status: 400,
    ar: 'الباقة غير موجودة أو غير مفعلة.',
    en: 'Unknown or inactive plan.',
  },
  organization_not_found: { status: 404, ar: 'المنشأة غير موجودة.', en: 'Organization not found.' },
  user_not_found: { status: 404, ar: 'المستخدم غير موجود.', en: 'User not found.' },
  property_not_found: { status: 404, ar: 'العقار غير موجود.', en: 'Property not found.' },
  contract_not_found: { status: 404, ar: 'العقد غير موجود.', en: 'Contract not found.' },
  user_self: {
    status: 409,
    ar: 'لا يمكنك إيقاف حسابك أنت.',
    en: 'You cannot suspend your own account.',
  },
  user_protected: {
    status: 403,
    ar: 'لا يوقف حساب الإدارة العليا إلا إداري أعلى.',
    en: 'Only a top-level admin can suspend another top-level admin.',
  },
  gateway_keys_required: {
    status: 400,
    ar: 'أدخل مفاتيح البوابة المطلوبة قبل تفعيلها.',
    en: 'Enter the required gateway keys before enabling it.',
  },
  gateway_verify_failed: {
    status: 400,
    ar: 'تعذّر التحقق من مفاتيح البوابة. راجع المفتاح ونقطة النهاية ثم أعد المحاولة.',
    en: 'Could not verify the gateway keys. Check the key and endpoint, then try again.',
  },
  greeting_not_found: {
    status: 404,
    ar: 'حملة التهنئة غير موجودة.',
    en: 'Greeting campaign not found.',
  },
  greeting_design_not_found: {
    status: 404,
    ar: 'نسخة التصميم غير موجودة.',
    en: 'Greeting design version not found.',
  },
  greeting_no_design: {
    status: 400,
    ar: 'صمّم البطاقة أولاً قبل الإرسال.',
    en: 'Generate a card design before sending.',
  },
  greeting_locked: {
    status: 409,
    ar: 'هذه الحملة قيد الإرسال أو أُرسلت مسبقاً.',
    en: 'This campaign is sending or already sent.',
  },
  ai_failed: {
    status: 502,
    ar: 'تعذّر التحليل بالذكاء الاصطناعي. أعد المحاولة.',
    en: 'AI analysis failed. Please try again.',
  },
  ai_unconfigured: {
    status: 503,
    ar: 'خدمة الذكاء الاصطناعي غير مفعّلة على الخادم (AI_GATEWAY_API_KEY أو OPENAI_API_KEY).',
    en: 'AI is not configured on the server (AI_GATEWAY_API_KEY or OPENAI_API_KEY).',
  },
  ledger_invalid: {
    status: 400,
    ar: 'تحقق من نوع القيد والمبلغ والوصف والتاريخ.',
    en: 'Check the entry kind, amount, description, and date.',
  },
  ledger_not_found: {
    status: 404,
    ar: 'القيد غير موجود.',
    en: 'Ledger entry not found.',
  },
  accounting_unavailable: {
    status: 503,
    ar: 'جدول محاسبة المنصة غير جاهز بعد. انتظر اكتمال الترحيل ثم أعد المحاولة.',
    en: 'Platform ledger table is not ready yet. Wait for migration, then retry.',
  },
  ai_image_failed: {
    status: 502,
    ar: 'صيغ النص بنجاح لكن تعذّر رسم الصورة الرقمية. أعد المحاولة بعد لحظات.',
    en: 'Copy was prepared but the digital image could not be rendered. Try again shortly.',
  },
};

export function adminErrorBody(code: string): {
  status: number;
  body: { error: { code: string; messageAr: string; message: string } };
} {
  const known = ERRORS[code] ?? ERRORS.invalid_body!;
  return {
    status: known.status,
    body: {
      error: { code: ERRORS[code] ? code : 'invalid_body', messageAr: known.ar, message: known.en },
    },
  };
}

export const ADMIN_ERROR_CODES = new Set(Object.keys(ERRORS));
