import type { RequirementStatus } from '@/lib/lease-reservation-lifecycle';

export type DocStatusMarkKind = 'ok' | 'alert' | 'spin' | 'error';

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
      // Owner has not opened/decided yet; tenant is waiting for approval.
      return options?.viewer === 'tenant' ? 'alert' : 'alert';
    case 'pending':
    default:
      return 'alert';
  }
}

const MARK_GLYPH: Record<DocStatusMarkKind, string> = {
  ok: '✓',
  alert: '!',
  spin: '↻',
  error: '✕',
};

const MARK_LABEL: Record<
  DocStatusMarkKind,
  { owner: [string, string]; tenant: [string, string] }
> = {
  ok: {
    owner: ['معتمدة', 'Approved'],
    tenant: ['معتمدة', 'Approved'],
  },
  alert: {
    owner: ['لم تُفتح / بانتظار المراجعة', 'Not opened / awaiting review'],
    tenant: ['لم تُرفع أو بانتظار الاعتماد', 'Not uploaded or awaiting approval'],
  },
  spin: {
    owner: ['مطلوب الاستبدال', 'Replacement required'],
    tenant: ['مطلوب الاستبدال', 'Replacement required'],
  },
  error: {
    owner: ['مرفوضة', 'Rejected'],
    tenant: ['مرفوضة', 'Rejected'],
  },
};

export function docStatusLabel(
  status: RequirementStatus,
  ar: boolean,
  viewer: 'owner' | 'tenant' = 'owner',
): string {
  if (status === 'approved') return MARK_LABEL.ok[viewer][ar ? 0 : 1];
  if (status === 'rejected') return MARK_LABEL.spin[viewer][ar ? 0 : 1];
  if (status === 'submitted') {
    return viewer === 'owner'
      ? ar
        ? 'لم تُفتح — بانتظار مراجعتك'
        : 'Not opened — awaiting your review'
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
  const label = hardReject && status === 'rejected'
    ? MARK_LABEL.error[viewer][ar ? 0 : 1]
    : docStatusLabel(status, ar, viewer);
  return (
    <span
      className={`doc-status-mark doc-status-mark--${kind}`}
      title={label}
      aria-label={label}
    >
      <span className="doc-status-mark__glyph" aria-hidden="true">
        {MARK_GLYPH[kind]}
      </span>
    </span>
  );
}
