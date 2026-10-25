'use client';

import type { MissingField } from '@/lib/profile-completeness';
import { missingFieldLabel } from '@/lib/profile-completeness';

/** Live list of incomplete required fields for owner / tenant / building forms. */
export function MissingFieldsBanner({
  fields,
  locale,
  title,
}: {
  fields: MissingField[];
  locale: 'ar' | 'en';
  title?: string;
}) {
  const ar = locale === 'ar';
  if (!fields.length) {
    return (
      <p className="notice notice--success" role="status">
        {ar ? 'اكتملت الحقول المطلوبة لهذا القسم.' : 'Required fields for this section are complete.'}
      </p>
    );
  }
  return (
    <div className="notice notice--warning party-form__missing" role="status">
      <strong>
        {title ??
          (ar
            ? `${fields.length} حقل/مستند ناقص — أكملها للمتابعة`
            : `${fields.length} missing field${fields.length === 1 ? '' : 's'} — complete to continue`)}
      </strong>
      <ul className="party-form__missing-list">
        {fields.map((field) => (
          <li key={field.code}>{missingFieldLabel(field, ar)}</li>
        ))}
      </ul>
    </div>
  );
}
