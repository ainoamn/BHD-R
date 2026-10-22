import { getLocale, getTranslations } from 'next-intl/server';
import { depositDisputeLegalSections } from '@/lib/legal-deposit-disputes';

export async function LegalPage({
  titleKey,
  bodyKey,
}: {
  titleKey:
    | 'Legal.trustTitle'
    | 'Legal.privacyTitle'
    | 'Legal.termsTitle'
    | 'Legal.accessibilityTitle';
  bodyKey: 'Legal.trustBody' | 'Legal.privacyBody' | 'Legal.termsBody' | 'Legal.accessibilityBody';
}) {
  const t = await getTranslations();
  const locale = (await getLocale()) === 'en' ? 'en' : 'ar';
  const includeDisputes = titleKey === 'Legal.privacyTitle' || titleKey === 'Legal.termsTitle';
  const disputeSections = includeDisputes ? depositDisputeLegalSections(locale) : [];

  return (
    <article className="container legal-content">
      <span className="eyebrow">BHD R</span>
      <h1>{t(titleKey)}</h1>
      <p>{t(bodyKey)}</p>
      {disputeSections.length ? (
        <div className="legal-content__sections">
          <h2>
            {locale === 'ar'
              ? 'نزاعات استرداد التأمين والشكاوى'
              : 'Deposit refund disputes and complaints'}
          </h2>
          {disputeSections.map((section) => (
            <section key={section.title}>
              <h3>{section.title}</h3>
              <p>{section.body}</p>
            </section>
          ))}
        </div>
      ) : null}
      <p className="muted">{t('Legal.updated')}</p>
    </article>
  );
}
