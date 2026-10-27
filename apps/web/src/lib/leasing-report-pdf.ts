import 'server-only';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Resvg } from '@resvg/resvg-js';
import sharp from 'sharp';
import type { LeasingPrintRow } from '@/lib/leasing-ops-table';
import { serverBrandedQrSvg } from '@/lib/qr-branded';
import { publicWebOrigin } from '@/lib/seo';

export type LeasingPdfOrientation = 'portrait' | 'landscape';

export type LeasingPdfSnapshot = {
  token: string;
  locale: 'ar' | 'en';
  title: string;
  issuedAt: string;
  byName: string | null;
  rowCount: number;
  rows: LeasingPrintRow[];
};

const MODULE_DIR = path.dirname(fileURLToPath(import.meta.url));
/** PDF user space — ISO A4 in points. */
const A4_PT = { w: 595.28, h: 841.89 };
/** Raster scale for crisp Arabic text. */
const DPI_SCALE = 2;

function fontCandidates(): string[] {
  const names = [
    'NotoNaskhArabic-Bold.ttf',
    'NotoNaskhArabic-Regular.ttf',
    'NotoSans-Bold.ttf',
    'NotoSans-Regular.ttf',
  ];
  const dirs = [
    path.join(MODULE_DIR, '../../assets/fonts'),
    path.join(MODULE_DIR, '../../../assets/fonts'),
    path.join(process.cwd(), 'assets/fonts'),
    path.join(process.cwd(), 'apps/web/assets/fonts'),
    path.join(process.cwd(), 'public/fonts'),
  ];
  const found: string[] = [];
  for (const dir of dirs) {
    for (const name of names) {
      const full = path.join(dir, name);
      if (existsSync(full)) found.push(full);
    }
  }
  return [...new Set(found)];
}

function fontFaceFamily(file: string): 'NotoNaskhReport' | 'NotoSansReport' {
  return /NotoSans/i.test(path.basename(file)) ? 'NotoSansReport' : 'NotoNaskhReport';
}

/** Resvg needs explicit `fontFiles` — CSS @font-face alone does not paint text. */
function loadFonts(): { css: string; files: string[] } {
  const files = fontCandidates();
  const css = files
    .map((file) => {
      const bold = /Bold/i.test(path.basename(file));
      const family = fontFaceFamily(file);
      const b64 = readFileSync(file).toString('base64');
      return `@font-face{font-family:'${family}';font-weight:${bold ? 700 : 400};font-style:normal;src:url('data:font/ttf;base64,${b64}') format('truetype');}`;
    })
    .join('');
  return { css, files };
}

const REPORT_FONT_STACK = `'NotoNaskhReport', 'NotoSansReport', sans-serif`;

function logoDataUri(): string | null {
  const candidates = [
    path.join(process.cwd(), 'public/brand/bhd-email-logo.png'),
    path.join(process.cwd(), 'apps/web/public/brand/bhd-email-logo.png'),
    path.join(MODULE_DIR, '../../public/brand/bhd-email-logo.png'),
  ];
  for (const file of candidates) {
    if (!existsSync(file)) continue;
    return `data:image/png;base64,${readFileSync(file).toString('base64')}`;
  }
  return null;
}

function escapeXml(value: string): string {
  return value.replace(/[<>&"']/g, (character) => {
    const map: Record<string, string> = {
      '<': '&lt;',
      '>': '&gt;',
      '&': '&amp;',
      '"': '&quot;',
      "'": '&apos;',
    };
    return map[character] ?? character;
  });
}

function stamp(iso: string, ar: boolean): string {
  return new Date(iso).toLocaleString(ar ? 'ar-OM' : 'en-GB', {
    timeZone: 'Asia/Muscat',
    dateStyle: 'medium',
    timeStyle: 'short',
  });
}

function pageSizePt(orientation: LeasingPdfOrientation): { w: number; h: number } {
  return orientation === 'landscape'
    ? { w: A4_PT.h, h: A4_PT.w }
    : { w: A4_PT.w, h: A4_PT.h };
}

function columnLabels(ar: boolean): string[] {
  return ar
    ? ['العقد', 'المبنى', 'الوحدة', 'المالك', 'المستأجر', 'الحالة', 'البداية', 'النهاية', 'الإيجار']
    : ['Contract', 'Building', 'Unit', 'Owner', 'Tenant', 'Status', 'Starts', 'Ends', 'Rent'];
}

/** Relative widths (sum ≈ 1) — wider sheet in landscape. */
function columnWeights(orientation: LeasingPdfOrientation): number[] {
  return orientation === 'landscape'
    ? [0.11, 0.14, 0.07, 0.14, 0.16, 0.08, 0.09, 0.09, 0.12]
    : [0.12, 0.13, 0.07, 0.13, 0.14, 0.08, 0.1, 0.1, 0.13];
}

function truncate(value: string, max: number): string {
  const text = value.trim() || '—';
  if (text.length <= max) return text;
  return `${text.slice(0, Math.max(1, max - 1))}…`;
}

function buildPdfFromJpegs(
  pages: Array<{ jpeg: Buffer; widthPx: number; heightPx: number }>,
  pagePt: { w: number; h: number },
): Uint8Array {
  const parts: Buffer[] = [];
  let size = 0;
  const enc = (text: string) => Buffer.from(text, 'utf8');
  const objectOffsets: number[] = [];

  const addObject = (text: string, binary?: Buffer) => {
    objectOffsets.push(size);
    if (binary) {
      const head = enc(text);
      parts.push(head);
      size += head.length;
      parts.push(binary);
      size += binary.length;
      const tail = enc('\nendstream\nendobj\n');
      parts.push(tail);
      size += tail.length;
      return;
    }
    const buf = enc(text);
    parts.push(buf);
    size += buf.length;
  };

  const pageCount = pages.length;
  const kids = pages.map((_, index) => `${3 + index * 3} 0 R`).join(' ');

  parts.push(enc('%PDF-1.4\n'));
  size += parts[0]!.length;

  addObject(`1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n`);
  addObject(`2 0 obj\n<< /Type /Pages /Kids [${kids}] /Count ${pageCount} >>\nendobj\n`);

  for (let i = 0; i < pageCount; i += 1) {
    const pageObj = 3 + i * 3;
    const contentObj = pageObj + 1;
    const imageObj = pageObj + 2;
    const page = pages[i]!;
    const content = `q ${pagePt.w.toFixed(2)} 0 0 ${pagePt.h.toFixed(2)} 0 0 cm /Im${i} Do Q`;
    addObject(
      `${pageObj} 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${pagePt.w.toFixed(2)} ${pagePt.h.toFixed(2)}] /Contents ${contentObj} 0 R /Resources << /XObject << /Im${i} ${imageObj} 0 R >> >> >>\nendobj\n`,
    );
    addObject(
      `${contentObj} 0 obj\n<< /Length ${Buffer.byteLength(content, 'utf8')} >>\nstream\n${content}\nendstream\nendobj\n`,
    );
    addObject(
      `${imageObj} 0 obj\n<< /Type /XObject /Subtype /Image /Width ${page.widthPx} /Height ${page.heightPx} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${page.jpeg.length} >>\nstream\n`,
      page.jpeg,
    );
  }

  const xrefStart = size;
  const totalObjects = 2 + pageCount * 3;
  let xref = `xref\n0 ${totalObjects + 1}\n0000000000 65535 f \n`;
  for (let i = 0; i < totalObjects; i += 1) {
    xref += `${String(objectOffsets[i] ?? 0).padStart(10, '0')} 00000 n \n`;
  }
  xref += `trailer\n<< /Size ${totalObjects + 1} /Root 1 0 R >>\nstartxref\n${xrefStart}\n%%EOF\n`;
  parts.push(enc(xref));
  return Buffer.concat(parts);
}

function buildPageSvg(input: {
  ar: boolean;
  orientation: LeasingPdfOrientation;
  pageIndex: number;
  pageCount: number;
  snapshot: LeasingPdfSnapshot;
  verifyUrl: string;
  qrDataUri: string;
  logoUri: string | null;
  fontCss: string;
  rows: LeasingPrintRow[];
  widthPx: number;
  heightPx: number;
}): string {
  const {
    ar,
    orientation,
    pageIndex,
    pageCount,
    snapshot,
    verifyUrl,
    qrDataUri,
    logoUri,
    fontCss,
    rows,
    widthPx,
    heightPx,
  } = input;
  const margin = orientation === 'landscape' ? 36 : 40;
  const contentW = widthPx - margin * 2;
  const headerH = orientation === 'landscape' ? 150 : 168;
  const footerH = 70;
  const tableTop = margin + headerH;
  const tableBottom = heightPx - margin - footerH;
  const labels = columnLabels(ar);
  const weights = columnWeights(orientation);
  const fontSize = orientation === 'landscape' ? 15 : 13;
  const headerFont = orientation === 'landscape' ? 13 : 12;
  const rowH = orientation === 'landscape' ? 28 : 30;
  const maxChars = orientation === 'landscape'
    ? [14, 18, 8, 18, 20, 10, 12, 12, 14]
    : [12, 14, 7, 14, 16, 9, 11, 11, 12];

  let x = margin;
  const colX: number[] = [];
  const colW: number[] = [];
  for (let i = 0; i < weights.length; i += 1) {
    const w = contentW * weights[i]!;
    colX.push(x);
    colW.push(w);
    x += w;
  }

  const dir = ar ? 'rtl' : 'ltr';
  const anchor = 'middle';

  const headerCells = labels
    .map((label, i) => {
      const cx = colX[i]! + colW[i]! / 2;
      return `<rect x="${colX[i]}" y="${tableTop}" width="${colW[i]}" height="${rowH}" fill="#07543E"/><text x="${cx}" y="${tableTop + rowH * 0.68}" text-anchor="${anchor}" direction="${dir}" font-family="${REPORT_FONT_STACK}" font-size="${headerFont}" font-weight="700" fill="#ffffff">${escapeXml(label)}</text>`;
    })
    .join('');

  const bodyRows = rows
    .map((row, rowIndex) => {
      const y = tableTop + rowH * (rowIndex + 1);
      const bg = rowIndex % 2 === 0 ? '#f4faf6' : '#ffffff';
      const cells = [
        row.reference,
        row.property,
        row.unit,
        row.owner,
        row.tenant,
        row.state,
        row.startsOn,
        row.endsOn,
        row.rent,
      ];
      return (
        `<rect x="${margin}" y="${y}" width="${contentW}" height="${rowH}" fill="${bg}"/>` +
        cells
          .map((value, i) => {
            const cx = colX[i]! + colW[i]! / 2;
            const text = truncate(String(value ?? ''), maxChars[i] ?? 12);
            return `<text x="${cx}" y="${y + rowH * 0.68}" text-anchor="${anchor}" direction="${dir}" font-family="${REPORT_FONT_STACK}" font-size="${fontSize}" font-weight="400" fill="#1f2924">${escapeXml(text)}</text>`;
          })
          .join('')
      );
    })
    .join('');

  const gridLines = Array.from({ length: rows.length + 2 }, (_, i) => {
    const y = tableTop + rowH * i;
    return `<line x1="${margin}" y1="${y}" x2="${margin + contentW}" y2="${y}" stroke="#c5d5cc" stroke-width="1"/>`;
  }).join('');

  const vLines = colX
    .map((cx, i) =>
      i === 0
        ? ''
        : `<line x1="${cx}" y1="${tableTop}" x2="${cx}" y2="${tableTop + rowH * (rows.length + 1)}" stroke="#c5d5cc" stroke-width="1"/>`,
    )
    .join('');

  const logo = logoUri
    ? `<image href="${logoUri}" x="${ar ? widthPx - margin - 170 : margin}" y="${margin}" width="160" height="48" preserveAspectRatio="xMidYMid meet"/>`
    : '';

  const titleX = ar ? widthPx - margin - 190 : margin + 180;
  const titleAnchor = ar ? 'end' : 'start';
  const metaLines = [
    `${ar ? 'تاريخ الإصدار' : 'Issued'} · ${stamp(snapshot.issuedAt, ar)}${snapshot.byName ? ` · ${snapshot.byName}` : ''}`,
    `${snapshot.rowCount} ${ar ? 'سجل' : 'rows'} · ${snapshot.token}`,
    `${ar ? 'صفحة' : 'Page'} ${pageIndex + 1} / ${pageCount}`,
  ];

  const qrSize = orientation === 'landscape' ? 96 : 110;
  const qrX = ar ? margin : widthPx - margin - qrSize;
  const qrY = margin;

  void tableBottom;

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${widthPx}" height="${heightPx}" viewBox="0 0 ${widthPx} ${heightPx}">
  <defs><style><![CDATA[
    ${fontCss}
    text { font-family: ${REPORT_FONT_STACK}; }
  ]]></style></defs>
  <rect width="100%" height="100%" fill="#ffffff"/>
  <rect x="0" y="0" width="${widthPx}" height="8" fill="#07543E"/>
  ${logo}
  <text x="${titleX}" y="${margin + 28}" text-anchor="${titleAnchor}" direction="${dir}" font-family="${REPORT_FONT_STACK}" font-size="14" font-weight="700" fill="#0b7a74">BHD R · ${ar ? 'تقرير رسمي' : 'Official report'}</text>
  <text x="${titleX}" y="${margin + 56}" text-anchor="${titleAnchor}" direction="${dir}" font-family="${REPORT_FONT_STACK}" font-size="${orientation === 'landscape' ? 26 : 24}" font-weight="700" fill="#12201a">${escapeXml(snapshot.title)}</text>
  ${metaLines
    .map(
      (line, i) =>
        `<text x="${titleX}" y="${margin + 84 + i * 20}" text-anchor="${titleAnchor}" direction="${dir}" font-family="${REPORT_FONT_STACK}" font-size="13" font-weight="400" fill="#4b5d55">${escapeXml(line)}</text>`,
    )
    .join('')}
  <image href="${qrDataUri}" x="${qrX}" y="${qrY}" width="${qrSize}" height="${qrSize}" preserveAspectRatio="xMidYMid meet"/>
  <text x="${qrX + qrSize / 2}" y="${qrY + qrSize + 16}" text-anchor="middle" direction="${dir}" font-family="${REPORT_FONT_STACK}" font-size="11" font-weight="700" fill="#5a6a63">${ar ? 'امسح للتحقق' : 'Scan to verify'}</text>
  ${headerCells}
  ${bodyRows}
  ${gridLines}
  ${vLines}
  <line x1="${margin}" y1="${heightPx - margin - footerH + 8}" x2="${margin + contentW}" y2="${heightPx - margin - footerH + 8}" stroke="#d5e0da" stroke-width="1"/>
  <text x="${ar ? widthPx - margin : margin}" y="${heightPx - margin - 36}" text-anchor="${ar ? 'end' : 'start'}" direction="${dir}" font-family="${REPORT_FONT_STACK}" font-size="12" font-weight="400" fill="#4b5d55">${ar ? 'التحقق:' : 'Verify:'} ${escapeXml(verifyUrl)}</text>
  <text x="${ar ? widthPx - margin : margin}" y="${heightPx - margin - 14}" text-anchor="${ar ? 'end' : 'start'}" direction="${dir}" font-family="${REPORT_FONT_STACK}" font-size="11" font-weight="400" fill="#6a7771">${ar ? 'صدر إلكترونياً من منصة BHD R — بن حمود للتطوير.' : 'Issued electronically by BHD R — Bin Hamood Development.'}</text>
</svg>`;
}

/**
 * Official A4 PDF (real file) for a sealed leasing report — portrait or landscape.
 */
export async function renderLeasingPdf(
  snapshot: LeasingPdfSnapshot,
  orientation: LeasingPdfOrientation = 'portrait',
): Promise<{ bytes: Uint8Array; filename: string; mime: string }> {
  const ar = snapshot.locale === 'ar';
  const pagePt = pageSizePt(orientation);
  const widthPx = Math.round(pagePt.w * DPI_SCALE);
  const heightPx = Math.round(pagePt.h * DPI_SCALE);
  const { css: fontCss, files: fontFiles } = loadFonts();
  if (!fontFiles.some((file) => /NotoNaskhArabic/i.test(file))) {
    throw new Error('report_fonts_missing');
  }
  const logoUri = logoDataUri();
  const verifyUrl = `${publicWebOrigin()}/${snapshot.locale}/verify/leasing/${encodeURIComponent(snapshot.token)}`;
  const qrSvg = await serverBrandedQrSvg(verifyUrl, {
    width: 200,
    dark: '#0b3d2a',
    light: '#ffffff',
  });
  const qrDataUri = `data:image/svg+xml;base64,${Buffer.from(qrSvg, 'utf8').toString('base64')}`;

  const margin = orientation === 'landscape' ? 36 : 40;
  const headerH = orientation === 'landscape' ? 150 : 168;
  const footerH = 70;
  const rowH = orientation === 'landscape' ? 28 : 30;
  const usable = heightPx - margin * 2 - headerH - footerH - rowH; // minus header row
  const rowsPerPage = Math.max(4, Math.floor(usable / rowH));
  const allRows = snapshot.rows;
  const pageCount = Math.max(1, Math.ceil(allRows.length / rowsPerPage));

  const jpegPages: Array<{ jpeg: Buffer; widthPx: number; heightPx: number }> = [];
  for (let pageIndex = 0; pageIndex < pageCount; pageIndex += 1) {
    const slice = allRows.slice(pageIndex * rowsPerPage, (pageIndex + 1) * rowsPerPage);
    const svg = buildPageSvg({
      ar,
      orientation,
      pageIndex,
      pageCount,
      snapshot,
      verifyUrl,
      qrDataUri,
      logoUri,
      fontCss,
      rows: slice,
      widthPx,
      heightPx,
    });
    const png = new Resvg(svg, {
      fitTo: { mode: 'width', value: widthPx },
      font: {
        fontFiles,
        // Fallback for rare glyphs; primary faces come from bundled TTFs above.
        loadSystemFonts: true,
        defaultFontFamily: 'NotoNaskhReport',
      },
    })
      .render()
      .asPng();
    const jpeg = await sharp(png).jpeg({ quality: 88, mozjpeg: true }).toBuffer();
    jpegPages.push({ jpeg, widthPx, heightPx });
  }

  const bytes = buildPdfFromJpegs(jpegPages, pagePt);
  const stampDay = snapshot.issuedAt.slice(0, 10);
  const orient = orientation === 'landscape' ? 'landscape' : 'portrait';
  return {
    bytes,
    filename: `bhd-r-leasing-${stampDay}-${orient}.pdf`,
    mime: 'application/pdf',
  };
}
