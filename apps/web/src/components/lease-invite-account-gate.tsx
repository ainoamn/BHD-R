'use client';

import type { MouseEvent } from 'react';
import {
  accountBoundPath,
  applyAccountIsolation,
  switchWindowAccount,
} from '@/lib/identity/client';
import { tokenForAccount } from '@/lib/identity/window-session';

/**
 * Manual account gate for owner-invite payment links.
 * Never auto-redirects — that caused OAuth account thrashing / slow_down.
 * Uses location.assign so auth API redirects are not swallowed by soft navigation.
 */
export function LeaseInviteAccountGate({
  locale,
  inviteeEmail,
  inviteeName,
  inviteeSub,
  currentEmail,
  continueHref,
  paymentPath,
  rosterHasInvitee,
}: {
  locale: 'ar' | 'en';
  inviteeEmail: string;
  inviteeName?: string | null | undefined;
  inviteeSub?: string | null | undefined;
  currentEmail?: string | null | undefined;
  continueHref: string;
  paymentPath: string;
  rosterHasInvitee: boolean;
}) {
  const ar = locale === 'ar';

  const onContinue = async (event: MouseEvent<HTMLAnchorElement>) => {
    event.preventDefault();
    const sub = (inviteeSub || '').trim();
    if (rosterHasInvitee && sub) {
      const switched = await switchWindowAccount(sub);
      if (switched.ok) {
        const nextSub = switched.userId || sub;
        const token = switched.token || tokenForAccount(nextSub);
        const dest = accountBoundPath(paymentPath, nextSub);
        if (token) {
          await applyAccountIsolation(token, { force: true, sub: nextSub });
          window.location.assign(dest);
          return;
        }
        // Identity switched but no bearer — bind product via SSO start (same as app switcher).
        window.location.assign(
          `/api/auth/bhd/start?returnTo=${encodeURIComponent(dest)}&login_hint=${encodeURIComponent(inviteeEmail)}&prompt=login`,
        );
        return;
      }
    }
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
