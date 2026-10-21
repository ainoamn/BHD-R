import { Link } from '@/i18n/navigation';
import { formatMoney } from '@/lib/format';
import {
  buildStayBookingTimeline,
  type StayBookingTimelineFacts,
} from '@/lib/stay-booking-timeline';

function formatStamp(value: string, ar: boolean, short = false): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat(ar ? 'ar-OM-u-nu-latn' : 'en-GB', {
    day: 'numeric',
    month: short ? 'short' : 'long',
    ...(short ? {} : { year: 'numeric' as const }),
    hour: 'numeric',
    minute: '2-digit',
    timeZone: 'Asia/Muscat',
  }).format(date);
}

/** Stages, pending items, the next action and the full log of a stay booking for the host. */
export function StayBookingTimelineSection({
  facts,
  bookingId,
  propertyId,
  status,
  bookingMode,
  createdAt,
  currency,
  locale,
  portal,
}: {
  facts: StayBookingTimelineFacts;
  bookingId: string;
  propertyId: string;
  status: string;
  bookingMode: string;
  createdAt: string;
  currency: string;
  locale: string;
  portal: 'owner' | 'developer';
}) {
  const ar = locale === 'ar';
  const timeline = buildStayBookingTimeline(
    { bookingId, propertyId, status, bookingMode, createdAt, facts, portal },
    ar,
    (minor) => formatMoney(minor, currency, locale),
    (iso) => formatStamp(iso, ar),
  );

  const logKey = `${facts.history.length}:${facts.history[facts.history.length - 1]?.at ?? ''}:${facts.payments.length}`;

  return (
    <section
      key={logKey}
      className="stay-doc__section stay-timeline"
      aria-labelledby="stay-timeline-title"
    >
      <h2 id="stay-timeline-title">{ar ? 'مسار الحجز ومستجداته' : 'Booking progress'}</h2>
      {timeline.steps.length ? (
        <ol className="stay-timeline__steps">
          {timeline.steps.map((step) => (
            <li key={step.key} className="stay-timeline__step" data-state={step.state}>
              <span className="stay-timeline__dot" aria-hidden="true">
                {step.state === 'done' ? '✓' : ''}
              </span>
              <strong>{step.label}</strong>
              {step.at ? <small>{formatStamp(step.at, ar, true)}</small> : null}
              {step.state === 'current' ? (
                <small className="stay-timeline__now">
                  {ar ? 'المرحلة الحالية' : 'Current stage'}
                </small>
              ) : null}
            </li>
          ))}
        </ol>
      ) : null}

      {timeline.waiting.length || timeline.next ? (
        <div className="stay-timeline__pending">
          {timeline.waiting.map((line) => (
            <p key={line}>{line}</p>
          ))}
          {timeline.next ? (
            <Link className="button button--primary stay-timeline__next" href={timeline.next.href}>
              {timeline.next.label}
            </Link>
          ) : null}
        </div>
      ) : null}

      <h3 className="stay-timeline__log-title">
        {ar ? 'سجل الحجز · الأحدث أولاً' : 'Booking log · newest first'}
      </h3>
      <ol className="stay-timeline__log">
        {timeline.events.map((event) => (
          <li key={event.key} className="stay-timeline__event" data-tone={event.tone}>
            <time dateTime={event.at}>{formatStamp(event.at, ar)}</time>
            <strong>{event.title}</strong>
            {event.by ? (
              <span className="stay-timeline__by">
                {ar ? 'بواسطة' : 'By'} {event.by}
              </span>
            ) : null}
            {event.detail ? <p className="stay-timeline__detail">{event.detail}</p> : null}
          </li>
        ))}
      </ol>
    </section>
  );
}
