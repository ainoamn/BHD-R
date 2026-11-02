'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState, useTransition } from 'react';
import { BookingDetailsProgressive } from '@/components/booking-details-progressive';
import {
  ReservationPartyForm,
  buildReservationParty,
  type PartyForm,
} from '@/components/reservation-party-form';
import { BookingStepScene } from '@/components/stays/booking-step-scene';
import { TermsAcceptance } from '@/components/terms-acceptance';
import {
  ApiError,
  browserNextMutation,
  fetchBrowserCsrfToken,
  humanizeBrowserError,
} from '@/lib/api';
import type { BookingContactsForViewer, BookingFor } from '@/lib/booking-contacts-neon';
import {
  buildInitialPartyForm,
  readBookingPartyDraft,
  writeBookingPartyDraft,
  type BookingPartySeed,
} from '@/lib/booking-party-draft';
import { greetingName, leaseCheckoutGreeting } from '@/lib/booking-step-greeting';
import { bookingTermsDocument, type BookingTermsForCheckout } from '@/lib/booking-terms';
import { formatMoney } from '@/lib/format';
import { contractUseForCategory } from '@/lib/lease-terms';
import { partyDisplayName, partyErrorText, type ReservationParty } from '@/lib/reservation-party';
import { countryName, isInternationalPhone, toInternationalPhone } from '@/lib/world-countries';

type Mode = 'rent' | 'sale';
type Step = 'terms' | 'details' | 'party' | 'review' | 'payment';

const ARABIC = /[\u0600-\u06FF]/;
const PARTY_ERRORS = new Set([
  'tenant_details_invalid',
  'passport_required',
  'cr_expired',
  'cr_expiring_soon',
  'term_too_short',
  'email_unverified',
  'documents_incomplete',
]);
type ContactForm = { fullName: string; phone: string; email: string };

export type PropertyFacts = {
  category: string;
  areaSquareMeters: string | null;
  bedrooms: number;
  bathrooms: number;
  governorate: string;
  wilayat: string;
};

const CATEGORY_TEXT: Record<string, [string, string]> = {
  apartment: ['شقة', 'Apartment'],
  villa: ['فيلا', 'Villa'],
  building: ['مبنى', 'Building'],
  office: ['مكتب', 'Office'],
  shop: ['محل', 'Shop'],
  warehouse: ['مستودع', 'Warehouse'],
  land: ['أرض', 'Land'],
  other: ['أخرى', 'Other'],
};

const EMPTY_CONTACT: ContactForm = { fullName: '', phone: '', email: '' };
const NEW_CONTACT = 'new';

type CheckoutResult = {
  referenceCode: string;
  sessionReference: string;
  amountMinor: string;
  currency: string;
  expiresAt: string;
  alreadyPaid: boolean;
  nextPath: string;
};

async function postDepositCheckout(body: Record<string, unknown>): Promise<CheckoutResult> {
  const send = async (csrf: string) =>
    fetch('/api/public/bookings/deposit-checkout', {
      method: 'POST',
      credentials: 'same-origin',
      headers: {
        accept: 'application/json',
        'content-type': 'application/json',
        'x-csrf-token': csrf,
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(45_000),
    });
  let response = await send(await fetchBrowserCsrfToken());
  if (response.status === 403) response = await send(await fetchBrowserCsrfToken(true));
  const payload = (await response.json().catch(() => null)) as
    (CheckoutResult & { error?: { code?: string; message?: string; messageAr?: string } }) | null;
  if (!response.ok || !payload?.nextPath) {
    throw new ApiError(
      response.status,
      payload?.error?.code ?? 'booking_failed',
      payload?.error?.messageAr ?? payload?.error?.message ?? 'booking_failed',
    );
  }
  return payload;
}

export function LeaseDepositCheckout({
  locale,
  unitId,
  organizationId,
  draftOwnerId,
  title,
  initialMode,
  allowedModes,
  depositByMode,
  currency,
  rentMinor,
  salePriceMinor,
  termsByMode,
  contacts,
  partySeed = null,
  minLeaseMonths,
  property = null,
}: {
  locale: 'ar' | 'en';
  unitId: string;
  /** Property organization — where the booker's prospect party lives. */
  organizationId: string;
  /** Stable id for browser draft storage (usually the signed-in user id). */
  draftOwnerId: string;
  title: string;
  initialMode: Mode;
  allowedModes: Mode[];
  /** Rent and purchase can carry different booking deposits. */
  depositByMode: Partial<Record<Mode, string>>;
  currency: string;
  rentMinor: string | null;
  salePriceMinor: string | null;
  termsByMode: Partial<Record<Mode, BookingTermsForCheckout>>;
  contacts: BookingContactsForViewer;
  /** Prefill from Identity / previous booking / server draft. */
  partySeed?: BookingPartySeed | null;
  /** Shortest lease the owner accepts, in months (one year unless the owner set otherwise). */
  minLeaseMonths: number;
  /** Unit facts shown beside the contract details. */
  property?: PropertyFacts | null;
}) {
  const router = useRouter();
  const ar = locale === 'ar';
  const contractType = contractUseForCategory(property?.category);
  const [step, setStep] = useState<Step>('terms');
  const [mode, setMode] = useState<Mode>(initialMode);
  const [accepted, setAccepted] = useState(false);
  const [bookingFor, setBookingFor] = useState<BookingFor>(
    () => partySeed?.bookingFor ?? 'self',
  );
  const [selfForm, setSelfForm] = useState<ContactForm>({
    fullName: contacts.self.fullName,
    phone: toInternationalPhone(contacts.self.phone),
    email: contacts.self.email ?? '',
  });
  const [partyForm, setPartyForm] = useState<PartyForm>(() =>
    buildInitialPartyForm({
      minMonths: minLeaseMonths,
      contractType,
      identity: partySeed?.identity ?? null,
      bookingParty: partySeed?.bookingParty ?? null,
      serverDraft: partySeed?.serverDraft ?? null,
    }),
  );
  const partyHydrated = useRef(false);
  const [draftReady, setDraftReady] = useState(false);
  const saveTimer = useRef<number | null>(null);
  const [party, setParty] = useState<ReservationParty | null>(null);
  const [otherForm, setOtherForm] = useState<ContactForm>(EMPTY_CONTACT);
  const [savedContactId, setSavedContactId] = useState<string>(NEW_CONTACT);
  const [saveContact, setSaveContact] = useState(true);
  const form = bookingFor === 'self' ? selfForm : otherForm;
  const { fullName, phone, email } = form;
  const selectedSaved = contacts.saved.find((row) => row.id === savedContactId) ?? null;
  const formChanged =
    bookingFor === 'self'
      ? phone.trim() !== toInternationalPhone(contacts.self.phone)
      : !selectedSaved ||
        fullName.trim() !== selectedSaved.fullName.trim() ||
        phone.trim() !== toInternationalPhone(selectedSaved.phone) ||
        email.trim() !== (selectedSaved.email ?? '').trim();
  const offerSave = contacts.canSave && formChanged;
  const [checkout, setCheckout] = useState<CheckoutResult | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [stepHint, setStepHint] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [payBusy, setPayBusy] = useState(false);
  const [pending, startTransition] = useTransition();

  useEffect(() => {
    setError(null);
  }, [step]);

  // Merge local draft after mount so returning visitors keep incomplete fields.
  useEffect(() => {
    if (partyHydrated.current) return;
    partyHydrated.current = true;
    const local = readBookingPartyDraft(draftOwnerId);
    if (local?.form) {
      setPartyForm(
        buildInitialPartyForm({
          minMonths: minLeaseMonths,
          contractType,
          identity: partySeed?.identity ?? null,
          bookingParty: partySeed?.bookingParty ?? null,
          serverDraft: partySeed?.serverDraft ?? null,
          localDraft: local.form,
        }),
      );
      if (local.bookingFor === 'self' || local.bookingFor === 'other') {
        setBookingFor(local.bookingFor);
      }
    }
    setDraftReady(true);
  }, [contractType, draftOwnerId, minLeaseMonths, partySeed]);

  // Autosave incomplete contract details locally + to the booker's prospect card.
  useEffect(() => {
    if (!draftReady) return;
    writeBookingPartyDraft(draftOwnerId, { bookingFor, form: partyForm });
    if (saveTimer.current) window.clearTimeout(saveTimer.current);
    saveTimer.current = window.setTimeout(() => {
      void browserNextMutation('/api/public/booking-party-draft', {
        method: 'POST',
        body: JSON.stringify({ organizationId, bookingFor, form: partyForm }),
      }).catch(() => {
        /* keep local draft even if the network save fails */
      });
    }, 900);
    return () => {
      if (saveTimer.current) window.clearTimeout(saveTimer.current);
    };
  }, [bookingFor, draftOwnerId, draftReady, organizationId, partyForm]);

  const depositMinor = depositByMode[mode] ?? '0';
  const deposit = formatMoney(depositMinor, currency, locale);
  const priceMinor = mode === 'sale' ? salePriceMinor : rentMinor;
  const price = priceMinor && priceMinor !== '0' ? formatMoney(priceMinor, currency, locale) : null;
  const modeTerms = termsByMode[mode] ?? null;
  const termsRef = modeTerms?.ref ?? 'default';
  const termsBlocks = bookingTermsDocument({
    mode,
    depositAr: formatMoney(depositMinor, currency, 'ar'),
    depositEn: formatMoney(depositMinor, currency, 'en'),
    blocks: modeTerms?.blocks ?? null,
  });
  const modeLabel =
    mode === 'sale'
      ? ar
        ? 'حجز للشراء'
        : 'Reserve to buy'
      : ar
        ? 'حجز للإيجار'
        : 'Reserve to rent';
  const priceLabel =
    mode === 'sale' ? (ar ? 'سعر البيع' : 'Sale price') : ar ? 'الإيجار الشهري' : 'Monthly rent';

  const steps: { id: Step; label: string }[] = [
    { id: 'terms', label: ar ? 'الشروط' : 'Terms' },
    { id: 'details', label: ar ? 'بياناتك' : 'Your details' },
    { id: 'party', label: ar ? 'بيانات العقد' : 'Contract details' },
    { id: 'review', label: ar ? 'المراجعة' : 'Review' },
    { id: 'payment', label: ar ? 'الدفع' : 'Payment' },
  ];
  const currentIndex = steps.findIndex((item) => item.id === step);

  function continueFromTerms() {
    if (!accepted) {
      setError(ar ? 'يجب الإقرار بالموافقة على الشروط للمتابعة.' : 'Accept the terms to continue.');
      return;
    }
    setStep('details');
  }

  function updateForm(patch: Partial<ContactForm>) {
    setError(null);
    if (bookingFor === 'self') setSelfForm((current) => ({ ...current, ...patch }));
    else setOtherForm((current) => ({ ...current, ...patch }));
  }

  function chooseBookingFor(next: BookingFor) {
    setError(null);
    setBookingFor(next);
    setSaveContact(next === 'self');
    if (next === 'self') {
      setPartyForm((current) => ({ ...current, entityType: 'person' }));
    }
  }

  function chooseOtherEntity(next: 'person' | 'company') {
    setError(null);
    setPartyForm((current) => ({ ...current, entityType: next }));
    if (next === 'company') {
      setSavedContactId(NEW_CONTACT);
      setSaveContact(false);
    }
  }

  function chooseSavedContact(id: string) {
    setError(null);
    setSavedContactId(id);
    const row = contacts.saved.find((item) => item.id === id);
    setOtherForm(
      row
        ? {
            fullName: row.fullName,
            phone: toInternationalPhone(row.phone),
            email: row.email ?? '',
          }
        : EMPTY_CONTACT,
    );
    setSaveContact(false);
  }

  function continueFromDetails() {
    const forCompany = bookingFor === 'other' && partyForm.entityType === 'company';
    if (fullName.trim().length < 2) {
      setError(
        forCompany
          ? ar
            ? 'أدخل اسم الشركة (حرفان على الأقل)'
            : 'Enter the company name (at least 2 characters)'
          : ar
            ? 'أدخل الاسم الكامل (حرفان على الأقل)'
            : 'Enter your full name (at least 2 characters)',
      );
      return;
    }
    if (!isInternationalPhone(phone)) {
      setError(
        ar
          ? 'رقم الهاتف إلزامي — 8 أو 9 أرقام محلية مع رمز الدولة'
          : 'Phone is required — 8 or 9 local digits with country code',
      );
      return;
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) {
      setError(ar ? 'البريد الإلكتروني إلزامي وبصيغة صحيحة' : 'A valid email is required');
      return;
    }
    // Prefill the contract party from the contact just entered (person or company).
    setPartyForm((current) => {
      const name = fullName.trim();
      const nextPhone = phone.trim();
      const nextEmail = email.trim();
      if (bookingFor === 'other' && current.entityType === 'company') {
        const company = current.company;
        if (company.nameAr || company.nameEn || company.phone || company.email) {
          return current;
        }
        return {
          ...current,
          company: {
            ...company,
            ...(ARABIC.test(name) ? { nameAr: name } : { nameEn: name }),
            phone: nextPhone,
            email: nextEmail,
          },
        };
      }
      const person = current.person;
      if (person.nameAr || person.nameEn || person.phone || person.email) return current;
      return {
        ...current,
        entityType: bookingFor === 'self' ? 'person' : current.entityType,
        person: {
          ...person,
          ...(ARABIC.test(name) ? { nameAr: name } : { nameEn: name }),
          phone: nextPhone,
          email: nextEmail,
        },
      };
    });
    setStep('party');
  }

  function continueFromParty() {
    const built = buildReservationParty(partyForm, {
      holder: bookingFor,
      mode,
      minMonths: minLeaseMonths,
      ar,
    });
    if ('error' in built) {
      setError(built.error);
      return;
    }
    setParty(built.party);
    setStep('review');
  }

  function goTo(path: string) {
    if (!path.startsWith(`/${locale}/`)) throw new Error('invalid_redirect');
    window.location.assign(path);
  }

  function confirmAndPay() {
    setConfirmOpen(false);
    if (!party) {
      setStep('party');
      return;
    }
    startTransition(async () => {
      setError(null);
      setStepHint(ar ? 'حجز الوحدة مؤقتاً…' : 'Holding the unit…');
      try {
        const result = await postDepositCheckout({
          unitId,
          mode,
          locale,
          fullName: fullName.trim(),
          phone: phone.trim(),
          email: email.trim(),
          termsAccepted: true,
          termsRef,
          bookingFor,
          party,
          saveContact: offerSave && saveContact,
          ...(bookingFor === 'other' && selectedSaved ? { savedContactId: selectedSaved.id } : {}),
        });
        setCheckout(result);
        setStep('payment');
        setPayBusy(true);
        setStepHint(
          result.alreadyPaid
            ? ar
              ? 'تم دفع مبلغ الضمان مسبقاً — جارٍ فتح العقد…'
              : 'Deposit already paid — opening the contract…'
            : ar
              ? 'التحويل إلى بوابة الدفع…'
              : 'Redirecting to payment gateway…',
        );
        goTo(result.nextPath);
      } catch (caught) {
        setStepHint(null);
        setPayBusy(false);
        if (caught instanceof ApiError && caught.status === 401) {
          window.location.assign(
            `/${locale}/login?next=${encodeURIComponent(`/${locale}/book/${unitId}?mode=${mode}`)}`,
          );
          return;
        }
        if (caught instanceof ApiError && caught.code === 'terms_changed') {
          setAccepted(false);
          setStep('terms');
          router.refresh();
          setError(
            ar
              ? 'حدّث المالك الشروط والأحكام — راجعها حتى النهاية ووافق عليها مجدداً.'
              : 'The owner updated the terms — read them to the end and accept again.',
          );
          return;
        }
        if (caught instanceof ApiError && PARTY_ERRORS.has(caught.code)) {
          setStep('party');
          setError(partyErrorText(caught.code, ar));
          return;
        }
        setError(humanizeBrowserError(caught, ar));
      }
    });
  }

  function payNow() {
    if (!checkout) return;
    setPayBusy(true);
    try {
      goTo(checkout.nextPath);
    } catch (caught) {
      setPayBusy(false);
      setError(humanizeBrowserError(caught, ar));
    }
  }

  const showScene = step === 'terms';
  const denseChrome = !showScene;
  const leaseGreeting = leaseCheckoutGreeting(step, {
    ar,
    sale: mode === 'sale',
    name: greetingName(contacts.self.fullName),
  });

  return (
    <section
      className={[
        'stays-checkout stays-checkout--wizard stays-checkout--page lease-checkout',
        denseChrome ? 'stays-checkout--dense' : '',
      ]
        .filter(Boolean)
        .join(' ')}
      aria-labelledby="lease-checkout-title"
    >
      <h2
        id="lease-checkout-title"
        className={denseChrome ? 'stays-checkout__title--sr' : undefined}
      >
        {ar ? 'إكمال الحجز' : 'Complete your booking'}
      </h2>
      {title && !denseChrome ? <p className="stays-checkout__property muted">{title}</p> : null}

      <ol
        className={['stays-checkout__steps', denseChrome ? 'stays-checkout__steps--quiet' : '']
          .filter(Boolean)
          .join(' ')}
        aria-label={ar ? 'خطوات الحجز' : 'Booking steps'}
      >
        {steps.map((item, index) => {
          const active = item.id === step;
          const done = index < currentIndex;
          return (
            <li
              key={item.id}
              className={
                active
                  ? 'stays-checkout__step is-active'
                  : done
                    ? 'stays-checkout__step is-done'
                    : 'stays-checkout__step'
              }
            >
              <span aria-hidden="true">{index + 1}</span>
              {item.label}
            </li>
          );
        })}
      </ol>

      {showScene ? (
        <BookingStepScene
          greeting={leaseGreeting}
          label={steps[currentIndex]!.label}
          stepNo={currentIndex + 1}
          stepCount={steps.length}
          ar={ar}
        />
      ) : (
        <div className="stays-checkout__compact-head">
          <p className="stays-checkout__compact-meta">
            <span>{steps[currentIndex]!.label}</span>
            <span dir="ltr">
              {currentIndex + 1} / {steps.length}
            </span>
          </p>
          <h3>{leaseGreeting.heading}</h3>
        </div>
      )}

      {step === 'terms' ? (
        <div className="stays-checkout__panel">
          <h3 className="stays-checkout__section-title">
            {ar ? 'الشروط والأحكام' : 'Terms & conditions'}
          </h3>
          {allowedModes.length > 1 ? (
            <div
              className="lease-checkout__modes"
              role="group"
              aria-label={ar ? 'نوع الحجز' : 'Booking type'}
            >
              {allowedModes.map((option) => (
                <button
                  key={option}
                  type="button"
                  className={`button ${mode === option ? 'button--primary' : 'button--quiet'}`}
                  aria-pressed={mode === option}
                  onClick={() => {
                    setMode(option);
                    setAccepted(false);
                  }}
                >
                  {option === 'sale'
                    ? ar
                      ? 'أريد الشراء'
                      : 'I want to buy'
                    : ar
                      ? 'أريد التأجير'
                      : 'I want to rent'}
                </button>
              ))}
            </div>
          ) : null}
          <dl className="stays-checkout__summary">
            <div>
              <dt>{ar ? 'نوع الحجز' : 'Booking type'}</dt>
              <dd>{modeLabel}</dd>
            </div>
            <div>
              <dt>{priceLabel}</dt>
              <dd dir="ltr">{price ?? '—'}</dd>
            </div>
            <div>
              <dt>{ar ? 'مبلغ الضمان المطلوب' : 'Deposit due now'}</dt>
              <dd dir="ltr">
                <strong>{deposit}</strong>
              </dd>
            </div>
          </dl>
          <TermsAcceptance
            ar={ar}
            blocks={termsBlocks}
            letterhead={modeTerms?.letterhead ?? null}
            printTitle={
              mode === 'sale'
                ? {
                    ar: 'الشروط والأحكام — حجز للشراء',
                    en: 'Terms & conditions — purchase reservation',
                  }
                : {
                    ar: 'الشروط والأحكام — حجز للإيجار',
                    en: 'Terms & conditions — rental reservation',
                  }
            }
            accepted={accepted}
            onAcceptedChange={setAccepted}
            resetKey={`${mode}:${termsRef}`}
            id="lease-booking-terms"
          />
          <div className="stays-checkout__nav stays-checkout__nav--sticky">
            <button
              type="button"
              className="button button--primary"
              disabled={!accepted}
              onClick={continueFromTerms}
            >
              {ar ? 'متابعة' : 'Continue'}
            </button>
          </div>
        </div>
      ) : null}

      {step === 'details' ? (
        <div className="stays-checkout__panel">
          <h3>{ar ? 'بياناتك' : 'Your details'}</h3>
          <BookingDetailsProgressive
            locale={locale}
            bookingFor={bookingFor}
            onBookingFor={chooseBookingFor}
            entityType={partyForm.entityType}
            onEntityType={chooseOtherEntity}
            contacts={contacts}
            savedContactId={savedContactId}
            onSavedContact={chooseSavedContact}
            fullName={fullName}
            phone={phone}
            email={email}
            onFormChange={updateForm}
            offerSave={offerSave}
            saveContact={saveContact}
            onSaveContact={setSaveContact}
          />
          <div className="stays-checkout__nav stays-checkout__nav--sticky">
            <button type="button" className="button button--quiet" onClick={() => setStep('terms')}>
              {ar ? 'رجوع' : 'Back'}
            </button>
            <button type="button" className="button button--primary" onClick={continueFromDetails}>
              {ar ? 'متابعة' : 'Continue'}
            </button>
          </div>
        </div>
      ) : null}

      {step === 'party' ? (
        <div className="stays-checkout__panel">
          <h3>
            {mode === 'sale'
              ? ar
                ? 'بيانات المشتري وعقد البيع'
                : 'Buyer & sale contract details'
              : ar
                ? 'بيانات المستأجر وعقد الإيجار'
                : 'Tenant & lease details'}
          </h3>
          <p className="muted stays-checkout__hint">
            {bookingFor === 'self'
              ? ar
                ? `${mode === 'sale' ? 'المشتري' : 'المستأجر'} هو أنت — أكمل بياناتك كما في الهوية.`
                : `You are the ${mode === 'sale' ? 'buyer' : 'tenant'} — complete your details as on your ID.`
              : ar
                ? `${mode === 'sale' ? 'المشتري' : 'المستأجر'} شخص آخر — حدّد إن كان فرداً أو شركة وأدخل بياناته.`
                : `The ${mode === 'sale' ? 'buyer' : 'tenant'} is someone else — choose individual or company and enter their details.`}
          </p>
          <details className="party-form__property">
            <summary id="lease-property-facts">
              <span>{ar ? 'بيانات العقار' : 'Property details'}</span>
              <em>{ar ? 'عرض' : 'Show'}</em>
            </summary>
            <dl className="stays-checkout__summary">
              <div>
                <dt>{ar ? 'العقار' : 'Property'}</dt>
                <dd>{title}</dd>
              </div>
              {property ? (
                <>
                  <div>
                    <dt>{ar ? 'النوع' : 'Type'}</dt>
                    <dd>{CATEGORY_TEXT[property.category]?.[ar ? 0 : 1] ?? property.category}</dd>
                  </div>
                  {[property.wilayat, property.governorate].some(Boolean) ? (
                    <div>
                      <dt>{ar ? 'الموقع' : 'Location'}</dt>
                      <dd>{[property.wilayat, property.governorate].filter(Boolean).join('، ')}</dd>
                    </div>
                  ) : null}
                  {property.areaSquareMeters ? (
                    <div>
                      <dt>{ar ? 'المساحة' : 'Area'}</dt>
                      <dd>
                        <bdi dir="ltr">{property.areaSquareMeters} m²</bdi>
                      </dd>
                    </div>
                  ) : null}
                  {property.bedrooms || property.bathrooms ? (
                    <div>
                      <dt>{ar ? 'الغرف / الحمامات' : 'Beds / baths'}</dt>
                      <dd>
                        <bdi dir="ltr">
                          {property.bedrooms} / {property.bathrooms}
                        </bdi>
                      </dd>
                    </div>
                  ) : null}
                </>
              ) : null}
              {mode === 'rent' ? (
                <div>
                  <dt>{ar ? 'نوع الاستخدام' : 'Usage type'}</dt>
                  <dd>
                    {partyForm.contractType === 'commercial'
                      ? ar
                        ? 'تجاري'
                        : 'Commercial'
                      : ar
                        ? 'سكني'
                        : 'Residential'}
                  </dd>
                </div>
              ) : null}
              {price ? (
                <div>
                  <dt>{priceLabel}</dt>
                  <dd>
                    <bdi dir="ltr">{price}</bdi>
                  </dd>
                </div>
              ) : null}
              {mode === 'rent' ? (
                <div>
                  <dt>{ar ? 'مدة العقد' : 'Contract term'}</dt>
                  <dd>
                    {ar
                      ? `${partyForm.termMonths || '—'} شهراً (الحد الأدنى ${minLeaseMonths})`
                      : `${partyForm.termMonths || '—'} months (minimum ${minLeaseMonths})`}
                  </dd>
                </div>
              ) : null}
            </dl>
          </details>
          <ReservationPartyForm
            value={partyForm}
            onChange={(next) => {
              setError(null);
              setPartyForm(next);
            }}
            holder={bookingFor}
            mode={mode}
            minMonths={minLeaseMonths}
            locale={locale}
          />
          <div className="stays-checkout__nav stays-checkout__nav--sticky">
            <button
              type="button"
              className="button button--quiet"
              onClick={() => setStep('details')}
            >
              {ar ? 'رجوع' : 'Back'}
            </button>
            <button type="button" className="button button--primary" onClick={continueFromParty}>
              {ar ? 'متابعة' : 'Continue'}
            </button>
          </div>
        </div>
      ) : null}

      {step === 'review' ? (
        <div className="stays-checkout__panel">
          <h3>{ar ? 'مراجعة الحجز' : 'Review your booking'}</h3>
          <dl className="stays-checkout__summary">
            <div>
              <dt>{ar ? 'العقار' : 'Property'}</dt>
              <dd>{title}</dd>
            </div>
            <div>
              <dt>{ar ? 'نوع الحجز' : 'Booking type'}</dt>
              <dd>{modeLabel}</dd>
            </div>
            <div>
              <dt>{ar ? 'الحجز لـ' : 'Booking for'}</dt>
              <dd>
                {bookingFor === 'self'
                  ? ar
                    ? 'لي شخصياً'
                    : 'Myself'
                  : partyForm.entityType === 'company'
                    ? ar
                      ? 'شركة أخرى'
                      : 'Another company'
                    : ar
                      ? 'شخص آخر'
                      : 'Someone else'}
              </dd>
            </div>
            <div>
              <dt>
                {bookingFor === 'other' && partyForm.entityType === 'company'
                  ? ar
                    ? 'الشركة'
                    : 'Company'
                  : ar
                    ? 'الاسم'
                    : 'Name'}
              </dt>
              <dd>{fullName}</dd>
            </div>
            <div>
              <dt>{ar ? 'الهاتف' : 'Phone'}</dt>
              <dd dir="ltr">{phone}</dd>
            </div>
            {party ? (
              <>
                <div>
                  <dt>
                    {mode === 'sale' ? (ar ? 'المشتري' : 'Buyer') : ar ? 'المستأجر' : 'Tenant'}
                  </dt>
                  <dd>
                    {partyDisplayName(party, ar)}
                    {' · '}
                    {party.entityType === 'company'
                      ? ar
                        ? 'شركة'
                        : 'Company'
                      : party.person
                        ? countryName(party.person.nationality, locale)
                        : ''}
                  </dd>
                </div>
                {mode === 'rent' ? (
                  <div>
                    <dt>{ar ? 'نوع العقد ومدته' : 'Contract type & term'}</dt>
                    <dd>
                      {party.contractType === 'commercial'
                        ? ar
                          ? 'تجاري'
                          : 'Commercial'
                        : ar
                          ? 'سكني'
                          : 'Residential'}
                      {' · '}
                      {party.termMonths} {ar ? 'شهراً' : 'months'}
                    </dd>
                  </div>
                ) : null}
              </>
            ) : null}
            <div>
              <dt>{priceLabel}</dt>
              <dd dir="ltr">{price ?? '—'}</dd>
            </div>
            <div>
              <dt>{ar ? 'مبلغ الضمان' : 'Deposit'}</dt>
              <dd dir="ltr">
                <strong>{deposit}</strong>
              </dd>
            </div>
          </dl>
          <p className="muted stays-checkout__hint">
            {ar
              ? 'يُحجز العقار باسمك فقط بعد دفع مبلغ الضمان بنجاح، ثم تنتقل مباشرة لتوقيع العقد وإرفاق المستندات.'
              : 'The property is reserved for you only after the deposit is paid; you then sign the contract and attach documents.'}
          </p>
          <div className="stays-checkout__nav stays-checkout__nav--sticky">
            <button type="button" className="button button--quiet" onClick={() => setStep('party')}>
              {ar ? 'رجوع' : 'Back'}
            </button>
            <button
              type="button"
              className="button button--primary"
              disabled={pending || payBusy}
              onClick={() => setConfirmOpen(true)}
            >
              {pending || payBusy
                ? ar
                  ? 'جارٍ الحجز والدفع…'
                  : 'Booking & paying…'
                : ar
                  ? 'تأكيد الحجز'
                  : 'Confirm booking'}
            </button>
          </div>
        </div>
      ) : null}

      {step === 'payment' && checkout ? (
        <div className="stays-checkout__panel">
          <h3>{ar ? 'تم إنشاء الحجز — أكمل الدفع' : 'Booking created — complete payment'}</h3>
          <dl className="stays-checkout__summary">
            <div>
              <dt>{ar ? 'مرجع الحجز' : 'Reference'}</dt>
              <dd dir="ltr">
                <strong>{checkout.referenceCode}</strong>
              </dd>
            </div>
            <div>
              <dt>{ar ? 'نوع الحجز' : 'Booking type'}</dt>
              <dd>{modeLabel}</dd>
            </div>
            <div>
              <dt>{ar ? 'مبلغ الضمان' : 'Deposit'}</dt>
              <dd dir="ltr">
                <strong>{formatMoney(checkout.amountMinor, checkout.currency, locale)}</strong>
              </dd>
            </div>
          </dl>
          <p className="muted stays-checkout__hint">
            {ar
              ? 'أكمل الدفع خلال 30 دقيقة للاحتفاظ بالحجز، وبعده يُفتح العقد للتوقيع.'
              : 'Pay within 30 minutes to keep the booking; the contract opens for signing right after.'}
          </p>
          <div className="stays-checkout__nav stays-checkout__nav--sticky">
            <button
              type="button"
              className="button button--primary"
              disabled={payBusy}
              onClick={payNow}
            >
              {payBusy
                ? ar
                  ? 'جارٍ التحويل…'
                  : 'Redirecting…'
                : checkout.alreadyPaid
                  ? ar
                    ? 'متابعة لتوقيع العقد'
                    : 'Continue to sign'
                  : ar
                    ? 'ادفع الآن'
                    : 'Pay now'}
            </button>
          </div>
        </div>
      ) : null}

      {stepHint ? (
        <p className="notice notice--info" role="status">
          {stepHint}
        </p>
      ) : null}
      {error ? (
        <p className="field__error" role="alert">
          {error}
        </p>
      ) : null}

      {confirmOpen ? (
        <div
          className="stays-checkout__modal"
          role="dialog"
          aria-modal="true"
          aria-labelledby="lease-pay-confirm-title"
        >
          <div className="stays-checkout__modal-card">
            <h3 id="lease-pay-confirm-title">
              {ar ? 'تأكيد الدفع مطلوب' : 'Payment required to confirm'}
            </h3>
            <p>
              {ar
                ? `للاحتفاظ بالعقار، يجب دفع مبلغ الضمان (${deposit}) الآن. يُعتبر الحجز مؤكّداً فقط بعد إتمام الدفع بنجاح. بالموافقة ستُفتح بوابة الدفع الآمنة.`
                : `To keep this property, pay the deposit (${deposit}) now. The booking is confirmed only after successful payment. Agreeing opens the secure payment gateway.`}
            </p>
            <div className="stays-checkout__nav">
              <button
                type="button"
                className="button button--quiet"
                onClick={() => setConfirmOpen(false)}
              >
                {ar ? 'رجوع' : 'Back'}
              </button>
              <button
                type="button"
                className="button button--primary"
                disabled={pending || payBusy}
                onClick={confirmAndPay}
              >
                {ar ? 'موافق — متابعة للدفع' : 'Agree — continue to pay'}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </section>
  );
}
