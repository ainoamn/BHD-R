import type { MissingField } from '@/lib/profile-completeness';
import { isIsoDate, parseMoney, type LeaseTermsDraft } from '@/lib/lease-terms';

export type LeaseTenantSnapshot = {
  entityType: 'person' | 'company';
  nameAr: string;
  phone?: string | undefined;
  civilId?: string | undefined;
  crNumber?: string | undefined;
  crExpiry?: string | undefined;
  signatoryName?: string | undefined;
};

function gap(code: string, labelAr: string, labelEn: string): MissingField {
  return { code, labelAr, labelEn, group: 'lease' };
}

function blank(value: string | null | undefined): boolean {
  return !value || !String(value).trim();
}

/**
 * Required lease-contract fields still empty — drives the red highlights and the
 * missing-fields banner on the booking / manual lease form.
 */
export function missingLeaseContractFields(input: {
  unitId: string;
  tenant: LeaseTenantSnapshot;
  draft: LeaseTermsDraft;
  digits: number;
  deferMeters: boolean;
  deferHandover: boolean;
}): MissingField[] {
  const { unitId, tenant, draft, digits, deferMeters, deferHandover } = input;
  const out: MissingField[] = [];
  const isCheque = draft.paymentMethod === 'cheque';

  if (blank(unitId)) out.push(gap('unit', 'الوحدة', 'Unit'));
  if (blank(draft.contractType)) {
    out.push(gap('contract_type', 'نوع العقد', 'Contract type'));
  }
  if (blank(draft.usageType)) {
    out.push(gap('usage_type', 'نوع الاستعمال', 'Usage type'));
  }
  if (blank(tenant.nameAr) || tenant.nameAr.trim().length < 2) {
    out.push(gap('tenant_name', 'اسم المستأجر (عربي)', 'Tenant name (Arabic)'));
  }
  if (tenant.entityType === 'person') {
    if (blank(tenant.civilId)) out.push(gap('civil_id', 'الرقم المدني', 'Civil ID'));
  } else {
    if (blank(tenant.crNumber)) out.push(gap('cr_number', 'رقم السجل التجاري', 'CR number'));
    if (blank(tenant.crExpiry) || !isIsoDate(tenant.crExpiry ?? '')) {
      out.push(gap('cr_expiry', 'انتهاء السجل التجاري', 'CR expiry'));
    }
    if (blank(tenant.signatoryName)) {
      out.push(gap('signatory', 'المفوّض بالتوقيع', 'Signatory name'));
    }
  }
  if (blank(tenant.phone)) out.push(gap('phone', 'هاتف المستأجر', 'Tenant phone'));

  if (draft.rentCalcMode === 'per_meter') {
    if (blank(draft.rentAreaSqm)) out.push(gap('area', 'عدد الأمتار', 'Area (m²)'));
    if (parseMoney(draft.rentPerSqm, digits) === null) {
      out.push(gap('rent_sqm', 'قيمة المتر', 'Rate per m²'));
    }
  } else if (parseMoney(draft.monthlyRent, digits) === null) {
    out.push(gap('monthly_rent', 'الإيجار الشهري', 'Monthly rent'));
  }

  if (!deferHandover && (blank(draft.handoverOn) || !isIsoDate(draft.handoverOn ?? ''))) {
    out.push(gap('handover', 'تاريخ استلام الوحدة', 'Unit handover date'));
  }
  if (!isIsoDate(draft.startsOn)) out.push(gap('starts', 'تاريخ البداية', 'Start date'));
  if (!isIsoDate(draft.endsOn) || draft.endsOn <= draft.startsOn) {
    out.push(gap('ends', 'تاريخ النهاية', 'End date'));
  }
  if (blank(draft.paymentDay)) out.push(gap('payment_day', 'يوم دفع الإيجار', 'Payment day'));

  if (!draft.paymentMethod) {
    out.push(gap('payment_method', 'طريقة الدفع', 'Payment method'));
  }
  if (!draft.paymentFrequency) {
    out.push(gap('payment_frequency', 'دورية الدفع', 'Payment frequency'));
  }

  if (!deferMeters) {
    if (blank(draft.electricityReading)) {
      out.push(gap('electricity', 'قراءة الكهرباء', 'Electricity reading'));
    }
    if (blank(draft.waterReading)) out.push(gap('water', 'قراءة الماء', 'Water reading'));
    if (blank(draft.electricityReadingPhoto)) {
      out.push(gap('electricity_photo', 'صورة عداد الكهرباء', 'Electricity meter photo'));
    }
    if (blank(draft.waterReadingPhoto)) {
      out.push(gap('water_photo', 'صورة عداد الماء', 'Water meter photo'));
    }
  }

  if (isCheque) {
    if (blank(draft.rentBankAccountId)) {
      out.push(gap('rent_bank', 'حساب / مستفيد الشيكات', 'Cheque payee / bank account'));
    }
    if (blank(draft.chequeBankName)) {
      out.push(gap('cheque_bank', 'بنك الشيكات', 'Cheque bank'));
    }
    if (blank(draft.chequeAccountName)) {
      out.push(gap('cheque_name', 'اسم صاحب الحساب على الشيك', 'Cheque account name'));
    }
    // Rent/deposit cheque numbers are filled by the tenant with uploads — not required here.
  }

  if (!draft.schedule.length) {
    out.push(gap('schedule', 'جدول الدفع', 'Payment schedule'));
  } else if (
    draft.schedule.some((row) => !isIsoDate(row.dueOn) || parseMoney(row.rent, digits) === null)
  ) {
    out.push(gap('schedule_rows', 'صفوف جدول الدفع', 'Payment schedule rows'));
  }

  if (parseMoney(draft.deposit, digits) === null) {
    out.push(gap('deposit', 'مبلغ التأمين', 'Deposit amount'));
  }

  return out;
}
