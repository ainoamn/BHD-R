'use client';

import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import type { CurrencyCode, StayPublicDetail } from '@bhd-r/contracts';
import { BrandMark } from '@bhd-r/ui';
import { fetchBrowserCsrfToken } from '@/lib/api';
import { depositForMode } from '@/lib/booking-deposit';
import { formatMoney } from '@/lib/format';
import { formatListingLocation } from '@/lib/listing-card-copy';
import { resolvePublicGallery } from '@/lib/gallery-scope';
import { googleMapsEmbedSrc } from '@/lib/parse-google-maps-url';
import { generateUnitListingDescriptions } from '@/lib/property-listing-copy';
import {
  assignUnitSerials,
  inferUnitKind,
  summarizeUnitKinds,
  unitKindLabel,
} from '@/lib/unit-identity';
import type { BadgeChip } from '@/lib/badges-shared';
import type { HostSummary } from '@/lib/booking-reviews-neon';
import type { ManagedProperty } from '@/components/property-detail-manager';
import { BadgeChips } from '@/components/badges/badge-chips';
import { HostCard } from '@/components/host-card';
import { ListingEngagementBar } from '@/components/listing-engagement-bar';
import { PropertyQrCard } from '@/components/property-qr-card';
import { ReputationView } from '@/components/reviews/reputation-view';
import {
  StayAvailabilityCalendar,
  type HalfDayStayType,
} from '@/components/stays/stay-availability-calendar';
import { StayGuestInfoSection } from '@/components/stays/stay-guest-info-section';
import { StayPhotoRating } from '@/components/stays/stay-photo-rating';

const AMENITY_ICONS: Record<string, string> = {
  parking: '🅿',
  elevator: '🛗',
  security: '🛡',
  cctv: '📹',
  pool: '🏊',
  gym: '🏋',
  garden: '🌳',
  central_ac: '❄',
  accessible: '♿',
  fire_system: '🔥',
  balcony: '🏙',
  maid_room: '🚪',
  storage: '📦',
  laundry: '🧺',
  wifi: '📶',
  kids_area: '🧒',
  mosque_nearby: '🕌',
  school_nearby: '🏫',
  sea_view: '🌊',
  mountain_view: '⛰',
  furnished_kit: '🍳',
  smart_home: '🏠',
};

function defaultStayCheckIn(): string {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  return d.toISOString().slice(0, 10);
}

function defaultStayCheckOut(checkIn: string): string {
  const d = new Date(`${checkIn}T12:00:00`);
  d.setDate(d.getDate() + 2);
  return d.toISOString().slice(0, 10);
}

function mapsUrlFromNotes(notes?: string | null): string | null {
  if (!notes) return null;
  const match = notes.match(/Google Maps:\s*(https?:\/\/\S+)/i);
  return match?.[1]?.replace(/[.,;]+$/, '') ?? null;
}

export type StayPublicBooking = {
  slug: string;
  title?: string;
  unitId?: string;
  nightlyMinor?: string | null;
  currency?: CurrencyCode | string | null;
  maxGuests?: number | null;
  checkInOn?: string;
  checkOutOn?: string;
  adults?: string;
  children?: string;
  allowViewingRequests?: boolean;
};

/**
 * Public daily-stay desk: book first, optional sale CTA, details on demand.
 */
export function StayPublicDesk({
  property,
  locale,
  focusUnitId,
  signedIn = false,
  stayBooking,
  stayDetail,
  stayRating = null,
  hostSummary = null,
  badges,
}: {
  property: ManagedProperty;
  locale: 'ar' | 'en';
  focusUnitId?: string;
  signedIn?: boolean;
  stayBooking: StayPublicBooking;
  stayDetail: StayPublicDetail;
  stayRating?: { unitId: string; rating: { score: number; count: number } | null } | null;
  hostSummary?: HostSummary | null;
  badges?: readonly BadgeChip[];
}) {
  const router = useRouter();
  const ar = locale === 'ar';
  const [busy, setBusy] = useState(false);
  const [viewingMessage, setViewingMessage] = useState<string | null>(null);
  const [viewingError, setViewingError] = useState<string | null>(null);
  const [activeImage, setActiveImage] = useState(0);
  const initialStayIn = stayBooking.checkInOn ?? defaultStayCheckIn();
  const [stayCheckInOn, setStayCheckInOn] = useState(initialStayIn);
  const [stayCheckOutOn, setStayCheckOutOn] = useState(
    stayBooking.checkOutOn ?? defaultStayCheckOut(initialStayIn),
  );
  const [stayHalfDay, setStayHalfDay] = useState<HalfDayStayType | null>(null);

  const gallery = useMemo(() => {
    const unitIdsOrdered = [...property.units]
      .sort((a, b) => a.code.localeCompare(b.code))
      .map((unit) => unit.id);
    return resolvePublicGallery(property.gallery ?? [], {
      ...(focusUnitId ? { focusUnitId } : {}),
      propertyKind: property.kind,
      unitIdsOrdered,
    });
  }, [property.gallery, property.kind, property.units, focusUnitId]);

  const primaryUnit =
    (focusUnitId ? property.units.find((unit) => unit.id === focusUnitId) : undefined) ??
    property.units[0];

  const unitSerials = useMemo(
    () =>
      assignUnitSerials(
        property.serialNumber,
        [...property.units].sort((a, b) => a.code.localeCompare(b.code)),
      ),
    [property.serialNumber, property.units],
  );
  const unitKindCounts = useMemo(() => summarizeUnitKinds(property.units), [property.units]);
  const focusedSerial = primaryUnit ? (unitSerials.get(primaryUnit.id) ?? null) : null;
  const displaySerial =
    focusUnitId && focusedSerial ? focusedSerial : (property.serialNumber ?? null);
  const focusedUnitKind = primaryUnit ? inferUnitKind(primaryUnit) : null;
  const focusedUnitHeadline =
    focusUnitId && primaryUnit && focusedUnitKind
      ? `${unitKindLabel(focusedUnitKind, locale)} ${primaryUnit.code}`.trim()
      : null;
  const buildingNameLine = ar ? property.nameAr : property.nameEn;
  const showPublicOwnerName =
    Boolean(property.showOwnerNameOnListing ?? property.profile?.showOwnerNameOnListing) &&
    Boolean(property.ownerPartyName);

  const addressLine = property.address
    ? formatListingLocation({
        governorate: property.address.governorate,
        wilayat: property.address.wilayat,
        city: property.address.city,
        area: property.address.area,
        street: property.address.street,
      }) || '—'
    : '—';

  const publicPath = `/${locale}/properties/${property.id}`;
  const stayPath = `/${locale}/stays/${encodeURIComponent(stayBooking.slug)}${
    stayBooking.unitId ? `?unit=${encodeURIComponent(stayBooking.unitId)}` : ''
  }`;
  const reviewedUnitId = stayBooking.unitId ?? focusUnitId ?? primaryUnit?.id;

  const stayBookHref = `/${locale}/stays/${encodeURIComponent(stayBooking.slug)}/book?${new URLSearchParams(
    {
      checkInOn: stayCheckInOn,
      checkOutOn: stayCheckOutOn,
      ...(stayBooking.unitId ? { unit: stayBooking.unitId } : {}),
      ...(stayBooking.adults ? { adults: stayBooking.adults } : {}),
      ...(stayBooking.children ? { children: stayBooking.children } : {}),
      ...(stayHalfDay ? { stayType: stayHalfDay } : {}),
    },
  ).toString()}`;

  const stayCurrency = (stayBooking.currency ?? primaryUnit?.currency ?? 'OMR') as string;
  const stayNightlyLabel =
    stayBooking.nightlyMinor && stayCurrency
      ? formatMoney(stayBooking.nightlyMinor, stayCurrency, locale)
      : null;

  const offersSale =
    Boolean(primaryUnit?.salePriceMinor) &&
    primaryUnit!.salePriceMinor !== '0' &&
    (primaryUnit!.listingPurpose === 'sale' || primaryUnit!.listingPurpose === 'both');
  const salePriceLabel =
    offersSale && primaryUnit?.salePriceMinor
      ? formatMoney(primaryUnit.salePriceMinor, primaryUnit.currency, locale)
      : null;
  const saleDeposit =
    offersSale && primaryUnit
      ? depositForMode('sale', primaryUnit.depositMinor, primaryUnit.saleDepositMinor ?? null)
      : null;
  const saleBookHref =
    offersSale && primaryUnit ? `/${locale}/book/${primaryUnit.id}?mode=sale` : null;

  const offersLongTermRent =
    Boolean(primaryUnit) &&
    primaryUnit!.rentMinor !== '0' &&
    (primaryUnit!.listingPurpose === 'rent' || primaryUnit!.listingPurpose === 'both');
  const longTermRentLabel =
    offersLongTermRent && primaryUnit
      ? formatMoney(primaryUnit.rentMinor, primaryUnit.currency, locale)
      : null;

  const headline = stayBooking.title ?? focusedUnitHeadline ?? buildingNameLine;

  const composedUnitDescription = useMemo(() => {
    if (!focusUnitId || !primaryUnit || property.kind !== 'multi_unit') return null;
    return generateUnitListingDescriptions({
      unitNameAr: primaryUnit.nameAr,
      unitNameEn: primaryUnit.nameEn,
      unitCode: primaryUnit.code,
      unitKind: inferUnitKind(primaryUnit),
      floor: primaryUnit.floor ?? undefined,
      bedrooms: primaryUnit.bedrooms,
      bathrooms: primaryUnit.bathrooms,
      majlis: primaryUnit.majlis,
      halls: primaryUnit.halls,
      kitchens: primaryUnit.kitchens,
      hasPool: primaryUnit.hasPool,
      area: primaryUnit.areaSquareMeters ?? undefined,
      listingPurpose: primaryUnit.listingPurpose,
      rentLabel:
        primaryUnit.listingPurpose !== 'sale'
          ? formatMoney(primaryUnit.rentMinor, primaryUnit.currency, locale)
          : undefined,
      saleLabel: primaryUnit.salePriceMinor
        ? formatMoney(primaryUnit.salePriceMinor, primaryUnit.currency, locale)
        : undefined,
      buildingNameAr: property.nameAr,
      buildingNameEn: property.nameEn,
      buildingSerial: property.serialNumber,
      buildingDescriptionAr: property.descriptionAr,
      buildingDescriptionEn: property.descriptionEn,
      buildingYearBuilt: property.profile?.yearBuilt ?? undefined,
      buildingTotalArea: property.profile?.builtUpAreaSquareMeters ?? undefined,
      governorate: property.address?.governorate,
      wilayat: property.address?.wilayat,
      village: property.address?.city ?? property.address?.area ?? undefined,
    });
  }, [focusUnitId, primaryUnit, property, locale]);

  const buildingAgeYears =
    property.profile?.yearBuilt && Number.isFinite(property.profile.yearBuilt)
      ? Math.max(0, new Date().getFullYear() - property.profile.yearBuilt)
      : null;
  const totalArea = property.profile?.builtUpAreaSquareMeters ?? null;
  const mapsUrl = property.mapsUrl || mapsUrlFromNotes(property.profile?.notes) || null;
  const latitude =
    typeof property.latitude === 'number' && Number.isFinite(property.latitude)
      ? property.latitude
      : null;
  const longitude =
    typeof property.longitude === 'number' && Number.isFinite(property.longitude)
      ? property.longitude
      : null;
  const mapEmbed =
    latitude !== null && longitude !== null ? googleMapsEmbedSrc(latitude, longitude) : null;

  const allowViewing = stayBooking.allowViewingRequests !== false && Boolean(primaryUnit);

  function goSale() {
    if (!saleBookHref) return;
    if (!signedIn) {
      router.push(`/${locale}/login?next=${encodeURIComponent(saleBookHref)}`);
      return;
    }
    router.push(saleBookHref);
  }

  async function requestViewing() {
    const unitId = stayBooking.unitId ?? primaryUnit?.id;
    if (!unitId) return;
    if (!signedIn) {
      router.push(`/${locale}/login?next=${encodeURIComponent(stayPath)}`);
      return;
    }
    setBusy(true);
    setViewingError(null);
    setViewingMessage(null);
    try {
      const response = await fetch('/api/public/viewing-requests', {
        method: 'POST',
        credentials: 'same-origin',
        headers: {
          'content-type': 'application/json',
          accept: 'application/json',
          'x-csrf-token': await fetchBrowserCsrfToken(),
          'idempotency-key': crypto.randomUUID(),
        },
        body: JSON.stringify({ unitId, locale }),
      });
      const payload = (await response.json().catch(() => null)) as {
        reference?: string;
        error?: { message?: string; code?: string };
      } | null;
      if (!response.ok) {
        throw new Error(payload?.error?.message ?? payload?.error?.code ?? 'request_failed');
      }
      setViewingMessage(
        ar
          ? `تم إرسال طلب المعاينة${payload?.reference ? ` · المرجع ${payload.reference}` : ''}.`
          : `Viewing request sent${payload?.reference ? ` · ref ${payload.reference}` : ''}.`,
      );
    } catch (caught) {
      setViewingError(caught instanceof Error ? caught.message : 'request_failed');
    } finally {
      setBusy(false);
    }
  }

  const descriptionBlocks = composedUnitDescription
    ? (ar ? composedUnitDescription.descriptionAr : composedUnitDescription.descriptionEn)
        .split(/\n\n+/)
        .filter(Boolean)
    : [
        ar
          ? property.descriptionAr || property.descriptionEn
          : property.descriptionEn || property.descriptionAr,
      ].filter(Boolean);

  return (
    <div className="stay-desk">
      <div className="stay-desk__sticky" role="region" aria-label={ar ? 'إجراءات الحجز' : 'Booking actions'}>
        <div className="stay-desk__sticky-inner">
          <div className="stay-desk__sticky-prices">
            {stayNightlyLabel ? (
              <span className="stay-desk__price-chip stay-desk__price-chip--stay">
                <strong dir="ltr">{stayNightlyLabel}</strong>
                <em>{ar ? 'لليلة' : '/ night'}</em>
              </span>
            ) : null}
            {salePriceLabel ? (
              <span className="stay-desk__price-chip stay-desk__price-chip--sale">
                <strong dir="ltr">{salePriceLabel}</strong>
                <em>{ar ? 'للبيع' : 'for sale'}</em>
              </span>
            ) : null}
            {!stayNightlyLabel && !salePriceLabel ? (
              <strong>{ar ? 'إقامة يومية' : 'Daily stay'}</strong>
            ) : null}
            <span className="stay-desk__sticky-dates" dir="ltr">
              {stayCheckInOn} → {stayCheckOutOn}
            </span>
          </div>
          <div className="stay-desk__sticky-actions">
            <Link className="button button--primary stay-desk__cta" href={stayBookHref}>
              {ar ? 'متابعة الحجز' : 'Continue to book'}
            </Link>
            {saleBookHref ? (
              <button
                type="button"
                className="button button--secondary stay-desk__cta"
                disabled={busy}
                onClick={() => goSale()}
              >
                {ar ? 'شراء الوحدة' : 'Buy this unit'}
              </button>
            ) : null}
          </div>
        </div>
      </div>

      <div className="stay-desk__layout">
        <div className="stay-desk__main">
          <section className="stay-desk__gallery" aria-label={ar ? 'معرض الصور' : 'Photo gallery'}>
            {gallery.length ? (
              <>
                <div className="stay-desk__hero-shot">
                  <img
                    src={gallery[Math.min(activeImage, gallery.length - 1)]!.url!}
                    alt=""
                    fetchPriority="high"
                    decoding="async"
                  />
                  <span className="media-watermark" aria-hidden="true">
                    <BrandMark tone="onDark" />
                  </span>
                  {stayRating ? (
                    <StayPhotoRating
                      unitId={stayRating.unitId}
                      rating={stayRating.rating}
                      locale={locale}
                      hostKey={property.organizationId ?? null}
                    />
                  ) : null}
                </div>
                {displaySerial ? (
                  <p className="stay-desk__serial" dir="ltr">
                    <span>{ar ? 'الرقم المتسلسل' : 'Serial'}</span>
                    <strong>{displaySerial}</strong>
                  </p>
                ) : null}
                {gallery.length > 1 ? (
                  <ul className="stay-desk__thumbs">
                    {gallery.slice(0, 8).map((item, index) => (
                      <li key={item.id}>
                        <button
                          type="button"
                          className={
                            index === activeImage ? 'stay-desk__thumb is-active' : 'stay-desk__thumb'
                          }
                          onClick={() => setActiveImage(index)}
                        >
                          <img
                            src={item.url!}
                            alt=""
                            loading={index === 0 ? 'eager' : 'lazy'}
                            decoding="async"
                          />
                        </button>
                      </li>
                    ))}
                  </ul>
                ) : null}
              </>
            ) : (
              <div className="stay-desk__gallery-empty">
                <BrandMark tone="onDark" />
              </div>
            )}
          </section>

          <header className="stay-desk__titlebar">
            <div>
              <span className="ops-kicker">
                {ar ? 'BHD R · إقامة يومية' : 'BHD R · DAILY STAY'}
                {offersSale ? (ar ? ' · وللبيع' : ' · ALSO FOR SALE') : ''}
              </span>
              <h1>{headline}</h1>
              <BadgeChips
                badges={badges}
                locale={locale}
                labelled
                size={22}
                max={4}
                className="stay-desk__badges"
              />
              {focusedUnitHeadline ? <p className="stay-desk__building">{buildingNameLine}</p> : null}
              <p className="stay-desk__location">{addressLine}</p>
              {property.kind === 'multi_unit' && focusUnitId ? (
                <p className="stay-desk__building-link">
                  <Link href={publicPath}>
                    {ar ? 'عرض المبنى كاملاً وكل وحداته' : 'View full building and all units'}
                  </Link>
                </p>
              ) : null}
            </div>
            <Link
              className="button button--quiet"
              href={`/${locale}/stays${(() => {
                const qs = new URLSearchParams();
                if (stayBooking.checkInOn) qs.set('checkInOn', stayBooking.checkInOn);
                if (stayBooking.checkOutOn) qs.set('checkOutOn', stayBooking.checkOutOn);
                if (stayBooking.adults) qs.set('adults', stayBooking.adults);
                if (stayBooking.children) qs.set('children', stayBooking.children);
                const s = qs.toString();
                return s ? `?${s}` : '';
              })()}`}
            >
              {ar ? 'كل الإقامات' : 'All stays'}
            </Link>
          </header>

          <div className="stay-desk__offer-strip" aria-label={ar ? 'الأسعار' : 'Prices'}>
            {stayNightlyLabel ? (
              <div className="stay-desk__offer">
                <span className="stay-desk__offer-label">{ar ? 'إيجار يومي' : 'Daily stay'}</span>
                <strong dir="ltr">{stayNightlyLabel}</strong>
                <em>{ar ? 'لليلة' : 'per night'}</em>
              </div>
            ) : null}
            {salePriceLabel ? (
              <div className="stay-desk__offer stay-desk__offer--sale">
                <span className="stay-desk__offer-label">{ar ? 'للبيع' : 'For sale'}</span>
                <strong dir="ltr">{salePriceLabel}</strong>
                {saleDeposit ? (
                  <em>
                    {ar ? 'عربون ' : 'Deposit '}
                    <span dir="ltr">{formatMoney(saleDeposit, primaryUnit!.currency, locale)}</span>
                  </em>
                ) : (
                  <em>{ar ? 'سعر البيع' : 'Sale price'}</em>
                )}
              </div>
            ) : null}
            {longTermRentLabel && !offersSale ? (
              <div className="stay-desk__offer">
                <span className="stay-desk__offer-label">{ar ? 'إيجار شهري' : 'Monthly rent'}</span>
                <strong dir="ltr">{longTermRentLabel}</strong>
                <em>{ar ? 'شهرياً' : 'per month'}</em>
              </div>
            ) : null}
          </div>

          <ul className="stay-desk__facts" aria-label={ar ? 'لمحة سريعة' : 'Quick facts'}>
            {(stayBooking.maxGuests ?? stayDetail.maxGuests) != null ? (
              <li>
                <span>{ar ? 'الضيوف' : 'Guests'}</span>
                <strong>{stayBooking.maxGuests ?? stayDetail.maxGuests}</strong>
              </li>
            ) : null}
            {primaryUnit ? (
              <>
                <li>
                  <span>{ar ? 'غرف' : 'Beds'}</span>
                  <strong>{primaryUnit.bedrooms}</strong>
                </li>
                <li>
                  <span>{ar ? 'حمامات' : 'Baths'}</span>
                  <strong>{primaryUnit.bathrooms}</strong>
                </li>
                {primaryUnit.areaSquareMeters ? (
                  <li>
                    <span>{ar ? 'المساحة' : 'Area'}</span>
                    <strong dir="ltr">{primaryUnit.areaSquareMeters} m²</strong>
                  </li>
                ) : null}
              </>
            ) : null}
          </ul>

          {hostSummary ? (
            <HostCard
              host={hostSummary}
              locale={locale}
              ownerName={showPublicOwnerName ? (property.ownerPartyName ?? null) : null}
            />
          ) : null}

          <section className="stay-desk__book" aria-labelledby="stay-desk-book-title">
            <div className="stay-desk__book-head">
              <h2 id="stay-desk-book-title">{ar ? 'اختر تواريخ إقامتك' : 'Choose your dates'}</h2>
              <p className="muted">
                {ar
                  ? 'الأيام الخضراء متاحة. اختر الوصول ثم المغادرة — التفاصيل أدناه اختيارية.'
                  : 'Green days are open. Pick check-in then check-out — details below are optional.'}
              </p>
            </div>
            <StayAvailabilityCalendar
              locale={locale}
              mode="public"
              slug={stayBooking.slug}
              {...(stayBooking.unitId ? { unitId: stayBooking.unitId } : {})}
              size="compact"
              monthCount={1}
              selectedCheckIn={stayCheckInOn}
              selectedCheckOut={stayCheckOutOn}
              onRangeChange={(nextIn, nextOut, halfDay) => {
                setStayCheckInOn(nextIn);
                setStayCheckOutOn(nextOut);
                setStayHalfDay(halfDay ?? null);
              }}
            />
            <div className="stay-desk__book-footer">
              <dl className="stay-desk__book-dates">
                <div>
                  <dt>{ar ? 'الوصول' : 'Check-in'}</dt>
                  <dd dir="ltr">{stayCheckInOn}</dd>
                </div>
                <div>
                  <dt>{ar ? 'المغادرة' : 'Check-out'}</dt>
                  <dd dir="ltr">{stayCheckOutOn}</dd>
                </div>
                {stayHalfDay ? (
                  <div>
                    <dt>{ar ? 'الفترة' : 'Slot'}</dt>
                    <dd>
                      {stayHalfDay === 'day_use'
                        ? ar
                          ? 'صباحية (بدون مبيت)'
                          : 'Morning (day use)'
                        : ar
                          ? 'مسائية (مبيت فقط)'
                          : 'Evening (overnight)'}
                    </dd>
                  </div>
                ) : null}
              </dl>
              <div className="stay-desk__book-actions">
                <Link className="button button--primary stay-desk__cta" href={stayBookHref}>
                  {ar ? 'متابعة الحجز' : 'Continue to book'}
                </Link>
                {saleBookHref ? (
                  <button
                    type="button"
                    className="button button--secondary stay-desk__cta"
                    disabled={busy}
                    onClick={() => goSale()}
                  >
                    {ar ? 'شراء هذه الوحدة' : 'Buy this unit'}
                  </button>
                ) : null}
                {allowViewing ? (
                  <button
                    type="button"
                    className="button button--quiet stay-desk__cta"
                    disabled={busy}
                    onClick={() => void requestViewing()}
                  >
                    {ar ? 'طلب معاينة' : 'Request viewing'}
                  </button>
                ) : null}
              </div>
              {viewingMessage ? (
                <p className="notice notice--success" role="status">
                  {viewingMessage}
                </p>
              ) : null}
              {viewingError ? (
                <p className="notice notice--error" role="alert">
                  {viewingError}
                </p>
              ) : null}
              {!signedIn && (saleBookHref || allowViewing) ? (
                <p className="muted stay-desk__signin-hint">
                  {ar
                    ? 'يلزم تسجيل الدخول للشراء أو طلب المعاينة. حجز الإقامة اليومية متاح مباشرة.'
                    : 'Sign in is required to buy or request a viewing. Daily stay booking is available now.'}
                </p>
              ) : null}
            </div>
          </section>

          <ListingEngagementBar
            listingKey={stayBooking.unitId ?? stayBooking.slug}
            path={stayPath}
            title={headline}
            description={
              ar
                ? property.descriptionAr || property.descriptionEn
                : property.descriptionEn || property.descriptionAr
            }
            locale={locale}
          />

          <div className="stay-desk__more">
            <p className="stay-desk__more-lead muted">
              {ar
                ? 'التفاصيل التالية اختيارية — افتح ما تحتاجه فقط.'
                : 'Everything below is optional — open only what you need.'}
            </p>

            {descriptionBlocks.length ? (
              <details className="stay-desk__panel">
                <summary>{ar ? 'الوصف' : 'Description'}</summary>
                <div className="stay-desk__panel-body">
                  {descriptionBlocks.map((block, index) => (
                    <p key={index}>{block}</p>
                  ))}
                </div>
              </details>
            ) : null}

            <details className="stay-desk__panel">
              <summary>{ar ? 'أسعار الإقامة والسياسات' : 'Stay rates & policies'}</summary>
              <div className="stay-desk__panel-body">
                <StayGuestInfoSection detail={stayDetail} locale={locale} />
              </div>
            </details>

            {property.kind === 'multi_unit' ? (
              <details className="stay-desk__panel">
                <summary>{ar ? 'تفاصيل المبنى' : 'Building details'}</summary>
                <div className="stay-desk__panel-body">
                  <dl className="stay-desk__building-facts">
                    <div>
                      <dt>{ar ? 'اسم المبنى' : 'Building name'}</dt>
                      <dd>{buildingNameLine}</dd>
                    </div>
                    {property.serialNumber ? (
                      <div>
                        <dt>{ar ? 'سيريال المبنى' : 'Building serial'}</dt>
                        <dd dir="ltr">{property.serialNumber}</dd>
                      </div>
                    ) : null}
                    {property.profile?.yearBuilt ? (
                      <div>
                        <dt>{ar ? 'سنة البناء / العمر' : 'Year built / age'}</dt>
                        <dd>
                          {property.profile.yearBuilt}
                          {buildingAgeYears !== null
                            ? ar
                              ? ` · ${buildingAgeYears} سنة`
                              : ` · ${buildingAgeYears} yr`
                            : ''}
                        </dd>
                      </div>
                    ) : null}
                    {totalArea ? (
                      <div>
                        <dt>{ar ? 'المساحة الإجمالية' : 'Total area'}</dt>
                        <dd>{totalArea} m²</dd>
                      </div>
                    ) : null}
                    <div>
                      <dt>{ar ? 'إجمالي الوحدات' : 'Total units'}</dt>
                      <dd>{property.units.length}</dd>
                    </div>
                    {unitKindCounts.shop > 0 ? (
                      <div>
                        <dt>{ar ? 'محلات' : 'Shops'}</dt>
                        <dd>{unitKindCounts.shop}</dd>
                      </div>
                    ) : null}
                    {unitKindCounts.showroom > 0 ? (
                      <div>
                        <dt>{ar ? 'معارض' : 'Showrooms'}</dt>
                        <dd>{unitKindCounts.showroom}</dd>
                      </div>
                    ) : null}
                    {unitKindCounts.apartment > 0 ? (
                      <div>
                        <dt>{ar ? 'شقق' : 'Apartments'}</dt>
                        <dd>{unitKindCounts.apartment}</dd>
                      </div>
                    ) : null}
                  </dl>
                </div>
              </details>
            ) : null}

            {property.amenities.length > 0 ? (
              <details className="stay-desk__panel">
                <summary>{ar ? 'المرافق' : 'Amenities'}</summary>
                <div className="stay-desk__panel-body">
                  <ul className="stay-desk__amenities">
                    {property.amenities.map((item) => (
                      <li key={item.id}>
                        <span aria-hidden="true">{AMENITY_ICONS[item.code] ?? '✦'}</span>
                        <em>{(ar ? item.labelAr : item.labelEn) || item.code}</em>
                      </li>
                    ))}
                  </ul>
                </div>
              </details>
            ) : null}

            {mapEmbed || mapsUrl ? (
              <details className="stay-desk__panel">
                <summary>{ar ? 'الموقع على الخريطة' : 'Map location'}</summary>
                <div className="stay-desk__panel-body">
                  {mapEmbed ? (
                    <div className="stay-desk__map">
                      <iframe
                        title={ar ? 'خريطة العقار' : 'Property map'}
                        src={mapEmbed}
                        loading="lazy"
                        referrerPolicy="no-referrer-when-downgrade"
                      />
                    </div>
                  ) : null}
                  {mapsUrl ? (
                    <p>
                      <a href={mapsUrl} target="_blank" rel="noreferrer" dir="ltr">
                        {ar ? 'فتح في خرائط Google' : 'Open in Google Maps'}
                      </a>
                    </p>
                  ) : null}
                </div>
              </details>
            ) : null}

            <details className="stay-desk__panel">
              <summary>{ar ? 'تقييمات الضيوف' : 'Guest reviews'}</summary>
              <div className="stay-desk__panel-body">
                <ReputationView
                  subject={reviewedUnitId ? 'unit' : 'property'}
                  subjectKey={reviewedUnitId ?? property.id}
                  locale={locale}
                  hostKey={property.organizationId ?? null}
                />
              </div>
            </details>

            <details className="stay-desk__panel">
              <summary>{ar ? 'رمز QR للمشاركة' : 'Share QR'}</summary>
              <div className="stay-desk__panel-body stay-desk__qr">
                <PropertyQrCard
                  path={stayPath}
                  locale={locale}
                  size={132}
                  showUrl={false}
                  labelAr="امسح الرمز لفتح صفحة هذه الإقامة"
                  labelEn="Scan to open this stay page"
                />
              </div>
            </details>
          </div>
        </div>
      </div>
    </div>
  );
}
