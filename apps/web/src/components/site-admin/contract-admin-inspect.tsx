'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import type { AdminContractInspect } from '@/lib/site-admin-shared';
import { adminDateTime, adminGet } from './admin-fetch';
import {
  SiteAdminFailed,
  SiteAdminLoading,
  SiteAdminPage,
  SiteAdminSurface,
} from './site-admin-page';

/** Read-only contract dossier for site admins. */
export function ContractAdminInspect({
  locale,
  contractId,
}: {
  locale: 'ar' | 'en';
  contractId: string;
}) {
  const ar = locale === 'ar';
  const [contract, setContract] = useState<AdminContractInspect | null>(null);
  const [failed, setFailed] = useState(false);

  const load = useCallback(() => {
    let live = true;
    setFailed(false);
    adminGet<{ contract: AdminContractInspect }>(
      `/api/site-admin/contracts/${encodeURIComponent(contractId)}`,
    )
      .then((data) => live && setContract(data.contract))
      .catch(() => live && setFailed(true));
    return () => {
      live = false;
    };
  }, [contractId]);

  useEffect(() => load(), [load]);

  const title = contract
    ? contract.reference || (ar ? 'عقد' : 'Contract')
    : ar
      ? 'عقد'
      : 'Contract';

  return (
    <SiteAdminPage
      locale={locale}
      title={title}
      lead={
        ar
          ? 'اطّلاع إداري على العقد وأطرافه والعقار المرتبط.'
          : 'Admin read-only view of the contract, parties, and linked property.'
      }
      actions={
        <div className="sa-actions-row">
          <Link className="button button--quiet" href={`/${locale}/admin/users`}>
            {ar ? '← المستخدمون' : '← Users'}
          </Link>
          {contract ? (
            <Link
              className="button button--quiet"
              href={`/${locale}/admin/properties/${encodeURIComponent(contract.propertyId)}`}
            >
              {ar ? 'العقار' : 'Property'}
            </Link>
          ) : null}
        </div>
      }
    >
      {failed ? (
        <SiteAdminFailed
          locale={locale}
          messageAr="تعذّر تحميل العقد."
          messageEn="Could not load this contract."
        />
      ) : contract === null ? (
        <SiteAdminLoading locale={locale} />
      ) : (
        <SiteAdminSurface title={ar ? 'تفاصيل العقد' : 'Contract details'}>
          <dl className="sa-dl">
            <div>
              <dt>{ar ? 'المرجع' : 'Reference'}</dt>
              <dd>
                <bdi dir="ltr">{contract.reference || contract.id}</bdi>
              </dd>
            </div>
            <div>
              <dt>{ar ? 'النوع' : 'Kind'}</dt>
              <dd>{contract.kind}</dd>
            </div>
            <div>
              <dt>{ar ? 'الحالة' : 'Status'}</dt>
              <dd>{contract.status}</dd>
            </div>
            <div>
              <dt>{ar ? 'المنشأة' : 'Organization'}</dt>
              <dd>{contract.organizationNameAr}</dd>
            </div>
            <div>
              <dt>{ar ? 'العقار' : 'Property'}</dt>
              <dd>{ar ? contract.propertyNameAr : contract.propertyNameEn}</dd>
            </div>
            <div>
              <dt>{ar ? 'الوحدة' : 'Unit'}</dt>
              <dd>{contract.unitNameAr}</dd>
            </div>
            <div>
              <dt>{ar ? 'المالك' : 'Owner'}</dt>
              <dd>{contract.ownerName}</dd>
            </div>
            <div>
              <dt>{ar ? 'المستأجر' : 'Tenant'}</dt>
              <dd>{contract.tenantName}</dd>
            </div>
            <div>
              <dt>{ar ? 'أُرسل' : 'Sent'}</dt>
              <dd>{adminDateTime(contract.sentAt, ar)}</dd>
            </div>
            <div>
              <dt>{ar ? 'اكتمل' : 'Completed'}</dt>
              <dd>{adminDateTime(contract.completedAt, ar)}</dd>
            </div>
            <div>
              <dt>{ar ? 'ملف PDF' : 'PDF'}</dt>
              <dd>{contract.hasPdf ? (ar ? 'متوفر' : 'Available') : ar ? 'غير متوفر' : 'None'}</dd>
            </div>
          </dl>
          {contract.relatedUserIds.length ? (
            <div>
              <p className="sa-metric">{ar ? 'حسابات مرتبطة:' : 'Linked accounts:'}</p>
              <ul className="sa-orgs">
                {contract.relatedUserIds.map((id) => (
                  <li key={id}>
                    <Link href={`/${locale}/admin/users/${encodeURIComponent(id)}`}>
                      <bdi dir="ltr">{id.slice(0, 8)}…</bdi>
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </SiteAdminSurface>
      )}
    </SiteAdminPage>
  );
}
