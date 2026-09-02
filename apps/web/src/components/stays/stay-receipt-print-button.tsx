'use client';

export function StayReceiptPrintButton({ locale }: { locale: string }) {
  const ar = locale === 'ar';
  return (
    <button type="button" className="button button--primary" onClick={() => window.print()}>
      {ar ? 'حفظ / طباعة PDF' : 'Save / print PDF'}
    </button>
  );
}
