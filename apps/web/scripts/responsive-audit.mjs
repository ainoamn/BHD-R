#!/usr/bin/env node
/**
 * Responsive audit: opens pages at phone, tablet and desktop widths and reports anything that
 * spills past the screen edge (horizontal scroll, elements outside the viewport, or content cut
 * by an `overflow: hidden` parent). Writes `report.json` and screenshots to the output folder.
 *
 *   node scripts/responsive-audit.mjs login <state.json> [baseUrl]
 *     Opens a visible browser; sign in, and the session is saved to <state.json> (keep it out of git).
 *   node scripts/responsive-audit.mjs run <outDir> [--state state.json] [--base url] [--crawl /ar/owner,/ar/tenant] [paths...]
 */
import fs from 'node:fs';
import path from 'node:path';
import { chromium } from '@playwright/test';

const VIEWPORTS = [
  { name: 'phone-320', width: 320, height: 640, mobile: true },
  { name: 'phone-360', width: 360, height: 780, mobile: true },
  { name: 'phone-390', width: 390, height: 844, mobile: true },
  { name: 'tablet-768', width: 768, height: 1024, mobile: true },
  { name: 'tablet-1024', width: 1024, height: 768, mobile: true },
  { name: 'laptop-1366', width: 1366, height: 768, mobile: false },
  { name: 'desktop-1920', width: 1920, height: 1080, mobile: false },
];
const SHOT_VIEWPORTS = new Set(['phone-360', 'tablet-768', 'laptop-1366']);
const SKIP = /\/api\/|logout|\/print|\.pdf$|^mailto:|^tel:|^javascript:/i;

function measure() {
  const vw = document.documentElement.clientWidth;
  const label = (el) => {
    let text = el.tagName.toLowerCase();
    if (el.id) text += `#${el.id}`;
    const cls =
      typeof el.className === 'string' ? el.className.trim().split(/\s+/).slice(0, 3) : [];
    if (cls.length && cls[0]) text += `.${cls.join('.')}`;
    return text;
  };
  const overflow = [];
  const clipped = [];
  const reported = new Set();
  for (const el of document.querySelectorAll('body *')) {
    if (el.closest('svg') && el.tagName.toLowerCase() !== 'svg') continue;
    const style = getComputedStyle(el);
    if (style.display === 'none' || style.visibility === 'hidden') continue;
    if (el.closest('[aria-hidden="true"]')) continue;
    const box = el.getBoundingClientRect();
    if (box.width < 2 || box.height < 2) continue;
    if (box.right <= vw + 1 && box.left >= -1) continue;
    let parent = el.parentElement;
    let kind = 'overflow';
    let by = '';
    while (parent && parent !== document.body && parent !== document.documentElement) {
      const ps = getComputedStyle(parent);
      if (/(auto|scroll)/.test(ps.overflowX)) {
        kind = 'scrollable';
        break;
      }
      if (/(hidden|clip)/.test(ps.overflowX)) {
        const pb = parent.getBoundingClientRect();
        if (pb.right <= vw + 1 && pb.left >= -1) {
          kind = 'clipped';
          by = label(parent);
          break;
        }
      }
      parent = parent.parentElement;
    }
    if (kind === 'scrollable') continue;
    let up = el.parentElement;
    let nested = false;
    while (up) {
      if (reported.has(up)) {
        nested = true;
        break;
      }
      up = up.parentElement;
    }
    if (nested) continue;
    reported.add(el);
    const item = {
      el: label(el),
      left: Math.round(box.left),
      right: Math.round(box.right),
      width: Math.round(box.width),
      text: (el.innerText || el.getAttribute('aria-label') || '')
        .trim()
        .replace(/\s+/g, ' ')
        .slice(0, 50),
    };
    if (kind === 'clipped') clipped.push({ ...item, by });
    else overflow.push(item);
  }
  const docWidth = document.documentElement.scrollWidth;
  return {
    vw,
    docWidth,
    horizontalScroll: docWidth > vw + 1,
    overflow: overflow.slice(0, 20),
    clipped: clipped.slice(0, 20),
    overflowCount: overflow.length,
    clippedCount: clipped.length,
  };
}

async function launch(headless) {
  let lastError;
  for (const channel of ['msedge', 'chrome', undefined]) {
    try {
      return await chromium.launch({ headless, ...(channel ? { channel } : {}) });
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError;
}

async function settle(page) {
  try {
    await page.waitForLoadState('networkidle', { timeout: 20_000 });
  } catch {
    // Live sync polls keep the network busy on some pages.
  }
  await page.waitForTimeout(1200);
}

async function collectLinks(page, prefixes) {
  const hrefs = await page.$$eval('a[href]', (anchors) =>
    anchors.map((a) => a.getAttribute('href')),
  );
  const out = new Set();
  for (const href of hrefs) {
    if (!href || SKIP.test(href)) continue;
    let url;
    try {
      url = new URL(href, page.url());
    } catch {
      continue;
    }
    if (url.origin !== new URL(page.url()).origin) continue;
    if (!prefixes.some((prefix) => url.pathname.startsWith(prefix))) continue;
    url.hash = '';
    out.add(url.pathname + url.search);
  }
  return [...out];
}

async function login(statePath, base) {
  const browser = await launch(false);
  const context = await browser.newContext({ viewport: { width: 1280, height: 860 } });
  const page = await context.newPage();
  await page.goto(`${base}/ar/owner`);
  console.log('Sign in in the opened window. Waiting up to 10 minutes…');
  await page.waitForURL(
    (url) => url.origin === new URL(base).origin && url.pathname.startsWith('/ar/owner'),
    {
      timeout: 600_000,
    },
  );
  await settle(page);
  await context.storageState({ path: statePath });
  console.log(`Saved session to ${statePath}`);
  await browser.close();
}

async function run(outDir, options) {
  fs.mkdirSync(path.join(outDir, 'shots'), { recursive: true });
  const browser = await launch(true);
  const report = [];
  const queue = [...options.paths];
  const seen = new Set();

  if (options.crawl.length) {
    const context = await browser.newContext({
      ...(options.state ? { storageState: options.state } : {}),
      viewport: { width: 1366, height: 768 },
      locale: 'ar',
    });
    const page = await context.newPage();
    const frontier = [...options.crawl];
    const found = new Set(frontier);
    while (frontier.length && found.size < options.maxPages) {
      const next = frontier.shift();
      try {
        await page.goto(options.base + next, { timeout: 60_000 });
        await settle(page);
        for (const link of await collectLinks(page, options.crawl)) {
          if (found.size >= options.maxPages) break;
          const key = link.replace(/[0-9a-f]{8}-[0-9a-f-]{27}/gi, ':id');
          if ([...found].some((f) => f.replace(/[0-9a-f]{8}-[0-9a-f-]{27}/gi, ':id') === key))
            continue;
          found.add(link);
          frontier.push(link);
        }
      } catch (error) {
        console.warn(`crawl failed ${next}: ${error.message}`);
      }
    }
    queue.push(...found);
    await context.close();
  }

  for (const viewport of VIEWPORTS) {
    const context = await browser.newContext({
      ...(options.state ? { storageState: options.state } : {}),
      viewport: { width: viewport.width, height: viewport.height },
      deviceScaleFactor: viewport.mobile ? 2 : 1,
      isMobile: viewport.mobile,
      hasTouch: viewport.mobile,
      locale: 'ar',
    });
    const page = await context.newPage();
    for (const target of queue) {
      const key = `${viewport.name} ${target}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const entry = { path: target, viewport: viewport.name };
      try {
        const response = await page.goto(options.base + target, { timeout: 60_000 });
        await settle(page);
        entry.status = response?.status() ?? null;
        entry.finalPath = new URL(page.url()).pathname;
        Object.assign(entry, await page.evaluate(measure));
        if (SHOT_VIEWPORTS.has(viewport.name)) {
          const file = `${viewport.name}${target.replace(/[^a-z0-9]+/gi, '_').slice(0, 90)}.jpg`;
          await page.screenshot({
            path: path.join(outDir, 'shots', file),
            fullPage: true,
            type: 'jpeg',
            quality: 55,
          });
          entry.shot = file;
        }
      } catch (error) {
        entry.error = error.message.split('\n')[0];
      }
      report.push(entry);
      const flag = entry.error
        ? `ERROR ${entry.error}`
        : `${entry.horizontalScroll ? 'HSCROLL ' : ''}overflow=${entry.overflowCount} clipped=${entry.clippedCount}`;
      console.log(`${viewport.name.padEnd(13)} ${target} ${flag}`);
    }
    await context.close();
  }
  await browser.close();
  fs.writeFileSync(path.join(outDir, 'report.json'), JSON.stringify(report, null, 2));
  const problems = report.filter(
    (r) => r.error || r.horizontalScroll || r.overflowCount || r.clippedCount,
  );
  console.log(
    `\n${report.length} checks, ${problems.length} with findings. Report: ${path.join(outDir, 'report.json')}`,
  );
}

const [mode, ...rest] = process.argv.slice(2);
if (mode === 'login') {
  const [statePath, base = 'https://r.bhd-om.com'] = rest;
  if (!statePath) throw new Error('usage: login <state.json> [baseUrl]');
  await login(statePath, base);
} else if (mode === 'run') {
  const [outDir, ...args] = rest;
  if (!outDir)
    throw new Error('usage: run <outDir> [--state file] [--base url] [--crawl a,b] [paths...]');
  const options = { base: 'https://r.bhd-om.com', state: null, crawl: [], paths: [], maxPages: 60 };
  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (arg === '--state') options.state = args[(i += 1)];
    else if (arg === '--base') options.base = args[(i += 1)];
    else if (arg === '--crawl') options.crawl = args[(i += 1)].split(',');
    else if (arg === '--max') options.maxPages = Number(args[(i += 1)]);
    else options.paths.push(arg);
  }
  await run(outDir, options);
} else {
  console.log('usage: responsive-audit.mjs login|run …');
}
