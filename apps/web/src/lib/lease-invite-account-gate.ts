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

/**
 * When an owner-invite payment link is opened under the wrong browser account,
 * redirect to the invitee account (roster switch) or force login with that email.
 */
export async function resolveOwnerInviteAccountRedirect(input: {
  locale: string;
  paymentPath: string;
  inviteeEmail: string;
  viewerEmail: string | null | undefined;
}): Promise<string | null> {
  const invitee = input.inviteeEmail.trim().toLowerCase();
  if (!invitee || !invitee.includes('@')) return null;
  const current = (input.viewerEmail || '').trim().toLowerCase();
  if (current && current === invitee) return null;

  const cookieStore = await cookies();
  const roster = readRosterCookie(cookieStore.get(ROSTER_COOKIE)?.value);
  const rosterMatch = roster.find((item) => (item.email || '').trim().toLowerCase() === invitee);

  if (rosterMatch?.sub) {
    const switchUrl = new URLSearchParams({
      sub: rosterMatch.sub,
      locale: input.locale,
      returnTo: input.paymentPath,
    });
    return `/api/auth/switch?${switchUrl.toString()}`;
  }

  const startQs = new URLSearchParams({
    returnTo: input.paymentPath,
    login_hint: invitee,
    prompt: 'login',
  });
  const startPath = `/api/auth/bhd/start?${startQs.toString()}`;
  if (!current) return startPath;

  const logoutQs = new URLSearchParams({
    locale: input.locale,
    continue: startPath,
  });
  return `/api/auth/bhd/logout?${logoutQs.toString()}`;
}
