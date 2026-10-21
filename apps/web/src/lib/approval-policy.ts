/**
 * How a property's website bookings move after the customer pays: each step is approved by the
 * owner (or whoever represents them) by hand, or by the system on their behalf.
 */

export type ApprovalMode = 'manual' | 'auto';

export type ApprovalPolicy = {
  /** Approve a paid, signed booking. */
  booking: ApprovalMode;
  /** Accept the required documents and approve the contract once they are all uploaded. */
  contract: ApprovalMode;
  /** Trust the payment channel's success report, or confirm receipt of the money by hand. */
  payment: ApprovalMode;
  /**
   * Guest asks to change stay dates/period: system applies immediately, or the owner
   * must approve first. Synced to stay profile `autoApproveReschedule`.
   */
  reschedule: ApprovalMode;
};

export type ApprovalPolicySource = 'property' | 'organization' | 'default';

export const APPROVAL_STEPS = ['booking', 'contract', 'payment', 'reschedule'] as const;

export type ApprovalStep = (typeof APPROVAL_STEPS)[number];

export const DEFAULT_APPROVAL_POLICY: ApprovalPolicy = {
  booking: 'manual',
  contract: 'manual',
  payment: 'auto',
  reschedule: 'auto',
};

export const SYSTEM_APPROVER_AR = 'النظام — اعتماد إلكتروني نيابةً عن المالك';
export const SYSTEM_APPROVER_EN = 'System — approved electronically for the owner';

export function sanitizeApprovalPolicy(value: unknown): ApprovalPolicy {
  const source = value && typeof value === 'object' ? (value as Record<string, unknown>) : {};
  const pick = (step: ApprovalStep): ApprovalMode =>
    source[step] === 'auto' || source[step] === 'manual'
      ? source[step]
      : DEFAULT_APPROVAL_POLICY[step];
  return {
    booking: pick('booking'),
    contract: pick('contract'),
    payment: pick('payment'),
    reschedule: pick('reschedule'),
  };
}

export function approvalStepLabel(step: ApprovalStep, ar: boolean): string {
  const labels: Record<ApprovalStep, [string, string]> = {
    booking: ['اعتماد الحجز بعد الدفع', 'Booking approval after payment'],
    contract: ['اعتماد العقد بعد اكتمال المستندات', 'Contract approval once documents are in'],
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
        'حين يرفع العميل كل المستندات التي حددتها يقبلها النظام ويعتمد العقد ويوقّعه باسمك، ويبقى للفريق التحقق منها لاحقاً.',
        'When the client uploads every document you asked for, the system accepts them and approves and signs the contract for you; your team still verifies them.',
      ],
      manual: [
        'تراجع كل مستند وتعتمد العقد بنفسك.',
        'You review each document and approve the contract yourself.',
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
