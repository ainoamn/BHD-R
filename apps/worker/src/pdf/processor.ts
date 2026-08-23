import { createHash } from 'node:crypto';
import { chromium } from 'playwright-core';
import type { WorkerConfig } from '../config.js';
import type { StorageAdapter } from '../storage.js';
import type { PdfJob } from '../types.js';
import { sanitizeDocumentFragment, wrapPrintableHtml } from './sanitize.js';

export interface PdfResult {
  key: string;
  sha256: string;
  bytes: number;
}

export function createPdfProcessor(
  config: WorkerConfig,
  storage: StorageAdapter,
): (job: PdfJob) => Promise<PdfResult> {
  return async (job) => {
    const fragment = sanitizeDocumentFragment(job.html);
    const html = wrapPrintableHtml(fragment, job.locale);
    const browser = await chromium.launch({
      executablePath: config.CHROMIUM_EXECUTABLE_PATH,
      headless: true,
    });

    try {
      const context = await browser.newContext({
        javaScriptEnabled: false,
        serviceWorkers: 'block',
      });
      const page = await context.newPage();
      await page.route('**/*', (route) => route.abort('blockedbyclient'));
      await page.setContent(html, { waitUntil: 'domcontentloaded', timeout: 15_000 });
      const pdf = await page.pdf({
        format: 'A4',
        printBackground: true,
        preferCSSPageSize: true,
        displayHeaderFooter: true,
        headerTemplate: '<span></span>',
        footerTemplate:
          '<div style="font-size:9px;color:#174B70;width:100%;padding:0 15mm;text-align:center">BHD R — A BHD Product · <span class="pageNumber"></span>/<span class="totalPages"></span></div>',
      });
      const sha256 = createHash('sha256').update(pdf).digest('hex');
      await storage.putPrivate(job.outputKey, pdf, 'application/pdf', {
        sha256,
        documentId: job.documentId,
        documentType: job.documentType,
      });
      return { key: job.outputKey, sha256, bytes: pdf.byteLength };
    } finally {
      await browser.close();
    }
  };
}
