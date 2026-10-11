import { Card, CardContent, StatusBadge } from '@bhd-r/ui';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { loadContractDetailFromNeon, type ContractDetail } from '@/lib/contract-detail-neon';
import { ApiError, apiFetch } from '@/lib/server-api';
import { requirePortal } from '@/lib/viewer';
import type { PortalRole } from '@/lib/types';
import { ContractActions } from './contract-actions';
import { SignatureForm } from './signature-form';

export async function ContractDetailView({
  portal,
  locale,
  contractId,
}: {
  portal: Exclude<PortalRole, 'platform'>;
  locale: string;
  contractId: string;
}) {
  const currentLocale = locale === 'en' ? 'en' : 'ar';
  const ar = currentLocale === 'ar';
  const viewer = await requirePortal(currentLocale, portal);
  let contract = await loadContractDetailFromNeon(contractId, portal).catch((error: unknown) => {
    console.error('contract detail (neon) failed', error);
    return null;
  });
  if (!contract) {
    contract = await apiFetch<ContractDetail>(
      portal === 'tenant'
        ? `/v1/tenant/contracts/${encodeURIComponent(contractId)}`
        : `/v1/leasing/contracts/${encodeURIComponent(contractId)}`,
    ).catch((error: unknown) => {
      if (error instanceof ApiError && [400, 403, 404].includes(error.status)) notFound();
      return null;
    });
  }
  if (!contract) {
    return (
      <div className="form-shell contract-detail">
        <Card>
          <CardContent>
            <h1>{ar ? 'تعذّر فتح العقد الآن' : 'The contract could not be opened'}</h1>
            <p className="muted">
              {ar
                ? 'الخدمة مشغولة لحظياً. أعد المحاولة بعد ثوانٍ.'
                : 'The service is busy for a moment. Try again in a few seconds.'}
            </p>
            <Link
              className="button button--secondary"
              href={`/${currentLocale}/${portal}/contracts`}
            >
              {ar ? 'العودة إلى العقود' : 'Back to contracts'}
            </Link>
          </CardContent>
        </Card>
      </div>
    );
  }
  return (
    <div className="form-shell contract-detail">
      <header className="portal-topbar">
        <div>
          <span className="ops-kicker">BHD R · CONTRACT</span>
          <h1>{contract.reference}</h1>
          <p>
            {contract.kind === 'renewal'
              ? ar
                ? 'ملحق تجديد'
                : 'Renewal addendum'
              : ar
                ? 'عقد إيجار أساسي'
                : 'Initial lease contract'}{' '}
            · {contract.startsOn} — {contract.endsOn}
          </p>
        </div>
        <StatusBadge
          status={contract.status === 'signed' ? 'positive' : 'neutral'}
          label={contract.status}
        />
      </header>

      <section className="contract-detail__grid">
        <Card>
          <CardContent>
            <h2>{ar ? 'الأطراف والوحدة' : 'Parties & unit'}</h2>
            <dl className="detail-facts">
              <div>
                <dt>{ar ? 'المالك' : 'Landlord'}</dt>
                <dd>{contract.parties.owner?.displayName ?? '—'}</dd>
              </div>
              <div>
                <dt>{ar ? 'المستأجر' : 'Tenant'}</dt>
                <dd>{contract.parties.tenant?.displayName ?? viewer.displayName}</dd>
              </div>
              <div>
                <dt>{ar ? 'العقار' : 'Property'}</dt>
                <dd>
                  {contract.property
                    ? ar
                      ? contract.property.nameAr
                      : contract.property.nameEn
                    : '—'}
                </dd>
              </div>
              <div>
                <dt>{ar ? 'الوحدة' : 'Unit'}</dt>
                <dd>
                  {contract.unit
                    ? `${contract.unit.code} · ${ar ? contract.unit.nameAr : contract.unit.nameEn}`
                    : '—'}
                </dd>
              </div>
              {contract.parentContractId ? (
                <div>
                  <dt>{ar ? 'العقد الأصلي' : 'Original contract'}</dt>
                  <dd>
                    <Link
                      href={`/${currentLocale}/${portal}/contracts/${contract.parentContractId}`}
                    >
                      {ar ? 'عرض العقد المرتبط' : 'View linked contract'}
                    </Link>
                  </dd>
                </div>
              ) : null}
            </dl>
          </CardContent>
        </Card>

        <Card>
          <CardContent>
            <h2>{ar ? 'الاعتماد والمستند' : 'Approval & document'}</h2>
            <p>
              {ar ? 'حالة الاعتماد: ' : 'Approval status: '}
              <strong>
                {contract.approval?.status ?? (ar ? 'غير مطلوب بعد' : 'Not requested')}
              </strong>
            </p>
            {contract.documentHash ? (
              <p className="muted">
                SHA-256: <code>{contract.documentHash}</code>
              </p>
            ) : (
              <p className="muted">
                {ar
                  ? 'سيُنشأ ملف PDF الآمن بعد إرسال العقد.'
                  : 'The secure PDF is generated after sending.'}
              </p>
            )}
            {contract.documentUrl ? (
              <a
                className="button button--secondary"
                href={contract.documentUrl}
                target="_blank"
                rel="noopener noreferrer"
              >
                {ar ? 'فتح نسخة PDF الآمنة' : 'Open secure PDF'}
              </a>
            ) : null}
            {portal !== 'tenant' ? (
              <ContractActions
                contractId={contract.id}
                status={contract.status}
                approvalStatus={contract.approval?.status ?? null}
                locale={currentLocale}
              />
            ) : null}
          </CardContent>
        </Card>
      </section>

      <Card>
        <CardContent>
          <h2>{ar ? 'سجل التوقيعات' : 'Signature evidence'}</h2>
          {contract.signatures.length ? (
            <ul className="contract-signatures">
              {contract.signatures.map((signature) => (
                <li key={signature.id}>
                  <strong>{signature.signerRole}</strong>
                  <span>{new Date(signature.signedAt).toLocaleString(ar ? 'ar-OM' : 'en-OM')}</span>
                  <code>{signature.signatureHash.slice(0, 20)}…</code>
                </li>
              ))}
            </ul>
          ) : (
            <p className="muted">
              {ar ? 'لم يُسجل أي توقيع بعد.' : 'No signature has been recorded yet.'}
            </p>
          )}
        </CardContent>
      </Card>

      {contract.canSign ? (
        <SignatureForm contractId={contract.id} expectedName={viewer.displayName} />
      ) : null}
    </div>
  );
}
