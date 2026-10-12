/**
 * Organization team: staff roles, what each may assign, and the extra capabilities an owner
 * can grant on top of a role. Shared by the team routes and the team page.
 */
import type { Permission } from '@bhd-r/authz';

export type StaffRole =
  | 'organization_admin'
  | 'developer_admin'
  | 'property_manager'
  | 'finance_manager'
  | 'maintenance_agent'
  | 'auditor';

export const STAFF_ROLES: readonly StaffRole[] = [
  'organization_admin',
  'property_manager',
  'finance_manager',
  'maintenance_agent',
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
  auditor: 10,
  platform_support: 5,
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
    ar: 'مدير إداري',
    en: 'Administrator',
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
  maintenance_agent: {
    ar: 'فني صيانة',
    en: 'Maintenance',
    hintAr: 'طلبات الصيانة وأوامر العمل فقط.',
    hintEn: 'Maintenance requests and work orders only.',
  },
  auditor: {
    ar: 'مدقق (قراءة فقط)',
    en: 'Auditor (read-only)',
    hintAr: 'يطّلع على كل شيء دون تعديل.',
    hintEn: 'Sees everything, changes nothing.',
  },
};

export function roleLabel(role: string, ar: boolean): string {
  if (role === 'tenant') return ar ? 'مستأجر' : 'Tenant';
  const label = ROLE_LABELS[role];
  return label ? (ar ? label.ar : label.en) : role;
}

export type TeamCapability = {
  id: string;
  ar: string;
  en: string;
  permissions: readonly Permission[];
};

/** Extra permissions grouped as tasks an owner recognises. */
export const TEAM_CAPABILITIES: readonly TeamCapability[] = [
  {
    id: 'bookings',
    ar: 'إدارة الحجوزات والدخول والمغادرة',
    en: 'Manage bookings, check-in and check-out',
    permissions: ['stay.booking.read', 'stay.booking.manage'],
  },
  {
    id: 'refund_approve',
    ar: 'اعتماد أو رفض استرداد التأمين',
    en: 'Approve or reject deposit refunds',
    permissions: ['stay.booking.read', 'stay.refund.approve'],
  },
  {
    id: 'refund_transfer',
    ar: 'تحويل التأمين المعتمد (الحسابات)',
    en: 'Transfer approved deposits (Accounting)',
    permissions: ['payment.read', 'payment.refund'],
  },
  {
    id: 'payments',
    ar: 'تسجيل المدفوعات وتأكيد دفعات الحجوزات',
    en: 'Record payments and confirm booking payments',
    permissions: ['payment.read', 'payment.record', 'finance.booking_payment.confirm'],
  },
  {
    id: 'contracts_sign',
    ar: 'اعتماد العقود وتوقيعها باسم المالك',
    en: 'Approve and sign contracts for the owner',
    permissions: ['contract.read', 'contract.sign'],
  },
  {
    id: 'properties',
    ar: 'تعديل العقارات والوحدات ونشرها',
    en: 'Edit, and publish, properties and units',
    permissions: ['property.read', 'property.update', 'unit.read', 'unit.update', 'unit.publish'],
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
];

export type TeamMember = {
  userId: string;
  displayName: string;
  email: string;
  /** Owner or the member's staff role. */
  role: string;
  status: 'active' | 'inactive';
  /** Capability ids granted on top of the role. */
  extras: string[];
  /** Has signed in with their BHD account at least once. */
  signedIn: boolean;
  createdAt: string;
  isSelf: boolean;
};

export type TeamView = {
  members: TeamMember[];
  seats: { used: number; limit: number; plan: string };
  canManage: boolean;
  assignableRoles: StaffRole[];
  grantableCapabilities: string[];
  /** Capabilities each role already includes, shown ticked and locked. */
  roleCapabilities: Record<string, string[]>;
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

/** Roles the actor may give: never above their own, admin roles by the owner only. */
export function assignableRoles(actorRoles: readonly string[]): StaffRole[] {
  const owner = actorRoles.includes('organization_owner') || actorRoles.includes('platform_admin');
  const rank = highestRank(actorRoles);
  return STAFF_ROLES.filter(
    (role) => (ROLE_RANK[role] ?? 0) <= rank && (owner || !OWNER_ONLY_ROLES.has(role)),
  );
}

/** Whether the actor outranks (or equals) a member, so they may change them. */
export function canManageMember(actorRoles: readonly string[], memberRole: string): boolean {
  if (memberRole === 'organization_owner') return false;
  const owner = actorRoles.includes('organization_owner') || actorRoles.includes('platform_admin');
  if (OWNER_ONLY_ROLES.has(memberRole) && !owner) return false;
  return (ROLE_RANK[memberRole] ?? 0) <= highestRank(actorRoles);
}

/** Capabilities the actor holds in full, so granting them is never an escalation. */
export function grantableCapabilities(
  actorPermissions: readonly string[],
  actorRoles: readonly string[],
): string[] {
  const owner = actorRoles.includes('organization_owner') || actorRoles.includes('platform_admin');
  return TEAM_CAPABILITIES.filter(
    (capability) =>
      (capability.id !== 'team' || owner) &&
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

export function validTeamEmail(value: string): boolean {
  const email = value.trim();
  return email.length <= 320 && /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email);
}
