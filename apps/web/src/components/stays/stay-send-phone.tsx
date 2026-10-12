'use client';

import { useState } from 'react';
import type { StaySendMoment } from '@/lib/stay-guest-greeting';
import { Guest, HostHouse, PaperPlane, SceneBackdrop, SceneDefs } from './stay-scene-parts';

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
      <div className="stay-scene" key={run} role="img" aria-label={moment.status}>
        <svg viewBox="0 0 600 150" preserveAspectRatio="xMidYMid slice" aria-hidden="true">
          <SceneDefs />
          <SceneBackdrop />
          <HostHouse ar={ar}>
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
              <text
                x="457"
                y="82.2"
                textAnchor="middle"
                fontSize="6"
                fontWeight="800"
                fill="#ffffff"
              >
                1
              </text>
            </g>
          </HostHouse>
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
          <PaperPlane className="stay-send__plane" x={286} y={102.5} />
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
