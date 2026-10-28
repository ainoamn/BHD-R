import { DOCUMENT_ANTI_FORGERY, shortSeal } from '@/lib/document-authenticity';

/**
 * Clear verification strip on issued contracts: official verify URL, hash, digital seal,
 * and a fixed warning against fake verification websites.
 */
export function DocumentAuthenticityStrip({
  locale,
  verifyUrl,
  documentHash,
  digitalSeal,
  reference,
}: {
  locale: string;
  verifyUrl: string | null;
  documentHash: string | null;
  digitalSeal: string | null;
  reference: string;
}) {
  const ar = locale === 'ar';
  const sealShort = shortSeal(digitalSeal);

  return (
    <aside
      className="notice notice--info document-authenticity"
      role="region"
      aria-label={ar ? 'التحقق من الوثيقة' : 'Document verification'}
    >
      <p className="ops-kicker" style={{ margin: 0 }}>
        BHD R · AUTHENTICITY
      </p>
      <h2 style={{ marginTop: '0.35rem', fontSize: '1.05rem' }}>
        {ar ? 'شريط التحقق الرسمي' : 'Official verification strip'}
      </h2>
      <p className="muted" style={{ marginBottom: '0.75rem' }}>
        {ar ? `الوثيقة: ${reference}` : `Document: ${reference}`}
      </p>
      <dl className="lease-renewal__facts">
        {verifyUrl ? (
          <div>
            <dt>{ar ? 'رابط التحقق الرسمي' : 'Official verify link'}</dt>
            <dd>
              <a href={verifyUrl} target="_blank" rel="noopener noreferrer" dir="ltr">
                {verifyUrl.replace(/^https?:\/\//, '')}
              </a>
            </dd>
          </div>
        ) : null}
        {documentHash ? (
          <div>
            <dt>{ar ? 'بصمة المستند (SHA-256)' : 'Document fingerprint (SHA-256)'}</dt>
            <dd>
              <code dir="ltr">{documentHash}</code>
            </dd>
          </div>
        ) : null}
        {sealShort ? (
          <div>
            <dt>{ar ? 'الختم الرقمي BHD R' : 'BHD R digital seal'}</dt>
            <dd>
              <code dir="ltr">{sealShort}</code>
            </dd>
          </div>
        ) : null}
      </dl>
      <div style={{ marginTop: '0.85rem' }}>
        <strong>{ar ? DOCUMENT_ANTI_FORGERY.titleAr : DOCUMENT_ANTI_FORGERY.titleEn}</strong>
        <p style={{ marginBottom: 0 }}>
          {ar ? DOCUMENT_ANTI_FORGERY.bodyAr : DOCUMENT_ANTI_FORGERY.bodyEn}
        </p>
      </div>
    </aside>
  );
}
