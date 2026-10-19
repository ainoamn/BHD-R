import 'server-only';
import QRCode from 'qrcode';
import { brandedQrSvg, type BrandedQrOptions } from '@/lib/qr-brand';

/** Server-side branded QR SVG (contracts, print sheets, etc.). */
export async function serverBrandedQrSvg(
  url: string,
  options: BrandedQrOptions = {},
): Promise<string> {
  return brandedQrSvg(QRCode.toString.bind(QRCode), url, options);
}
