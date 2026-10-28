import fs from 'node:fs';

const pools = JSON.parse(
  fs.readFileSync(new URL('./_email-wishes-parsed.json', import.meta.url), 'utf8'),
);

const tones = [
  'maintenance',
  'contract',
  'invoice',
  'arrears',
  'reminder',
  'reward',
  'upgrade',
  'booking',
  'listing',
  'vacancy',
  'request',
  'alert',
  'team',
  'legal',
  'deposit',
  'general',
];

const esc = (s) => s.replace(/\\/g, '\\\\').replace(/'/g, "\\'");

let out = '';
out += '/**\n';
out += ' * Default bilingual email wish / greeting pools (AR · EN) with icons.\n';
out += ' * Sourced from BHD_R_email_wishes_global_library; keep lines unique per pool.\n';
out += ' */\n\n';
out += 'export const DEFAULT_EMAIL_WISHES = {\n';
for (const tone of tones) {
  out += `  ${tone}: [\n`;
  for (const line of pools[tone]) out += `    '${esc(line)}',\n`;
  out += '  ],\n';
}
out += '} as const;\n\n';
out += 'export const DEFAULT_EMAIL_SPARKS: readonly string[] = [\n';
for (const line of pools.sparks) out += `  '${esc(line)}',\n`;
out += '];\n\n';
out += 'export const DEFAULT_EMAIL_GREETINGS_NAMED: readonly string[] = [\n';
for (const line of pools.greetingsNamed) out += `  '${esc(line)}',\n`;
out += '];\n\n';
out += 'export const DEFAULT_EMAIL_GREETINGS_ANON: readonly string[] = [\n';
for (const line of pools.greetingsAnon) out += `  '${esc(line)}',\n`;
out += '];\n';

const target = new URL('../src/lib/email-wish-defaults.ts', import.meta.url);
fs.writeFileSync(target, out, 'utf8');
console.log('wrote', target.pathname, out.length, 'chars');
