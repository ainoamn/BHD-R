import { Card, CardContent } from '@bhd-r/ui';
import { SignatureForm } from '@/components/signature-form';
import { apiFetch } from '@/lib/server-api';
import { requirePortal } from '@/lib/viewer';
interface ContractDetail {
  id: string;
  reference: string;
  status: string;
  startsOn: string;
  endsOn: string;
  documentUrl: string | null;
  canSign: boolean;
}
export default async function Page({
  params,
}: {
  params: Promise<{ locale: string; contractId: string }>;
}) {
  const { locale, contractId } = await params;
  const viewer = await requirePortal(locale, 'tenant');
  const contract = await apiFetch<ContractDetail>(
    `/v1/tenant/contracts/${encodeURIComponent(contractId)}`,
  );
  return (
    <div className="form-shell">
      <header className="portal-topbar">
        <div>
          <h1>{contract.reference}</h1>
          <p>
            {contract.startsOn} — {contract.endsOn}
          </p>
        </div>
      </header>
      <Card>
        <CardContent>
          <p>{contract.status}</p>
          {contract.documentUrl ? (
            <a
              className="button button--secondary"
              href={contract.documentUrl}
              target="_blank"
              rel="noopener noreferrer"
            >
              PDF
            </a>
          ) : null}
        </CardContent>
      </Card>
      {contract.canSign ? (
        <SignatureForm contractId={contract.id} expectedName={viewer.displayName} />
      ) : null}
    </div>
  );
}
