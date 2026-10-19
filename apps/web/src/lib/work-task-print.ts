import 'server-only';
import { serverBrandedQrSvg } from '@/lib/qr-branded';
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

/** Inline SVG QR (with BHD mark) that resolves to the live task page. */
export async function workTaskQrSvg(url: string): Promise<string> {
  return serverBrandedQrSvg(url, {
    width: 160,
    dark: '#0f172a',
    light: '#ffffff',
  });
}
