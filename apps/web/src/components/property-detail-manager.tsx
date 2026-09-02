'use client';

import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import type { CurrencyCode } from '@bhd-r/contracts';
import { BrandMark } from '@bhd-r/ui';
import { browserMutation } from '@/lib/api';
import { formatMoney } from '@/lib/format';
import { formatListingLocation } from '@/lib/listing-card-copy';
import { PropertyQrCard } from '@/components/property-qr-card';
import { PublicListingActions } from '@/components/public-listing-actions';
import { PropertyManageHub } from '@/components/property-manage-hub';
import { PropertyReviewScore } from '@/components/property-review-score';
import { ReviewsPanel } from '@/components/reviews-panel';
import { StayGuestInfoSection } from '@/components/stays/stay-guest-info-section';
import { StayReviewsHub } from '@/components/stays/stay-reviews-hub';
import type { StayPublicDetail } from '@bhd-r/contracts';
import { StayAvailabilityCalendar } from '@/components/stays/stay-availability-calendar';
import { googleMapsEmbedSrc } from '@/lib/parse-google-maps-url';
import { listingPurposeCaption, occupancyLabel } from '@/lib/listing-purpose-display';
import type { UnitOccupancy } from '@/lib/listing-purpose-display';
import { resolvePublicGallery } from '@/lib/gallery-scope';
import { generateUnitListingDescriptions } from '@/lib/property-listing-copy';
import {
  assignUnitSerials,
  inferUnitKind,
  summarizeUnitKinds,
  unitKindLabel,
} from '@/lib/unit-identity';
import type { ReviewTargetType } from '@/lib/reviews-types';

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

interface ManagedUnit {
  id: string;
  code: string;
  nameAr: string;
  nameEn: string;
  floor: string | null;
  bedrooms: number;
  bathrooms: number;
  majlis: number;
  halls: number;
  kitchens: number;
  hasPool: boolean;
  areaSquareMeters: string | null;
  rentMinor: string;
  salePriceMinor: string | null;
  depositMinor: string | null;
  currency: CurrencyCode;
  listingPurpose: 'rent' | 'sale' | 'both';
  publishWhenAvailable: boolean;
  listingEnabled: boolean | null;
  listingSlug: string | null;
  status: string;
  /** Public occupancy for multi-unit building boards */
  occupancy?: 'available' | 'reserved' | 'leased' | 'sold';
}

export interface ManagedProperty {
  id: string;
  kind: 'single_unit' | 'multi_unit';
  category: string;
  nameAr: string;
  nameEn: string;
  descriptionAr: string | null;
  descriptionEn: string | null;
  defaultCurrency: CurrencyCode;
  status: string;
  serialNumber?: string | null;
  organizationId?: string;
  ownerPartyId?: string | null;
  ownerPartyName?: string | null;
  /** Public listing may show owner name only when the owner opts in. */
  showOwnerNameOnListing?: boolean;
  mapsUrl?: string | null;
  latitude?: number | null;
  longitude?: number | null;
  profile?: {
    deedNumber?: string | null;
    plotNumber?: string | null;
    municipalityNumber?: string | null;
    landAreaSquareMeters?: string | null;
    builtUpAreaSquareMeters?: string | null;
    yearBuilt?: number | null;
    parkingSpaces?: number | null;
    furnishing?: 'unfurnished' | 'semi_furnished' | 'furnished';
    managementStartedOn?: string | null;
    managementFeeMinor?: string | null;
    showOwnerNameOnListing?: boolean;
    notes?: string | null;
  } | null;
  address: {
    countryCode: string;
    governorate: string;
    wilayat: string;
    city: string;
    area: string | null;
    street: string | null;
  } | null;
  gallery?: Array<{
    id: string;
    url: string | null;
    position: number;
    unitId?: string;
    galleryScope?: 'building' | 'unit' | null;
  }>;
  units: ManagedUnit[];
  amenities: Array<{ id: string; code: string; labelAr: string | null; labelEn: string | null }>;
  documents: Array<{
    id: string;
    documentType: string;
    documentNumber: string | null;
    verificationStatus: string;
    expiresOn: string | null;
    mediaAssetId?: string | null;
    notes?: string | null;
  }>;
  meters: Array<{
    id: string;
    utilityType: string;
    meterNumber: string;
    unitId?: string | null;
  }>;
  ownership: Array<{
    id: string;
    partyId: string;
    role: string;
    shareBasisPoints: number;
    startsOn?: string | null;
    endsOn?: string | null;
    partyName?: string | null;
  }>;
}

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

function mapsUrlFromNotes(notes?: string | null): string | null {
  if (!notes) return null;
  const match = notes.match(/Google Maps:\s*(https?:\/\/\S+)/i);
  return match?.[1]?.replace(/[.,;]+$/, '') ?? null;
}

export function PropertyDetailManager({
  property,
  locale,
  portal,
  variant = 'manage',
  focusUnitId,
  signedIn = false,
  staysEnabled = false,
  stayBooking,
  stayDetail = null,
}: {
  property: ManagedProperty;
  locale: 'ar' | 'en';
  portal: 'owner' | 'developer';
  /** manage = owner console; public = marketing read-only (QR / عرض العقار) */
  variant?: 'manage' | 'public';
  /** When opening from a catalogue unit URL, prefer that unit for price and viewing. */
  focusUnitId?: string;
  /** Whether the visitor has a BHD R session (public CTAs). */
  signedIn?: boolean;
  /** Platform stays flag — quiet setup link only. */
  staysEnabled?: boolean;
  /** Daily-stay booking replaces rent/sale CTAs in the public sidebar. */
  stayBooking?: {
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
  };
  stayDetail?: StayPublicDetail | null;
}) {
  const router = useRouter();
  const ar = locale === 'ar';
  const isPublic = variant === 'public';
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [activeImage, setActiveImage] = useState(0);
  const initialStayIn = stayBooking?.checkInOn ?? defaultStayCheckIn();
  const [stayCheckInOn, setStayCheckInOn] = useState(initialStayIn);
  const [stayCheckOutOn, setStayCheckOutOn] = useState(
    stayBooking?.checkOutOn ?? defaultStayCheckOut(initialStayIn),
  );
  const editHref = `/${locale}/${portal}/properties/${property.id}/edit`;

  const currentOwner =
    [...property.ownership]
      .sort((a, b) => {
        if (!a.endsOn && b.endsOn) return -1;
        if (a.endsOn && !b.endsOn) return 1;
        return 0;
      })
      .find((row) => !row.endsOn) ?? property.ownership[0];

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
  /** QR and «عرض العقار» always open the public listing URL. */
  const propertyPath = focusUnitId
    ? `/${locale}/units/${focusUnitId}`
    : publicPath;
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
    (property.kind === 'multi_unit' && !focusUnitId ? undefined : property.units[0]);
  const unitSerials = useMemo(
    () =>
      assignUnitSerials(
        property.serialNumber,
        [...property.units].sort((a, b) => a.code.localeCompare(b.code)),
      ),
    [property.serialNumber, property.units],
  );
  const unitKindCounts = useMemo(() => summarizeUnitKinds(property.units), [property.units]);
  const focusedSerial = primaryUnit ? unitSerials.get(primaryUnit.id) ?? null : null;
  const displaySerial =
    focusUnitId && focusedSerial ? focusedSerial : property.serialNumber ?? null;
  const focusedUnitKind = primaryUnit ? inferUnitKind(primaryUnit) : null;
  const focusedUnitHeadline =
    focusUnitId && primaryUnit && focusedUnitKind
      ? `${unitKindLabel(focusedUnitKind, locale)} ${primaryUnit.code}`.trim()
      : null;
  const buildingNameLine = ar ? property.nameAr : property.nameEn;
  const showPublicOwnerName =
    Boolean(property.showOwnerNameOnListing ?? property.profile?.showOwnerNameOnListing) &&
    Boolean(property.ownerPartyName);
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
  const headline = stayBooking?.title
    ? stayBooking.title
    : focusedUnitHeadline
      ? focusedUnitHeadline
      : ar
        ? property.nameAr
        : property.nameEn;
  const mapsUrl = property.mapsUrl || mapsUrlFromNotes(property.profile?.notes) || null;
  const reviewTargets = useMemo(() => {
    if (!isPublic) return [];
    const targets: Array<{
      type: ReviewTargetType;
      id: string;
      titleAr: string;
      titleEn: string;
    }> = [{ type: 'property', id: property.id, titleAr: 'العقار', titleEn: 'Property' }];
    if (property.ownerPartyId && property.ownerPartyName) {
      targets.push({
        type: 'party',
        id: property.ownerPartyId,
        titleAr: `المالك · ${property.ownerPartyName}`,
        titleEn: `Owner · ${property.ownerPartyName}`,
      });
    }
    if (property.organizationId) {
      targets.push({
        type: 'organization',
        id: property.organizationId,
        titleAr: 'المؤسسة',
        titleEn: 'Organization',
      });
    }
    return targets;
  }, [isPublic, property]);
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

  const priceLabel = (() => {
    if (primaryUnit) {
      return primaryUnit.listingPurpose === 'sale' && primaryUnit.salePriceMinor
        ? formatMoney(primaryUnit.salePriceMinor, primaryUnit.currency, locale)
        : formatMoney(primaryUnit.rentMinor, primaryUnit.currency, locale);
    }
    if (property.kind === 'multi_unit' && property.units.length) {
      const priced = property.units
        .map((unit) => {
          const minor =
            unit.listingPurpose === 'sale' && unit.salePriceMinor
              ? BigInt(unit.salePriceMinor)
              : BigInt(unit.rentMinor);
          return { unit, minor };
        })
        .sort((a, b) => (a.minor < b.minor ? -1 : a.minor > b.minor ? 1 : 0));
      const cheapest = priced[0];
      if (!cheapest) return '—';
      return cheapest.unit.listingPurpose === 'sale' && cheapest.unit.salePriceMinor
        ? formatMoney(cheapest.unit.salePriceMinor, cheapest.unit.currency, locale)
        : formatMoney(cheapest.unit.rentMinor, cheapest.unit.currency, locale);
    }
    return '—';
  })();
  const priceSuffix =
    primaryUnit?.listingPurpose === 'sale' ||
    (!primaryUnit &&
      property.units.some((unit) => unit.listingPurpose === 'sale' && unit.salePriceMinor))
      ? ar
        ? 'سعر البيع'
        : 'Sale price'
      : ar
        ? 'شهرياً'
        : '/ month';

  if (!isPublic) {
    return <PropertyManageHub property={property} locale={locale} portal={portal} staysEnabled={staysEnabled} />;
  }

  async function archiveOrRestore() {
    const restoring = property.status === 'archived';
    if (
      !restoring &&
      !window.confirm(
        ar
          ? 'هل تريد أرشفة العقار وإيقاف كل إعلاناته؟'
          : 'Archive the property and unpublish every listing?',
      )
    ) {
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await browserMutation(
        `/v1/portfolio/properties/${property.id}/${restoring ? 'restore' : 'archive'}`,
        { method: 'PATCH', body: '{}' },
      );
      router.refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'request_failed');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="form-shell property-manager property-manager--readonly property-360">
      <div className="property-360__layout">
        <div className="property-360__main">
          <section
            className="property-360__gallery"
            aria-label={ar ? 'معرض الصور' : 'Photo gallery'}
          >
            {gallery.length ? (
              <>
                <div className="property-360__hero-shot">
                  <img src={gallery[Math.min(activeImage, gallery.length - 1)]!.url!} alt="" />
                  <span className="media-watermark" aria-hidden="true">
                    <BrandMark tone="onDark" />
                  </span>
                </div>
                {displaySerial ? (
                  <p className="property-360__serial property-360__serial--gallery" dir="ltr">
                    <span>{ar ? 'الرقم المتسلسل' : 'Serial'}</span>
                    <strong>{displaySerial}</strong>
                  </p>
                ) : null}
                {gallery.length > 1 ? (
                  <ul className="property-360__thumbs">
                    {gallery.slice(0, 8).map((item, index) => (
                      <li key={item.id}>
                        <button
                          type="button"
                          className={
                            index === activeImage
                              ? 'property-360__thumb is-active'
                              : 'property-360__thumb'
                          }
                          onClick={() => setActiveImage(index)}
                        >
                          <img src={item.url!} alt="" />
                        </button>
                      </li>
                    ))}
                  </ul>
                ) : null}
              </>
            ) : (
              <div className="property-360__gallery-empty">
                <strong>{ar ? 'لا صور بعد' : 'No photos yet'}</strong>
                <p>
                  {ar
                    ? 'أضف صوراً من تعديل العقار لعرضها هنا كمعرض حجز.'
                    : 'Add photos from Edit property to show a booking-style gallery here.'}
                </p>
                {displaySerial ? (
                  <p className="property-360__serial property-360__serial--gallery" dir="ltr">
                    <span>{ar ? 'الرقم المتسلسل' : 'Serial'}</span>
                    <strong>{displaySerial}</strong>
                  </p>
                ) : null}
                {property.status !== 'archived' && !isPublic ? (
                  <a className="button button--primary" href={editHref}>
                    {ar ? 'إضافة صور' : 'Add photos'}
                  </a>
                ) : null}
              </div>
            )}
          </section>

          <header className="property-360__titlebar">
            <div>
              <span className="ops-kicker">
                {stayBooking
                  ? ar
                    ? 'BHD R · إقامة يومية'
                    : 'BHD R · DAILY STAY'
                  : isPublic
                    ? 'BHD R · LISTING'
                    : 'BHD R · PROPERTY 360'}
              </span>
              <div className="property-360__title-row">
                <h1>{headline}</h1>
                {isPublic ? (
                  <PropertyReviewScore propertyId={property.id} locale={locale} variant="chip" />
                ) : null}
              </div>
              {focusedUnitHeadline ? (
                <p className="property-360__building-name">{buildingNameLine}</p>
              ) : null}
              <p className="property-360__location">{addressLine}</p>
              {displaySerial ? (
                <p className="property-360__serial" dir="ltr">
                  {displaySerial}
                </p>
              ) : null}
              {property.kind === 'multi_unit' && focusUnitId ? (
                <p className="property-360__building-link">
                  <Link href={publicPath}>
                    {ar ? 'عرض المبنى كاملاً وكل وحداته' : 'View full building and all units'}
                  </Link>
                </p>
              ) : null}
            </div>
            <div className="property-360__titlebar-actions">
              {!isPublic ? (
                <>
                  <a
                    className="button button--quiet"
                    href={publicPath}
                    target="_blank"
                    rel="noreferrer"
                  >
                    {ar ? 'عرض العقار' : 'View listing'}
                  </a>
                  {property.status !== 'archived' ? (
                    <Link className="button button--primary" href={editHref}>
                      {ar ? 'تعديل العقار' : 'Edit property'}
                    </Link>
                  ) : null}
                  <Link className="button button--quiet" href={`/${locale}/${portal}/properties`}>
                    {ar ? 'العودة للمحفظة' : 'Back to portfolio'}
                  </Link>
                </>
              ) : stayBooking ? (
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
              ) : (
                <Link className="button button--quiet" href={`/${locale}/properties`}>
                  {ar ? 'كل العقارات' : 'All listings'}
                </Link>
              )}
            </div>
          </header>

          {error ? (
            <div className="notice notice--error" role="alert">
              {error}
            </div>
          ) : null}

          {(composedUnitDescription || property.descriptionAr || property.descriptionEn) && (
            <section className="property-360__section">
              <h2>{ar ? 'الوصف' : 'Description'}</h2>
              {composedUnitDescription ? (
                <div className="property-360__description property-360__description--composed">
                  {(ar
                    ? composedUnitDescription.descriptionAr
                    : composedUnitDescription.descriptionEn
                  )
                    .split(/\n\n+/)
                    .map((block, index) => (
                      <p key={index}>{block}</p>
                    ))}
                </div>
              ) : (
                <>
                  {property.kind === 'multi_unit' && focusUnitId && primaryUnit ? (
                    <p className="property-360__unit-link-note">
                      {ar
                        ? `هذه الوحدة («${focusedUnitHeadline ?? primaryUnit.code}») مرتبطة بالمبنى «${property.nameAr}».`
                        : `This unit (“${focusedUnitHeadline ?? primaryUnit.code}”) is linked to the building “${property.nameEn}”.`}{' '}
                      <Link href={publicPath}>
                        {ar ? 'عرض المبنى وكل وحداته' : 'View the building and all units'}
                      </Link>
                    </p>
                  ) : null}
                  <p className="property-360__description">
                    {ar
                      ? property.descriptionAr || property.descriptionEn
                      : property.descriptionEn || property.descriptionAr}
                  </p>
                </>
              )}
            </section>
          )}

          {stayBooking ? (
            <section className="property-360__section property-360__stay-calendar">
              <h2>{ar ? 'التوفر — اختر تواريخ إقامتك' : 'Availability — choose your dates'}</h2>
              <p className="muted property-360__stay-calendar-hint">
                {ar
                  ? 'الأيام الخضراء متاحة للحجز. اختر تاريخ الوصول ثم المغادرة.'
                  : 'Green days are available. Pick check-in, then check-out.'}
              </p>
              <StayAvailabilityCalendar
                locale={locale}
                mode="public"
                slug={stayBooking.slug}
                {...(stayBooking.unitId ? { unitId: stayBooking.unitId } : {})}
                size="large"
                monthCount={2}
                selectedCheckIn={stayCheckInOn}
                selectedCheckOut={stayCheckOutOn}
                onRangeChange={(nextIn, nextOut) => {
                  setStayCheckInOn(nextIn);
                  setStayCheckOutOn(nextOut);
                }}
              />
            </section>
          ) : null}

          {property.kind === 'multi_unit' ? (
            <section className="property-360__section">
              <h2>{ar ? 'تفاصيل المبنى' : 'Building details'}</h2>
              <dl className="property-360__building-facts">
                <div>
                  <dt>{ar ? 'اسم المبنى' : 'Building name'}</dt>
                  <dd>{ar ? property.nameAr : property.nameEn}</dd>
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
            </section>
          ) : null}

          {property.amenities.length > 0 ? (
            <section className="property-360__section">
              <h2>{ar ? 'المرافق' : 'Amenities'}</h2>
              <ul className="property-360__amenities">
                {property.amenities.map((item) => (
                  <li key={item.id}>
                    <span aria-hidden="true">{AMENITY_ICONS[item.code] ?? '✦'}</span>
                    <em>{(ar ? item.labelAr : item.labelEn) || item.code}</em>
                  </li>
                ))}
              </ul>
            </section>
          ) : null}

          {mapEmbed ? (
            <section className="property-360__section">
              <h2>{ar ? 'الموقع على الخريطة' : 'Location on map'}</h2>
              <div className="property-360__map">
                <iframe
                  title={ar ? 'خريطة العقار' : 'Property map'}
                  src={mapEmbed}
                  loading="lazy"
                  referrerPolicy="no-referrer-when-downgrade"
                />
              </div>
              {mapsUrl ? (
                <p>
                  <a href={mapsUrl} target="_blank" rel="noreferrer" dir="ltr">
                    {ar ? 'فتح في خرائط Google' : 'Open in Google Maps'}
                  </a>
                </p>
              ) : null}
            </section>
          ) : mapsUrl ? (
            <section className="property-360__section">
              <h2>{ar ? 'الموقع' : 'Location'}</h2>
              <p>
                <a href={mapsUrl} target="_blank" rel="noreferrer" dir="ltr">
                  {mapsUrl}
                </a>
              </p>
            </section>
          ) : null}

          {!stayBooking ? (
          <section className="property-360__section">
            <h2>
              {property.kind === 'multi_unit'
                ? ar
                  ? 'الوحدات داخل المبنى'
                  : 'Units in this building'
                : ar
                  ? 'الوحدات'
                  : 'Units'}
            </h2>
            {property.kind === 'multi_unit' ? (
              <p className="muted property-360__units-intro">
                {ar
                  ? 'اضغط على أي وحدة لعرض التفاصيل — القائمة مطوية افتراضياً لتبقى الصفحة منظمة.'
                  : 'Tap a unit to expand details — collapsed by default for a cleaner page.'}
              </p>
            ) : null}
            <div
              className={
                property.kind === 'multi_unit' && isPublic
                  ? 'property-360__units property-360__units--accordion'
                  : 'property-360__units'
              }
            >
              {property.units.map((unit) => {
                const kind = inferUnitKind(unit);
                const serial = unitSerials.get(unit.id);
                const occupancy = (unit.occupancy ?? 'available') as UnitOccupancy;
                const unitTitle =
                  property.kind === 'multi_unit'
                    ? `${unitKindLabel(kind, locale)} ${unit.code}`.trim()
                    : ar
                      ? unit.nameAr
                      : unit.nameEn;

                const unitBody = (
                  <>
                    <header>
                      <div>
                        <strong>{unitTitle}</strong>
                        {property.kind === 'multi_unit' ? (
                          <small>{buildingNameLine}</small>
                        ) : (
                          <small dir="ltr">{unit.code}</small>
                        )}
                        {serial ? (
                          <small className="property-360__unit-serial" dir="ltr">
                            {serial}
                          </small>
                        ) : null}
                      </div>
                      <div className="property-360__unit-badges">
                        <span
                          className={`status-pill status-pill--${
                            occupancy === 'available'
                              ? 'ready'
                              : occupancy === 'reserved'
                                ? 'warn'
                                : 'muted'
                          }`}
                        >
                          {occupancyLabel(occupancy, locale)}
                        </span>
                        <span
                          className={`status-pill status-pill--${unit.listingEnabled ? 'ready' : 'muted'}`}
                        >
                          {listingPurposeCaption(unit.listingPurpose, locale)}
                        </span>
                      </div>
                    </header>
                    <dl>
                      <div>
                        <dt>
                          <span aria-hidden="true">🛏</span>
                          {ar ? 'غرف' : 'Beds'}
                        </dt>
                        <dd>{unit.bedrooms}</dd>
                      </div>
                      <div>
                        <dt>
                          <span aria-hidden="true">🛁</span>
                          {ar ? 'حمامات' : 'Baths'}
                        </dt>
                        <dd>{unit.bathrooms}</dd>
                      </div>
                      <div>
                        <dt>
                          <span aria-hidden="true">🪑</span>
                          {ar ? 'مجالس' : 'Majlis'}
                        </dt>
                        <dd>{unit.majlis}</dd>
                      </div>
                      <div>
                        <dt>
                          <span aria-hidden="true">🛋</span>
                          {ar ? 'صالات' : 'Halls'}
                        </dt>
                        <dd>{unit.halls}</dd>
                      </div>
                      <div>
                        <dt>
                          <span aria-hidden="true">🍳</span>
                          {ar ? 'مطابخ' : 'Kitchens'}
                        </dt>
                        <dd>{unit.kitchens}</dd>
                      </div>
                      <div>
                        <dt>
                          <span aria-hidden="true">🏊</span>
                          {ar ? 'مسبح' : 'Pool'}
                        </dt>
                        <dd>{unit.hasPool ? (ar ? 'متوفر' : 'Yes') : ar ? 'غير متوفر' : 'No'}</dd>
                      </div>
                      <div>
                        <dt>
                          <span aria-hidden="true">📐</span>
                          {ar ? 'المساحة' : 'Area'}
                        </dt>
                        <dd>{unit.areaSquareMeters ? `${unit.areaSquareMeters} m²` : '—'}</dd>
                      </div>
                      <div>
                        <dt>
                          <span aria-hidden="true">💰</span>
                          {ar ? 'السعر' : 'Price'}
                        </dt>
                        <dd dir="ltr">
                          {unit.listingPurpose === 'both' ? (
                            <>
                              {formatMoney(unit.rentMinor, unit.currency, locale)}
                              <small> {ar ? 'شهري' : 'mo'}</small>
                              {unit.salePriceMinor ? (
                                <>
                                  {' · '}
                                  {formatMoney(unit.salePriceMinor, unit.currency, locale)}
                                  <small> {ar ? 'بيع' : 'sale'}</small>
                                </>
                              ) : null}
                            </>
                          ) : unit.listingPurpose === 'sale' && unit.salePriceMinor
                            ? formatMoney(unit.salePriceMinor, unit.currency, locale)
                            : formatMoney(unit.rentMinor, unit.currency, locale)}
                        </dd>
                      </div>
                    </dl>
                    {isPublic ? (
                      <p className="property-360__unit-actions">
                        <Link
                          className="button button--quiet"
                          href={`/${locale}/units/${unit.id}`}
                        >
                          {ar ? 'عرض هذه الوحدة' : 'View this unit'}
                        </Link>
                      </p>
                    ) : null}
                  </>
                );

                if (property.kind === 'multi_unit' && isPublic) {
                  return (
                    <details
                      key={unit.id}
                      className={
                        focusUnitId && unit.id === focusUnitId
                          ? 'property-360__unit-details property-360__unit-details--focus'
                          : 'property-360__unit-details'
                      }
                    >
                      <summary className="property-360__unit-summary">
                        <span className="property-360__unit-summary-title">{unitTitle}</span>
                        <span className="property-360__unit-summary-meta">
                          {occupancyLabel(occupancy, locale)} ·{' '}
                          {listingPurposeCaption(unit.listingPurpose, locale)}
                        </span>
                      </summary>
                      <article className="property-360__unit">{unitBody}</article>
                    </details>
                  );
                }

                return (
                  <article
                    className={
                      focusUnitId && unit.id === focusUnitId
                        ? 'property-360__unit property-360__unit--focus'
                        : 'property-360__unit'
                    }
                    key={unit.id}
                  >
                    {unitBody}
                  </article>
                );
              })}
            </div>
          </section>
          ) : null}

          {isPublic && stayDetail ? <StayGuestInfoSection detail={stayDetail} locale={locale} /> : null}

          {isPublic && stayBooking ? (
            <StayReviewsHub
              locale={locale}
              signedIn={signedIn}
              propertyId={property.id}
              propertyName={stayBooking.title || (ar ? property.nameAr : property.nameEn)}
            />
          ) : isPublic && reviewTargets.length ? (
            <ReviewsPanel locale={locale} signedIn={signedIn} targets={reviewTargets} />
          ) : null}

          {!isPublic ? (
            <section className="property-360__section property-360__ops">
              <h2>{ar ? 'إدارة التشغيل' : 'Operations'}</h2>
              <p className="muted">
                {ar
                  ? 'انتقل سريعاً إلى العقود والبيع والتأجير والحجوزات والصيانة المرتبطة بهذا الأصل، أو عدّل بيانات العقار.'
                  : 'Jump to contracts, sales, leasing, bookings and maintenance for this asset, or edit property data.'}
              </p>
              <div className="property-360__ops-actions">
                {property.status !== 'archived' ? (
                  <Link className="button button--primary" href={editHref}>
                    {ar ? 'تعديل العقار' : 'Edit property'}
                  </Link>
                ) : null}
                <Link className="button button--quiet" href={`/${locale}/${portal}/contracts`}>
                  {ar ? 'العقود' : 'Contracts'}
                </Link>
                <Link className="button button--quiet" href={`/${locale}/${portal}/leasing`}>
                  {ar ? 'التأجير' : 'Leasing'}
                </Link>
                <Link className="button button--quiet" href={`/${locale}/${portal}/sales`}>
                  {ar ? 'البيع' : 'Sales'}
                </Link>
                <Link className="button button--quiet" href={`/${locale}/${portal}/bookings`}>
                  {ar ? 'الحجوزات' : 'Bookings'}
                </Link>
                <Link className="button button--quiet" href={`/${locale}/${portal}/maintenance`}>
                  {ar ? 'الصيانة' : 'Maintenance'}
                </Link>
                <Link className="button button--quiet" href={`/${locale}/${portal}/invoices`}>
                  {ar ? 'الفواتير' : 'Invoices'}
                </Link>
                <a
                  className="button button--quiet"
                  href={publicPath}
                  target="_blank"
                  rel="noreferrer"
                >
                  {ar ? 'عرض العقار كما يظهر للجمهور' : 'Public listing preview'}
                </a>
              </div>
            </section>
          ) : null}

          {!isPublic && (property.documents.length > 0 || property.meters.length > 0) ? (
            <section className="property-360__section">
              <h2>{ar ? 'المستندات والعدادات' : 'Documents & meters'}</h2>
              {property.documents.length ? (
                <ul className="property-360__docs">
                  {property.documents.map((doc) => (
                    <li key={doc.id}>
                      <strong>{doc.documentType}</strong>
                      <span>{doc.documentNumber ?? '—'}</span>
                      <em>{doc.verificationStatus}</em>
                    </li>
                  ))}
                </ul>
              ) : null}
              {property.meters.length ? (
                <ul className="property-360__meters">
                  {property.meters.map((meter) => (
                    <li key={meter.id}>
                      <strong>{meter.utilityType}</strong>
                      <span dir="ltr">{meter.meterNumber}</span>
                    </li>
                  ))}
                </ul>
              ) : null}
            </section>
          ) : null}

          {!isPublic ? (
            <section className="property-360__section">
              <h2>{ar ? 'سجل الملكية' : 'Ownership history'}</h2>
              {property.ownership.length ? (
                <div className="data-table-wrap">
                  <table className="data-table">
                    <thead>
                      <tr>
                        <th>{ar ? 'الطرف' : 'Party'}</th>
                        <th>{ar ? 'الدور' : 'Role'}</th>
                        <th>{ar ? 'من' : 'From'}</th>
                        <th>{ar ? 'إلى' : 'To'}</th>
                        <th>{ar ? 'الحالة' : 'State'}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {[...property.ownership]
                        .sort((a, b) => {
                          if (!a.endsOn && b.endsOn) return -1;
                          if (a.endsOn && !b.endsOn) return 1;
                          return (b.startsOn ?? '').localeCompare(a.startsOn ?? '');
                        })
                        .map((row) => (
                          <tr key={row.id}>
                            <td>{row.partyName ?? row.partyId.slice(0, 8)}</td>
                            <td>{row.role}</td>
                            <td>{row.startsOn ?? '—'}</td>
                            <td>{row.endsOn ?? '—'}</td>
                            <td>
                              {row.endsOn ? (ar ? 'سابق' : 'Prior') : ar ? 'حالي' : 'Current'}
                            </td>
                          </tr>
                        ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <p className="muted">{ar ? 'لا سجلات ملكية بعد.' : 'No ownership records yet.'}</p>
              )}
            </section>
          ) : null}

          {!isPublic ? (
            <section className="ops-panel property-danger-zone">
              <div>
                <h2>
                  {property.status === 'archived'
                    ? ar
                      ? 'استعادة العقار'
                      : 'Restore property'
                    : ar
                      ? 'أرشفة العقار'
                      : 'Archive property'}
                </h2>
                <p>
                  {property.status === 'archived'
                    ? ar
                      ? 'تعيد الأصل دون إعادة نشر أي وحدة تلقائياً.'
                      : 'Restores the asset without automatically republishing units.'
                    : ar
                      ? 'يتوقف نشر جميع الوحدات، ولا تُحذف السجلات أو الوثائق.'
                      : 'All listings are unpublished; records and documents remain retained.'}
                </p>
              </div>
              <button
                className={`button ${property.status === 'archived' ? 'button--primary' : 'button--danger'}`}
                type="button"
                disabled={busy}
                onClick={() => void archiveOrRestore()}
              >
                {property.status === 'archived'
                  ? ar
                    ? 'استعادة'
                    : 'Restore'
                  : ar
                    ? 'أرشفة'
                    : 'Archive'}
              </button>
            </section>
          ) : null}
        </div>

        <aside className="property-360__summary" aria-label={ar ? 'ملخص السعر' : 'Price summary'}>
          <div className="property-360__summary-card">
            <div className="property-360__qr">
              <PropertyQrCard
                path={propertyPath}
                locale={locale}
                size={isPublic ? 132 : 112}
                showUrl={false}
                labelAr="امسح الرمز لفتح صفحة هذا العقار"
                labelEn="Scan to open this property page"
              />
              {displaySerial ? (
                <p className="property-360__serial property-360__serial--qr" dir="ltr">
                  <span>{ar ? 'الرقم المتسلسل' : 'Serial'}</span>
                  <strong>{displaySerial}</strong>
                </p>
              ) : null}
            </div>
            <p className="property-360__price">
              {stayBooking?.nightlyMinor && stayBooking.currency ? (
                <>
                  <strong dir="ltr">
                    {formatMoney(stayBooking.nightlyMinor, stayBooking.currency, locale)}
                  </strong>
                  <span>{ar ? 'لليلة' : 'per night'}</span>
                </>
              ) : primaryUnit?.listingPurpose === 'both' ? (
                <>
                  {primaryUnit.rentMinor && primaryUnit.rentMinor !== '0' ? (
                    <span className="property-360__price-dual">
                      <strong dir="ltr">
                        {formatMoney(primaryUnit.rentMinor, primaryUnit.currency, locale)}
                      </strong>
                      <span>{ar ? 'شهرياً' : '/ month'}</span>
                    </span>
                  ) : null}
                  {primaryUnit.salePriceMinor ? (
                    <span className="property-360__price-dual">
                      <strong dir="ltr">
                        {formatMoney(primaryUnit.salePriceMinor, primaryUnit.currency, locale)}
                      </strong>
                      <span>{ar ? 'للبيع' : 'For sale'}</span>
                    </span>
                  ) : null}
                </>
              ) : (
                <>
                  <strong dir="ltr">{priceLabel}</strong>
                  <span>
                    {property.kind === 'multi_unit' && !focusUnitId
                      ? ar
                        ? 'من أسعار الوحدات'
                        : 'from unit prices'
                      : priceSuffix}
                  </span>
                </>
              )}
            </p>
            <dl className="property-360__facts">
              {!isPublic ? (
                <div>
                  <dt>{ar ? 'الحالة' : 'Status'}</dt>
                  <dd>{property.status}</dd>
                </div>
              ) : null}
              {stayBooking ? (
                <>
                  {stayBooking.maxGuests != null ? (
                    <div>
                      <dt>{ar ? 'الضيوف' : 'Guests'}</dt>
                      <dd>{stayBooking.maxGuests}</dd>
                    </div>
                  ) : null}
                  <div>
                    <dt>{ar ? 'الغرف' : 'Bedrooms'}</dt>
                    <dd>{primaryUnit?.bedrooms ?? '—'}</dd>
                  </div>
                  <div>
                    <dt>{ar ? 'الحمامات' : 'Bathrooms'}</dt>
                    <dd>{primaryUnit?.bathrooms ?? '—'}</dd>
                  </div>
                  {primaryUnit?.areaSquareMeters ? (
                    <div>
                      <dt>{ar ? 'المساحة' : 'Area'}</dt>
                      <dd>{primaryUnit.areaSquareMeters} m²</dd>
                    </div>
                  ) : totalArea ? (
                    <div>
                      <dt>{ar ? 'المساحة' : 'Area'}</dt>
                      <dd>{totalArea} m²</dd>
                    </div>
                  ) : null}
                </>
              ) : property.kind === 'multi_unit' && !focusUnitId ? (
                <>
                  {property.profile?.yearBuilt ? (
                    <div>
                      <dt>{ar ? 'سنة البناء' : 'Year built'}</dt>
                      <dd>{property.profile.yearBuilt}</dd>
                    </div>
                  ) : null}
                  {totalArea ? (
                    <div>
                      <dt>{ar ? 'المساحة الإجمالية' : 'Total area'}</dt>
                      <dd>{totalArea} m²</dd>
                    </div>
                  ) : null}
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
                  <div>
                    <dt>{ar ? 'الوحدات' : 'Units'}</dt>
                    <dd>{property.units.length}</dd>
                  </div>
                </>
              ) : (
                <>
                  <div>
                    <dt>{ar ? 'الغرف' : 'Bedrooms'}</dt>
                    <dd>{primaryUnit?.bedrooms ?? '—'}</dd>
                  </div>
                  <div>
                    <dt>{ar ? 'الحمامات' : 'Bathrooms'}</dt>
                    <dd>{primaryUnit?.bathrooms ?? '—'}</dd>
                  </div>
                  <div>
                    <dt>{ar ? 'المجالس' : 'Majlis'}</dt>
                    <dd>{primaryUnit?.majlis ?? '—'}</dd>
                  </div>
                  <div>
                    <dt>{ar ? 'الصالات' : 'Halls'}</dt>
                    <dd>{primaryUnit?.halls ?? '—'}</dd>
                  </div>
                  <div>
                    <dt>{ar ? 'المطابخ' : 'Kitchens'}</dt>
                    <dd>{primaryUnit?.kitchens ?? '—'}</dd>
                  </div>
                  <div>
                    <dt>{ar ? 'المسبح' : 'Pool'}</dt>
                    <dd>
                      {primaryUnit
                        ? primaryUnit.hasPool
                          ? ar
                            ? 'متوفر'
                            : 'Yes'
                          : ar
                            ? 'غير متوفر'
                            : 'No'
                        : '—'}
                    </dd>
                  </div>
                  <div>
                    <dt>{ar ? 'الوحدات' : 'Units'}</dt>
                    <dd>{property.units.length}</dd>
                  </div>
                </>
              )}
              {isPublic && showPublicOwnerName && property.ownerPartyId ? (
                <div>
                  <dt>{ar ? 'المالك' : 'Owner'}</dt>
                  <dd>
                    <a href={`/${locale}/parties/${property.ownerPartyId}`}>
                      {property.ownerPartyName}
                    </a>
                  </dd>
                </div>
              ) : !isPublic ? (
                <div>
                  <dt>{ar ? 'المالك' : 'Owner'}</dt>
                  <dd>{currentOwner?.partyName ?? '—'}</dd>
                </div>
              ) : null}
              <div>
                <dt>{ar ? 'الفئة' : 'Category'}</dt>
                <dd>
                  {property.kind === 'multi_unit' && focusUnitId && primaryUnit
                    ? unitKindLabel(inferUnitKind(primaryUnit), locale)
                    : property.kind === 'multi_unit'
                      ? ar
                        ? 'مبنى متعدد الوحدات'
                        : 'Multi-unit building'
                      : property.category}
                </dd>
              </div>
            </dl>
            {!isPublic ? (
              <>
                <a
                  className="button button--quiet property-360__summary-cta"
                  href={publicPath}
                  target="_blank"
                  rel="noreferrer"
                >
                  {ar ? 'عرض العقار' : 'View listing'}
                </a>
                {property.status !== 'archived' ? (
                  <a className="button button--primary property-360__summary-cta" href={editHref}>
                    {ar ? 'تعديل العقار' : 'Edit property'}
                  </a>
                ) : null}
              </>
            ) : stayBooking ? (
              <div className="property-360__viewing property-360__viewing--stay">
                <section className="stays-book-cta" aria-labelledby="stays-book-cta-title">
                  <h2 id="stays-book-cta-title">{ar ? 'احجز هذه الإقامة' : 'Book this stay'}</h2>
                  <dl className="stays-checkout__summary stays-checkout__summary--inline">
                    <div>
                      <dt>{ar ? 'الوصول' : 'Check-in'}</dt>
                      <dd dir="ltr">{stayCheckInOn}</dd>
                    </div>
                    <div>
                      <dt>{ar ? 'المغادرة' : 'Check-out'}</dt>
                      <dd dir="ltr">{stayCheckOutOn}</dd>
                    </div>
                  </dl>
                  <p className="muted stays-checkout__hint">
                    {ar
                      ? 'اختر التواريخ من التقويم ثم افتح صفحة الحجز لإكمال التأكيد والدفع.'
                      : 'Pick dates on the calendar, then open the booking page to confirm and pay.'}
                  </p>
                  <Link
                    className="button button--primary property-360__summary-cta"
                    href={`/${locale}/stays/${encodeURIComponent(stayBooking.slug)}/book?${new URLSearchParams(
                      {
                        checkInOn: stayCheckInOn,
                        checkOutOn: stayCheckOutOn,
                        ...(stayBooking.unitId ? { unit: stayBooking.unitId } : {}),
                        ...(stayBooking.adults ? { adults: stayBooking.adults } : {}),
                        ...(stayBooking.children ? { children: stayBooking.children } : {}),
                      },
                    ).toString()}`}
                  >
                    {ar ? 'متابعة الحجز' : 'Continue to book'}
                  </Link>
                </section>
              </div>
            ) : primaryUnit ? (
              <div className="property-360__viewing">
                <PublicListingActions
                  unitId={primaryUnit.id}
                  locale={locale}
                  signedIn={signedIn}
                  depositMinor={primaryUnit.depositMinor}
                  currency={primaryUnit.currency}
                  listingPurpose={primaryUnit.listingPurpose}
                  rentMinor={primaryUnit.rentMinor}
                  salePriceMinor={primaryUnit.salePriceMinor}
                  canBook={Boolean(
                    primaryUnit.depositMinor &&
                    primaryUnit.depositMinor !== '0' &&
                    primaryUnit.listingEnabled !== false &&
                    primaryUnit.listingPurpose !== 'sale',
                  )}
                  sharePath={propertyPath}
                  shareTitle={headline}
                  shareDescription={
                    ar
                      ? property.descriptionAr || property.descriptionEn
                      : property.descriptionEn || property.descriptionAr
                  }
                />
              </div>
            ) : null}
          </div>
        </aside>
      </div>
    </div>
  );
}
