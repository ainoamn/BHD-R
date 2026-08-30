'use client';

import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import type { CurrencyCode } from '@bhd-r/contracts';
import { browserMutation } from '@/lib/api';
import { formatMoney } from '@/lib/format';
import { PropertyQrCard } from '@/components/property-qr-card';
import { googleMapsEmbedSrc } from '@/lib/parse-google-maps-url';

interface ManagedUnit {
  id: string;
  code: string;
  nameAr: string;
  nameEn: string;
  floor: string | null;
  bedrooms: number;
  bathrooms: number;
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
}: {
  property: ManagedProperty;
  locale: 'ar' | 'en';
  portal: 'owner' | 'developer';
}) {
  const router = useRouter();
  const ar = locale === 'ar';
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [activeImage, setActiveImage] = useState(0);
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
    ? [
        property.address.street,
        property.address.area,
        property.address.city,
        property.address.wilayat,
        property.address.governorate,
      ]
        .filter(Boolean)
        .join(' · ')
    : '—';

  const propertyPath = `/${locale}/${portal}/properties/${property.id}`;
  const gallery = useMemo(
    () => (property.gallery ?? []).filter((item) => item.url).sort((a, b) => a.position - b.position),
    [property.gallery],
  );
  const primaryUnit = property.units[0];
  const mapsUrl =
    property.mapsUrl || mapsUrlFromNotes(property.profile?.notes) || null;
  const latitude =
    typeof property.latitude === 'number' && Number.isFinite(property.latitude)
      ? property.latitude
      : null;
  const longitude =
    typeof property.longitude === 'number' && Number.isFinite(property.longitude)
      ? property.longitude
      : null;
  const mapEmbed =
    latitude !== null && longitude !== null
      ? googleMapsEmbedSrc(latitude, longitude)
      : null;

  const priceLabel = primaryUnit
    ? primaryUnit.listingPurpose === 'sale' && primaryUnit.salePriceMinor
      ? formatMoney(primaryUnit.salePriceMinor, primaryUnit.currency, locale)
      : formatMoney(primaryUnit.rentMinor, primaryUnit.currency, locale)
    : '—';
  const priceSuffix =
    primaryUnit?.listingPurpose === 'sale'
      ? ar
        ? 'سعر البيع'
        : 'Sale price'
      : ar
        ? 'شهرياً'
        : '/ month';

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
                  <img
                    src={gallery[Math.min(activeImage, gallery.length - 1)]!.url!}
                    alt=""
                  />
                </div>
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
                {property.status !== 'archived' ? (
                  <a className="button button--primary" href={editHref}>
                    {ar ? 'إضافة صور' : 'Add photos'}
                  </a>
                ) : null}
              </div>
            )}
          </section>

          <header className="property-360__titlebar">
            <div>
              <span className="ops-kicker">BHD R · PROPERTY 360</span>
              <h1>{ar ? property.nameAr : property.nameEn}</h1>
              <p className="property-360__location">{addressLine}</p>
              <p className="property-360__serial" dir="ltr">
                {property.serialNumber ?? '—'}
              </p>
            </div>
            <div className="property-360__titlebar-actions">
              {property.status !== 'archived' ? (
                <a className="button button--primary" href={editHref}>
                  {ar ? 'تعديل العقار' : 'Edit property'}
                </a>
              ) : null}
              <a className="button button--quiet" href={`/${locale}/${portal}/properties`}>
                {ar ? 'العودة للمحفظة' : 'Back to portfolio'}
              </a>
            </div>
          </header>

          {error ? (
            <div className="notice notice--error" role="alert">
              {error}
            </div>
          ) : null}

          {(property.descriptionAr || property.descriptionEn) && (
            <section className="property-360__section">
              <h2>{ar ? 'الوصف' : 'Description'}</h2>
              <p className="property-360__description">
                {ar
                  ? property.descriptionAr || property.descriptionEn
                  : property.descriptionEn || property.descriptionAr}
              </p>
            </section>
          )}

          {property.amenities.length > 0 ? (
            <section className="property-360__section">
              <h2>{ar ? 'المرافق' : 'Amenities'}</h2>
              <ul className="property-360__amenities">
                {property.amenities.map((item) => (
                  <li key={item.id}>
                    <span aria-hidden="true">{AMENITY_ICONS[item.code] ?? '✦'}</span>
                    {(ar ? item.labelAr : item.labelEn) || item.code}
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

          <section className="property-360__section">
            <h2>{ar ? 'الوحدات' : 'Units'}</h2>
            <div className="property-360__units">
              {property.units.map((unit) => (
                <article className="property-360__unit" key={unit.id}>
                  <header>
                    <div>
                      <strong>{ar ? unit.nameAr : unit.nameEn}</strong>
                      <small dir="ltr">{unit.code}</small>
                    </div>
                    <span
                      className={`status-pill status-pill--${unit.listingEnabled ? 'ready' : 'muted'}`}
                    >
                      {unit.listingEnabled
                        ? ar
                          ? 'منشور'
                          : 'Published'
                        : ar
                          ? 'غير منشور'
                          : 'Unpublished'}
                    </span>
                  </header>
                  <dl>
                    <div>
                      <dt>{ar ? 'غرف' : 'Beds'}</dt>
                      <dd>{unit.bedrooms}</dd>
                    </div>
                    <div>
                      <dt>{ar ? 'حمامات' : 'Baths'}</dt>
                      <dd>{unit.bathrooms}</dd>
                    </div>
                    <div>
                      <dt>{ar ? 'المساحة' : 'Area'}</dt>
                      <dd>{unit.areaSquareMeters ? `${unit.areaSquareMeters} m²` : '—'}</dd>
                    </div>
                    <div>
                      <dt>{ar ? 'السعر' : 'Price'}</dt>
                      <dd dir="ltr">
                        {unit.listingPurpose === 'sale' && unit.salePriceMinor
                          ? formatMoney(unit.salePriceMinor, unit.currency, locale)
                          : formatMoney(unit.rentMinor, unit.currency, locale)}
                      </dd>
                    </div>
                  </dl>
                </article>
              ))}
            </div>
          </section>

          {property.documents.length > 0 || property.meters.length > 0 ? (
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
        </div>

        <aside className="property-360__summary" aria-label={ar ? 'ملخص السعر' : 'Price summary'}>
          <div className="property-360__summary-card">
            <div className="property-360__qr">
              <PropertyQrCard
                path={propertyPath}
                locale={locale}
                size={112}
                labelAr="امسح الرمز لفتح صفحة هذا العقار"
                labelEn="Scan to open this property page"
              />
            </div>
            <p className="property-360__price">
              <strong dir="ltr">{priceLabel}</strong>
              <span>{priceSuffix}</span>
            </p>
            <dl className="property-360__facts">
              <div>
                <dt>{ar ? 'الحالة' : 'Status'}</dt>
                <dd>{property.status}</dd>
              </div>
              <div>
                <dt>{ar ? 'الغرف' : 'Bedrooms'}</dt>
                <dd>{primaryUnit?.bedrooms ?? '—'}</dd>
              </div>
              <div>
                <dt>{ar ? 'الحمامات' : 'Bathrooms'}</dt>
                <dd>{primaryUnit?.bathrooms ?? '—'}</dd>
              </div>
              <div>
                <dt>{ar ? 'الوحدات' : 'Units'}</dt>
                <dd>{property.units.length}</dd>
              </div>
              <div>
                <dt>{ar ? 'المالك' : 'Owner'}</dt>
                <dd>{currentOwner?.partyName ?? '—'}</dd>
              </div>
              <div>
                <dt>{ar ? 'الفئة' : 'Category'}</dt>
                <dd>{property.category}</dd>
              </div>
            </dl>
            {property.status !== 'archived' ? (
              <a className="button button--primary property-360__summary-cta" href={editHref}>
                {ar ? 'تعديل العقار' : 'Edit property'}
              </a>
            ) : null}
          </div>
        </aside>
      </div>
    </div>
  );
}
