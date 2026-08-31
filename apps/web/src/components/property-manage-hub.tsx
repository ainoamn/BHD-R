'use client';

import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Link } from '@/i18n/navigation';
import { clearBrowserCsrfCache, fetchBrowserCsrfToken } from '@/lib/api';
import { formatMoney } from '@/lib/format';
import type { ManagedProperty } from '@/components/property-detail-manager';

export function PropertyManageHub({
  property,
  locale,
  portal,
  staysEnabled = false,
}: {
  property: ManagedProperty;
  locale: 'ar' | 'en';
  portal: 'owner' | 'developer';
  staysEnabled?: boolean;
}) {
  const router = useRouter();
  const ar = locale === 'ar';
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const base = `/${portal}`;
  const propertyId = encodeURIComponent(property.id);
  const publicPath = `/${locale}/properties/${property.id}`;
  const editHref = `${base}/properties/${property.id}/edit`;
  const staysSetupHref = `${base}/stays/setup?propertyId=${propertyId}`;
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

  async function runLifecycle(action: 'archive' | 'restore' | 'purge') {
    const once = async (csrfToken: string) =>
      fetch(`/api/owner/properties/${encodeURIComponent(property.id)}/lifecycle`, {
        method: 'POST',
        credentials: 'same-origin',
        headers: {
          accept: 'application/json',
          'content-type': 'application/json',
          'x-csrf-token': csrfToken,
        },
        body: JSON.stringify({ action }),
        signal: AbortSignal.timeout(45_000),
      });

    clearBrowserCsrfCache();
    let csrfToken = await fetchBrowserCsrfToken(true);
    let response = await once(csrfToken);
    if (response.status === 403) {
      clearBrowserCsrfCache();
      csrfToken = await fetchBrowserCsrfToken(true);
      response = await once(csrfToken);
    }
    if (!response.ok) {
      const payload = (await response.json().catch(() => null)) as {
        error?: { message?: string; messageAr?: string };
      } | null;
      throw new Error(
        payload?.error?.messageAr ?? payload?.error?.message ?? 'تعذر تنفيذ الإجراء',
      );
    }
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
      await runLifecycle(restoring ? 'restore' : 'archive');
      router.refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'request_failed');
    } finally {
      setBusy(false);
    }
  }

  async function purgePermanently() {
    if (property.status !== 'archived') return;
    if (
      !window.confirm(
        ar
          ? 'حذف نهائي لا يمكن التراجع عنه. يُسمح فقط للعقارات المؤرشفة بلا عقود. هل تريد المتابعة؟'
          : 'Permanent delete cannot be undone. Only archived properties without leases are allowed. Continue?',
      )
    ) {
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await runLifecycle('purge');
      router.push(`${base}/properties`);
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
              <Link href={editHref} prefetch>
                {ar ? 'تعديل من الضبط' : 'Edit in settings'}
              </Link>
            </p>
          ) : null}
        </div>
        <Link className="button button--quiet" href={`${base}/properties`} prefetch scroll={false}>
          {ar ? 'العودة للمحفظة' : 'Back to portfolio'}
        </Link>
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
                {item.href ? (
                  <Link href={item.href} prefetch>
                    {item.text}
                  </Link>
                ) : (
                  item.text
                )}
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
              <Link
                key={action.href}
                className={`button ${'primary' in action && action.primary ? 'button--primary' : 'button--quiet'}`}
                href={action.href}
                prefetch
                scroll={false}
              >
                {action.label}
              </Link>
            ),
          )}
        </div>
        {staysEnabled ? (
          <p className="property-manage-hub__stays-link">
            <Link className="text-link" href={staysSetupHref} prefetch scroll={false}>
              {ar ? 'إعداد الإقامة اليومية' : 'Set up daily stay'}
            </Link>
          </p>
        ) : null}
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

      {property.status === 'archived' ? (
        <section className="ops-panel property-danger-zone">
          <div>
            <h2>{ar ? 'حذف نهائي' : 'Permanent delete'}</h2>
            <p>
              {ar
                ? 'يزيل العقار ووحداته من النظام. غير متاح إن وُجدت عقود أو ملف إقامة يومية.'
                : 'Removes the property and its units. Blocked when lease history or a stay profile exists.'}
            </p>
          </div>
          <button
            className="button button--danger"
            type="button"
            disabled={busy}
            onClick={() => void purgePermanently()}
          >
            {ar ? 'حذف نهائي' : 'Delete permanently'}
          </button>
        </section>
      ) : null}
    </div>
  );
}
