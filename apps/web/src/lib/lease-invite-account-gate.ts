import { cookies } from 'next/headers';
import { ROSTER_COOKIE, readRosterCookie } from '@/lib/bhd/account-roster';
import { bindAuToReturnPath, stripAuFromReturnPath } from '@/lib/bhd/oauth';

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
  /** Destination after switch / login (pinned with invitee ?au= when known). */
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
  /** Known identity subject for the invitee (from bookedBy) — prefer over roster email only. */
  inviteeSub?: string | null;
}): Promise<OwnerInviteAccountGate | null> {
  const invitee = input.inviteeEmail.trim().toLowerCase();
  if (!invitee || !invitee.includes('@')) return null;
  const knownSub = (input.inviteeSub || '').trim() || null;
  const cleaned = stripAuFromReturnPath(input.paymentPath);
  const current = (input.viewerEmail || '').trim().toLowerCase();
  if (current && current === invitee) {
    const paymentPath = bindAuToReturnPath(cleaned, knownSub);
    return {
      matched: true,
      inviteeEmail: invitee,
      inviteeSub: knownSub,
      rosterHasInvitee: true,
      continueHref: paymentPath,
      paymentPath,
    };
  }

  const cookieStore = await cookies();
  const roster = readRosterCookie(cookieStore.get(ROSTER_COOKIE)?.value);
  const rosterMatch =
    roster.find((item) => (item.email || '').trim().toLowerCase() === invitee) ||
    (knownSub ? roster.find((item) => item.sub === knownSub) : undefined);
  const inviteeSub = rosterMatch?.sub || knownSub;

  if (rosterMatch?.sub) {
    const paymentPath = bindAuToReturnPath(cleaned, rosterMatch.sub);
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
      // Product GET switch rebinds cookie, or Identity HTML switch + /api/auth/bhd/start.
      // Do not pass email here — that used to fall through to invite-login and wipe the session.
      continueHref: `/api/auth/switch?${switchUrl.toString()}`,
      paymentPath,
    };
  }

  // Dedicated one-shot login — clears product session, opens Identity login (add account),
  // then returns to the payment page via /api/auth/bhd/start.
  const paymentPath = bindAuToReturnPath(cleaned, inviteeSub);
  const loginQs = new URLSearchParams({
    locale: input.locale,
    returnTo: paymentPath,
    email: invitee,
  });
  return {
    matched: false,
    inviteeEmail: invitee,
    inviteeSub,
    rosterHasInvitee: false,
    continueHref: `/api/auth/bhd/invite-login?${loginQs.toString()}`,
    paymentPath,
  };
}
