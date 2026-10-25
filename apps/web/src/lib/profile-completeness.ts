/**
 * Live missing-field rules for lessor (owner), tenant (person/company), and building.
 * Used by booking forms and owner portal alerts.
 */

export type MissingField = {
  code: string;
  labelAr: string;
  labelEn: string;
  group: 'owner' | 'tenant' | 'company' | 'signatory' | 'building' | 'agent';
};

export type PartyDocAttach = {
  name: string;
  mime: string;
  size: number;
  /** Optional inline preview; kept small for reservation snapshots. */
  dataUrl?: string | undefined;
};

export type CompletenessPerson = {
  nameAr?: string | undefined;
  nameEn?: string | undefined;
  nationality?: string | undefined;
  civilId?: string | undefined;
  civilIdExpiresOn?: string | undefined;
  civilIdCopy?: PartyDocAttach | undefined;
  passport?: string | undefined;
  passportExpiresOn?: string | undefined;
  passportCopy?: PartyDocAttach | undefined;
  phone?: string | undefined;
  altPhone?: string | undefined;
  email?: string | undefined;
  emailVerified?: boolean | undefined;
};

export type CompletenessSignatory = {
  name?: string | undefined;
  nationality?: string | undefined;
  civilId?: string | undefined;
  civilIdExpiresOn?: string | undefined;
  civilIdCopy?: PartyDocAttach | undefined;
  passport?: string | undefined;
  passportExpiresOn?: string | undefined;
  passportCopy?: PartyDocAttach | undefined;
  phone?: string | undefined;
};

export type CompletenessCompany = {
  nameAr?: string | undefined;
  nameEn?: string | undefined;
  crNumber?: string | undefined;
  crIssuedOn?: string | undefined;
  crExpiry?: string | undefined;
  crCopy?: PartyDocAttach | undefined;
  email?: string | undefined;
  emailVerified?: boolean | undefined;
  phone?: string | undefined;
  altPhone?: string | undefined;
  crAddress?: string | undefined;
  activity?: string | undefined;
  signingMode?: 'single' | 'joint' | undefined;
  signatories?: CompletenessSignatory[] | undefined;
};

export type CompletenessOwner = {
  displayName?: string | undefined;
  civilId?: string | undefined;
  phone?: string | undefined;
  civilIdCopy?: boolean | undefined;
  civilIdExpiresOn?: string | undefined;
  /** Agent acting for an owner. */
  isAgent?: boolean | undefined;
  hasPowerOfAttorney?: boolean | undefined;
  principalCivilIdCopy?: boolean | undefined;
};

export type CompletenessBuilding = {
  nameAr?: string | undefined;
  nameEn?: string | undefined;
  governorate?: string | undefined;
  wilayat?: string | undefined;
  city?: string | undefined;
  mapsUrl?: string | undefined;
  category?: string | undefined;
};

function blank(value: string | null | undefined): boolean {
  return !value || !String(value).trim();
}

function missing(
  code: string,
  labelAr: string,
  labelEn: string,
  group: MissingField['group'],
): MissingField {
  return { code, labelAr, labelEn, group };
}

function isOmani(nationality: string | null | undefined): boolean {
  const value = (nationality ?? '').trim().toUpperCase();
  return value === 'OM' || value.includes('عمان') || value.includes('OMAN');
}

function hasCopy(doc: PartyDocAttach | null | undefined): boolean {
  return Boolean(doc?.name && doc.size > 0);
}

function isoOk(value: string | null | undefined): boolean {
  return Boolean(value && /^\d{4}-\d{2}-\d{2}$/.test(value));
}

/** Tenant individual: name, phones, email (+ verified), civil ID + expiry + copy; passport for expats. */
export function missingPersonFields(person: CompletenessPerson | null | undefined): MissingField[] {
  const out: MissingField[] = [];
  if (!person) {
    return [missing('tenant_missing', 'بيانات المستأجر', 'Tenant details', 'tenant')];
  }
  if (blank(person.nameAr)) out.push(missing('name_ar', 'الاسم بالعربية', 'Arabic name', 'tenant'));
  if (blank(person.phone)) out.push(missing('phone', 'رقم الهاتف', 'Phone number', 'tenant'));
  if (blank(person.altPhone))
    out.push(missing('alt_phone', 'رقم هاتف بديل', 'Alternate phone', 'tenant'));
  if (blank(person.email)) out.push(missing('email', 'البريد الإلكتروني', 'Email', 'tenant'));
  else if (!person.emailVerified) {
    out.push(
      missing('email_verified', 'تأكيد البريد الإلكتروني (رمز OTP)', 'Email verified (OTP)', 'tenant'),
    );
  }
  if (blank(person.civilId))
    out.push(missing('civil_id', 'الرقم المدني / البطاقة', 'Civil ID number', 'tenant'));
  if (!isoOk(person.civilIdExpiresOn)) {
    out.push(
      missing('civil_id_expiry', 'تاريخ انتهاء البطاقة', 'Civil ID expiry date', 'tenant'),
    );
  }
  if (!hasCopy(person.civilIdCopy)) {
    out.push(missing('civil_id_copy', 'نسخة من البطاقة', 'Civil ID copy', 'tenant'));
  }
  if (!isOmani(person.nationality)) {
    if (blank(person.passport))
      out.push(missing('passport', 'رقم الجواز', 'Passport number', 'tenant'));
    if (!isoOk(person.passportExpiresOn)) {
      out.push(
        missing('passport_expiry', 'تاريخ انتهاء الجواز', 'Passport expiry date', 'tenant'),
      );
    }
    if (!hasCopy(person.passportCopy)) {
      out.push(missing('passport_copy', 'نسخة من الجواز', 'Passport copy', 'tenant'));
    }
  }
  return out;
}

function missingSignatoryFields(
  row: CompletenessSignatory,
  index: number,
): MissingField[] {
  const tag = index + 1;
  const out: MissingField[] = [];
  if (blank(row.name))
    out.push(missing(`sig${tag}_name`, `اسم المفوّض ${tag}`, `Signatory ${tag} name`, 'signatory'));
  if (blank(row.phone))
    out.push(
      missing(`sig${tag}_phone`, `هاتف المفوّض ${tag}`, `Signatory ${tag} phone`, 'signatory'),
    );
  if (blank(row.nationality)) {
    out.push(
      missing(
        `sig${tag}_nationality`,
        `جنسية المفوّض ${tag}`,
        `Signatory ${tag} nationality`,
        'signatory',
      ),
    );
  }
  const omani = isOmani(row.nationality);
  if (omani) {
    if (blank(row.civilId)) {
      out.push(
        missing(`sig${tag}_civil`, `بطاقة المفوّض ${tag}`, `Signatory ${tag} civil ID`, 'signatory'),
      );
    }
    if (!isoOk(row.civilIdExpiresOn)) {
      out.push(
        missing(
          `sig${tag}_civil_expiry`,
          `انتهاء بطاقة المفوّض ${tag}`,
          `Signatory ${tag} ID expiry`,
          'signatory',
        ),
      );
    }
    if (!hasCopy(row.civilIdCopy)) {
      out.push(
        missing(
          `sig${tag}_civil_copy`,
          `نسخة بطاقة المفوّض ${tag}`,
          `Signatory ${tag} ID copy`,
          'signatory',
        ),
      );
    }
  } else {
    if (blank(row.passport)) {
      out.push(
        missing(
          `sig${tag}_passport`,
          `جواز المفوّض ${tag}`,
          `Signatory ${tag} passport`,
          'signatory',
        ),
      );
    }
    if (!isoOk(row.passportExpiresOn)) {
      out.push(
        missing(
          `sig${tag}_passport_expiry`,
          `انتهاء جواز المفوّض ${tag}`,
          `Signatory ${tag} passport expiry`,
          'signatory',
        ),
      );
    }
    if (!hasCopy(row.passportCopy)) {
      out.push(
        missing(
          `sig${tag}_passport_copy`,
          `نسخة جواز المفوّض ${tag}`,
          `Signatory ${tag} passport copy`,
          'signatory',
        ),
      );
    }
  }
  return out;
}

/** Company tenant: CR package + single/joint signatories with ID copies and expiry. */
export function missingCompanyFields(
  company: CompletenessCompany | null | undefined,
): MissingField[] {
  const out: MissingField[] = [];
  if (!company) {
    return [missing('company_missing', 'بيانات الشركة', 'Company details', 'company')];
  }
  if (blank(company.nameAr))
    out.push(missing('company_name_ar', 'اسم الشركة (عربي)', 'Company Arabic name', 'company'));
  if (blank(company.crNumber))
    out.push(missing('cr_number', 'رقم السجل التجاري', 'CR number', 'company'));
  if (!isoOk(company.crIssuedOn))
    out.push(missing('cr_issued', 'تاريخ التأسيس', 'Establishment date', 'company'));
  if (!isoOk(company.crExpiry))
    out.push(missing('cr_expiry', 'تاريخ انتهاء السجل', 'CR expiry date', 'company'));
  if (!hasCopy(company.crCopy))
    out.push(missing('cr_copy', 'نسخة السجل التجاري', 'CR document copy', 'company'));
  if (blank(company.phone)) out.push(missing('company_phone', 'هاتف الشركة', 'Company phone', 'company'));
  if (blank(company.altPhone))
    out.push(missing('company_alt_phone', 'هاتف بديل للشركة', 'Company alternate phone', 'company'));
  if (blank(company.email))
    out.push(missing('company_email', 'بريد الشركة', 'Company email', 'company'));
  else if (!company.emailVerified) {
    out.push(
      missing(
        'company_email_verified',
        'تأكيد بريد الشركة (رمز OTP)',
        'Company email verified (OTP)',
        'company',
      ),
    );
  }
  if (blank(company.crAddress))
    out.push(missing('cr_address', 'عنوان السجل', 'CR address', 'company'));
  if (blank(company.activity))
    out.push(missing('activity', 'النشاط', 'Business activity', 'company'));
  if (company.signingMode !== 'single' && company.signingMode !== 'joint') {
    out.push(
      missing('signing_mode', 'طريقة التوقيع (منفرد / متحد)', 'Signing mode (single / joint)', 'company'),
    );
  }
  const signatories = company.signatories ?? [];
  const need = company.signingMode === 'joint' ? 2 : 1;
  if (signatories.length < need) {
    out.push(
      missing(
        'signatories_count',
        company.signingMode === 'joint'
          ? 'مفوّضان على الأقل للتوقيع المتحد'
          : 'مفوّض بالتوقيع',
        company.signingMode === 'joint'
          ? 'At least two joint signatories'
          : 'Authorized signatory',
        'signatory',
      ),
    );
  }
  signatories.slice(0, Math.max(need, signatories.length)).forEach((row, index) => {
    out.push(...missingSignatoryFields(row, index));
  });
  return out;
}

export function missingOwnerFields(owner: CompletenessOwner | null | undefined): MissingField[] {
  const out: MissingField[] = [];
  if (!owner) {
    return [missing('owner_missing', 'بيانات المالك', 'Owner details', 'owner')];
  }
  if (blank(owner.displayName))
    out.push(missing('owner_name', 'اسم المالك', 'Owner name', 'owner'));
  if (blank(owner.civilId))
    out.push(missing('owner_civil_id', 'الرقم المدني للمالك', 'Owner civil ID', 'owner'));
  if (blank(owner.phone))
    out.push(missing('owner_phone', 'هاتف المالك', 'Owner phone', 'owner'));
  if (!owner.civilIdCopy)
    out.push(missing('owner_civil_copy', 'نسخة بطاقة المالك', 'Owner ID copy', 'owner'));
  if (!isoOk(owner.civilIdExpiresOn)) {
    out.push(
      missing('owner_civil_expiry', 'انتهاء بطاقة المالك', 'Owner ID expiry', 'owner'),
    );
  }
  if (owner.isAgent) {
    if (!owner.hasPowerOfAttorney) {
      out.push(missing('poa', 'الوكالة الشرعية', 'Power of attorney', 'agent'));
    }
    if (!owner.principalCivilIdCopy) {
      out.push(
        missing(
          'principal_civil_copy',
          'نسخة بطاقة المالك الأصيل',
          'Principal owner ID copy',
          'agent',
        ),
      );
    }
  }
  return out;
}

export function missingBuildingFields(
  building: CompletenessBuilding | null | undefined,
): MissingField[] {
  const out: MissingField[] = [];
  if (!building) {
    return [missing('building_missing', 'بيانات المبنى', 'Building details', 'building')];
  }
  if (blank(building.nameAr))
    out.push(missing('building_name_ar', 'اسم المبنى (عربي)', 'Building Arabic name', 'building'));
  if (blank(building.category))
    out.push(missing('building_category', 'تصنيف المبنى', 'Building category', 'building'));
  if (blank(building.governorate))
    out.push(missing('governorate', 'المحافظة', 'Governorate', 'building'));
  if (blank(building.wilayat)) out.push(missing('wilayat', 'الولاية', 'Wilayat', 'building'));
  if (blank(building.city)) out.push(missing('city', 'المدينة / القرية', 'City / village', 'building'));
  if (blank(building.mapsUrl))
    out.push(missing('maps_url', 'رابط خرائط جوجل', 'Google Maps link', 'building'));
  return out;
}

export function missingFieldLabel(field: MissingField, ar: boolean): string {
  return ar ? field.labelAr : field.labelEn;
}
