import { cookies } from 'next/headers';
import { ROSTER_COOKIE, readRosterCookie } from '@/lib/bhd/account-roster';
import { stripAuFromReturnPath } from '@/lib/bhd/oauth';

/** Relative payment URL the invitee should return to after switch / login. */
export function leaseInvitePaymentReturnPath(
  locale: string,
  sessionReference: string,
  returnPath?: string,
): string {
  const qs = new URLSearchParams({ kind: 'lease' });
  if (returnPath) qs.set('return', returnPath);
  // Never carry a stale ?au= from the owner's tab into the invitee return.
  return stripAuFromReturnPath(
    `/${locale}/payments/sandbox/${encodeURIComponent(sessionReference)}?${qs.toString()}`,
  );
}

export type OwnerInviteAccountGate = {
  matched: boolean;
  inviteeEmail: string;
  /** Identity subject when the invitee is already on this browser roster. */
  inviteeSub: string | null;
  rosterHasInvitee: boolean;
  /** User-initiated only — never auto-followed (prevents OAuth thrash / slow_down). */
  continueHref: string;
  /** Payment page path (no stale au) for post-switch navigation. */
  paymentPath: string;
};

/**
 * Build a one-click continue link for the invitee account.
 * Callers must show this as a button — do not server-redirect automatically.
 */
export async function resolveOwnerInviteAccountGate(input: {
  locale: string;
  paymentPath: string;
  inviteeEmail: string;
  viewerEmail: string | null | undefined;
}): Promise<OwnerInviteAccountGate | null> {
  const invitee = input.inviteeEmail.trim().toLowerCase();
  if (!invitee || !invitee.includes('@')) return null;
  const paymentPath = stripAuFromReturnPath(input.paymentPath);
  const current = (input.viewerEmail || '').trim().toLowerCase();
  if (current && current === invitee) {
    return {
      matched: true,
      inviteeEmail: invitee,
      inviteeSub: null,
      rosterHasInvitee: true,
      continueHref: paymentPath,
      paymentPath,
    };
  }

  const cookieStore = await cookies();
  const roster = readRosterCookie(cookieStore.get(ROSTER_COOKIE)?.value);
  const rosterMatch = roster.find((item) => (item.email || '').trim().toLowerCase() === invitee);

  if (rosterMatch?.sub) {
    const switchUrl = new URLSearchParams({
      sub: rosterMatch.sub,
      locale: input.locale,
      returnTo: paymentPath,
    });
    return {
      matched: false,
      inviteeEmail: invitee,
      inviteeSub: rosterMatch.sub,
      rosterHasInvitee: true,
      continueHref: `/api/auth/switch?${switchUrl.toString()}`,
      paymentPath,
    };
  }

  // Dedicated one-shot login — clears product session, opens Identity login (add account),
  // then returns to the payment page via /api/auth/bhd/start.
  const loginQs = new URLSearchParams({
    locale: input.locale,
    returnTo: paymentPath,
    email: invitee,
  });
  return {
    matched: false,
    inviteeEmail: invitee,
    inviteeSub: null,
    rosterHasInvitee: false,
    continueHref: `/api/auth/bhd/invite-login?${loginQs.toString()}`,
    paymentPath,
  };
}
