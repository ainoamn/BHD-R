'use client';

import { useState } from 'react';
import type { StayRefundMoment } from '@/lib/stay-guest-greeting';
import { Guest, HostHouse, PaperPlane, SceneBackdrop, SceneDefs } from './stay-scene-parts';

/** The deposit safe between the guest and the host's house (x 272–328), with its amount tag. */
function DepositSafe({ amount, ar }: { amount: string; ar: boolean }) {
  return (
    <g aria-hidden="true">
      <rect x="275" y="125" width="8" height="3" rx="1" fill="#3f4945" />
      <rect x="317" y="125" width="8" height="3" rx="1" fill="#3f4945" />
      <rect x="272" y="74" width="56" height="52" rx="4" fill="#5f6b66" stroke="#3f4945" />
      <rect x="276" y="78" width="48" height="44" rx="2" fill="#26302c" />
      <g fill="#f2c94c" stroke="#b8860b" strokeWidth="0.6">
        <ellipse cx="292" cy="117" rx="7" ry="2.4" />
        <ellipse cx="292" cy="113.6" rx="7" ry="2.4" />
        <ellipse cx="292" cy="110.2" rx="7" ry="2.4" />
        <ellipse cx="308" cy="117" rx="7" ry="2.4" />
        <ellipse cx="308" cy="113.6" rx="7" ry="2.4" />
      </g>
      <g className="stay-refund__door">
        <rect x="276" y="78" width="48" height="44" rx="2" fill="#75827c" stroke="#4a5550" />
        <rect x="282" y="82" width="36" height="8" rx="1.5" fill="#e8d3a8" />
        <text x="300" y="87.8" textAnchor="middle" fontSize="5" fontWeight="800" fill="#4a3a22">
          {ar ? 'التأمين' : 'DEPOSIT'}
        </text>
        <circle cx="298" cy="104" r="9" fill="#c9d1cd" stroke="#4a5550" strokeWidth="1" />
        <circle cx="298" cy="104" r="2.2" fill="#4a5550" />
        <path
          d="M298 96.4 V98.4 M298 109.6 V111.6 M290.4 104 H292.4 M303.6 104 H305.6"
          stroke="#4a5550"
          strokeWidth="0.8"
        />
        <rect x="314" y="98" width="4" height="12" rx="1.5" fill="#c9d1cd" stroke="#4a5550" />
      </g>
      <g className="stay-refund__tag">
        <path d="M322 74 L330 66" stroke="#8a6a44" strokeWidth="0.8" />
        <rect x="314" y="54" width="44" height="12" rx="3" fill="#ffffff" stroke="#c9b48a" />
        <circle cx="318" cy="60" r="1.2" fill="#c9b48a" />
        <text
          x="338"
          y="62.2"
          textAnchor="middle"
          fontSize="5.8"
          fontWeight="800"
          fill="#0d5c45"
          direction={ar ? 'rtl' : 'ltr'}
        >
          {amount}
        </text>
      </g>
    </g>
  );
}

/** Staggered coins; `stay-refund-coin` flies each from the safe (300,78) to the phone (200,92). */
const COINS = [0, 1, 2];

/**
 * Deposit refund step: the deposit in a safe between the guest and the host's house. Before
 * the request the tag swings and the phone pulses; the request flies to the host; the host's
 * answer shows on the house; once paid the safe opens and the coins fly to the guest's phone.
 */
export function StayRefundScene({
  moment,
  plateNo,
  ar,
}: {
  moment: StayRefundMoment;
  plateNo: string;
  ar: boolean;
}) {
  const [run, setRun] = useState(0);
  const { state } = moment;
  const paidAmount = moment.amount ?? moment.deposit;
  const status =
    state === 'open'
      ? ar
        ? 'تأمينك محفوظ · اطلبه متى شئت'
        : 'Your deposit is safe · ask for it anytime'
      : state === 'requested'
        ? ar
          ? 'أُرسل الطلب · قيد المراجعة لدى المالك أو من يمثّله'
          : 'Request sent · with the host for review'
        : state === 'approved'
          ? ar
            ? 'اعتُمد الاسترداد · التحويل في الطريق'
            : 'Approved · transfer on the way'
          : state === 'paid'
            ? ar
              ? `حُوّل ${paidAmount} إليك`
              : `${paidAmount} transferred to you`
            : ar
              ? 'لم يُعتمد الاسترداد'
              : 'Refund not approved';

  return (
    <div className={`stay-trip stay-refund-scene stay-refund-scene--${state}`}>
      <div className="stay-scene" key={run} role="img" aria-label={status}>
        <svg viewBox="0 0 600 150" preserveAspectRatio="xMidYMid slice" aria-hidden="true">
          <SceneDefs />
          <SceneBackdrop />
          <HostHouse ar={ar}>
            {state === 'requested' ? (
              <g className="stay-refund__wait">
                <circle cx="436" cy="62" r="8" fill="#ffffff" stroke="#d29b1f" strokeWidth="1.2" />
                <g className="stay-refund__hourglass">
                  <path
                    d="M432 57 H440 L436 62 L440 67 H432 L436 62 Z"
                    fill="#fde8a6"
                    stroke="#b8860b"
                    strokeWidth="0.8"
                    strokeLinejoin="round"
                  />
                  <path d="M434 66 H438 L436 64 Z" fill="#d29b1f" />
                </g>
              </g>
            ) : state === 'approved' || state === 'paid' ? (
              <g className="stay-refund__verdict">
                <circle cx="436" cy="62" r="8" fill="#0b8f6a" stroke="#ffffff" strokeWidth="1.2" />
                <path
                  d="M432.4 62 L435 64.8 L440 59"
                  fill="none"
                  stroke="#ffffff"
                  strokeWidth="1.6"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </g>
            ) : state === 'rejected' ? (
              <g className="stay-refund__verdict">
                <circle cx="436" cy="62" r="8" fill="#c8102e" stroke="#ffffff" strokeWidth="1.2" />
                <path
                  d="M433 59 L439 65 M439 59 L433 65"
                  stroke="#ffffff"
                  strokeWidth="1.6"
                  strokeLinecap="round"
                />
              </g>
            ) : null}
          </HostHouse>
          <DepositSafe amount={moment.deposit} ar={ar} />
          {state === 'requested' ? (
            <path
              className="stay-refund__trail"
              d="M210 86 Q323 10 436 74"
              pathLength="1"
              fill="none"
              stroke="#0d5c45"
              strokeOpacity="0.35"
              strokeWidth="1.2"
              strokeLinecap="round"
            />
          ) : null}
          <Guest />
          {state === 'open' ? (
            <circle
              className="stay-refund__call"
              cx="200"
              cy="94"
              r="12"
              fill="none"
              stroke="#0b8f6a"
              strokeWidth="1.4"
            />
          ) : null}
          {state === 'approved' ? (
            <g className="stay-refund__coin-wait">
              <ellipse cx="300" cy="69" rx="5" ry="5" fill="#f2c94c" stroke="#b8860b" />
              <ellipse
                cx="300"
                cy="69"
                rx="3"
                ry="3"
                fill="none"
                stroke="#b8860b"
                strokeWidth="0.5"
              />
            </g>
          ) : null}
          {state === 'paid' ? (
            <>
              {COINS.map((index) => (
                <g
                  key={index}
                  className="stay-refund__coin"
                  style={{ animationDelay: `${0.7 + index * 0.3}s` }}
                >
                  <circle cx="300" cy="78" r="4.6" fill="#f2c94c" stroke="#b8860b" />
                  <circle cx="300" cy="78" r="2.8" fill="none" stroke="#b8860b" strokeWidth="0.5" />
                </g>
              ))}
              <g className="stay-refund__got">
                <rect x="212" y="30" width="62" height="14" rx="7" fill="#0b8f6a" />
                <text
                  x="243"
                  y="39.4"
                  textAnchor="middle"
                  fontSize="6"
                  fontWeight="800"
                  fill="#ffffff"
                  direction={ar ? 'rtl' : 'ltr'}
                >
                  {ar ? `${paidAmount} ✓` : `+${paidAmount} ✓`}
                </text>
              </g>
            </>
          ) : null}
          {state === 'requested' ? (
            <PaperPlane className="stay-refund__plane" x={210} y={86} />
          ) : null}
        </svg>
      </div>
      <div className="stay-trip__board">
        <span className="stay-trip__type">{ar ? 'استرداد التأمين' : 'Deposit refund'}</span>
        <span className="stay-trip__plate" dir="ltr">
          {plateNo}
        </span>
        <strong className="stay-trip__status">
          <i aria-hidden="true" />
          {status}
        </strong>
        {state === 'requested' || state === 'paid' ? (
          <button type="button" onClick={() => setRun((value) => value + 1)}>
            {ar ? 'شاهد مجدداً' : 'Replay'}
          </button>
        ) : null}
      </div>
    </div>
  );
}
