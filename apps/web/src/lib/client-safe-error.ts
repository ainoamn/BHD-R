/**
 * Map thrown errors to client-safe codes — never echo raw DB/driver messages (P2-04).
 */
const KNOWN_CODES = new Set([
  'forbidden',
  'unauthorized',
  'not_found',
  'invalid_body',
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
      return 404;
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
      return 409;
    case 'invalid_body':
    case 'invalid_file':
    case 'organization_required':
    case 'invalid_dates':
    case 'invalid_amount':
    case 'invalid_schedule':
    case 'invalid_terms':
    case 'duplicate_cheque_number':
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
