'use client';

import { formatMoney } from '@/lib/format';
import { whatsappLink } from '@/lib/stay-deposit-claims';

const PAGE_W = 794;
const PAGE_H = 1123;
const SCALE = 2;
const MARGIN = 46;

type Sheet = {
  rtl: boolean;
  pages: HTMLCanvasElement[];
  ctx: CanvasRenderingContext2D;
  y: number;
};

function font(weight: number, size: number) {
  return `${weight} ${size}px Tahoma, "Segoe UI", "IBM Plex Sans Arabic", sans-serif`;
}

function freshPage(sheet: Sheet) {
  const canvas = document.createElement('canvas');
  canvas.width = PAGE_W * SCALE;
  canvas.height = PAGE_H * SCALE;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('canvas');
  ctx.scale(SCALE, SCALE);
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, PAGE_W, PAGE_H);
  sheet.pages.push(canvas);
  sheet.ctx = ctx;
  sheet.y = MARGIN;
}

function ensure(sheet: Sheet, height: number) {
  if (sheet.y + height > PAGE_H - MARGIN) freshPage(sheet);
}

function drawText(sheet: Sheet, text: string, size: number, weight: number, color = '#111111') {
  ensure(sheet, size + 10);
  const ctx = sheet.ctx;
  ctx.font = font(weight, size);
  ctx.fillStyle = color;
  ctx.direction = sheet.rtl ? 'rtl' : 'ltr';
  ctx.textAlign = sheet.rtl ? 'right' : 'left';
  const max = PAGE_W - MARGIN * 2;
  const lines = wrapText(ctx, text, max);
  for (const line of lines) {
    ensure(sheet, size + 8);
    ctx.fillText(line, sheet.rtl ? PAGE_W - MARGIN : MARGIN, sheet.y + size);
    sheet.y += size + 6;
  }
}

function wrapText(ctx: CanvasRenderingContext2D, text: string, max: number): string[] {
  const words = text.split(/\s+/).filter(Boolean);
  if (!words.length) return [''];
  const lines: string[] = [];
  let current = '';
  for (const word of words) {
    const next = current ? `${current} ${word}` : word;
    if (ctx.measureText(next).width <= max) {
      current = next;
      continue;
    }
    if (current) lines.push(current);
    current = word;
  }
  if (current) lines.push(current);
  return lines.length ? lines : [''];
}

function clip(ctx: CanvasRenderingContext2D, text: string, max: number): string {
  if (ctx.measureText(text).width <= max) return text;
  let value = text;
  while (value.length > 1 && ctx.measureText(`${value}…`).width > max) {
    value = value.slice(0, -1);
  }
  return `${value}…`;
}

function drawTable(sheet: Sheet, columns: string[], rows: string[][]) {
  const cols = Math.max(columns.length, 1);
  const inner = PAGE_W - MARGIN * 2;
  const colW = inner / cols;
  const rowH = 32;
  const paint = (cells: string[], header: boolean) => {
    ensure(sheet, rowH);
    const y = sheet.y;
    const ctx = sheet.ctx;
    ctx.fillStyle = header ? '#f3f3f3' : '#ffffff';
    ctx.fillRect(MARGIN, y, inner, rowH);
    ctx.strokeStyle = '#bbbbbb';
    ctx.lineWidth = 1;
    ctx.font = font(header ? 700 : 400, 13);
    ctx.fillStyle = '#111111';
    for (let i = 0; i < cols; i += 1) {
      const slot = sheet.rtl ? cols - 1 - i : i;
      const x = MARGIN + slot * colW;
      ctx.strokeRect(x, y, colW, rowH);
      const cell = cells[i] ?? '';
      const numeric = /[0-9٠-٩]/.test(cell) && !/[A-Za-z\u0600-\u06FF]{3,}/.test(cell);
      ctx.direction = numeric ? 'ltr' : sheet.rtl ? 'rtl' : 'ltr';
      ctx.textAlign = numeric || !sheet.rtl ? 'left' : 'right';
      const shown = clip(ctx, cell, colW - 14);
      const tx = numeric || !sheet.rtl ? x + 6 : x + colW - 6;
      ctx.fillText(shown, tx, y + 21);
    }
    sheet.y += rowH;
  };
  paint(columns, true);
  if (!rows.length) paint(['—'], false);
  for (const row of rows) paint(row, false);
  sheet.y += 12;
}

function drawSigns(sheet: Sheet, left: string, right: string) {
  ensure(sheet, 70);
  sheet.y += 28;
  const ctx = sheet.ctx;
  ctx.strokeStyle = '#333333';
  ctx.fillStyle = '#111111';
  ctx.font = font(400, 13);
  ctx.direction = 'ltr';
  ctx.textAlign = 'center';
  const y = sheet.y;
  ctx.beginPath();
  ctx.moveTo(MARGIN, y);
  ctx.lineTo(MARGIN + 180, y);
  ctx.moveTo(PAGE_W - MARGIN - 180, y);
  ctx.lineTo(PAGE_W - MARGIN, y);
  ctx.stroke();
  ctx.fillText(sheet.rtl ? right : left, MARGIN + 90, y + 20);
  ctx.fillText(sheet.rtl ? left : right, PAGE_W - MARGIN - 90, y + 20);
  sheet.y += 36;
}

async function canvasesToPdf(pages: HTMLCanvasElement[]): Promise<Blob> {
  const jpegs: Uint8Array[] = [];
  for (const canvas of pages) {
    const blob = await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob((value) => (value ? resolve(value) : reject(new Error('jpeg'))), 'image/jpeg', 0.92);
    });
    jpegs.push(new Uint8Array(await blob.arrayBuffer()));
  }
  const pdf = jpegPagesToPdf(jpegs);
  return new Blob([pdf.buffer as ArrayBuffer], { type: 'application/pdf' });
}

function jpegSize(bytes: Uint8Array): { w: number; h: number } {
  let i = 2;
  while (i < bytes.length - 9) {
    if (bytes[i] !== 0xff) {
      i += 1;
      continue;
    }
    const marker = bytes[i + 1] ?? 0;
    if (marker === 0xc0 || marker === 0xc2) {
      return {
        h: ((bytes[i + 5] ?? 0) << 8) | (bytes[i + 6] ?? 0),
        w: ((bytes[i + 7] ?? 0) << 8) | (bytes[i + 8] ?? 0),
      };
    }
    const len = ((bytes[i + 2] ?? 0) << 8) | (bytes[i + 3] ?? 0);
    i += 2 + len;
  }
  return { w: PAGE_W * SCALE, h: PAGE_H * SCALE };
}

function jpegPagesToPdf(jpegs: Uint8Array[]): Uint8Array {
  const enc = new TextEncoder();
  const chunks: Uint8Array[] = [];
  const offsets: number[] = [];
  let length = 0;
  const push = (data: Uint8Array) => {
    chunks.push(data);
    length += data.length;
  };
  const pushStr = (value: string) => push(enc.encode(value));
  const obj = (id: number, body: string) => {
    offsets[id] = length;
    pushStr(`${id} 0 obj\n${body}\nendobj\n`);
  };

  pushStr('%PDF-1.4\n');
  const count = jpegs.length;
  const kids = Array.from({ length: count }, (_, index) => `${3 + index * 3} 0 R`).join(' ');
  obj(1, '<< /Type /Catalog /Pages 2 0 R >>');
  obj(2, `<< /Type /Pages /Count ${count} /Kids [${kids}] >>`);

  jpegs.forEach((jpeg, index) => {
    const pageId = 3 + index * 3;
    const contentId = pageId + 1;
    const imageId = pageId + 2;
    const { w, h } = jpegSize(jpeg);
    const stream = 'q 595.28 0 0 841.89 0 0 cm /Im0 Do Q\n';
    obj(
      pageId,
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595.28 841.89] /Contents ${contentId} 0 R /Resources << /XObject << /Im0 ${imageId} 0 R >> >> >>`,
    );
    obj(contentId, `<< /Length ${enc.encode(stream).length} >>\nstream\n${stream}endstream`);
    offsets[imageId] = length;
    pushStr(
      `${imageId} 0 obj\n<< /Type /XObject /Subtype /Image /Width ${w} /Height ${h} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${jpeg.length} >>\nstream\n`,
    );
    push(jpeg);
    pushStr('\nendstream\nendobj\n');
  });

  const xrefAt = length;
  const size = 2 + count * 3;
  let xref = `xref\n0 ${size + 1}\n0000000000 65535 f \n`;
  for (let id = 1; id <= size; id += 1) {
    xref += `${String(offsets[id] ?? 0).padStart(10, '0')} 00000 n \n`;
  }
  xref += `trailer\n<< /Size ${size + 1} /Root 1 0 R >>\nstartxref\n${xrefAt}\n%%EOF`;
  pushStr(xref);

  const out = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.length;
  }
  return out;
}

function safeName(value: string): string {
  const cleaned = value.replace(/[^\w\u0600-\u06FF.-]+/g, '-').replace(/-+/g, '-').slice(0, 80);
  return cleaned || 'bhd-r';
}

/** Download the PDF, open it, then ask the PDF viewer to print. */
async function deliverPdf(blob: Blob, filename: string, ar: boolean): Promise<string | null> {
  const name = filename.toLowerCase().endsWith('.pdf') ? filename : `${filename}.pdf`;
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = name;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  const viewer = window.open(url, '_blank');
  if (!viewer) {
    window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
    return ar
      ? 'تم تنزيل ملف PDF. اسمح بالنوافذ المنبثقة لفتحه والطباعة منه.'
      : 'The PDF was downloaded. Allow pop-ups to open it and print from the file.';
  }
  window.setTimeout(() => {
    try {
      viewer.focus();
      viewer.print();
    } catch {
      /* The PDF tab is open; the user prints from the viewer. */
    }
  }, 800);
  window.setTimeout(() => URL.revokeObjectURL(url), 120_000);
  return null;
}

async function renderPdf(
  rtl: boolean,
  filename: string,
  paint: (sheet: Sheet) => void,
): Promise<string | null> {
  const sheet: Sheet = {
    rtl,
    pages: [],
    ctx: null as unknown as CanvasRenderingContext2D,
    y: 0,
  };
  freshPage(sheet);
  if (document.fonts?.ready) await document.fonts.ready;
  paint(sheet);
  const blob = await canvasesToPdf(sheet.pages);
  return deliverPdf(blob, safeName(filename), rtl);
}

export type PrintJournalInput = {
  reference: string;
  occurredOn: string;
  description: string;
  status: string;
  sourceType?: string | null;
  totals: { debitMinor: string; creditMinor: string };
  lines: Array<{
    code: string;
    nameAr: string;
    nameEn: string;
    debitMinor: string;
    creditMinor: string;
    currency: string;
    memo: string | null;
    partyName: string | null;
    propertyNameAr: string | null;
    unitCode: string | null;
  }>;
};

export async function printAccountingJournal(
  journal: PrintJournalInput,
  locale: 'ar' | 'en',
): Promise<string | null> {
  const ar = locale === 'ar';
  const money = (minor: string, currency: string) =>
    !minor || minor === '0' ? '—' : formatMoney(minor, currency, locale);
  return renderPdf(ar, `journal-${journal.reference}`, (sheet) => {
    drawText(sheet, ar ? 'BHD R · قيد يومية' : 'BHD R · Journal entry', 22, 700);
    drawText(
      sheet,
      ar ? 'قيد مزدوج من محاسبة العقارات التشغيلية' : 'Double-entry from the property operational GL',
      13,
      400,
      '#555555',
    );
    drawText(sheet, `${ar ? 'المرجع' : 'Reference'}: ${journal.reference}`, 14, 600);
    drawText(sheet, `${ar ? 'التاريخ' : 'Date'}: ${journal.occurredOn}`, 14, 400);
    drawText(sheet, `${ar ? 'الحالة' : 'Status'}: ${journal.status}`, 14, 400);
    drawText(sheet, `${ar ? 'البيان' : 'Description'}: ${journal.description}`, 14, 400);
    if (journal.sourceType) {
      drawText(sheet, `${ar ? 'المصدر' : 'Source'}: ${journal.sourceType}`, 14, 400);
    }
    sheet.y += 8;
    drawTable(
      sheet,
      [
        ar ? 'الحساب' : 'Account',
        ar ? 'البُعد' : 'Dimension',
        ar ? 'ملاحظة' : 'Memo',
        ar ? 'مدين' : 'Debit',
        ar ? 'دائن' : 'Credit',
      ],
      journal.lines.map((line) => [
        `${line.code} · ${ar ? line.nameAr : line.nameEn}`,
        [line.partyName, line.propertyNameAr, line.unitCode].filter(Boolean).join(' · ') || '—',
        line.memo || '—',
        money(line.debitMinor, line.currency),
        money(line.creditMinor, line.currency),
      ]),
    );
    drawText(
      sheet,
      `${ar ? 'الإجمالي' : 'Total'}: ${money(journal.totals.debitMinor, 'OMR')} / ${money(journal.totals.creditMinor, 'OMR')}`,
      14,
      700,
    );
    drawText(
      sheet,
      ar
        ? 'الأستاذ الضريبي المفصّل في Hisaby عند الربط.'
        : 'Detailed tax GL lives in Hisaby when linked.',
      12,
      400,
      '#555555',
    );
    drawSigns(sheet, ar ? 'المحاسب' : 'Accountant', ar ? 'المالك / الإدارة' : 'Owner / management');
  });
}

export type PrintDocumentInput = {
  kind: 'invoice' | 'receipt' | 'journal';
  reference: string;
  title: string;
  status: string;
  amountMinor: string;
  currency: string;
  occurredOn: string;
  partyName: string | null;
  propertyLabel: string | null;
  note: string | null;
};

export async function printAccountingDocument(
  doc: PrintDocumentInput,
  locale: 'ar' | 'en',
): Promise<string | null> {
  const ar = locale === 'ar';
  const kindLabel =
    doc.kind === 'receipt'
      ? ar
        ? 'إيصال قبض'
        : 'Receipt'
      : doc.kind === 'invoice'
        ? ar
          ? 'فاتورة مطالبة'
          : 'Demand invoice'
        : ar
          ? 'قيد يومية'
          : 'Journal';
  const amount =
    doc.amountMinor && doc.amountMinor !== '0'
      ? formatMoney(doc.amountMinor, doc.currency || 'OMR', locale)
      : '—';
  return renderPdf(ar, `${doc.kind}-${doc.reference}`, (sheet) => {
    drawText(sheet, `BHD R · ${kindLabel}`, 22, 700);
    drawText(sheet, doc.title, 14, 400, '#555555');
    sheet.y += 8;
    drawTable(
      sheet,
      [ar ? 'البند' : 'Field', ar ? 'القيمة' : 'Value'],
      [
        [ar ? 'المرجع' : 'Reference', doc.reference],
        [ar ? 'التاريخ' : 'Date', doc.occurredOn],
        [ar ? 'الحالة' : 'Status', doc.status],
        [ar ? 'الطرف' : 'Party', doc.partyName || '—'],
        [ar ? 'العقار' : 'Property', doc.propertyLabel || '—'],
        [ar ? 'المبلغ' : 'Amount', amount],
        [ar ? 'ملاحظة' : 'Note', doc.note || '—'],
      ],
    );
    drawText(
      sheet,
      ar
        ? 'مستند تشغيلي من برنامج العقارات. الميزان والضريبة في Hisaby عند الربط.'
        : 'Operational slip from the property app. Trial balance and tax live in Hisaby when linked.',
      12,
      400,
      '#555555',
    );
    drawSigns(sheet, ar ? 'المحاسب' : 'Accountant', ar ? 'المالك / الإدارة' : 'Owner / management');
  });
}

export type PrintReportInput = {
  title: string;
  subtitle?: string;
  columns: string[];
  rows: string[][];
  footer?: string;
};

export async function printAccountingReport(
  input: PrintReportInput,
  locale: 'ar' | 'en',
): Promise<string | null> {
  const ar = locale === 'ar';
  return renderPdf(ar, input.title, (sheet) => {
    drawText(sheet, `BHD R · ${input.title}`, 22, 700);
    if (input.subtitle) drawText(sheet, input.subtitle, 13, 400, '#555555');
    sheet.y += 8;
    drawTable(sheet, input.columns, input.rows);
    if (input.footer) drawText(sheet, input.footer, 12, 400, '#555555');
  });
}

/** Build a WhatsApp share URL for an accounting document (opens wa.me; Meta Cloud API is Hisaby-side). */
export function accountingWhatsappShare(input: {
  phone?: string | null;
  title: string;
  reference: string;
  amountText: string;
  occurredOn: string;
  link?: string;
  locale: 'ar' | 'en';
}): string {
  const ar = input.locale === 'ar';
  const lines = [
    `BHD R · ${input.title}`,
    `${ar ? 'المرجع' : 'Ref'}: ${input.reference}`,
    `${ar ? 'التاريخ' : 'Date'}: ${input.occurredOn}`,
    `${ar ? 'المبلغ' : 'Amount'}: ${input.amountText}`,
  ];
  if (input.link) lines.push(input.link);
  const text = lines.join('\n');
  if (input.phone) {
    const url = whatsappLink(input.phone, text);
    if (url) return url;
  }
  return `https://wa.me/?text=${encodeURIComponent(text)}`;
}

export function accountingMailtoShare(input: {
  email?: string | null;
  title: string;
  reference: string;
  body: string;
}): string {
  const subject = encodeURIComponent(`${input.title} ${input.reference}`);
  const body = encodeURIComponent(input.body);
  return `mailto:${input.email ?? ''}?subject=${subject}&body=${body}`;
}
