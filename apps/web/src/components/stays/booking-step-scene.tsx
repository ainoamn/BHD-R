'use client';

import { useState, type CSSProperties, type ReactNode } from 'react';
import type { BookingSceneKind, BookingStepGreeting } from '@/lib/booking-step-greeting';
import { Guest, HostHouse, PaperPlane, SceneBackdrop, SceneDefs } from './stay-scene-parts';

const delay = (seconds: number): CSSProperties => ({ animationDelay: `${seconds}s` });

/** Calendar: two days picked one after the other, joined by a band, then the guests. */
function StayScreen() {
  const columns = [259, 270.5, 282, 293.5, 305];
  const rows = [41, 50.5, 60];
  return (
    <>
      <g fill="#e7eeeb">
        {rows.map((y) =>
          columns.map((x) => <rect key={`${x}:${y}`} x={x} y={y} width="8" height="7" rx="1.4" />),
        )}
      </g>
      <rect
        className="booking-scene__band"
        x="272"
        y="51.5"
        width="30"
        height="5"
        rx="2.5"
        fill="#bfe3d4"
        style={delay(0.55)}
      />
      <rect
        className="booking-scene__pop"
        x="270.5"
        y="50.5"
        width="8"
        height="7"
        rx="1.4"
        fill="#0d5c45"
        style={delay(0.2)}
      />
      <rect
        className="booking-scene__pop"
        x="293.5"
        y="50.5"
        width="8"
        height="7"
        rx="1.4"
        fill="#0d5c45"
        style={delay(0.4)}
      />
      <g className="booking-scene__pop" style={delay(0.6)}>
        <circle cx="266" cy="77" r="3" fill="#f2c94c" />
        <path d="M262 85 Q266 79.5 270 85 Z" fill="#f2c94c" />
        <circle cx="276" cy="77" r="3" fill="#e8703a" />
        <path d="M272 85 Q276 79.5 280 85 Z" fill="#e8703a" />
        <path d="M290 72.4 a4.6 4.6 0 1 0 4.4 6.4 a3.6 3.6 0 1 1 -4.4 -6.4 Z" fill="#5b6ea8" />
        <circle cx="307" cy="77" r="3.4" fill="#ffd864" />
      </g>
    </>
  );
}

/** Guest card: photo, then the name, phone and email lines typed in, then a tick. */
function DetailsScreen() {
  return (
    <>
      <rect x="259" y="40" width="54" height="34" rx="3" fill="#f3f8f6" stroke="#cfe2da" />
      <circle cx="269.5" cy="52" r="6" fill="#c98d5f" />
      <path d="M263.6 50 Q264 44.6 269.5 44.4 Q275 44.6 275.4 50 Z" fill="url(#stay-scene-kumma)" />
      <path d="M262 68 Q269.5 59 277 68 Z" fill="#fbfbf7" stroke="#d9d9cf" strokeWidth="0.6" />
      {[47, 54, 61].map((y, index) => (
        <rect
          key={y}
          className="booking-scene__type"
          x="281"
          y={y}
          width={index === 1 ? 22 : 28}
          height="2.6"
          rx="1.3"
          fill={index === 0 ? '#0d5c45' : '#9fb7ad'}
          style={delay(0.2 + index * 0.2)}
        />
      ))}
      <g className="booking-scene__pop" style={delay(0.75)}>
        <circle cx="306" cy="69" r="4" fill="#0b8f6a" />
        <path
          d="M304.2 69 L305.6 70.4 L308 67.8"
          fill="none"
          stroke="#ffffff"
          strokeWidth="1"
          strokeLinecap="round"
        />
      </g>
      <g fill="none" stroke="#9fb7ad" strokeWidth="0.9">
        <rect x="261" y="79" width="9" height="6.4" rx="1" />
        <path d="M261 79.4 L265.5 83 L270 79.4" />
      </g>
      <rect x="274" y="81" width="34" height="2.4" rx="1.2" fill="#dfe5e2" />
    </>
  );
}

/** Terms: the lines of the contract, the guest's signature drawn, and the seal stamped. */
function TermsScreen() {
  return (
    <>
      <rect x="259" y="39" width="54" height="50" rx="2" fill="#fffdf6" stroke="#e7dcc0" />
      {[44, 49, 54, 59, 64].map((y, index) => (
        <rect
          key={y}
          className="booking-scene__type"
          x="263"
          y={y}
          width={index % 2 ? 38 : 46}
          height="2"
          rx="1"
          fill="#d9cfb4"
          style={delay(0.1 + index * 0.08)}
        />
      ))}
      <path
        className="booking-scene__draw"
        d="M263 80 q3 -7 6 -1 t6 -1 t6 0 q2 -3 4 1"
        pathLength="1"
        fill="none"
        stroke="#1f3b6e"
        strokeWidth="1"
        strokeLinecap="round"
        style={delay(0.45)}
      />
      <g className="booking-scene__stamp" style={delay(0.7)}>
        <circle cx="301" cy="77" r="7" fill="none" stroke="#b8860b" strokeWidth="1.2" />
        <circle cx="301" cy="77" r="4.6" fill="#b8860b" opacity="0.18" />
        <path
          d="M298.4 77 L300.4 79 L304 75"
          fill="none"
          stroke="#b8860b"
          strokeWidth="1.2"
          strokeLinecap="round"
        />
      </g>
    </>
  );
}

/** Review: three rows ticked one by one while the magnifying glass passes over them. */
function ReviewScreen() {
  return (
    <>
      {[44, 57, 70].map((y, index) => (
        <g key={y}>
          <rect
            x="260"
            y={y}
            width="7"
            height="7"
            rx="1.4"
            fill="none"
            stroke="#0d5c45"
            strokeWidth="0.9"
          />
          <path
            className="booking-scene__pop"
            d={`M261.4 ${y + 3.6} L263.2 ${y + 5.4} L266 ${y + 1.8}`}
            fill="none"
            stroke="#0b8f6a"
            strokeWidth="1.3"
            strokeLinecap="round"
            style={delay(0.2 + index * 0.22)}
          />
          <rect
            x="271"
            y={y + 1}
            width={index === 1 ? 30 : 40}
            height="2.4"
            rx="1.2"
            fill="#c9d6d0"
          />
          <rect x="271" y={y + 4.6} width="22" height="1.8" rx="0.9" fill="#e5ebe8" />
        </g>
      ))}
      <g className="booking-scene__lens">
        <circle
          cx="305"
          cy="47"
          r="5.4"
          fill="rgb(191 238 224 / 0.45)"
          stroke="#5c3517"
          strokeWidth="1.4"
        />
        <path d="M309 51 L313 55" stroke="#5c3517" strokeWidth="2" strokeLinecap="round" />
      </g>
    </>
  );
}

/** Payment: the card, and the padlock that snaps shut. */
function PaymentScreen() {
  return (
    <>
      <rect x="260" y="40" width="52" height="30" rx="3.4" fill="#0d5c45" />
      <path
        d="M260 60 Q286 48 312 56 V66.6 Q312 70 308.6 70 H263.4 Q260 70 260 66.6 Z"
        fill="#0b8f6a"
      />
      <rect x="265" y="46" width="8" height="6" rx="1.2" fill="#e8c27a" />
      <path d="M265 49 H273 M269 46 V52" stroke="#b8860b" strokeWidth="0.5" />
      <g fill="#ffffff" opacity="0.85">
        {[265, 276, 287, 298].map((x) => (
          <rect key={x} x={x} y="58" width="8" height="2.2" rx="1.1" />
        ))}
      </g>
      <g className="booking-scene__shackle" style={delay(0.35)}>
        <path d="M282 80 V77 a4 4 0 0 1 8 0 V80" fill="none" stroke="#5f6b66" strokeWidth="1.6" />
      </g>
      <rect x="280" y="79.4" width="12" height="9" rx="1.8" fill="#b8860b" />
      <circle cx="286" cy="83.4" r="1.3" fill="#fff8e1" />
    </>
  );
}

const SCREENS: Record<BookingSceneKind, () => ReactNode> = {
  stay: StayScreen,
  details: DetailsScreen,
  terms: TermsScreen,
  review: ReviewScreen,
  payment: PaymentScreen,
};

/** What the phone header and its button say on each step. */
function screenWords(kind: BookingSceneKind, ar: boolean) {
  switch (kind) {
    case 'stay':
      return ar
        ? { head: 'اختر إقامتك', button: 'متابعة', sent: 'تم ✓' }
        : { head: 'PLAN YOUR STAY', button: 'Continue', sent: 'Done ✓' };
    case 'details':
      return ar
        ? { head: 'بياناتك', button: 'متابعة', sent: 'تم ✓' }
        : { head: 'YOUR DETAILS', button: 'Continue', sent: 'Done ✓' };
    case 'terms':
      return ar
        ? { head: 'الشروط والأحكام', button: 'أوافق', sent: 'تمت الموافقة ✓' }
        : { head: 'TERMS', button: 'I agree', sent: 'Agreed ✓' };
    case 'review':
      return ar
        ? { head: 'مراجعة الحجز', button: 'تأكيد الحجز', sent: 'تم التأكيد ✓' }
        : { head: 'REVIEW', button: 'Confirm', sent: 'Confirmed ✓' };
    case 'payment':
      return ar
        ? { head: 'دفع آمن', button: 'ادفع الآن', sent: 'تم الدفع ✓' }
        : { head: 'SECURE PAYMENT', button: 'Pay now', sent: 'Paid ✓' };
  }
}

/**
 * The booking wizard's picture for the current step, in the style of the guest's stay page:
 * the guest's phone, enlarged, shows the step; the tap sends it to the host's house.
 * Below it, a short warm greeting for the step.
 */
export function BookingStepScene({
  greeting,
  label,
  stepNo,
  stepCount,
  ar,
}: {
  greeting: BookingStepGreeting;
  label: string;
  stepNo: number;
  stepCount: number;
  ar: boolean;
}) {
  const { kind, status, heading, body } = greeting;
  const [run, setRun] = useState(0);
  const words = screenWords(kind, ar);
  const Screen = SCREENS[kind];
  const paying = kind === 'payment';
  return (
    <div className="booking-scene-block">
      <div className={`stay-trip stay-send booking-scene booking-scene--${kind}`}>
        <div className="stay-scene" key={`${kind}:${run}`} role="img" aria-label={status}>
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
                <circle cx="457" cy="80" r="5.4" fill="#0b8f6a" stroke="#ffffff" strokeWidth="1" />
                <path
                  d="M454.6 80 L456.4 81.8 L459.4 78.4"
                  fill="none"
                  stroke="#ffffff"
                  strokeWidth="1.1"
                  strokeLinecap="round"
                />
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
              {words.head}
            </text>
            <Screen />
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
                {words.button}
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
                {words.sent}
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
            {paying ? (
              <g className="stay-send__plane">
                <circle
                  cx="286"
                  cy="102.5"
                  r="5"
                  fill="#f2c94c"
                  stroke="#b8860b"
                  strokeWidth="0.8"
                />
                <circle cx="286" cy="102.5" r="3" fill="none" stroke="#b8860b" strokeWidth="0.5" />
              </g>
            ) : (
              <PaperPlane className="stay-send__plane" x={286} y={102.5} />
            )}
          </svg>
        </div>
        <div className="stay-trip__board">
          <span className="stay-trip__type">{label}</span>
          <span className="stay-trip__plate" dir="ltr">
            {stepNo} / {stepCount}
          </span>
          <strong className="stay-trip__status">
            <i aria-hidden="true" />
            {status}
          </strong>
          <button type="button" onClick={() => setRun((value) => value + 1)}>
            {ar ? 'شاهد مجدداً' : 'Replay'}
          </button>
        </div>
      </div>
      <div
        className={`guest-stay-detail__greeting booking-greeting${paying ? ' guest-stay-detail__greeting--payment' : ''}`}
        key={kind}
      >
        <h3>{heading}</h3>
        <p>{body}</p>
      </div>
    </div>
  );
}
