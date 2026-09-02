/**
 * Phase 6–8 worker foundations for BHD R Stays.
 * Jobs run only when STAYS_PLATFORM_ENABLED is true (caller must gate).
 */

export const STAY_JOB_NAMES = [
  'stay-hold-expirer',
  'stay-inventory-projector',
  'stay-housekeeping',
  'stay-notifications',
] as const;

export type StayJobName = (typeof STAY_JOB_NAMES)[number];

export const STAY_OUTBOX_TOPICS = [
  'stay.inventory.lock_created',
  'stay.inventory.changed',
  'stay_booking.payment_confirmed',
  'stay.booking.confirmed',
  'stay.checked_out',
] as const;

export type StayOutboxTopic = (typeof STAY_OUTBOX_TOPICS)[number];

export function isStayOutboxTopic(topic: string): topic is StayOutboxTopic {
  return (STAY_OUTBOX_TOPICS as readonly string[]).includes(topic);
}

/** Phase 8 — outbound iCal/OTA import must stay blocked until SSRF gates (no private IPs, re-check redirects).
 * Read-only export is available via GET /v1/stays/units/:unitId/calendar.ics (0.4.11+). */
export function staysChannelSyncBlockedReason(): string {
  return 'channel_sync_not_enabled_until_phase_8_security_gates';
}

export function parseStayPlatformEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  const raw = env.STAYS_PLATFORM_ENABLED?.trim().toLowerCase();
  return raw === '1' || raw === 'true' || raw === 'yes' || raw === 'on';
}
