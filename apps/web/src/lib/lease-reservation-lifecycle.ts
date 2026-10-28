/**
 * After the deposit: owner approval → required documents and the final contract
 * → contract approved by the owner, then signed by the tenant → handover.
 * Everything lives on the reservation's terms snapshot under `lifecycle`.
 */

export type RequirementStatus = 'pending' | 'submitted' | 'approved' | 'rejected';

export type ReservationRequirement = {
  code: string;
  labelAr: string;
  labelEn: string;
  status: RequirementStatus;
  /** Owner note on a rejected document, read by the customer. */
  note?: string | null;
  file?: {
    eventId: string;
    name: string;
    mime: string;
    size: number;
    submittedAt: string;
  } | null;
  reviewedAt?: string | null;
  reviewedByName?: string | null;
  /** Accepted by the system on the owner's behalf; the team still has to verify it. */
  autoApproved?: boolean;
  verifiedAt?: string | null;
  verifiedByName?: string | null;
};

export type ReservationCancelReason = 'documents_invalid' | 'payment_not_received';

export type ReservationSaleDraft = {
  signedOn: string;
  amount: string;
  notes?: string | undefined;
};

export type ReservationLifecycle = {
  /** Set when the owner confirms payments by hand: the channel reported success, receipt is unconfirmed. */
  paymentReview?: {
    status: 'pending' | 'confirmed';
    reportedAt: string;
    confirmedAt?: string | null;
    byName?: string | null;
  };
  approval?: { at: string; byUserId: string | null; byName: string | null; automatic?: boolean };
  contractDraft?: {
    savedAt: string;
    byName: string | null;
    /** Rent: the manual lease form payload. Sale: price and signing date. */
    lease?: Record<string, unknown>;
    sale?: ReservationSaleDraft;
  };
  requirements?: ReservationRequirement[];
  contract?: {
    id: string;
    reference: string;
    issuedAt: string;
    byName: string | null;
    automatic?: boolean;
  };
  tenantSignature?: { signedAt: string; evidenceEventId: string };
  cancellation?: {
    at: string;
    byName: string | null;
    reason: ReservationCancelReason;
    note: string | null;
    code?: string | null;
  };
  /** Last time an owner reopened a cancelled booking (keeps the prior cancellation for audit). */
  restoration?: {
    at: string;
    byName: string | null;
    note: string;
    previousCancellation: {
      at: string;
      byName: string | null;
      reason: ReservationCancelReason;
      note: string | null;
      code?: string | null;
    };
  };
  /**
   * Muscat municipality registration numbers — entered by the owner after premises
   * handover (not during contract prep).
   */
  municipalRegistration?: {
    formNo: string;
    contractNo: string;
    at: string;
    byName: string | null;
  };
  handover?: {
    at: string;
    on: string;
    byName: string | null;
    recipientName: string;
    keys: string | null;
    electricityReading: string | null;
    waterReading: string | null;
    notes: string | null;
    /** Recorded by scanning the tenant's pass; older records were typed in by the owner. */
    method?: 'scan';
    byUserId?: string | null;
    /** Scanned handovers wait for the tenant to accept the premises; older ones count as accepted. */
    status?: 'awaiting_tenant' | 'accepted';
    evidenceEventId?: string;
    recipientPhoto?: HandoverPhotoMeta | null;
    /** The tenant's own selfie event; older records kept the staff photo in `evidenceEventId`. */
    recipientPhotoEventId?: string | null;
    /** The staff member's own selfie at the door, taken at the same time as the tenant's. */
    handlerPhoto?: HandoverPhotoMeta | null;
    handlerPhotoEventId?: string | null;
    photos?: HandoverPhotoMeta[];
    acceptedAt?: string | null;
    /** End of the window in which the tenant may still report defects with photos. */
    defectsUntil?: string | null;
    defects?: {
      at: string;
      note: string | null;
      evidenceEventId: string;
      photos: HandoverPhotoMeta[];
    } | null;
  };
  /** A staff member scanned the pass: the tenant is asked for a selfie on their own phone. */
  handoverScan?: {
    at: string;
    byName: string | null;
    byUserId: string | null;
    selfie: { at: string; evidenceEventId: string; photo: HandoverPhotoMeta } | null;
    /** The scanning staff member's selfie from their own device, asked for at the same moment. */
    handlerSelfie?: {
      at: string;
      evidenceEventId: string;
      photo: HandoverPhotoMeta;
      byUserId: string | null;
      byName: string | null;
    } | null;
  };
  /**
   * When rent is by cheque: who the tenant must write cheques to, bank hint, and one row per
   * rent / VAT / deposit cheque the customer must photograph and number.
   */
  chequePayableTo?: string | null;
  chequeBankName?: string | null;
  /** Accounting bank-account id rent receipts should credit (from org accounting settings). */
  rentBankAccountId?: string | null;
  chequeInstructions?: ReservationChequeInstruction[];
  chequeSubmissions?: ReservationChequeSubmission[];
  /**
   * Copied from approval policy when the contract draft is saved: electronic flow
   * options the tenant and handover steps must honour.
   */
  autoFlow?: {
    contractAuto: boolean;
    deferUntilHandover: Array<'meters' | 'handoverOn'>;
    requireTenantAttestation: boolean;
  };
  /** Tenant confirmed docs accuracy and cancel-if-invalid responsibility. */
  tenantAttestation?: { at: string; accepted: true };
  /**
   * When the tenant finished uploading and pressed «send documents» — owner is notified once.
   * Cleared if the owner rejects a file or asks for extra documents.
   */
  customerDocumentsSentAt?: string | null;
  /**
   * Owner returned the booking so the client re-uploads booking / identity documents
   * and re-signs the booking agreement. While `resolvedAt` is null, auto-approval is skipped.
   * `rejected` must be re-captured; `locked` stay as-is and the tenant cannot replace them.
   */
  bookingDocsReturn?: {
    at: string;
    byName: string | null;
    note: string;
    resolvedAt?: string | null;
    rejected?: BookingIdentityDocCode[];
    locked?: BookingIdentityDocCode[];
    /** Prior e-sign evidence kept so locked captures remain readable and reusable. */
    evidenceEventId?: string | null;
  };
};

/** Identity / booking captures the owner can selectively return for a fix. */
export const BOOKING_IDENTITY_DOC_CODES = [
  'id-front',
  'id-back',
  'selfie',
  'signature',
  'civil_id_copy',
  'passport_copy',
  'cr_copy',
] as const;

export type BookingIdentityDocCode = (typeof BOOKING_IDENTITY_DOC_CODES)[number];

export const BOOKING_IDENTITY_DOC_LABELS: Record<
  BookingIdentityDocCode,
  { ar: string; en: string }
> = {
  'id-front': { ar: 'الهوية — الوجه الأمامي', en: 'ID — front' },
  'id-back': { ar: 'الهوية — الوجه الخلفي', en: 'ID — back' },
  selfie: { ar: 'صورة السيلفي', en: 'Selfie' },
  signature: { ar: 'التوقيع', en: 'Signature' },
  civil_id_copy: { ar: 'نسخة البطاقة الشخصية', en: 'Civil ID copy' },
  passport_copy: { ar: 'نسخة جواز السفر', en: 'Passport copy' },
  cr_copy: { ar: 'نسخة السجل التجاري', en: 'CR copy' },
};

export const BOOKING_ESIGN_DOC_CODES = [
  'id-front',
  'id-back',
  'selfie',
  'signature',
] as const satisfies readonly BookingIdentityDocCode[];

export type BookingEsignDocCode = (typeof BOOKING_ESIGN_DOC_CODES)[number];

/** File path segment under `/api/owner/bookings/:id/files/:file` for a booking identity doc. */
export function bookingIdentityFileKind(code: BookingIdentityDocCode): string {
  switch (code) {
    case 'civil_id_copy':
      return 'party-civil-id';
    case 'passport_copy':
      return 'party-passport';
    case 'cr_copy':
      return 'party-cr';
    default:
      return code;
  }
}

export function isBookingIdentityDocCode(value: string): value is BookingIdentityDocCode {
  return (BOOKING_IDENTITY_DOC_CODES as readonly string[]).includes(value);
}

/** Which identity captures exist on a booking and can be returned selectively. */
export function listBookingIdentityDocs(input: {
  hasEsign: boolean;
  party?: {
    entityType?: string | null;
    person?: { civilIdCopy?: unknown; passportCopy?: unknown } | null;
    company?: { crCopy?: unknown } | null;
  } | null;
}): BookingIdentityDocCode[] {
  const codes: BookingIdentityDocCode[] = [];
  if (input.hasEsign) codes.push(...(BOOKING_ESIGN_DOC_CODES as readonly BookingIdentityDocCode[]));
  const party = input.party;
  if (party?.entityType === 'person' && party.person) {
    if (party.person.civilIdCopy) codes.push('civil_id_copy');
    if (party.person.passportCopy) codes.push('passport_copy');
  }
  if (party?.entityType === 'company' && party.company?.crCopy) {
    codes.push('cr_copy');
  }
  return codes;
}

/** One cheque the tenant must prepare after the owner saves a cheque-payment contract. */
export type ReservationChequeInstruction = {
  key: string;
  kind: 'rent' | 'vat' | 'deposit';
  labelAr: string;
  labelEn: string;
  dueOn: string | null;
  amountMinor: number;
  currency: string;
  suggestedChequeNumber?: string | null;
};

export type ReservationChequeSubmission = {
  key: string;
  bankName: string;
  accountHolderName: string;
  chequeNumber: string;
  file: {
    eventId: string;
    name: string;
    mime: string;
    size: number;
    submittedAt: string;
  };
  status: RequirementStatus;
  note?: string | null;
  reviewedAt?: string | null;
  reviewedByName?: string | null;
  autoApproved?: boolean;
};

/** A stored handover photo without its bytes. */
export type HandoverPhotoMeta = {
  index: number;
  sha256: string;
  takenAt: string | null;
  source: 'camera' | 'device';
};

/** Hours after the handover record is filed in which the tenant may report defects with photos. */
export const HANDOVER_DEFECTS_HOURS = 3;

/** End of the defects window from a handover timestamp (ISO). */
export function handoverDefectsUntilFrom(at: string, now: Date = new Date()): string {
  const start = Date.parse(at);
  const from = Number.isFinite(start) ? start : now.getTime();
  return new Date(from + HANDOVER_DEFECTS_HOURS * 60 * 60 * 1000).toISOString();
}

/** How long after a scan the tenant's page keeps asking for the selfie. */
export const HANDOVER_SELFIE_REQUEST_MINUTES = 30;
/** How long a selfie taken at the door still counts for the handover record. */
export const HANDOVER_SELFIE_VALID_HOURS = 6;

export function handoverAwaitingTenant(lifecycle: ReservationLifecycle | null | undefined) {
  return lifecycle?.handover?.status === 'awaiting_tenant';
}

/** The selfie taken at the door, while it still counts for the record. */
export function handoverLiveSelfie(
  lifecycle: ReservationLifecycle | null | undefined,
  now: Date = new Date(),
) {
  const selfie = lifecycle?.handoverScan?.selfie;
  if (!selfie) return null;
  return now.getTime() - Date.parse(selfie.at) < HANDOVER_SELFIE_VALID_HOURS * 3_600_000
    ? selfie
    : null;
}

/** The staff member's selfie taken at the door, while it still counts for the record. */
export function handoverHandlerSelfie(
  lifecycle: ReservationLifecycle | null | undefined,
  now: Date = new Date(),
) {
  const selfie = lifecycle?.handoverScan?.handlerSelfie;
  if (!selfie) return null;
  return now.getTime() - Date.parse(selfie.at) < HANDOVER_SELFIE_VALID_HOURS * 3_600_000
    ? selfie
    : null;
}

/**
 * Where the selfie stands for the tenant's page: asked for after a recent scan, already sent,
 * or still owed while a scan is open; null once the handover record is filed.
 */
export function handoverSelfieState(
  lifecycle: ReservationLifecycle | null | undefined,
  now: Date = new Date(),
): 'requested' | 'sent' | null {
  const handover = lifecycle?.handover;
  if (handover && handover.status !== 'awaiting_tenant') return null;
  // Legacy records waiting on an accept step: do not keep blocking on selfie.
  if (handover?.status === 'awaiting_tenant') return null;
  if (handover?.recipientPhoto || handoverLiveSelfie(lifecycle, now)) return 'sent';
  if (handover) return 'requested';
  const scan = lifecycle?.handoverScan;
  if (!scan) return null;
  return now.getTime() - Date.parse(scan.at) < HANDOVER_SELFIE_REQUEST_MINUTES * 60_000
    ? 'requested'
    : null;
}

/** The tenant may still attach defect photos: record filed, inside the window, none sent yet. */
export function handoverDefectsOpen(
  lifecycle: ReservationLifecycle | null | undefined,
  now: Date = new Date(),
): boolean {
  const handover = lifecycle?.handover;
  if (!handover || handover.defects) return false;
  // Effective on staff send; legacy `awaiting_tenant` counts the same (no approval step).
  if (handover.status && handover.status !== 'accepted' && handover.status !== 'awaiting_tenant') {
    return false;
  }
  const until = handover.defectsUntil ?? handoverDefectsUntilFrom(handover.at, now);
  return new Date(until) > now;
}

export const REQUIREMENT_CATALOGUE: ReadonlyArray<{
  code: string;
  labelAr: string;
  labelEn: string;
  rent: boolean;
  sale: boolean;
}> = [
  {
    code: 'civil_id',
    labelAr: 'البطاقة الشخصية',
    labelEn: 'Civil ID card',
    rent: true,
    sale: true,
  },
  { code: 'passport', labelAr: 'جواز السفر', labelEn: 'Passport', rent: true, sale: true },
  {
    code: 'resident_card',
    labelAr: 'بطاقة الإقامة',
    labelEn: 'Residence card',
    rent: true,
    sale: true,
  },
  {
    code: 'salary_certificate',
    labelAr: 'شهادة راتب',
    labelEn: 'Salary certificate',
    rent: true,
    sale: true,
  },
  {
    code: 'bank_statement',
    labelAr: 'كشف حساب بنكي',
    labelEn: 'Bank statement',
    rent: true,
    sale: true,
  },
  {
    code: 'employment_letter',
    labelAr: 'رسالة من جهة العمل',
    labelEn: 'Employer letter',
    rent: true,
    sale: false,
  },
  {
    code: 'commercial_register',
    labelAr: 'السجل التجاري',
    labelEn: 'Commercial register',
    rent: true,
    sale: true,
  },
  {
    code: 'authorization_letter',
    labelAr: 'تفويض المفوّض بالتوقيع',
    labelEn: 'Signatory authorisation',
    rent: true,
    sale: true,
  },
  {
    code: 'company_cr_extract',
    labelAr: 'مستخرج سجل تجاري حديث',
    labelEn: 'Recent CR extract',
    rent: true,
    sale: true,
  },
  {
    code: 'signatory_civil_id',
    labelAr: 'البطاقة الشخصية للمفوّض',
    labelEn: 'Signatory civil ID',
    rent: true,
    sale: true,
  },
  {
    code: 'signatory_passport',
    labelAr: 'جواز سفر المفوّض',
    labelEn: 'Signatory passport',
    rent: true,
    sale: true,
  },
  {
    code: 'signatory_resident_card',
    labelAr: 'بطاقة إقامة المفوّض',
    labelEn: 'Signatory residence card',
    rent: true,
    sale: true,
  },
  {
    code: 'guarantor_id',
    labelAr: 'بطاقة الكفيل أو الضامن',
    labelEn: "Guarantor's ID",
    rent: true,
    sale: false,
  },
  {
    code: 'financing_approval',
    labelAr: 'موافقة التمويل البنكي',
    labelEn: 'Bank financing approval',
    rent: false,
    sale: true,
  },
];

/** Uploaded document limits: the data URL stays under ~1.2 MB so a request fits the body cap. */
export const REQUIREMENT_FILE_MAX_CHARS = 1_600_000;
export const REQUIREMENT_FILE_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'application/pdf'];

export type LeaseJourneyPhase =
  | 'awaiting_payment'
  | 'awaiting_terms_signature'
  | 'awaiting_payment_review'
  | 'awaiting_owner_approval'
  | 'awaiting_contract_draft'
  | 'awaiting_documents'
  | 'awaiting_documents_review'
  | 'awaiting_contract_approval'
  | 'awaiting_tenant_signature'
  | 'awaiting_handover'
  | 'handed_over'
  | 'closed';

export type LeaseJourneyStage = 'booking' | 'approval' | 'documents' | 'contract' | 'handover';

export const LEASE_JOURNEY_STAGES: readonly LeaseJourneyStage[] = [
  'booking',
  'approval',
  'documents',
  'contract',
  'handover',
];

export type LeaseJourneyInput = {
  status: string;
  depositPaidAt: string | null;
  esignSignedAt: string | null;
  lifecycle: ReservationLifecycle | null | undefined;
};

export function requirementsOf(lifecycle: ReservationLifecycle | null | undefined) {
  return lifecycle?.requirements ?? [];
}

/** Documents the system accepted on the owner's behalf that the team has not verified yet. */
export function documentsToVerify(lifecycle: ReservationLifecycle | null | undefined) {
  if (lifecycle?.cancellation || lifecycle?.handover) return [];
  return requirementsOf(lifecycle).filter(
    (item) => item.autoApproved && item.status === 'approved' && !item.verifiedAt,
  );
}

/** Any step the system approved for the owner, which the customer is told about. */
export function approvedElectronically(lifecycle: ReservationLifecycle | null | undefined) {
  return Boolean(
    lifecycle?.approval?.automatic ||
    lifecycle?.contract?.automatic ||
    requirementsOf(lifecycle).some((item) => item.autoApproved),
  );
}

export function lifecycleOf(snapshot: unknown): ReservationLifecycle {
  if (!snapshot || typeof snapshot !== 'object') return {};
  const value = (snapshot as { lifecycle?: unknown }).lifecycle;
  return value && typeof value === 'object' ? value : {};
}

/** Where the booking stands and whose move it is. */
export function leaseJourneyPhase(input: LeaseJourneyInput): LeaseJourneyPhase {
  const life = input.lifecycle ?? {};
  // Staff filing the record completes handover — tenant may view and object, not approve.
  if (life.handover) return 'handed_over';
  if (life.cancellation) return 'closed';
  if (life.tenantSignature) return 'awaiting_handover';
  if (input.status === 'cancelled' || input.status === 'expired') return 'closed';
  if (!input.depositPaidAt) return input.status === 'pending' ? 'awaiting_payment' : 'closed';
  if (!input.esignSignedAt) return 'awaiting_terms_signature';
  if (life.paymentReview?.status === 'pending') return 'awaiting_payment_review';
  if (!life.approval) return 'awaiting_owner_approval';
  if (life.contract) return 'awaiting_tenant_signature';
  if (!life.contractDraft) return 'awaiting_contract_draft';
  return documentsPhase(life);
}

/** Once the draft is ready: waiting on the client's documents, on their review, or on approval. */
export function documentsPhase(lifecycle: ReservationLifecycle): LeaseJourneyPhase {
  const requirements = requirementsOf(lifecycle);
  const chequeStatuses = chequeStatusesOf(lifecycle);
  if (
    requirements.some((item) => item.status === 'pending' || item.status === 'rejected') ||
    chequeStatuses.some((status) => status === 'pending' || status === 'rejected')
  ) {
    return 'awaiting_documents';
  }
  const hasPackage = requirements.length > 0 || chequeStatuses.length > 0;
  // Files are stored, but the owner is not notified until the tenant confirms send.
  if (hasPackage && !lifecycle.customerDocumentsSentAt) {
    return 'awaiting_documents';
  }
  if (
    requirements.some((item) => item.status === 'submitted') ||
    chequeStatuses.some((status) => status === 'submitted')
  ) {
    return 'awaiting_documents_review';
  }
  return 'awaiting_contract_approval';
}

/** Status per cheque instruction (missing submission counts as pending). */
export function chequeStatusesOf(lifecycle: ReservationLifecycle | null | undefined): RequirementStatus[] {
  const instructions = lifecycle?.chequeInstructions ?? [];
  if (!instructions.length) return [];
  const byKey = new Map((lifecycle?.chequeSubmissions ?? []).map((row) => [row.key, row]));
  return instructions.map((item) => byKey.get(item.key)?.status ?? 'pending');
}

export function chequeInstructionsOf(lifecycle: ReservationLifecycle | null | undefined) {
  return lifecycle?.chequeInstructions ?? [];
}

const PHASE_STAGE: Record<LeaseJourneyPhase, number> = {
  awaiting_payment: 0,
  awaiting_terms_signature: 0,
  awaiting_payment_review: 1,
  awaiting_owner_approval: 1,
  awaiting_contract_draft: 2,
  awaiting_documents: 2,
  awaiting_documents_review: 2,
  awaiting_contract_approval: 3,
  awaiting_tenant_signature: 3,
  awaiting_handover: 4,
  handed_over: 5,
  closed: -1,
};

/** Index of the current stage (0–4); 5 once the premises are handed over, -1 when closed. */
export function leaseJourneyStageIndex(phase: LeaseJourneyPhase): number {
  return PHASE_STAGE[phase];
}

export function phaseWaitsOn(phase: LeaseJourneyPhase): 'customer' | 'owner' | null {
  switch (phase) {
    case 'awaiting_payment':
    case 'awaiting_terms_signature':
    case 'awaiting_documents':
    case 'awaiting_tenant_signature':
      return 'customer';
    case 'awaiting_payment_review':
    case 'awaiting_owner_approval':
    case 'awaiting_contract_draft':
    case 'awaiting_documents_review':
    case 'awaiting_contract_approval':
    case 'awaiting_handover':
      return 'owner';
    default:
      return null;
  }
}

export function leaseJourneyStageLabels(sale: boolean, ar: boolean): string[] {
  if (ar) {
    return [
      'إتمام الحجز',
      'اعتماد المالك',
      'المستندات',
      sale ? 'عقد البيع' : 'عقد الإيجار',
      'تسليم العقار',
    ];
  }
  return [
    'Booking',
    'Owner approval',
    'Documents',
    sale ? 'Sale contract' : 'Lease contract',
    'Handover',
  ];
}

/** Short owner-facing status for the bookings list and the reservation header. */
export function leasePhaseLabel(phase: LeaseJourneyPhase, ar: boolean): string {
  const labels: Record<LeaseJourneyPhase, [string, string]> = {
    awaiting_payment: ['بانتظار دفع العربون', 'Awaiting deposit'],
    awaiting_terms_signature: ['بانتظار توقيع العميل', 'Awaiting client signature'],
    awaiting_payment_review: ['بانتظار تأكيد استلام العربون', 'Confirm the deposit was received'],
    awaiting_owner_approval: ['بانتظار اعتمادك للحجز', 'Awaiting your approval'],
    awaiting_contract_draft: ['معتمد — جهّز العقد', 'Approved — prepare the contract'],
    awaiting_documents: ['بانتظار مستندات العميل', 'Awaiting client documents'],
    awaiting_documents_review: ['مستندات بانتظار مراجعتك', 'Documents to review'],
    awaiting_contract_approval: ['جاهز لاعتماد العقد', 'Ready for contract approval'],
    awaiting_tenant_signature: ['بانتظار توقيع الطرف الثاني', 'Awaiting second-party signature'],
    awaiting_handover: ['عقد موقّع — بانتظار التسليم', 'Signed — awaiting handover'],
    handed_over: ['تم تسليم العقار', 'Handed over'],
    closed: ['مغلق', 'Closed'],
  };
  return labels[phase][ar ? 0 : 1];
}
