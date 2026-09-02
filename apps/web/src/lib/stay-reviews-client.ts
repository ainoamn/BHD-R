/** Client-safe helpers for stay review UI (no server-only imports). */

export function scoreLabel(ten: number, ar: boolean): string {
  if (ten >= 9) return ar ? 'رائع' : 'Superb';
  if (ten >= 8) return ar ? 'ممتاز' : 'Fabulous';
  if (ten >= 7) return ar ? 'جيد جداً' : 'Very good';
  if (ten >= 6) return ar ? 'مرضي' : 'Satisfactory';
  return ar ? 'مقبول' : 'OK';
}
