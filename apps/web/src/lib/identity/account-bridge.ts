import 'server-only';
import { identitySettings } from '@/lib/bhd/oauth';

export type IdentityAccountFileMeta = {
  id: string;
  filename: string;
  kind: string;
};

export type IdentityAccountProfile = {
  user: {
    id: string;
    name: string;
    email: string;
    username: string | null;
    phone: string | null;
    gender: string | null;
    birthDate: string | null;
    nationality: string | null;
    nameAr: string | null;
    nameEn: string | null;
    civilId: string | null;
    civilIdExpires: string | null;
    passportNumber: string | null;
    passportExpires: string | null;
    accountKind: 'person' | 'company';
    companyNameAr: string | null;
    companyNameEn: string | null;
    crNumber: string | null;
    crExpires: string | null;
    taxId: string | null;
    picture: string | null;
    emailVerified: boolean;
    googleLinked: boolean;
    facebookLinked: boolean;
    hasPassword: boolean;
    createdAt: string | null;
    lastLoginAt: string | null;
  };
  contact: {
    phone2: string | null;
    whatsapp: string | null;
    address: string | null;
    city: string | null;
    hometown: string | null;
    country: string | null;
    zipCode: string | null;
    crNumber?: string | null;
    taxId?: string | null;
  } | null;
  files: {
    civilIdFile: IdentityAccountFileMeta | null;
    passportFile: IdentityAccountFileMeta | null;
    commercialRegisterFile: IdentityAccountFileMeta | null;
    authorizationFile: IdentityAccountFileMeta | null;
  };
  fetchedAt: string;
  accountUrl: string;
};

function productAuthHeaders(clientId: string, clientSecret: string): HeadersInit {
  const token = Buffer.from(`${clientId}:${clientSecret}`, 'utf8').toString('base64');
  return {
    Authorization: `Basic ${token}`,
    Accept: 'application/json',
  };
}

/** Live Identity account profile for a linked `identity_subject` (no local cache). */
export async function fetchIdentityAccountProfile(
  identitySubject: string,
): Promise<IdentityAccountProfile | null> {
  const sub = identitySubject.trim();
  if (!sub) return null;
  const { issuer, clientId, clientSecret } = identitySettings('https://r.bhd-om.com');
  if (!clientSecret) return null;

  const url = new URL('/api/product/account', issuer);
  url.searchParams.set('sub', sub);

  try {
    const response = await fetch(url, {
      method: 'GET',
      headers: productAuthHeaders(clientId, clientSecret),
      cache: 'no-store',
      signal: AbortSignal.timeout(12_000),
    });
    if (!response.ok) return null;
    const body = (await response.json()) as {
      user?: IdentityAccountProfile['user'];
      contact?: IdentityAccountProfile['contact'];
      files?: IdentityAccountProfile['files'];
      fetchedAt?: string;
    };
    if (!body.user?.id) return null;
    return {
      user: body.user,
      contact: body.contact ?? null,
      files: body.files ?? {
        civilIdFile: null,
        passportFile: null,
        commercialRegisterFile: null,
        authorizationFile: null,
      },
      fetchedAt: body.fetchedAt ?? new Date().toISOString(),
      accountUrl: `${issuer}/account?au=${encodeURIComponent(sub)}`,
    };
  } catch {
    return null;
  }
}

/** Stream an Identity account attachment for site-admin inspection. */
export async function fetchIdentityAccountFile(
  identitySubject: string,
  kind: string,
): Promise<{ bytes: Buffer; mime: string; filename: string } | null> {
  const sub = identitySubject.trim();
  if (!sub || !kind) return null;
  const { issuer, clientId, clientSecret } = identitySettings('https://r.bhd-om.com');
  if (!clientSecret) return null;

  const url = new URL('/api/product/account/file', issuer);
  url.searchParams.set('sub', sub);
  url.searchParams.set('kind', kind);

  try {
    const response = await fetch(url, {
      method: 'GET',
      headers: productAuthHeaders(clientId, clientSecret),
      cache: 'no-store',
      signal: AbortSignal.timeout(20_000),
    });
    if (!response.ok) return null;
    const mime = response.headers.get('content-type') || 'application/octet-stream';
    const disposition = response.headers.get('content-disposition') || '';
    const match = /filename\*?=(?:UTF-8''|")?([^";]+)/i.exec(disposition);
    const filename = match
      ? decodeURIComponent(match[1]!.replace(/"/g, ''))
      : `${kind}.bin`;
    const bytes = Buffer.from(await response.arrayBuffer());
    return { bytes, mime, filename };
  } catch {
    return null;
  }
}
