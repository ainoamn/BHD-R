/**
 * BHD mark embedded in QR codes (viewBox 548×171 from public/brand/bhd-official-symbol.svg).
 * Plate covers ~6% of modules; pair with errorCorrectionLevel Q (or H) so scanners still read.
 */

export const BHD_QR_BRAND_MARK =
  `<g fill="#08a39f"><path d="M0 0h100c31 0 48 17 48 43 0 18-9 31-25 39 20 6 31 22 31 42 0 28-21 47-53 47H30v-28h70c16 0 26-8 26-20 0-13-11-22-29-22H0V74h97c15 0 24-8 24-21 0-15-10-25-25-25H28L0 0Z"/><path d="M385 0h74c52 0 89 35 89 85 0 51-37 86-89 86h-74l28-28h46c36 0 61-23 61-58 0-34-25-57-61-57h-46L385 0Z"/></g><path fill="#174b70" d="M190 109l30-27h90V0h30v171h-30v-62h-90v62h-30v-62Z"/>`;

/** Default ECC when a center logo plate is present. */
export const QR_BRAND_ECC = 'Q' as const;

/**
 * Brand mark on a white plate in the middle of an SVG QR. The plate hides about 6% of
 * the modules, well inside what level Q error correction (25%) restores.
 */
export function embedBrandInQrSvg(svg: string): string {
  const size = Number(svg.match(/viewBox="0 0 (\d+) \d+"/)?.[1]);
  if (!size) return svg;
  const markW = size * 0.36;
  const markH = markW * (171 / 548);
  const plateW = markW + size * 0.05;
  const plateH = markH + size * 0.05;
  const r = (value: number) => Math.round(value * 100) / 100;
  const plate =
    `<rect x="${r((size - plateW) / 2)}" y="${r((size - plateH) / 2)}" width="${r(plateW)}" height="${r(plateH)}" rx="${r(size * 0.02)}" fill="#ffffff"/>` +
    `<svg x="${r((size - markW) / 2)}" y="${r((size - markH) / 2)}" width="${r(markW)}" height="${r(markH)}" viewBox="0 0 548 171" shape-rendering="geometricPrecision">${BHD_QR_BRAND_MARK}</svg>`;
  return svg.replace(/<\/svg>\s*$/, `${plate}</svg>`);
}

export type BrandedQrOptions = {
  width?: number;
  margin?: number;
  dark?: string;
  light?: string;
};

type QrToString = (
  text: string,
  options: {
    type: 'svg';
    margin?: number;
    width?: number;
    errorCorrectionLevel?: 'L' | 'M' | 'Q' | 'H';
    color?: { dark: string; light: string };
  },
) => Promise<string>;

/** SVG QR with the BHD mark in the center (scales with CSS). */
export async function brandedQrSvg(
  toString: QrToString,
  url: string,
  options: BrandedQrOptions = {},
): Promise<string> {
  const svg = await toString(url, {
    type: 'svg',
    margin: options.margin ?? 1,
    errorCorrectionLevel: QR_BRAND_ECC,
    color: {
      dark: options.dark ?? '#0f172a',
      light: options.light ?? '#ffffff',
    },
    ...(options.width !== undefined ? { width: options.width } : {}),
  });
  return embedBrandInQrSvg(svg);
}

/** Data-URL of a branded SVG QR — safe for `<img src>`. */
export async function brandedQrDataUrl(
  toString: QrToString,
  url: string,
  options: BrandedQrOptions = {},
): Promise<string> {
  const svg = await brandedQrSvg(toString, url, options);
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}
