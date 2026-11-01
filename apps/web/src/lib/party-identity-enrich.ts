import 'server-only';
import {
  fetchIdentityAccountProfile,
  type IdentityAccountProfile,
} from '@/lib/identity/account-bridge';

export type PartyIdentitySnapshot = {
  subject: string;
  nameAr: string | null;
  nameEn: string | null;
  phone: string | null;
  phone2: string | null;
  whatsapp: string | null;
  email: string | null;
  gender: string | null;
  birthDate: string | null;
  nationality: string | null;
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
  address: string | null;
  city: string | null;
  hometown: string | null;
  country: string | null;
  zipCode: string | null;
  files: IdentityAccountProfile['files'];
  fetchedAt: string;
};

export function toPartyIdentitySnapshot(
  profile: IdentityAccountProfile,
): PartyIdentitySnapshot {
  const u = profile.user;
  const c = profile.contact;
  return {
    subject: profile.user.id,
    nameAr: u.nameAr?.trim() || u.name?.trim() || null,
    nameEn: u.nameEn?.trim() || null,
    phone: u.phone?.trim() || null,
    phone2: c?.phone2?.trim() || null,
    whatsapp: c?.whatsapp?.trim() || null,
    email: u.email?.trim().toLowerCase() || null,
    gender: u.gender?.trim() || null,
    birthDate: u.birthDate?.trim() || null,
    nationality: u.nationality?.trim() || null,
    civilId: u.civilId?.trim() || null,
    civilIdExpires: u.civilIdExpires?.trim() || null,
    passportNumber: u.passportNumber?.trim() || null,
    passportExpires: u.passportExpires?.trim() || null,
    accountKind: u.accountKind,
    companyNameAr: u.companyNameAr?.trim() || null,
    companyNameEn: u.companyNameEn?.trim() || null,
    crNumber: u.crNumber?.trim() || c?.crNumber?.trim() || null,
    crExpires: u.crExpires?.trim() || null,
    taxId: u.taxId?.trim() || c?.taxId?.trim() || null,
    address: c?.address?.trim() || null,
    city: c?.city?.trim() || null,
    hometown: c?.hometown?.trim() || null,
    country: c?.country?.trim() || u.nationality?.trim() || null,
    zipCode: c?.zipCode?.trim() || null,
    files: profile.files,
    fetchedAt: profile.fetchedAt,
  };
}

/** Live Identity profile for a product user (by identity_subject). */
export async function loadIdentitySnapshotForSubject(
  identitySubject: string | null | undefined,
): Promise<PartyIdentitySnapshot | null> {
  const sub = identitySubject?.trim();
  if (!sub) return null;
  const profile = await fetchIdentityAccountProfile(sub);
  if (!profile) return null;
  return toPartyIdentitySnapshot(profile);
}

export function partyFieldsFromIdentity(snapshot: PartyIdentitySnapshot): {
  displayName: string;
  phone: string | null;
  type: 'person' | 'company';
  nameEn: string | null;
  metadataPatch: Record<string, unknown>;
} {
  const displayName =
    snapshot.accountKind === 'company'
      ? snapshot.companyNameAr || snapshot.nameAr || snapshot.email || 'BHD'
      : snapshot.nameAr || snapshot.nameEn || snapshot.email || 'BHD';
  return {
    displayName,
    phone: snapshot.phone || snapshot.whatsapp || snapshot.phone2 || null,
    type: snapshot.accountKind,
    nameEn:
      snapshot.accountKind === 'company'
        ? snapshot.companyNameEn || snapshot.nameEn
        : snapshot.nameEn,
    metadataPatch: {
      nameEn:
        snapshot.accountKind === 'company'
          ? snapshot.companyNameEn || snapshot.nameEn
          : snapshot.nameEn,
      identitySubject: snapshot.subject,
      identityAccount: snapshot,
      identitySyncedAt: snapshot.fetchedAt,
    },
  };
}
