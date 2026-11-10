'use client';

import type { MouseEvent } from 'react';

/**
 * Manual account gate for owner-invite payment links.
 * Never auto-redirects — that caused OAuth account thrashing / slow_down.
 * Uses location.assign so auth API redirects are not swallowed by soft navigation.
 */
export function LeaseInviteAccountGate({
  locale,
  inviteeEmail,
  inviteeName,
  currentEmail,
  continueHref,
  rosterHasInvitee,
}: {
  locale: 'ar' | 'en';
  inviteeEmail: string;
  inviteeName?: string | null | undefined;
  currentEmail?: string | null | undefined;
  continueHref: string;
  rosterHasInvitee: boolean;
}) {
  const ar = locale === 'ar';

  const onContinue = (event: MouseEvent<HTMLAnchorElement>) => {
    event.preventDefault();
    window.location.assign(continueHref);
  };

  return (
    <div className="notice notice--warning" role="status">
      <p>
        {ar ? 'هذه الدعوة موجّهة إلى' : 'This invite is for'}{' '}
        {inviteeName ? <strong>{inviteeName} · </strong> : null}
        <bdi dir="ltr">{inviteeEmail}</bdi>
        {currentEmail ? (
          <>
            {ar ? '، وأنت مسجّل الآن كـ' : ', but you are signed in as'}{' '}
            <bdi dir="ltr">{currentEmail}</bdi>.
          </>
        ) : (
          <>{ar ? '.' : '.'}</>
        )}
      </p>
      <p className="ops-hint">
        {rosterHasInvitee
          ? ar
            ? 'اضغط مرة واحدة للتبديل إلى حساب الدعوة، ثم أكمل الدفع.'
            : 'Click once to switch to the invite account, then complete payment.'
          : ar
            ? 'هذا البريد غير مسجّل في هذه الجلسة. سجّل الدخول به مرة واحدة دون التبديل بين الحسابات الأخرى.'
            : 'That email is not in this session. Sign in with it once — do not cycle other accounts.'}
      </p>
      <p>
        <a className="button button--primary" href={continueHref} onClick={onContinue}>
          {rosterHasInvitee
            ? ar
              ? 'التبديل إلى حساب الدعوة'
              : 'Switch to invite account'
            : ar
              ? 'تسجيل الدخول بحساب الدعوة'
              : 'Sign in with invite account'}
        </a>
      </p>
    </div>
  );
}
