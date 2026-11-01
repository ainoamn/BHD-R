'use client';

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { browserNextMutation } from '@/lib/api';
import type {
  AdminUserAuthAttempt,
  AdminUserDetail,
  AdminUserSession,
  SubscriptionStatus,
} from '@/lib/site-admin-shared';
import { SUBSCRIPTION_LABELS, SUBSCRIPTION_STATUSES } from '@/lib/site-admin-shared';
import { roleLabel } from '@/lib/team-shared';
import {
  adminBytes,
  adminDate,
  adminDateTime,
  adminErrorText,
  adminGet,
  type AdminNotice,
} from './admin-fetch';
import {
  SiteAdminBanner,
  SiteAdminFailed,
  SiteAdminLoading,
  SiteAdminPage,
  SiteAdminSurface,
} from './site-admin-page';

const LIMIT_OPTIONS = [5, 10, 25, 50, 100] as const;

function countryOf(detail: AdminUserDetail, ar: boolean) {
  if (ar) return detail.countryNameAr || detail.countryCode || '—';
  return detail.countryNameEn || detail.countryCode || '—';
}

function placeLabel(
  row: {
    countryNameAr: string | null;
    countryNameEn: string | null;
    countryCode: string | null;
    region: string | null;
    city: string | null;
  },
  ar: boolean,
) {
  const country = ar
    ? row.countryNameAr || row.countryCode
    : row.countryNameEn || row.countryCode;
  const bits = [country, row.region, row.city].filter(Boolean);
  return bits.length ? bits.join(' · ') : '—';
}

function deviceLabel(
  row: { deviceKind: string | null; deviceLabel: string | null },
  ar: boolean,
) {
  const kind =
    row.deviceKind === 'phone'
      ? ar
        ? 'هاتف'
        : 'Phone'
      : row.deviceKind === 'tablet'
        ? ar
          ? 'جهاز لوحي'
          : 'Tablet'
        : row.deviceKind === 'desktop'
          ? ar
            ? 'كمبيوتر'
            : 'Computer'
          : ar
            ? 'غير معروف'
            : 'Unknown';
  return row.deviceLabel ? `${kind} · ${row.deviceLabel}` : kind;
}

function ActivityTable<T extends { id: string }>({
  ar,
  title,
  rows,
  limit,
  onLimit,
  emptyAr,
  emptyEn,
  head,
  render,
}: {
  ar: boolean;
  title: string;
  rows: T[];
  limit: number;
  onLimit: (value: number) => void;
  emptyAr: string;
  emptyEn: string;
  head: React.ReactNode;
  render: (row: T) => React.ReactNode;
}) {
  const visible = rows.slice(0, limit);
  return (
    <SiteAdminSurface title={title}>
      <div className="sa-toolbar">
        <label className="sa-limit">
          <span>{ar ? 'عرض' : 'Show'}</span>
          <select
            className="sa-input sa-input--compact"
            value={limit}
            onChange={(event) => onLimit(Number(event.target.value))}
          >
            {LIMIT_OPTIONS.map((option) => (
              <option key={option} value={option}>
                {option}
              </option>
            ))}
          </select>
        </label>
        <span className="muted">
          {ar ? `${Math.min(limit, rows.length)} من ${rows.length}` : `${Math.min(limit, rows.length)} of ${rows.length}`}
        </span>
      </div>
      {rows.length ? (
        <div className={`sa-table-wrap ${limit > 5 ? 'sa-table-wrap--scroll' : ''}`}>
          <table className="sa-table">
            <thead>{head}</thead>
            <tbody>{visible.map((row) => render(row))}</tbody>
          </table>
        </div>
      ) : (
        <p className="muted" style={{ margin: 0 }}>
          {ar ? emptyAr : emptyEn}
        </p>
      )}
    </SiteAdminSurface>
  );
}

/** Full account dossier opened from the users list. */
export function UsersAdminDetail({
  locale,
  userId,
}: {
  locale: 'ar' | 'en';
  userId: string;
}) {
  const ar = locale === 'ar';
  const [detail, setDetail] = useState<AdminUserDetail | null>(null);
  const [failed, setFailed] = useState(false);
  const [notice, setNotice] = useState<AdminNotice | null>(null);
  const [busy, setBusy] = useState(false);
  const [sessionLimit, setSessionLimit] = useState(5);
  const [attemptLimit, setAttemptLimit] = useState(5);
  const [planOrgId, setPlanOrgId] = useState('');
  const [planKey, setPlanKey] = useState('');
  const [planStatus, setPlanStatus] = useState<SubscriptionStatus>('active');
  const [planEndsOn, setPlanEndsOn] = useState('');
  const [planNote, setPlanNote] = useState('');

  const load = useCallback(() => {
    let live = true;
    setFailed(false);
    adminGet<{ user: AdminUserDetail }>(
      `/api/site-admin/users/${encodeURIComponent(userId)}`,
    )
      .then((data) => {
        if (!live) return;
        setDetail(data.user);
        const first = data.user.organizations[0];
        if (first) {
          setPlanOrgId((current) => current || first.id);
          setPlanKey((current) => current || first.planKey);
          setPlanStatus((current) =>
            current === 'active' && first.subscriptionStatus
              ? first.subscriptionStatus
              : current,
          );
          setPlanEndsOn((current) => current || first.subscriptionEndsOn || '');
        }
      })
      .catch(() => live && setFailed(true));
    return () => {
      live = false;
    };
  }, [userId]);

  useEffect(() => load(), [load]);

  const selectedOrg = useMemo(
    () => detail?.organizations.find((org) => org.id === planOrgId) ?? null,
    [detail, planOrgId],
  );

  async function runAction(body: Record<string, unknown>, okAr: string, okEn: string) {
    setBusy(true);
    try {
      await browserNextMutation(`/api/site-admin/users/${encodeURIComponent(userId)}`, {
        method: 'PATCH',
        body: JSON.stringify(body),
      });
      setNotice({ tone: 'success', text: ar ? okAr : okEn });
      load();
    } catch (error) {
      setNotice({
        tone: 'error',
        text: adminErrorText(error, ar, 'تعذّر التنفيذ.', 'Could not complete.'),
      });
    } finally {
      setBusy(false);
    }
  }

  async function setSuspended(suspended: boolean) {
    if (!detail) return;
    const name = detail.displayName || detail.email || '';
    if (
      suspended &&
      !window.confirm(ar ? `إيقاف حساب «${name}»؟` : `Suspend “${name}”?`)
    ) {
      return;
    }
    await runAction(
      { suspended },
      suspended ? 'أُوقف الحساب.' : 'أُعيد تفعيل الحساب.',
      suspended ? 'Account suspended.' : 'Account restored.',
    );
  }

  async function changePlan(event: React.FormEvent) {
    event.preventDefault();
    if (!planOrgId || !planKey) return;
    if (
      !window.confirm(
        ar
          ? 'تحديث الباقة وإرسال بريد للمستخدم؟'
          : 'Update the plan and email the user?',
      )
    ) {
      return;
    }
    await runAction(
      {
        action: 'change_plan',
        organizationId: planOrgId,
        planKey,
        status: planStatus,
        endsOn: planEndsOn || null,
        note: planNote.trim() || null,
      },
      'حُدّثت الباقة وأُرسل البريد.',
      'Plan updated and email sent.',
    );
  }

  const title = detail
    ? detail.displayName || detail.email || (ar ? 'مستخدم' : 'User')
    : ar
      ? 'ملف المستخدم'
      : 'User dossier';

  return (
    <SiteAdminPage
      locale={locale}
      title={title}
      lead={
        ar
          ? 'تفاصيل الحساب، إدارة الباقة وكلمة المرور، الجلسات ومحاولات الدخول.'
          : 'Account dossier, plan and password controls, sessions and sign-in attempts.'
      }
      actions={
        <Link className="button button--quiet" href={`/${locale}/admin/users`}>
          {ar ? '← المستخدمون' : '← Users'}
        </Link>
      }
    >
      <SiteAdminBanner notice={notice} />

      {failed ? (
        <SiteAdminFailed
          locale={locale}
          messageAr="تعذّر تحميل ملف المستخدم."
          messageEn="Could not load this user dossier."
        />
      ) : detail === null ? (
        <SiteAdminLoading locale={locale} />
      ) : (
        <>
          <SiteAdminSurface title={ar ? 'إدارة الحساب' : 'Account controls'}>
            <dl className="sa-dl">
              <div>
                <dt>{ar ? 'الاسم' : 'Name'}</dt>
                <dd>{detail.displayName || '—'}</dd>
              </div>
              <div>
                <dt>{ar ? 'البريد' : 'Email'}</dt>
                <dd>
                  <bdi dir="ltr">{detail.email ?? '—'}</bdi>
                </dd>
              </div>
              <div>
                <dt>{ar ? 'الهاتف' : 'Phone'}</dt>
                <dd>
                  <bdi dir="ltr">{detail.phone ?? '—'}</bdi>
                </dd>
              </div>
              <div>
                <dt>{ar ? 'الدولة' : 'Country'}</dt>
                <dd>{countryOf(detail, ar)}</dd>
              </div>
              <div>
                <dt>{ar ? 'الحالة' : 'Status'}</dt>
                <dd>
                  {detail.disabledAt ? (
                    <span className="pmh-badge pmh-badge--danger">
                      {ar ? 'موقوف' : 'Suspended'}
                    </span>
                  ) : (
                    <span className="pmh-badge pmh-badge--ready">{ar ? 'نشط' : 'Active'}</span>
                  )}
                  {detail.securityLockedAt ? (
                    <span className="pmh-badge pmh-badge--warn sa-tag">
                      {ar ? 'قفل أمني' : 'Security lock'}
                    </span>
                  ) : null}
                </dd>
              </div>
              <div>
                <dt>{ar ? 'منذ' : 'Since'}</dt>
                <dd>{adminDateTime(detail.createdAt, ar)}</dd>
              </div>
            </dl>
            <div className="sa-actions-row">
              <button
                type="button"
                className="button button--quiet"
                disabled={busy}
                onClick={() => void setSuspended(!detail.disabledAt)}
              >
                {detail.disabledAt
                  ? ar
                    ? 'إعادة التفعيل'
                    : 'Restore'
                  : ar
                    ? 'إيقاف الحساب'
                    : 'Suspend'}
              </button>
              <button
                type="button"
                className="button button--quiet"
                disabled={busy}
                onClick={() =>
                  void runAction(
                    { action: 'revoke_sessions' },
                    'أُنهيَت كل الجلسات.',
                    'All sessions revoked.',
                  )
                }
              >
                {ar ? 'إنهاء كل الجلسات' : 'Revoke all sessions'}
              </button>
              <button
                type="button"
                className="button button--quiet"
                disabled={busy || !detail.securityLockedAt}
                onClick={() =>
                  void runAction(
                    { action: 'unlock' },
                    'أُزيل القفل الأمني.',
                    'Security lock cleared.',
                  )
                }
              >
                {ar ? 'إزالة القفل الأمني' : 'Clear security lock'}
              </button>
              <button
                type="button"
                className="button button--primary"
                disabled={busy || !detail.email || Boolean(detail.disabledAt)}
                onClick={() => {
                  if (
                    !window.confirm(
                      ar
                        ? 'إرسال رابط إعادة ضبط كلمة المرور إلى بريد المستخدم؟'
                        : 'Send a password-reset link to this user?',
                    )
                  ) {
                    return;
                  }
                  void runAction(
                    { action: 'password_reset' },
                    'أُرسل رابط إعادة ضبط كلمة المرور.',
                    'Password reset link sent.',
                  );
                }}
              >
                {ar ? 'إعادة ضبط كلمة المرور' : 'Reset password'}
              </button>
            </div>
          </SiteAdminSurface>

          <SiteAdminSurface title={ar ? 'الباقة والاشتراك' : 'Plan & subscription'}>
            {detail.organizations.length ? (
              <form className="sa-ledger-form" onSubmit={(event) => void changePlan(event)}>
                <label>
                  <span>{ar ? 'المنشأة' : 'Organization'}</span>
                  <select
                    className="sa-input"
                    value={planOrgId}
                    onChange={(event) => {
                      const id = event.target.value;
                      setPlanOrgId(id);
                      const org = detail.organizations.find((item) => item.id === id);
                      if (org) {
                        setPlanKey(org.planKey);
                        setPlanStatus(org.subscriptionStatus);
                        setPlanEndsOn(org.subscriptionEndsOn || '');
                      }
                    }}
                  >
                    {detail.organizations.map((org) => (
                      <option key={org.id} value={org.id}>
                        {ar ? org.nameAr : org.nameEn || org.nameAr} · {roleLabel(org.role, ar)}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  <span>{ar ? 'الباقة' : 'Plan'}</span>
                  <select
                    className="sa-input"
                    value={planKey}
                    onChange={(event) => setPlanKey(event.target.value)}
                  >
                    {detail.plans.map((plan) => (
                      <option key={plan.key} value={plan.key}>
                        {ar ? plan.nameAr : plan.nameEn}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  <span>{ar ? 'حالة الاشتراك' : 'Status'}</span>
                  <select
                    className="sa-input"
                    value={planStatus}
                    onChange={(event) =>
                      setPlanStatus(event.target.value as SubscriptionStatus)
                    }
                  >
                    {SUBSCRIPTION_STATUSES.map((status) => (
                      <option key={status} value={status}>
                        {ar ? SUBSCRIPTION_LABELS[status].ar : SUBSCRIPTION_LABELS[status].en}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  <span>{ar ? 'ينتهي في' : 'Ends on'}</span>
                  <input
                    className="sa-input"
                    type="date"
                    value={planEndsOn}
                    onChange={(event) => setPlanEndsOn(event.target.value)}
                  />
                </label>
                <label className="sa-ledger-form__wide">
                  <span>{ar ? 'ملاحظة (اختياري)' : 'Note (optional)'}</span>
                  <input
                    className="sa-input"
                    value={planNote}
                    onChange={(event) => setPlanNote(event.target.value)}
                    maxLength={200}
                  />
                </label>
                {selectedOrg ? (
                  <p className="muted sa-footnote" style={{ gridColumn: '1 / -1', margin: 0 }}>
                    {ar ? 'الحالي:' : 'Current:'} {ar ? selectedOrg.planNameAr : selectedOrg.planNameEn}
                    {' · '}
                    {ar
                      ? SUBSCRIPTION_LABELS[selectedOrg.subscriptionStatus].ar
                      : SUBSCRIPTION_LABELS[selectedOrg.subscriptionStatus].en}
                    {selectedOrg.subscriptionEndsOn
                      ? ` · ${adminDate(selectedOrg.subscriptionEndsOn, ar)}`
                      : ''}
                  </p>
                ) : null}
                <button type="submit" className="button button--primary" disabled={busy}>
                  {ar ? 'حفظ الباقة وإرسال بريد' : 'Save plan & email user'}
                </button>
              </form>
            ) : (
              <p className="muted" style={{ margin: 0 }}>
                {ar ? 'لا منشأة لربط باقة بها.' : 'No organization to attach a plan to.'}
              </p>
            )}
          </SiteAdminSurface>

          <SiteAdminSurface title={ar ? 'المنشآت والمساحة' : 'Organizations & storage'}>
            <p className="sa-metric">
              {ar ? 'مرفقات رفعها الحساب:' : 'Uploads by this account:'}{' '}
              <strong>{adminBytes(detail.storage.uploadedBytes, ar)}</strong>
            </p>
            {detail.organizations.length ? (
              <div className="sa-table-wrap">
                <table className="sa-table">
                  <thead>
                    <tr>
                      <th>{ar ? 'المنشأة' : 'Organization'}</th>
                      <th>{ar ? 'الباقة' : 'Plan'}</th>
                      <th>{ar ? 'الانتهاء' : 'Expires'}</th>
                      <th>{ar ? 'المساحة' : 'Storage'}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {detail.organizations.map((org) => {
                      const sub = SUBSCRIPTION_LABELS[org.subscriptionStatus];
                      return (
                        <tr key={org.id}>
                          <td>
                            <strong>{ar ? org.nameAr : org.nameEn || org.nameAr}</strong>
                            <small>{roleLabel(org.role, ar)}</small>
                          </td>
                          <td>
                            {ar ? org.planNameAr : org.planNameEn}
                            <small>
                              <span className={`pmh-badge pmh-badge--${sub.tone}`}>
                                {ar ? sub.ar : sub.en}
                              </span>
                            </small>
                          </td>
                          <td>{adminDate(org.subscriptionEndsOn, ar)}</td>
                          <td>
                            {adminBytes(org.storageUsedBytes, ar)}
                            <small>/ {adminBytes(org.storageLimitBytes, ar)}</small>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            ) : (
              <p className="muted" style={{ margin: 0 }}>
                {ar ? 'بلا منشأة.' : 'No organization.'}
              </p>
            )}
          </SiteAdminSurface>

          <SiteAdminSurface title={ar ? 'العقارات والعقود' : 'Properties & contracts'}>
            <div className="sa-ai-columns">
              <div>
                <h3>{ar ? 'يملك' : 'Owns'}</h3>
                {detail.propertiesOwned.length ? (
                  <ul className="sa-orgs">
                    {detail.propertiesOwned.map((property) => (
                      <li key={property.id}>
                        <Link
                          href={`/${locale}/admin/properties/${encodeURIComponent(property.id)}`}
                        >
                          {ar ? property.nameAr : property.nameEn}
                        </Link>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="muted">{ar ? 'لا عقارات.' : 'None.'}</p>
                )}
              </div>
              <div>
                <h3>{ar ? 'يستأجر' : 'Rents'}</h3>
                {detail.leasesAsTenant.length ? (
                  <ul className="sa-orgs">
                    {detail.leasesAsTenant.map((lease) => (
                      <li key={lease.id}>
                        <Link
                          href={`/${locale}/admin/properties/${encodeURIComponent(lease.propertyId)}`}
                        >
                          {ar ? lease.propertyNameAr : lease.propertyNameEn}
                        </Link>
                        <small>
                          {ar ? 'من' : 'from'} {lease.ownerName}
                        </small>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="muted">{ar ? 'لا إيجارات.' : 'None.'}</p>
                )}
              </div>
              <div>
                <h3>{ar ? 'عقود' : 'Contracts'}</h3>
                {detail.contracts.length ? (
                  <ul className="sa-orgs">
                    {detail.contracts.map((contract) => (
                      <li key={contract.id}>
                        <Link
                          href={`/${locale}/admin/contracts/${encodeURIComponent(contract.id)}`}
                        >
                          {contract.reference || contract.id.slice(0, 8)}
                        </Link>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="muted">{ar ? 'لا عقود.' : 'None.'}</p>
                )}
              </div>
            </div>
          </SiteAdminSurface>

          <ActivityTable<AdminUserSession>
            ar={ar}
            title={ar ? 'الجلسات والأجهزة' : 'Sessions & devices'}
            rows={detail.sessions}
            limit={sessionLimit}
            onLimit={setSessionLimit}
            emptyAr="لا جلسات مسجّلة."
            emptyEn="No sessions recorded."
            head={
              <tr>
                <th>{ar ? 'الموقع' : 'Location'}</th>
                <th>{ar ? 'الجهاز' : 'Device'}</th>
                <th>{ar ? 'IP' : 'IP'}</th>
                <th>{ar ? 'الدخول' : 'Signed in'}</th>
                <th>{ar ? 'الخروج / الانتهاء' : 'Out / expiry'}</th>
                <th>{ar ? 'الحالة' : 'Status'}</th>
              </tr>
            }
            render={(session) => (
              <tr key={session.id}>
                <td>
                  {placeLabel(session, ar)}
                  {session.countryCode ? (
                    <small>
                      <bdi dir="ltr">{session.countryCode}</bdi>
                    </small>
                  ) : null}
                </td>
                <td>
                  {deviceLabel(session, ar)}
                  {!session.deviceLabel && session.deviceHash ? (
                    <small>
                      <bdi dir="ltr">{session.deviceHash}</bdi>
                    </small>
                  ) : null}
                </td>
                <td>
                  <bdi dir="ltr">{session.ipAddress || session.ipHash || '—'}</bdi>
                </td>
                <td>{adminDateTime(session.createdAt, ar)}</td>
                <td>
                  {session.revokedAt
                    ? adminDateTime(session.revokedAt, ar)
                    : adminDateTime(session.expiresAt, ar)}
                </td>
                <td>
                  {session.active ? (
                    <span className="pmh-badge pmh-badge--ready">{ar ? 'نشطة' : 'Active'}</span>
                  ) : session.revokedAt ? (
                    <span className="pmh-badge pmh-badge--muted">{ar ? 'خروج' : 'Signed out'}</span>
                  ) : (
                    <span className="pmh-badge pmh-badge--warn">{ar ? 'منتهية' : 'Expired'}</span>
                  )}
                </td>
              </tr>
            )}
          />
          <p className="muted sa-footnote">
            {ar
              ? 'الدولة من شبكة الدخول؛ المحافظة/القرية تظهر عند توفرها من مزوّد الحافة. الجلسات القديمة قد لا تحتوي نوع الجهاز حتى يسجّل المستخدم دخولاً جديداً.'
              : 'Country comes from the edge network; region/city appear when the host provides them. Older sessions may lack device details until the next sign-in.'}
          </p>

          <ActivityTable<AdminUserAuthAttempt>
            ar={ar}
            title={ar ? 'محاولات الدخول' : 'Sign-in attempts'}
            rows={detail.authAttempts}
            limit={attemptLimit}
            onLimit={setAttemptLimit}
            emptyAr="لا محاولات دخول مسجّلة لهذا الحساب."
            emptyEn="No auth attempts for this account."
            head={
              <tr>
                <th>{ar ? 'الوقت' : 'When'}</th>
                <th>{ar ? 'النتيجة' : 'Outcome'}</th>
                <th>{ar ? 'الموقع' : 'Location'}</th>
                <th>{ar ? 'الجهاز' : 'Device'}</th>
                <th>{ar ? 'IP' : 'IP'}</th>
                <th>{ar ? 'السبب' : 'Reason'}</th>
              </tr>
            }
            render={(attempt) => (
              <tr key={attempt.id}>
                <td>{adminDateTime(attempt.at, ar)}</td>
                <td>{attempt.outcome}</td>
                <td>{placeLabel(attempt, ar)}</td>
                <td>{deviceLabel(attempt, ar)}</td>
                <td>
                  <bdi dir="ltr">{attempt.ipAddress || attempt.ipHash}</bdi>
                </td>
                <td>{attempt.reason || '—'}</td>
              </tr>
            )}
          />

          <SiteAdminSurface title={ar ? 'التقييمات' : 'Reviews'}>
            {detail.reviews.length ? (
              <div className="sa-table-wrap sa-table-wrap--scroll">
                <table className="sa-table">
                  <thead>
                    <tr>
                      <th>{ar ? 'الاتجاه' : 'Direction'}</th>
                      <th>{ar ? 'الدرجة' : 'Score'}</th>
                      <th>{ar ? 'الهدف' : 'Target'}</th>
                      <th>{ar ? 'التاريخ' : 'Date'}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {detail.reviews.slice(0, 25).map((review) => (
                      <tr key={`${review.source}-${review.id}`}>
                        <td>
                          {review.direction === 'authored'
                            ? ar
                              ? 'كتبه'
                              : 'Authored'
                            : ar
                              ? 'استلمه'
                              : 'Received'}
                        </td>
                        <td>{review.score}</td>
                        <td>{review.targetLabel}</td>
                        <td>{adminDate(review.createdAt, ar)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <p className="muted" style={{ margin: 0 }}>
                {ar ? 'لا تقييمات.' : 'No reviews.'}
              </p>
            )}
          </SiteAdminSurface>

          <SiteAdminSurface title={ar ? 'سجل الحركة' : 'Activity audit'}>
            {detail.audit.length ? (
              <div className="sa-table-wrap sa-table-wrap--scroll">
                <table className="sa-table">
                  <thead>
                    <tr>
                      <th>{ar ? 'الوقت' : 'When'}</th>
                      <th>{ar ? 'الإجراء' : 'Action'}</th>
                      <th>{ar ? 'المورد' : 'Resource'}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {detail.audit.slice(0, 40).map((row, index) => (
                      <tr key={`${row.action}-${row.at}-${index}`}>
                        <td>{adminDateTime(row.at, ar)}</td>
                        <td>
                          <bdi dir="ltr">{row.action}</bdi>
                        </td>
                        <td>
                          {row.resourceType}
                          {row.resourceId ? (
                            <small>
                              <bdi dir="ltr">{row.resourceId.slice(0, 8)}</bdi>
                            </small>
                          ) : null}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <p className="muted" style={{ margin: 0 }}>
                {ar ? 'لا حركة مسجّلة.' : 'No audit events.'}
              </p>
            )}
          </SiteAdminSurface>
        </>
      )}
    </SiteAdminPage>
  );
}
