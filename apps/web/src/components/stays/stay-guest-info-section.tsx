'use client';

import type { ReactNode } from 'react';
import { Fragment } from 'react';
import { formatMoney, localizedName } from '@/lib/format';
import type { StayPublicDetail } from '@bhd-r/contracts';
import { StayPolicySections } from '@/components/stays/stay-policy-sections';

function InfoRows({
  rows,
}: {
  rows: Array<{ label: string; value: ReactNode; dir?: 'ltr' | 'rtl' }>;
}) {
  return (
    <dl className="stay-info-rows">
      {rows.map((row) => (
        <div key={row.label} className="stay-info-rows__row">
          <dt>{row.label}</dt>
          <dd dir={row.dir}>{row.value}</dd>
        </div>
      ))}
    </dl>
  );
}

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

  const guestRows = [
    detail.dayUseMaxGuests != null
      ? {
          label: ar ? 'عدد الضيوف المسموح (بدون مبيت)' : 'Guests allowed (day use)',
          value: detail.dayUseMaxGuests,
        }
      : null,
    detail.overnightMaxGuests != null
      ? {
          label: ar ? 'عدد الضيوف المسموح (مع المبيت)' : 'Guests allowed (overnight)',
          value: detail.overnightMaxGuests,
        }
      : null,
  ].filter(Boolean) as Array<{ label: string; value: ReactNode }>;

  const timeRows = [
    detail.checkInFrom
      ? { label: ar ? 'وقت الدخول' : 'Check-in', value: detail.checkInFrom, dir: 'ltr' as const }
      : null,
    detail.dayUseCheckOutUntil
      ? {
          label: ar ? 'وقت الخروج (بدون مبيت)' : 'Check-out (day use)',
          value: detail.dayUseCheckOutUntil,
          dir: 'ltr' as const,
        }
      : null,
    (detail.overnightCheckOutUntil ?? detail.checkOutUntil)
      ? {
          label: ar ? 'وقت الخروج (عند المبيت)' : 'Check-out (overnight)',
          value: detail.overnightCheckOutUntil ?? detail.checkOutUntil,
          dir: 'ltr' as const,
        }
      : null,
  ].filter(Boolean) as Array<{ label: string; value: ReactNode; dir?: 'ltr' | 'rtl' }>;

  const hasPolicies = Boolean(
    detail.policiesJson ||
      detail.policiesAr?.trim() ||
      detail.policiesEn?.trim(),
  );

  if (
    !hasPolicies &&
    !instructions &&
    !rates.length &&
    !timeRows.length &&
    !detail.depositMinor &&
    !guestRows.length
  ) {
    return null;
  }

  return (
    <Fragment>
      {timeRows.length ? (
        <section
          className="stay-guest-info property-360__section"
          aria-labelledby="stay-guest-info-title"
        >
          <h2 id="stay-guest-info-title">{ar ? 'أوقات الدخول والخروج' : 'Check-in & check-out'}</h2>
          <InfoRows rows={timeRows} />
        </section>
      ) : null}

      {guestRows.length ? (
        <section className="stay-guest-info property-360__section">
          <h2>{ar ? 'سعة الضيوف' : 'Guest capacity'}</h2>
          <InfoRows rows={guestRows} />
        </section>
      ) : null}

      {detail.depositMinor ? (
        <section className="stay-guest-info property-360__section">
          <h2>{ar ? 'مبلغ التأمين' : 'Security deposit'}</h2>
          <InfoRows
            rows={[
              {
                label: ar ? 'قيمة التأمين' : 'Deposit amount',
                value: formatMoney(detail.depositMinor, currency, locale),
                dir: 'ltr',
              },
            ]}
          />
          <ul className="stay-policy-sections__list stay-guest-info__deposit-note">
            <li>
              {ar
                ? 'يُدفع مبلغ التأمين عند الوصول ويُسترد بعد المغادرة وفحص العقار.'
                : 'The deposit is paid on arrival and refunded after checkout and property inspection.'}
            </li>
          </ul>
        </section>
      ) : null}

      {rates.length ? (
        <section className="stay-guest-info property-360__section">
          <h2>{ar ? 'مبالغ الإقامة' : 'Stay amounts'}</h2>
          <InfoRows
            rows={rates.map((rate) => ({
              label: rate.label,
              value: formatMoney(rate.minor!, currency, locale),
              dir: 'ltr' as const,
            }))}
          />
        </section>
      ) : null}

      {hasPolicies ? (
        <section className="stay-guest-info stay-guest-info__policies property-360__section">
          <StayPolicySections detail={detail} locale={locale} />
        </section>
      ) : null}

      {instructions ? (
        <section className="stay-guest-info property-360__section">
          <h2>{ar ? 'التعليمات' : 'Instructions'}</h2>
          <p>{instructions}</p>
        </section>
      ) : (
        <section className="stay-guest-info property-360__section">
          <h2>{ar ? 'التعليمات' : 'Instructions'}</h2>
          <p className="muted">
            {ar
              ? 'تعليمات الوصول والاستخدام تُحدَّث من تقييمات الضيوف بعد انتهاء الإقامة، مع الالتزام بأوقات الدخول والخروج أعلاه.'
              : 'Access and house instructions are refined from guest reviews after checkout, alongside the check-in/out times above.'}
          </p>
        </section>
      )}

      {detail.smartScoreTen != null || detail.guestScoreTen != null ? (
        <section className="stay-guest-info stay-guest-info__smart property-360__section">
          <h2>{ar ? 'التقييم الذكي' : 'Smart rating'}</h2>
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
        </section>
      ) : null}
    </Fragment>
  );
}
