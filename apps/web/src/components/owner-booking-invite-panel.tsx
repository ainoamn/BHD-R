'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { currencyMinorUnits, type CurrencyCode } from '@bhd-r/contracts';
import {
  ReservationPartyForm,
  buildReservationParty,
  emptyPartyForm,
  type PartyForm,
} from '@/components/reservation-party-form';
import { BookingStepScene } from '@/components/stays/booking-step-scene';
import { ApiError, humanizeBrowserError } from '@/lib/api';
import type { BookingStepGreeting } from '@/lib/booking-step-greeting';
import { toMinorUnits } from '@/lib/format';
import { fromMinor } from '@/lib/legal-case-shared';
import { contractPeriod, endDateForMonths, isIsoDate } from '@/lib/lease-terms';
import { MAX_LEASE_MONTHS, partyDisplayName } from '@/lib/reservation-party';
import { toInternationalPhone } from '@/lib/world-countries';

/** Owner invite may set any whole-month term from 1 upward (property minimum is for public booking). */
const OWNER_INVITE_MIN_LEASE_MONTHS = 1;

function clampTermMonths(raw: number): number {
  if (!Number.isFinite(raw)) return OWNER_INVITE_MIN_LEASE_MONTHS;
  return Math.min(MAX_LEASE_MONTHS, Math.max(OWNER_INVITE_MIN_LEASE_MONTHS, Math.trunc(raw)));
}

function termMonthsFromDates(startsOn: string, endsOn: string): number {
  if (!isIsoDate(startsOn) || !isIsoDate(endsOn) || endsOn < startsOn) {
    return OWNER_INVITE_MIN_LEASE_MONTHS;
  }
  const { months, extraDays } = contractPeriod(startsOn, endsOn);
  return clampTermMonths(extraDays > 0 ? months + 1 : Math.max(months, 1));
}

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

function positiveMajor(raw: string, currency: CurrencyCode): boolean {
  try {
    const minor = toMinorUnits(raw.trim() || '0', currency);
    return /^[1-9]\d*$/.test(minor);
  } catch {
    return false;
  }
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
type ContractPreference = 'electronic' | 'manual';

/** Progressive reveal stages on one page (no Next wizard). */
type Stage =
  | 'unit'
  | 'rent'
  | 'deposit'
  | 'leaseStart'
  | 'handover'
  | 'term'
  | 'party'
  | 'contract'
  | 'review';

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
  const code = unit.code?.trim() || '';
  const unitName = (unit.nameAr || unit.nameEn || unit.name || '').trim();
  const property =
    (ar ? unit.propertyNameAr || unit.propertyNameEn : unit.propertyNameEn || unit.propertyNameAr) ||
    '';
  const serial = unit.propertySerial?.trim() || '';
  const owner = unit.ownerName?.trim() || '';
  // Prefer code + property; skip unit name when it repeats the property title.
  const title =
    unitName && property && unitName !== property
      ? `${code || unitName} · ${unitName} · ${property}`
      : code && property
        ? `${code} · ${property}`
        : code || unitName || property || unit.id.slice(0, 8);
  const bits = [title];
  if (serial) bits.push(serial);
  if (owner) bits.push(owner);
  return bits.join(' · ');
}

function unitReviewParts(unit: UnitOption | null, ar: boolean) {
  if (!unit) return { title: '—', meta: '' };
  const code = unit.code?.trim() || '';
  const property =
    (ar ? unit.propertyNameAr || unit.propertyNameEn : unit.propertyNameEn || unit.propertyNameAr) ||
    '';
  const unitName = (ar ? unit.nameAr || unit.nameEn : unit.nameEn || unit.nameAr || unit.name) || '';
  const title =
    code && property
      ? `${code} · ${property}`
      : code || property || unitName || unit.id.slice(0, 8);
  const meta = [unit.propertySerial?.trim(), unit.ownerName?.trim()].filter(Boolean).join(' · ');
  return { title, meta };
}

/**
 * Landlord-facing booking create — progressive single page: each completed field
 * reveals the next below it (no Next-step navigation).
 */
export function OwnerBookingInvitePanel({
  portal,
  locale,
  vacantUnits: vacantUnitsProp,
  tenants: tenantsProp,
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
  const [vacantUnits, setVacantUnits] = useState<UnitOption[]>(vacantUnitsProp);
  const [tenants, setTenants] = useState<TenantOption[]>(tenantsProp);
  const [unitsLoading, setUnitsLoading] = useState(vacantUnitsProp.length === 0);
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
  const [contactSavedHint, setContactSavedHint] = useState(false);
  /** Furthest stage unlocked; earlier stages stay visible above. */
  const [stage, setStage] = useState<Stage>('unit');
  const revealNode = useRef<HTMLElement | null>(null);
  const contactFingerprintRef = useRef('');
  const bindReveal =
    (active: boolean) =>
    (el: HTMLElement | null): void => {
      if (active) revealNode.current = el;
    };

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
    setVacantUnits(vacantUnitsProp);
    setTenants(tenantsProp);
  }, [vacantUnitsProp, tenantsProp]);

  // SSR context for bookings often times out empty — reload vacant units for this tab's account.
  useEffect(() => {
    let live = true;
    setUnitsLoading(vacantUnitsProp.length === 0);
    void (async () => {
      try {
        const { claimProductSessionForActiveAu } = await import('@/lib/identity/client');
        await claimProductSessionForActiveAu().catch(() => ({ ok: false }));
        const { tabBoundAuthHeaders } = await import('@/lib/identity/window-session');
        const response = await fetch('/api/owner/vacant-units', {
          credentials: 'same-origin',
          cache: 'no-store',
          headers: tabBoundAuthHeaders({ accept: 'application/json' }),
          signal: AbortSignal.timeout(20_000),
        });
        if (!response.ok) return;
        const body = (await response.json().catch(() => null)) as {
          vacantUnits?: UnitOption[];
          tenants?: TenantOption[];
        } | null;
        if (!live || !body) return;
        if (Array.isArray(body.vacantUnits) && body.vacantUnits.length) {
          setVacantUnits(body.vacantUnits);
        }
        if (Array.isArray(body.tenants) && body.tenants.length) {
          setTenants(body.tenants);
        }
      } catch {
        /* keep SSR list */
      } finally {
        if (live) setUnitsLoading(false);
      }
    })();
    return () => {
      live = false;
    };
  }, [vacantUnitsProp.length]);

  useEffect(() => {
    if (unitId && !modeUnits.some((unit) => unit.id === unitId)) {
      setUnitId('');
      setStage('unit');
    }
  }, [modeUnits, unitId]);

  const selectedUnit = useMemo(
    () => vacantUnits.find((row) => row.id === unitId) ?? null,
    [vacantUnits, unitId],
  );
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

  useEffect(() => {
    revealNode.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }, [stage]);

  function unlock(next: Stage) {
    setStage((current) => {
      const order: Stage[] = [
        'unit',
        'rent',
        'deposit',
        'leaseStart',
        'handover',
        'term',
        'party',
        'contract',
        'review',
      ];
      return order.indexOf(next) > order.indexOf(current) ? next : current;
    });
  }

  const termMonthsValue = clampTermMonths(Number(partyForm.termMonths));
  const leaseEndsOn =
    mode === 'rent' && isIsoDate(leaseStartsOn)
      ? endDateForMonths(leaseStartsOn, termMonthsValue)
      : '';

  function setTermMonths(raw: string) {
    const next = clampTermMonths(Number(raw));
    setPartyForm((prev) => ({ ...prev, termMonths: String(next) }));
  }

  function setLeaseEndsOn(nextEndsOn: string) {
    if (!isIsoDate(leaseStartsOn) || !isIsoDate(nextEndsOn)) return;
    const months = termMonthsFromDates(leaseStartsOn, nextEndsOn);
    setPartyForm((prev) => ({ ...prev, termMonths: String(months) }));
  }

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
      if (termMonthsValue < OWNER_INVITE_MIN_LEASE_MONTHS) {
        return ar ? 'أدخل مدة العقد بالأشهر.' : 'Enter the contract term in months.';
      }
      if (!leaseEndsOn || leaseEndsOn < leaseStartsOn) {
        return ar ? 'أدخل تاريخ انتهاء عقد صالح.' : 'Enter a valid lease end date.';
      }
    }
    return null;
  }

  const rentOk = mode === 'sale' || positiveMajor(rentMajor, unitCurrency);
  const depositOk = positiveMajor(depositMajor, unitCurrency);
  const leaseStartOk = mode === 'sale' || Boolean(leaseStartsOn);
  const handoverOk =
    mode === 'sale' || (Boolean(handoverOn) && (!leaseStartsOn || handoverOn <= leaseStartsOn));
  const termOk =
    mode === 'sale' ||
    (termMonthsValue >= OWNER_INVITE_MIN_LEASE_MONTHS &&
      Boolean(leaseEndsOn) &&
      (!leaseStartsOn || leaseEndsOn >= leaseStartsOn));
  const commercialOk = Boolean(unitId) && !commercialStepError();
  const partyOk = partyStepError() === null;

  const showRent = mode === 'rent' && Boolean(unitId) && stage !== 'unit';
  const showDeposit =
    Boolean(unitId) &&
    (mode === 'sale'
      ? stage !== 'unit'
      : ['deposit', 'leaseStart', 'handover', 'term', 'party', 'contract', 'review'].includes(
          stage,
        ));
  const showLeaseStart =
    mode === 'rent' &&
    ['leaseStart', 'handover', 'term', 'party', 'contract', 'review'].includes(stage);
  const showHandover =
    mode === 'rent' && ['handover', 'term', 'party', 'contract', 'review'].includes(stage);
  const showTerm =
    mode === 'rent' && ['term', 'party', 'contract', 'review'].includes(stage);
  const showParty = ['party', 'contract', 'review'].includes(stage);
  const showContract = ['contract', 'review'].includes(stage);
  const showReview = stage === 'review';

  // When party becomes complete, open contract; when contract chosen, open review.
  useEffect(() => {
    if (!showParty) return;
    if (partyOk) unlock('contract');
  }, [showParty, partyOk]);

  useEffect(() => {
    if (!showContract) return;
    if (contractPreference) unlock('review');
  }, [showContract, contractPreference]);

  // Persist invitee to the address book as soon as details are complete (keep for next booking).
  useEffect(() => {
    if (!showParty || !partyOk) {
      setContactSavedHint(false);
      return;
    }
    const built = buildReservationParty(partyForm, {
      holder: 'other',
      mode,
      minMonths: OWNER_INVITE_MIN_LEASE_MONTHS,
      ar,
      deferTenantCompletion: true,
    });
    if ('error' in built) return;
    const party = built.party;
    const fingerprint = JSON.stringify({
      mode,
      entityType: party.entityType,
      person: party.person,
      company: party.company,
    });
    if (fingerprint === contactFingerprintRef.current) {
      setContactSavedHint(true);
      return;
    }

    let cancelled = false;
    const timer = window.setTimeout(() => {
      void (async () => {
        try {
          const { browserNextMutation } = await import('@/lib/api');
          const result = await browserNextMutation<{
            ok?: boolean;
            contact?: {
              partyId: string;
              displayName: string;
              email: string | null;
              phone: string | null;
              type: string;
            };
          }>('/api/owner/bookings/invite-contact', {
            method: 'POST',
            body: JSON.stringify({ mode, party }),
          });
          if (cancelled || !result?.contact?.partyId) return;
          contactFingerprintRef.current = fingerprint;
          const saved = result.contact;
          setTenants((prev) => {
            const next = prev.filter((row) => row.id !== saved.partyId);
            next.unshift({
              id: saved.partyId,
              displayName: saved.displayName,
              name: saved.displayName,
              email: saved.email,
              phone: saved.phone,
              type: saved.type,
            });
            return next;
          });
          setDirectoryId(saved.partyId);
          setContactSavedHint(true);
        } catch {
          /* Invite send still upserts; keep the form usable offline of this save. */
        }
      })();
    }, 700);

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [showParty, partyOk, partyForm, mode, ar]);

  const greeting: BookingStepGreeting = showReview
    ? {
        kind: 'payment',
        status: ar ? 'إرسال الدعوة' : 'Send invite',
        heading: ar ? 'راجع وأرسل للمستأجر' : 'Review and send to the tenant',
        body: ar
          ? 'سيصله رابط بالبريد وواتساب — وبياناته محفوظة في سجل العناوين.'
          : 'They get email and WhatsApp links — and stay in your address book.',
      }
    : showContract
      ? {
          kind: 'terms',
          status: ar ? 'طريقة العقد' : 'Contract method',
          heading: ar ? 'إلكتروني أم يدوي؟' : 'Electronic or manual?',
          body: ar
            ? 'بعد دفع المستأجر ورفع المستندات يُنشأ العقد تلقائياً أو تنتظر إدخالها يدوياً.'
            : 'After the tenant pays and uploads docs, auto-issue or enter the contract yourself.',
        }
      : showParty
        ? {
            kind: 'details',
            status: ar ? 'بيانات المستأجر' : 'Tenant details',
            heading: ar ? 'أدخل بيانات المحجوز له' : 'Enter the guest details',
            body: ar
              ? 'عند اكتمال البيانات يُحفظ المستأجر تلقائياً في سجل العناوين.'
              : 'When the details are complete, the tenant is saved to the address book automatically.',
          }
        : {
            kind: 'review',
            status: ar ? 'حجز جديد' : 'New booking',
            heading: ar ? 'أكمل الحقول واحداً تلو الآخر' : 'Complete each field in turn',
            body: ar
              ? 'عند تعبئة حقل يظهر الحقل التالي أسفله في نفس الصفحة.'
              : 'When you fill a field, the next one appears below it on this same page.',
          };

  const stageNo =
    (
      {
        unit: 1,
        rent: 2,
        deposit: 3,
        leaseStart: 4,
        handover: 5,
        term: 6,
        party: 7,
        contract: 8,
        review: 9,
      } as const
    )[stage] ?? 1;

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
    if (!unitId || !modeUnits.some((unit) => unit.id === unitId)) {
      setError(
        ar ? 'اختر وحدة شاغرة متاحة لهذا النوع.' : 'Choose a vacant unit available for this offer.',
      );
      setStage('unit');
      return;
    }
    const commercial = commercialStepError();
    if (commercial) {
      setError(commercial);
      return;
    }
    const partyProblem = partyStepError();
    if (partyProblem) {
      setError(partyProblem);
      setStage('party');
      return;
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
      setStage('party');
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
      return;
    }

    setBusy(true);
    try {
      const { browserNextMutation } = await import('@/lib/api');
      const payload = await browserNextMutation<{
        reservationId?: string;
        ownerPath?: string;
      }>('/api/owner/bookings/invite', {
        method: 'POST',
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
      });
      if (!payload?.reservationId) {
        throw new ApiError(500, 'invite_failed', 'invite_failed');
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

  const canSend = commercialOk && partyOk && Boolean(contractPreference) && showReview;
  const reviewUnit = unitReviewParts(selectedUnit, ar);
  const reviewGuestName =
    partyForm.entityType === 'company'
      ? partyForm.company.nameAr || partyForm.company.nameEn || '—'
      : partyForm.person.nameAr || partyForm.person.nameEn || '—';
  const reviewGuestContact = [
    (partyForm.entityType === 'company' ? partyForm.company.phone : partyForm.person.phone) || '',
    (partyForm.entityType === 'company' ? partyForm.company.email : partyForm.person.email) || '',
  ]
    .filter(Boolean)
    .join(' · ');

  return (
    <div className="owner-booking-invite owner-booking-invite--progressive">
      <BookingStepScene
        ar={ar}
        greeting={greeting}
        label={ar ? 'حجز من المالك' : 'Owner booking'}
        stepNo={stageNo}
        stepCount={mode === 'rent' ? 9 : 6}
      />

      <div className="form-grid">
        <fieldset className="field span-2">
          <legend>{ar ? 'نوع العرض' : 'Offer type'}</legend>
          <div className="purpose-tabs" role="radiogroup">
            <button
              type="button"
              className={mode === 'rent' ? 'purpose-tabs__item is-active' : 'purpose-tabs__item'}
              onClick={() => {
                setMode('rent');
                setUnitId('');
                setStage('unit');
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
                setUnitId('');
                setStage('unit');
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

        <label className="field span-2" ref={bindReveal(stage === 'unit')}>
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
            disabled={unitsLoading && !modeUnits.length}
            onChange={(event) => {
              const next = event.target.value;
              setUnitId(next);
              setError(null);
              if (next) unlock(mode === 'rent' ? 'rent' : 'deposit');
              else setStage('unit');
            }}
            required
          >
            <option value="">
              {unitsLoading && !modeUnits.length
                ? ar
                  ? 'جارٍ التحميل…'
                  : 'Loading…'
                : ar
                  ? 'اختر وحدة…'
                  : 'Choose a unit…'}
            </option>
            {filteredUnits.map((unit) => (
              <option key={unit.id} value={unit.id}>
                {unitOptionLabel(unit, ar)}
              </option>
            ))}
          </select>
        </label>
        {unitsLoading && !modeUnits.length ? (
          <p className="ops-hint span-2" role="status">
            {ar ? 'جارٍ تحميل الوحدات الشاغرة لحسابك…' : 'Loading vacant units for your account…'}
          </p>
        ) : !modeUnits.length ? (
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

        {showRent ? (
          <label
            className="field span-2 owner-booking-invite__reveal"
            ref={bindReveal(stage === 'rent')}
          >
            <span>{ar ? 'الإيجار الشهري' : 'Monthly rent'}</span>
            <input
              className="input"
              inputMode="decimal"
              dir="ltr"
              value={rentMajor}
              onChange={(event) => {
                const next = event.target.value;
                setRentMajor(next);
                setError(null);
                if (positiveMajor(next, unitCurrency)) unlock('deposit');
              }}
              onFocus={() => {
                if (rentOk) unlock('deposit');
              }}
              onBlur={() => {
                if (rentOk) unlock('deposit');
              }}
              required
            />
            <small className="ops-hint">
              {ar
                ? 'يُجلب من بيانات الوحدة ويمكن تعديله — يُستخدم في العقد.'
                : 'Prefills from the unit and can be edited — used for the contract.'}
            </small>
          </label>
        ) : null}

        {showDeposit ? (
          <label
            className="field span-2 owner-booking-invite__reveal"
            ref={bindReveal(stage === 'deposit')}
          >
            <span>{ar ? 'مبلغ الضمان / العربون' : 'Deposit / booking fee'}</span>
            <input
              className="input"
              inputMode="decimal"
              dir="ltr"
              value={depositMajor}
              onChange={(event) => {
                const next = event.target.value;
                setDepositMajor(next);
                setError(null);
                if (positiveMajor(next, unitCurrency)) {
                  unlock(mode === 'rent' ? 'leaseStart' : 'party');
                }
              }}
              onFocus={() => {
                if (!depositOk) return;
                unlock(mode === 'rent' ? 'leaseStart' : 'party');
              }}
              onBlur={() => {
                if (!depositOk) return;
                unlock(mode === 'rent' ? 'leaseStart' : 'party');
              }}
              required
            />
          </label>
        ) : null}

        {showLeaseStart ? (
          <label
            className="field span-2 owner-booking-invite__reveal"
            ref={bindReveal(stage === 'leaseStart')}
          >
            <span>{ar ? 'تاريخ بداية العقد' : 'Lease start date'}</span>
            <input
              className="input"
              type="date"
              dir="ltr"
              value={leaseStartsOn}
              onChange={(event) => {
                const next = event.target.value;
                setLeaseStartsOn(next);
                setError(null);
                if (next) unlock('handover');
              }}
              onFocus={() => {
                if (leaseStartOk) unlock('handover');
              }}
              onBlur={() => {
                if (leaseStartOk) unlock('handover');
              }}
              required
            />
          </label>
        ) : null}

        {showHandover ? (
          <label
            className="field span-2 owner-booking-invite__reveal"
            ref={bindReveal(stage === 'handover')}
          >
            <span>{ar ? 'تاريخ الاستلام' : 'Handover date'}</span>
            <input
              className="input"
              type="date"
              dir="ltr"
              value={handoverOn}
              onChange={(event) => {
                const next = event.target.value;
                setHandoverOn(next);
                setError(null);
                if (next && (!leaseStartsOn || next <= leaseStartsOn)) unlock('term');
              }}
              onFocus={() => {
                if (handoverOk) unlock('term');
              }}
              onBlur={() => {
                if (handoverOk) unlock('term');
              }}
              required
            />
          </label>
        ) : null}

        {showTerm ? (
          <>
            <label
              className="field owner-booking-invite__reveal"
              ref={bindReveal(stage === 'term')}
            >
              <span>{ar ? 'مدة العقد (بالأشهر)' : 'Contract term (months)'}</span>
              <input
                className="input"
                type="number"
                inputMode="numeric"
                list="owner-invite-term-options"
                min={OWNER_INVITE_MIN_LEASE_MONTHS}
                max={MAX_LEASE_MONTHS}
                dir="ltr"
                value={partyForm.termMonths}
                onChange={(event) => {
                  setTermMonths(event.target.value);
                  setError(null);
                  unlock('party');
                }}
                onFocus={() => {
                  if (termOk) unlock('party');
                }}
                onBlur={() => {
                  setTermMonths(partyForm.termMonths || String(OWNER_INVITE_MIN_LEASE_MONTHS));
                  if (termOk) unlock('party');
                }}
                required
              />
              <datalist id="owner-invite-term-options">
                {[1, 3, 6, 12, 24, 36, 48, 60].map((months) => (
                  <option key={months} value={months} />
                ))}
              </datalist>
            </label>
            <label className="field owner-booking-invite__reveal">
              <span>{ar ? 'تاريخ انتهاء العقد' : 'Lease end date'}</span>
              <input
                className="input"
                type="date"
                dir="ltr"
                min={leaseStartsOn || undefined}
                value={leaseEndsOn}
                onChange={(event) => {
                  const next = event.target.value;
                  setLeaseEndsOn(next);
                  setError(null);
                  if (next) unlock('party');
                }}
                onFocus={() => {
                  if (termOk) unlock('party');
                }}
                required
              />
              <small className="field__hint muted">
                {ar
                  ? 'يُحسب تلقائياً من البداية والمدة، ويمكن تعديله لضبط عدد الأشهر.'
                  : 'Calculated from start and term; edit it to adjust the month count.'}
              </small>
            </label>
          </>
        ) : null}

        {showParty ? (
          <div
            className="span-2 owner-booking-invite__reveal"
            ref={bindReveal(stage === 'party')}
          >
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
            <ReservationPartyForm
              locale={locale}
              mode={mode}
              minMonths={OWNER_INVITE_MIN_LEASE_MONTHS}
              omitTermMonths
              value={partyForm}
              onChange={(next) => {
                setPartyForm(next);
                setError(null);
                setContactSavedHint(false);
              }}
              holder="other"
              autoAdvance
              deferTenantCompletion
            />
            {contactSavedHint ? (
              <p className="muted span-2" role="status">
                {ar
                  ? 'تم الحفظ في سجل العناوين — سيظهر في الحجوزات القادمة.'
                  : 'Saved to the address book — available for future bookings.'}
              </p>
            ) : null}
            <p className="ops-hint">
              {ar
                ? 'بعد إرسال الدعوة يُحفظ المحجوز له في دفتر العناوين تلقائياً.'
                : 'After the invite is sent, the guest is saved to the address book automatically.'}
            </p>
          </div>
        ) : null}

        {showContract ? (
          <div
            className="span-2 form-grid owner-booking-invite__reveal"
            ref={bindReveal(stage === 'contract')}
          >
            <label className="field span-2 owner-booking-invite__choice">
              <input
                type="radio"
                name="contractPreference"
                checked={contractPreference === 'electronic'}
                onChange={() => {
                  setContractPreference('electronic');
                  unlock('review');
                }}
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
                onChange={() => {
                  setContractPreference('manual');
                  unlock('review');
                }}
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

        {showReview ? (
          <div
            className="span-2 owner-booking-invite__review owner-booking-invite__reveal"
            ref={bindReveal(true)}
          >
            <header className="owner-booking-invite__review-head">
              <div>
                <p className="owner-booking-invite__review-kicker">
                  {mode === 'sale'
                    ? ar
                      ? 'دعوة بيع'
                      : 'Sale invite'
                    : ar
                      ? 'دعوة تأجير'
                      : 'Lease invite'}
                </p>
                <h3>{reviewUnit.title}</h3>
                {reviewUnit.meta ? (
                  <p className="owner-booking-invite__review-meta">{reviewUnit.meta}</p>
                ) : null}
              </div>
              <span className="owner-booking-invite__review-badge">
                {contractPreference === 'electronic'
                  ? ar
                    ? 'عقد إلكتروني'
                    : 'E-contract'
                  : ar
                    ? 'عقد يدوي'
                    : 'Manual contract'}
              </span>
            </header>

            <section className="owner-booking-invite__review-block">
              <h4>{ar ? 'المستأجر' : 'Tenant'}</h4>
              <p className="owner-booking-invite__review-name">{reviewGuestName}</p>
              <p className="owner-booking-invite__review-contact" dir="ltr">
                {reviewGuestContact || '—'}
              </p>
            </section>

            <section className="owner-booking-invite__review-block">
              <h4>{ar ? 'المبالغ' : 'Amounts'}</h4>
              <div className="owner-booking-invite__review-grid">
                {mode === 'rent' ? (
                  <div>
                    <span>{ar ? 'الإيجار الشهري' : 'Monthly rent'}</span>
                    <strong dir="ltr">
                      {rentMajor || '—'} {unitCurrency}
                    </strong>
                  </div>
                ) : null}
                <div>
                  <span>{ar ? 'الضمان / العربون' : 'Deposit'}</span>
                  <strong dir="ltr">
                    {depositMajor || '—'} {unitCurrency}
                  </strong>
                </div>
                {mode === 'rent' ? (
                  <div>
                    <span>{ar ? 'مدة العقد' : 'Term'}</span>
                    <strong>
                      {termMonthsValue} {ar ? 'شهراً' : 'months'}
                    </strong>
                  </div>
                ) : null}
              </div>
            </section>

            {mode === 'rent' ? (
              <section className="owner-booking-invite__review-block">
                <h4>{ar ? 'التواريخ' : 'Dates'}</h4>
                <ol className="owner-booking-invite__review-dates">
                  <li>
                    <span>{ar ? 'الاستلام' : 'Handover'}</span>
                    <strong dir="ltr">{handoverOn || '—'}</strong>
                  </li>
                  <li>
                    <span>{ar ? 'بداية العقد' : 'Lease start'}</span>
                    <strong dir="ltr">{leaseStartsOn || '—'}</strong>
                  </li>
                  <li>
                    <span>{ar ? 'انتهاء العقد' : 'Lease end'}</span>
                    <strong dir="ltr">{leaseEndsOn || '—'}</strong>
                  </li>
                </ol>
              </section>
            ) : null}

            <p className="owner-booking-invite__review-note" role="note">
              {ar
                ? 'صلاحية الدعوة 24 ساعة. بعد الإرسال تُحجز الوحدة ويصله رابط لإكمال الدفع والمستندات.'
                : 'Invite is valid 24 hours. After send, the unit is held and they receive a link to pay and upload documents.'}
            </p>
          </div>
        ) : null}
      </div>

      {error ? (
        <div className="notice notice--error" role="alert">
          {error}
        </div>
      ) : null}

      <div className="form-actions">
        <button className="button button--quiet" type="button" onClick={onCancel} disabled={busy}>
          {ar ? 'إلغاء' : 'Cancel'}
        </button>
        {showReview ? (
          <button
            className="button button--primary"
            type="button"
            disabled={busy || !canSend}
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
        ) : null}
      </div>
    </div>
  );
}
