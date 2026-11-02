import type { ContractUse } from '@/lib/lease-terms';
import type { PartyDocAttach } from '@/lib/profile-completeness';

export type SignatoryForm = {
  name: string;
  civilId: string;
  phone: string;
  nationality: string;
  passport: string;
  civilIdExpiresOn: string;
  passportExpiresOn: string;
  civilIdCopy?: PartyDocAttach | undefined;
  passportCopy?: PartyDocAttach | undefined;
};

export type PartyForm = {
  contractType: ContractUse;
  termMonths: string;
  entityType: 'person' | 'company';
  person: {
    nameAr: string;
    nameEn: string;
    nationality: string;
    civilId: string;
    passport: string;
    phone: string;
    altPhone: string;
    email: string;
    civilIdExpiresOn: string;
    passportExpiresOn: string;
    civilIdCopy?: PartyDocAttach | undefined;
    passportCopy?: PartyDocAttach | undefined;
    emailVerified: boolean;
  };
  company: {
    nameAr: string;
    nameEn: string;
    crNumber: string;
    crIssuedOn: string;
    crExpiry: string;
    email: string;
    phone: string;
    altPhone: string;
    crAddress: string;
    activity: string;
    signingMode: 'single' | 'joint';
    signatories: SignatoryForm[];
    crCopy?: PartyDocAttach | undefined;
    emailVerified: boolean;
  };
};

export const EMPTY_SIGNATORY: SignatoryForm = {
  name: '',
  civilId: '',
  phone: '',
  nationality: 'OM',
  passport: '',
  civilIdExpiresOn: '',
  passportExpiresOn: '',
};

export function emptyPartyForm(
  minMonths: number,
  contractType: ContractUse = 'residential',
): PartyForm {
  return {
    contractType,
    termMonths: String(Math.max(minMonths, 12)),
    entityType: 'person',
    person: {
      nameAr: '',
      nameEn: '',
      nationality: 'OM',
      civilId: '',
      passport: '',
      phone: '',
      altPhone: '',
      email: '',
      civilIdExpiresOn: '',
      passportExpiresOn: '',
      emailVerified: false,
    },
    company: {
      nameAr: '',
      nameEn: '',
      crNumber: '',
      crIssuedOn: '',
      crExpiry: '',
      email: '',
      phone: '',
      altPhone: '',
      crAddress: '',
      activity: '',
      signingMode: 'single',
      signatories: [{ ...EMPTY_SIGNATORY }],
      emailVerified: false,
    },
  };
}
