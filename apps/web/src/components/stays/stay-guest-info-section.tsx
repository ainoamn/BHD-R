'use client';

import { formatMoney, localizedName } from '@/lib/format';
import type { StayPublicDetail } from '@bhd-r/contracts';

/** Policies, period times, and stay rate amounts on the public stay page. */
export function StayGuestInfoSection({
  detail,
  locale,
}: {
  detail: StayPublicDetail;
  locale: string;
}) {
  const ar = locale === 'ar';
  const currency = detail.currency ?? 'OMR';
  const policies = (() => {
    const split = (text: string | null | undefined) =>
      text
        ?.split(/\r?\n/)
        .map((line) => line.replace(/^[\s•\-–—*]+/, '').trim())
        .filter(Boolean) ?? [];
    if (ar) {
      if (detail.policiesJson?.length) return detail.policiesJson;
      return split(detail.policiesAr);
    }
    const en = split(detail.policiesEn);
    if (en.length) return en;
    if (detail.policiesJson?.length) return detail.policiesJson;
    return split(detail.policiesAr);
  })();
  const instructions = localizedName(
    locale,
    detail.instructionsAr ?? '',
    detail.instructionsEn ?? '',
  );
  const rates = [
    {
      key: 'overnight',
      label: ar ? 'إقامة مع مبيت' : 'Stay with overnight',
      minor: detail.nightlyMinor,
    },
    {
      key: 'day',
      label: ar ? 'إقامة بدون مبيت' : 'Day use (no overnight)',
      minor: detail.dayUseMinor,
    },
    {
      key: 'only',
      label: ar ? 'مبيت فقط' : 'Overnight only',
      minor: detail.overnightOnlyMinor,
    },
  ].filter((row) => row.minor);

  const hasTimes =
    detail.checkInFrom ||
    detail.dayUseCheckOutUntil ||
    detail.overnightCheckOutUntil ||
    detail.checkOutUntil;
  const hasGuests = detail.dayUseMaxGuests != null || detail.overnightMaxGuests != null;
  if (!policies.length && !instructions && !rates.length && !hasTimes && !detail.depositMinor && !hasGuests) {
    return null;
  }

  return (
    <section className="stay-guest-info property-360__section" aria-labelledby="stay-guest-info-title">
      <h2 id="stay-guest-info-title">{ar ? 'شروط الإقامة والأسعار' : 'Stay terms & rates'}</h2>

      {hasTimes || hasGuests || detail.depositMinor ? (
        <dl className="stay-guest-info__grid">
          {detail.checkInFrom ? (
            <div>
              <dt>{ar ? 'وقت الدخول' : 'Check-in'}</dt>
              <dd dir="ltr">{detail.checkInFrom}</dd>
            </div>
          ) : null}
          {detail.dayUseCheckOutUntil ? (
            <div>
              <dt>{ar ? 'الخروج (بدون مبيت)' : 'Check-out (day use)'}</dt>
              <dd dir="ltr">{detail.dayUseCheckOutUntil}</dd>
            </div>
          ) : null}
          {(detail.overnightCheckOutUntil ?? detail.checkOutUntil) ? (
            <div>
              <dt>{ar ? 'الخروج (عند المبيت)' : 'Check-out (overnight)'}</dt>
              <dd dir="ltr">{detail.overnightCheckOutUntil ?? detail.checkOutUntil}</dd>
            </div>
          ) : null}
          {detail.dayUseMaxGuests != null ? (
            <div>
              <dt>{ar ? 'ضيوف بدون مبيت' : 'Guests (day use)'}</dt>
              <dd>{detail.dayUseMaxGuests}</dd>
            </div>
          ) : null}
          {detail.overnightMaxGuests != null ? (
            <div>
              <dt>{ar ? 'ضيوف مع المبيت' : 'Guests (overnight)'}</dt>
              <dd>{detail.overnightMaxGuests}</dd>
            </div>
          ) : null}
          {detail.depositMinor ? (
            <div>
              <dt>{ar ? 'مبلغ التأمين' : 'Security deposit'}</dt>
              <dd dir="ltr">{formatMoney(detail.depositMinor, currency, locale)}</dd>
            </div>
          ) : null}
        </dl>
      ) : null}

      {rates.length ? (
        <div className="stay-guest-info__rates">
          <h3>{ar ? 'مبالغ الإقامة' : 'Stay amounts'}</h3>
          <ul>
            {rates.map((rate) => (
              <li key={rate.key}>
                <span>{rate.label}</span>
                <strong dir="ltr">{formatMoney(rate.minor!, currency, locale)}</strong>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {policies.length ? (
        <div className="stay-guest-info__policies">
          <h3>{ar ? 'السياسات والشروط' : 'Policies & terms'}</h3>
          <ul>
            {policies.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        </div>
      ) : null}

      {instructions ? (
        <div className="stay-guest-info__instructions">
          <h3>{ar ? 'التعليمات' : 'Instructions'}</h3>
          <p>{instructions}</p>
        </div>
      ) : (
        <div className="stay-guest-info__instructions">
          <h3>{ar ? 'التعليمات' : 'Instructions'}</h3>
          <p className="muted">
            {ar
              ? 'تعليمات الوصول والاستخدام تُحدَّث من تقييمات الضيوف بعد انتهاء الإقامة، مع الالتزام بأوقات الدخول والخروج أعلاه.'
              : 'Access and house instructions are refined from guest reviews after checkout, alongside the check-in/out times above.'}
          </p>
        </div>
      )}

      {detail.smartScoreTen != null || detail.guestScoreTen != null ? (
        <div className="stay-guest-info__smart">
          <h3>{ar ? 'التقييم الذكي' : 'Smart rating'}</h3>
          <p>
            {detail.smartScoreTen != null ? (
              <>
                <strong dir="ltr">{detail.smartScoreTen.toFixed(1)}</strong>
                <span>/10</span>
              </>
            ) : null}
            {detail.guestScoreTen != null ? (
              <span className="muted">
                {' '}
                · {ar ? 'تقييم الضيوف' : 'Guest score'}{' '}
                <span dir="ltr">{detail.guestScoreTen.toFixed(1)}</span>
              </span>
            ) : null}
            {detail.occupancyPercent != null ? (
              <span className="muted">
                {' '}
                · {ar ? 'نسبة الإشغال' : 'Occupancy'}{' '}
                <span dir="ltr">{Math.round(detail.occupancyPercent)}%</span>
              </span>
            ) : null}
            {detail.stayReviewCount != null ? (
              <span className="muted">
                {' '}
                · {detail.stayReviewCount} {ar ? 'مراجعة إقامة' : 'stay reviews'}
              </span>
            ) : null}
          </p>
        </div>
      ) : null}
    </section>
  );
}
