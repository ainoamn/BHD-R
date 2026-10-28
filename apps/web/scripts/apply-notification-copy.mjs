/**
 * Apply BHD_R_notification_review_and_copy_v1.md into catalog TS files.
 * Usage: node scripts/apply-notification-copy.mjs <path-to-md>
 */
import fs from 'node:fs';
import path from 'node:path';

const mdPath = process.argv[2];
if (!mdPath) {
  console.error('Usage: node apply-notification-copy.mjs <md>');
  process.exit(1);
}

const md = fs.readFileSync(mdPath, 'utf8');
const blocks = [...md.matchAll(/## \d+\. `([^`]+)`[^\n]*\n([\s\S]*?)(?=\n## |\n---\n|$)/g)];

/** @type {Record<string, Record<string, string>>} */
const copy = {};

const AR = {
  organization_name: 'مبنى النور',
  inviter_name: 'عبد الحميد الرواحي',
  property_name: 'مبنى النور',
  date: '22 أكتوبر 2026',
  time: '5:00 م',
  preferred_time: 'مساء الأربعاء',
  preferred_date: '22 أكتوبر 2026',
  requester_name: 'مدرك الرواحي',
  check_in: '1 نوفمبر 2026',
  check_out: '5 نوفمبر 2026',
  contract_number: 'LC-2201',
  invoice_number: 'INV-8841',
  amount: '150.000',
  currency: 'ر.ع',
  due_date: '5 أكتوبر 2026',
  period: 'أكتوبر 2026',
  request_number: 'MR-441',
  status: 'قيد التنفيذ',
  badge_name: 'مضيف موثوق',
  achievement_reason: 'الالتزام بمعايير الضيافة',
  otp_code: '938447',
  expiry_minutes: '15',
  review_reason: 'صورة المستند غير واضحة',
  short_reason: 'صورة غير واضحة',
  reservation_number: 'RSV-MGUUXR6F',
  handover_date: '28 أكتوبر 2026',
  signatory_name: 'مدرك الرواحي',
  contract_status: 'بانتظار الطرف الثاني',
  guest_count: '2',
  refund_status: 'قيد المراجعة',
  payment_reference: 'PAY-2201',
  payment_date: '28 أكتوبر 2026',
  charge_description: 'إيجار أكتوبر',
  expiry_date: '31 ديسمبر 2026',
  week_range: '26–28 أكتوبر',
  vacancy_count: '3',
  request_type: 'صيانة',
  priority: 'عادية',
  task_number: 'TSK-18',
  task_title: 'فحص الوحدة A-12',
  assigned_by: 'عبد الحميد الرواحي',
  plan_name: 'النمو',
  effective_date: '1 نوفمبر 2026',
  case_reference: 'LEG-104',
  occasion_name: 'العيد الوطني',
  document_name: 'كشف المستحقات',
  reporting_period: 'أكتوبر 2026',
  required_documents: 'بطاقة شخصية، إثبات دخل',
  submission_deadline: '5 نوفمبر 2026',
  review_status: 'مقبول',
  receipt_number: 'RCPT-901',
  rent_period: 'أكتوبر 2026',
  claim_number: 'DEP-55',
  claim_status: 'قيد المراجعة',
  viewing_url: 'https://r.bhd-om.com/ar/viewing-pass?t=sample',
  request_url: 'https://r.bhd-om.com/ar/owner/bookings/viewings/sample',
  booking_url: 'https://r.bhd-om.com/ar/portal',
  contract_url: 'https://r.bhd-om.com/ar/portal',
  invoice_url: 'https://r.bhd-om.com/ar/portal',
  account_url: 'https://r.bhd-om.com/ar/account',
  badge_url: 'https://r.bhd-om.com/ar/admin/badges',
  reservation_url: 'https://r.bhd-om.com/ar/tenant',
  handover_url: 'https://r.bhd-om.com/ar/portal',
  property_url: 'https://r.bhd-om.com/ar/units/sample',
  stay_url: 'https://r.bhd-om.com/ar/stays',
  payment_url: 'https://r.bhd-om.com/ar/tenant/payments',
  vacancies_url: 'https://r.bhd-om.com/ar/owner',
  task_url: 'https://r.bhd-om.com/ar/owner/tasks',
  listing_url: 'https://r.bhd-om.com/ar/owner/properties',
  subscription_url: 'https://r.bhd-om.com/ar/admin/plans',
  case_url: 'https://r.bhd-om.com/ar/owner/legal',
  document_url: 'https://r.bhd-om.com/ar/owner/accounting',
  verification_url: 'https://r.bhd-om.com/ar/portal',
  receipt_url: 'https://r.bhd-om.com/ar/portal',
  claim_url: 'https://r.bhd-om.com/ar/portal',
};

const EN = {
  ...AR,
  organization_name: 'Mabani Al Noor',
  inviter_name: 'Abdul Hamid Al Rawahi',
  property_name: 'Mabani Al Noor',
  date: '22 October 2026',
  time: '5:00 PM',
  preferred_time: 'Wednesday evening',
  preferred_date: '22 October 2026',
  requester_name: 'Mudrik Al Rawahi',
  check_in: '1 November 2026',
  check_out: '5 November 2026',
  currency: 'OMR',
  due_date: '5 October 2026',
  period: 'October 2026',
  status: 'In progress',
  badge_name: 'Trusted host',
  achievement_reason: 'consistent hospitality standards',
  review_reason: 'the document image is unclear',
  short_reason: 'unclear image',
  handover_date: '28 October 2026',
  signatory_name: 'Mudrik Al Rawahi',
  contract_status: 'Awaiting second party',
  refund_status: 'Under review',
  payment_date: '28 October 2026',
  charge_description: 'October rent',
  expiry_date: '31 December 2026',
  week_range: '26–28 October',
  request_type: 'Maintenance',
  priority: 'Normal',
  task_title: 'Inspect unit A-12',
  assigned_by: 'Abdul Hamid Al Rawahi',
  plan_name: 'Growth',
  effective_date: '1 November 2026',
  occasion_name: 'National Day',
  document_name: 'Receivables statement',
  reporting_period: 'October 2026',
  required_documents: 'ID card, proof of income',
  submission_deadline: '5 November 2026',
  review_status: 'Approved',
  rent_period: 'October 2026',
  claim_status: 'Under review',
};

function fill(text, map) {
  return text
    .replace(/\{\{([a-z_]+)\}\}/gi, (_, key) => map[key] ?? '…')
    .trim();
}

for (const match of blocks) {
  const id = match[1];
  const body = match[2];
  const get = (label) => {
    const re = new RegExp(`\\*\\*${label}\\*\\*\\s*(.+)\\s*$`, 'm');
    const hit = body.match(re);
    return hit ? hit[1].trim() : '';
  };
  const ctaLine = get('الزر AR / EN:');
  const cta = ctaLine.split(/\s*\/\s*/);
  copy[id] = {
    subjectAr: fill(get('موضوع البريد AR:'), AR),
    subjectEn: fill(get('موضوع البريد EN:'), EN),
    titleAr: fill(get('العنوان AR:'), AR),
    titleEn: fill(get('العنوان EN:'), EN),
    introAr: fill(get('النص AR:'), AR),
    introEn: fill(get('النص EN:'), EN),
    ctaAr: (cta[0] || 'فتح').trim(),
    ctaEn: (cta[1] || 'Open').trim(),
  };
}

console.log('Parsed templates:', Object.keys(copy).length);

const root = path.resolve('src/lib');
const extraPath = path.join(root, 'notification-templates-catalog-extra.ts');
const mainPath = path.join(root, 'notification-templates-catalog.ts');

let extra = fs.readFileSync(extraPath, 'utf8');
let main = fs.readFileSync(mainPath, 'utf8');

function esc(s) {
  return s.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
}

function patchEntryFields(source, id, fields) {
  const start = source.indexOf(`id: '${id}'`);
  if (start < 0) {
    console.warn('missing id', id);
    return source;
  }
  let i = start;
  let depth = 0;
  let end = -1;
  for (; i < source.length; i++) {
    if (source[i] === '{') depth++;
    if (source[i] === '}') {
      depth--;
      if (depth === 0) {
        end = i + 1;
        break;
      }
    }
  }
  if (end < 0) return source;
  let block = source.slice(start, end);
  const set = (key, value) => {
    if (!value) return;
    const re = new RegExp(`(${key}:\\s*)'((?:\\\\'|[^'])*)'`);
    if (re.test(block)) block = block.replace(re, `$1'${esc(value)}'`);
  };
  set('subjectAr', fields.subjectAr);
  set('subjectEn', fields.subjectEn);
  set('titleAr', fields.titleAr);
  set('titleEn', fields.titleEn);
  set('introAr', fields.introAr);
  set('introEn', fields.introEn);
  if (fields.ctaAr && !/لا حاجة|No button/i.test(fields.ctaAr)) {
    set('ctaAr', fields.ctaAr);
    set('ctaEn', fields.ctaEn);
  }
  return source.slice(0, start) + block + source.slice(end);
}

function patchPair(source, id, fields) {
  const marker = `id: '${id}'`;
  const start = source.indexOf(marker);
  if (start < 0) {
    console.warn('missing main id', id);
    return source;
  }
  const pairStart = source.indexOf('...pair({', start);
  if (pairStart < 0) return source;
  let i = pairStart + '...pair('.length;
  let depth = 0;
  let end = -1;
  for (; i < source.length; i++) {
    if (source[i] === '{') depth++;
    if (source[i] === '}') {
      depth--;
      if (depth === 0) {
        end = i + 1;
        break;
      }
    }
  }
  if (end < 0) return source;
  let block = source.slice(pairStart, end);
  const setAny = (key, value) => {
    if (!value) return;
    const reQuote = new RegExp(`(${key}:\\s*)'((?:\\\\'|[^'])*)'`);
    const reTick = new RegExp(`(${key}:\\s*)\`((?:\\\\\`|[^\\\`])*)\``);
    if (reQuote.test(block)) block = block.replace(reQuote, `$1'${esc(value)}'`);
    else if (reTick.test(block)) block = block.replace(reTick, `$1'${esc(value)}'`);
  };
  setAny('subjectAr', fields.subjectAr);
  setAny('subjectEn', fields.subjectEn);
  setAny('titleAr', fields.titleAr);
  setAny('titleEn', fields.titleEn);
  setAny('introAr', fields.introAr);
  setAny('introEn', fields.introEn);
  if (fields.ctaAr && !/لا حاجة|No button/i.test(fields.ctaAr)) {
    setAny('ctaAr', fields.ctaAr);
    setAny('ctaEn', fields.ctaEn);
  }
  return source.slice(0, pairStart) + block + source.slice(end);
}

const mainIds = [
  'team-invite',
  'viewing-scheduled-guest',
  'viewing-scheduled-contact',
  'viewing-request-owner',
  'booking-confirmed',
  'contract-ready',
  'invoice-issued',
  'arrears-reminder',
  'maintenance-update',
  'verification',
  'badge-awarded',
];

for (const id of mainIds) {
  if (copy[id]) main = patchPair(main, id, copy[id]);
}

for (const id of Object.keys(copy)) {
  if (mainIds.includes(id)) continue;
  extra = patchEntryFields(extra, id, copy[id]);
}

// Force OTP to alert tone (no warm wishes).
extra = extra.replace(
  /(id: 'email-otp',\s*category: 'account',\s*)tone: 'general'/,
  "$1tone: 'alert'",
);

fs.writeFileSync(mainPath, main);
fs.writeFileSync(extraPath, extra);
console.log('Updated catalogs cleanly');
