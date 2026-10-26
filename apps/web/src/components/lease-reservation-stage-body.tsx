'use client';

import { useState, type ReactNode } from 'react';
import {
  LeaseReservationWorkflow,
  type LeaseReservationWorkflowProps,
} from '@/components/lease-reservation-workflow';
import { leaseJourneyStageIndex } from '@/lib/lease-reservation-lifecycle';

/**
 * Keeps booking-agreement / party extras on stage 0 (إتمام الحجز) only;
 * owners reopen that stage from the stepper to review them again.
 */
export function LeaseReservationStageBody({
  workflow,
  bookingDetails,
}: {
  workflow: LeaseReservationWorkflowProps;
  bookingDetails: ReactNode;
}) {
  const [viewing, setViewing] = useState<number | null>(null);
  const stage = leaseJourneyStageIndex(workflow.phase);
  const shownStage = viewing !== null && viewing < stage ? viewing : stage;

  return (
    <>
      <LeaseReservationWorkflow
        {...workflow}
        viewing={viewing}
        onViewingChange={setViewing}
      />
      {shownStage === 0 ? bookingDetails : null}
    </>
  );
}
