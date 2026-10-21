'use client';

const PRINTING_CLASS = 'printing-stay';

export function StayReceiptPrintButton({ locale, label }: { locale: string; label?: string }) {
  const ar = locale === 'ar';

  function printSheet() {
    document
      .querySelectorAll<HTMLDetailsElement>('.stay-desk__fold, .stay-desk details')
      .forEach((node) => {
        node.open = true;
      });
    document.body.classList.add(PRINTING_CLASS);
    const clear = () => {
      document.body.classList.remove(PRINTING_CLASS);
      window.removeEventListener('afterprint', clear);
    };
    window.addEventListener('afterprint', clear);
    window.setTimeout(() => {
      window.print();
      // Fallback when afterprint does not fire (some mobile browsers).
      window.setTimeout(clear, 1_500);
    }, 50);
  }

  return (
    <button type="button" className="button button--primary" onClick={printSheet}>
      {label ?? (ar ? 'طباعة المستند الرسمي' : 'Print official document')}
    </button>
  );
}
