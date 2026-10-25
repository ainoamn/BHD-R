/**
 * How a property's website bookings move after the customer pays: each step is approved by the
 * owner (or whoever represents them) by hand, or by the system on their behalf.
 */

export type ApprovalMode = 'manual' | 'auto';

/** Lease form fields that may wait until after tenant e-sign and before handover. */
export type DeferredLeaseField = 'meters' | 'handoverOn';

export const DEFERRED_LEASE_FIELDS = ['meters', 'handoverOn'] as const;

export type ApprovalPolicy = {
  /** Approve a paid, signed booking. */
  booking: ApprovalMode;
  /**
   * Create / approve the lease contract electronically (stays: on booking confirm;
   * long-term: when required documents are in), or leave it for the owner to issue by hand.
   */
  contract: ApprovalMode;
  /** Trust the payment channel's success report, or confirm receipt of the money by hand. */
  payment: ApprovalMode;
  /**
   * Guest asks to change stay dates/period: system applies immediately, or the owner
   * must approve first. Synced to stay profile `autoApproveReschedule`.
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
};

export type ApprovalPolicySource = 'property' | 'organization' | 'default';

export const APPROVAL_STEPS = ['booking', 'contract', 'payment', 'reschedule'] as const;

export type ApprovalStep = (typeof APPROVAL_STEPS)[number];

export const DEFAULT_APPROVAL_POLICY: ApprovalPolicy = {
  booking: 'manual',
  /** Stay leases are issued electronically on confirm unless the owner opts into manual. */
  contract: 'auto',
  payment: 'auto',
  reschedule: 'auto',
  deferUntilHandover: [],
  requireTenantAttestation: true,
};

/** One-click preset: system handles every approval step electronically. */
export const FULL_AUTO_APPROVAL_POLICY: ApprovalPolicy = {
  booking: 'auto',
  contract: 'auto',
  payment: 'auto',
  reschedule: 'auto',
  deferUntilHandover: ['meters', 'handoverOn'],
  requireTenantAttestation: true,
};

export const SYSTEM_APPROVER_AR = 'النظام — اعتماد إلكتروني نيابةً عن المالك';
export const SYSTEM_APPROVER_EN = 'System — approved electronically for the owner';

export function sanitizeApprovalPolicy(value: unknown): ApprovalPolicy {
  const source = value && typeof value === 'object' ? (value as Record<string, unknown>) : {};
  const pick = (step: ApprovalStep): ApprovalMode =>
    source[step] === 'auto' || source[step] === 'manual'
      ? source[step]
      : DEFAULT_APPROVAL_POLICY[step];
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
    deferUntilHandover,
    requireTenantAttestation: source.requireTenantAttestation !== false,
  };
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
        'للإقامات اليومية: ينشئ النظام عقد الإيجار ويوقّعه باسمك فور اعتماد الحجز (دفع أو موافقة). للإيجار الطويل: حين تكتمل المستندات يعتمد العقد إلكترونياً ويبقى للفريق التحقق.',
        'Daily stays: the system creates and signs the lease when the booking is approved (payment or owner). Long-term: once documents are complete the contract is approved electronically; your team still verifies them.',
      ],
      manual: [
        'لا يُنشأ العقد تلقائياً — تنشئه أو تعتمده بنفسك من الحجوزات أو العقود. لا يمكن تسجيل وصول الضيف قبل وجود عقد.',
        'No automatic contract — you issue or approve it yourself from bookings or contracts. Guests cannot check in without a contract.',
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
        'عندما يطلب المستأجر تغيير التواريخ أو الفترة يعتمد النظام التعديل فوراً ويصلك تنبيه بأنه تمت موافقة إلكترونية.',
        'When a guest asks to change dates or period, the system applies it at once and notifies you of the electronic approval.',
      ],
      manual: [
        'يصلك طلب التعديل في الاعتمادات والحجوزات، وتعتمده أو ترفضه بنفسك قبل تطبيقه.',
        'You get the change request in approvals and bookings, and you approve or reject it before it applies.',
      ],
    },
  };
  return text[step][mode][ar ? 0 : 1];
}
