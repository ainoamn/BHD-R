/** Client-safe shapes and labels for the requests a tenant sends their landlord about a lease. */

import type { ChargePayment } from '@/lib/tenant-charges-shared';

export const TENANT_REQUEST_TYPES = [
  'maintenance',
  'cheque_postpone',
  'cheque_stop',
  'lease_cancel',
  'lease_renew',
  'contract_amend',
  'payment_arrangement',
  'report_property',
  'report_staff',
  'other',
] as const;
export type TenantRequestType = (typeof TENANT_REQUEST_TYPES)[number];

/** What makes a maintenance request urgent enough to bypass the arrears rule. */
export const EMERGENCY_SCOPES = ['building', 'safety', 'occupants'] as const;
export type EmergencyScope = (typeof EMERGENCY_SCOPES)[number];

/** Photos a tenant may attach to a maintenance request or a report. */
export const TENANT_REQUEST_PHOTOS_MAX = 4;

export const TENANT_REQUEST_SOURCE = 'tenant_portal';

/**
 * Photos and videos added to a request after it is sent: the tenant's own (`report`), the
 * maintenance team's while working (`work`), and the closing proof — a photo of the fixed problem
 * (`after`) and a selfie of whoever fixed it (`selfie`).
 */
export const REQUEST_MEDIA_STAGES = ['report', 'work', 'after', 'selfie'] as const;
export type RequestMediaStage = (typeof REQUEST_MEDIA_STAGES)[number];
export const REQUEST_MEDIA_MAX = 16;
/** Uploads go through one serverless request, whose body cannot pass 4.5 MB. */
export const REQUEST_VIDEO_MAX_BYTES = 4_000_000;
export const REQUEST_PHOTO_UPLOAD_MAX_BYTES = 4_000_000;

export type RequestMedia = {
  id: string;
  kind: 'photo' | 'video';
  stage: RequestMediaStage;
  by: 'tenant' | 'team';
  name: string | null;
  at: string;
};

export function isRequestMediaStage(value: unknown): value is RequestMediaStage {
  return typeof value === 'string' && (REQUEST_MEDIA_STAGES as readonly string[]).includes(value);
}

/** What the team still owes before a maintenance request may be closed. */
export function closureProofMissing(media: readonly RequestMedia[]): Array<'after' | 'selfie'> {
  const has = (stage: RequestMediaStage) =>
    media.some((item) => item.stage === stage && item.kind === 'photo' && item.by === 'team');
  return (['after', 'selfie'] as const).filter((stage) => !has(stage));
}

export function requestMediaStageLabel(stage: RequestMediaStage, ar: boolean): string {
  const labels: Record<RequestMediaStage, { ar: string; en: string }> = {
    report: { ar: 'من المستأجر', en: 'From the tenant' },
    work: { ar: 'أثناء العمل', en: 'During the work' },
    after: { ar: 'بعد الإصلاح', en: 'After the fix' },
    selfie: { ar: 'سيلفي من أنجز العمل', en: 'Selfie of who fixed it' },
  };
  return ar ? labels[stage].ar : labels[stage].en;
}

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
  /** An urgent maintenance request about the building or people's safety, and management's check. */
  emergency: { scope: EmergencyScope; verified: boolean | null } | null;
  photoCount: number;
  /** For a report about the company's staff: who it is about, as the tenant wrote it. */
  staffName: string | null;
  /** Maintenance accepted at the tenant's cost, billed as an invoice on the lease. */
  charge: TenantRequestCharge | null;
  media: RequestMedia[];
};

export type TenantRequestCharge = {
  invoiceId: string;
  invoiceNumber: string;
  amountMinor: string;
  currency: string;
  payment: ChargePayment;
  dueOn: string;
  paidAt: string | null;
};

/** A request as the landlord's team sees it, with who sent it and from which property. */
export type OwnerTenantRequest = TenantRequest & {
  tenantName: string | null;
  propertyId: string | null;
  propertyNameAr: string | null;
  propertyNameEn: string | null;
  /** What the tenant is late on for this lease, when anything. */
  arrearsMinor: string | null;
};

const TYPE_LABEL: Record<TenantRequestType, { ar: string; en: string }> = {
  maintenance: { ar: 'طلب صيانة', en: 'Maintenance' },
  cheque_postpone: { ar: 'تأجيل شيك', en: 'Postpone a cheque' },
  cheque_stop: { ar: 'إيقاف شيك', en: 'Stop a cheque' },
  lease_cancel: { ar: 'إلغاء عقد الإيجار', en: 'Cancel the lease' },
  lease_renew: { ar: 'تجديد عقد الإيجار', en: 'Renew the lease' },
  contract_amend: { ar: 'تعديل بنود العقد', en: 'Amend the contract' },
  payment_arrangement: { ar: 'ترتيب سداد / تقسيط', en: 'Payment arrangement' },
  report_property: { ar: 'بلاغ عن العقار', en: 'Report about the property' },
  report_staff: { ar: 'بلاغ عن موظف لدى الشركة', en: 'Report about a staff member' },
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
  report_property: {
    ar: 'صف ما لاحظته في العقار (مخالفة، إزعاج، خطر، ضرر في المرافق المشتركة) ومكانه ووقته، وأرفق صوراً إن أمكن.',
    en: 'Describe what you noticed at the property (a violation, nuisance, hazard or damage to shared areas), where and when, with photos if you can.',
  },
  report_staff: {
    ar: 'اذكر اسم الموظف أو وصفه، وما حدث ومتى. يصل البلاغ إلى إدارة الشركة فقط ويُعامل بسرية.',
    en: 'Name or describe the staff member, what happened and when. Only the company’s management sees it, in confidence.',
  },
  other: { ar: 'اكتب طلبك بوضوح.', en: 'Write your request clearly.' },
};

const EMERGENCY_LABEL: Record<EmergencyScope, { ar: string; en: string }> = {
  building: {
    ar: 'سلامة المبنى (تسرب، كهرباء، حريق، انهيار)',
    en: 'The building (leak, power, fire, structure)',
  },
  safety: { ar: 'خطر على السلامة العامة', en: 'A public-safety hazard' },
  occupants: { ar: 'خطر على القاطنين في المبنى', en: 'A danger to the building’s occupants' },
};

export function emergencyScopeLabel(scope: EmergencyScope, ar: boolean): string {
  return ar ? EMERGENCY_LABEL[scope].ar : EMERGENCY_LABEL[scope].en;
}

/** Reports carry no lease effect: they go to the people who manage the property or the staff. */
export function isTenantReport(type: TenantRequestType): boolean {
  return type === 'report_property' || type === 'report_staff';
}

/** Types the tenant may attach photos to. */
export function requestTakesPhotos(type: TenantRequestType): boolean {
  return type === 'maintenance' || isTenantReport(type);
}

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
    emergency: emergencyOf(meta.emergency),
    photoCount:
      typeof meta.photoCount === 'number' && Number.isInteger(meta.photoCount)
        ? Math.max(0, Math.min(TENANT_REQUEST_PHOTOS_MAX, meta.photoCount))
        : 0,
    staffName: text(meta.staffName),
    charge: chargeOf(meta.charge),
    media: mediaOf(meta.media),
  };
}

function mediaOf(value: unknown): RequestMedia[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry) => {
    const item = entry && typeof entry === 'object' ? (entry as Record<string, unknown>) : null;
    const id = text(item?.id);
    if (!item || !id || !isRequestMediaStage(item.stage)) return [];
    return [
      {
        id,
        kind: item.kind === 'video' ? ('video' as const) : ('photo' as const),
        stage: item.stage,
        by: item.by === 'team' ? ('team' as const) : ('tenant' as const),
        name: text(item.name),
        at: text(item.at) ?? '',
      },
    ];
  });
}

function emergencyOf(value: unknown): TenantRequest['emergency'] {
  const item = value && typeof value === 'object' ? (value as Record<string, unknown>) : null;
  if (!item || !(EMERGENCY_SCOPES as readonly unknown[]).includes(item.scope)) return null;
  return {
    scope: item.scope as EmergencyScope,
    verified: typeof item.verified === 'boolean' ? item.verified : null,
  };
}

function chargeOf(value: unknown): TenantRequestCharge | null {
  const item = value && typeof value === 'object' ? (value as Record<string, unknown>) : null;
  const invoiceId = text(item?.invoiceId);
  const invoiceNumber = text(item?.invoiceNumber);
  const amountMinor = text(item?.amountMinor);
  if (!item || !invoiceId || !invoiceNumber || !amountMinor) return null;
  return {
    invoiceId,
    invoiceNumber,
    amountMinor,
    currency: text(item.currency) ?? 'OMR',
    payment: item.payment === 'before_work' ? 'before_work' : 'deferred',
    dueOn: text(item.dueOn) ?? '',
    paidAt: text(item.paidAt),
  };
}

/** Accepted maintenance that waits for the tenant to pay its cost before the work starts. */
export function requestAwaitsPayment(request: Pick<TenantRequest, 'charge' | 'status'>): boolean {
  return (
    request.status === 'on_hold' &&
    request.charge?.payment === 'before_work' &&
    !request.charge.paidAt
  );
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
  tenant_request_arrears: {
    ar: 'عليك مبالغ متأخرة على هذا العقد؛ سدّدها أولاً لتُفتح لك طلبات الصيانة العادية. يبقى بإمكانك تقديم طلب صيانة مستعجل يخص سلامة المبنى أو القاطنين.',
    en: 'You have overdue amounts on this lease; settle them first to open ordinary maintenance requests. You can still send an urgent request about the building’s or occupants’ safety.',
  },
  tenant_request_photos: {
    ar: 'تعذّر قبول الصور: أرفق حتى 4 صور بصيغة JPG أو PNG وبحجم معقول.',
    en: 'The photos could not be accepted: attach up to 4 JPG or PNG photos of reasonable size.',
  },
  tenant_request_media: {
    ar: 'تعذّر قبول الملف: أرفق صورة (JPG أو PNG أو WebP) أو مقطع فيديو قصيراً (MP4 أو MOV أو WebM) لا يتجاوز 4 ميغابايت.',
    en: 'The file could not be accepted: attach a photo (JPG, PNG or WebP) or a short video (MP4, MOV or WebM) up to 4 MB.',
  },
  tenant_request_proof: {
    ar: 'لإغلاق طلب الصيانة أرفق أولاً صورة تُثبت أن المشكلة حُلّت، وصورة سيلفي لمن أنجز العمل.',
    en: 'To close a maintenance request, first attach a photo proving the fix and a selfie of whoever did the work.',
  },
  storage_unavailable: {
    ar: 'تخزين الملفات غير متاح الآن، أعد المحاولة لاحقاً.',
    en: 'File storage is unavailable right now; try again later.',
  },
  tenant_charge_invalid: {
    ar: 'أكمل بيانات المطالبة: النوع والمبلغ وتاريخ الاستحقاق.',
    en: 'Complete the charge: category, amount and due date.',
  },
  tenant_charge_paid: {
    ar: 'هذه المطالبة مسددة بالكامل.',
    en: 'This charge is already paid in full.',
  },
  forbidden: { ar: 'ليست لديك صلاحية على هذا الطلب.', en: 'You may not act on this request.' },
  rate_limited: { ar: 'محاولات كثيرة، انتظر دقيقة.', en: 'Too many attempts; wait a minute.' },
};

export function tenantRequestErrorText(code: string | null | undefined, ar: boolean): string {
  const text = code ? TENANT_REQUEST_ERRORS[code] : undefined;
  if (text) return ar ? text.ar : text.en;
  return ar ? 'تعذّر إتمام الطلب، أعد المحاولة.' : 'The request failed; try again.';
}
