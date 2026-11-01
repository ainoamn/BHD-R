'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { browserNextMutation } from '@/lib/api';
import type { AdminUserDetail } from '@/lib/site-admin-shared';
import { SUBSCRIPTION_LABELS } from '@/lib/site-admin-shared';
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

function countryOf(detail: AdminUserDetail, ar: boolean) {
  if (ar) return detail.countryNameAr || detail.countryCode || '—';
  return detail.countryNameEn || detail.countryCode || '—';
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

  const load = useCallback(() => {
    let live = true;
    setFailed(false);
    adminGet<{ user: AdminUserDetail }>(
      `/api/site-admin/users/${encodeURIComponent(userId)}`,
    )
      .then((data) => live && setDetail(data.user))
      .catch(() => live && setFailed(true));
    return () => {
      live = false;
    };
  }, [userId]);

  useEffect(() => load(), [load]);

  async function setSuspended(suspended: boolean) {
    if (!detail) return;
    const name = detail.displayName || detail.email || '';
    if (
      suspended &&
      !window.confirm(
        ar
          ? `إيقاف حساب «${name}»؟`
          : `Suspend “${name}”?`,
      )
    ) {
      return;
    }
    setBusy(true);
    try {
      const data = await browserNextMutation<{ user: { disabledAt: string | null } }>(
        `/api/site-admin/users/${encodeURIComponent(userId)}`,
        { method: 'PATCH', body: JSON.stringify({ suspended }) },
      );
      setDetail((current) =>
        current ? { ...current, disabledAt: data.user.disabledAt } : current,
      );
      setNotice({
        tone: 'success',
        text: suspended
          ? ar
            ? 'أُوقف الحساب.'
            : 'Account suspended.'
          : ar
            ? 'أُعيد تفعيل الحساب.'
            : 'Account restored.',
      });
    } catch (error) {
      setNotice({
        tone: 'error',
        text: adminErrorText(error, ar, 'تعذّر التنفيذ.', 'Could not complete.'),
      });
    } finally {
      setBusy(false);
    }
  }

  const title = detail
    ? detail.displayName || detail.email || (ar ? 'مستخدم' : 'User')
    : ar
      ? 'ملف المستخدم'
      : 'User dossier';
  const lead = ar
    ? 'تفاصيل الحساب والمنشآت والعقارات والعقود والتقييمات والمساحة وجلسات الدخول.'
    : 'Account, organizations, properties, contracts, reviews, storage, and sign-in activity.';

  return (
    <SiteAdminPage
      locale={locale}
      title={title}
      lead={lead}
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
          <SiteAdminSurface title={ar ? 'الملف الأساسي' : 'Profile'}>
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
                <dt>{ar ? 'اسم المستخدم' : 'Username'}</dt>
                <dd>
                  <bdi dir="ltr">{detail.username}</bdi>
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
                <dd>
                  {countryOf(detail, ar)}
                  {detail.countryCode ? (
                    <>
                      {' '}
                      (<bdi dir="ltr">{detail.countryCode}</bdi>)
                    </>
                  ) : null}
                </dd>
              </div>
              <div>
                <dt>{ar ? 'اللغة' : 'Locale'}</dt>
                <dd>{detail.locale}</dd>
              </div>
              <div>
                <dt>{ar ? 'تاريخ الإنشاء' : 'Created'}</dt>
                <dd>{adminDateTime(detail.createdAt, ar)}</dd>
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
                  {detail.isSiteAdmin ? (
                    <span className="pmh-badge pmh-badge--info sa-tag">
                      {ar ? 'إدارة الموقع' : 'Site admin'}
                    </span>
                  ) : null}
                </dd>
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
            </div>
          </SiteAdminSurface>

          <SiteAdminSurface title={ar ? 'المنشآت والباقات' : 'Organizations & plans'}>
            {detail.organizations.length ? (
              <div className="sa-table-wrap">
                <table className="sa-table">
                  <thead>
                    <tr>
                      <th>{ar ? 'المنشأة' : 'Organization'}</th>
                      <th>{ar ? 'الدور' : 'Role'}</th>
                      <th>{ar ? 'الدولة' : 'Country'}</th>
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
                          </td>
                          <td>{roleLabel(org.role, ar)}</td>
                          <td>
                            <bdi dir="ltr">{org.countryCode}</bdi>
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
                            <small>
                              / {adminBytes(org.storageLimitBytes, ar)}
                            </small>
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

          <SiteAdminSurface title={ar ? 'المساحة المستخدمة' : 'Storage used'}>
            <p className="sa-metric">
              {ar ? 'إجمالي المرفقات التي رفعها هذا الحساب:' : 'Total uploads by this account:'}{' '}
              <strong>{adminBytes(detail.storage.uploadedBytes, ar)}</strong>
            </p>
            {detail.storage.byOrganization.length ? (
              <ul className="sa-orgs">
                {detail.storage.byOrganization.map((row) => (
                  <li key={row.organizationId}>
                    {row.nameAr} · {adminBytes(row.bytes, ar)}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="muted" style={{ margin: 0 }}>
                {ar ? 'لا مرفقات مسجّلة.' : 'No uploaded media yet.'}
              </p>
            )}
          </SiteAdminSurface>

          <SiteAdminSurface title={ar ? 'العقارات التي يملكها' : 'Properties owned'}>
            {detail.propertiesOwned.length ? (
              <div className="sa-table-wrap">
                <table className="sa-table">
                  <thead>
                    <tr>
                      <th>{ar ? 'العقار' : 'Property'}</th>
                      <th>{ar ? 'المنشأة' : 'Organization'}</th>
                      <th>{ar ? 'الوحدات' : 'Units'}</th>
                      <th>{ar ? 'الحالة' : 'Status'}</th>
                      <th aria-label={ar ? 'فتح' : 'Open'} />
                    </tr>
                  </thead>
                  <tbody>
                    {detail.propertiesOwned.map((property) => (
                      <tr key={property.id}>
                        <td>
                          <strong>{ar ? property.nameAr : property.nameEn}</strong>
                          <small>{property.kind}</small>
                        </td>
                        <td>{property.organizationNameAr}</td>
                        <td>{property.units}</td>
                        <td>{property.status}</td>
                        <td>
                          <Link
                            className="button button--quiet button--small"
                            href={`/${locale}/admin/properties/${encodeURIComponent(property.id)}`}
                          >
                            {ar ? 'تفاصيل' : 'Open'}
                          </Link>
                          {property.listingSlug ? (
                            <Link
                              className="button button--quiet button--small"
                              href={`/${locale}/stays/${encodeURIComponent(property.listingSlug)}`}
                              target="_blank"
                              rel="noreferrer"
                            >
                              {ar ? 'عرض عام' : 'Public'}
                            </Link>
                          ) : null}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <p className="muted" style={{ margin: 0 }}>
                {ar ? 'لا عقارات مملوكة.' : 'No owned properties.'}
              </p>
            )}
          </SiteAdminSurface>

          <SiteAdminSurface title={ar ? 'عقارات استأجرها' : 'Properties rented'}>
            {detail.leasesAsTenant.length ? (
              <div className="sa-table-wrap">
                <table className="sa-table">
                  <thead>
                    <tr>
                      <th>{ar ? 'العقار / الوحدة' : 'Property / unit'}</th>
                      <th>{ar ? 'المالك' : 'Landlord'}</th>
                      <th>{ar ? 'الفترة' : 'Period'}</th>
                      <th>{ar ? 'الحالة' : 'Status'}</th>
                      <th aria-label={ar ? 'فتح' : 'Open'} />
                    </tr>
                  </thead>
                  <tbody>
                    {detail.leasesAsTenant.map((lease) => (
                      <tr key={lease.id}>
                        <td>
                          <strong>
                            {ar ? lease.propertyNameAr : lease.propertyNameEn}
                          </strong>
                          <small>{lease.unitNameAr}</small>
                        </td>
                        <td>{lease.ownerName}</td>
                        <td>
                          {adminDate(lease.startsOn, ar)} → {adminDate(lease.endsOn, ar)}
                        </td>
                        <td>{lease.status}</td>
                        <td>
                          <Link
                            className="button button--quiet button--small"
                            href={`/${locale}/admin/properties/${encodeURIComponent(lease.propertyId)}`}
                          >
                            {ar ? 'العقار' : 'Property'}
                          </Link>
                          {lease.contractId ? (
                            <Link
                              className="button button--quiet button--small"
                              href={`/${locale}/admin/contracts/${encodeURIComponent(lease.contractId)}`}
                            >
                              {ar ? 'العقد' : 'Contract'}
                            </Link>
                          ) : null}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <p className="muted" style={{ margin: 0 }}>
                {ar ? 'لا عقود إيجار كمستأجر.' : 'No leases as tenant.'}
              </p>
            )}
          </SiteAdminSurface>

          <SiteAdminSurface title={ar ? 'العقود' : 'Contracts'}>
            {detail.contracts.length ? (
              <div className="sa-table-wrap">
                <table className="sa-table">
                  <thead>
                    <tr>
                      <th>{ar ? 'المرجع' : 'Reference'}</th>
                      <th>{ar ? 'العقار' : 'Property'}</th>
                      <th>{ar ? 'الدور' : 'Role'}</th>
                      <th>{ar ? 'الطرف الآخر' : 'Counterparty'}</th>
                      <th>{ar ? 'الحالة' : 'Status'}</th>
                      <th aria-label={ar ? 'فتح' : 'Open'} />
                    </tr>
                  </thead>
                  <tbody>
                    {detail.contracts.map((contract) => (
                      <tr key={contract.id}>
                        <td>
                          <bdi dir="ltr">{contract.reference || contract.id.slice(0, 8)}</bdi>
                          <small>{contract.kind}</small>
                        </td>
                        <td>{contract.propertyNameAr}</td>
                        <td>
                          {contract.role === 'owner'
                            ? ar
                              ? 'مالك'
                              : 'Owner'
                            : ar
                              ? 'مستأجر'
                              : 'Tenant'}
                        </td>
                        <td>{contract.counterpartyName}</td>
                        <td>{contract.status}</td>
                        <td>
                          <Link
                            className="button button--quiet button--small"
                            href={`/${locale}/admin/contracts/${encodeURIComponent(contract.id)}`}
                          >
                            {ar ? 'تفاصيل' : 'Open'}
                          </Link>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <p className="muted" style={{ margin: 0 }}>
                {ar ? 'لا عقود.' : 'No contracts.'}
              </p>
            )}
          </SiteAdminSurface>

          <SiteAdminSurface title={ar ? 'التقييمات' : 'Reviews'}>
            {detail.reviews.length ? (
              <div className="sa-table-wrap">
                <table className="sa-table">
                  <thead>
                    <tr>
                      <th>{ar ? 'الاتجاه' : 'Direction'}</th>
                      <th>{ar ? 'الدرجة' : 'Score'}</th>
                      <th>{ar ? 'الهدف' : 'Target'}</th>
                      <th>{ar ? 'التاريخ' : 'Date'}</th>
                      <th>{ar ? 'ملاحظة' : 'Note'}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {detail.reviews.map((review) => (
                      <tr key={`${review.source}-${review.id}`}>
                        <td>
                          {review.direction === 'authored'
                            ? ar
                              ? 'كتبه'
                              : 'Authored'
                            : ar
                              ? 'استلمه'
                              : 'Received'}
                          <small>{review.source}</small>
                        </td>
                        <td>{review.score}</td>
                        <td>{review.targetLabel}</td>
                        <td>{adminDate(review.createdAt, ar)}</td>
                        <td>{review.comment || '—'}</td>
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

          <SiteAdminSurface title={ar ? 'الجلسات والأجهزة' : 'Sessions & devices'}>
            {detail.sessions.length ? (
              <div className="sa-table-wrap">
                <table className="sa-table">
                  <thead>
                    <tr>
                      <th>{ar ? 'الدولة' : 'Country'}</th>
                      <th>{ar ? 'بصمة IP' : 'IP hash'}</th>
                      <th>{ar ? 'الجهاز' : 'Device'}</th>
                      <th>{ar ? 'الدخول' : 'Signed in'}</th>
                      <th>{ar ? 'الخروج / الانتهاء' : 'Out / expiry'}</th>
                      <th>{ar ? 'الحالة' : 'Status'}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {detail.sessions.map((session) => (
                      <tr key={session.id}>
                        <td>
                          <bdi dir="ltr">{session.countryCode || '—'}</bdi>
                        </td>
                        <td>
                          <bdi dir="ltr">{session.ipHash || '—'}</bdi>
                        </td>
                        <td>
                          <bdi dir="ltr">{session.deviceHash || '—'}</bdi>
                        </td>
                        <td>{adminDateTime(session.createdAt, ar)}</td>
                        <td>
                          {session.revokedAt
                            ? adminDateTime(session.revokedAt, ar)
                            : adminDateTime(session.expiresAt, ar)}
                        </td>
                        <td>
                          {session.active ? (
                            <span className="pmh-badge pmh-badge--ready">
                              {ar ? 'نشطة' : 'Active'}
                            </span>
                          ) : session.revokedAt ? (
                            <span className="pmh-badge pmh-badge--muted">
                              {ar ? 'خروج' : 'Signed out'}
                            </span>
                          ) : (
                            <span className="pmh-badge pmh-badge--warn">
                              {ar ? 'منتهية' : 'Expired'}
                            </span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <p className="muted" style={{ margin: 0 }}>
                {ar ? 'لا جلسات مسجّلة.' : 'No sessions recorded.'}
              </p>
            )}
            <p className="muted sa-footnote">
              {ar
                ? 'عناوين IP والأجهزة تُحفظ كبصمات هاش للخصوصية؛ محاولات الدخول أدناه قد تُظهر عنوان IP كاملاً عند توفره.'
                : 'IP and device values are stored as privacy hashes; login attempts below may show a full IP when available.'}
            </p>
          </SiteAdminSurface>

          <SiteAdminSurface title={ar ? 'محاولات الدخول' : 'Sign-in attempts'}>
            {detail.authAttempts.length ? (
              <div className="sa-table-wrap">
                <table className="sa-table">
                  <thead>
                    <tr>
                      <th>{ar ? 'الوقت' : 'When'}</th>
                      <th>{ar ? 'النتيجة' : 'Outcome'}</th>
                      <th>{ar ? 'IP' : 'IP'}</th>
                      <th>{ar ? 'الدولة' : 'Country'}</th>
                      <th>{ar ? 'الجهاز' : 'Device'}</th>
                      <th>{ar ? 'السبب' : 'Reason'}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {detail.authAttempts.map((attempt) => (
                      <tr key={attempt.id}>
                        <td>{adminDateTime(attempt.at, ar)}</td>
                        <td>{attempt.outcome}</td>
                        <td>
                          <bdi dir="ltr">{attempt.ipAddress || attempt.ipHash}</bdi>
                        </td>
                        <td>
                          <bdi dir="ltr">{attempt.countryCode || '—'}</bdi>
                        </td>
                        <td>
                          <bdi dir="ltr">{attempt.deviceHash || '—'}</bdi>
                        </td>
                        <td>{attempt.reason || '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <p className="muted" style={{ margin: 0 }}>
                {ar ? 'لا محاولات دخول مسجّلة لهذا الحساب.' : 'No auth attempts for this account.'}
              </p>
            )}
          </SiteAdminSurface>

          <SiteAdminSurface title={ar ? 'سجل الحركة' : 'Activity audit'}>
            {detail.audit.length ? (
              <div className="sa-table-wrap">
                <table className="sa-table">
                  <thead>
                    <tr>
                      <th>{ar ? 'الوقت' : 'When'}</th>
                      <th>{ar ? 'الإجراء' : 'Action'}</th>
                      <th>{ar ? 'المورد' : 'Resource'}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {detail.audit.map((row, index) => (
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
