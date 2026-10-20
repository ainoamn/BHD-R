/**
 * Organization team: staff roles, what each may assign, the capabilities an owner can grant on
 * top of roles, and the organization's own saved roles. Shared by the team routes and page.
 */
import type { Permission } from '@bhd-r/authz';
import type { BadgeChip } from '@/lib/badges-shared';
import type { IdentityMark } from '@/lib/identity-shared';

/** Same as the authz package's prefix; that package is server-only (node crypto). */
const CUSTOM_ROLE_PREFIX = 'custom:';

export type StaffRole =
  | 'organization_admin'
  | 'developer_admin'
  | 'property_manager'
  | 'finance_manager'
  | 'admin_staff'
  | 'legal_counsel'
  | 'maintenance_agent'
  | 'building_guard'
  | 'auditor';

export const STAFF_ROLES: readonly StaffRole[] = [
  'organization_admin',
  'property_manager',
  'finance_manager',
  'admin_staff',
  'legal_counsel',
  'maintenance_agent',
  'building_guard',
  'auditor',
  'developer_admin',
];

/** Same ranking as the API: nobody assigns a role above their own. */
export const ROLE_RANK: Record<string, number> = {
  platform_admin: 100,
  organization_owner: 50,
  organization_admin: 40,
  developer_admin: 40,
  property_manager: 30,
  finance_manager: 30,
  maintenance_agent: 20,
  admin_staff: 20,
  legal_counsel: 20,
  building_guard: 15,
  auditor: 10,
  custom_member: 10,
  platform_support: 5,
  property_owner: 0,
  lawyer: 0,
  tenant: 0,
};

/** Admin-level roles only the organization owner may give. */
const OWNER_ONLY_ROLES = new Set<string>(['organization_admin', 'developer_admin']);

export const ROLE_LABELS: Record<
  string,
  { ar: string; en: string; hintAr: string; hintEn: string }
> = {
  organization_owner: {
    ar: 'المالك',
    en: 'Owner',
    hintAr: 'صاحب المنشأة، كل الصلاحيات.',
    hintEn: 'Owns the organization; every permission.',
  },
  organization_admin: {
    ar: 'مدير عام',
    en: 'General manager',
    hintAr: 'يدير العقارات والحجوزات والعقود والفريق، دون تحويل المبالغ أو اعتماد الاسترداد.',
    hintEn: 'Runs properties, bookings, contracts and the team; no transfers or refund approval.',
  },
  developer_admin: {
    ar: 'مدير مشاريع التطوير',
    en: 'Developer admin',
    hintAr: 'مشاريع التطوير والوحدات والمبيعات.',
    hintEn: 'Development projects, units and sales.',
  },
  property_manager: {
    ar: 'مدير عقارات',
    en: 'Property manager',
    hintAr: 'العقارات والوحدات والحجوزات والدخول والمغادرة والعقود والصيانة.',
    hintEn: 'Properties, units, bookings, check-in/out, contracts and maintenance.',
  },
  finance_manager: {
    ar: 'محاسب',
    en: 'Accountant',
    hintAr: 'الحسابات والفواتير والمدفوعات، وتحويل التأمين واعتماد الاسترداد.',
    hintEn: 'Accounting, invoices and payments, deposit transfers and refund approval.',
  },
  admin_staff: {
    ar: 'موظف إداري',
    en: 'Administrative staff',
    hintAr: 'الاستقبال والطلبات والمعاينات والحجوزات وجهات الاتصال، دون المالية أو العقود.',
    hintEn: 'Front desk, requests, viewings, bookings and contacts; no finance or contracts.',
  },
  legal_counsel: {
    ar: 'مستشار قانوني',
    en: 'Legal counsel',
    hintAr: 'العقود ونماذجها والقضايا القانونية ومراجعة الشيكات.',
    hintEn: 'Contracts and their templates, legal cases and cheque review.',
  },
  maintenance_agent: {
    ar: 'فني صيانة',
    en: 'Technician',
    hintAr: 'طلبات الصيانة وأوامر العمل فقط.',
    hintEn: 'Maintenance requests and work orders only.',
  },
  building_guard: {
    ar: 'حارس مبنى',
    en: 'Building guard',
    hintAr:
      'يرى الحجوزات والمعاينات القادمة ويمسح بطاقة الزائر، ويفتح الصيانة والمهام اليومية — دون إدارة الفريق أو القوالب أو المحفظة.',
    hintEn:
      'Sees upcoming bookings and viewings, scans visitor passes, and opens maintenance and daily tasks — not team admin, templates or the portfolio.',
  },
  auditor: {
    ar: 'مدقق (قراءة فقط)',
    en: 'Auditor (read-only)',
    hintAr: 'يطّلع على كل شيء دون تعديل.',
    hintEn: 'Sees everything, changes nothing.',
  },
  property_owner: {
    ar: 'مالك عقار',
    en: 'Property owner',
    hintAr: 'يرى عقاراته فقط: حجوزاتها وعقودها وفواتيرها وصيانتها.',
    hintEn: 'Sees only their own properties: bookings, contracts, invoices and maintenance.',
  },
  lawyer: {
    ar: 'محامٍ / مكتب محاماة',
    en: 'Lawyer / law firm',
    hintAr:
      'يرى القضايا المسندة إليه فقط: يحدّث مراحلها وجلساتها ومبالغها ويراسل فريقك ويرفق المستندات.',
    hintEn:
      'Sees only the cases assigned to them: updates stages, hearings and amounts, messages your team and attaches documents.',
  },
  custom_member: {
    ar: 'دور مخصص',
    en: 'Custom role',
    hintAr: 'صلاحيات يحددها المالك.',
    hintEn: 'Permissions chosen by the owner.',
  },
};

/** How the role guide groups the built-in staff roles. */
export const ROLE_GROUPS: readonly { id: string; ar: string; en: string; roles: StaffRole[] }[] = [
  {
    id: 'management',
    ar: 'الإدارة',
    en: 'Management',
    roles: ['organization_admin', 'property_manager', 'developer_admin'],
  },
  {
    id: 'finance',
    ar: 'المالية والتدقيق',
    en: 'Finance and audit',
    roles: ['finance_manager', 'auditor'],
  },
  {
    id: 'office',
    ar: 'الشؤون الإدارية والقانونية',
    en: 'Office and legal',
    roles: ['admin_staff', 'legal_counsel'],
  },
  { id: 'field', ar: 'الميدان', en: 'Field', roles: ['maintenance_agent', 'building_guard'] },
];

export type SavedRole = {
  id: string;
  nameAr: string;
  nameEn: string;
  description: string | null;
  /** Capability ids the role grants. */
  capabilities: string[];
  memberCount: number;
};

export function isCustomRoleKey(role: string): boolean {
  return role.startsWith(CUSTOM_ROLE_PREFIX);
}

export function savedRoleKey(roleId: string): string {
  return `${CUSTOM_ROLE_PREFIX}${roleId}`;
}

export function savedRoleId(role: string): string | null {
  return isCustomRoleKey(role) ? role.slice(CUSTOM_ROLE_PREFIX.length) : null;
}

export function roleLabel(
  role: string,
  ar: boolean,
  savedRoles: readonly Pick<SavedRole, 'id' | 'nameAr' | 'nameEn'>[] = [],
): string {
  if (role === 'tenant') return ar ? 'مستأجر' : 'Tenant';
  if (isCustomRoleKey(role)) {
    const saved = savedRoles.find((item) => role === savedRoleKey(item.id));
    return saved
      ? ar
        ? saved.nameAr
        : saved.nameEn || saved.nameAr
      : ar
        ? 'دور مخصص'
        : 'Custom role';
  }
  const label = ROLE_LABELS[role];
  return label ? (ar ? label.ar : label.en) : role;
}

export type TeamCapability = {
  id: string;
  ar: string;
  en: string;
  permissions: readonly Permission[];
};

export type CapabilityGroup = {
  id: string;
  ar: string;
  en: string;
  capabilities: readonly TeamCapability[];
};

/** Extra permissions, grouped as tasks an owner recognises; any subset may be granted. */
export const CAPABILITY_GROUPS: readonly CapabilityGroup[] = [
  {
    id: 'bookings',
    ar: 'الحجوزات والإقامة',
    en: 'Bookings and stays',
    capabilities: [
      {
        id: 'bookings_view',
        ar: 'عرض الحجوزات والمعاينات',
        en: 'See bookings and viewings',
        permissions: ['stay.booking.read', 'reservation.read', 'viewing.read'],
      },
      {
        id: 'bookings',
        ar: 'إدارة الحجوزات والدخول والمغادرة',
        en: 'Manage bookings, check-in and check-out',
        permissions: [
          'stay.booking.read',
          'stay.booking.manage',
          'reservation.read',
          'reservation.manage',
          'viewing.read',
          'viewing.manage',
        ],
      },
      {
        id: 'handover',
        ar: 'تسليم العقار للمستأجر بمسح رمزه',
        en: 'Hand over premises by scanning the tenant code',
        permissions: ['reservation.handover'],
      },
      {
        id: 'viewing_checkin',
        ar: 'مسح بطاقة المعاينة عند وصول الزائر',
        en: 'Scan viewing pass when a visitor arrives',
        permissions: ['viewing.checkin'],
      },
      {
        id: 'stay_rates',
        ar: 'الأسعار والتقويم وإعداد الإقامة اليومية',
        en: 'Rates, calendar and daily-stay setup',
        permissions: ['stay.rate.manage', 'stay.inventory.manage'],
      },
      {
        id: 'refund_approve',
        ar: 'اعتماد أو رفض استرداد التأمين',
        en: 'Approve or reject deposit refunds',
        permissions: ['stay.booking.read', 'stay.refund.approve'],
      },
    ],
  },
  {
    id: 'properties',
    ar: 'العقارات',
    en: 'Properties',
    capabilities: [
      {
        id: 'properties_view',
        ar: 'عرض العقارات والوحدات',
        en: 'See properties and units',
        permissions: ['property.read', 'unit.read', 'media.read'],
      },
      {
        id: 'properties',
        ar: 'تعديل العقارات والوحدات ونشرها',
        en: 'Edit and publish properties and units',
        permissions: [
          'property.read',
          'property.update',
          'unit.read',
          'unit.update',
          'unit.publish',
          'media.read',
          'media.create',
        ],
      },
      {
        id: 'properties_create',
        ar: 'إضافة عقارات ووحدات',
        en: 'Add properties and units',
        permissions: ['property.create', 'unit.create'],
      },
      {
        id: 'properties_archive',
        ar: 'أرشفة العقارات وحذفها',
        en: 'Archive and delete properties',
        permissions: ['property.archive'],
      },
    ],
  },
  {
    id: 'contracts',
    ar: 'العقود والتأجير والبيع',
    en: 'Contracts, leasing and sales',
    capabilities: [
      {
        id: 'contracts_view',
        ar: 'عرض العقود والإيجارات',
        en: 'See contracts and leases',
        permissions: ['contract.read', 'lease.read'],
      },
      {
        id: 'contracts_prepare',
        ar: 'إعداد العقود وإرسالها',
        en: 'Prepare and send contracts',
        permissions: [
          'contract.read',
          'contract.create',
          'contract.send',
          'lease.read',
          'lease.create',
        ],
      },
      {
        id: 'contracts_sign',
        ar: 'اعتماد العقود وتوقيعها باسم المالك',
        en: 'Approve and sign contracts for the owner',
        permissions: ['contract.read', 'contract.sign'],
      },
      {
        id: 'contract_templates',
        ar: 'نماذج العقود والشروط',
        en: 'Contract templates and terms',
        permissions: ['contract.template.read', 'contract.template.write'],
      },
      {
        id: 'sales',
        ar: 'إدارة البيع',
        en: 'Manage sales',
        permissions: ['sale.read', 'sale.manage'],
      },
    ],
  },
  {
    id: 'finance',
    ar: 'المالية (صلاحيات المحاسب منفصلة)',
    en: 'Finance (accountant powers, one by one)',
    capabilities: [
      {
        id: 'invoices_view',
        ar: 'عرض الفواتير والإيصالات',
        en: 'See invoices and receipts',
        permissions: ['invoice.read', 'receipt.read'],
      },
      {
        id: 'invoices_manage',
        ar: 'إصدار الفواتير وجداول الفوترة',
        en: 'Issue invoices and billing schedules',
        permissions: [
          'invoice.read',
          'invoice.create',
          'billing.schedule.read',
          'billing.schedule.manage',
        ],
      },
      {
        id: 'invoices_void',
        ar: 'إلغاء الفواتير',
        en: 'Void invoices',
        permissions: ['invoice.read', 'invoice.void'],
      },
      {
        id: 'payments_view',
        ar: 'عرض المدفوعات',
        en: 'See payments',
        permissions: ['payment.read', 'receipt.read'],
      },
      {
        id: 'payments',
        ar: 'تسجيل المدفوعات وتأكيد دفعات الحجوزات',
        en: 'Record payments and confirm booking payments',
        permissions: ['payment.read', 'payment.record', 'finance.booking_payment.confirm'],
      },
      {
        id: 'refund_transfer',
        ar: 'تحويل التأمين المعتمد',
        en: 'Transfer approved deposits',
        permissions: ['payment.read', 'payment.refund'],
      },
      {
        id: 'reconcile',
        ar: 'مطابقة المدفوعات',
        en: 'Reconcile payments',
        permissions: ['payment.read', 'payment.reconcile'],
      },
      {
        id: 'cheques',
        ar: 'الشيكات ومراجعتها',
        en: 'Cheques and their review',
        permissions: ['cheque.read', 'cheque.manage', 'cheque.review'],
      },
      {
        id: 'accounting_view',
        ar: 'عرض الحسابات والمصروفات',
        en: 'See accounting and expenses',
        permissions: ['accounting.read'],
      },
      {
        id: 'accounting_post',
        ar: 'القيود المحاسبية وإدارتها',
        en: 'Post and manage journal entries',
        permissions: ['accounting.read', 'accounting.manage', 'accounting.post'],
      },
    ],
  },
  {
    id: 'operations',
    ar: 'التشغيل والصيانة',
    en: 'Operations and maintenance',
    capabilities: [
      {
        id: 'requests',
        ar: 'الطلبات',
        en: 'Requests',
        permissions: ['request.read', 'request.create', 'request.update'],
      },
      {
        id: 'maintenance',
        ar: 'الصيانة وإسناد الطلبات',
        en: 'Maintenance and assigning requests',
        permissions: [
          'maintenance.read',
          'maintenance.create',
          'maintenance.assign',
          'maintenance.update',
        ],
      },
      {
        id: 'work_orders',
        ar: 'أوامر العمل والموردون',
        en: 'Work orders and vendors',
        permissions: ['work_order.read', 'work_order.manage', 'vendor.read', 'vendor.manage'],
      },
      {
        id: 'tasks',
        ar: 'المهام وإسنادها',
        en: 'Tasks and assigning them',
        permissions: ['task.read', 'task.create', 'task.assign', 'task.update'],
      },
    ],
  },
  {
    id: 'people',
    ar: 'جهات الاتصال والشؤون القانونية',
    en: 'Contacts and legal',
    capabilities: [
      {
        id: 'contacts_view',
        ar: 'عرض جهات الاتصال',
        en: 'See contacts',
        permissions: ['party.read'],
      },
      {
        id: 'contacts_manage',
        ar: 'إضافة جهات الاتصال وتعديلها',
        en: 'Add and edit contacts',
        permissions: ['party.read', 'party.write'],
      },
      {
        id: 'legal',
        ar: 'القضايا القانونية',
        en: 'Legal cases',
        permissions: ['legal.read', 'legal.manage'],
      },
      {
        id: 'approvals',
        ar: 'الموافقات واتخاذ القرار',
        en: 'Approvals and decisions',
        permissions: ['approval.read', 'approval.decide'],
      },
    ],
  },
  {
    id: 'organization',
    ar: 'التقارير والإدارة',
    en: 'Reports and administration',
    capabilities: [
      {
        id: 'reports',
        ar: 'التقارير وتصديرها',
        en: 'Reports and exports',
        permissions: ['report.read', 'report.export'],
      },
      {
        id: 'team',
        ar: 'إدارة الفريق',
        en: 'Manage the team',
        permissions: ['organization.members.read', 'organization.members.write'],
      },
    ],
  },
];

export const TEAM_CAPABILITIES: readonly TeamCapability[] = CAPABILITY_GROUPS.flatMap(
  (group) => group.capabilities,
);

/** Capabilities only the owner grants, because they hand over control of the team. */
const OWNER_ONLY_CAPABILITIES = new Set<string>(['team']);

export type TeamMember = {
  userId: string;
  displayName: string;
  email: string;
  /** Highest-ranked role, for ordering. */
  role: string;
  /** Every role held: built-in staff roles and 'custom:<id>' saved roles. */
  roles: string[];
  status: 'active' | 'inactive';
  /** Capability ids granted on top of the roles. */
  extras: string[];
  /** Has signed in with their BHD account at least once. */
  signedIn: boolean;
  createdAt: string;
  isSelf: boolean;
};

export type PropertyOwnerMember = {
  userId: string;
  displayName: string;
  email: string;
  partyId: string | null;
  partyName: string | null;
  propertyCount: number;
  status: 'active' | 'inactive';
  signedIn: boolean;
};

export type OwnerPartyChoice = { id: string; name: string; propertyCount: number };

export type LawyerMember = {
  userId: string;
  displayName: string;
  email: string;
  partyId: string | null;
  partyName: string | null;
  caseCount: number;
  status: 'active' | 'inactive';
  signedIn: boolean;
};

/** A lawyer or law firm contact; several lawyer accounts may work for one firm. */
export type LawyerPartyChoice = { id: string; name: string; caseCount: number };

/** Address-book people with email who can be invited into the staff team. */
export type TeamDirectoryContact = {
  partyId: string;
  displayName: string;
  email: string;
  phone: string | null;
};

export type TenantMember = {
  userId: string;
  displayName: string;
  email: string;
  partyName: string | null;
  status: 'active' | 'inactive';
  signedIn: boolean;
  createdAt: string;
};

/** Delivery of the latest invitation email to someone who has not signed in yet. */
export type TeamInvite = {
  state: 'sent' | 'sending' | 'failed';
  /** Sent time when sent, otherwise when it was queued. */
  at: string;
};

/** Minimum gap between two invitation emails to the same person. */
export const INVITE_RESEND_MINUTES = 10;

export type TeamView = {
  members: TeamMember[];
  owners: PropertyOwnerMember[];
  ownerParties: OwnerPartyChoice[];
  lawyers: LawyerMember[];
  lawyerParties: LawyerPartyChoice[];
  /** Address-book contacts (with email) not already on the staff team — for import. */
  directoryContacts: TeamDirectoryContact[];
  tenants: TenantMember[];
  savedRoles: SavedRole[];
  seats: { used: number; limit: number; plan: string };
  canManage: boolean;
  /** Only the owner creates or edits saved roles. */
  canEditRoles: boolean;
  assignableRoles: StaffRole[];
  /** Saved role ids the actor may give (they hold all of the role's permissions). */
  assignableSavedRoles: string[];
  grantableCapabilities: string[];
  /** Capabilities each role already includes, shown ticked and locked. */
  roleCapabilities: Record<string, string[]>;
  /** Latest invitation per user id, for people who have not signed in (managers only). */
  invites: Record<string, TeamInvite>;
  /** Sign-in link that opens this organization after BHD sign-in (managers only). */
  inviteUrl: string | null;
  organizationName: string;
  /** Verified tick and picture per user id. */
  marks?: Record<string, IdentityMark>;
  /** Current awards keyed by `badgeSubjectKey`: staff by user, owners by party. */
  badges?: Record<string, BadgeChip[]>;
};

export type OrganizationChoice = {
  organizationId: string;
  nameAr: string;
  nameEn: string;
  role: string;
  current: boolean;
};

function highestRank(roles: readonly string[]): number {
  return Math.max(0, ...roles.map((role) => ROLE_RANK[role] ?? 0));
}

function isOwner(actorRoles: readonly string[]): boolean {
  return actorRoles.includes('organization_owner') || actorRoles.includes('platform_admin');
}

/** Roles the actor may give: never above their own, admin roles by the owner only. */
export function assignableRoles(actorRoles: readonly string[]): StaffRole[] {
  const owner = isOwner(actorRoles);
  const rank = highestRank(actorRoles);
  return STAFF_ROLES.filter(
    (role) => (ROLE_RANK[role] ?? 0) <= rank && (owner || !OWNER_ONLY_ROLES.has(role)),
  );
}

/** Whether the actor outranks (or equals) a member, so they may change them. */
export function canManageMember(actorRoles: readonly string[], memberRole: string): boolean {
  if (memberRole === 'organization_owner') return false;
  if (OWNER_ONLY_ROLES.has(memberRole) && !isOwner(actorRoles)) return false;
  return (ROLE_RANK[memberRole] ?? 0) <= highestRank(actorRoles);
}

/** Highest-ranked of a member's roles; saved roles rank as custom members. */
export function primaryRole(roles: readonly string[]): string {
  const rank = (role: string) => ROLE_RANK[isCustomRoleKey(role) ? 'custom_member' : role] ?? 0;
  return [...roles].sort((a, b) => rank(b) - rank(a))[0] ?? '';
}

/** Capabilities the actor holds in full, so granting them is never an escalation. */
export function grantableCapabilities(
  actorPermissions: readonly string[],
  actorRoles: readonly string[],
): string[] {
  const owner = isOwner(actorRoles);
  return TEAM_CAPABILITIES.filter(
    (capability) =>
      (owner || !OWNER_ONLY_CAPABILITIES.has(capability.id)) &&
      capability.permissions.every((permission) => actorPermissions.includes(permission)),
  ).map((capability) => capability.id);
}

export function permissionsForCapabilities(ids: readonly string[]): Permission[] {
  const wanted = new Set(ids);
  return [
    ...new Set(
      TEAM_CAPABILITIES.filter((capability) => wanted.has(capability.id)).flatMap(
        (capability) => capability.permissions,
      ),
    ),
  ];
}

/** Capability ids whose permissions are all among the given permissions. */
export function capabilitiesFromPermissions(permissions: readonly string[]): string[] {
  const granted = new Set(permissions);
  return TEAM_CAPABILITIES.filter((capability) =>
    capability.permissions.every((permission) => granted.has(permission)),
  ).map((capability) => capability.id);
}

const OWNER_ONLY_PERMISSIONS = new Set<string>(['organization.members.write']);

/** A saved role may be given by someone who holds every permission in it. */
export function canAssignSavedRole(
  actorPermissions: readonly string[],
  actorRoles: readonly string[],
  rolePermissions: readonly string[],
): boolean {
  if (isOwner(actorRoles)) return true;
  if (rolePermissions.some((permission) => OWNER_ONLY_PERMISSIONS.has(permission))) return false;
  return rolePermissions.every((permission) => actorPermissions.includes(permission));
}

export { isPlausibleEmail as validTeamEmail, normalizeEmailInput } from '@/lib/email-address';
