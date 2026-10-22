import { notFound } from 'next/navigation';
import { AwardCertificate } from '@/components/badges/award-certificate';
import { hasDatabaseUrl } from '@/lib/bhd/identity-session';
import { loadAwardCertificate } from '@/lib/badges-neon';
import { readClaims } from '@/lib/portal-ops-data';
import { requirePortalPath } from '@/lib/viewer';

/** Server body for org portals and the site console. */
export async function AwardCertificateRoute({
  locale,
  portal,
  awardId,
}: {
  locale: 'ar' | 'en';
  portal: 'owner' | 'developer' | 'admin';
  awardId: string;
}) {
  if (portal !== 'admin') {
    await requirePortalPath(portal, '/badges');
  }
  if (!hasDatabaseUrl()) notFound();
  const claims = await readClaims();
  const certificate = claims
    ? await loadAwardCertificate(claims, awardId, locale).catch(() => null)
    : null;
  if (!certificate || certificate.status === 'pending' || certificate.status === 'rejected')
    notFound();
  const ar = locale === 'ar';
  const backHref = `/${locale}/${portal}/badges`;
  return (
    <AwardCertificate
      locale={locale}
      backHref={backHref}
      data={{
        ...certificate,
        holder: certificate.subjectName,
        rationale: ar ? certificate.rationaleAr : certificate.rationaleEn,
      }}
    />
  );
}
