'use client';

import type { MouseEvent } from 'react';

/**
 * Manual account gate for owner-invite payment links.
 * Never auto-redirects — that caused OAuth account thrashing / slow_down.
 * Hard-navigates to product /api/auth/switch (or invite-login) so the product
 * session cookie is rewritten before returning to payment.
 */
export function LeaseInviteAccountGate({
  locale,
  inviteeEmail,
  inviteeName,
  currentEmail,
  currentName,
  continueHref,
  rosterHasInvitee,
}: {
  locale: 'ar' | 'en';
  inviteeEmail: string;
  inviteeName?: string | null | undefined;
  inviteeSub?: string | null | undefined;
  currentEmail?: string | null | undefined;
  currentName?: string | null | undefined;
  continueHref: string;
  paymentPath?: string;
  rosterHasInvitee: boolean;
}) {
  const ar = locale === 'ar';

  const onContinue = (event: MouseEvent<HTMLAnchorElement>) => {
    event.preventDefault();
    // Full navigation only — client identity switch left the product cookie on the
    // wrong account and bounced back to this gate with a loading veil.
    window.location.assign(continueHref);
  };

  return (
    <div className="notice notice--warning" role="status">
      <p>
        {ar ? 'هذه الدعوة موجّهة إلى' : 'This invite is for'}{' '}
        {inviteeName ? <strong>{inviteeName} · </strong> : null}
        <bdi dir="ltr">{inviteeEmail}</bdi>
        {currentEmail || currentName ? (
          <>
            {ar ? '، وأنت مسجّل الآن كـ' : ', but you are signed in as'}{' '}
            {currentName ? <strong>{currentName}</strong> : null}
            {currentName && currentEmail ? ' · ' : null}
            {currentEmail ? <bdi dir="ltr">{currentEmail}</bdi> : null}.
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
