/**
 * Map thrown errors to client-safe codes — never echo raw DB/driver messages (P2-04).
 */
const KNOWN_CODES = new Set([
  'forbidden',
  'unauthorized',
  'not_found',
  'invalid_body',
  'reason_required',
  'link_locked',
  'followup_open',
  'invalid_file',
  'unit_unavailable',
  'deposit_not_set',
  'organization_required',
  'owner_not_found',
  'property_not_found',
  'property_archived',
  'duplicate_property',
  'single_unit_requires_one_unit',
  'multi_unit_requires_units',
  'idempotency_payload_mismatch',
  'no_units',
  'rate_limited',
  'storage_unavailable',
  'inline_too_large',
  'db_unconfigured',
  'csrf_rejected',
  'sandbox_disabled',
  'unit_not_found',
  'booking_failed',
  'request_failed',
  'complete_failed',
  'update_failed',
  'create_failed',
  'delete_failed',
  'upload_failed',
  's3_unconfigured',
  'validation_failed',
  'ai_unconfigured',
  'ai_failed',
  'booking_not_found',
  'booking_not_approvable',
  'dates_unavailable',
  'contract_not_found',
  'contract_not_pending',
  'lease_overlap',
  'invalid_dates',
  'invalid_amount',
  'invalid_schedule',
  'invalid_terms',
  'duplicate_cheque_number',
  'cheque_number_taken',
  'party_not_found',
  'stay_status_invalid',
  'stay_time_in_future',
  'stay_checkout_before_checkin',
  'handover_document_required',
  'handover_phone_invalid',
  'handover_photo_invalid',
  'handover_photos_too_many',
  'refund_not_open',
  'refund_no_deposit',
  'refund_already_decided',
  'refund_not_approved',
  'refund_note_required',
  'refund_account_invalid',
  'refund_bank_required',
  'refund_phone_invalid',
  'refund_receipt_required',
  'team_seat_limit',
  'team_role_not_allowed',
  'team_self_change',
  'team_owner_locked',
  'team_member_exists',
  'team_member_not_found',
  'team_email_invalid',
  'team_roles_required',
  'team_owner_party_required',
  'team_role_invalid',
  'team_role_not_found',
  'team_role_limit',
  'organization_not_member',
  'review_required',
  'review_exists',
  'review_not_open',
  'review_invalid',
  'review_comment_required',
  'review_photo_invalid',
  'reservation_not_found',
  'reservation_not_ready',
  'reservation_closed',
  'requirements_invalid',
  'requirement_not_found',
  'documents_incomplete',
  'contract_awaiting_counterparty',
  'handover_invalid',
  'sale_decision_not_open',
  'tenant_details_invalid',
  'cr_expired',
  'cr_expiring_soon',
  'passport_required',
  'term_too_short',
  'approval_delegate_forbidden',
  'legal_case_not_found',
  'legal_invalid',
  'legal_file_invalid',
  'legal_lawyer_invalid',
  'team_lawyer_invalid',
  'contact_invalid',
  'contact_email_taken',
  'badge_invalid',
  'badge_subject_invalid',
  'badge_already_held',
  'badge_award_closed',
  'verification_invalid',
  'verification_name_mismatch',
  'verification_open',
  'verification_document_required',
  'verification_not_open',
  'verification_unpaid',
  'verification_renewal_closed',
  'avatar_invalid',
  'team_invite_not_needed',
  'team_invite_too_soon',
  'tenant_request_invalid',
  'tenant_request_not_found',
  'tenant_request_closed',
  'tenant_request_duplicate',
  'tenant_request_arrears',
  'tenant_request_photos',
  'tenant_request_media',
  'tenant_request_proof',
  'tenant_charge_invalid',
  'tenant_charge_paid',
  'viewing_invalid',
  'viewing_schedule_required',
  'viewing_schedule_invalid',
  'viewing_note_required',
  'viewing_closed',
  'viewing_action_invalid',
  'viewing_pass_invalid',
  'viewing_decision_locked',
  'viewing_not_arrived',
  'viewing_already_arrived',
  'viewing_contact_required',
  'viewing_contact_invalid',
  'checkin_failed',
  'decision_failed',
]);

export function clientSafeErrorCode(error: unknown, fallback = 'request_failed'): string {
  if (!(error instanceof Error)) return fallback;
  const code = error.message.trim();
  if (KNOWN_CODES.has(code)) return code;
  return fallback;
}

export function statusForSafeCode(code: string): number {
  switch (code) {
    case 'unauthorized':
      return 401;
    case 'csrf_rejected':
    case 'forbidden':
    case 'sandbox_disabled':
      return 403;
    case 'not_found':
    case 'unit_unavailable':
    case 'owner_not_found':
    case 'property_not_found':
    case 'no_units':
    case 'unit_not_found':
    case 'booking_not_found':
    case 'contract_not_found':
    case 'party_not_found':
    case 'team_member_not_found':
    case 'team_role_not_found':
    case 'reservation_not_found':
    case 'requirement_not_found':
    case 'legal_case_not_found':
    case 'tenant_request_not_found':
      return 404;
    case 'tenant_request_invalid':
    case 'tenant_request_photos':
    case 'tenant_request_media':
    case 'tenant_charge_invalid':
      return 400;
    case 'tenant_request_closed':
    case 'tenant_request_duplicate':
    case 'tenant_request_arrears':
    case 'tenant_request_proof':
    case 'tenant_charge_paid':
      return 409;
    case 'legal_invalid':
    case 'legal_file_invalid':
    case 'legal_lawyer_invalid':
    case 'team_lawyer_invalid':
    case 'contact_invalid':
      return 400;
    case 'contact_email_taken':
      return 409;
    case 'badge_invalid':
    case 'badge_subject_invalid':
    case 'verification_invalid':
    case 'verification_name_mismatch':
    case 'verification_document_required':
    case 'avatar_invalid':
      return 400;
    case 'badge_already_held':
    case 'badge_award_closed':
    case 'verification_open':
    case 'verification_not_open':
    case 'verification_unpaid':
    case 'verification_renewal_closed':
      return 409;
    case 'reservation_not_ready':
    case 'reservation_closed':
    case 'documents_incomplete':
    case 'contract_awaiting_counterparty':
      return 409;
    case 'requirements_invalid':
    case 'handover_invalid':
    case 'tenant_details_invalid':
    case 'cr_expired':
    case 'cr_expiring_soon':
    case 'passport_required':
    case 'term_too_short':
      return 400;
    case 'sale_decision_not_open':
      return 409;
    case 'team_role_not_allowed':
    case 'team_self_change':
    case 'team_owner_locked':
    case 'organization_not_member':
    case 'approval_delegate_forbidden':
      return 403;
    case 'team_seat_limit':
    case 'team_member_exists':
    case 'team_role_limit':
    case 'team_invite_not_needed':
      return 409;
    case 'team_invite_too_soon':
      return 429;
    case 'team_email_invalid':
    case 'team_roles_required':
    case 'team_owner_party_required':
    case 'team_role_invalid':
      return 400;
    case 'booking_not_approvable':
    case 'dates_unavailable':
    case 'contract_not_pending':
    case 'lease_overlap':
    case 'cheque_number_taken':
    case 'deposit_not_set':
    case 'property_archived':
    case 'duplicate_property':
    case 'single_unit_requires_one_unit':
    case 'multi_unit_requires_units':
    case 'idempotency_payload_mismatch':
    case 'stay_status_invalid':
    case 'refund_not_open':
    case 'refund_no_deposit':
    case 'refund_already_decided':
    case 'refund_not_approved':
    case 'review_required':
    case 'review_exists':
    case 'review_not_open':
    case 'viewing_contact_required':
    case 'viewing_closed':
    case 'viewing_decision_locked':
    case 'viewing_not_arrived':
    case 'viewing_already_arrived':
      return 409;
    case 'review_invalid':
    case 'review_comment_required':
    case 'review_photo_invalid':
      return 400;
    case 'stay_time_in_future':
    case 'stay_checkout_before_checkin':
    case 'handover_document_required':
    case 'handover_phone_invalid':
    case 'handover_photo_invalid':
    case 'handover_photos_too_many':
    case 'refund_note_required':
    case 'refund_account_invalid':
    case 'refund_bank_required':
    case 'refund_phone_invalid':
    case 'refund_receipt_required':
      return 400;
    case 'invalid_body':
    case 'reason_required':
    case 'link_locked':
    case 'followup_open':
    case 'invalid_file':
    case 'organization_required':
    case 'invalid_dates':
    case 'invalid_amount':
    case 'invalid_schedule':
    case 'invalid_terms':
    case 'duplicate_cheque_number':
    case 'viewing_contact_invalid':
    case 'viewing_schedule_required':
    case 'viewing_schedule_invalid':
    case 'viewing_note_required':
    case 'viewing_action_invalid':
    case 'viewing_invalid':
    case 'viewing_pass_invalid':
      return 400;
    case 'rate_limited':
      return 429;
    case 'inline_too_large':
      return 413;
    case 'validation_failed':
      return 400;
    case 'db_unconfigured':
    case 'storage_unavailable':
    case 's3_unconfigured':
    case 'ai_unconfigured':
      return 503;
    case 'ai_failed':
      return 502;
    default:
      return 500;
  }
}
