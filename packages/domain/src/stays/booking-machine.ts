import { assertTransition, type StateMachine } from '../state-machines.js';

/**
 * Nightly stay booking lifecycle — separate from long-term reservation/lease machines.
 * Payment/refund status lives on stay_payment_* / stay_refunds, not booking status.
 */
export const stayBookingStatuses = [
  'request_pending',
  'payment_pending',
  'confirmed',
  'pre_arrival',
  'checked_in',
  'checked_out',
  'closed',
  'cancelled',
  'expired',
  'payment_failed',
  'no_show',
] as const;

export type StayBookingStatus = (typeof stayBookingStatuses)[number];

export const stayBookingMachine: StateMachine = {
  name: 'stay_booking',
  initial: 'payment_pending',
  terminals: ['closed', 'cancelled', 'expired', 'payment_failed', 'no_show'],
  transitions: {
    request_pending: ['payment_pending', 'cancelled'],
    payment_pending: ['confirmed', 'expired', 'payment_failed', 'cancelled'],
    confirmed: ['pre_arrival', 'cancelled'],
    pre_arrival: ['checked_in', 'no_show', 'cancelled'],
    checked_in: ['checked_out'],
    checked_out: ['closed'],
    closed: [],
    cancelled: [],
    expired: [],
    payment_failed: [],
    no_show: [],
  },
};

export function assertStayBookingTransition(from: string, to: string) {
  return assertTransition(stayBookingMachine, from, to);
}
