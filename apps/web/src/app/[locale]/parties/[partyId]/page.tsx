import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { eq, sql } from 'drizzle-orm';
import { createDatabase, parties } from '@bhd-r/db';
import { setRequestLocale } from 'next-intl/server';
import { ReviewsPanel } from '@/components/reviews-panel';
import { hasDatabaseUrl } from '@/lib/bhd/identity-session';
import { bilingualAlternates } from '@/lib/seo';
import { getViewer } from '@/lib/viewer';
import type { ReviewTargetType } from '@/lib/reviews-types';

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string; partyId: string }>;
}): Promise<Metadata> {
  const { locale, partyId } = await params;
  return {
    title: locale === 'ar' ? 'ملف الطرف' : 'Party profile',
    alternates: bilingualAlternates(locale, `/parties/${partyId}`),
  };
}

async function loadParty(partyId: string) {
  const url = process.env.DATABASE_URL;
  if (!url) return null;
  const { db } = createDatabase(url, { max: 1 });
  return db.transaction(async (tx) => {
    await tx.execute(sql`select set_config('app.platform_admin', 'true', true)`);
    await tx.execute(sql`select set_config('app.public', 'false', true)`);
    return tx.query.parties.findFirst({ where: eq(parties.id, partyId) });
  });
}

export default async function PartyProfilePage({
  params,
}: {
  params: Promise<{ locale: string; partyId: string }>;
}) {
  const { locale: rawLocale, partyId } = await params;
  const locale = rawLocale === 'en' ? 'en' : 'ar';
  setRequestLocale(locale);
  const ar = locale === 'ar';

  if (!hasDatabaseUrl()) notFound();
  const [party, viewer] = await Promise.all([
    loadParty(partyId).catch(() => null),
    getViewer().catch(() => null),
  ]);
  if (!party) notFound();

  const targets: Array<{
    type: ReviewTargetType;
    id: string;
    titleAr: string;
    titleEn: string;
  }> = [
    {
      type: 'party',
      id: party.id,
      titleAr: 'تقييمات الطرف',
      titleEn: 'Party reviews',
    },
    {
      type: 'organization',
      id: party.organizationId,
      titleAr: 'المؤسسة',
      titleEn: 'Organization',
    },
  ];

  return (
    <main className="section">
      <div className="container party-profile">
        <header className="party-profile__head">
          <p className="party-profile__eyebrow">{ar ? 'ملف عام' : 'Public profile'}</p>
          <h1>{party.displayName}</h1>
          <p>
            {party.type === 'company'
              ? ar
                ? 'جهة / شركة'
                : 'Company'
              : ar
                ? 'فرد'
                : 'Person'}
          </p>
        </header>
        <ReviewsPanel locale={locale} signedIn={Boolean(viewer)} targets={targets} />
        {viewer?.partyId && viewer.partyId !== party.id ? (
          <p className="party-profile__hint">
            {ar
              ? 'إن كنت مالكاً لعقد مع هذا الطرف، سيُوسم تقييمك بشارة موثّقة تلقائياً.'
              : 'If you share a lease with this party, your review gets a verified badge automatically.'}
          </p>
        ) : null}
      </div>
    </main>
  );
}
