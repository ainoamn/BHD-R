'use client';

import { useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import { currencyMinorUnits, type CurrencyCode } from '@bhd-r/contracts';
import { browserMutation } from '@/lib/api';
import { formatMoney, toMinorUnits } from '@/lib/format';

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

function majorAmount(minor: string | null, currency: CurrencyCode): string {
  if (minor === null) return '';
  const places = currencyMinorUnits[currency];
  const digits = minor.padStart(places + 1, '0');
  if (places === 0) return digits;
  return `${digits.slice(0, -places)}.${digits.slice(-places)}`;
}

function value(form: FormData, name: string): string {
  const entry = form.get(name);
  return typeof entry === 'string' ? entry.trim() : '';
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

  async function mutate(path: string, method: 'POST' | 'PATCH', body: unknown = {}) {
    setBusy(true);
    setError(null);
    try {
      await browserMutation(path, { method, body: JSON.stringify(body) });
      router.refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'request_failed');
    } finally {
      setBusy(false);
    }
  }

  async function saveProperty(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    await mutate(`/v1/portfolio/properties/${property.id}`, 'PATCH', {
      category: value(form, 'category'),
      nameAr: value(form, 'nameAr'),
      nameEn: value(form, 'nameEn'),
      descriptionAr: value(form, 'descriptionAr') || null,
      descriptionEn: value(form, 'descriptionEn') || null,
      address: {
        governorate: value(form, 'governorate'),
        wilayat: value(form, 'wilayat'),
        city: value(form, 'city'),
        area: value(form, 'area') || undefined,
        street: value(form, 'street') || undefined,
      },
    });
  }

  async function saveUnit(event: FormEvent<HTMLFormElement>, unit: ManagedUnit) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    await mutate(`/v1/portfolio/units/${unit.id}`, 'PATCH', {
      code: value(form, 'code'),
      nameAr: value(form, 'nameAr'),
      nameEn: value(form, 'nameEn'),
      floor: value(form, 'floor') || undefined,
      bedrooms: Number(value(form, 'bedrooms')),
      bathrooms: Number(value(form, 'bathrooms')),
      areaSquareMeters: value(form, 'areaSquareMeters') || undefined,
      listingPurpose: value(form, 'listingPurpose'),
      rent: {
        amountMinor: toMinorUnits(value(form, 'rent'), unit.currency),
        currency: unit.currency,
      },
      salePrice: value(form, 'salePrice')
        ? {
            amountMinor: toMinorUnits(value(form, 'salePrice'), unit.currency),
            currency: unit.currency,
          }
        : null,
      deposit: value(form, 'deposit')
        ? {
            amountMinor: toMinorUnits(value(form, 'deposit'), unit.currency),
            currency: unit.currency,
          }
        : null,
      status: value(form, 'status'),
    });
  }

  async function addUnit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    await mutate(`/v1/portfolio/properties/${property.id}/units`, 'POST', {
      code: value(form, 'code'),
      nameAr: value(form, 'nameAr'),
      nameEn: value(form, 'nameEn'),
      floor: value(form, 'floor') || undefined,
      bedrooms: Number(value(form, 'bedrooms')),
      bathrooms: Number(value(form, 'bathrooms')),
      areaSquareMeters: value(form, 'areaSquareMeters') || undefined,
      listingPurpose: value(form, 'listingPurpose'),
      rent: {
        amountMinor: toMinorUnits(value(form, 'rent'), property.defaultCurrency),
        currency: property.defaultCurrency,
      },
      salePrice: value(form, 'salePrice')
        ? {
            amountMinor: toMinorUnits(value(form, 'salePrice'), property.defaultCurrency),
            currency: property.defaultCurrency,
          }
        : undefined,
      deposit: value(form, 'deposit')
        ? {
            amountMinor: toMinorUnits(value(form, 'deposit'), property.defaultCurrency),
            currency: property.defaultCurrency,
          }
        : undefined,
      publishWhenAvailable: form.get('publishWhenAvailable') === 'on',
    });
    event.currentTarget.reset();
  }

  return (
    <div className="form-shell property-manager">
      <header className="portal-topbar">
        <div>
          <span className="ops-kicker">BHD R · PROPERTY 360</span>
          <h1>{ar ? property.nameAr : property.nameEn}</h1>
          <p>
            {ar
              ? 'إدارة بيانات الأصل والوحدات والتوفر والإعلانات من سجل واحد.'
              : 'Manage asset data, units, availability and listings from one record.'}
          </p>
        </div>
        <a className="button button--quiet" href={`/${locale}/${portal}/properties`}>
          {ar ? 'العودة للمحفظة' : 'Back to portfolio'}
        </a>
      </header>

      {error ? (
        <div className="notice notice--error" role="alert">
          {error}
        </div>
      ) : null}

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
            <p className="muted">
              {ar
                ? 'المالك الحالي والملاك السابقون بعد نقل الملكية داخل النظام.'
                : 'Current owner and prior owners after in-system ownership transfer.'}
            </p>
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
        <header className="section-heading">
          <div>
            <span className="eyebrow">01</span>
            <h2>{ar ? 'بيانات العقار والعنوان' : 'Property & address'}</h2>
          </div>
        </header>
        <form className="form-grid" onSubmit={(event) => void saveProperty(event)}>
          <label className="field">
            <span>{ar ? 'الاسم العربي' : 'Arabic name'}</span>
            <input className="input" name="nameAr" defaultValue={property.nameAr} required />
          </label>
          <label className="field">
            <span>{ar ? 'الاسم الإنجليزي' : 'English name'}</span>
            <input
              className="input"
              name="nameEn"
              defaultValue={property.nameEn}
              dir="ltr"
              required
            />
          </label>
          <label className="field">
            <span>{ar ? 'الفئة' : 'Category'}</span>
            <select className="select" name="category" defaultValue={property.category}>
              {[
                'apartment',
                'villa',
                'building',
                'office',
                'shop',
                'warehouse',
                'land',
                'other',
              ].map((item) => (
                <option key={item}>{item}</option>
              ))}
            </select>
          </label>
          {['governorate', 'wilayat', 'city', 'area', 'street'].map((field) => (
            <label className="field" key={field}>
              <span>{field.replaceAll('_', ' ')}</span>
              <input
                className="input"
                name={field}
                defaultValue={property.address?.[field as keyof typeof property.address] ?? ''}
                required={['governorate', 'wilayat', 'city'].includes(field)}
              />
            </label>
          ))}
          <label className="field span-2">
            <span>{ar ? 'الوصف العربي' : 'Arabic description'}</span>
            <textarea
              className="textarea"
              name="descriptionAr"
              defaultValue={property.descriptionAr ?? ''}
            />
          </label>
          <label className="field span-2">
            <span>{ar ? 'الوصف الإنجليزي' : 'English description'}</span>
            <textarea
              className="textarea"
              name="descriptionEn"
              defaultValue={property.descriptionEn ?? ''}
              dir="ltr"
            />
          </label>
          <div className="form-actions span-2">
            <span />
            <button
              className="button button--primary"
              type="submit"
              disabled={busy || property.status === 'archived'}
            >
              {busy ? (ar ? 'جارٍ الحفظ…' : 'Saving…') : ar ? 'حفظ التعديلات' : 'Save changes'}
            </button>
          </div>
        </form>
      </section>

      <section className="ops-panel">
        <header className="section-heading">
          <div>
            <span className="eyebrow">02</span>
            <h2>{ar ? 'الوحدات والأسعار والإعلانات' : 'Units, pricing & listings'}</h2>
          </div>
        </header>
        <div className="managed-unit-list">
          {property.units.map((unit) => (
            <form
              className="managed-unit"
              key={unit.id}
              onSubmit={(event) => void saveUnit(event, unit)}
            >
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
              <div className="form-grid">
                <label className="field">
                  <span>{ar ? 'الرمز' : 'Code'}</span>
                  <input className="input" name="code" defaultValue={unit.code} required />
                </label>
                <label className="field">
                  <span>{ar ? 'الاسم العربي' : 'Arabic name'}</span>
                  <input className="input" name="nameAr" defaultValue={unit.nameAr} required />
                </label>
                <label className="field">
                  <span>{ar ? 'الاسم الإنجليزي' : 'English name'}</span>
                  <input className="input" name="nameEn" defaultValue={unit.nameEn} required />
                </label>
                <label className="field">
                  <span>{ar ? 'الطابق' : 'Floor'}</span>
                  <input className="input" name="floor" defaultValue={unit.floor ?? ''} />
                </label>
                <label className="field">
                  <span>{ar ? 'غرف النوم' : 'Bedrooms'}</span>
                  <input
                    className="input"
                    name="bedrooms"
                    type="number"
                    min="0"
                    defaultValue={unit.bedrooms}
                    required
                  />
                </label>
                <label className="field">
                  <span>{ar ? 'دورات المياه' : 'Bathrooms'}</span>
                  <input
                    className="input"
                    name="bathrooms"
                    type="number"
                    min="0"
                    defaultValue={unit.bathrooms}
                    required
                  />
                </label>
                <label className="field">
                  <span>{ar ? 'المساحة م²' : 'Area m²'}</span>
                  <input
                    className="input"
                    name="areaSquareMeters"
                    inputMode="decimal"
                    defaultValue={unit.areaSquareMeters ?? ''}
                  />
                </label>
                <label className="field">
                  <span>{ar ? 'غرض العرض' : 'Listing purpose'}</span>
                  <select
                    className="select"
                    name="listingPurpose"
                    defaultValue={unit.listingPurpose}
                  >
                    <option value="rent">rent</option>
                    <option value="sale">sale</option>
                    <option value="both">both</option>
                  </select>
                </label>
                <label className="field">
                  <span>{ar ? 'الإيجار' : 'Rent'}</span>
                  <input
                    className="input"
                    name="rent"
                    inputMode="decimal"
                    defaultValue={majorAmount(unit.rentMinor, unit.currency)}
                    required
                  />
                </label>
                <label className="field">
                  <span>{ar ? 'سعر البيع' : 'Sale price'}</span>
                  <input
                    className="input"
                    name="salePrice"
                    inputMode="decimal"
                    defaultValue={majorAmount(unit.salePriceMinor, unit.currency)}
                  />
                </label>
                <label className="field">
                  <span>{ar ? 'التأمين' : 'Deposit'}</span>
                  <input
                    className="input"
                    name="deposit"
                    inputMode="decimal"
                    defaultValue={majorAmount(unit.depositMinor, unit.currency)}
                  />
                </label>
                <label className="field">
                  <span>{ar ? 'الحالة' : 'Status'}</span>
                  <select className="select" name="status" defaultValue={unit.status}>
                    <option value="active">active</option>
                    <option value="inactive">inactive</option>
                  </select>
                </label>
              </div>
              <div className="form-actions">
                <button
                  className="button button--quiet"
                  type="button"
                  disabled={busy || unit.status !== 'active' || property.status === 'archived'}
                  onClick={() =>
                    void mutate(`/v1/portfolio/units/${unit.id}/listing`, 'PATCH', {
                      enabled: !unit.listingEnabled,
                    })
                  }
                >
                  {unit.listingEnabled
                    ? ar
                      ? 'إيقاف العرض'
                      : 'Unpublish'
                    : ar
                      ? 'عرض عند التوفر'
                      : 'Publish when available'}
                </button>
                <button
                  className="button button--primary"
                  type="submit"
                  disabled={busy || property.status === 'archived'}
                >
                  {ar ? 'حفظ الوحدة' : 'Save unit'}
                </button>
              </div>
            </form>
          ))}
        </div>
      </section>

      {property.kind === 'multi_unit' && property.status !== 'archived' ? (
        <section className="ops-panel">
          <header className="section-heading">
            <div>
              <span className="eyebrow">03</span>
              <h2>{ar ? 'إضافة وحدة جديدة' : 'Add a new unit'}</h2>
            </div>
          </header>
          <form className="form-grid" onSubmit={(event) => void addUnit(event)}>
            <label className="field">
              <span>{ar ? 'الرمز' : 'Code'}</span>
              <input className="input" name="code" required />
            </label>
            <label className="field">
              <span>{ar ? 'الاسم العربي' : 'Arabic name'}</span>
              <input className="input" name="nameAr" required />
            </label>
            <label className="field">
              <span>{ar ? 'الاسم الإنجليزي' : 'English name'}</span>
              <input className="input" name="nameEn" required />
            </label>
            <label className="field">
              <span>{ar ? 'الطابق' : 'Floor'}</span>
              <input className="input" name="floor" />
            </label>
            <label className="field">
              <span>{ar ? 'غرف النوم' : 'Bedrooms'}</span>
              <input
                className="input"
                name="bedrooms"
                type="number"
                min="0"
                defaultValue="0"
                required
              />
            </label>
            <label className="field">
              <span>{ar ? 'دورات المياه' : 'Bathrooms'}</span>
              <input
                className="input"
                name="bathrooms"
                type="number"
                min="0"
                defaultValue="1"
                required
              />
            </label>
            <label className="field">
              <span>{ar ? 'المساحة م²' : 'Area m²'}</span>
              <input className="input" name="areaSquareMeters" inputMode="decimal" />
            </label>
            <label className="field">
              <span>{ar ? 'غرض العرض' : 'Listing purpose'}</span>
              <select className="select" name="listingPurpose" defaultValue="rent">
                <option value="rent">rent</option>
                <option value="sale">sale</option>
                <option value="both">both</option>
              </select>
            </label>
            <label className="field">
              <span>{ar ? 'الإيجار' : 'Rent'}</span>
              <input className="input" name="rent" inputMode="decimal" defaultValue="0" required />
            </label>
            <label className="field">
              <span>{ar ? 'سعر البيع' : 'Sale price'}</span>
              <input className="input" name="salePrice" inputMode="decimal" />
            </label>
            <label className="field">
              <span>{ar ? 'التأمين' : 'Deposit'}</span>
              <input className="input" name="deposit" inputMode="decimal" />
            </label>
            <label className="checkbox-row">
              <input type="checkbox" name="publishWhenAvailable" />
              {ar ? 'عرض الوحدة عند توفرها' : 'Publish whenever available'}
            </label>
            <div className="form-actions span-2">
              <span />
              <button className="button button--primary" type="submit" disabled={busy}>
                {ar ? 'إضافة الوحدة' : 'Add unit'}
              </button>
            </div>
          </form>
        </section>
      ) : null}

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
          onClick={() => {
            const restoring = property.status === 'archived';
            if (
              !restoring &&
              !window.confirm(
                ar
                  ? 'هل تريد أرشفة العقار وإيقاف كل إعلاناته؟'
                  : 'Archive the property and unpublish every listing?',
              )
            )
              return;
            void mutate(
              `/v1/portfolio/properties/${property.id}/${restoring ? 'restore' : 'archive'}`,
              'PATCH',
            );
          }}
        >
          {property.status === 'archived' ? (ar ? 'استعادة' : 'Restore') : ar ? 'أرشفة' : 'Archive'}
        </button>
      </section>
    </div>
  );
}
