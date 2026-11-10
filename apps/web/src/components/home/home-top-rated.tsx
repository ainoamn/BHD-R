import { Link } from '@/i18n/navigation';
import type { LeaderboardEntry } from '@/lib/leaderboards-shared';

/** Visual strip of the highest-ranked published properties on the home page. */
export function HomeTopRatedSection({
  locale,
  entries,
}: {
  locale: string;
  entries: LeaderboardEntry[];
}) {
  if (!entries.length) return null;
  const ar = locale !== 'en';

  return (
    <section className="home-section home-top-rated" aria-labelledby="home-top-rated-title">
      <div className="container">
        <header className="home-head">
          <div>
            <span className="home-head__kicker">{ar ? 'تقييمات حقيقية' : 'Real ratings'}</span>
            <h2 id="home-top-rated-title">
              {ar ? 'العقارات الأعلى تقييماً' : 'Top-rated properties'}
            </h2>
            <p>
              {ar
                ? 'ترتيب من تقييمات الضيوف والإشغال وسرعة الصيانة.'
                : 'Ranked from guest ratings, occupancy and upkeep.'}
            </p>
          </div>
          <Link className="home-head__link" href="/badges#ranking" prefetch={false}>
            {ar ? 'كيف نقيّم؟' : 'How we rank'}
          </Link>
        </header>
        <ol className="home-top-rated__grid">
          {entries.map((entry, index) => {
            const name =
              (ar ? entry.name : entry.nameEn || entry.name) ?? (ar ? 'عقار' : 'Property');
            const body = (
              <>
                <span className={`home-top-rated__rank home-top-rated__rank--${index + 1}`}>
                  {index + 1}
                </span>
                <div className="home-top-rated__body">
                  <strong>
                    <bdi>{name}</bdi>
                    {entry.verified ? (
                      <span
                        className="home-board__verified"
                        title={ar ? 'حساب موثّق' : 'Verified account'}
                      >
                        ✓
                      </span>
                    ) : null}
                  </strong>
                  <small>
                    {(ar ? entry.detailAr : entry.detailEn).split(' · ').map((part, i) => (
                      <span key={i}>
                        {i ? ' · ' : null}
                        <bdi>{part}</bdi>
                      </span>
                    ))}
                  </small>
                </div>
                <div className="home-top-rated__score">
                  <b>{entry.score}</b>
                  {entry.stars !== null ? (
                    <small dir="ltr">
                      ★ {entry.stars.toFixed(1)}
                      {entry.ratings ? ` · ${entry.ratings}` : ''}
                    </small>
                  ) : null}
                </div>
              </>
            );
            return (
              <li key={entry.key} className="home-top-rated__card">
                {entry.href ? (
                  <Link href={entry.href} prefetch={false} className="home-top-rated__link">
                    {body}
                  </Link>
                ) : (
                  <div className="home-top-rated__link">{body}</div>
                )}
              </li>
            );
          })}
        </ol>
      </div>
    </section>
  );
}
