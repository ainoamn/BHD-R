import { getTranslations } from 'next-intl/server';

export async function LegalPage({
  titleKey,
  bodyKey,
}: {
  titleKey:
    'Legal.trustTitle' | 'Legal.privacyTitle' | 'Legal.termsTitle' | 'Legal.accessibilityTitle';
  bodyKey: 'Legal.trustBody' | 'Legal.privacyBody' | 'Legal.termsBody' | 'Legal.accessibilityBody';
}) {
  const t = await getTranslations();
  return (
    <article className="container legal-content">
      <span className="eyebrow">BHD R</span>
      <h1>{t(titleKey)}</h1>
      <p>{t(bodyKey)}</p>
      <p className="muted">{t('Legal.updated')}</p>
    </article>
  );
}
