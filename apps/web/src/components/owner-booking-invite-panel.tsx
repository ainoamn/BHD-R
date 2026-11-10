'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { currencyMinorUnits, type CurrencyCode } from '@bhd-r/contracts';
import {
  ReservationPartyForm,
  buildReservationParty,
  emptyPartyForm,
  type PartyForm,
} from '@/components/reservation-party-form';
import { BookingStepScene } from '@/components/stays/booking-step-scene';
import { ApiError, fetchBrowserCsrfToken, humanizeBrowserError } from '@/lib/api';
import type { BookingStepGreeting } from '@/lib/booking-step-greeting';
import { toMinorUnits } from '@/lib/format';
import { fromMinor } from '@/lib/legal-case-shared';
import { partyDisplayName } from '@/lib/reservation-party';
import { toInternationalPhone } from '@/lib/world-countries';

/** Owner invite may set any whole-month term from 1 upward (property minimum is for public booking). */
const OWNER_INVITE_MIN_LEASE_MONTHS = 1;

type UnitOption = {
  id: string;
  propertyId?: string;
  code?: string;
  name?: string;
  nameAr?: string;
  nameEn?: string;
  currency?: string;
  listingPurpose?: 'rent' | 'sale' | 'both' | string;
  rentMinor?: string | null;
  depositMinor?: string | null;
  propertyNameAr?: string;
  propertyNameEn?: string;
  propertySerial?: string;
  ownerName?: string;
};

function majorFromMinor(minor: string | null | undefined, currency: string): string {
  if (!minor || !/^\d+$/.test(minor)) return '';
  const scale = currencyMinorUnits[currency as CurrencyCode] ?? 3;
  const raw = fromMinor(minor, scale);
  return raw.replace(/(\.\d*?[1-9])0+$/, '$1').replace(/\.0+$/, '');
}

function muscatTodayIso(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Muscat' }).format(new Date());
}

type TenantOption = {
  id: string;
  displayName?: string;
  name?: string;
  nameAr?: string;
  nameEn?: string;
  email?: string | null;
  phone?: string | null;
  type?: string;
};

type Mode = 'rent' | 'sale';
type Step = 'unit' | 'party' | 'contract' | 'review';
type ContractPreference = 'electronic' | 'manual';

const STEPS: Step[] = ['unit', 'party', 'contract', 'review'];

function unitMatchesMode(unit: UnitOption, mode: Mode): boolean {
  const purpose = (unit.listingPurpose || 'both').toLowerCase();
  if (purpose === 'both') return true;
  return purpose === mode;
}

function unitSearchHaystack(unit: UnitOption): string {
  return [
    unit.code,
    unit.name,
    unit.nameAr,
    unit.nameEn,
    unit.propertyNameAr,
    unit.propertyNameEn,
    unit.propertySerial,
    unit.ownerName,
  ]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();
}

function unitOptionLabel(unit: UnitOption, ar: boolean): string {
  const unitName = unit.name || unit.nameAr || unit.nameEn || unit.code || unit.id.slice(0, 8);
  const property =
    (ar ? unit.propertyNameAr || unit.propertyNameEn : unit.propertyNameEn || unit.propertyNameAr) ||
    '';
  const serial = unit.propertySerial?.trim() || '';
  const owner = unit.ownerName?.trim() || '';
  const bits = [unitName];
  if (property) bits.push(property);
  if (serial) bits.push(serial);
  if (owner) bits.push(owner);
  return bits.join(' · ');
}

/**
 * Landlord-facing booking create — same step scenes as public /book, but the
 * owner fills the tenant and lease details then invites them by email + WhatsApp.
 */
export function OwnerBookingInvitePanel({
  portal,
  locale,
  vacantUnits,
  tenants,
  initialMode = 'rent',
  onDone,
  onCancel,
}: {
  portal: string;
  locale: 'ar' | 'en';
  vacantUnits: UnitOption[];
  tenants: TenantOption[];
  initialMode?: Mode;
  onDone: () => void;
  onCancel: () => void;
}) {
  const ar = locale === 'ar';
  const router = useRouter();
  const [step, setStep] = useState<Step>('unit');
  const [unitId, setUnitId] = useState('');
  const [mode, setMode] = useState<Mode>(initialMode);
  const [unitQuery, setUnitQuery] = useState('');
  const [partyForm, setPartyForm] = useState<PartyForm>(() =>
    emptyPartyForm(OWNER_INVITE_MIN_LEASE_MONTHS),
  );
  const [directoryId, setDirectoryId] = useState('');
  const [contractPreference, setContractPreference] =
    useState<ContractPreference>('electronic');
  const [rentMajor, setRentMajor] = useState('');
  const [depositMajor, setDepositMajor] = useState('');
  const [leaseStartsOn, setLeaseStartsOn] = useState('');
  const [handoverOn, setHandoverOn] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const modeUnits = useMemo(
    () => vacantUnits.filter((unit) => unitMatchesMode(unit, mode)),
    [vacantUnits, mode],
  );

  const filteredUnits = useMemo(() => {
    const needle = unitQuery.trim().toLowerCase();
    if (!needle) return modeUnits;
    return modeUnits.filter((unit) => unitSearchHaystack(unit).includes(needle));
  }, [modeUnits, unitQuery]);

  useEffect(() => {
    if (unitId && !modeUnits.some((unit) => unit.id === unitId)) {
      setUnitId('');
    }
  }, [modeUnits, unitId]);

  const selectedUnit = useMemo(
    () => vacantUnits.find((row) => row.id === unitId) ?? null,
    [vacantUnits, unitId],
  );
  const unitLabel = selectedUnit ? unitOptionLabel(selectedUnit, ar) : '';
  const unitCurrency = (selectedUnit?.currency || 'OMR') as CurrencyCode;

  useEffect(() => {
    if (!selectedUnit) {
      setRentMajor('');
      setDepositMajor('');
      setLeaseStartsOn('');
      setHandoverOn('');
      return;
    }
    setRentMajor(majorFromMinor(selectedUnit.rentMinor, selectedUnit.currency || 'OMR'));
    setDepositMajor(majorFromMinor(selectedUnit.depositMinor, selectedUnit.currency || 'OMR'));
    const today = muscatTodayIso();
    setLeaseStartsOn(today);
    setHandoverOn(today);
  }, [selectedUnit]);

  const stepNo = STEPS.indexOf(step) + 1;
  const greeting: BookingStepGreeting =
    step === 'unit'
      ? {
          kind: 'review',
          status: ar ? 'حجز جديد' : 'New booking',
          heading: ar ? 'اختر نوع العرض والوحدة' : 'Choose offer type and unit',
          body: ar
            ? 'اختر تأجير أو بيع أولاً، ثم ابحث عن العقار واختر وحدة شاغرة متاحة لهذا النوع.'
            : 'Pick rent or sale first, then search and choose a vacant unit for that offer.',
        }
      : step === 'party'
        ? {
            kind: 'details',
            status: ar ? 'بيانات المستأجر' : 'Tenant details',
            heading: ar
              ? 'أدخل بيانات المحجوز له ومدة التأجير'
              : 'Enter the guest details and lease term',
            body: ar
              ? 'بعد الإرسال يُضاف تلقائياً إلى دفتر العناوين.'
              : 'After send they are added to the address book automatically.',
          }
        : step === 'contract'
          ? {
              kind: 'terms',
              status: ar ? 'طريقة العقد' : 'Contract method',
              heading: ar ? 'إلكتروني أم يدوي؟' : 'Electronic or manual?',
              body: ar
                ? 'بعد دفع المستأجر ورفع المستندات يُنشأ العقد تلقائياً أو تنتظر إدخالها يدوياً.'
                : 'After the tenant pays and uploads docs, auto-issue or enter the contract yourself.',
            }
          : {
              kind: 'payment',
              status: ar ? 'إرسال الدعوة' : 'Send invite',
              heading: ar ? 'راجع وأرسل للمستأجر' : 'Review and send to the tenant',
              body: ar
                ? 'سيصله رابط بالبريد وواتساب، ويُحفظ في دفتر العناوين.'
                : 'They get email and WhatsApp links, and are saved to the address book.',
            };

  function partyStepError(): string | null {
    const built = buildReservationParty(partyForm, {
      holder: 'other',
      mode,
      minMonths: OWNER_INVITE_MIN_LEASE_MONTHS,
      ar,
      deferTenantCompletion: true,
    });
    if ('error' in built) return built.error;
    const party = built.party;
    const fullName = partyDisplayName(party);
    const phone =
      party.entityType === 'company' ? party.company?.phone ?? '' : party.person?.phone ?? '';
    const email =
      party.entityType === 'company' ? party.company?.email ?? '' : party.person?.email ?? '';
    if (!fullName || !phone || !email) {
      return ar
        ? 'أكمل اسم المستأجر والجوال والبريد.'
        : 'Complete the tenant name, phone, and email.';
    }
    return null;
  }

  function commercialStepError(): string | null {
    if (!selectedUnit) return ar ? 'اختر وحدة أولاً.' : 'Choose a unit first.';
    try {
      if (mode === 'rent') {
        const rent = toMinorUnits(rentMajor.trim() || '0', unitCurrency);
        if (!/^[1-9]\d*$/.test(rent)) {
          return ar ? 'أدخل مبلغ الإيجار الشهري.' : 'Enter the monthly rent.';
        }
      }
      const deposit = toMinorUnits(depositMajor.trim() || '0', unitCurrency);
      if (!/^[1-9]\d*$/.test(deposit)) {
        return ar ? 'أدخل مبلغ الضمان.' : 'Enter the deposit amount.';
      }
    } catch {
      return ar ? 'أدخل مبالغ صحيحة.' : 'Enter valid amounts.';
    }
    if (mode === 'rent') {
      if (!leaseStartsOn) {
        return ar ? 'أدخل تاريخ بداية العقد.' : 'Enter the lease start date.';
      }
      if (!handoverOn) {
        return ar ? 'أدخل تاريخ الاستلام.' : 'Enter the handover date.';
      }
      if (handoverOn > leaseStartsOn) {
        return ar
          ? 'تاريخ الاستلام يجب ألا يكون بعد بداية العقد.'
          : 'Handover date must not be after the lease start date.';
      }
    }
    return null;
  }

  function validateStep(current: Step): string | null {
    if (current === 'unit') {
      if (!mode) return ar ? 'اختر نوع العرض.' : 'Choose the offer type.';
      if (!unitId) {
        return ar
          ? 'اختر وحدة شاغرة متاحة لهذا النوع.'
          : 'Choose a vacant unit available for this offer.';
      }
      if (!modeUnits.some((unit) => unit.id === unitId)) {
        return ar
          ? 'الوحدة المختارة غير متاحة لهذا النوع.'
          : 'The selected unit is not available for this offer.';
      }
      return commercialStepError();
    }
    if (current === 'party') return partyStepError();
    if (current === 'contract') {
      if (contractPreference !== 'electronic' && contractPreference !== 'manual') {
        return ar ? 'اختر طريقة العقد.' : 'Choose the contract method.';
      }
      return null;
    }
    return null;
  }

  function goNext() {
    setError(null);
    const problem = validateStep(step);
    if (problem) {
      setError(problem);
      return;
    }
    setStep(step === 'unit' ? 'party' : step === 'party' ? 'contract' : 'review');
  }

  function applyDirectoryTenant(id: string) {
    setDirectoryId(id);
    const hit = tenants.find((row) => row.id === id);
    if (!hit) return;
    const name = hit.displayName || hit.name || hit.nameAr || hit.nameEn || '';
    setPartyForm((prev) => ({
      ...prev,
      entityType: hit.type === 'company' ? 'company' : 'person',
      person: {
        ...prev.person,
        nameAr: name,
        nameEn: name,
        phone: toInternationalPhone(hit.phone ?? ''),
        email: hit.email ?? '',
      },
      company: {
        ...prev.company,
        nameAr: name,
        nameEn: name,
        phone: toInternationalPhone(hit.phone ?? ''),
        email: hit.email ?? '',
      },
    }));
  }

  async function submitInvite() {
    setError(null);
    for (const gate of STEPS) {
      if (gate === 'review') continue;
      const problem = validateStep(gate);
      if (problem) {
        setError(problem);
        setStep(gate);
        return;
      }
    }

    const built = buildReservationParty(partyForm, {
      holder: 'other',
      mode,
      minMonths: OWNER_INVITE_MIN_LEASE_MONTHS,
      ar,
      deferTenantCompletion: true,
    });
    if ('error' in built) {
      setError(built.error);
      setStep('party');
      return;
    }
    const party = built.party;
    const fullName = partyDisplayName(party);
    const phone =
      party.entityType === 'company' ? party.company?.phone ?? '' : party.person?.phone ?? '';
    const email =
      party.entityType === 'company' ? party.company?.email ?? '' : party.person?.email ?? '';

    let rentMinor: string | null = null;
    let depositMinor: string;
    try {
      if (mode === 'rent') {
        rentMinor = toMinorUnits(rentMajor.trim() || '0', unitCurrency);
      }
      depositMinor = toMinorUnits(depositMajor.trim() || '0', unitCurrency);
    } catch {
      setError(ar ? 'أدخل مبالغ صحيحة.' : 'Enter valid amounts.');
      setStep('unit');
      return;
    }

    setBusy(true);
    try {
      const csrf = await fetchBrowserCsrfToken(true);
      const response = await fetch('/api/owner/bookings/invite', {
        method: 'POST',
        credentials: 'same-origin',
        headers: {
          accept: 'application/json',
          'content-type': 'application/json',
          'x-csrf-token': csrf,
        },
        body: JSON.stringify({
          unitId,
          mode,
          locale,
          fullName,
          phone,
          email,
          contractPreference,
          party,
          ...(rentMinor ? { rentMinor } : {}),
          depositMinor,
          ...(mode === 'rent'
            ? {
                leaseStartsOn: leaseStartsOn || null,
                handoverOn: handoverOn || null,
              }
            : {}),
        }),
        signal: AbortSignal.timeout(45_000),
      });
      const payload = (await response.json().catch(() => null)) as
        | {
            reservationId?: string;
            ownerPath?: string;
            error?: { code?: string; message?: string; messageAr?: string };
          }
        | null;
      if (!response.ok || !payload?.reservationId) {
        throw new ApiError(
          response.status,
          payload?.error?.code ?? 'invite_failed',
          payload?.error?.messageAr ?? payload?.error?.message ?? 'invite_failed',
        );
      }
      onDone();
      router.push(
        payload.ownerPath ?? `/${locale}/${portal}/bookings/${payload.reservationId}`,
      );
    } catch (err) {
      setError(humanizeBrowserError(err, ar));
    } finally {
      setBusy(false);
    }
  }

  const canAdvance =
    step === 'unit'
      ? Boolean(unitId && modeUnits.some((unit) => unit.id === unitId) && !commercialStepError())
      : step === 'party'
        ? partyStepError() === null
        : step === 'contract'
          ? Boolean(contractPreference)
          : true;

  return (
    <div className="owner-booking-invite">
      <BookingStepScene
        ar={ar}
        greeting={greeting}
        label={ar ? 'حجز من المالك' : 'Owner booking'}
        stepNo={stepNo}
        stepCount={STEPS.length}
      />

      {step === 'unit' ? (
        <div className="form-grid">
          <fieldset className="field span-2">
            <legend>{ar ? 'نوع العرض' : 'Offer type'}</legend>
            <div className="purpose-tabs" role="radiogroup">
              <button
                type="button"
                className={mode === 'rent' ? 'purpose-tabs__item is-active' : 'purpose-tabs__item'}
                onClick={() => {
                  setMode('rent');
                  setError(null);
                }}
              >
                {ar ? 'تأجير طويل' : 'Long-term rent'}
              </button>
              <button
                type="button"
                className={mode === 'sale' ? 'purpose-tabs__item is-active' : 'purpose-tabs__item'}
                onClick={() => {
                  setMode('sale');
                  setError(null);
                }}
              >
                {ar ? 'بيع' : 'Sale'}
              </button>
            </div>
          </fieldset>

          <label className="field span-2">
            <span>
              {ar
                ? 'بحث (المالك / اسم العقار / رقم العقار)'
                : 'Search (owner / property name / property no.)'}
            </span>
            <input
              className="input"
              type="search"
              value={unitQuery}
              onChange={(event) => setUnitQuery(event.target.value)}
              placeholder={
                ar
                  ? 'اكتب اسم المالك أو العقار أو الرقم…'
                  : 'Type owner, property name, or number…'
              }
              autoComplete="off"
            />
          </label>

          <label className="field span-2">
            <span>
              {mode === 'sale'
                ? ar
                  ? 'الوحدة الشاغرة للبيع'
                  : 'Vacant unit for sale'
                : ar
                  ? 'الوحدة الشاغرة للتأجير'
                  : 'Vacant unit for rent'}
            </span>
            <select
              className="select"
              value={unitId}
              onChange={(event) => {
                setUnitId(event.target.value);
                setError(null);
              }}
              required
            >
              <option value="">{ar ? 'اختر وحدة…' : 'Choose a unit…'}</option>
              {filteredUnits.map((unit) => (
                <option key={unit.id} value={unit.id}>
                  {unitOptionLabel(unit, ar)}
                </option>
              ))}
            </select>
          </label>
          {!modeUnits.length ? (
            <p className="ops-hint span-2">
              {mode === 'sale'
                ? ar
                  ? 'لا توجد وحدات شاغرة متاحة للبيع حالياً.'
                  : 'No vacant units available for sale right now.'
                : ar
                  ? 'لا توجد وحدات شاغرة متاحة للتأجير حالياً.'
                  : 'No vacant units available for rent right now.'}
            </p>
          ) : filteredUnits.length === 0 ? (
            <p className="ops-hint span-2">
              {ar ? 'لا نتائج مطابقة لبحثك.' : 'No units match your search.'}
            </p>
          ) : null}

          {selectedUnit ? (
            <>
              {mode === 'rent' ? (
                <label className="field">
                  <span>{ar ? 'الإيجار الشهري' : 'Monthly rent'}</span>
                  <input
                    className="input"
                    inputMode="decimal"
                    dir="ltr"
                    value={rentMajor}
                    onChange={(event) => setRentMajor(event.target.value)}
                    required
                  />
                  <small className="ops-hint">
                    {ar
                      ? 'يُجلب من بيانات الوحدة ويمكن تعديله — يُستخدم في العقد.'
                      : 'Prefills from the unit and can be edited — used for the contract.'}
                  </small>
                </label>
              ) : null}
              <label className="field">
                <span>{ar ? 'مبلغ الضمان / العربون' : 'Deposit / booking fee'}</span>
                <input
                  className="input"
                  inputMode="decimal"
                  dir="ltr"
                  value={depositMajor}
                  onChange={(event) => setDepositMajor(event.target.value)}
                  required
                />
              </label>
              {mode === 'rent' ? (
                <>
                  <label className="field">
                    <span>{ar ? 'تاريخ بداية العقد' : 'Lease start date'}</span>
                    <input
                      className="input"
                      type="date"
                      dir="ltr"
                      value={leaseStartsOn}
                      onChange={(event) => setLeaseStartsOn(event.target.value)}
                      required
                    />
                  </label>
                  <label className="field">
                    <span>{ar ? 'تاريخ الاستلام' : 'Handover date'}</span>
                    <input
                      className="input"
                      type="date"
                      dir="ltr"
                      value={handoverOn}
                      onChange={(event) => setHandoverOn(event.target.value)}
                      required
                    />
                  </label>
                </>
              ) : null}
              <p className="ops-hint span-2">
                {ar
                  ? 'صلاحية الدعوة اليدوية 24 ساعة؛ إن لم يُكمل المستأجر تُلغى تلقائياً مع بقاء السجل لإعادة الإرسال.'
                  : 'Manual invites are valid for 24 hours; if unfinished they auto-cancel but stay for one-click resend.'}
              </p>
            </>
          ) : null}
        </div>
      ) : null}

      {step === 'party' ? (
        <div className="form-grid">
          {tenants.length ? (
            <label className="field span-2">
              <span>{ar ? 'من سجل العناوين (اختياري)' : 'From address book (optional)'}</span>
              <select
                className="select"
                value={directoryId}
                onChange={(event) => applyDirectoryTenant(event.target.value)}
              >
                <option value="">{ar ? 'إدخال يدوي…' : 'Enter manually…'}</option>
                {tenants.map((row) => (
                  <option key={row.id} value={row.id}>
                    {row.displayName || row.name || row.nameAr || row.id.slice(0, 8)}
                  </option>
                ))}
              </select>
            </label>
          ) : null}
          <div className="span-2">
            <ReservationPartyForm
              locale={locale}
              mode={mode}
              minMonths={OWNER_INVITE_MIN_LEASE_MONTHS}
              value={partyForm}
              onChange={setPartyForm}
              holder="other"
              autoAdvance={false}
              deferTenantCompletion
            />
          </div>
          <p className="ops-hint span-2">
            {ar
              ? 'بعد إرسال الدعوة يُحفظ المحجوز له في دفتر العناوين تلقائياً.'
              : 'After the invite is sent, the guest is saved to the address book automatically.'}
          </p>
        </div>
      ) : null}

      {step === 'contract' ? (
        <div className="form-grid">
          <label className="field span-2 owner-booking-invite__choice">
            <input
              type="radio"
              name="contractPreference"
              checked={contractPreference === 'electronic'}
              onChange={() => setContractPreference('electronic')}
            />
            <span>
              <strong>{ar ? 'عقد إلكتروني' : 'Electronic contract'}</strong>
              <small>
                {ar
                  ? 'بعد اكتمال الدفع والمستندات يُجهَّز العقد تلقائياً من بيانات الحجز.'
                  : 'After payment and documents, the contract is prepared automatically from the booking.'}
              </small>
            </span>
          </label>
          <label className="field span-2 owner-booking-invite__choice">
            <input
              type="radio"
              name="contractPreference"
              checked={contractPreference === 'manual'}
              onChange={() => setContractPreference('manual')}
            />
            <span>
              <strong>{ar ? 'عقد يدوي' : 'Manual contract'}</strong>
              <small>
                {ar
                  ? 'بعد دفع المستأجر تدخل بيانات العقد يدوياً ثم ترسلها له للاعتماد.'
                  : 'After the tenant pays, you enter the contract yourself and send it for approval.'}
              </small>
            </span>
          </label>
        </div>
      ) : null}

      {step === 'review' ? (
        <div className="owner-booking-invite__review">
          <dl>
            <div>
              <dt>{ar ? 'الوحدة' : 'Unit'}</dt>
              <dd>{unitLabel || '—'}</dd>
            </div>
            <div>
              <dt>{ar ? 'النوع' : 'Type'}</dt>
              <dd>
                {mode === 'sale' ? (ar ? 'بيع' : 'Sale') : ar ? 'تأجير طويل' : 'Long-term rent'}
              </dd>
            </div>
            <div>
              <dt>{ar ? 'المحجوز له' : 'Guest'}</dt>
              <dd>
                {partyForm.entityType === 'company'
                  ? partyForm.company.nameAr || partyForm.company.nameEn || '—'
                  : partyForm.person.nameAr || partyForm.person.nameEn || '—'}
              </dd>
            </div>
            <div>
              <dt>{ar ? 'التواصل' : 'Contact'}</dt>
              <dd dir="ltr">
                {(partyForm.entityType === 'company'
                  ? partyForm.company.phone
                  : partyForm.person.phone) || '—'}
                {' · '}
                {(partyForm.entityType === 'company'
                  ? partyForm.company.email
                  : partyForm.person.email) || '—'}
              </dd>
            </div>
            {mode === 'rent' ? (
              <div>
                <dt>{ar ? 'المدة' : 'Term'}</dt>
                <dd>
                  {partyForm.termMonths || OWNER_INVITE_MIN_LEASE_MONTHS}{' '}
                  {ar ? 'شهراً' : 'months'}
                </dd>
              </div>
            ) : null}
            {mode === 'rent' ? (
              <div>
                <dt>{ar ? 'الإيجار' : 'Rent'}</dt>
                <dd dir="ltr">
                  {rentMajor || '—'} {unitCurrency}
                </dd>
              </div>
            ) : null}
            <div>
              <dt>{ar ? 'الضمان' : 'Deposit'}</dt>
              <dd dir="ltr">
                {depositMajor || '—'} {unitCurrency}
              </dd>
            </div>
            {mode === 'rent' ? (
              <>
                <div>
                  <dt>{ar ? 'بداية العقد' : 'Lease start'}</dt>
                  <dd dir="ltr">{leaseStartsOn || '—'}</dd>
                </div>
                <div>
                  <dt>{ar ? 'الاستلام' : 'Handover'}</dt>
                  <dd dir="ltr">{handoverOn || '—'}</dd>
                </div>
              </>
            ) : null}
            <div>
              <dt>{ar ? 'العقد' : 'Contract'}</dt>
              <dd>
                {contractPreference === 'electronic'
                  ? ar
                    ? 'إلكتروني'
                    : 'Electronic'
                  : ar
                    ? 'يدوي'
                    : 'Manual'}
              </dd>
            </div>
          </dl>
          <p className="ops-hint">
            {ar
              ? 'بعد الإرسال تُحجز الوحدة، يُضاف المستأجر لدفتر العناوين، ويصله رابط لإكمال الدفع والمستندات.'
              : 'After send, the unit is held, the guest is added to the address book, and they receive a link to pay and upload documents.'}
          </p>
        </div>
      ) : null}

      {error ? (
        <div className="notice notice--error" role="alert">
          {error}
        </div>
      ) : null}

      <div className="form-actions">
        <button className="button button--quiet" type="button" onClick={onCancel} disabled={busy}>
          {ar ? 'إلغاء' : 'Cancel'}
        </button>
        {step !== 'unit' ? (
          <button
            className="button button--quiet"
            type="button"
            disabled={busy}
            onClick={() => {
              setError(null);
              setStep(step === 'party' ? 'unit' : step === 'contract' ? 'party' : 'contract');
            }}
          >
            {ar ? 'رجوع' : 'Back'}
          </button>
        ) : null}
        {step !== 'review' ? (
          <button
            className="button button--primary"
            type="button"
            disabled={busy || !canAdvance}
            onClick={goNext}
          >
            {ar ? 'التالي' : 'Next'}
          </button>
        ) : (
          <button
            className="button button--primary"
            type="button"
            disabled={busy}
            onClick={() => void submitInvite()}
          >
            {busy
              ? ar
                ? 'جارٍ الإرسال…'
                : 'Sending…'
              : ar
                ? 'إرسال الدعوة للمستأجر'
                : 'Send invite to tenant'}
          </button>
        )}
      </div>
    </div>
  );
}
