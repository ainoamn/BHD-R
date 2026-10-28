/**
 * How website bookings move after the customer pays — separate settings for each contract type:
 * daily stay, long-term lease, and purchase.
 */

export type ApprovalMode = 'manual' | 'auto';

/** Contract kinds that each have their own approval / e-sign / viewing automation settings. */
export type ContractApprovalKind = 'daily' | 'rent' | 'sale';

export const CONTRACT_APPROVAL_KINDS = ['daily', 'rent', 'sale'] as const;

/** Lease form fields that may wait until after tenant e-sign and before handover. */
export type DeferredLeaseField = 'meters' | 'handoverOn';

export const DEFERRED_LEASE_FIELDS = ['meters', 'handoverOn'] as const;

export type ApprovalPolicy = {
  /** Approve a paid, signed booking. */
  booking: ApprovalMode;
  /**
   * Create / approve the contract electronically (stays: on booking confirm;
   * long-term: when required documents are in), or leave it for the owner to issue by hand.
   */
  contract: ApprovalMode;
  /** Trust the payment channel's success report, or confirm receipt of the money by hand. */
  payment: ApprovalMode;
  /**
   * Guest asks to change stay dates/period: system applies immediately, or the owner
   * must approve first. Synced to stay profile `autoApproveReschedule` for daily only.
   */
  reschedule: ApprovalMode;
  /**
   * Long-term leases: fields left empty at contract prep, filled at handover
   * (after the tenant e-signs).
   */
  deferUntilHandover: DeferredLeaseField[];
  /**
   * Tenant must confirm document accuracy and accept cancel-if-invalid risk
   * before uploading docs/cheques or signing the lease.
   */
  requireTenantAttestation: boolean;
  /**
   * Long-term leases: allow premises handover while auto-accepted documents/cheques
   * still await manual verification. Review remains required either way; default blocks handover.
   */
  allowHandoverBeforeDocVerify: boolean;
  /** Require the customer / tenant electronic signature on this contract type. */
  electronicSignature: boolean;
  /**
   * Viewing requests: when the guest picks a preferred time, confirm it automatically
   * and notify owner, staff, and guard — or leave scheduling to the desk.
   */
  viewingAutoSchedule: boolean;
};

export type ApprovalPolicySource = 'property' | 'organization' | 'default' | 'legacy';

/** Building row for the settings desk per-property override list (client-safe). */
export type ApprovalPolicyBuildingRow = {
  id: string;
  nameAr: string;
  nameEn: string;
  /** Contract kinds that already have a property-level override (not inheriting org). */
  overrideKinds: ContractApprovalKind[];
};

export const APPROVAL_STEPS = ['booking', 'contract', 'payment', 'reschedule'] as const;

export type ApprovalStep = (typeof APPROVAL_STEPS)[number];

export const DEFAULT_APPROVAL_POLICY: ApprovalPolicy = {
  booking: 'manual',
  contract: 'auto',
  payment: 'auto',
  reschedule: 'auto',
  deferUntilHandover: [],
  requireTenantAttestation: true,
  allowHandoverBeforeDocVerify: false,
  electronicSignature: true,
  viewingAutoSchedule: false,
};

/** Defaults tuned per contract kind when nothing is saved yet. */
export const DEFAULT_APPROVAL_POLICY_BY_KIND: Record<ContractApprovalKind, ApprovalPolicy> = {
  daily: {
    booking: 'auto',
    contract: 'auto',
    payment: 'auto',
    reschedule: 'auto',
    deferUntilHandover: [],
    requireTenantAttestation: false,
    allowHandoverBeforeDocVerify: false,
    electronicSignature: true,
    viewingAutoSchedule: false,
  },
  rent: {
    booking: 'manual',
    contract: 'auto',
    payment: 'auto',
    reschedule: 'auto',
    deferUntilHandover: [],
    requireTenantAttestation: true,
    allowHandoverBeforeDocVerify: false,
    electronicSignature: true,
    viewingAutoSchedule: false,
  },
  sale: {
    booking: 'manual',
    contract: 'manual',
    payment: 'auto',
    reschedule: 'auto',
    deferUntilHandover: [],
    requireTenantAttestation: true,
    allowHandoverBeforeDocVerify: false,
    electronicSignature: true,
    viewingAutoSchedule: false,
  },
};

/** One-click preset: system handles every approval step electronically. */
export const FULL_AUTO_APPROVAL_POLICY: ApprovalPolicy = {
  booking: 'auto',
  contract: 'auto',
  payment: 'auto',
  reschedule: 'auto',
  deferUntilHandover: ['meters', 'handoverOn'],
  requireTenantAttestation: true,
  allowHandoverBeforeDocVerify: false,
  electronicSignature: true,
  viewingAutoSchedule: true,
};

export const SYSTEM_APPROVER_AR = 'النظام — اعتماد إلكتروني نيابةً عن المالك';
export const SYSTEM_APPROVER_EN = 'System — approved electronically for the owner';

export function isContractApprovalKind(value: unknown): value is ContractApprovalKind {
  return value === 'daily' || value === 'rent' || value === 'sale';
}

export function sanitizeApprovalPolicy(
  value: unknown,
  kind: ContractApprovalKind = 'rent',
): ApprovalPolicy {
  const fallback = DEFAULT_APPROVAL_POLICY_BY_KIND[kind];
  const source = value && typeof value === 'object' ? (value as Record<string, unknown>) : {};
  const pick = (step: ApprovalStep): ApprovalMode =>
    source[step] === 'auto' || source[step] === 'manual' ? source[step] : fallback[step];
  const deferRaw = Array.isArray(source.deferUntilHandover) ? source.deferUntilHandover : [];
  const deferUntilHandover = deferRaw
    .map((item) => String(item))
    .filter((item): item is DeferredLeaseField =>
      (DEFERRED_LEASE_FIELDS as readonly string[]).includes(item),
    )
    .filter((item, index, all) => all.indexOf(item) === index);
  return {
    booking: pick('booking'),
    contract: pick('contract'),
    payment: pick('payment'),
    reschedule: pick('reschedule'),
    deferUntilHandover: kind === 'rent' ? deferUntilHandover : [],
    requireTenantAttestation:
      kind === 'daily'
        ? source.requireTenantAttestation === true
        : source.requireTenantAttestation !== false,
    allowHandoverBeforeDocVerify:
      kind === 'rent' ? source.allowHandoverBeforeDocVerify === true : false,
    electronicSignature: source.electronicSignature !== false,
    viewingAutoSchedule: source.viewingAutoSchedule === true,
  };
}

export function contractApprovalKindLabel(kind: ContractApprovalKind, ar: boolean): string {
  const labels: Record<ContractApprovalKind, [string, string]> = {
    daily: ['عقد التأجير اليومي', 'Daily rental contract'],
    rent: ['عقد التأجير طويل الأجل', 'Long-term lease contract'],
    sale: ['عقد الشراء', 'Purchase contract'],
  };
  return labels[kind][ar ? 0 : 1];
}

export function contractApprovalKindHint(kind: ContractApprovalKind, ar: boolean): string {
  const hints: Record<ContractApprovalKind, [string, string]> = {
    daily: [
      'إقامات قصيرة: اعتماد الحجز، العقد الإلكتروني، الدفع، تعديل التواريخ، والتوقيع الإلكتروني.',
      'Short stays: booking approval, e-contract, payment, date changes, and e-signature.',
    ],
    rent: [
      'إيجار سنوي/شهري: اعتماد الحجز والعقد والمستندات، التوقيع الإلكتروني، وأتمتة مواعيد المعاينة.',
      'Long-term rent: booking and contract approval, docs, e-signature, and viewing automation.',
    ],
    sale: [
      'شراء الوحدة: اعتماد العربون والعقد، التوقيع الإلكتروني، وأتمتة مواعيد المعاينة للمهتمين.',
      'Unit purchase: deposit and contract approval, e-signature, and viewing automation for buyers.',
    ],
  };
  return hints[kind][ar ? 0 : 1];
}

export function deferredLeaseFieldLabel(field: DeferredLeaseField, ar: boolean): string {
  const labels: Record<DeferredLeaseField, [string, string]> = {
    meters: ['قراءات عداد الكهرباء والماء', 'Electricity and water meter readings'],
    handoverOn: ['تاريخ استلام الوحدة / فترة السماح', 'Unit handover date / grace period'],
  };
  return labels[field][ar ? 0 : 1];
}

export function approvalStepLabel(step: ApprovalStep, ar: boolean): string {
  const labels: Record<ApprovalStep, [string, string]> = {
    booking: ['اعتماد الحجز بعد الدفع', 'Booking approval after payment'],
    contract: [
      'إنشاء العقد إلكترونياً أو يدوياً',
      'Create the contract electronically or manually',
    ],
    payment: ['تأكيد استلام مبلغ العربون أو الضمان', 'Confirming the deposit was received'],
    reschedule: [
      'اعتماد تعديل الحجز (التواريخ / الفترة)',
      'Approve booking changes (dates / period)',
    ],
  };
  return labels[step][ar ? 0 : 1];
}

export function approvalStepHelp(step: ApprovalStep, mode: ApprovalMode, ar: boolean): string {
  const text: Record<ApprovalStep, Record<ApprovalMode, [string, string]>> = {
    booking: {
      auto: [
        'بعد أن يدفع العميل ويوقّع اتفاقية الحجز يعتمد النظام الحجز نيابةً عنك مباشرة.',
        'Once the client pays and signs, the system approves the booking for you.',
      ],
      manual: [
        'يصلك تنبيه وتعتمد الحجز بنفسك بعد مراجعته.',
        'You are notified and approve the booking yourself.',
      ],
    },
    contract: {
      auto: [
        'ينشئ النظام العقد ويوقّعه باسمك وفق صلاحياتك عندما تكتمل شروط الاعتماد لهذا النوع.',
        'The system creates and signs the contract in your name when this type’s approval conditions are met.',
      ],
      manual: [
        'لا يُنشأ العقد تلقائياً — تنشئه أو تعتمده بنفسك من الحجوزات أو العقود.',
        'No automatic contract — you issue or approve it yourself from bookings or contracts.',
      ],
    },
    payment: {
      auto: [
        'متى أبلغت قناة الدفع بنجاح العملية يُعتمد الطلب مباشرة.',
        'As soon as the payment channel reports success, the request goes ahead.',
      ],
      manual: [
        'يبقى الطلب بانتظار تأكيدك استلام المبلغ قبل اعتماده.',
        'The request waits until you confirm the money was received.',
      ],
    },
    reschedule: {
      auto: [
        'عندما يطلب العميل تغيير التواريخ أو الفترة يعتمد النظام التعديل فوراً ويصلك تنبيه.',
        'When a guest asks to change dates or period, the system applies it at once and notifies you.',
      ],
      manual: [
        'يصلك طلب التعديل في الاعتمادات، وتعتمده أو ترفضه بنفسك قبل تطبيقه.',
        'You get the change request in approvals, and you approve or reject it before it applies.',
      ],
    },
  };
  return text[step][mode][ar ? 0 : 1];
}

/** Steps shown in the settings UI for each contract kind. */
export function approvalStepsForKind(kind: ContractApprovalKind): ApprovalStep[] {
  if (kind === 'sale') return ['booking', 'contract', 'payment'];
  if (kind === 'rent') return ['booking', 'contract', 'payment'];
  return ['booking', 'contract', 'payment', 'reschedule'];
}
