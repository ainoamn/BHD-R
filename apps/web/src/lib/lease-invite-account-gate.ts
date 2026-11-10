import { cookies } from 'next/headers';
import { ROSTER_COOKIE, readRosterCookie } from '@/lib/bhd/account-roster';

/** Relative payment URL the invitee should return to after switch / login. */
export function leaseInvitePaymentReturnPath(
  locale: string,
  sessionReference: string,
  returnPath?: string,
): string {
  const qs = new URLSearchParams({ kind: 'lease' });
  if (returnPath) qs.set('return', returnPath);
  return `/${locale}/payments/sandbox/${encodeURIComponent(sessionReference)}?${qs.toString()}`;
}

export type OwnerInviteAccountGate = {
  matched: boolean;
  inviteeEmail: string;
  rosterHasInvitee: boolean;
  /** User-initiated only — never auto-followed (prevents OAuth thrash / slow_down). */
  continueHref: string;
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
  const current = (input.viewerEmail || '').trim().toLowerCase();
  if (current && current === invitee) {
    return {
      matched: true,
      inviteeEmail: invitee,
      rosterHasInvitee: true,
      continueHref: input.paymentPath,
    };
  }

  const cookieStore = await cookies();
  const roster = readRosterCookie(cookieStore.get(ROSTER_COOKIE)?.value);
  const rosterMatch = roster.find((item) => (item.email || '').trim().toLowerCase() === invitee);

  if (rosterMatch?.sub) {
    const switchUrl = new URLSearchParams({
      sub: rosterMatch.sub,
      locale: input.locale,
      returnTo: input.paymentPath,
    });
    return {
      matched: false,
      inviteeEmail: invitee,
      rosterHasInvitee: true,
      continueHref: `/api/auth/switch?${switchUrl.toString()}`,
    };
  }

  // Dedicated one-shot login — clears product session once, then OIDC with login_hint.
  // Avoids logout→next-roster-account thrashing that caused slow_down.
  const loginQs = new URLSearchParams({
    locale: input.locale,
    returnTo: input.paymentPath,
    email: invitee,
  });
  return {
    matched: false,
    inviteeEmail: invitee,
    rosterHasInvitee: false,
    continueHref: `/api/auth/bhd/invite-login?${loginQs.toString()}`,
  };
}
