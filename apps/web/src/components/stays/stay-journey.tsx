'use client';

import { createContext, useContext, useState, type ReactNode } from 'react';
import { Link } from '@/i18n/navigation';
import type { StayGreeting } from '@/lib/stay-guest-greeting';
import { StayApprovalDesk } from './stay-approval-desk';
import { StayDepositRefund } from './stay-deposit-refund-guest';
import { StayRefundScene } from './stay-refund-scene';
import { StaySendPhone } from './stay-send-phone';
import { StayTrip } from './stay-trip';

type JourneyStep = {
  label: string;
  state: 'done' | 'current' | 'upcoming';
  detail?: string | null;
};

const JourneyContext = createContext<{
  selected: number;
  initial: number;
  select: (index: number) => void;
} | null>(null);

function useJourney() {
  const value = useContext(JourneyContext);
  if (!value) throw new Error('StayJourney parts must sit inside StayJourneyProvider');
  return value;
}

/** The opened step, for journey cards outside stays (rent / purchase bookings). */
export const useStayJourney = useJourney;

/** Shares the opened step between the progress bar (hero) and the message card (panel). */
export function StayJourneyProvider({
  initial,
  children,
}: {
  initial: number;
  children: ReactNode;
}) {
  const [selected, setSelected] = useState(initial);
  return (
    <JourneyContext.Provider value={{ selected, initial, select: setSelected }}>
      {children}
    </JourneyContext.Provider>
  );
}

export function StayJourneySteps({
  steps,
  reachable,
  ar,
}: {
  steps: JourneyStep[];
  /** Steps that have a screen (reached already). */
  reachable: boolean[];
  ar: boolean;
}) {
  const { selected, select } = useJourney();
  return (
    <ol className="guest-stay-detail__steps" aria-label={ar ? 'مراحل الحجز' : 'Booking progress'}>
      {steps.map((step, index) => {
        const open = reachable[index] === true;
        return (
          <li
            key={step.label}
            className={`guest-stay-detail__step guest-stay-detail__step--${step.state}${
              selected === index ? ' guest-stay-detail__step--selected' : ''
            }`}
            aria-current={step.state === 'current' ? 'step' : undefined}
          >
            <button
              type="button"
              className="guest-stay-detail__step-button"
              disabled={!open}
              aria-pressed={open ? selected === index : undefined}
              title={
                open
                  ? ar
                    ? 'اعرض شاشة هذه المرحلة'
                    : 'Show this step'
                  : ar
                    ? 'لم نصل إلى هذه المرحلة بعد… فلكل شيء أوانه!'
                    : 'Not there yet… all in good time!'
              }
              onClick={() => select(index)}
            >
              <span className="guest-stay-detail__step-dot">
                {step.state === 'done' ? '✓' : index + 1}
              </span>
              <span className="guest-stay-detail__step-label">{step.label}</span>
              {step.detail ? (
                <span className="guest-stay-detail__step-time">{step.detail}</span>
              ) : null}
            </button>
          </li>
        );
      })}
    </ol>
  );
}

export function StayJourneyCard({
  screens,
  steps,
  rebookHref,
  plateNo,
  ar,
}: {
  screens: Array<StayGreeting | null>;
  steps: JourneyStep[];
  rebookHref: string;
  /** Booking reference, shown on the car's number plate. */
  plateNo: string;
  ar: boolean;
}) {
  const { selected, initial, select } = useJourney();
  const screen = screens[selected] ?? screens[initial];
  if (!screen) return null;
  const past = selected !== initial;

  return (
    <section
      key={selected}
      className={`guest-stay-detail__greeting guest-stay-detail__greeting--${screen.stage}${
        past ? ' guest-stay-detail__greeting--past' : ''
      }`}
      aria-live="polite"
    >
      {past ? (
        <div className="guest-stay-detail__replay">
          <span>
            {ar
              ? `هكذا بدت لك مرحلة «${steps[selected]?.label ?? ''}»`
              : `How the “${steps[selected]?.label ?? ''}” step looked to you`}
          </span>
          <button type="button" onClick={() => select(initial)}>
            {ar ? 'العودة إلى المرحلة الحالية' : 'Back to where you are now'}
          </button>
        </div>
      ) : null}
      {screen.send ? <StaySendPhone moment={screen.send} plateNo={plateNo} ar={ar} /> : null}
      {screen.trip ? <StayTrip moment={screen.trip} plateNo={plateNo} ar={ar} /> : null}
      {screen.desk ? <StayApprovalDesk moment={screen.desk} plateNo={plateNo} ar={ar} /> : null}
      {screen.refund ? <StayRefundScene moment={screen.refund} plateNo={plateNo} ar={ar} /> : null}
      <h2>{screen.headline}</h2>
      <p>{screen.body}</p>
      {screen.refund ? <StayDepositRefund moment={screen.refund} ar={ar} /> : null}
      {screen.guide ? (
        <ol className="guest-stay-detail__guide">
          {screen.guide.map((line) => (
            <li key={line}>{line}</li>
          ))}
        </ol>
      ) : null}
      {screen.stamp ? (
        <div className="guest-stay-detail__moment">
          <span>{screen.stamp.label}</span>
          <strong>{screen.stamp.at}</strong>
          {screen.stamp.notes ? <small>{screen.stamp.notes}</small> : null}
        </div>
      ) : null}
      {screen.rebook ? (
        <Link className="button button--primary guest-stay-detail__rebook" href={rebookHref}>
          {screen.stage === 'checked_out' || screen.stage === 'refund'
            ? ar
              ? 'احجز إقامتك القادمة'
              : 'Book your next stay'
            : ar
              ? 'تصفّح الإقامات'
              : 'Browse stays'}
        </Link>
      ) : null}
    </section>
  );
}
