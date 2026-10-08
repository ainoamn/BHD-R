import { StaysPortalPage } from '@/components/stays/stays-portal-page';
import { StayRatesBoard } from '@/components/stays/stay-rates-board';
import { hasDatabaseUrl } from '@/lib/bhd/identity-session';
import type { PropertyStaySettingsUnit } from '@/lib/property-stay-settings';
import { loadPropertyStaySettingsOnNeon } from '@/lib/stay-setup-neon';
import { readSessionClaimsFromCookies } from '@/lib/stay-setup-session';

export async function StaysRatesPage({
  locale,
  portal,
}: {
  locale: string;
  portal: 'owner' | 'developer';
}) {
  const ar = locale === 'ar';
  let units: PropertyStaySettingsUnit[] | null = null;
  const claims = hasDatabaseUrl() ? await readSessionClaimsFromCookies() : null;
  if (claims?.organizationId) {
    units = await loadPropertyStaySettingsOnNeon(claims, null).catch(() => null);
  }

  return (
    <StaysPortalPage locale={locale} portal={portal} section="rates">
      {units ? (
        <StayRatesBoard locale={locale} portal={portal} units={units} />
      ) : (
        <p className="pmh-empty">
          {ar
            ? 'تعذّر تحميل الأسعار الآن. حدّث الصفحة بعد لحظات.'
            : 'Could not load prices right now. Refresh in a moment.'}
        </p>
      )}
    </StaysPortalPage>
  );
}
