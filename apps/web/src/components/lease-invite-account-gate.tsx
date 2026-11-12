'use client';

import { useState, type MouseEvent } from 'react';
import { browserNextMutation } from '@/lib/api';
import {
  applyAccountIsolation,
  paintPrivacyVeil,
  signalPrivacyVeilReady,
  switchWindowAccount,
} from '@/lib/identity/client';
import { tokenForAccount } from '@/lib/identity/window-session';

/**
 * Manual account gate for owner-invite payment / signing links.
 * Never auto-redirects — that caused OAuth account thrashing / slow_down.
 * Roster path mirrors the account switcher (identity switch → product rebind).
 */
export function LeaseInviteAccountGate({
  locale,
  inviteeEmail,
  inviteeName,
  inviteeSub,
  currentEmail,
  currentName,
  continueHref,
  paymentPath,
  rosterHasInvitee,
  purpose = 'pay',
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
  /** pay = deposit checkout; sign = electronic signature after payment. */
  purpose?: 'pay' | 'sign';
}) {
  const ar = locale === 'ar';
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const nextStep =
    purpose === 'sign'
      ? ar
        ? 'أكمل التوقيع'
        : 'complete signing'
      : ar
        ? 'أكمل الدفع'
        : 'complete payment';
  const destination =
    (paymentPath && paymentPath.startsWith('/') ? paymentPath : '') || continueHref;

  const finishOnDestination = (sub: string) => {
    const returnTo = destination.includes('au=')
      ? destination
      : `${destination}${destination.includes('?') ? '&' : '?'}au=${encodeURIComponent(sub)}`;
    window.location.assign(
      `/api/auth/bhd/start?returnTo=${encodeURIComponent(returnTo)}&prompt=none`,
    );
  };

  const onContinue = (event: MouseEvent<HTMLAnchorElement>) => {
    event.preventDefault();
    if (busy) return;

    // Not on roster — hard navigate to invite-login / continueHref only.
    if (!rosterHasInvitee || !inviteeSub) {
      window.location.assign(continueHref);
      return;
    }

    setBusy(true);
    setError(null);
    paintPrivacyVeil();
    void (async () => {
      try {
        const switched = await switchWindowAccount(inviteeSub);
        if (switched.ok) {
          const nextSub = switched.userId || inviteeSub;
          const token = switched.token || tokenForAccount(nextSub);
          if (token) {
            await applyAccountIsolation(token, { force: true, sub: nextSub });
            return;
          }
          finishOnDestination(nextSub);
          return;
        }
        await browserNextMutation('/api/auth/switch', {
          method: 'POST',
          body: JSON.stringify({ sub: inviteeSub }),
        });
        finishOnDestination(inviteeSub);
      } catch {
        // Last resort: GET switch (roster path — no invite-login wipe).
        window.location.assign(continueHref);
      } finally {
        setBusy(false);
        signalPrivacyVeilReady();
      }
    })();
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
            ? `اضغط مرة واحدة للتبديل إلى حساب الدعوة، ثم ${nextStep}. مستنداتك المحفوظة تبقى كما هي.`
            : `Click once to switch to the invite account, then ${nextStep}. Saved documents stay in place.`
          : ar
            ? 'هذا البريد غير مسجّل في هذه الجلسة. سجّل الدخول به مرة واحدة دون التبديل بين الحسابات الأخرى.'
            : 'That email is not in this session. Sign in with it once — do not cycle other accounts.'}
      </p>
      {error ? (
        <p className="notice notice--error" role="alert">
          {error}
        </p>
      ) : null}
      <p>
        <a
          className="button button--primary"
          href={continueHref}
          onClick={onContinue}
          aria-disabled={busy || undefined}
        >
          {busy
            ? ar
              ? 'جارٍ التبديل…'
              : 'Switching…'
            : rosterHasInvitee
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
