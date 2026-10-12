'use client';

import { useState } from 'react';
import type { StayTripMoment } from '@/lib/stay-guest-greeting';

/** Omani-style house with a crenellated parapet; the door sits at x≈292 on the kerb (y=116). */
function House() {
  return (
    <g className="stay-trip__house">
      <path
        d="M206 116 V62 h4 v-6 h8 v6 h8 v-6 h8 v6 h8 v-6 h8 v6 h8 v-6 h8 v6 h8 v-6 h8 v6 h8 v-6 h8 v6 h8 v-6 h8 v6 h8 v-6 h8 v6 h8 v-6 h4 v6 h4 V116 Z"
        fill="#f6efe2"
        stroke="#d9cbb3"
        strokeWidth="1"
      />
      <rect x="206" y="70" width="122" height="3" fill="#e4d6bd" />
      <path className="stay-trip__window" d="M224 104 V88 a8 8 0 0 1 16 0 V104 Z" />
      <path className="stay-trip__window" d="M250 104 V88 a8 8 0 0 1 16 0 V104 Z" />
      <path className="stay-trip__window" d="M308 104 V88 a8 8 0 0 1 16 0 V104 Z" />
      <path d="M281 116 V92 a11 11 0 0 1 22 0 V116 Z" fill="#7a4a22" />
      <path d="M292 82 V116" stroke="#5c3517" strokeWidth="1" />
      <circle cx="288" cy="102" r="1.2" fill="#e8c27a" />
      <circle cx="296" cy="102" r="1.2" fill="#e8c27a" />
      <circle className="stay-trip__lamp" cx="308" cy="84" r="2.4" />
    </g>
  );
}

function Palm() {
  return (
    <g className="stay-trip__palm" aria-hidden="true">
      <path d="M186 116 C184 100 186 86 190 72" stroke="#8a6a43" strokeWidth="4" fill="none" />
      <path
        d="M190 72 C178 66 168 70 162 78 M190 72 C200 64 212 66 218 74 M190 72 C184 60 174 56 166 58 M190 72 C196 60 206 56 214 58 M190 72 C190 62 192 56 196 52"
        stroke="#3f8a4f"
        strokeWidth="3.4"
        strokeLinecap="round"
        fill="none"
      />
    </g>
  );
}

/** White SUV facing right; rear (boot) at x=0, wheels touch y≈49.5 in its own coordinates. */
function Car() {
  return (
    <g className="stay-trip__car">
      <g className="stay-trip__car-body">
        <path d="M4 20 h26 v4 H4 Z" fill="#2a2f2c" />
        <path
          d="M30 22 L40 8 Q41.5 6 44 6 L84 6 Q87 6 89 8 L101 22 Z"
          fill="#fbfdfc"
          stroke="#c9d3ce"
          strokeWidth="0.8"
        />
        <path d="M35 21 L43 10 H62 V21 Z" fill="#9cc7dc" />
        <path d="M66 21 V10 H85 L95 21 Z" fill="#9cc7dc" />
        <path d="M44 4 H82" stroke="#6f7c76" strokeWidth="1.6" strokeLinecap="round" />
        <path
          d="M2 26 Q2 22 8 22 H102 Q110 23 111 30 V38 Q111 41 108 41 H5 Q2 41 2 38 Z"
          fill="#fbfdfc"
          stroke="#c9d3ce"
          strokeWidth="0.8"
        />
        <rect x="2" y="30" width="109" height="2.4" fill="#0b8f8a" />
        <rect x="104" y="25" width="6" height="3.4" rx="1" fill="#ffe08a" />
        <rect x="2" y="25" width="3.4" height="4" rx="1" fill="#d6453b" />
        <path d="M64 25 h6" stroke="#9aa6a0" strokeWidth="1.2" strokeLinecap="round" />
        <g className="stay-trip__boot">
          <rect x="2" y="18.6" width="29" height="4.2" rx="1.6" fill="#fbfdfc" stroke="#c9d3ce" />
        </g>
      </g>
      {[24, 89].map((cx) => (
        <g key={cx} className="stay-trip__wheel">
          <circle cx={cx} cy="41" r="8.5" fill="#1f2421" />
          <circle cx={cx} cy="41" r="4" fill="#c4ccc8" />
          <path
            d={`M${cx - 3.6} 41 H${cx + 3.6} M${cx} 37.4 V44.6`}
            stroke="#6f7c76"
            strokeWidth="1"
          />
        </g>
      ))}
    </g>
  );
}

/** Each bag is drawn with its bottom-centre at (0,0). */
const BAGS = [
  <g key="suitcase">
    <rect x="-6" y="-15" width="12" height="15" rx="2" fill="#e8703a" />
    <path d="M-2.5 -15 V-18 H2.5 V-15" stroke="#7a3a1a" strokeWidth="1.2" fill="none" />
    <path d="M-6 -9 H6" stroke="#c4551f" strokeWidth="1" />
  </g>,
  <g key="duffel">
    <rect x="-8" y="-9" width="16" height="9" rx="4" fill="#2f6fb0" />
    <path d="M-4 -9 Q0 -14 4 -9" stroke="#1d4c7c" strokeWidth="1.2" fill="none" />
  </g>,
  <g key="box">
    <rect x="-5" y="-12" width="10" height="12" rx="1.5" fill="#f2c14e" />
    <path d="M-5 -8 H5" stroke="#c99a2a" strokeWidth="1" />
  </g>,
];

/**
 * A small street scene: on arrival the car pulls up and the bags hop into the
 * house; on departure they hop back into the boot and the car drives off.
 * The booking reference sits on the number plate.
 */
export function StayTrip({
  moment,
  plateNo,
  ar,
}: {
  moment: StayTripMoment;
  plateNo: string;
  ar: boolean;
}) {
  const [run, setRun] = useState(0);
  const arriving = moment.kind === 'arrive';
  return (
    <div className={`stay-trip stay-trip--${moment.kind}`}>
      <div className="stay-trip__scene" key={run} role="img" aria-label={moment.status}>
        <svg viewBox="0 0 600 150" preserveAspectRatio="xMidYMid slice" aria-hidden="true">
          <circle className="stay-trip__sun" cx="470" cy="34" r="15" />
          <g className="stay-trip__clouds">
            <ellipse cx="90" cy="30" rx="26" ry="7" />
            <ellipse cx="104" cy="25" rx="13" ry="8" />
            <ellipse cx="380" cy="22" rx="20" ry="5.5" />
            <ellipse cx="390" cy="18" rx="10" ry="6" />
            <ellipse cx="560" cy="44" rx="18" ry="5" />
          </g>
          <path
            className="stay-trip__hills"
            d="M0 104 L40 84 L78 98 L130 70 L176 96 L236 80 L300 98 L372 66 L430 92 L490 76 L548 96 L600 82 V116 H0 Z"
          />
          <Palm />
          <House />
          <rect x="0" y="112" width="600" height="8" fill="#e9dcc2" />
          <rect x="0" y="120" width="600" height="30" fill="#4a524e" />
          <path d="M0 135 H600" stroke="#f1efe6" strokeWidth="1.6" strokeDasharray="16 14" />
          <circle className="stay-trip__puff stay-trip__puff--a" cx="343" cy="136" r="4" />
          <circle className="stay-trip__puff stay-trip__puff--b" cx="338" cy="133" r="3" />
          <g transform="translate(345 96.5)">
            <Car />
          </g>
          {BAGS.map((bag, index) => (
            <g key={index} transform={`translate(${352 + index * 7} 118)`}>
              <g className={`stay-trip__bag stay-trip__bag--${index + 1}`}>{bag}</g>
            </g>
          ))}
        </svg>
      </div>
      <div className="stay-trip__board">
        <span className="stay-trip__type">
          {arriving ? (ar ? 'وصول' : 'Arrival') : ar ? 'مغادرة' : 'Departure'}
        </span>
        <span className="stay-trip__plate" dir="ltr">
          {plateNo}
        </span>
        <strong className="stay-trip__status">
          <i aria-hidden="true" />
          {moment.status}
        </strong>
        {moment.kind === 'parked' ? null : (
          <button type="button" onClick={() => setRun((value) => value + 1)}>
            {arriving
              ? ar
                ? 'شاهد الوصول مجدداً'
                : 'Replay arrival'
              : ar
                ? 'شاهد المغادرة مجدداً'
                : 'Replay departure'}
          </button>
        )}
      </div>
    </div>
  );
}
