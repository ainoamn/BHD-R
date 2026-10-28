import {
  buildReservationActivityLog,
  type ReservationActivityRow,
} from '@/lib/lease-reservation-timeline';

function formatStamp(value: string, ar: boolean): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat(ar ? 'ar-OM-u-nu-latn' : 'en-GB', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    timeZone: 'Asia/Muscat',
  }).format(date);
}

/** Owner / property-management only — full dated trail of who did what on a booking or contract. */
export function ReservationActivityLog({
  rows,
  locale,
  title,
}: {
  rows: ReservationActivityRow[];
  locale: string;
  title?: { ar: string; en: string };
}) {
  const ar = locale === 'ar';
  const events = buildReservationActivityLog(rows, ar);
  const heading = title
    ? ar
      ? title.ar
      : title.en
    : ar
      ? 'سجل المعاملة'
      : 'Transaction log';

  return (
    <section className="stay-timeline reservation-activity-log" aria-labelledby="reservation-activity-title">
      <h2 id="reservation-activity-title">{heading}</h2>
      <p className="muted reservation-activity-log__hint">
        {ar
          ? 'للمالك وإدارة العقار فقط — كل خطوة بتاريخها ووقتها ومن نفّذها.'
          : 'Owner / property management only — every step with date, time, and who acted.'}
      </p>
      {events.length ? (
        <>
          <h3 className="stay-timeline__log-title">
            {ar ? 'الأحدث أولاً' : 'Newest first'}
          </h3>
          <ol className="stay-timeline__log">
            {events.map((event) => (
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
        </>
      ) : (
        <p className="muted" role="status">
          {ar ? 'لا أحداث مسجّلة بعد لهذا الملف.' : 'No events recorded for this file yet.'}
        </p>
      )}
    </section>
  );
}
