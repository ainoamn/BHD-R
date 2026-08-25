/**
 * Re-push cleaned Production/Preview env values for bhd-r-api (no trailing \\r\\n).
 * Usage: node scripts/fix-vercel-identity-env.mjs
 */
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
process.chdir(root);

function cleanEnv(value) {
  return (
    value
      ?.replace(/^\uFEFF/, '')
      .replace(/\\r\\n$/gi, '')
      .replace(/\\n$/gi, '')
      .replace(/\r\n$/g, '')
      .replace(/\n$/g, '')
      .trim() || ''
  );
}

function get(t, k) {
  const m = t.match(new RegExp(`^${k}="([^"]*)"`, 'm')) || t.match(new RegExp(`^${k}=(.*)$`, 'm'));
  return m ? m[1] : null;
}

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

// Ensure linked to bhd-r-api
if (run('npx', ['--yes', 'vercel', 'link', '--yes', '--project', 'bhd-r-api']) !== 0) {
  throw new Error('vercel link failed');
}

const pullFile = path.join(root, '.env.vercel.check');
if (run('npx', ['--yes', 'vercel', 'env', 'pull', pullFile, '--environment', 'production', '--yes']) !== 0) {
  throw new Error('env pull failed');
}

const oneFile = path.join(root, '.env.one-bhd.check');
if (!fs.existsSync(oneFile)) {
  throw new Error('Missing .env.one-bhd.check — pull one-bhd production env first');
}

const bhd = fs.readFileSync(pullFile, 'utf8');
const one = fs.readFileSync(oneFile, 'utf8');

const tokenSecret = cleanEnv(get(one, 'IDENTITY_TOKEN_SECRET') || get(one, 'AUTH_SECRET'));
if (tokenSecret.length < 32) throw new Error('Identity token secret missing/too short');

const values = {
  BHD_IDENTITY_TOKEN_SECRET: tokenSecret,
  IDENTITY_TOKEN_SECRET: tokenSecret,
  BHD_IDENTITY_ISSUER: cleanEnv(get(bhd, 'BHD_IDENTITY_ISSUER')) || 'https://id.bhd-om.com',
  BHD_OAUTH_CLIENT_ID: cleanEnv(get(bhd, 'BHD_OAUTH_CLIENT_ID')) || 'bhd-r',
  BHD_OAUTH_CLIENT_SECRET: cleanEnv(get(bhd, 'BHD_OAUTH_CLIENT_SECRET')),
  BHD_OAUTH_REDIRECT_URI:
    cleanEnv(get(bhd, 'BHD_OAUTH_REDIRECT_URI')) ||
    'https://bhd-r-api-phi.vercel.app/api/auth/bhd/callback',
  BHD_IDENTITY_CLIENT_SECRET: cleanEnv(get(bhd, 'BHD_IDENTITY_CLIENT_SECRET')),
  BHD_IDENTITY_REDIRECT_URI:
    cleanEnv(get(bhd, 'BHD_IDENTITY_REDIRECT_URI')) ||
    'https://bhd-r-api-phi.vercel.app/api/auth/bhd/callback',
  BHD_R_SESSION_SECRET: cleanEnv(get(bhd, 'BHD_R_SESSION_SECRET')),
  CSRF_SECRET: cleanEnv(get(bhd, 'CSRF_SECRET')),
  COOKIE_SECURE: cleanEnv(get(bhd, 'COOKIE_SECURE')) || 'true',
  DATABASE_URL: cleanEnv(get(bhd, 'DATABASE_URL')),
  NEXT_PUBLIC_SITE_URL: cleanEnv(get(bhd, 'NEXT_PUBLIC_SITE_URL')) || 'https://r.bhd-om.com',
};

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'bhd-r-env-'));

for (const [key, value] of Object.entries(values)) {
  if (!value) {
    console.warn(`skip empty ${key}`);
    continue;
  }
  const file = path.join(tmp, `${key}.txt`);
  // No trailing newline — PowerShell pipes previously corrupted secrets with \\r\\n.
  fs.writeFileSync(file, value, { encoding: 'utf8' });
  for (const envName of ['production', 'preview']) {
    run('npx', ['--yes', 'vercel', 'env', 'rm', key, envName, '--yes']);
    const status = run('cmd', ['/c', `npx --yes vercel env add ${key} ${envName} < "${file}"`]);
    if (status !== 0) throw new Error(`failed setting ${key} ${envName}`);
    console.log(`set ${key} (${envName}) len=${value.length}`);
  }
}

fs.rmSync(tmp, { recursive: true, force: true });
console.log('done');
