'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import type { CurrencyCode } from '@bhd-r/contracts';
import { browserMutation } from '@/lib/api';
import { formatMoney } from '@/lib/format';
import { PropertyQrCard } from '@/components/property-qr-card';

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
  address: {
    countryCode: string;
    governorate: string;
    wilayat: string;
    city: string;
    area: string | null;
    street: string | null;
  } | null;
  units: ManagedUnit[];
  amenities: Array<{ id: string; code: string; labelAr: string | null; labelEn: string | null }>;
  documents: Array<{
    id: string;
    documentType: string;
    documentNumber: string | null;
    verificationStatus: string;
    expiresOn: string | null;
  }>;
  meters: Array<{ id: string; utilityType: string; meterNumber: string }>;
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

function ReadField({ label, value, dir }: { label: string; value: string; dir?: 'ltr' | 'rtl' }) {
  return (
    <div className="property-readonly__item">
      <dt>{label}</dt>
      <dd dir={dir}>{value || '—'}</dd>
    </div>
  );
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
    <div className="form-shell property-manager property-manager--readonly">
      <header className="portal-topbar">
        <div>
          <span className="ops-kicker">BHD R · PROPERTY 360</span>
          <h1>{ar ? property.nameAr : property.nameEn}</h1>
          <p>
            {ar
              ? 'عرض بيانات الأصل فقط — للتعديل اضغط «تعديل العقار».'
              : 'Read-only asset view — use Edit property to make changes.'}
          </p>
        </div>
        <div className="portal-topbar__actions">
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

      <section className="property-identity" aria-label={ar ? 'هوية العقار' : 'Property identity'}>
        <div className="property-identity__meta">
          <dl className="property-identity__grid">
            <div>
              <dt>{ar ? 'الرقم المتسلسل / رقم العقار' : 'Serial / property no.'}</dt>
              <dd dir="ltr">{property.serialNumber ?? '—'}</dd>
            </div>
            <div>
              <dt>{ar ? 'اسم المالك' : 'Owner name'}</dt>
              <dd>{currentOwner?.partyName ?? '—'}</dd>
            </div>
            <div>
              <dt>{ar ? 'عنوان العقار وموقعه' : 'Address & location'}</dt>
              <dd>{addressLine}</dd>
            </div>
            <div>
              <dt>{ar ? 'الحالة' : 'Status'}</dt>
              <dd>{property.status}</dd>
            </div>
          </dl>
        </div>
        <PropertyQrCard
          path={propertyPath}
          locale={locale}
          labelAr="امسح الرمز لفتح صفحة هذا العقار"
          labelEn="Scan to open this property page"
        />
      </section>

      <section className="ops-metrics" aria-label={ar ? 'ملخص العقار' : 'Property summary'}>
        <article>
          <span>{ar ? 'الوحدات' : 'Units'}</span>
          <strong>{property.units.length}</strong>
          <small>{property.kind.replaceAll('_', ' ')}</small>
        </article>
        <article>
          <span>{ar ? 'الوحدات المنشورة' : 'Published units'}</span>
          <strong>{property.units.filter((unit) => unit.listingEnabled).length}</strong>
          <small>
            {ar ? 'تختفي تلقائياً عند الحجز أو التأجير' : 'Auto-hidden when reserved or leased'}
          </small>
        </article>
        <article>
          <span>{ar ? 'الوثائق والعدادات' : 'Documents & meters'}</span>
          <strong>{property.documents.length + property.meters.length}</strong>
          <small>{ar ? 'في سجل الأصل' : 'In the asset register'}</small>
        </article>
        <article className="ops-metric--accent">
          <span>{ar ? 'الحالة' : 'Status'}</span>
          <strong>{property.status}</strong>
          <small>{property.defaultCurrency}</small>
        </article>
      </section>

      <section className="ops-panel">
        <header className="section-heading">
          <div>
            <span className="eyebrow">OWN</span>
            <h2>{ar ? 'سجل الملكية' : 'Ownership history'}</h2>
          </div>
        </header>
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
                      <td>{row.endsOn ? (ar ? 'سابق' : 'Prior') : ar ? 'حالي' : 'Current'}</td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="muted">{ar ? 'لا سجلات ملكية بعد.' : 'No ownership records yet.'}</p>
        )}
      </section>

      <section className="ops-panel">
        <header className="section-heading property-section-heading">
          <div>
            <span className="eyebrow">01</span>
            <h2>{ar ? 'بيانات العقار والعنوان' : 'Property & address'}</h2>
            <p className="muted">
              {ar
                ? 'للقراءة فقط — استخدم زر تعديل العقار لتغيير البيانات.'
                : 'Read-only — use Edit property to change these values.'}
            </p>
          </div>
          {property.status !== 'archived' ? (
            <a className="button button--quiet" href={editHref}>
              {ar ? 'تعديل' : 'Edit'}
            </a>
          ) : null}
        </header>
        <dl className="property-readonly">
          <ReadField label={ar ? 'الاسم العربي' : 'Arabic name'} value={property.nameAr} />
          <ReadField
            label={ar ? 'الاسم الإنجليزي' : 'English name'}
            value={property.nameEn}
            dir="ltr"
          />
          <ReadField label={ar ? 'الفئة' : 'Category'} value={property.category} dir="ltr" />
          <ReadField
            label={ar ? 'المحافظة' : 'Governorate'}
            value={property.address?.governorate ?? ''}
          />
          <ReadField label={ar ? 'الولاية' : 'Wilayat'} value={property.address?.wilayat ?? ''} />
          <ReadField label={ar ? 'المدينة' : 'City'} value={property.address?.city ?? ''} />
          <ReadField label={ar ? 'المنطقة' : 'Area'} value={property.address?.area ?? ''} />
          <ReadField label={ar ? 'الشارع' : 'Street'} value={property.address?.street ?? ''} />
          <ReadField
            label={ar ? 'الوصف العربي' : 'Arabic description'}
            value={property.descriptionAr ?? ''}
          />
          <ReadField
            label={ar ? 'الوصف الإنجليزي' : 'English description'}
            value={property.descriptionEn ?? ''}
            dir="ltr"
          />
        </dl>
      </section>

      <section className="ops-panel">
        <header className="section-heading property-section-heading">
          <div>
            <span className="eyebrow">02</span>
            <h2>{ar ? 'الوحدات والأسعار والإعلانات' : 'Units, pricing & listings'}</h2>
          </div>
          {property.status !== 'archived' ? (
            <a className="button button--quiet" href={editHref}>
              {ar ? 'تعديل' : 'Edit'}
            </a>
          ) : null}
        </header>
        <div className="managed-unit-list">
          {property.units.map((unit) => (
            <article className="managed-unit managed-unit--readonly" key={unit.id}>
              <header>
                <div>
                  <strong>{ar ? unit.nameAr : unit.nameEn}</strong>
                  <small>
                    {unit.code} · {formatMoney(unit.rentMinor, unit.currency, locale)}
                  </small>
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
              <dl className="property-readonly">
                <ReadField label={ar ? 'الرمز' : 'Code'} value={unit.code} dir="ltr" />
                <ReadField label={ar ? 'الطابق' : 'Floor'} value={unit.floor ?? ''} />
                <ReadField label={ar ? 'غرف النوم' : 'Bedrooms'} value={String(unit.bedrooms)} />
                <ReadField label={ar ? 'دورات المياه' : 'Bathrooms'} value={String(unit.bathrooms)} />
                <ReadField
                  label={ar ? 'المساحة م²' : 'Area m²'}
                  value={unit.areaSquareMeters ?? ''}
                  dir="ltr"
                />
                <ReadField
                  label={ar ? 'غرض العرض' : 'Listing purpose'}
                  value={unit.listingPurpose}
                  dir="ltr"
                />
                <ReadField
                  label={ar ? 'الإيجار' : 'Rent'}
                  value={formatMoney(unit.rentMinor, unit.currency, locale)}
                  dir="ltr"
                />
                <ReadField
                  label={ar ? 'سعر البيع' : 'Sale price'}
                  value={
                    unit.salePriceMinor
                      ? formatMoney(unit.salePriceMinor, unit.currency, locale)
                      : '—'
                  }
                  dir="ltr"
                />
                <ReadField
                  label={ar ? 'التأمين' : 'Deposit'}
                  value={
                    unit.depositMinor
                      ? formatMoney(unit.depositMinor, unit.currency, locale)
                      : '—'
                  }
                  dir="ltr"
                />
                <ReadField label={ar ? 'الحالة' : 'Status'} value={unit.status} dir="ltr" />
              </dl>
            </article>
          ))}
        </div>
      </section>

      {(property.amenities.length > 0 ||
        property.documents.length > 0 ||
        property.meters.length > 0) && (
        <section className="ops-panel">
          <header className="section-heading">
            <div>
              <span className="eyebrow">03</span>
              <h2>{ar ? 'المرافق والوثائق والعدادات' : 'Amenities, documents & meters'}</h2>
            </div>
          </header>
          <dl className="property-readonly">
            {property.amenities.length ? (
              <ReadField
                label={ar ? 'المرافق' : 'Amenities'}
                value={property.amenities
                  .map((item) => (ar ? item.labelAr : item.labelEn) || item.code)
                  .join(' · ')}
              />
            ) : null}
            {property.documents.length ? (
              <ReadField
                label={ar ? 'الوثائق' : 'Documents'}
                value={property.documents
                  .map((doc) => `${doc.documentType}${doc.documentNumber ? `: ${doc.documentNumber}` : ''}`)
                  .join(' · ')}
              />
            ) : null}
            {property.meters.length ? (
              <ReadField
                label={ar ? 'العدادات' : 'Meters'}
                value={property.meters
                  .map((meter) => `${meter.utilityType}: ${meter.meterNumber}`)
                  .join(' · ')}
              />
            ) : null}
          </dl>
        </section>
      )}

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
          {property.status === 'archived' ? (ar ? 'استعادة' : 'Restore') : ar ? 'أرشفة' : 'Archive'}
        </button>
      </section>
    </div>
  );
}
