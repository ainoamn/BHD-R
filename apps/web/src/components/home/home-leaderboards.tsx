import { Link } from '@/i18n/navigation';
import { BadgeChips } from '@/components/badges/badge-chips';
import type {
  HomeLeaderboards,
  LeaderboardEntry,
  LeaderboardKind,
} from '@/lib/leaderboards-shared';

const BOARDS: {
  kind: LeaderboardKind;
  ar: string;
  en: string;
  hintAr: string;
  hintEn: string;
  emptyAr: string;
  emptyEn: string;
  anonymousAr: string;
  anonymousEn: string;
}[] = [
  {
    kind: 'property',
    ar: 'أفضل العقارات',
    en: 'Top properties',
    hintAr: 'تقييم الضيوف والإشغال وسرعة الصيانة',
    hintEn: 'Guest ratings, occupancy and upkeep',
    emptyAr: 'تظهر هنا العقارات المنشورة الأعلى تقييماً.',
    emptyEn: 'Top-rated published properties appear here.',
    anonymousAr: 'عقار',
    anonymousEn: 'Property',
  },
  {
    kind: 'partner',
    ar: 'أفضل الشركاء',
    en: 'Top partners',
    hintAr: 'الالتزام بالموعد وجودة العمل والتكلفة',
    hintEn: 'Punctuality, verified work and cost',
    emptyAr: 'يظهر هنا شركاء الصيانة والخدمات بعد أول أعمال موثقة.',
    emptyEn: 'Service partners appear after their first verified jobs.',
    anonymousAr: 'شريك',
    anonymousEn: 'Partner',
  },
  {
    kind: 'owner',
    ar: 'أفضل الملاك والإدارات',
    en: 'Top owners & managers',
    hintAr: 'تقييم عقاراتهم وتشغيلها والتوثيق',
    hintEn: 'Their buildings’ ratings, running and trust',
    emptyAr: 'يظهر هنا الملاك وإدارات الأملاك الأعلى أداءً.',
    emptyEn: 'The best-run owners and managers appear here.',
    anonymousAr: 'مالك خاص',
    anonymousEn: 'Private owner',
  },
  {
    kind: 'tenant',
    ar: 'أفضل المستأجرين',
    en: 'Top tenants',
    hintAr: 'السداد في الموعد وتقييم الملاك',
    hintEn: 'On-time payment and hosts’ ratings',
    emptyAr: 'يظهر هنا المستأجرون الأكثر التزاماً.',
    emptyEn: 'The most reliable tenants appear here.',
    anonymousAr: 'مستأجر',
    anonymousEn: 'Tenant',
  },
];

function BoardIcon({ kind }: { kind: LeaderboardKind }) {
  const paths: Record<LeaderboardKind, string> = {
    property: 'M4 20V9l8-5 8 5v11h-5v-6H9v6H4z',
    partner:
      'M14.7 6.3a4 4 0 0 0-5.4 5.4L3 18l3 3 6.3-6.3a4 4 0 0 0 5.4-5.4l-2.5 2.5-2.4-.6-.6-2.4z',
    owner:
      'M8 14a5 5 0 1 1 4.9-6H22v3h-2v3h-3v-3h-4.1A5 5 0 0 1 8 14zm0-3a2 2 0 1 0 0-4 2 2 0 0 0 0 4z',
    tenant: 'M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8zm-8 8a8 8 0 0 1 16 0z',
  };
  return (
    <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
      <path d={paths[kind]} fill="currentColor" />
    </svg>
  );
}

function EntryRow({
  entry,
  rank,
  locale,
  anonymous,
}: {
  entry: LeaderboardEntry;
  rank: number;
  locale: string;
  anonymous: string;
}) {
  const ar = locale !== 'en';
  const name = (ar ? entry.name : entry.nameEn || entry.name) ?? anonymous;
  const title = (
    <>
      <bdi>{name}</bdi>
      {entry.verified ? (
        <span className="home-board__verified" title={ar ? 'حساب موثّق' : 'Verified account'}>
          ✓
        </span>
      ) : null}
    </>
  );
  return (
    <li className="home-board__row">
      <span className={`home-board__rank home-board__rank--${rank}`} aria-hidden="true">
        {rank}
      </span>
      <div className="home-board__who">
        <strong>
          {entry.href ? (
            <Link href={entry.href} prefetch={false}>
              {title}
            </Link>
          ) : (
            title
          )}
        </strong>
        <small>
          {(ar ? entry.detailAr : entry.detailEn).split(' · ').map((part, index) => (
            <span key={index}>
              {index ? ' · ' : null}
              <bdi>{part}</bdi>
            </span>
          ))}
        </small>
        <BadgeChips badges={entry.badges} locale={locale} size={16} max={3} />
      </div>
      <div className="home-board__score">
        <b title={ar ? 'المؤشر الذكي من 100' : 'Smart score out of 100'}>{entry.score}</b>
        {entry.stars !== null ? (
          <small dir="ltr" title={ar ? `${entry.ratings} تقييم` : `${entry.ratings} ratings`}>
            ★ {entry.stars.toFixed(1)}
          </small>
        ) : null}
      </div>
    </li>
  );
}

/** Four auto-ranked boards; on phones they scroll sideways so the section stays short. */
export function HomeLeaderboardsSection({
  data,
  locale,
}: {
  data: HomeLeaderboards;
  locale: string;
}) {
  const ar = locale !== 'en';
  return (
    <section className="home-section home-leaders" aria-labelledby="home-leaders-title">
      <div className="container">
        <header className="home-head">
          <div>
            <span className="home-head__kicker">
              <i aria-hidden="true" />
              {ar ? 'يتحدّث تلقائياً' : 'Updates automatically'}
            </span>
            <h2 id="home-leaders-title">{ar ? 'الأفضل على BHD R' : 'The best on BHD R'}</h2>
            <p>
              {ar
                ? 'ترتيب ذكي من التقييمات والأداء الفعلي خلال آخر 12 شهراً.'
                : 'Smart ranking from ratings and real activity over the last 12 months.'}
            </p>
          </div>
          <Link className="home-head__link" href="/badges#ranking" prefetch={false}>
            {ar ? 'كيف نقيّم؟' : 'How we rank'}
          </Link>
        </header>
        <div className="home-leaders__grid">
          {BOARDS.map((board) => {
            const entries = data.boards[board.kind];
            return (
              <article key={board.kind} className={`home-board home-board--${board.kind}`}>
                <header className="home-board__head">
                  <span className="home-board__icon">
                    <BoardIcon kind={board.kind} />
                  </span>
                  <div>
                    <h3>{ar ? board.ar : board.en}</h3>
                    <small>{ar ? board.hintAr : board.hintEn}</small>
                  </div>
                </header>
                {entries.length ? (
                  <ol className="home-board__list">
                    {entries.map((entry, index) => (
                      <EntryRow
                        key={entry.key}
                        entry={entry}
                        rank={index + 1}
                        locale={locale}
                        anonymous={ar ? board.anonymousAr : board.anonymousEn}
                      />
                    ))}
                  </ol>
                ) : (
                  <p className="home-board__empty">{ar ? board.emptyAr : board.emptyEn}</p>
                )}
              </article>
            );
          })}
        </div>
      </div>
    </section>
  );
}
