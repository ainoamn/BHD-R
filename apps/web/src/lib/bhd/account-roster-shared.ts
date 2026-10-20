/** Shared roster types + display helpers (safe for client components). */

export type AuthProvider = 'password' | 'google' | 'facebook' | 'whatsapp';

export type RosterAccount = {
  /** Identity `sub` (users.identity_subject) — used for identity switch. */
  sub: string;
  /** Display name kept for avatar initial only — never the primary list label. */
  name: string;
  email: string;
  username: string | null;
  phone: string | null;
  picture: string | null;
  providers: AuthProvider[];
};

const PROVIDERS: AuthProvider[] = ['password', 'google', 'facebook', 'whatsapp'];

export function asProviders(value: unknown): AuthProvider[] {
  if (!Array.isArray(value)) return [];
  return value.filter(
    (item): item is AuthProvider =>
      typeof item === 'string' && PROVIDERS.includes(item as AuthProvider),
  );
}

/** Match identity `inferProviders` — picture URL + explicit flags/providers. */
export function inferProviders(input: {
  picture?: string | null;
  providers?: AuthProvider[];
  googleLinked?: boolean;
  facebookLinked?: boolean;
  hasPassword?: boolean;
  via?: AuthProvider;
}): AuthProvider[] {
  const found = new Set<AuthProvider>(input.providers || []);
  if (input.googleLinked) found.add('google');
  if (input.facebookLinked) found.add('facebook');
  if (input.hasPassword) found.add('password');
  if (input.via) found.add(input.via);
  const picture = input.picture || '';
  if (picture.includes('googleusercontent.com')) found.add('google');
  if (picture.includes('fbcdn.net') || picture.includes('facebook.com')) found.add('facebook');
  return PROVIDERS.filter((item) => found.has(item));
}

/** Primary label: email → username → phone (never name alone — BHD-APP-SWITCHER §2.2). */
export function accountHandle(account: {
  email?: string | null;
  username?: string | null;
  phone?: string | null;
  name?: string | null;
}): string {
  const email = account.email?.trim() || '';
  if (email && !email.endsWith('@identity.bhd-om.local')) return email;
  const username = account.username?.trim() || '';
  if (username) return username;
  const phone = account.phone?.trim() || '';
  if (phone) return phone;
  return account.name?.trim() || email || 'BHD';
}

/** Secondary line: username and/or phone when not already the primary handle. */
export function accountMeta(account: {
  email?: string | null;
  username?: string | null;
  phone?: string | null;
}): string[] {
  const handle = accountHandle(account);
  return [account.username, account.phone]
    .map((item) => item?.trim() || '')
    .filter((item, index, list) => item && list.indexOf(item) === index && item !== handle);
}
