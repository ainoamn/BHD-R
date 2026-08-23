import { readFile, readdir } from 'node:fs/promises';
import { extname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const ignored = new Set([
  '.git',
  '.next',
  '.turbo',
  'coverage',
  'dist',
  'node_modules',
  'playwright-report',
  'test-results',
]);
const textExtensions = new Set([
  '.cjs',
  '.css',
  '.env',
  '.example',
  '.html',
  '.js',
  '.json',
  '.jsx',
  '.md',
  '.mjs',
  '.sql',
  '.ts',
  '.tsx',
  '.yaml',
  '.yml',
]);
const forbidden = [
  { name: 'private key', pattern: /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/ },
  { name: 'GitHub token', pattern: /\b(?:ghp|github_pat)_[A-Za-z0-9_]{30,}\b/ },
  { name: 'AWS access key', pattern: /\bAKIA[A-Z0-9]{16}\b/ },
  { name: 'live Stripe key', pattern: /\bsk_live_[A-Za-z0-9]{20,}\b/ },
];

async function filesAt(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const result = [];
  for (const entry of entries) {
    if (ignored.has(entry.name)) continue;
    const path = join(directory, entry.name);
    if (entry.isDirectory()) result.push(...(await filesAt(path)));
    else if (textExtensions.has(extname(entry.name)) || entry.name === '.env.example')
      result.push(path);
  }
  return result;
}

const failures = [];
for (const file of await filesAt(root)) {
  const value = await readFile(file, 'utf8');
  for (const rule of forbidden) {
    if (rule.pattern.test(value)) failures.push(`${relative(root, file)}: ${rule.name}`);
  }
}

if (failures.length > 0) {
  console.error(`Potential secrets detected:\n${failures.join('\n')}`);
  process.exitCode = 1;
} else {
  console.log('Source secret regression scan passed.');
}
