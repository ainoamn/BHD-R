import type { RequirementStatus } from '@/lib/lease-reservation-lifecycle';

export type DocStatusMarkKind = 'ok' | 'alert' | 'wait' | 'spin' | 'error';

/** Visual mark for a document/cheque row (owner + tenant lists). */
export function docStatusMarkKind(
  status: RequirementStatus,
  options?: { viewer?: 'owner' | 'tenant' },
): DocStatusMarkKind {
  switch (status) {
    case 'approved':
      return 'ok';
    case 'rejected':
      return 'spin';
    case 'submitted':
      // Uploaded — awaiting owner review.
      return 'alert';
    case 'pending':
    default:
      void options;
      return 'wait';
  }
}

const MARK_GLYPH: Record<DocStatusMarkKind, string> = {
  ok: '✓',
  alert: '!',
  wait: '…',
  spin: '↻',
  error: '✕',
};

export function docStatusLabel(
  status: RequirementStatus,
  ar: boolean,
  viewer: 'owner' | 'tenant' = 'owner',
): string {
  if (status === 'approved') return ar ? 'معتمدة' : 'Approved';
  if (status === 'rejected') return ar ? 'مطلوب الاستبدال' : 'Replacement required';
  if (status === 'submitted') {
    return viewer === 'owner'
      ? ar
        ? 'بانتظار مراجعتك'
        : 'Awaiting your review'
      : ar
        ? 'أُرسلت — بانتظار الاعتماد'
        : 'Sent — awaiting approval';
  }
  return viewer === 'owner'
    ? ar
      ? 'لم تُرفع بعد'
      : 'Not uploaded yet'
    : ar
      ? 'لم تُرفع بعد'
      : 'Not uploaded yet';
}

export function DocStatusMark({
  status,
  ar,
  viewer = 'owner',
  /** Hard reject (✕) instead of replacement spin — rare. */
  hardReject = false,
}: {
  status: RequirementStatus;
  ar: boolean;
  viewer?: 'owner' | 'tenant';
  hardReject?: boolean;
}) {
  const kind: DocStatusMarkKind =
    status === 'rejected' && hardReject ? 'error' : docStatusMarkKind(status, { viewer });
  const label =
    hardReject && status === 'rejected'
      ? ar
        ? 'مرفوضة'
        : 'Rejected'
      : docStatusLabel(status, ar, viewer);
  return (
    <span className={`doc-status-mark doc-status-mark--${kind}`} title={label} aria-label={label}>
      <span className="doc-status-mark__glyph" aria-hidden="true">
        {MARK_GLYPH[kind]}
      </span>
    </span>
  );
}
