import { Card, CardContent, StatusBadge } from '@bhd-r/ui';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { BadgeChips } from '@/components/badges/badge-chips';
import { activeBadgeChips, chipsOf } from '@/lib/badge-chips-neon';
import type { BadgeChip } from '@/lib/badges-shared';
import type { ContractAnnexDocument } from '@/lib/contract-annex';
import { loadContractAnnexFromNeon } from '@/lib/contract-annex-neon';
import { loadContractDetailFromNeon, type ContractDetail } from '@/lib/contract-detail-neon';
import { scopedOwnerParty } from '@/lib/portal-access';
import { ApiError, apiFetch } from '@/lib/server-api';
import { requirePortal } from '@/lib/viewer';
import { withTimeoutFallback } from '@/lib/with-timeout';
import type { PortalRole } from '@/lib/types';
import { ContractActions } from './contract-actions';
import { ContractDocumentView } from './contract-document-view';
import { SignatureForm } from './signature-form';

type Portal = Exclude<PortalRole, 'platform'>;
type Viewer = Awaited<ReturnType<typeof requirePortal>>;

export async function ContractDetailView({
  portal,
  locale,
  contractId,
}: {
  portal: Portal;
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
  // The Nest copy does not limit a building owner to their own properties.
  if (!contract && portal !== 'tenant' && scopedOwnerParty(viewer)) notFound();
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
  const badges = await contractBadges(contract);
  if (contract.document) {
    const annexes = await Promise.all(
      contract.document.annexes
        .filter((annex) => annex.recordedAt)
        .map((annex) =>
          loadContractAnnexFromNeon(contractId, portal, annex.kind).catch((error: unknown) => {
            console.error('contract annex (neon) failed', error);
            return null;
          }),
        ),
    );
    return (
      <ContractDocumentView
        contract={contract}
        doc={contract.document}
        annexDocuments={annexes.filter((annex): annex is ContractAnnexDocument => Boolean(annex))}
        portal={portal}
        locale={currentLocale}
        viewerName={viewer.displayName}
        badges={badges}
      />
    );
  }
  return (
    <SimpleContractView
      contract={contract}
      portal={portal}
      locale={currentLocale}
      viewer={viewer}
      badges={badges}
    />
  );
}

export type ContractBadges = { property: BadgeChip[]; tenant: BadgeChip[]; owner: BadgeChip[] };

async function contractBadges(contract: ContractDetail): Promise<ContractBadges> {
  const property = contract.property?.id;
  const tenant = contract.parties.tenant?.id;
  const owner = contract.parties.owner?.id;
  const chips = await withTimeoutFallback(
    activeBadgeChips([
      { type: 'property', id: property },
      { type: 'tenant', id: tenant },
      { type: 'owner', id: owner },
    ]),
    2_500,
    new Map<string, BadgeChip[]>(),
    'contract-badges',
  );
  return {
    property: chipsOf(chips, 'property', property),
    tenant: chipsOf(chips, 'tenant', tenant),
    owner: chipsOf(chips, 'owner', owner),
  };
}

function SimpleContractView({
  contract,
  portal,
  locale,
  viewer,
  badges,
}: {
  contract: ContractDetail;
  portal: Portal;
  locale: 'ar' | 'en';
  viewer: Viewer;
  badges: ContractBadges;
}) {
  const ar = locale === 'ar';
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
                <dd className="name-with-mark">
                  {contract.parties.owner?.displayName ?? '—'}
                  <BadgeChips badges={badges.owner} locale={locale} />
                </dd>
              </div>
              <div>
                <dt>{ar ? 'المستأجر' : 'Tenant'}</dt>
                <dd className="name-with-mark">
                  {contract.parties.tenant?.displayName ?? viewer.displayName}
                  <BadgeChips badges={badges.tenant} locale={locale} />
                </dd>
              </div>
              <div>
                <dt>{ar ? 'العقار' : 'Property'}</dt>
                <dd className="name-with-mark">
                  {contract.property
                    ? ar
                      ? contract.property.nameAr
                      : contract.property.nameEn
                    : '—'}
                  <BadgeChips badges={badges.property} locale={locale} />
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
                    <Link href={`/${locale}/${portal}/contracts/${contract.parentContractId}`}>
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
                locale={locale}
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
