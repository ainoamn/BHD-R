/**
 * Poll Nest health endpoints (no deploy trigger).
 * Usage: node scripts/verify-nest-health.mjs
 * Optional: RENDER_HEALTH_BASE=https://bhd-r.onrender.com
 */
const base = (process.env.RENDER_HEALTH_BASE ?? 'https://bhd-r.onrender.com').replace(/\/$/, '');

async function check(path) {
  const url = `${base}${path}`;
  try {
    const response = await fetch(url, { cache: 'no-store', signal: AbortSignal.timeout(15_000) });
    const text = await response.text();
    return { path, status: response.status, ok: response.ok, text: text.slice(0, 240) };
  } catch (error) {
    return {
      path,
      status: 0,
      ok: false,
      text: error instanceof Error ? error.message : String(error),
    };
  }
}

const results = [];
for (const path of ['/healthz', '/raw-ping', '/health/live']) {
  results.push(await check(path));
}

for (const row of results) {
  console.log(`${row.path} → ${row.status} ${row.ok ? 'ok' : 'FAIL'} ${row.text}`);
}

const healthz = results[0];
const ready = Boolean(healthz?.ok && /"nestReady"\s*:\s*true/.test(healthz.text));
if (!ready) {
  console.error('Nest not ready (need healthz nestReady:true). Redeploy Render from main.');
  process.exit(1);
}

// Probe that 0.2.88+ booking route exists (404/409/400 = routed; 404 Nest default may differ).
const probe = await check(
  '/v1/public/units/00000000-0000-4000-8000-000000000001/booking-checkouts',
);
console.log(
  `booking-checkouts probe (GET expect 404/405) → ${probe.status} ${probe.text.slice(0, 80)}`,
);

process.exit(0);
