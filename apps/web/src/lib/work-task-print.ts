import 'server-only';
import QRCode from 'qrcode';
import { publicWebOrigin } from '@/lib/seo';
import type { PortalRole } from '@/lib/types';

export { taskEventLabel, TASK_EVENT_LABEL } from '@/lib/work-task-print-labels';

/** Absolute URL a phone camera opens when scanning the printed QR. */
export function workTaskOpenUrl(
  locale: 'ar' | 'en',
  portal: PortalRole,
  taskId: string,
): string {
  return `${publicWebOrigin()}/${locale}/${portal}/tasks/${encodeURIComponent(taskId)}`;
}

/** Inline SVG QR that resolves to the live task page. */
export async function workTaskQrSvg(url: string): Promise<string> {
  return QRCode.toString(url, {
    type: 'svg',
    margin: 1,
    errorCorrectionLevel: 'M',
    color: { dark: '#0f172a', light: '#ffffff' },
    width: 160,
  });
}
