'use client';

import { useCallback, useEffect, useState } from 'react';
import { BadgeEmblem } from '@/components/badges/badge-emblem';
import { Link } from '@/i18n/navigation';
import { browserNextMutation } from '@/lib/api';
import { dateText, errorText, getJson } from '@/lib/badges-client';
import { LEVEL_LABELS, SUBJECT_LABELS, TIER_LABELS, type SubjectBadges } from '@/lib/badges-shared';

type Locale = 'ar' | 'en';

/** One subject's badges: what it holds, how close it is to the rest, and AI tips to get there. */
export function SubjectBadgesView({
  data,
  locale,
  portal,
  showSubject = false,
}: {
  data: SubjectBadges;
  locale: Locale;
  portal: string;
  showSubject?: boolean;
}) {
  const ar = locale === 'ar';
  const [tips, setTips] = useState<string[] | null>(null);
  const [coaching, setCoaching] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const held = data.awards.filter((award) => award.status === 'active');
  const pending = data.awards.filter((award) => award.status === 'pending');
  const next = data.progress
    .filter((item) => !item.held)
    .sort((a, b) => b.progress - a.progress)
    .slice(0, 4);

  const coach = async () => {
    setCoaching(true);
    setError(null);
    try {
      const result = await browserNextMutation<{ ar: string[]; en: string[] }>(
        '/api/portal/badges/subject',
        {
          method: 'POST',
          body: JSON.stringify({ type: data.subjectType, id: data.subjectId }),
        },
      );
      setTips(ar ? result.ar : result.en);
    } catch (caught) {
      setError(errorText(caught, ar));
    } finally {
      setCoaching(false);
    }
  };

  return (
    <div className="subject-badges">
      {showSubject ? (
        <h3 className="subject-badges__as">
          {ar
            ? `بصفته ${SUBJECT_LABELS[data.subjectType].ar}`
            : `As ${SUBJECT_LABELS[data.subjectType].en}`}
        </h3>
      ) : null}
      {held.length ? (
        <ul className="subject-badges__held">
          {held.map((award) => (
            <li key={award.id}>
              <Link href={`/${portal}/badges/awards/${award.id}`} className="subject-badges__award">
                <BadgeEmblem
                  tier={award.tier}
                  level={award.level}
                  icon={award.icon}
                  size={52}
                  title={ar ? award.badgeNameAr : award.badgeNameEn}
                />
                <span>
                  <strong>{ar ? award.badgeNameAr : award.badgeNameEn}</strong>
                  <span className="muted">
                    {ar ? TIER_LABELS[award.tier].ar : TIER_LABELS[award.tier].en} ·{' '}
                    {ar ? LEVEL_LABELS[award.level].ar : LEVEL_LABELS[award.level].en}
                  </span>
                  <span className="muted" dir="ltr">
                    {award.serial}
                  </span>
                  {award.expiresAt ? (
                    <span className="muted">
                      {ar ? 'حتى' : 'until'} {dateText(award.expiresAt, ar)}
                    </span>
                  ) : null}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      ) : (
        <p className="muted">{ar ? 'لا يحمل شارات حالياً.' : 'No badges held yet.'}</p>
      )}
      {pending.length ? (
        <p className="subject-badges__pending">
          {ar
            ? `بانتظار اعتماد المالك: ${pending.map((award) => award.badgeNameAr).join('، ')}`
            : `Awaiting approval: ${pending.map((award) => award.badgeNameEn).join(', ')}`}
        </p>
      ) : null}
      {next.length ? (
        <div className="subject-badges__next">
          <h4>{ar ? 'الأقرب للحصول عليها' : 'Closest to earning'}</h4>
          <ul>
            {next.map((item) => (
              <li key={item.badgeId}>
                <BadgeEmblem tier={item.tier} level={item.level} icon={item.icon} size={34} muted />
                <div>
                  <p>
                    <strong>{ar ? item.nameAr : item.nameEn}</strong>{' '}
                    <span className="muted">{Math.round(item.progress * 100)}%</span>
                  </p>
                  <span className="progress-bar" aria-hidden="true">
                    <span style={{ width: `${Math.round(item.progress * 100)}%` }} />
                  </span>
                  <ul className="subject-badges__criteria">
                    {item.criteria.map((criterion) => (
                      <li key={criterion.text} className={criterion.met ? 'is-met' : undefined}>
                        {criterion.met ? '✓' : '○'} {criterion.text}{' '}
                        <span className="muted">
                          ({ar ? 'الحالي' : 'now'}: {criterion.actual})
                        </span>
                      </li>
                    ))}
                  </ul>
                  {item.qualifiedSince ? (
                    <p className="muted">
                      {ar
                        ? `الشروط متحققة منذ ${dateText(item.qualifiedSince, ar)}؛ تُمنح بعد ${item.sustainDays} يوماً متصلة.`
                        : `Qualifying since ${dateText(item.qualifiedSince, ar)}; awarded after ${item.sustainDays} days.`}
                    </p>
                  ) : null}
                </div>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      <div className="subject-badges__coach">
        {tips ? (
          <ul className="subject-badges__tips">
            {tips.map((tip) => (
              <li key={tip}>{tip}</li>
            ))}
          </ul>
        ) : null}
        <button
          type="button"
          className="button button--ghost button--small"
          disabled={coaching}
          onClick={() => void coach()}
        >
          {coaching
            ? ar
              ? 'يحلّل الذكاء الاصطناعي…'
              : 'Analysing…'
            : ar
              ? '✦ نصائح الذكاء الاصطناعي لرفع المستوى'
              : '✦ AI tips to level up'}
        </button>
        {error ? <p className="form-error">{error}</p> : null}
      </div>
    </div>
  );
}

/** The badges section on a contact's page: as owner, tenant and (for linked vendors) worker. */
export function PartyBadgesPanel({
  partyId,
  locale,
  portal,
}: {
  partyId: string;
  locale: Locale;
  portal: string;
}) {
  const ar = locale === 'ar';
  const [subjects, setSubjects] = useState<SubjectBadges[] | null>(null);

  const load = useCallback(async () => {
    try {
      const result = await getJson<{ subjects: SubjectBadges[] }>(
        `/api/portal/badges/party/${partyId}?locale=${locale}`,
      );
      setSubjects(result.subjects);
    } catch {
      setSubjects([]);
    }
  }, [locale, partyId]);

  useEffect(() => {
    void load();
  }, [load]);

  if (!subjects || subjects.length === 0) return null;
  return (
    <section className="contact-section subject-badges-panel">
      <header className="subject-badges-panel__head">
        <h2>{ar ? 'الشارات والتميّز' : 'Badges & excellence'}</h2>
        <Link href={`/${portal}/badges`} className="button button--ghost button--small">
          {ar ? 'كل الشارات' : 'All badges'}
        </Link>
      </header>
      {subjects.map((subject) => (
        <SubjectBadgesView
          key={`${subject.subjectType}:${subject.subjectId}`}
          data={subject}
          locale={locale}
          portal={portal}
          showSubject={subjects.length > 1}
        />
      ))}
    </section>
  );
}

/** The badges section on a property's page. */
export function PropertyBadgesPanel({
  propertyId,
  locale,
  portal,
}: {
  propertyId: string;
  locale: Locale;
  portal: string;
}) {
  const ar = locale === 'ar';
  const [data, setData] = useState<SubjectBadges | null>(null);

  useEffect(() => {
    let cancelled = false;
    void getJson<{ badges: SubjectBadges | null }>(
      `/api/portal/badges/subject?type=property&id=${propertyId}&locale=${locale}`,
    )
      .then((result) => {
        if (!cancelled) setData(result.badges);
      })
      .catch(() => {
        if (!cancelled) setData(null);
      });
    return () => {
      cancelled = true;
    };
  }, [locale, propertyId]);

  if (!data) return null;
  return (
    <section className="subject-badges-panel">
      <header className="subject-badges-panel__head">
        <h2>{ar ? 'شارات العقار' : 'Property badges'}</h2>
        <Link href={`/${portal}/badges`} className="button button--ghost button--small">
          {ar ? 'كل الشارات' : 'All badges'}
        </Link>
      </header>
      <SubjectBadgesView data={data} locale={locale} portal={portal} />
    </section>
  );
}
