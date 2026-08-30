/**
 * Ensure CRON_SECRET is set on Vercel (production + preview) for warmup/expire-locks.
 * Generates a random secret if missing. Does not print or commit the secret.
 *
 * Usage: node scripts/ensure-vercel-cron-secret.mjs
 */
import { spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
process.chdir(root);

function run(command, args, opts = {}) {
  const result = spawnSync(command, args, {
    cwd: root,
    encoding: 'utf8',
    shell: true,
    ...opts,
  });
  if (result.stdout) process.stdout.write(result.stdout);
  if (result.stderr) process.stderr.write(result.stderr);
  return result.status ?? 1;
}

if (run('npx', ['--yes', 'vercel', 'link', '--yes', '--project', 'bhd-r-api']) !== 0) {
  throw new Error('vercel link failed');
}

const pullFile = path.join(root, '.env.vercel.cron-check');
if (
  run('npx', ['--yes', 'vercel', 'env', 'pull', pullFile, '--environment', 'production', '--yes']) !==
  0
) {
  throw new Error('env pull failed');
}

const pulled = fs.readFileSync(pullFile, 'utf8');
const existing = (pulled.match(/^CRON_SECRET=(.*)$/m)?.[1] ?? '')
  .replace(/^"|"$/g, '')
  .replace(/\\n/g, '')
  .trim();

const secret =
  existing.length >= 16 ? existing : randomBytes(24).toString('base64url');

if (existing.length >= 16) {
  console.log('CRON_SECRET already present in production (≥16). Re-syncing preview…');
} else {
  console.log('CRON_SECRET missing/short — generating and pushing (value not printed).');
}

const tmp = path.join(os.tmpdir(), `bhd-r-cron-${randomBytes(4).toString('hex')}.txt`);
fs.writeFileSync(tmp, secret, { encoding: 'utf8', mode: 0o600 });

try {
  for (const environment of ['production', 'preview']) {
    // Remove then add to avoid duplicate interactive prompts.
    run('npx', ['--yes', 'vercel', 'env', 'rm', 'CRON_SECRET', environment, '--yes']);
    const add = spawnSync(
      'npx',
      ['--yes', 'vercel', 'env', 'add', 'CRON_SECRET', environment],
      {
        cwd: root,
        encoding: 'utf8',
        shell: true,
        input: `${secret}\n`,
      },
    );
    if (add.stdout) process.stdout.write(add.stdout);
    if (add.stderr) process.stderr.write(add.stderr);
    if ((add.status ?? 1) !== 0) {
      throw new Error(`failed to set CRON_SECRET for ${environment}`);
    }
    console.log(`CRON_SECRET set for ${environment}`);
  }
} finally {
  try {
    fs.unlinkSync(tmp);
  } catch {
    /* ignore */
  }
  try {
    fs.unlinkSync(pullFile);
  } catch {
    /* ignore */
  }
}

console.log('Done. Redeploy web so crons /api/cron/warmup-nest and /api/cron/expire-locks auth.');
