/**
 * Sign and POST a reservation_deposit payment webhook (staging / local Nest).
 *
 * Usage:
 *   PAYMENT_WEBHOOK_SECRET=... node scripts/simulate-reservation-deposit-webhook.mjs \
 *     --org <uuid> --session bk_... --amount 100000 --currency OMR
 *
 * Optional: NEST_ORIGIN (default https://bhd-r.onrender.com), --provider sandbox
 */
import { createHmac, randomUUID } from 'node:crypto';

function arg(name, fallback = '') {
  const idx = process.argv.indexOf(`--${name}`);
  if (idx >= 0 && process.argv[idx + 1]) return process.argv[idx + 1];
  return fallback;
}

const secret = process.env.PAYMENT_WEBHOOK_SECRET?.trim();
const origin = (process.env.NEST_ORIGIN ?? 'https://bhd-r.onrender.com').replace(/\/$/, '');
const organizationId = arg('org');
const checkoutSessionReference = arg('session');
const amountMinor = arg('amount');
const currency = arg('currency', 'OMR');
const provider = arg('provider', 'sandbox');

if (!secret || secret.length < 16) {
  console.error('Set PAYMENT_WEBHOOK_SECRET (≥16).');
  process.exit(1);
}
if (!organizationId || !checkoutSessionReference || !/^\d+$/.test(amountMinor)) {
  console.error(
    'Required: --org <uuid> --session <bk_...> --amount <minor> [--currency OMR] [--provider sandbox]',
  );
  process.exit(1);
}

const body = JSON.stringify({
  kind: 'reservation_deposit',
  organizationId,
  checkoutSessionReference,
  amountMinor,
  currency,
  providerReference: `sim-${randomUUID()}`,
  receivedAt: new Date().toISOString(),
  method: 'card',
});
const timestamp = Math.floor(Date.now() / 1000);
const signature = createHmac('sha256', secret).update(`${timestamp}.${body}`).digest('hex');
const eventId = `sim-${randomUUID()}`;

const response = await fetch(`${origin}/v1/webhooks/payments/${encodeURIComponent(provider)}`, {
  method: 'POST',
  headers: {
    'content-type': 'application/json',
    'x-event-id': eventId,
    'x-bhd-signature': `t=${timestamp},v1=${signature}`,
  },
  body,
});
const text = await response.text();
console.log(response.status, text);
process.exit(response.ok ? 0 : 1);
