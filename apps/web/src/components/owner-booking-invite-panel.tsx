'use client';

import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  ReservationPartyForm,
  buildReservationParty,
  emptyPartyForm,
  type PartyForm,
} from '@/components/reservation-party-form';
import { BookingStepScene } from '@/components/stays/booking-step-scene';
import { ApiError, fetchBrowserCsrfToken, humanizeBrowserError } from '@/lib/api';
import type { BookingStepGreeting } from '@/lib/booking-step-greeting';
import { DEFAULT_MIN_LEASE_MONTHS, partyDisplayName } from '@/lib/reservation-party';
import { toInternationalPhone } from '@/lib/world-countries';

type UnitOption = {
  id: string;
  propertyId?: string;
  code?: string;
  name?: string;
  nameAr?: string;
  nameEn?: string;
  currency?: string;
};

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
  const [unitId, setUnitId] = useState(vacantUnits[0]?.id ?? '');
  const [mode, setMode] = useState<Mode>(initialMode);
  const [partyForm, setPartyForm] = useState<PartyForm>(() =>
    emptyPartyForm(DEFAULT_MIN_LEASE_MONTHS),
  );
  const [directoryId, setDirectoryId] = useState('');
  const [contractPreference, setContractPreference] =
    useState<ContractPreference>('electronic');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const selectedUnit = useMemo(
    () => vacantUnits.find((row) => row.id === unitId) ?? null,
    [vacantUnits, unitId],
  );
  const unitLabel = selectedUnit
    ? selectedUnit.name ||
      selectedUnit.nameAr ||
      selectedUnit.code ||
      selectedUnit.id.slice(0, 8)
    : '';

  const stepNo = STEPS.indexOf(step) + 1;
  const greeting: BookingStepGreeting =
    step === 'unit'
      ? {
          kind: 'review',
          status: ar ? 'حجز جديد' : 'New booking',
          heading: ar ? 'اختر الوحدة ونوع العرض' : 'Choose the unit and offer type',
          body: ar
            ? 'نفس مسار حجز الموقع — أنت تُدخل بيانات المستأجر ثم نرسل له الرابط.'
            : 'Same public booking journey — you enter the tenant, then we send them the link.',
        }
      : step === 'party'
        ? {
            kind: 'details',
            status: ar ? 'بيانات المستأجر' : 'Tenant details',
            heading: ar ? 'أدخل بيانات المستأجر ومدة التأجير' : 'Enter tenant and lease term',
            body: ar
              ? 'تظهر هذه البيانات لاحقاً في العقد والإشعارات.'
              : 'These details carry into the contract and notices.',
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
                ? 'سيصله رابط بالبريد وواتساب لإكمال الشروط والدفع والمستندات.'
                : 'They get an email and WhatsApp link to finish terms, payment, and documents.',
            };

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
    if (!unitId) {
      setError(ar ? 'اختر الوحدة.' : 'Choose a unit.');
      setStep('unit');
      return;
    }
    const built = buildReservationParty(partyForm, {
      holder: 'other',
      mode,
      minMonths: DEFAULT_MIN_LEASE_MONTHS,
      ar,
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
    if (!fullName || !phone || !email) {
      setError(
        ar
          ? 'أكمل اسم المستأجر والجوال والبريد.'
          : 'Complete the tenant name, phone, and email.',
      );
      setStep('party');
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
          <label className="field span-2">
            <span>{ar ? 'الوحدة الشاغرة' : 'Vacant unit'}</span>
            <select
              className="select"
              value={unitId}
              onChange={(event) => setUnitId(event.target.value)}
              required
            >
              <option value="">{ar ? 'اختر وحدة…' : 'Choose a unit…'}</option>
              {vacantUnits.map((unit) => (
                <option key={unit.id} value={unit.id}>
                  {unit.name || unit.nameAr || unit.code || unit.id.slice(0, 8)}
                </option>
              ))}
            </select>
          </label>
          {!vacantUnits.length ? (
            <p className="ops-hint span-2">
              {ar ? 'لا توجد وحدات شاغرة حالياً.' : 'No vacant units right now.'}
            </p>
          ) : null}
          <fieldset className="field span-2">
            <legend>{ar ? 'نوع العرض' : 'Offer type'}</legend>
            <div className="purpose-tabs" role="radiogroup">
              <button
                type="button"
                className={mode === 'rent' ? 'purpose-tabs__item is-active' : 'purpose-tabs__item'}
                onClick={() => setMode('rent')}
              >
                {ar ? 'تأجير طويل' : 'Long-term rent'}
              </button>
              <button
                type="button"
                className={mode === 'sale' ? 'purpose-tabs__item is-active' : 'purpose-tabs__item'}
                onClick={() => setMode('sale')}
              >
                {ar ? 'بيع' : 'Sale'}
              </button>
            </div>
          </fieldset>
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
              minMonths={DEFAULT_MIN_LEASE_MONTHS}
              value={partyForm}
              onChange={setPartyForm}
              holder="other"
            />
          </div>
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
              <dt>{ar ? 'المستأجر' : 'Tenant'}</dt>
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
                  {partyForm.termMonths || DEFAULT_MIN_LEASE_MONTHS} {ar ? 'شهراً' : 'months'}
                </dd>
              </div>
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
              ? 'بعد الإرسال يُحجز العقار للمستأجر ويصله رابط لإكمال الدفع والمستندات.'
              : 'After send, the unit is held for the tenant and they receive a link to pay and upload documents.'}
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
            onClick={() =>
              setStep(step === 'party' ? 'unit' : step === 'contract' ? 'party' : 'contract')
            }
          >
            {ar ? 'رجوع' : 'Back'}
          </button>
        ) : null}
        {step !== 'review' ? (
          <button
            className="button button--primary"
            type="button"
            disabled={busy || (step === 'unit' && !unitId)}
            onClick={() =>
              setStep(step === 'unit' ? 'party' : step === 'party' ? 'contract' : 'review')
            }
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
