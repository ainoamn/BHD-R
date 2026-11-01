'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import type { AdminPropertyInspect } from '@/lib/site-admin-shared';
import { adminDate, adminGet } from './admin-fetch';
import {
  SiteAdminFailed,
  SiteAdminLoading,
  SiteAdminPage,
  SiteAdminSurface,
} from './site-admin-page';

/** Read-only property dossier for site admins. */
export function PropertyAdminInspect({
  locale,
  propertyId,
}: {
  locale: 'ar' | 'en';
  propertyId: string;
}) {
  const ar = locale === 'ar';
  const [property, setProperty] = useState<AdminPropertyInspect | null>(null);
  const [failed, setFailed] = useState(false);

  const load = useCallback(() => {
    let live = true;
    setFailed(false);
    adminGet<{ property: AdminPropertyInspect }>(
      `/api/site-admin/properties/${encodeURIComponent(propertyId)}`,
    )
      .then((data) => live && setProperty(data.property))
      .catch(() => live && setFailed(true));
    return () => {
      live = false;
    };
  }, [propertyId]);

  useEffect(() => load(), [load]);

  const title = property
    ? ar
      ? property.nameAr
      : property.nameEn
    : ar
      ? 'عقار'
      : 'Property';

  return (
    <SiteAdminPage
      locale={locale}
      title={title}
      lead={
        ar
          ? 'اطّلاع إداري على العقار ووحداته وعقوده وإيجاراته.'
          : 'Admin read-only view of the property, units, contracts, and leases.'
      }
      actions={
        <Link className="button button--quiet" href={`/${locale}/admin/users`}>
          {ar ? '← المستخدمون' : '← Users'}
        </Link>
      }
    >
      {failed ? (
        <SiteAdminFailed
          locale={locale}
          messageAr="تعذّر تحميل العقار."
          messageEn="Could not load this property."
        />
      ) : property === null ? (
        <SiteAdminLoading locale={locale} />
      ) : (
        <>
          <SiteAdminSurface title={ar ? 'الملخص' : 'Summary'}>
            <dl className="sa-dl">
              <div>
                <dt>{ar ? 'المنشأة' : 'Organization'}</dt>
                <dd>{property.organizationNameAr}</dd>
              </div>
              <div>
                <dt>{ar ? 'المالك' : 'Owner'}</dt>
                <dd>{property.ownerName}</dd>
              </div>
              <div>
                <dt>{ar ? 'النوع' : 'Kind'}</dt>
                <dd>
                  {property.kind} · {property.category}
                </dd>
              </div>
              <div>
                <dt>{ar ? 'الحالة' : 'Status'}</dt>
                <dd>{property.status}</dd>
              </div>
              <div>
                <dt>{ar ? 'الدولة' : 'Country'}</dt>
                <dd>
                  <bdi dir="ltr">{property.countryCode || '—'}</bdi>
                </dd>
              </div>
            </dl>
            {property.listingSlug ? (
              <p>
                <Link
                  className="button button--quiet button--small"
                  href={`/${locale}/stays/${encodeURIComponent(property.listingSlug)}`}
                  target="_blank"
                  rel="noreferrer"
                >
                  {ar ? 'فتح العرض العام' : 'Open public listing'}
                </Link>
              </p>
            ) : null}
          </SiteAdminSurface>

          <SiteAdminSurface title={ar ? 'الوحدات' : 'Units'}>
            {property.units.length ? (
              <div className="sa-table-wrap">
                <table className="sa-table">
                  <thead>
                    <tr>
                      <th>{ar ? 'الاسم' : 'Name'}</th>
                      <th>{ar ? 'الحالة' : 'Status'}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {property.units.map((unit) => (
                      <tr key={unit.id}>
                        <td>{ar ? unit.nameAr : unit.nameEn}</td>
                        <td>{unit.status}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <p className="muted" style={{ margin: 0 }}>
                {ar ? 'لا وحدات.' : 'No units.'}
              </p>
            )}
          </SiteAdminSurface>

          <SiteAdminSurface title={ar ? 'العقود' : 'Contracts'}>
            {property.contracts.length ? (
              <div className="sa-table-wrap">
                <table className="sa-table">
                  <thead>
                    <tr>
                      <th>{ar ? 'المرجع' : 'Reference'}</th>
                      <th>{ar ? 'المالك' : 'Owner'}</th>
                      <th>{ar ? 'المستأجر' : 'Tenant'}</th>
                      <th>{ar ? 'الحالة' : 'Status'}</th>
                      <th aria-label={ar ? 'فتح' : 'Open'} />
                    </tr>
                  </thead>
                  <tbody>
                    {property.contracts.map((contract) => (
                      <tr key={contract.id}>
                        <td>
                          <bdi dir="ltr">{contract.reference || contract.id.slice(0, 8)}</bdi>
                          <small>{contract.kind}</small>
                        </td>
                        <td>{contract.ownerName}</td>
                        <td>{contract.tenantName}</td>
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

          <SiteAdminSurface title={ar ? 'الإيجارات' : 'Leases'}>
            {property.leases.length ? (
              <div className="sa-table-wrap">
                <table className="sa-table">
                  <thead>
                    <tr>
                      <th>{ar ? 'المستأجر' : 'Tenant'}</th>
                      <th>{ar ? 'الفترة' : 'Period'}</th>
                      <th>{ar ? 'الحالة' : 'Status'}</th>
                      <th aria-label={ar ? 'عقد' : 'Contract'} />
                    </tr>
                  </thead>
                  <tbody>
                    {property.leases.map((lease) => (
                      <tr key={lease.id}>
                        <td>{lease.tenantName}</td>
                        <td>
                          {adminDate(lease.startsOn, ar)} → {adminDate(lease.endsOn, ar)}
                        </td>
                        <td>{lease.status}</td>
                        <td>
                          {lease.contractId ? (
                            <Link
                              className="button button--quiet button--small"
                              href={`/${locale}/admin/contracts/${encodeURIComponent(lease.contractId)}`}
                            >
                              {ar ? 'العقد' : 'Contract'}
                            </Link>
                          ) : (
                            '—'
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <p className="muted" style={{ margin: 0 }}>
                {ar ? 'لا إيجارات.' : 'No leases.'}
              </p>
            )}
          </SiteAdminSurface>
        </>
      )}
    </SiteAdminPage>
  );
}
