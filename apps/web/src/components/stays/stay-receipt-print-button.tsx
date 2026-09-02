'use client';

export function StayReceiptPrintButton({ locale, label }: { locale: string; label?: string }) {
  const ar = locale === 'ar';
  return (
    <button type="button" className="button button--primary" onClick={() => window.print()}>
      {label ?? (ar ? 'حفظ / طباعة PDF' : 'Save / print PDF')}
    </button>
  );
}
