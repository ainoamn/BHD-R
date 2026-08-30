/**
 * Trigger a Render deploy for Nest via Deploy Hook, then poll healthz.
 *
 * Usage:
 *   RENDER_DEPLOY_HOOK_URL=https://api.render.com/deploy/srv-...?... node scripts/trigger-render-deploy.mjs
 *
 * Optional: RENDER_HEALTH_URL (default https://bhd-r.onrender.com/healthz)
 * Optional: RENDER_DEPLOY_WAIT_MS (default 180000)
 *
 * Create the hook: Render Dashboard → service → Settings → Deploy Hook.
 * Never commit the hook URL.
 */
import { setTimeout as delay } from 'node:timers/promises';

const hook = process.env.RENDER_DEPLOY_HOOK_URL?.trim();
const healthUrl = (process.env.RENDER_HEALTH_URL ?? 'https://bhd-r.onrender.com/healthz').replace(
  /\/$/,
  '',
);
const waitMs = Number(process.env.RENDER_DEPLOY_WAIT_MS ?? 180_000);

if (!hook || !/^https:\/\/api\.render\.com\/deploy\//i.test(hook)) {
  console.error(
    'Set RENDER_DEPLOY_HOOK_URL to a Render Deploy Hook URL (Dashboard → Settings → Deploy Hook).',
  );
  process.exit(1);
}

console.log('Triggering Render deploy…');
const trigger = await fetch(hook, { method: 'POST', signal: AbortSignal.timeout(30_000) });
const triggerBody = await trigger.text().catch(() => '');
if (!trigger.ok) {
  console.error('Deploy hook failed', trigger.status, triggerBody.slice(0, 200));
  process.exit(1);
}
console.log('Deploy hook accepted', trigger.status);

const deadline = Date.now() + (Number.isFinite(waitMs) ? waitMs : 180_000);
let last = '';
while (Date.now() < deadline) {
  await delay(8_000);
  try {
    const response = await fetch(healthUrl, {
      cache: 'no-store',
      signal: AbortSignal.timeout(12_000),
    });
    last = await response.text();
    if (response.ok && /"nestReady"\s*:\s*true/.test(last)) {
      console.log('Nest healthy:', last.slice(0, 180));
      process.exit(0);
    }
    console.log('Waiting for nestReady…', response.status, last.slice(0, 80));
  } catch (error) {
    console.log('Health poll error:', error instanceof Error ? error.message : error);
  }
}

console.error('Timed out waiting for Nest health. Last:', last.slice(0, 200));
process.exit(2);
