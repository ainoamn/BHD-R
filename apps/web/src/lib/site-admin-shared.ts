/** What a delegated administrator may run on behalf of the site administration. */
export const ADMIN_SCOPES = ['complaints', 'verification', 'plans', 'users', 'delegates'] as const;
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
  delegates: {
    ar: 'التفويض',
    en: 'Delegation',
    hintAr: 'إضافة مفوضين وتحديد صلاحياتهم',
    hintEn: 'Add delegates and set what they may do',
  },
};

export const ADMIN_SECTIONS: { scope: AdminScope; path: string }[] = [
  { scope: 'complaints', path: '/site-admin/complaints' },
  { scope: 'verification', path: '/site-admin/verification' },
  { scope: 'plans', path: '/site-admin/plans' },
  { scope: 'users', path: '/site-admin/users' },
  { scope: 'delegates', path: '/site-admin/delegates' },
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
  | 'notifications'
  | 'badges'
  | 'apiKeys'
  | 'labReset'
  | AdminScope;

export const SITE_CONSOLE_SECTIONS: Array<{
  id: SiteConsoleSectionId;
  path: string;
  scope: AdminScope | null;
  ar: string;
  en: string;
}> = [
  { id: 'overview', path: '/site-admin', scope: null, ar: 'نظرة عامة', en: 'Overview' },
  {
    id: 'diagnostics',
    path: '/site-admin/diagnostics',
    scope: null,
    ar: 'تشخيص النظام',
    en: 'Diagnostics',
  },
  {
    id: 'security',
    path: '/site-admin/security',
    scope: null,
    ar: 'الأمن والتدقيق',
    en: 'Security',
  },
  {
    id: 'plans',
    path: '/site-admin/plans',
    scope: 'plans',
    ar: 'الاشتراكات',
    en: 'Subscriptions',
  },
  {
    id: 'billing',
    path: '/site-admin/billing',
    scope: 'plans',
    ar: 'إحصائيات الاشتراك',
    en: 'Billing stats',
  },
  { id: 'users', path: '/site-admin/users', scope: 'users', ar: 'المستخدمون', en: 'Users' },
  {
    id: 'complaints',
    path: '/site-admin/complaints',
    scope: 'complaints',
    ar: 'شكاوى التأمين',
    en: 'Deposit complaints',
  },
  {
    id: 'verification',
    path: '/site-admin/verification',
    scope: 'verification',
    ar: 'توثيق الحسابات',
    en: 'Verification',
  },
  {
    id: 'notifications',
    path: '/site-admin/notifications',
    scope: null,
    ar: 'قوالب الإشعارات',
    en: 'Notification templates',
  },
  {
    id: 'badges',
    path: '/site-admin/badges',
    scope: null,
    ar: 'الشارات',
    en: 'Badges',
  },
  {
    id: 'apiKeys',
    path: '/site-admin/api-keys',
    scope: null,
    ar: 'مفاتيح API',
    en: 'API keys',
  },
  {
    id: 'labReset',
    path: '/site-admin/lab-reset',
    scope: null,
    ar: 'إعادة ضبط التجارب',
    en: 'Lab reset',
  },
  {
    id: 'delegates',
    path: '/site-admin/delegates',
    scope: 'delegates',
    ar: 'التفويض',
    en: 'Delegation',
  },
];

export type SiteAdminAccess = {
  /** Platform administrators and the complaint-inbox emails; they may grant any scope. */
  root: boolean;
  scopes: AdminScope[];
};

/** Sections this account may see in the site console (never shown in owner/tenant portals). */
export function siteConsoleSectionsFor(access: SiteAdminAccess) {
  return SITE_CONSOLE_SECTIONS.filter(
    (section) => section.scope === null || access.scopes.includes(section.scope),
  );
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
