'use client';

import { useMemo, useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import { currencyMinorUnits, type CurrencyCode } from '@bhd-r/contracts';
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
  const [depositDraft, setDepositDraft] = useState(() => {
    const unit = property.units[0];
    if (!unit?.depositMinor) return '';
    const digits = currencyMinorUnits[unit.currency as CurrencyCode] ?? 3;
    const minor = Number(unit.depositMinor);
    return Number.isFinite(minor) ? (minor / 10 ** digits).toFixed(digits) : '';
  });

  const base = `/${locale}/${portal}`;
  const propertyId = encodeURIComponent(property.id);
  const publicPath = `/${locale}/properties/${property.id}`;
  const editHref = `${base}/properties/${property.id}/edit`;
  const scoped = (section: string) => `${base}/${section}?propertyId=${propertyId}`;

  const publishedUnits = property.units.filter((unit) => unit.listingEnabled).length;
  const unpublishedUnits = property.units.length - publishedUnits;
  const alerts = useMemo(() => {
    const items: string[] = [];
    if (property.status === 'archived') {
      items.push(ar ? 'العقار مؤرشف — الإعلانات متوقفة.' : 'Property is archived — listings are off.');
    }
    if (!property.gallery?.length) {
      items.push(ar ? 'لا صور في المعرض بعد.' : 'Gallery has no photos yet.');
    }
    if (unpublishedUnits > 0) {
      items.push(
        ar
          ? `${unpublishedUnits} وحدة غير منشورة للجمهور.`
          : `${unpublishedUnits} unit(s) not published publicly.`,
      );
    }
    const missingDeposit = property.units.filter(
      (unit) => !unit.depositMinor || unit.depositMinor === '0',
    ).length;
    if (missingDeposit > 0) {
      items.push(
        ar
          ? 'حدد مبلغ العربون/الحجز للوحدات حتى يعمل زر الحجز للجمهور.'
          : 'Set a booking deposit on units so the public Book button can charge it.',
      );
    }
    if (!property.address) {
      items.push(ar ? 'عنوان العقار غير مكتمل.' : 'Property address is incomplete.');
    }
    return items;
  }, [ar, property, unpublishedUnits]);

  const primaryUnit = property.units[0];
  const currency = primaryUnit?.currency ?? property.defaultCurrency;

  async function saveDeposit(event: FormEvent) {
    event.preventDefault();
    if (!primaryUnit || property.status === 'archived') return;
    const amount = Number(depositDraft);
    if (!Number.isFinite(amount) || amount < 0) {
      setError(ar ? 'أدخل مبلغ عربون صالحاً.' : 'Enter a valid deposit amount.');
      return;
    }
    const digits = currencyMinorUnits[currency as CurrencyCode] ?? 3;
    const amountMinor = Math.round(amount * 10 ** digits).toString();
    setBusy(true);
    setError(null);
    try {
      const response = await fetch(`/api/owner/properties/${property.id}/deposit`, {
        method: 'PATCH',
        credentials: 'same-origin',
        headers: { 'content-type': 'application/json', accept: 'application/json' },
        body: JSON.stringify({ amountMinor, currency }),
      });
      if (!response.ok) {
        const payload = (await response.json().catch(() => null)) as {
          error?: { message?: string; code?: string };
        } | null;
        throw new Error(payload?.error?.message ?? payload?.error?.code ?? 'save_failed');
      }
      router.refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'save_failed');
    } finally {
      setBusy(false);
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
    { href: editHref, label: ar ? 'تعديل العقار' : 'Edit property', primary: true },
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
              <li key={item}>{item}</li>
            ))}
          </ul>
        ) : (
          <p className="muted">{ar ? 'لا تنبيهات حالياً.' : 'No alerts right now.'}</p>
        )}
      </section>

      {primaryUnit && property.status !== 'archived' ? (
        <section className="property-manage-hub__deposit">
          <h2>{ar ? 'مبلغ العربون / الحجز' : 'Booking deposit'}</h2>
          <p className="muted">
            {ar
              ? 'يُستخدم هذا المبلغ عندما يضغط الزائر «احجز الآن» ويدفع عبر شاشة الدفع.'
              : 'Used when a visitor taps Book now and pays on the checkout screen.'}
          </p>
          <form onSubmit={(event) => void saveDeposit(event)} className="property-manage-hub__deposit-form">
            <label>
              <span>{ar ? `المبلغ (${currency})` : `Amount (${currency})`}</span>
              <input
                className="input"
                inputMode="decimal"
                value={depositDraft}
                onChange={(event) => setDepositDraft(event.target.value)}
                placeholder="0.000"
              />
            </label>
            <button className="button button--primary" type="submit" disabled={busy}>
              {ar ? 'حفظ العربون' : 'Save deposit'}
            </button>
            {primaryUnit.depositMinor ? (
              <p className="muted" dir="ltr">
                {formatMoney(primaryUnit.depositMinor, currency, locale)}
              </p>
            ) : null}
          </form>
        </section>
      ) : null}

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
