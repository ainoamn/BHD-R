'use client';

import { useState } from 'react';
import type { StaySendMoment } from '@/lib/stay-guest-greeting';

/** The guest standing in a white dishdasha and embroidered kumma, holding the phone at x=200. */
function Guest() {
  return (
    <g aria-hidden="true">
      <ellipse cx="193" cy="146.6" rx="5" ry="1.8" fill="#5b4632" />
      <ellipse cx="207" cy="146.6" rx="5" ry="1.8" fill="#5b4632" />
      <rect x="195" y="58" width="10" height="14" fill="#c98d5f" />
      <path
        d="M185 146 L186.4 92 Q184 76 193 71.6 L196 70.4 H204 L207 71.6 Q216 76 213.6 92 L215 146 Z"
        fill="#fbfbf7"
        stroke="#d9d9cf"
        strokeWidth="0.8"
      />
      <path d="M194.4 70.8 Q200 77 205.6 70.8" fill="none" stroke="#d9d9cf" strokeWidth="0.8" />
      <path d="M200 75.5 V106" stroke="#cdbf9c" strokeWidth="1" />
      <path d="M198.4 105.6 L200 111.4 L201.6 105.6 Z" fill="#cdbf9c" />
      <g className="stay-send__head">
        <ellipse cx="189.6" cy="51" rx="1.8" ry="2.8" fill="#bb7f52" />
        <ellipse cx="210.4" cy="51" rx="1.8" ry="2.8" fill="#bb7f52" />
        <ellipse cx="200" cy="50" rx="10.5" ry="12.5" fill="#c98d5f" />
        <ellipse className="stay-send__glow" cx="200" cy="56" rx="8" ry="6" fill="#bfeee0" />
        <path
          d="M190 50 Q190 66 200 66.6 Q210 66 210 50 Q209 57 205 58.6 Q200 60 195 58.6 Q191 57 190 50 Z"
          fill="#2a201a"
        />
        <path d="M195.4 56.2 Q200 54.4 204.6 56.2 Q200 57.6 195.4 56.2 Z" fill="#2a201a" />
        <path d="M200 50.4 L199 54 H201" fill="none" stroke="#a9704a" strokeWidth="0.7" />
        <path
          d="M195 51.4 Q196.4 52.6 197.8 51.4 M202.2 51.4 Q203.6 52.6 205 51.4"
          fill="none"
          stroke="#2a201a"
          strokeWidth="0.9"
          strokeLinecap="round"
        />
        <path
          d="M193.6 47.4 H197.8 M202.2 47.4 H206.4"
          stroke="#2a201a"
          strokeWidth="0.9"
          strokeLinecap="round"
        />
        <path
          d="M189.2 45.4 Q188.6 30.6 200 30 Q211.4 30.6 210.8 45.4 Q200 41.8 189.2 45.4 Z"
          fill="url(#stay-send-kumma)"
          stroke="#cfc6b0"
          strokeWidth="0.6"
        />
        <path d="M189.6 42.6 Q200 38.6 210.4 42.6" fill="none" stroke="#7a8f6a" strokeWidth="0.8" />
      </g>
      <path
        d="M187 77 Q178 90 186.4 100.6 L195 97.6 Q188.6 91 191 80 Z"
        fill="#fbfbf7"
        stroke="#d9d9cf"
        strokeWidth="0.8"
      />
      <path
        d="M213 77 Q222 90 213.6 100.6 L205 97.6 Q211.4 91 209 80 Z"
        fill="#fbfbf7"
        stroke="#d9d9cf"
        strokeWidth="0.8"
      />
      <rect x="193" y="83" width="14" height="22" rx="2.2" fill="#1f2925" />
      <circle cx="196.2" cy="86.2" r="1" fill="#55625c" />
      <ellipse cx="193.6" cy="97.4" rx="3" ry="3.4" fill="#c98d5f" />
      <ellipse cx="206.4" cy="97.4" rx="3" ry="3.4" fill="#c98d5f" />
      <ellipse className="stay-send__thumb" cx="204.6" cy="86.4" rx="1.6" ry="2.2" fill="#bb7f52" />
    </g>
  );
}

/** The host's house in the distance, where the request lands. */
function HostHouse({ ar }: { ar: boolean }) {
  return (
    <g aria-hidden="true">
      <path
        d="M412 80 V75 h5 v3 h5 v-3 h5 v3 h5 v-3 h5 v3 h5 v-3 h5 v3 h5 v-3 h5 v5 Z"
        fill="#ead9b6"
      />
      <rect
        x="412"
        y="80"
        width="48"
        height="46"
        fill="#f3e6cc"
        stroke="#c9b48a"
        strokeWidth="0.8"
      />
      <path d="M430 126 V110 a6 6 0 0 1 12 0 V126 Z" fill="#7a4a22" />
      <path d="M417 98 V91 a3.5 3.5 0 0 1 7 0 V98 Z" fill="#2f6f8f" />
      <path d="M448 98 V91 a3.5 3.5 0 0 1 7 0 V98 Z" fill="#2f6f8f" />
      <rect x="463.4" y="54" width="1.2" height="72" fill="#8d9692" />
      <rect x="464.6" y="55" width="3.4" height="8" fill="#db161b" />
      <rect x="468" y="55" width="9" height="2.7" fill="#ffffff" />
      <rect x="468" y="57.7" width="9" height="2.6" fill="#db161b" />
      <rect x="468" y="60.3" width="9" height="2.7" fill="#008000" />
      <circle
        className="stay-send__ring"
        cx="436"
        cy="80"
        r="9"
        fill="none"
        stroke="#0b8f6a"
        strokeWidth="1.4"
      />
      <g className="stay-send__badge">
        <circle cx="457" cy="80" r="5.4" fill="#c8102e" stroke="#ffffff" strokeWidth="1" />
        <text x="457" y="82.2" textAnchor="middle" fontSize="6" fontWeight="800" fill="#ffffff">
          1
        </text>
      </g>
      <text x="436" y="137.4" textAnchor="middle" fontSize="6.4" fontWeight="700" fill="#4a5550">
        {ar ? 'المالك' : 'Host'}
      </text>
    </g>
  );
}

/** Leaf tips around the crown, as offsets from the top of the trunk. */
const PALM_LEAVES: ReadonlyArray<readonly [number, number]> = [
  [-24, 6],
  [-18, -10],
  [-4, -16],
  [12, -12],
  [22, 2],
  [14, 14],
  [-12, 14],
];

function Palm({ x }: { x: number }) {
  const tx = x + 2;
  const ty = 80;
  return (
    <g aria-hidden="true">
      <path
        d={`M${x} 127 Q${x - 3} 104 ${tx} ${ty}`}
        fill="none"
        stroke="#8a6a44"
        strokeWidth="3.4"
      />
      <g fill="#2f7d4f" stroke="#256a41" strokeWidth="0.5">
        {PALM_LEAVES.map(([dx, dy]) => (
          <path
            key={`${dx}:${dy}`}
            d={`M${tx} ${ty} Q${tx + dx * 0.5 - dy * 0.25} ${ty + dy * 0.5 + dx * 0.25} ${tx + dx} ${ty + dy} Q${tx + dx * 0.5 + dy * 0.1} ${ty + dy * 0.5 - dx * 0.1} ${tx} ${ty} Z`}
          />
        ))}
      </g>
    </g>
  );
}

/**
 * The first journey step: the guest sends the booking from their phone. The enlarged screen
 * shows the request with its reference; the tap sends a paper plane to the host's house.
 */
export function StaySendPhone({
  moment,
  plateNo,
  ar,
}: {
  moment: StaySendMoment;
  plateNo: string;
  ar: boolean;
}) {
  const [run, setRun] = useState(0);
  const request = moment.mode === 'request';
  return (
    <div className="stay-trip stay-send">
      <div className="stay-send__scene" key={run} role="img" aria-label={moment.status}>
        <svg viewBox="0 0 600 150" preserveAspectRatio="xMidYMid slice" aria-hidden="true">
          <defs>
            <pattern
              id="stay-send-kumma"
              width="4"
              height="4"
              patternUnits="userSpaceOnUse"
              patternTransform="rotate(45)"
            >
              <rect width="4" height="4" fill="#fbfbf7" />
              <rect width="1" height="4" fill="#b8860b" opacity="0.55" />
              <circle cx="2.6" cy="2" r="0.55" fill="#7a8f6a" />
            </pattern>
          </defs>
          <circle cx="540" cy="30" r="11" fill="#ffd864" />
          <g className="stay-send__cloud" fill="#ffffff" opacity="0.9">
            <ellipse cx="90" cy="30" rx="18" ry="6" />
            <ellipse cx="102" cy="26" rx="10" ry="6" />
          </g>
          <g className="stay-send__cloud stay-send__cloud--slow" fill="#ffffff" opacity="0.8">
            <ellipse cx="380" cy="22" rx="14" ry="4.6" />
            <ellipse cx="390" cy="19" rx="8" ry="4.6" />
          </g>
          <rect x="0" y="126" width="600" height="24" fill="#e8d3a8" />
          <path d="M0 126 H600" stroke="#d5bb88" strokeWidth="1" />
          <Palm x={140} />
          <Palm x={520} />
          <HostHouse ar={ar} />
          <path
            className="stay-send__trail"
            d="M286 102 Q360 10 432 72"
            pathLength="1"
            fill="none"
            stroke="#0d5c45"
            strokeOpacity="0.35"
            strokeWidth="1.2"
            strokeLinecap="round"
          />
          <Guest />
          <path
            d="M207 85 L250 34 M207 101 L250 112"
            stroke="#9aa6a0"
            strokeWidth="0.8"
            strokeDasharray="2 2.4"
          />
          <rect x="250" y="16" width="72" height="108" rx="9" fill="#1f2925" />
          <rect x="254" y="22" width="64" height="96" rx="5" fill="#ffffff" />
          <rect x="278" y="18.4" width="16" height="2.2" rx="1.1" fill="#3a4540" />
          <path d="M254 35 V27 Q254 22 259 22 H313 Q318 22 318 27 V35 Z" fill="#0d5c45" />
          <text x="286" y="30.8" textAnchor="middle" fontSize="5" fontWeight="700" fill="#ffffff">
            {request ? (ar ? 'طلب حجز إقامة' : 'STAY REQUEST') : ar ? 'حجز إقامة' : 'BOOK A STAY'}
          </text>
          <text
            x="286"
            y="43.6"
            textAnchor="middle"
            fontSize="5"
            fontWeight="700"
            fill="#1f2924"
            fontFamily="ui-monospace, Consolas, monospace"
          >
            {plateNo}
          </text>
          <g fill="#0d5c45" opacity="0.75">
            <rect x="259" y="49" width="4.4" height="4.4" rx="0.8" />
            <rect x="259" y="57" width="4.4" height="4.4" rx="0.8" />
            <rect x="259" y="65" width="4.4" height="4.4" rx="0.8" />
          </g>
          <g fill="#dfe5e2">
            <rect x="266" y="50.2" width="42" height="2.2" rx="1.1" />
            <rect x="266" y="58.2" width="34" height="2.2" rx="1.1" />
            <rect x="266" y="66.2" width="46" height="2.2" rx="1.1" />
          </g>
          <path d="M258 74.6 H314" stroke="#e5ebe8" strokeWidth="0.8" />
          <rect
            x="259"
            y="79"
            width="4.4"
            height="4.4"
            rx="0.8"
            fill="none"
            stroke="#0d5c45"
            strokeWidth="0.8"
          />
          <path
            d="M260 81.2 L261.2 82.4 L263 80"
            fill="none"
            stroke="#0d5c45"
            strokeWidth="0.8"
            strokeLinecap="round"
          />
          <rect x="266" y="80.2" width="38" height="2.2" rx="1.1" fill="#dfe5e2" />
          <g className="stay-send__button">
            <rect x="258" y="96" width="56" height="12" rx="6" fill="#0d5c45" />
            <text
              x="286"
              y="103.8"
              textAnchor="middle"
              fontSize="5"
              fontWeight="700"
              fill="#ffffff"
            >
              {request ? (ar ? 'إرسال الطلب' : 'Send request') : ar ? 'احجز الآن' : 'Book now'}
            </text>
          </g>
          <g className="stay-send__sent">
            <rect x="258" y="96" width="56" height="12" rx="6" fill="#0b8f6a" />
            <text
              x="286"
              y="103.8"
              textAnchor="middle"
              fontSize="5"
              fontWeight="700"
              fill="#ffffff"
            >
              {request ? (ar ? 'تم الإرسال ✓' : 'Sent ✓') : ar ? 'تم الحجز ✓' : 'Booked ✓'}
            </text>
          </g>
          <circle
            className="stay-send__ripple"
            cx="290"
            cy="102"
            r="4"
            fill="none"
            stroke="#ffffff"
            strokeWidth="1.2"
          />
          <ellipse
            className="stay-send__finger"
            cx="292"
            cy="106"
            rx="4"
            ry="5.4"
            fill="#c98d5f"
            opacity="0.92"
          />
          <g className="stay-send__plane">
            <path
              d="M279 99 L294 102.5 L279 106 L282 102.5 Z"
              fill="#ffffff"
              stroke="#0d5c45"
              strokeWidth="0.8"
            />
            <path d="M282 102.5 H294" stroke="#0d5c45" strokeWidth="0.6" />
          </g>
        </svg>
      </div>
      <div className="stay-trip__board">
        <span className="stay-trip__type">
          {request ? (ar ? 'تقديم الطلب' : 'Request sent') : ar ? 'الحجز' : 'Booked'}
        </span>
        <span className="stay-trip__plate" dir="ltr">
          {plateNo}
        </span>
        <strong className="stay-trip__status">
          <i aria-hidden="true" />
          {moment.status}
        </strong>
        <button type="button" onClick={() => setRun((value) => value + 1)}>
          {request
            ? ar
              ? 'شاهد الإرسال مجدداً'
              : 'Replay sending'
            : ar
              ? 'شاهد الحجز مجدداً'
              : 'Replay booking'}
        </button>
      </div>
    </div>
  );
}
