'use client';

import { useState, type ReactNode } from 'react';
import {
  LeaseReservationWorkflow,
  type LeaseReservationWorkflowProps,
} from '@/components/lease-reservation-workflow';
import { leaseJourneyStageIndex } from '@/lib/lease-reservation-lifecycle';

/**
 * Compact booking strip stays on every stage; full agreement / party extras
 * stay on stage 0 (إتمام الحجز) — reopen that stage from the stepper to review.
 */
export function LeaseReservationStageBody({
  workflow,
  bookingSummary,
  bookingDetails,
}: {
  workflow: LeaseReservationWorkflowProps;
  bookingSummary: ReactNode;
  bookingDetails: ReactNode;
}) {
  const [viewing, setViewing] = useState<number | null>(null);
  const stage = leaseJourneyStageIndex(workflow.phase);
  const shownStage = viewing !== null && viewing < stage ? viewing : stage;

  return (
    <>
      {bookingSummary}
      <LeaseReservationWorkflow
        {...workflow}
        viewing={viewing}
        onViewingChange={setViewing}
      />
      {shownStage === 0 ? bookingDetails : null}
    </>
  );
}
