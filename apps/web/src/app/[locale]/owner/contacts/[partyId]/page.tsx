import { notFound } from 'next/navigation';
import { ContactWorkspace } from '@/components/contact-workspace';
import { hasDatabaseUrl } from '@/lib/bhd/identity-session';
import { readContact } from '@/lib/contacts-neon';
import { persistentPortalPage } from '@/lib/persistent-portal-page';
import { readClaims } from '@/lib/portal-ops-data';
import { requirePortal } from '@/lib/viewer';

async function Page({ params }: { params: Promise<{ locale: string; partyId: string }> }) {
  const { locale: rawLocale, partyId } = await params;
  const locale = rawLocale === 'en' ? 'en' : 'ar';
  await requirePortal(locale, 'owner');
  if (!hasDatabaseUrl() || !/^[0-9a-f-]{36}$/i.test(partyId)) notFound();
  const claims = await readClaims();
  const detail = claims ? await readContact(claims, partyId).catch(() => null) : null;
  if (!detail) notFound();
  return <ContactWorkspace initial={detail} locale={locale} portal="owner" />;
}

export default persistentPortalPage('/owner/contacts/[partyId]', Page);
