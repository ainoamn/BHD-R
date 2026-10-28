'use client';

import { useEffect, useState } from 'react';
import { Link } from '@/i18n/navigation';
import { formatMoney } from '@/lib/format';
import type { PlatformBillingStats } from '@/lib/platform-admin-neon';
import { SUBSCRIPTION_LABELS } from '@/lib/site-admin-shared';

/** Subscription revenue desk — estimated MRR from catalogue prices × org counts. */
export function PlatformBillingPanel({ locale }: { locale: 'ar' | 'en' }) {
  const ar = locale === 'ar';
  const [data, setData] = useState<PlatformBillingStats | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const response = await fetch('/api/site-admin/billing', {
          credentials: 'same-origin',
          cache: 'no-store',
        });
        if (!response.ok) throw new Error('fail');
        const payload = (await response.json()) as PlatformBillingStats;
        if (!cancelled) setData(payload);
      } catch {
        if (!cancelled) setFailed(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  if (failed) {
    return (
      <p className="platform-admin__error">
        {ar
          ? 'تعذّر تحميل إحصائيات الاشتراك. تحتاج صلاحية الباقات في إدارة الموقع.'
          : 'Could not load billing stats. Plans scope is required.'}
      </p>
    );
  }
  if (!data) {
    return <p className="muted">{ar ? 'جارٍ تحميل الإحصائيات…' : 'Loading stats…'}</p>;
  }

  return (
    <div className="platform-admin-billing">
      <header className="platform-admin__head">
        <div>
          <h1>{ar ? 'إحصائيات الاشتراكات والمدفوعات' : 'Subscription billing stats'}</h1>
          <p>
            {ar
              ? 'تقدير شهري من أسعار الباقات × عدد المنشآت. التحصيل الآلي للاشتراكات لم يُفعَّل بعد — عدّل الحالة من صفحة الاشتراكات.'
              : 'Estimated monthly from plan prices × org counts. Automated SaaS collection is not live yet — edit status on Subscriptions.'}
          </p>
        </div>
        <Link className="button button--quiet" href="/admin/plans" prefetch={false}>
          {ar ? 'إدارة الاشتراكات ←' : 'Manage subscriptions →'}
        </Link>
      </header>

      <div className="platform-admin__cards">
        <article className="platform-admin__card">
          <span>{ar ? 'المنشآت' : 'Organizations'}</span>
          <strong dir="ltr">{data.totals.organizations}</strong>
        </article>
        <article className="platform-admin__card is-money">
          <span>{ar ? 'تقدير شهري (ر.ع)' : 'Est. monthly (OMR)'}</span>
          <strong dir="ltr">{data.totals.estimatedMonthlyOmr}</strong>
        </article>
        <article className="platform-admin__card">
          <span>{ar ? 'تجريبي' : 'Trial'}</span>
          <strong dir="ltr">{data.totals.trial}</strong>
        </article>
        <article className="platform-admin__card">
          <span>{ar ? 'متأخر' : 'Past due'}</span>
          <strong dir="ltr">{data.totals.pastDue}</strong>
        </article>
        <article className="platform-admin__card">
          <span>{ar ? 'موقوف' : 'Suspended'}</span>
          <strong dir="ltr">{data.totals.suspended}</strong>
        </article>
      </div>

      <section className="platform-admin__panel">
        <h2>{ar ? 'حسب الحالة' : 'By status'}</h2>
        <ul className="platform-admin-status-list">
          {(Object.keys(data.byStatus) as Array<keyof typeof data.byStatus>).map((status) => (
            <li key={status}>
              <span className={`pmh-badge pmh-badge--${SUBSCRIPTION_LABELS[status].tone}`}>
                {ar ? SUBSCRIPTION_LABELS[status].ar : SUBSCRIPTION_LABELS[status].en}
              </span>
              <strong dir="ltr">{data.byStatus[status]}</strong>
            </li>
          ))}
        </ul>
      </section>

      <section className="platform-admin__panel">
        <h2>{ar ? 'حسب الباقة' : 'By plan'}</h2>
        <table className="platform-admin-table">
          <thead>
            <tr>
              <th>{ar ? 'الباقة' : 'Plan'}</th>
              <th>{ar ? 'السعر' : 'Price'}</th>
              <th>{ar ? 'منشآت' : 'Orgs'}</th>
              <th>{ar ? 'تقدير شهري' : 'Est. monthly'}</th>
            </tr>
          </thead>
          <tbody>
            {data.plans.map((plan) => (
              <tr key={plan.key}>
                <td>{ar ? plan.nameAr : plan.nameEn}</td>
                <td dir="ltr">
                  {plan.price} /{' '}
                  {plan.period === 'year' ? (ar ? 'سنة' : 'year') : ar ? 'شهر' : 'mo'}
                </td>
                <td dir="ltr">{plan.organizations}</td>
                <td dir="ltr">{formatMoney(plan.estimatedMonthlyMinor, 'OMR', locale)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </div>
  );
}
