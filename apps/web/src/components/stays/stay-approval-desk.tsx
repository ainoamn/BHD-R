'use client';

import { useState } from 'react';
import type { StayDeskMoment } from '@/lib/stay-guest-greeting';

/** Seated host in a white dishdasha and patterned massar, facing the viewer at x=300. */
function Host() {
  return (
    <g className="stay-desk__host">
      <rect x="270" y="44" width="60" height="62" rx="11" fill="#3b4a44" />
      <rect x="295" y="58" width="10" height="15" fill="#c98d5f" />
      <path
        d="M268 106 V89 Q269 76 285 72.6 L294 70.6 H306 L315 72.6 Q331 76 332 89 V106 Z"
        fill="#fbfbf7"
        stroke="#d9d9cf"
        strokeWidth="0.8"
      />
      <path d="M294 70.8 Q300 77 306 70.8" fill="none" stroke="#d9d9cf" strokeWidth="0.8" />
      <path d="M300 75.5 V92" stroke="#cdbf9c" strokeWidth="1" />
      <path d="M298.4 91.6 L300 97.4 L301.6 91.6 Z" fill="#cdbf9c" />
      <g className="stay-desk__head">
        <ellipse cx="289.6" cy="51" rx="1.8" ry="2.8" fill="#bb7f52" />
        <ellipse cx="310.4" cy="51" rx="1.8" ry="2.8" fill="#bb7f52" />
        <ellipse cx="300" cy="50" rx="10.5" ry="12.5" fill="#c98d5f" />
        <path
          d="M290 50 Q290 66 300 66.6 Q310 66 310 50 Q309 57 305 58.6 Q300 60 295 58.6 Q291 57 290 50 Z"
          fill="#2a201a"
        />
        <path d="M295.4 56.2 Q300 54.4 304.6 56.2 Q300 57.6 295.4 56.2 Z" fill="#2a201a" />
        <path d="M300 49.6 L299 53.4 H301" fill="none" stroke="#a9704a" strokeWidth="0.7" />
        <circle className="stay-desk__eye" cx="296.4" cy="49.6" r="0.95" fill="#2a201a" />
        <circle className="stay-desk__eye" cx="304.4" cy="49.6" r="0.95" fill="#2a201a" />
        <path
          d="M293.6 46.6 H297.8 M302.2 46.6 H306.4"
          stroke="#2a201a"
          strokeWidth="0.9"
          strokeLinecap="round"
        />
        <path
          d="M288.4 46.4 Q287 29.6 300 28.2 Q313 29.6 311.6 46.4 Q300 40.6 288.4 46.4 Z"
          fill="url(#stay-desk-massar)"
          stroke="#b89c6b"
          strokeWidth="0.6"
        />
        <path
          d="M289 42 Q300 36 311 42 M289.6 37 Q300 31.6 310.4 37"
          fill="none"
          stroke="#b89c6b"
          strokeWidth="0.7"
        />
        <path d="M310.6 39.6 Q316.4 44 313.4 50.6 L311.2 46 Z" fill="url(#stay-desk-massar)" />
      </g>
      <path
        d="M271 88 Q264 101 276 104.4 H291 Q294.6 100.6 290.6 99 L279.6 98.4 Q279.4 92 276.4 87.6 Z"
        fill="#fbfbf7"
        stroke="#d9d9cf"
        strokeWidth="0.8"
      />
      <ellipse cx="291.6" cy="101.6" rx="3" ry="2.6" fill="#c98d5f" />
      <path
        d="M328.6 86.4 Q337 95 340.6 99.6 L345.4 101.4 Q348.6 98.6 345.4 96.8 L340.4 95 Q336.6 88.6 332.6 84.4 Z"
        fill="#fbfbf7"
        stroke="#d9d9cf"
        strokeWidth="0.8"
      />
    </g>
  );
}

/** Coffee pot (dallah) and a small cup on the desk. */
function Dallah() {
  return (
    <g aria-hidden="true">
      <path
        d="M232 102 Q229 96 233 92 L234.6 84 Q235 81 238 81 Q241 81 241.4 84 L243 92 Q247 96 244 102 Z"
        fill="#d8a64a"
        stroke="#a97a26"
        strokeWidth="0.6"
      />
      <path d="M233.4 84.4 Q226 86 224 79" fill="none" stroke="#a97a26" strokeWidth="1.4" />
      <path d="M243 88 Q248.6 88 247.6 94" fill="none" stroke="#a97a26" strokeWidth="1.2" />
      <path d="M236 81 Q238 76.6 240 81 Z" fill="#a97a26" />
      <path
        d="M252 102 L251 97.6 H257 L256 102 Z"
        fill="#f6efe2"
        stroke="#c9b48a"
        strokeWidth="0.5"
      />
    </g>
  );
}

function DeskFlag() {
  return (
    <g aria-hidden="true">
      <path d="M214 102 h8 v-1.6 h-8 Z" fill="#6f7c76" />
      <rect x="217.4" y="80" width="1.2" height="20.6" fill="#8d9692" />
      <rect x="218.6" y="81" width="3.4" height="8" fill="#db161b" />
      <rect x="222" y="81" width="9" height="2.7" fill="#ffffff" />
      <rect x="222" y="83.7" width="9" height="2.6" fill="#db161b" />
      <rect x="222" y="86.3" width="9" height="2.7" fill="#008000" />
    </g>
  );
}

/**
 * The host (or their representative) at the desk: reading the request while it
 * is pending, then signing it on the pen tablet until the approval stamp lands.
 */
export function StayApprovalDesk({
  moment,
  plateNo,
  ar,
}: {
  moment: StayDeskMoment;
  plateNo: string;
  ar: boolean;
}) {
  const [run, setRun] = useState(0);
  const signed = moment.signed;
  return (
    <div className={`stay-trip stay-desk stay-desk--${signed ? 'signed' : 'pending'}`}>
      <div className="stay-desk__scene" key={run} role="img" aria-label={moment.status}>
        <svg viewBox="0 0 600 150" preserveAspectRatio="xMidYMid slice" aria-hidden="true">
          <defs>
            <pattern
              id="stay-desk-massar"
              width="5"
              height="5"
              patternUnits="userSpaceOnUse"
              patternTransform="rotate(35)"
            >
              <rect width="5" height="5" fill="#efe3c8" />
              <rect width="1.6" height="5" fill="#9c2f45" />
              <circle cx="3.4" cy="2.5" r="0.7" fill="#2f6f8f" />
            </pattern>
          </defs>
          <rect x="0" y="0" width="600" height="128" fill="#f4ead8" />
          <rect x="0" y="118" width="600" height="10" fill="#e7d7bb" />
          <rect x="0" y="128" width="600" height="22" fill="#cfb48a" />
          <g aria-hidden="true">
            <path d="M118 96 V44 a41 22 0 0 1 82 0 V96 Z" fill="#7a4a22" />
            <path d="M123 92 V45 a36 18 0 0 1 72 0 V92 Z" fill="#bfe6f7" />
            <path d="M123 92 V78 L140 64 L156 76 L172 60 L195 78 V92 Z" fill="#e3c99a" />
            <circle cx="180" cy="46" r="5" fill="#ffd864" />
            <path d="M159 30 V92 M123 66 H195" stroke="#7a4a22" strokeWidth="2" />
            <rect x="114" y="95" width="90" height="4" rx="1.5" fill="#6a3f1c" />
          </g>
          <g aria-hidden="true">
            <circle cx="500" cy="42" r="13" fill="#fff" stroke="#7a4a22" strokeWidth="2" />
            <path
              d="M500 31.4 V33.4 M500 50.6 V52.6 M489.4 42 H491.4 M508.6 42 H510.6"
              stroke="#6f7c76"
              strokeWidth="1"
            />
            <path
              className="stay-desk__clock"
              d="M500 42 V33.6"
              stroke="#1f2924"
              strokeWidth="1.4"
              strokeLinecap="round"
            />
            <path d="M500 42 H506" stroke="#1f2924" strokeWidth="1.6" strokeLinecap="round" />
            <circle cx="500" cy="42" r="1.2" fill="#c8102e" />
          </g>
          <Host />
          <rect x="204" y="102" width="268" height="6" rx="1.5" fill="#8a5a33" />
          <rect x="212" y="108" width="252" height="32" fill="#a06a3e" />
          <path d="M338 108 V140 M352 118 H376" stroke="#7d4f2c" strokeWidth="1.2" />
          <DeskFlag />
          <Dallah />
          <rect x="326" y="99" width="32" height="3" rx="1" fill="#2a332f" />
          <g className="stay-desk__pen-hand">
            <path
              d="M347.6 99.6 L353.4 90.6"
              stroke="#1d4c7c"
              strokeWidth="1.6"
              strokeLinecap="round"
            />
            <ellipse cx="346.6" cy="99.2" rx="3.2" ry="2.6" fill="#c98d5f" />
          </g>
          <rect x="400" y="92" width="8" height="9" fill="#4a5550" />
          <rect x="388" y="99.6" width="32" height="2.6" rx="1.3" fill="#4a5550" />
          <rect x="358" y="36" width="92" height="58" rx="4" fill="#1f2925" />
          <rect
            className="stay-desk__screen"
            x="362"
            y="40"
            width="84"
            height="50"
            rx="2"
            fill="#ffffff"
          />
          <path d="M362 48 V42 Q362 40 364 40 H444 Q446 40 446 42 V48 Z" fill="#0d5c45" />
          <text x="404" y="45.8" textAnchor="middle" fontSize="4.4" fontWeight="700" fill="#ffffff">
            {ar ? 'طلب حجز إقامة' : 'STAY REQUEST'}
          </text>
          <text
            x="404"
            y="54.6"
            textAnchor="middle"
            fontSize="4.6"
            fontWeight="700"
            fill="#1f2924"
            fontFamily="ui-monospace, Consolas, monospace"
          >
            {plateNo}
          </text>
          <rect x="368" y="58" width="58" height="2" rx="1" fill="#dfe5e2" />
          <rect x="368" y="62.4" width="70" height="2" rx="1" fill="#dfe5e2" />
          <rect x="368" y="66.8" width="46" height="2" rx="1" fill="#dfe5e2" />
          <rect className="stay-desk__scan" x="364" y="57" width="80" height="3.6" rx="1" />
          <path d="M368 82.4 H418" stroke="#9aa6a0" strokeWidth="0.6" />
          <text
            x={ar ? 418 : 368}
            y="86.6"
            direction={ar ? 'rtl' : 'ltr'}
            textAnchor="start"
            fontSize="3.2"
            fill="#6f7c76"
          >
            {ar ? 'توقيع المالك أو من يمثله' : 'Host / representative signature'}
          </text>
          {signed ? (
            <>
              <path
                className="stay-desk__signature"
                d="M371 80 c2 -7 5 -8 4.6 -2 c-0.4 4 2.4 3.6 4 -1.4 c1.4 -4 3.4 -3.6 3 0.6 c-0.2 3 2.6 2.6 4.6 -2 c1.4 -3 3.6 -2.6 3.4 0.6 c-0.2 2 2 2 5 -0.6 l9 -1.4"
                pathLength="1"
                fill="none"
                stroke="#1d4c7c"
                strokeWidth="0.9"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
              <g transform="rotate(-12 431 73)">
                <g className="stay-desk__stamp">
                  <circle
                    cx="431"
                    cy="73"
                    r="10"
                    fill="rgb(11 143 106 / 0.08)"
                    stroke="#0b8f6a"
                    strokeWidth="1.2"
                  />
                  <circle cx="431" cy="73" r="7.6" fill="none" stroke="#0b8f6a" strokeWidth="0.5" />
                  <path
                    d="M426.6 72.6 L429.8 76 L435.6 69.4"
                    fill="none"
                    stroke="#0b8f6a"
                    strokeWidth="1.6"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </g>
              </g>
              <text
                className="stay-desk__approved"
                x="431"
                y="88"
                textAnchor="middle"
                fontSize="3.6"
                fontWeight="800"
                fill="#0b8f6a"
              >
                {ar ? 'معتمد' : 'APPROVED'}
              </text>
            </>
          ) : (
            <g className="stay-desk__typing" fill="#9aa6a0">
              <circle cx="388" cy="79" r="1.1" />
              <circle cx="392" cy="79" r="1.1" />
              <circle cx="396" cy="79" r="1.1" />
            </g>
          )}
        </svg>
      </div>
      <div className="stay-trip__board">
        <span className="stay-trip__type">{ar ? 'اعتماد المالك' : 'Host approval'}</span>
        <span className="stay-trip__plate" dir="ltr">
          {plateNo}
        </span>
        <strong className="stay-trip__status">
          <i aria-hidden="true" />
          {moment.status}
        </strong>
        {signed ? (
          <button type="button" onClick={() => setRun((value) => value + 1)}>
            {ar ? 'شاهد التوقيع مجدداً' : 'Replay signing'}
          </button>
        ) : null}
      </div>
    </div>
  );
}
