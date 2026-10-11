'use client';

import { useState } from 'react';
import type { StayFlightMoment } from '@/lib/stay-guest-greeting';

function Plane() {
  return (
    <svg className="stay-flight__plane" viewBox="0 0 120 44" aria-hidden="true">
      <path d="M10 24 L4 4 L14 4 L30 18 Z" fill="#0b623c" />
      <path d="M8 22 L2 27 L10 27 L22 23 Z" fill="#0b623c" />
      <path d="M31 31 L31 39 M91 31 L91 39" stroke="#55635c" strokeWidth="1.6" />
      <circle cx="31" cy="41" r="2.6" fill="#26302b" />
      <circle cx="91" cy="41" r="2.6" fill="#26302b" />
      <path
        d="M8 24 C8 19 14 17 22 17 L94 17 C106 17 115 20 118 24 C115 28 106 31 94 31 L22 31 C14 31 8 29 8 24 Z"
        fill="#fff"
        stroke="#d3ddd7"
        strokeWidth="0.8"
      />
      <rect x="22" y="26" width="72" height="1.6" fill="#0b623c" />
      {Array.from({ length: 10 }, (_, index) => (
        <circle key={index} cx={34 + index * 6} cy="22" r="1.3" fill="#10372a" opacity="0.7" />
      ))}
      <path d="M100 19 C106 19.5 111 21 113 22.5 L100 22.5 Z" fill="#10372a" />
      <path d="M48 26 L36 40 L46 40 L72 26 Z" fill="#bcd6c8" />
      <ellipse cx="55" cy="33.5" rx="7" ry="2.6" fill="#8fb3a1" />
    </svg>
  );
}

/** A small airport scene: the stay's arrival lands, its departure takes off. Booking reference = flight number. */
export function StayFlight({
  moment,
  flightNo,
  ar,
}: {
  moment: StayFlightMoment;
  flightNo: string;
  ar: boolean;
}) {
  const [run, setRun] = useState(0);
  const arriving = moment.kind === 'landing';
  return (
    <div className={`stay-flight stay-flight--${moment.kind}`}>
      <div className="stay-flight__scene" key={run} role="img" aria-label={moment.status}>
        <span className="stay-flight__sun" />
        <span className="stay-flight__cloud stay-flight__cloud--a" />
        <span className="stay-flight__cloud stay-flight__cloud--b" />
        <span className="stay-flight__cloud stay-flight__cloud--c" />
        <span className="stay-flight__runway" />
        <span className="stay-flight__puff" />
        <Plane />
      </div>
      <div className="stay-flight__board">
        <span className="stay-flight__type">
          {arriving ? (ar ? 'وصول' : 'Arrival') : ar ? 'مغادرة' : 'Departure'}
        </span>
        <span className="stay-flight__no" dir="ltr">
          ✈ {flightNo}
        </span>
        <strong className="stay-flight__status">
          <i aria-hidden="true" />
          {moment.status}
        </strong>
        {moment.kind === 'ready' ? null : (
          <button type="button" onClick={() => setRun((value) => value + 1)}>
            {arriving
              ? ar
                ? 'شاهد الهبوط مجدداً'
                : 'Replay landing'
              : ar
                ? 'شاهد الإقلاع مجدداً'
                : 'Replay take-off'}
          </button>
        )}
      </div>
    </div>
  );
}
