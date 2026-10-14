'use client';

import { useEffect, useState } from 'react';
import { browserNextMutation } from '@/lib/api';
import {
  PLAN_KEY_PATTERN,
  PLAN_LIMIT,
  SUBSCRIPTION_LABELS,
  SUBSCRIPTION_STATUSES,
  type AdminOrganization,
  type PlanDefinition,
  type SubscriptionStatus,
} from '@/lib/site-admin-shared';
import { adminDate, adminErrorText, adminGet, type AdminNotice } from './admin-fetch';

type View = { plans: PlanDefinition[]; organizations: AdminOrganization[] };

const LIMIT_FIELDS = [
  ['properties', 'العقارات', 'Properties'],
  ['units', 'الوحدات', 'Units'],
  ['representatives', 'المفوَّضون', 'Team seats'],
  ['storageGb', 'التخزين (GB)', 'Storage (GB)'],
] as const;

const TYPE_LABELS: Record<string, [string, string]> = {
  individual: ['فرد', 'Individual'],
  company: ['شركة / إدارة أملاك', 'Company'],
  developer: ['مطوّر', 'Developer'],
};

/** Plan catalogue (names, prices, limits) and every organization's plan and subscription. */
export function PlansAdmin({ locale }: { locale: 'ar' | 'en' }) {
  const ar = locale === 'ar';
  const [view, setView] = useState<View | null>(null);
  const [plans, setPlans] = useState<PlanDefinition[]>([]);
  const [failed, setFailed] = useState(false);
  const [notice, setNotice] = useState<AdminNotice | null>(null);
  const [busy, setBusy] = useState(false);
  const [filter, setFilter] = useState('');

  useEffect(() => {
    let live = true;
    adminGet<View>('/api/site-admin/plans')
      .then((data) => {
        if (!live) return;
        setView(data);
        setPlans(data.plans);
      })
      .catch(() => live && setFailed(true));
    return () => {
      live = false;
    };
  }, []);

  if (failed) {
    return (
      <p className="notice notice--error" role="alert">
        {ar ? 'تعذّر تحميل الباقات.' : 'Could not load plans.'}
      </p>
    );
  }
  if (!view) return <p className="muted">{ar ? 'جارٍ التحميل…' : 'Loading…'}</p>;

  const usage = new Map<string, number>();
  for (const org of view.organizations) usage.set(org.planKey, (usage.get(org.planKey) ?? 0) + 1);
  const savedKeys = new Set(view.plans.map((plan) => plan.key));

  function patch(index: number, change: Partial<PlanDefinition>) {
    setPlans((list) => list.map((plan, at) => (at === index ? { ...plan, ...change } : plan)));
  }

  async function savePlans() {
    if (plans.some((plan) => !PLAN_KEY_PATTERN.test(plan.key))) {
      setNotice({
        tone: 'error',
        text: ar
          ? 'رمز الباقة: حروف إنجليزية صغيرة وأرقام فقط، يبدأ بحرف.'
          : 'Plan key: lowercase letters and digits, starting with a letter.',
      });
      return;
    }
    setBusy(true);
    try {
      const data = await browserNextMutation<View>('/api/site-admin/plans', {
        method: 'PUT',
        body: JSON.stringify({ plans }),
      });
      setView(data);
      setPlans(data.plans);
      setNotice({ tone: 'success', text: ar ? 'حُفظت الباقات.' : 'Plans saved.' });
    } catch (error) {
      setNotice({
        tone: 'error',
        text: adminErrorText(error, ar, 'تعذّر الحفظ.', 'Could not save.'),
      });
    } finally {
      setBusy(false);
    }
  }

  const q = filter.trim().toLowerCase();
  const organizations = q
    ? view.organizations.filter((org) =>
        `${org.nameAr} ${org.nameEn ?? ''} ${org.contactEmail ?? ''}`.toLowerCase().includes(q),
      )
    : view.organizations;

  return (
    <main className="site-admin site-admin--wide">
      <header className="site-admin__head">
        <div>
          <p className="site-admin__kicker">{ar ? 'إدارة الموقع' : 'Site administration'}</p>
          <h1>{ar ? 'الباقات والاشتراكات' : 'Plans & subscriptions'}</h1>
          <p className="muted">
            {ar
              ? 'حدّد أسعار الباقات وحدودها، ثم اختر باقة كل منشأة وحالة اشتراكها. الاشتراك الموقوف أو الملغى يُبقي البيانات لكنه يمنع إضافة مفوَّضين جدد.'
              : 'Set plan prices and limits, then each organization’s plan and subscription. Suspended or cancelled subscriptions keep their data but cannot add team seats.'}
          </p>
        </div>
      </header>

      {notice ? (
        <p
          className={`notice notice--${notice.tone}`}
          role={notice.tone === 'error' ? 'alert' : 'status'}
        >
          {notice.text}
        </p>
      ) : null}

      <section className="site-admin__section">
        <h2>{ar ? 'الباقات' : 'Plans'}</h2>
        <div className="sa-plans">
          {plans.map((plan, index) => {
            const subscribers = usage.get(plan.key) ?? 0;
            const isNew = !savedKeys.has(plan.key) || index >= view.plans.length;
            return (
              <article key={index} className={`sa-plan${plan.active ? '' : ' is-off'}`}>
                <div className="sa-plan__head">
                  {isNew ? (
                    <input
                      className="sa-input sa-input--key"
                      dir="ltr"
                      value={plan.key}
                      maxLength={24}
                      aria-label={ar ? 'رمز الباقة' : 'Plan key'}
                      onChange={(event) => patch(index, { key: event.target.value.toLowerCase() })}
                    />
                  ) : (
                    <code dir="ltr">{plan.key}</code>
                  )}
                  <span className="muted">
                    {ar
                      ? `${subscribers} منشأة`
                      : `${subscribers} org${subscribers === 1 ? '' : 's'}`}
                  </span>
                </div>
                <label className="sa-field">
                  <span>{ar ? 'الاسم بالعربية' : 'Arabic name'}</span>
                  <input
                    className="sa-input"
                    value={plan.nameAr}
                    maxLength={60}
                    onChange={(event) => patch(index, { nameAr: event.target.value })}
                  />
                </label>
                <label className="sa-field">
                  <span>{ar ? 'الاسم بالإنجليزية' : 'English name'}</span>
                  <input
                    className="sa-input"
                    dir="ltr"
                    value={plan.nameEn}
                    maxLength={60}
                    onChange={(event) => patch(index, { nameEn: event.target.value })}
                  />
                </label>
                <div className="sa-row">
                  <label className="sa-field">
                    <span>{ar ? 'السعر (ر.ع.)' : 'Price (OMR)'}</span>
                    <input
                      className="sa-input"
                      dir="ltr"
                      inputMode="decimal"
                      value={plan.price}
                      onChange={(event) => patch(index, { price: event.target.value })}
                    />
                  </label>
                  <label className="sa-field">
                    <span>{ar ? 'الدورة' : 'Period'}</span>
                    <select
                      className="sa-input"
                      value={plan.period}
                      onChange={(event) =>
                        patch(index, { period: event.target.value === 'year' ? 'year' : 'month' })
                      }
                    >
                      <option value="month">{ar ? 'شهري' : 'Monthly'}</option>
                      <option value="year">{ar ? 'سنوي' : 'Yearly'}</option>
                    </select>
                  </label>
                </div>
                <div className="sa-row">
                  {LIMIT_FIELDS.map(([field, labelAr, labelEn]) => (
                    <label key={field} className="sa-field">
                      <span>{ar ? labelAr : labelEn}</span>
                      <input
                        className="sa-input"
                        dir="ltr"
                        inputMode="numeric"
                        value={String(plan[field])}
                        onChange={(event) =>
                          patch(index, {
                            [field]: Number(event.target.value.replace(/\D/g, '') || 0),
                          })
                        }
                      />
                    </label>
                  ))}
                </div>
                <div className="sa-plan__foot">
                  <label>
                    <input
                      type="checkbox"
                      checked={plan.active}
                      disabled={plan.key === 'starter'}
                      onChange={(event) => patch(index, { active: event.target.checked })}
                    />{' '}
                    {ar ? 'متاحة للاشتراك' : 'Open for subscription'}
                  </label>
                  {plan.key !== 'starter' && !subscribers ? (
                    <button
                      type="button"
                      className="button button--quiet button--small"
                      onClick={() => setPlans((list) => list.filter((_, at) => at !== index))}
                    >
                      {ar ? 'حذف' : 'Remove'}
                    </button>
                  ) : null}
                </div>
              </article>
            );
          })}
        </div>
        <div className="sa-actions">
          {plans.length < PLAN_LIMIT ? (
            <button
              type="button"
              className="button button--quiet"
              onClick={() =>
                setPlans((list) => [
                  ...list,
                  {
                    key: '',
                    nameAr: '',
                    nameEn: '',
                    price: '0.000',
                    period: 'month',
                    properties: 10,
                    units: 50,
                    representatives: 3,
                    storageGb: 10,
                    active: true,
                  },
                ])
              }
            >
              {ar ? '+ باقة جديدة' : '+ New plan'}
            </button>
          ) : null}
          <button
            type="button"
            className="button button--primary"
            disabled={busy}
            onClick={() => void savePlans()}
          >
            {ar ? 'حفظ الباقات' : 'Save plans'}
          </button>
        </div>
      </section>

      <section className="site-admin__section">
        <div className="sa-section-head">
          <h2>
            {ar
              ? `اشتراكات المنشآت (${view.organizations.length})`
              : `Subscriptions (${view.organizations.length})`}
          </h2>
          <input
            className="sa-input sa-input--search"
            type="search"
            value={filter}
            placeholder={ar ? 'بحث بالاسم أو البريد' : 'Search name or email'}
            onChange={(event) => setFilter(event.target.value)}
          />
        </div>
        <ul className="site-admin__list">
          {organizations.map((org) => (
            <OrganizationRow
              key={org.id}
              org={org}
              plans={view.plans}
              locale={locale}
              onSaved={(updated) =>
                setView((current) =>
                  current
                    ? {
                        ...current,
                        organizations: current.organizations.map((row) =>
                          row.id === updated.id ? updated : row,
                        ),
                      }
                    : current,
                )
              }
              onNotice={setNotice}
            />
          ))}
        </ul>
      </section>
    </main>
  );
}

function OrganizationRow({
  org,
  plans,
  locale,
  onSaved,
  onNotice,
}: {
  org: AdminOrganization;
  plans: PlanDefinition[];
  locale: 'ar' | 'en';
  onSaved: (org: AdminOrganization) => void;
  onNotice: (notice: AdminNotice) => void;
}) {
  const ar = locale === 'ar';
  const [planKey, setPlanKey] = useState(org.planKey);
  const [status, setStatus] = useState<SubscriptionStatus>(org.subscription.status);
  const [endsOn, setEndsOn] = useState(org.subscription.endsOn ?? '');
  const [note, setNote] = useState(org.subscription.note ?? '');
  const [busy, setBusy] = useState(false);
  const plan = plans.find((item) => item.key === planKey);
  const dirty =
    planKey !== org.planKey ||
    status !== org.subscription.status ||
    endsOn !== (org.subscription.endsOn ?? '') ||
    note !== (org.subscription.note ?? '');
  const type = TYPE_LABELS[org.type] ?? [org.type, org.type];
  const label = SUBSCRIPTION_LABELS[org.subscription.status];

  async function save() {
    setBusy(true);
    try {
      const data = await browserNextMutation<{ organization: AdminOrganization }>(
        `/api/site-admin/organizations/${encodeURIComponent(org.id)}`,
        {
          method: 'PATCH',
          body: JSON.stringify({
            planKey,
            status,
            endsOn: endsOn || null,
            note: note.trim() || null,
          }),
        },
      );
      onSaved(data.organization);
      onNotice({
        tone: 'success',
        text: ar ? `حُدّث اشتراك «${org.nameAr}».` : `Updated “${org.nameEn || org.nameAr}”.`,
      });
    } catch (error) {
      onNotice({
        tone: 'error',
        text: adminErrorText(error, ar, 'تعذّر الحفظ.', 'Could not save.'),
      });
    } finally {
      setBusy(false);
    }
  }

  const meter = (used: number, limit: number | undefined) =>
    limit ? `${used} / ${limit.toLocaleString('en')}` : String(used);

  return (
    <li className="site-admin__card sa-org">
      <div className="site-admin__card-head">
        <strong>
          <bdi>{ar ? org.nameAr : org.nameEn || org.nameAr}</bdi>
          <small className="muted"> · {ar ? type[0] : type[1]}</small>
        </strong>
        <span className={`pmh-badge pmh-badge--${label.tone}`}>{ar ? label.ar : label.en}</span>
      </div>
      <dl className="site-admin__facts sa-org__facts">
        <div>
          <dt>{ar ? 'التواصل' : 'Contact'}</dt>
          <dd>{org.contactEmail ? <bdi dir="ltr">{org.contactEmail}</bdi> : '—'}</dd>
        </div>
        <div>
          <dt>{ar ? 'العقارات' : 'Properties'}</dt>
          <dd dir="ltr">{meter(org.properties, plan?.properties)}</dd>
        </div>
        <div>
          <dt>{ar ? 'الوحدات' : 'Units'}</dt>
          <dd dir="ltr">{meter(org.units, plan?.units)}</dd>
        </div>
        <div>
          <dt>{ar ? 'الأعضاء' : 'Members'}</dt>
          <dd dir="ltr">{org.members}</dd>
        </div>
        <div>
          <dt>{ar ? 'منذ' : 'Since'}</dt>
          <dd>{adminDate(org.createdAt, ar)}</dd>
        </div>
      </dl>
      <div className="sa-row sa-org__form">
        <label className="sa-field">
          <span>{ar ? 'الباقة' : 'Plan'}</span>
          <select
            className="sa-input"
            value={planKey}
            onChange={(event) => setPlanKey(event.target.value)}
          >
            {plans
              .filter((item) => item.active || item.key === org.planKey)
              .map((item) => (
                <option key={item.key} value={item.key}>
                  {ar ? item.nameAr : item.nameEn} ({item.price})
                </option>
              ))}
          </select>
        </label>
        <label className="sa-field">
          <span>{ar ? 'حالة الاشتراك' : 'Status'}</span>
          <select
            className="sa-input"
            value={status}
            onChange={(event) => setStatus(event.target.value as SubscriptionStatus)}
          >
            {SUBSCRIPTION_STATUSES.map((value) => (
              <option key={value} value={value}>
                {ar ? SUBSCRIPTION_LABELS[value].ar : SUBSCRIPTION_LABELS[value].en}
              </option>
            ))}
          </select>
        </label>
        <label className="sa-field">
          <span>{ar ? 'ينتهي في' : 'Ends on'}</span>
          <input
            className="sa-input"
            type="date"
            dir="ltr"
            value={endsOn}
            onChange={(event) => setEndsOn(event.target.value)}
          />
        </label>
        <label className="sa-field sa-field--grow">
          <span>{ar ? 'ملاحظة' : 'Note'}</span>
          <input
            className="sa-input"
            value={note}
            maxLength={200}
            onChange={(event) => setNote(event.target.value)}
          />
        </label>
        <button
          type="button"
          className="button button--primary button--small"
          disabled={!dirty || busy}
          onClick={() => void save()}
        >
          {ar ? 'حفظ' : 'Save'}
        </button>
      </div>
    </li>
  );
}
