'use client';

import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { browserMutation } from '@/lib/api';
import { formatMoney } from '@/lib/format';
import type { ManagedProperty } from '@/components/property-detail-manager';

export function PropertyManageHub({
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

  const base = `/${locale}/${portal}`;
  const propertyId = encodeURIComponent(property.id);
  const publicPath = `/${locale}/properties/${property.id}`;
  const editHref = `${base}/properties/${property.id}/edit`;
  const scoped = (section: string) => `${base}/${section}?propertyId=${propertyId}`;

  const publishedUnits = property.units.filter((unit) => unit.listingEnabled).length;
  const unpublishedUnits = property.units.length - publishedUnits;
  const primaryUnit = property.units[0];
  const currency = primaryUnit?.currency ?? property.defaultCurrency;
  const depositLabel =
    primaryUnit?.depositMinor && primaryUnit.depositMinor !== '0'
      ? formatMoney(primaryUnit.depositMinor, currency, locale)
      : null;

  const alerts = useMemo(() => {
    const items: Array<{ text: string; href?: string }> = [];
    if (property.status === 'archived') {
      items.push({
        text: ar ? 'العقار مؤرشف — الإعلانات متوقفة.' : 'Property is archived — listings are off.',
      });
    }
    if (!property.gallery?.length) {
      items.push({ text: ar ? 'لا صور في المعرض بعد.' : 'Gallery has no photos yet.' });
    }
    if (unpublishedUnits > 0) {
      items.push({
        text: ar
          ? `${unpublishedUnits} وحدة غير منشورة للجمهور.`
          : `${unpublishedUnits} unit(s) not published publicly.`,
      });
    }
    const missingDeposit = property.units.filter(
      (unit) => !unit.depositMinor || unit.depositMinor === '0',
    ).length;
    if (missingDeposit > 0) {
      items.push({
        text: ar
          ? 'حدّد مبلغ العربون/الحجز من تعديل العقار → الوحدات حتى يعمل زر «احجز الآن».'
          : 'Set the booking deposit under Edit property → Units so Book now works.',
        href: editHref,
      });
    }
    if (!property.address) {
      items.push({ text: ar ? 'عنوان العقار غير مكتمل.' : 'Property address is incomplete.' });
    }
    return items;
  }, [ar, editHref, property, unpublishedUnits]);

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

  const actions = [
    { href: editHref, label: ar ? 'تعديل العقار (الضبط)' : 'Edit property (settings)', primary: true },
    { href: scoped('contracts'), label: ar ? 'العقود' : 'Contracts' },
    { href: scoped('leasing'), label: ar ? 'التأجير' : 'Leasing' },
    { href: scoped('sales'), label: ar ? 'البيع' : 'Sales' },
    { href: scoped('bookings'), label: ar ? 'الحجوزات' : 'Bookings' },
    { href: scoped('maintenance'), label: ar ? 'الصيانة' : 'Maintenance' },
    { href: scoped('invoices'), label: ar ? 'الفواتير' : 'Invoices' },
    {
      href: publicPath,
      label: ar ? 'عرض العقار كما يظهر للجمهور' : 'View public listing',
      external: true,
    },
  ] as const;

  return (
    <div className="form-shell property-manage-hub">
      <header className="property-manage-hub__header">
        <div>
          <span className="ops-kicker">BHD R · {ar ? 'إدارة العقار' : 'PROPERTY OPS'}</span>
          <h1>{ar ? property.nameAr : property.nameEn}</h1>
          <p className="muted" dir="ltr">
            {property.serialNumber ?? property.id}
          </p>
          {depositLabel ? (
            <p className="muted">
              {ar ? 'عربون الحجز:' : 'Booking deposit:'}{' '}
              <strong dir="ltr">{depositLabel}</strong>
              {' · '}
              <a href={editHref}>{ar ? 'تعديل من الضبط' : 'Edit in settings'}</a>
            </p>
          ) : null}
        </div>
        <a className="button button--quiet" href={`${base}/properties`}>
          {ar ? 'العودة للمحفظة' : 'Back to portfolio'}
        </a>
      </header>

      {error ? (
        <div className="notice notice--error" role="alert">
          {error}
        </div>
      ) : null}

      <section className="property-manage-hub__stats" aria-label={ar ? 'إحصائيات' : 'Stats'}>
        <article>
          <span>{ar ? 'الحالة' : 'Status'}</span>
          <strong>{property.status}</strong>
        </article>
        <article>
          <span>{ar ? 'الوحدات' : 'Units'}</span>
          <strong>{property.units.length}</strong>
        </article>
        <article>
          <span>{ar ? 'منشورة' : 'Published'}</span>
          <strong>{publishedUnits}</strong>
        </article>
        <article>
          <span>{ar ? 'الصور' : 'Photos'}</span>
          <strong>{property.gallery?.length ?? 0}</strong>
        </article>
      </section>

      <section className="property-manage-hub__alerts" aria-label={ar ? 'تنبيهات' : 'Alerts'}>
        <h2>{ar ? 'تنبيهات العقار' : 'Property alerts'}</h2>
        {alerts.length ? (
          <ul>
            {alerts.map((item) => (
              <li key={item.text}>
                {item.href ? <a href={item.href}>{item.text}</a> : item.text}
              </li>
            ))}
          </ul>
        ) : (
          <p className="muted">{ar ? 'لا تنبيهات حالياً.' : 'No alerts right now.'}</p>
        )}
      </section>

      <section className="property-manage-hub__actions" aria-label={ar ? 'إجراءات' : 'Actions'}>
        <h2>{ar ? 'إجراءات هذا العقار' : 'Actions for this property'}</h2>
        <div className="property-manage-hub__action-grid">
          {actions.map((action) =>
            'external' in action && action.external ? (
              <a
                key={action.href}
                className="button button--quiet"
                href={action.href}
                target="_blank"
                rel="noreferrer"
              >
                {action.label}
              </a>
            ) : (
              <a
                key={action.href}
                className={`button ${'primary' in action && action.primary ? 'button--primary' : 'button--quiet'}`}
                href={action.href}
              >
                {action.label}
              </a>
            ),
          )}
        </div>
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
          {property.status === 'archived' ? (ar ? 'استعادة' : 'Restore') : ar ? 'أرشفة' : 'Archive'}
        </button>
      </section>
    </div>
  );
}
