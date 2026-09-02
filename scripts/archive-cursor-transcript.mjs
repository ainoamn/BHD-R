#!/usr/bin/env node
/**
 * Archive a Cursor agent transcript JSONL into docs/handoffs with secret redaction
 * and a human-readable markdown extract.
 *
 * Usage:
 *   node scripts/archive-cursor-transcript.mjs <source.jsonl> <destDir>
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

function redact(text) {
  let out = text;
  const rules = [
    [/postgresql:\/\/[^\s"'`<>\\]+/gi, '[REDACTED-DATABASE-URL]'],
    [/postgres:\/\/[^\s"'`<>\\]+/gi, '[REDACTED-DATABASE-URL]'],
    [/rediss?:\/\/[^\s"'`<>\\]+/gi, '[REDACTED-REDIS-URL]'],
    [/(DATABASE_URL\s*=\s*)["']?[^\s"'`\\]+["']?/gi, '$1[REDACTED-DATABASE-URL]'],
    [/re_[A-Za-z0-9_]{16,}/g, '[REDACTED-RESEND-KEY]'],
    [/cfut_[A-Za-z0-9]+/g, '[REDACTED-CLOUDFLARE-USER-TOKEN]'],
    [/cfat_[A-Za-z0-9]+/g, '[REDACTED-CLOUDFLARE-ACCOUNT-TOKEN]'],
    [/v1\.0-[a-f0-9-]{20,}/gi, '[REDACTED-CLOUDFLARE-ACCOUNT-TOKEN]'],
    [/npg_[A-Za-z0-9]+/g, '[REDACTED-NEON-PASSWORD]'],
    [/sk_(live|test)_[A-Za-z0-9]+/g, '[REDACTED-STRIPE-KEY]'],
    [/sk-[A-Za-z0-9_-]{20,}/g, '[REDACTED-SECRET-KEY]'],
    [/Bearer\s+[A-Za-z0-9._-]+/g, 'Bearer [REDACTED-TOKEN]'],
    [/BHD_OAUTH_CLIENT_SECRET\s*=\s*[^\s"'`\\]+/gi, 'BHD_OAUTH_CLIENT_SECRET=[REDACTED]'],
    [/BHD_IDENTITY_CLIENT_SECRET\s*=\s*[^\s"'`\\]+/gi, 'BHD_IDENTITY_CLIENT_SECRET=[REDACTED]'],
    [/BHD_IDENTITY_TOKEN_SECRET\s*=\s*[^\s"'`\\]+/gi, 'BHD_IDENTITY_TOKEN_SECRET=[REDACTED]'],
    [/IDENTITY_TOKEN_SECRET\s*=\s*[^\s"'`\\]+/gi, 'IDENTITY_TOKEN_SECRET=[REDACTED]'],
    [/BHD_R_SESSION_SECRET\s*=\s*[^\s"'`\\]+/gi, 'BHD_R_SESSION_SECRET=[REDACTED]'],
    [/CSRF_SECRET\s*=\s*[^\s"'`\\]+/gi, 'CSRF_SECRET=[REDACTED]'],
    [/S3_SECRET_KEY\s*=\s*[^\s"'`\\]+/gi, 'S3_SECRET_KEY=[REDACTED]'],
    [/S3_ACCESS_KEY\s*=\s*[^\s"'`\\]+/gi, 'S3_ACCESS_KEY=[REDACTED]'],
    [/RESEND_API_KEY\s*=\s*[^\s"'`\\]+/gi, 'RESEND_API_KEY=[REDACTED-RESEND-KEY]'],
    [/\b[a-f0-9]{64}\b/gi, '[REDACTED-HEX-SECRET]'],
    [/(?:Access Key ID|Secret Access Key)[^\n]*\n\s*[a-f0-9]{16,64}\b/gi, (m) =>
      m.replace(/\b[a-f0-9]{16,64}\b/gi, '[REDACTED-ACCESS-CREDENTIAL]'),
    ],
    [/workspaceStorage_[a-f0-9]{16,}/gi, 'workspaceStorage_[REDACTED-ACCESS-KEY-ID]'],
    [/AKIA[0-9A-Z]{16}/g, '[REDACTED-AWS-ACCESS-KEY]'],
  ];
  for (const [pattern, replacement] of rules) {
    out = out.replace(pattern, replacement);
  }
  return out;
}

function extractTexts(record) {
  const texts = [];
  const content = record?.message?.content;
  if (!Array.isArray(content)) return texts;
  for (const block of content) {
    if (block?.type === 'text' && typeof block.text === 'string' && block.text.trim()) {
      texts.push(redact(block.text.trim()));
    }
  }
  return texts;
}

const src = process.argv[2];
const destDir = process.argv[3];
if (!src || !destDir) {
  console.error('usage: node scripts/archive-cursor-transcript.mjs <source.jsonl> <destDir>');
  process.exit(1);
}

fs.mkdirSync(destDir, { recursive: true });

const jsonlOut = path.join(destDir, 'conversation-transcript-FULL.jsonl');
const mdOut = path.join(destDir, 'conversation-readable-FULL.md');

const raw = fs.readFileSync(src, 'utf8');
const lines = raw.split(/\r?\n/).filter(Boolean);
const redactedLines = lines.map((line) => redact(line));
fs.writeFileSync(jsonlOut, `${redactedLines.join('\n')}\n`, 'utf8');

const hash = crypto.createHash('sha256').update(redactedLines.join('\n')).digest('hex');

const mdParts = [
  '# نسخة مقروءة كاملة من محادثة Cursor',
  '',
  '- **المصدر:** conversation-transcript-FULL.jsonl (نسخة حرفية **مع تنقيح الأسرار**)',
  `- **تاريخ التوثيق:** ${new Date().toISOString().slice(0, 10)}`,
  '- **معرّف المحادثة:** d0d5551b-99f7-449e-92d1-5d812bcf527d',
  `- **عدد أسطر JSONL:** ${lines.length}`,
  `- **SHA256 (بعد التنقيح):** \`${hash}\``,
  '',
  '> استخراج نصوص المستخدم/المساعد. مفاتيح API وروابط قواعد البيانات استُبدلت بـ `[REDACTED-…]` قبل الرفع إلى GitHub.',
  '',
  '---',
  '',
];

let msgIndex = 0;
for (const line of redactedLines) {
  let record;
  try {
    record = JSON.parse(line);
  } catch {
    continue;
  }
  if (record.role !== 'user' && record.role !== 'assistant') continue;
  const texts = extractTexts(record);
  if (!texts.length) continue;
  msgIndex += 1;
  const label = record.role === 'user' ? 'المستخدم' : 'المساعد';
  mdParts.push(`## ${msgIndex}. ${label}`, '');
  for (const text of texts) {
    mdParts.push(text, '');
  }
  mdParts.push('---', '');
}

fs.writeFileSync(mdOut, mdParts.join('\n'), 'utf8');

console.log(JSON.stringify({ lines: lines.length, sha256: hash, jsonlOut, mdOut, messages: msgIndex }, null, 2));
