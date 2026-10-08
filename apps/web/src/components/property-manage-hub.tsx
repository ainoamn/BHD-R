'use client';

import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import { Link } from '@/i18n/navigation';
import { clearBrowserCsrfCache, fetchBrowserCsrfToken } from '@/lib/api';
import { formatMoney } from '@/lib/format';
import { formatListingLocation } from '@/lib/listing-card-copy';
import { listingPurposeCaption, occupancyLabel } from '@/lib/listing-purpose-display';
import { inferUnitKind, unitKindLabel } from '@/lib/unit-identity';
import { depositForMode } from '@/lib/booking-deposit';
import { offeringModesFromListingPurpose } from '@/lib/unit-offering-modes';
import type { ManagedProperty } from '@/components/property-detail-manager';
import type { PropertyOpsPulse } from '@/lib/property-ops-pulse-neon';

type HubUnit = ManagedProperty['units'][number];

/** Which booking deposits a unit needs: rent (monthly/yearly) and/or purchase. */
function depositNeeds(unit: HubUnit): { rent: boolean; sale: boolean } {
  const modes = unit.offeringModes ?? offeringModesFromListingPurpose(unit.listingPurpose);
  return {
    rent: modes.includes('monthly') || modes.includes('yearly'),
    sale: modes.includes('sale'),
  };
}

function stayStatusLabel(status: string, ar: boolean): string {
  const map: Record<string, [string, string]> = {
    payment_pending: ['بانتظار الدفع', 'Payment pending'],
    request_pending: ['بانتظار الاعتماد', 'Request pending'],
    confirmed: ['مؤكّد', 'Confirmed'],
    pre_arrival: ['قبل الوصول', 'Pre-arrival'],
    checked_in: ['تم الوصول', 'Checked in'],
    checked_out: ['تم المغادرة', 'Checked out'],
    closed: ['مغلق', 'Closed'],
    cancelled: ['ملغى', 'Cancelled'],
    expired: ['منتهي', 'Expired'],
  };
  const pair = map[status];
  return pair ? (ar ? pair[0] : pair[1]) : status;
}

function lifecycleLabel(status: string, ar: boolean): { text: string; tone: string } {
  switch (status) {
    case 'active':
      return { text: ar ? 'نشط' : 'Active', tone: 'ready' };
    case 'draft':
      return { text: ar ? 'مسودة' : 'Draft', tone: 'warn' };
    case 'inactive':
      return { text: ar ? 'غير نشط' : 'Inactive', tone: 'muted' };
    case 'archived':
      return { text: ar ? 'مؤرشف' : 'Archived', tone: 'muted' };
    default:
      return { text: status, tone: 'muted' };
  }
}

function contractStatusLabel(status: string, ar: boolean): string {
  const map: Record<string, [string, string]> = {
    draft: ['مسودة', 'Draft'],
    sent: ['مُرسل للتوقيع', 'Sent'],
    partially_signed: ['موقّع جزئياً', 'Partially signed'],
    signed: ['موقّع', 'Signed'],
    void: ['ملغى', 'Void'],
    terminated: ['منتهي', 'Terminated'],
    active: ['ساري', 'Active'],
    pending_start: ['بانتظار البدء', 'Pending start'],
    ended: ['منتهي', 'Ended'],
    cancelled: ['ملغى', 'Cancelled'],
  };
  const pair = map[status];
  return pair ? (ar ? pair[0] : pair[1]) : status;
}

const CATEGORY_LABELS: Record<string, [string, string]> = {
  apartment: ['شقة', 'Apartment'],
  villa: ['فيلا', 'Villa'],
  building: ['مبنى', 'Building'],
  office: ['مكتب', 'Office'],
  shop: ['محل', 'Shop'],
  warehouse: ['مستودع', 'Warehouse'],
  land: ['أرض', 'Land'],
  other: ['أخرى', 'Other'],
};

const ICON_PATHS = {
  edit: 'M12 20h9M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z',
  eye: 'M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12Zm10 3a3 3 0 1 0 0-6 3 3 0 0 0 0 6Z',
  sun: 'M12 3v2M12 19v2M4.2 4.2l1.4 1.4M18.4 18.4l1.4 1.4M3 12h2M19 12h2M4.2 19.8l1.4-1.4M18.4 5.6l1.4-1.4M12 16a4 4 0 1 0 0-8 4 4 0 0 0 0 8Z',
  calendar:
    'M8 2v4M16 2v4M3 10h18M5 4h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2Z',
  file: 'M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8Zm0 0v6h6M8 13h8M8 17h5',
  scale: 'M12 3v18M7 21h10M5 7h14M5 7l-3 7a3.5 3.5 0 0 0 6 0Zm14 0-3 7a3.5 3.5 0 0 0 6 0Z',
  key: 'M15 7a4 4 0 1 1-3.9 5H3v3h3v3h3v-3h2.1A4 4 0 0 1 15 7Z',
  tag: 'M20.6 13.4 13.4 20.6a2 2 0 0 1-2.8 0L3 13V3h10l7.6 7.6a2 2 0 0 1 0 2.8ZM7.5 7.5h.01',
  wrench:
    'M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.8-3.8a6 6 0 0 1-7.9 7.9l-6.9 6.9a2.1 2.1 0 0 1-3-3l6.9-6.9a6 6 0 0 1 7.9-7.9Z',
  receipt: 'M5 2h14v20l-3-2-2 2-2-2-2 2-2-2-3 2ZM9 7h6M9 11h6M9 15h4',
  chart: 'M3 3v18h18M7 15l4-4 3 3 6-6',
  back: 'M15 18l-6-6 6-6',
  pin: 'M12 22s7-6.2 7-12a7 7 0 1 0-14 0c0 5.8 7 12 7 12Zm0-9a3 3 0 1 0 0-6 3 3 0 0 0 0 6Z',
  home: 'M3 11 12 3l9 8v10a1 1 0 0 1-1 1h-5v-7H9v7H4a1 1 0 0 1-1-1Z',
  check: 'M20 6 9 17l-5-5',
  alert:
    'M12 9v4M12 17h.01M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z',
  image: 'M3 5h18v14H3ZM3 16l5-5 4 4 3-3 6 6M15.5 9.5h.01',
  users:
    'M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8ZM22 21v-2a4 4 0 0 0-3-3.9M16 3.1a4 4 0 0 1 0 7.8',
  globe:
    'M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20ZM2 12h20M12 2a15 15 0 0 1 0 20M12 2a15 15 0 0 0 0 20',
} as const;

type IconName = keyof typeof ICON_PATHS;

function Icon({ name }: { name: IconName }) {
  return (
    <svg
      className="pmh-icon"
      viewBox="0 0 24 24"
      width="18"
      height="18"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d={ICON_PATHS[name]} />
    </svg>
  );
}

function Card({
  title,
  icon,
  link,
  children,
  className,
}: {
  title: string;
  icon: IconName;
  link?: { href: string; label: string } | undefined;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={className ? `pmh-card ${className}` : 'pmh-card'}>
      <header className="pmh-card__head">
        <h2>
          <span className="pmh-card__icon">
            <Icon name={icon} />
          </span>
          {title}
        </h2>
        {link ? (
          <Link className="pmh-card__link" href={link.href} prefetch>
            {link.label}
          </Link>
        ) : null}
      </header>
      {children}
    </section>
  );
}

export function PropertyManageHub({
  property,
  locale,
  portal,
  staysEnabled = false,
  opsPulse,
}: {
  property: ManagedProperty;
  locale: 'ar' | 'en';
  portal: 'owner' | 'developer';
  staysEnabled?: boolean;
  opsPulse?: PropertyOpsPulse | null;
}) {
  const router = useRouter();
  const ar = locale === 'ar';
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const root = rootRef.current;
    const chrome = document.querySelector<HTMLElement>('.portal-chrome');
    if (!root || !chrome) return;
    const apply = () => root.style.setProperty('--pmh-sticky-top', `${chrome.offsetHeight}px`);
    apply();
    const observer = new ResizeObserver(apply);
    observer.observe(chrome);
    return () => observer.disconnect();
  }, []);

  const base = `/${portal}`;
  const propertyId = encodeURIComponent(property.id);
  const publicPath = `/${locale}/properties/${property.id}`;
  const editHref = `${base}/properties/${property.id}/edit`;
  const staysSetupHref = `${base}/stays/setup?propertyId=${propertyId}`;
  const bookingsHref = `${base}/bookings?tab=daily&propertyId=${propertyId}`;
  const scoped = (section: string) => `${base}/${section}?propertyId=${propertyId}`;
  const contractsHref = scoped('contracts');

  const name = ar ? property.nameAr || property.nameEn : property.nameEn || property.nameAr;
  const status = lifecycleLabel(property.status, ar);
  const archived = property.status === 'archived';
  const publishedUnits = property.units.filter((unit) => unit.listingEnabled).length;
  const unpublishedUnits = property.units.length - publishedUnits;
  const primaryUnit = property.units[0];
  const currency = primaryUnit?.currency ?? property.defaultCurrency;
  const primaryNeeds = primaryUnit ? depositNeeds(primaryUnit) : { rent: false, sale: false };
  const depositFacts = (['rent', 'sale'] as const)
    .filter((mode) => primaryNeeds[mode])
    .map((mode) => {
      const amount = primaryUnit
        ? depositForMode(mode, primaryUnit.depositMinor, primaryUnit.saleDepositMinor)
        : null;
      return {
        mode,
        label:
          mode === 'rent'
            ? ar
              ? 'عربون حجز التأجير'
              : 'Rent booking deposit'
            : ar
              ? 'عربون حجز الشراء'
              : 'Purchase booking deposit',
        value: amount ? formatMoney(amount, currency, locale) : null,
      };
    });
  const cover = useMemo(
    () =>
      [...(property.gallery ?? [])].sort((a, b) => a.position - b.position).find((item) => item.url)
        ?.url ?? null,
    [property.gallery],
  );
  const addressLine = property.address
    ? formatListingLocation({
        governorate: property.address.governorate,
        wilayat: property.address.wilayat,
        city: property.address.city,
        area: property.address.area,
        street: property.address.street,
      })
    : '';
  const currentOwner =
    property.ownership.find((row) => !row.endsOn)?.partyName ??
    property.ownerPartyName ??
    property.ownership[0]?.partyName ??
    null;
  const categoryPair = CATEGORY_LABELS[property.category];
  const kindLabel =
    property.kind === 'multi_unit'
      ? ar
        ? 'مبنى متعدد الوحدات'
        : 'Multi-unit building'
      : categoryPair
        ? ar
          ? categoryPair[0]
          : categoryPair[1]
        : property.category;

  const pulse = opsPulse ?? null;
  const liveStayCount =
    pulse?.stayBookings.filter((row) =>
      ['confirmed', 'pre_arrival', 'checked_in', 'payment_pending', 'request_pending'].includes(
        row.status,
      ),
    ).length ?? 0;
  const liveLeaseCount =
    pulse?.leases.filter((row) => ['active', 'pending_start', 'draft'].includes(row.status))
      .length ?? 0;

  const alerts = useMemo(() => {
    const items: Array<{ text: string; href?: string }> = [];
    if (property.status === 'archived') {
      items.push({
        text: ar ? 'العقار مؤرشف — الإعلانات متوقفة.' : 'Property is archived — listings are off.',
      });
    }
    if (!property.gallery?.length) {
      items.push({
        text: ar ? 'لا صور في المعرض بعد.' : 'Gallery has no photos yet.',
        href: editHref,
      });
    }
    if (unpublishedUnits > 0) {
      items.push({
        text: ar
          ? `${unpublishedUnits} وحدة غير منشورة للجمهور.`
          : `${unpublishedUnits} unit(s) not published publicly.`,
        href: editHref,
      });
    }
    const missingDeposit = property.units.filter((unit) => {
      const needs = depositNeeds(unit);
      return (
        (needs.rent && !depositForMode('rent', unit.depositMinor, unit.saleDepositMinor)) ||
        (needs.sale && !depositForMode('sale', unit.depositMinor, unit.saleDepositMinor))
      );
    }).length;
    if (missingDeposit > 0) {
      items.push({
        text: ar
          ? 'حدّد عربون حجز التأجير وعربون حجز الشراء من تعديل العقار ← الوحدات حتى يعمل زر «احجز الآن».'
          : 'Set the rent and purchase booking deposits under Edit property → Units so Book now works.',
        href: editHref,
      });
    }
    if (!property.address) {
      items.push({
        text: ar ? 'عنوان العقار غير مكتمل.' : 'Property address is incomplete.',
        href: editHref,
      });
    }
    if (liveStayCount > 0) {
      items.push({
        text: ar
          ? `${liveStayCount} حجوزات إقامة يومية نشطة أو بانتظار إجراء.`
          : `${liveStayCount} active or pending daily stay booking(s).`,
        href: bookingsHref,
      });
    }
    if ((pulse?.contracts.length ?? 0) > 0) {
      items.push({
        text: ar
          ? `${pulse!.contracts.length} عقود مرتبطة بوحدات هذا العقار.`
          : `${pulse!.contracts.length} contract(s) linked to this property’s units.`,
        href: contractsHref,
      });
    }
    return items;
  }, [ar, bookingsHref, contractsHref, editHref, liveStayCount, property, pulse, unpublishedUnits]);

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
      throw new Error(payload?.error?.messageAr ?? payload?.error?.message ?? 'تعذر تنفيذ الإجراء');
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

  const actions: Array<{
    href: string;
    label: string;
    icon: IconName;
    primary?: boolean;
    external?: boolean;
  }> = [
    ...(!archived
      ? [
          {
            href: editHref,
            label: ar ? 'تعديل العقار' : 'Edit property',
            icon: 'edit' as const,
            primary: true,
          },
        ]
      : []),
    { href: publicPath, label: ar ? 'عرض للجمهور' : 'Public listing', icon: 'eye', external: true },
    ...(staysEnabled
      ? [
          {
            href: staysSetupHref,
            label: ar ? 'الإقامة اليومية' : 'Daily stay',
            icon: 'sun' as const,
          },
        ]
      : []),
    {
      href: bookingsHref,
      label: ar ? 'الحجوزات والمعاينات' : 'Bookings & viewings',
      icon: 'calendar',
    },
    { href: contractsHref, label: ar ? 'العقود' : 'Contracts', icon: 'file' },
    {
      href: `${base}/properties/${property.id}/terms`,
      label: ar ? 'الشروط والأحكام' : 'Terms & conditions',
      icon: 'scale',
    },
    { href: scoped('leasing'), label: ar ? 'التأجير' : 'Leasing', icon: 'key' },
    { href: scoped('sales'), label: ar ? 'البيع' : 'Sales', icon: 'tag' },
    { href: scoped('maintenance'), label: ar ? 'الصيانة' : 'Maintenance', icon: 'wrench' },
    { href: scoped('invoices'), label: ar ? 'الفواتير' : 'Invoices', icon: 'receipt' },
    { href: `${base}/accounting`, label: ar ? 'الحسابات' : 'Accounting', icon: 'chart' },
  ];

  const stats: Array<{ label: string; value: number; icon: IconName; hint?: string }> = [
    {
      label: ar ? 'الوحدات' : 'Units',
      value: property.units.length,
      icon: 'home',
      hint: ar ? `${publishedUnits} منشورة` : `${publishedUnits} published`,
    },
    {
      label: ar ? 'إقامات نشطة' : 'Live stays',
      value: liveStayCount,
      icon: 'calendar',
    },
    {
      label: ar ? 'عقود وإيجارات' : 'Leases',
      value: liveLeaseCount || pulse?.leases.length || 0,
      icon: 'file',
    },
    {
      label: ar ? 'الصور' : 'Photos',
      value: property.gallery?.length ?? 0,
      icon: 'image',
    },
  ];

  const financeRows: Array<{
    label: string;
    rows: Array<{ currency: string; amountMinor: string }>;
  }> = [
    {
      label: ar ? 'محصّل الإقامات اليومية' : 'Daily stay collected',
      rows: pulse?.finance.stayCollectedMinorByCurrency ?? [],
    },
    {
      label: ar ? 'محصّل فواتير الإيجار' : 'Lease invoices collected',
      rows: pulse?.finance.leaseCollectedMinorByCurrency ?? [],
    },
    {
      label: ar ? 'فواتير إيجار مفتوحة' : 'Open lease invoices',
      rows: pulse?.finance.leaseInvoiceOpenMinorByCurrency ?? [],
    },
  ];
  const succeededPayments =
    pulse?.stayPayments.filter((payment) => payment.status === 'succeeded').slice(0, 5) ?? [];
  const sortedUnits = useMemo(
    () => [...property.units].sort((a, b) => a.code.localeCompare(b.code)),
    [property.units],
  );

  return (
    <div className="form-shell property-manage-hub pmh" ref={rootRef}>
      <nav className="pmh-actionbar" aria-label={ar ? 'إجراءات هذا العقار' : 'Property actions'}>
        <Link
          className="pmh-actionbar__back"
          href={`${base}/properties`}
          prefetch
          scroll={false}
          aria-label={ar ? 'العودة للمحفظة' : 'Back to portfolio'}
          title={ar ? 'العودة للمحفظة' : 'Back to portfolio'}
        >
          <Icon name="back" />
        </Link>
        <div className="pmh-actionbar__title">
          <small>{ar ? 'إجراءات هذا العقار' : 'Property actions'}</small>
          <strong>{name}</strong>
        </div>
        <div className="pmh-actionbar__list">
          {actions.map((action) =>
            action.external ? (
              <a
                key={action.href}
                className="pmh-action"
                href={action.href}
                target="_blank"
                rel="noreferrer"
              >
                <Icon name={action.icon} />
                <span>{action.label}</span>
              </a>
            ) : (
              <Link
                key={action.href}
                className={action.primary ? 'pmh-action pmh-action--primary' : 'pmh-action'}
                href={action.href}
                prefetch
                scroll={false}
              >
                <Icon name={action.icon} />
                <span>{action.label}</span>
              </Link>
            ),
          )}
        </div>
      </nav>

      {error ? (
        <div className="notice notice--error" role="alert">
          {error}
        </div>
      ) : null}

      <section className="pmh-hero">
        <div className="pmh-hero__media">
          {cover ? (
            <img src={cover} alt="" decoding="async" fetchPriority="high" />
          ) : (
            <Link className="pmh-hero__media-empty" href={editHref} prefetch>
              <Icon name="image" />
              <span>{ar ? 'أضف صور العقار' : 'Add property photos'}</span>
            </Link>
          )}
        </div>
        <div className="pmh-hero__body">
          <div className="pmh-hero__chips">
            <span className={`pmh-badge pmh-badge--${status.tone}`}>{status.text}</span>
            <span className="pmh-chip">{kindLabel}</span>
            {property.serialNumber ? (
              <span className="pmh-chip pmh-chip--mono" dir="ltr">
                {property.serialNumber}
              </span>
            ) : null}
          </div>
          <h1>{name}</h1>
          {addressLine ? (
            <p className="pmh-hero__address">
              <Icon name="pin" />
              <span>{addressLine}</span>
            </p>
          ) : null}
          <dl className="pmh-hero__facts">
            <div>
              <dt>{ar ? 'المالك' : 'Owner'}</dt>
              <dd>{currentOwner ?? '—'}</dd>
            </div>
            {depositFacts.map((fact) => (
              <div key={fact.mode}>
                <dt>{fact.label}</dt>
                <dd dir={fact.value ? 'ltr' : undefined}>
                  {fact.value ?? (ar ? 'غير محدد' : 'Not set')}
                </dd>
              </div>
            ))}
            {property.profile?.builtUpAreaSquareMeters ? (
              <div>
                <dt>{ar ? 'المساحة' : 'Area'}</dt>
                <dd>{property.profile.builtUpAreaSquareMeters} m²</dd>
              </div>
            ) : null}
            {property.profile?.yearBuilt ? (
              <div>
                <dt>{ar ? 'سنة البناء' : 'Year built'}</dt>
                <dd>{property.profile.yearBuilt}</dd>
              </div>
            ) : null}
          </dl>
        </div>
      </section>

      <section className="pmh-stats" aria-label={ar ? 'إحصائيات' : 'Stats'}>
        {stats.map((stat) => (
          <article key={stat.label}>
            <span className="pmh-stats__icon">
              <Icon name={stat.icon} />
            </span>
            <div>
              <strong>{stat.value}</strong>
              <span>{stat.label}</span>
              {stat.hint ? <small>{stat.hint}</small> : null}
            </div>
          </article>
        ))}
      </section>

      <div className="pmh-grid">
        <div className="pmh-grid__main">
          <Card
            title={ar ? 'الحجوزات اليومية' : 'Daily stay bookings'}
            icon="calendar"
            link={{ href: bookingsHref, label: ar ? 'عرض الكل' : 'View all' }}
          >
            {pulse?.stayBookings.length ? (
              <ul className="pmh-list">
                {pulse.stayBookings.slice(0, 6).map((booking) => (
                  <li key={booking.id}>
                    <Link href={`${base}/stays/bookings/${booking.id}`} prefetch>
                      <div className="pmh-list__main">
                        <strong dir="ltr">{booking.referenceCode}</strong>
                        <span>
                          {booking.guestName ?? '—'} · {booking.unitCode}
                        </span>
                      </div>
                      <div className="pmh-list__meta">
                        <span dir="ltr">
                          {booking.checkInOn} → {booking.checkOutOn}
                        </span>
                        <span className="pmh-list__amount" dir="ltr">
                          {formatMoney(booking.totalMinor, booking.currency, locale)}
                        </span>
                      </div>
                      <span className="pmh-badge">{stayStatusLabel(booking.status, ar)}</span>
                    </Link>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="pmh-empty">
                {ar
                  ? 'لا حجوزات إقامة يومية بعد لهذا العقار.'
                  : 'No daily stay bookings for this property yet.'}
              </p>
            )}
          </Card>

          <Card
            title={ar ? 'العقود والإيجارات' : 'Contracts & leases'}
            icon="file"
            link={{ href: contractsHref, label: ar ? 'كل العقود' : 'All contracts' }}
          >
            {pulse?.contracts.length || pulse?.leases.length ? (
              <ul className="pmh-list">
                {(pulse?.contracts ?? []).slice(0, 5).map((contract) => (
                  <li key={`c-${contract.id}`}>
                    <Link href={`${base}/contracts/${contract.id}`} prefetch>
                      <div className="pmh-list__main">
                        <strong dir="ltr">{contract.reference ?? contract.id.slice(0, 8)}</strong>
                        <span>{contract.unitCode}</span>
                      </div>
                      <span className="pmh-badge">{contractStatusLabel(contract.status, ar)}</span>
                    </Link>
                  </li>
                ))}
                {(pulse?.leases ?? []).slice(0, 5).map((lease) => (
                  <li key={`l-${lease.id}`}>
                    <div className="pmh-list__row">
                      <div className="pmh-list__main">
                        <strong>{lease.unitCode}</strong>
                        <span dir="ltr">
                          {lease.startsOn} → {lease.endsOn}
                        </span>
                      </div>
                      <span className="pmh-list__amount" dir="ltr">
                        {formatMoney(lease.rentMinor, lease.currency, locale)}
                      </span>
                      <span className="pmh-badge">{contractStatusLabel(lease.status, ar)}</span>
                    </div>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="pmh-empty">
                {ar ? 'لا عقود تأجير طويلة مرتبطة بعد.' : 'No long-term lease contracts yet.'}
              </p>
            )}
          </Card>

          <Card
            title={ar ? `الوحدات (${property.units.length})` : `Units (${property.units.length})`}
            icon="home"
            link={
              archived
                ? undefined
                : { href: editHref, label: ar ? 'إدارة الوحدات' : 'Manage units' }
            }
          >
            {sortedUnits.length ? (
              <div className="pmh-units">
                {sortedUnits.map((unit) => {
                  const title =
                    property.kind === 'multi_unit'
                      ? `${unitKindLabel(inferUnitKind(unit), locale)} ${unit.code}`.trim()
                      : (ar ? unit.nameAr : unit.nameEn) || unit.code;
                  const price =
                    unit.listingPurpose === 'sale' && unit.salePriceMinor
                      ? formatMoney(unit.salePriceMinor, unit.currency, locale)
                      : formatMoney(unit.rentMinor, unit.currency, locale);
                  return (
                    <article key={unit.id} className="pmh-unit">
                      <div className="pmh-unit__main">
                        <strong>{title}</strong>
                        <span dir="ltr">{unit.code}</span>
                      </div>
                      <div className="pmh-unit__specs">
                        <span>
                          {unit.bedrooms} {ar ? 'غرف' : 'bd'}
                        </span>
                        <span>
                          {unit.bathrooms} {ar ? 'حمامات' : 'ba'}
                        </span>
                        {unit.areaSquareMeters ? <span>{unit.areaSquareMeters} m²</span> : null}
                      </div>
                      <div className="pmh-unit__price">
                        <strong dir="ltr">{price}</strong>
                        <span>{listingPurposeCaption(unit.listingPurpose, locale)}</span>
                      </div>
                      <div className="pmh-unit__badges">
                        {unit.occupancy ? (
                          <span className="pmh-badge">
                            {occupancyLabel(unit.occupancy, locale)}
                          </span>
                        ) : null}
                        <span
                          className={`pmh-badge pmh-badge--${unit.listingEnabled ? 'ready' : 'muted'}`}
                        >
                          {unit.listingEnabled
                            ? ar
                              ? 'منشورة'
                              : 'Published'
                            : ar
                              ? 'غير منشورة'
                              : 'Unpublished'}
                        </span>
                      </div>
                    </article>
                  );
                })}
              </div>
            ) : (
              <p className="pmh-empty">{ar ? 'لا وحدات بعد.' : 'No units yet.'}</p>
            )}
          </Card>
        </div>

        <aside className="pmh-grid__side">
          <Card
            title={ar ? 'يحتاج انتباهك' : 'Needs attention'}
            icon="alert"
            className={alerts.length ? 'pmh-card--alerts' : 'pmh-card--ok'}
          >
            {alerts.length ? (
              <ul className="pmh-alerts">
                {alerts.map((item) => (
                  <li key={item.text}>
                    {item.href ? (
                      <Link href={item.href} prefetch>
                        {item.text}
                      </Link>
                    ) : (
                      <span>{item.text}</span>
                    )}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="pmh-ok">
                <Icon name="check" />
                {ar ? 'كل شيء جاهز — لا تنبيهات حالياً.' : 'All set — no alerts right now.'}
              </p>
            )}
          </Card>

          <Card
            title={ar ? 'المالية' : 'Finance'}
            icon="chart"
            link={{ href: `${base}/accounting`, label: ar ? 'الحسابات' : 'Accounting' }}
          >
            <dl className="pmh-finance">
              {financeRows.map((row) => (
                <div key={row.label}>
                  <dt>{row.label}</dt>
                  <dd>
                    {row.rows.length
                      ? row.rows.map((amount) => (
                          <span key={amount.currency} dir="ltr">
                            {formatMoney(amount.amountMinor, amount.currency, locale)}
                          </span>
                        ))
                      : '—'}
                  </dd>
                </div>
              ))}
            </dl>
            {succeededPayments.length ? (
              <>
                <h3 className="pmh-subhead">{ar ? 'آخر المدفوعات' : 'Latest payments'}</h3>
                <ul className="pmh-list pmh-list--compact">
                  {succeededPayments.map((payment) => (
                    <li key={payment.id}>
                      <Link href={`${base}/stays/bookings/${payment.bookingId}`} prefetch>
                        <strong dir="ltr">{payment.referenceCode}</strong>
                        <span className="pmh-list__amount" dir="ltr">
                          {formatMoney(payment.amountMinor, payment.currency, locale)}
                        </span>
                      </Link>
                    </li>
                  ))}
                </ul>
              </>
            ) : null}
          </Card>
        </aside>
      </div>

      <section className="pmh-danger" aria-label={ar ? 'إجراءات حساسة' : 'Sensitive actions'}>
        <div className="pmh-danger__row">
          <div>
            <h2>
              {archived
                ? ar
                  ? 'استعادة العقار'
                  : 'Restore property'
                : ar
                  ? 'أرشفة العقار'
                  : 'Archive property'}
            </h2>
            <p>
              {archived
                ? ar
                  ? 'تعيد الأصل دون إعادة نشر أي وحدة تلقائياً.'
                  : 'Restores the asset without automatically republishing units.'
                : ar
                  ? 'يتوقف نشر جميع الوحدات، ولا تُحذف السجلات أو الوثائق.'
                  : 'All listings are unpublished; records and documents remain retained.'}
            </p>
          </div>
          <button
            className={`button ${archived ? 'button--primary' : 'button--danger'}`}
            type="button"
            disabled={busy}
            onClick={() => void archiveOrRestore()}
          >
            {archived ? (ar ? 'استعادة' : 'Restore') : ar ? 'أرشفة' : 'Archive'}
          </button>
        </div>
        {archived ? (
          <div className="pmh-danger__row">
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
          </div>
        ) : null}
      </section>
    </div>
  );
}
