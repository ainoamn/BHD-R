import { notFound } from 'next/navigation';
import { AwardCertificate } from '@/components/badges/award-certificate';
import { hasDatabaseUrl } from '@/lib/bhd/identity-session';
import { loadAwardCertificate } from '@/lib/badges-neon';
import { readClaims } from '@/lib/portal-ops-data';
import { requirePortalPath } from '@/lib/viewer';

/** Server body shared by the owner and developer certificate pages. */
export async function AwardCertificateRoute({
  locale,
  portal,
  awardId,
}: {
  locale: 'ar' | 'en';
  portal: 'owner' | 'developer';
  awardId: string;
}) {
  await requirePortalPath(portal, '/badges');
  if (!hasDatabaseUrl()) notFound();
  const claims = await readClaims();
  const certificate = claims
    ? await loadAwardCertificate(claims, awardId, locale).catch(() => null)
    : null;
  if (!certificate || certificate.status === 'pending' || certificate.status === 'rejected')
    notFound();
  const ar = locale === 'ar';
  return (
    <AwardCertificate
      locale={locale}
      backHref={`/${locale}/${portal}/badges`}
      data={{
        ...certificate,
        holder: certificate.subjectName,
        rationale: ar ? certificate.rationaleAr : certificate.rationaleEn,
      }}
    />
  );
}
