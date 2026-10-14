'use client';

import { ApiError } from '@/lib/api';

const ERRORS: Record<string, [string, string]> = {
  forbidden: ['لا تملك صلاحية هذا الإجراء.', 'You are not allowed to do this.'],
  not_found: ['العنصر غير موجود أو أُزيل.', 'Not found or removed.'],
  rate_limited: ['طلبات كثيرة خلال وقت قصير؛ انتظر قليلاً.', 'Too many requests; wait a moment.'],
  badge_invalid: [
    'بيانات الشارة غير مكتملة: الاسمان والشروط والمدد مطلوبة.',
    'The badge needs names, criteria and valid periods.',
  ],
  badge_subject_invalid: [
    'هذا الشخص أو العقار لا يتبع منشأتك أو لا يناسب نوع الشارة.',
    'That subject is not in your organization or does not fit this badge.',
  ],
  badge_already_held: ['يحمل هذه الشارة فعلاً أو هي بانتظار الاعتماد.', 'Already held or pending.'],
  badge_award_closed: ['هذه الشارة أُغلقت مسبقاً.', 'This award is already closed.'],
  verification_invalid: ['أكمل بيانات الطلب بشكل صحيح.', 'Complete the request correctly.'],
  verification_name_mismatch: [
    'الاسم في المستند لا يطابق اسم الحساب. عدّل اسم حسابك أو اكتب الاسم كما في المستند تماماً.',
    'The document name does not match the account name.',
  ],
  verification_open: ['لديك طلب توثيق قيد المراجعة.', 'You already have a request under review.'],
  verification_document_required: [
    'أرفق صور المستند المطلوبة كلها (الوجه/الظهر/صورة شخصية).',
    'Attach every required document image.',
  ],
  verification_not_open: ['الطلب لم يعد قيد المراجعة.', 'The request is no longer open.'],
  verification_unpaid: [
    'سجّل سداد الرسوم أو أعفِ منها قبل الاعتماد.',
    'Record payment or waive the fee before approving.',
  ],
  verification_renewal_closed: [
    'التجديد متاح خلال آخر 30 يوماً من التوثيق وبمستند ساري.',
    'Renewal opens in the last 30 days with a valid document.',
  ],
  avatar_invalid: [
    'الصورة غير صالحة. استخدم JPG أو PNG أو WebP.',
    'Invalid image; use JPG, PNG or WebP.',
  ],
  invalid_amount: ['المبلغ غير صالح.', 'Invalid amount.'],
  ai_unconfigured: ['الذكاء الاصطناعي غير مفعّل حالياً.', 'AI is not configured.'],
  ai_failed: ['تعذّر تحليل الذكاء الاصطناعي الآن.', 'The AI analysis failed.'],
};

export function errorText(error: unknown, ar: boolean): string {
  const code = error instanceof ApiError ? error.code : '';
  const known = ERRORS[code];
  if (known) return ar ? known[0] : known[1];
  if (error instanceof ApiError && error.status === 0) return error.message;
  return ar ? 'تعذّر إتمام الطلب، أعد المحاولة.' : 'The request failed; try again.';
}

export async function getJson<T>(path: string): Promise<T> {
  let response: Response;
  try {
    response = await fetch(path, {
      credentials: 'same-origin',
      cache: 'no-store',
      headers: { accept: 'application/json' },
    });
  } catch {
    throw new ApiError(0, 'network_error', 'تعذر الاتصال بالخادم. تحقق من الشبكة.');
  }
  const body = (await response.json().catch(() => null)) as
    (T & { error?: { code?: string } }) | null;
  if (!response.ok || !body) {
    const code = body?.error?.code ?? 'load_failed';
    throw new ApiError(response.status, code, code);
  }
  return body;
}

function readFile(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () =>
      typeof reader.result === 'string' ? resolve(reader.result) : reject(new Error('read_failed'));
    reader.onerror = () => reject(new Error('read_failed'));
    reader.readAsDataURL(file);
  });
}

/**
 * Shrinks a photo in the browser before upload (request bodies are capped around 4.5 MB).
 * PDFs pass through untouched when allowed.
 */
export async function shrinkImage(
  file: File,
  maxEdge = 1600,
  quality = 0.85,
  allowPdf = false,
): Promise<string> {
  if (allowPdf && file.type === 'application/pdf') {
    if (file.size > 1_100_000) throw new ApiError(400, 'verification_invalid', 'pdf_too_large');
    return readFile(file);
  }
  if (!/^image\/(jpeg|png|webp|heic|heif)$/i.test(file.type))
    throw new ApiError(400, 'avatar_invalid', 'type');
  const source = await readFile(file);
  const image = await new Promise<HTMLImageElement>((resolve, reject) => {
    const element = new Image();
    element.onload = () => resolve(element);
    element.onerror = () => reject(new ApiError(400, 'avatar_invalid', 'decode'));
    element.src = source;
  });
  const scale = Math.min(1, maxEdge / Math.max(image.naturalWidth, image.naturalHeight));
  const width = Math.max(1, Math.round(image.naturalWidth * scale));
  const height = Math.max(1, Math.round(image.naturalHeight * scale));
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext('2d');
  if (!context) return source;
  context.fillStyle = '#fff';
  context.fillRect(0, 0, width, height);
  context.drawImage(image, 0, 0, width, height);
  return canvas.toDataURL('image/jpeg', quality);
}

export function dateText(value: string | null | undefined, ar: boolean): string {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  return date.toLocaleDateString(ar ? 'ar-OM' : 'en-GB', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    timeZone: 'Asia/Muscat',
  });
}
