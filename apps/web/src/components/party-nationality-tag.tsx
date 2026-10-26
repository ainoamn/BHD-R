import { isOmaniNationality } from '@/lib/lease-document-rules';
import { partyNationalityCode, type ReservationParty } from '@/lib/reservation-party';
import { countryName } from '@/lib/world-countries';

/** Nationality in parentheses next to a tenant name — green for Oman, red otherwise. */
export function PartyNationalityTag({
  party,
  locale,
}: {
  party: ReservationParty;
  locale: 'ar' | 'en';
}) {
  const code = partyNationalityCode(party);
  if (!code) return null;
  const label = countryName(code, locale);
  if (!label) return null;
  const omani = isOmaniNationality(code);
  return (
    <span
      className={`party-nationality${omani ? ' party-nationality--omani' : ' party-nationality--foreign'}`}
    >
      ({label})
    </span>
  );
}
