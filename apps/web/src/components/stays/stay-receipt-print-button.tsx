'use client';

export function StayReceiptPrintButton({ locale, label }: { locale: string; label?: string }) {
  const ar = locale === 'ar';

  function printSheet() {
    document.querySelectorAll<HTMLDetailsElement>('.stay-desk__fold, .stay-desk details').forEach((node) => {
      node.open = true;
    });
    window.setTimeout(() => window.print(), 50);
  }

  return (
    <button type="button" className="button button--primary" onClick={printSheet}>
      {label ?? (ar ? 'طباعة المستند الرسمي' : 'Print official document')}
    </button>
  );
}
