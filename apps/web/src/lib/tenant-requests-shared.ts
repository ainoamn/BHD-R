/** Client-safe shapes and labels for the requests a tenant sends their landlord about a lease. */

export const TENANT_REQUEST_TYPES = [
  'maintenance',
  'cheque_postpone',
  'cheque_stop',
  'lease_cancel',
  'lease_renew',
  'contract_amend',
  'payment_arrangement',
  'other',
] as const;
export type TenantRequestType = (typeof TENANT_REQUEST_TYPES)[number];

export const TENANT_REQUEST_SOURCE = 'tenant_portal';

export type TenantRequestStatus =
  'pending' | 'approved' | 'in_progress' | 'on_hold' | 'completed' | 'rejected' | 'cancelled';

export const OPEN_TENANT_REQUEST: ReadonlySet<string> = new Set([
  'pending',
  'approved',
  'in_progress',
  'on_hold',
]);

export type TenantRequestReply = {
  at: string;
  by: 'tenant' | 'owner';
  name: string | null;
  note: string;
  /** The status the owner moved the request to with this reply. */
  status?: TenantRequestStatus;
};

export type TenantRequest = {
  id: string;
  organizationId: string;
  reference: string;
  type: TenantRequestType;
  subject: string;
  description: string | null;
  priority: 'low' | 'normal' | 'high' | 'urgent';
  status: TenantRequestStatus;
  createdAt: string;
  updatedAt: string;
  leaseId: string | null;
  contractId: string | null;
  chequeId: string | null;
  chequeNumber: string | null;
  chequeDueOn: string | null;
  chequeAmountMinor: string | null;
  currency: string | null;
  proposedDate: string | null;
  unitCode: string | null;
  unitAr: string | null;
  unitEn: string | null;
  replies: TenantRequestReply[];
};

/** A request as the landlord's team sees it, with who sent it and from which property. */
export type OwnerTenantRequest = TenantRequest & {
  tenantName: string | null;
  propertyId: string | null;
  propertyNameAr: string | null;
  propertyNameEn: string | null;
};

const TYPE_LABEL: Record<TenantRequestType, { ar: string; en: string }> = {
  maintenance: { ar: 'طلب صيانة', en: 'Maintenance' },
  cheque_postpone: { ar: 'تأجيل شيك', en: 'Postpone a cheque' },
  cheque_stop: { ar: 'إيقاف شيك', en: 'Stop a cheque' },
  lease_cancel: { ar: 'إلغاء عقد الإيجار', en: 'Cancel the lease' },
  lease_renew: { ar: 'تجديد عقد الإيجار', en: 'Renew the lease' },
  contract_amend: { ar: 'تعديل بنود العقد', en: 'Amend the contract' },
  payment_arrangement: { ar: 'ترتيب سداد / تقسيط', en: 'Payment arrangement' },
  other: { ar: 'طلب آخر', en: 'Other request' },
};

const TYPE_HINT: Record<TenantRequestType, { ar: string; en: string }> = {
  maintenance: {
    ar: 'صف العطل ومكانه في العقار، ومتى يناسبك حضور الفني.',
    en: 'Describe the fault, where it is, and when a technician may come.',
  },
  cheque_postpone: {
    ar: 'اختر الشيك والتاريخ الجديد الذي تقترحه، واذكر السبب.',
    en: 'Pick the cheque and the new date you propose, with the reason.',
  },
  cheque_stop: {
    ar: 'اختر الشيك واذكر سبب طلب إيقافه وكيف ستسدد قيمته.',
    en: 'Pick the cheque, why it should be stopped and how you will pay it.',
  },
  lease_cancel: {
    ar: 'اذكر تاريخ الإخلاء الذي تقترحه وسبب الإلغاء. تُطبّق شروط الإنهاء في العقد.',
    en: 'Give the move-out date you propose and the reason. The contract’s exit terms apply.',
  },
  lease_renew: {
    ar: 'اذكر المدة التي ترغب بالتجديد لها وأي شروط تقترحها.',
    en: 'Say how long you would like to renew for and any terms you propose.',
  },
  contract_amend: {
    ar: 'حدّد البند الذي تريد تعديله والصياغة التي تقترحها.',
    en: 'Name the clause to change and the wording you propose.',
  },
  payment_arrangement: {
    ar: 'اذكر المبلغ والجدول الذي تقترحه للسداد.',
    en: 'Give the amount and the schedule you propose.',
  },
  other: { ar: 'اكتب طلبك بوضوح.', en: 'Write your request clearly.' },
};

const STATUS_LABEL: Record<TenantRequestStatus, { ar: string; en: string }> = {
  pending: { ar: 'بانتظار رد المالك', en: 'Awaiting the landlord' },
  approved: { ar: 'تمت الموافقة', en: 'Approved' },
  in_progress: { ar: 'قيد التنفيذ', en: 'In progress' },
  on_hold: { ar: 'معلّق', en: 'On hold' },
  completed: { ar: 'مكتمل', en: 'Completed' },
  rejected: { ar: 'مرفوض', en: 'Rejected' },
  cancelled: { ar: 'ألغاه المستأجر', en: 'Withdrawn' },
};

export function tenantRequestTypeLabel(type: TenantRequestType, ar: boolean): string {
  return ar ? TYPE_LABEL[type].ar : TYPE_LABEL[type].en;
}

export function tenantRequestTypeHint(type: TenantRequestType, ar: boolean): string {
  return ar ? TYPE_HINT[type].ar : TYPE_HINT[type].en;
}

export function tenantRequestStatusLabel(status: TenantRequestStatus, ar: boolean): string {
  return ar ? STATUS_LABEL[status].ar : STATUS_LABEL[status].en;
}

export function isTenantRequestType(value: unknown): value is TenantRequestType {
  return typeof value === 'string' && (TENANT_REQUEST_TYPES as readonly string[]).includes(value);
}

/** Types that are about one cheque, and so need one picked. */
export function requestNeedsCheque(type: TenantRequestType): boolean {
  return type === 'cheque_postpone' || type === 'cheque_stop';
}

/** Types that carry a proposed date: the new cheque date or the move-out date. */
export function requestNeedsDate(type: TenantRequestType): boolean {
  return type === 'cheque_postpone' || type === 'lease_cancel';
}

function text(value: unknown): string | null {
  return typeof value === 'string' && value ? value : null;
}

function stamp(value: unknown): string {
  return value instanceof Date ? value.toISOString() : typeof value === 'string' ? value : '';
}

const REQUEST_STATUSES: readonly TenantRequestStatus[] = [
  'pending',
  'approved',
  'in_progress',
  'on_hold',
  'completed',
  'rejected',
  'cancelled',
];
const PRIORITIES = ['low', 'normal', 'high', 'urgent'] as const;

function repliesOf(value: unknown): TenantRequestReply[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    const reply = item as Partial<TenantRequestReply> | null;
    if (!reply || typeof reply.note !== 'string' || typeof reply.at !== 'string') return [];
    return [
      {
        at: reply.at,
        by: reply.by === 'owner' ? ('owner' as const) : ('tenant' as const),
        name: text(reply.name),
        note: reply.note,
        ...(reply.status && REQUEST_STATUSES.includes(reply.status)
          ? { status: reply.status }
          : {}),
      },
    ];
  });
}

/** A stored `operational_requests` row (plus its unit's labels) as the tenant's request. */
export function tenantRequestFromRow(
  row: {
    id: string;
    reference: string;
    type: string;
    subject: string;
    description: string | null;
    priority: string;
    status: string;
    metadata: unknown;
    createdAt: unknown;
    updatedAt: unknown;
    unitCode: string | null;
    unitAr: string | null;
    unitEn: string | null;
  },
  organizationId: string,
): TenantRequest {
  const meta =
    row.metadata && typeof row.metadata === 'object' && !Array.isArray(row.metadata)
      ? (row.metadata as Record<string, unknown>)
      : {};
  const status = (REQUEST_STATUSES as readonly string[]).includes(row.status)
    ? (row.status as TenantRequestStatus)
    : 'pending';
  const priority = (PRIORITIES as readonly string[]).includes(row.priority)
    ? (row.priority as TenantRequest['priority'])
    : 'normal';
  return {
    id: row.id,
    organizationId,
    reference: row.reference,
    type: isTenantRequestType(row.type) ? row.type : 'other',
    subject: row.subject,
    description: row.description,
    priority,
    status,
    createdAt: stamp(row.createdAt),
    updatedAt: stamp(row.updatedAt),
    leaseId: text(meta.leaseId),
    contractId: text(meta.contractId),
    chequeId: text(meta.chequeId),
    chequeNumber: text(meta.chequeNumber),
    chequeDueOn: text(meta.chequeDueOn),
    chequeAmountMinor: text(meta.chequeAmountMinor),
    currency: text(meta.currency),
    proposedDate: text(meta.proposedDate),
    unitCode: row.unitCode,
    unitAr: row.unitAr,
    unitEn: row.unitEn,
    replies: repliesOf(meta.replies),
  };
}

const TENANT_REQUEST_ERRORS: Record<string, { ar: string; en: string }> = {
  tenant_request_invalid: {
    ar: 'أكمل بيانات الطلب: النوع والعنوان، والشيك والتاريخ إن لزم.',
    en: 'Complete the request: type and subject, plus the cheque and date when needed.',
  },
  tenant_request_not_found: { ar: 'الطلب غير موجود.', en: 'Request not found.' },
  tenant_request_closed: {
    ar: 'أُغلق هذا الطلب ولم يعد يقبل تغييرات.',
    en: 'This request is closed.',
  },
  tenant_request_duplicate: {
    ar: 'لديك طلب مفتوح من النوع نفسه على هذا الشيك أو العقد؛ تابعه أولاً.',
    en: 'You already have an open request of this kind for this cheque or lease.',
  },
  forbidden: { ar: 'ليست لديك صلاحية على هذا الطلب.', en: 'You may not act on this request.' },
  rate_limited: { ar: 'محاولات كثيرة، انتظر دقيقة.', en: 'Too many attempts; wait a minute.' },
};

export function tenantRequestErrorText(code: string | null | undefined, ar: boolean): string {
  const text = code ? TENANT_REQUEST_ERRORS[code] : undefined;
  if (text) return ar ? text.ar : text.en;
  return ar ? 'تعذّر إتمام الطلب، أعد المحاولة.' : 'The request failed; try again.';
}
