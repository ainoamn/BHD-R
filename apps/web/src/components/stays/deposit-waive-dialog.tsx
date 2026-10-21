'use client';

import { ModalPortal } from '@/components/modal-portal';

/** Owner-only confirm: admit guest without the refundable deposit being paid. */
export function DepositWaiveDialog({
  locale,
  amountLabel,
  busy,
  onWaive,
  onRequirePayment,
}: {
  locale: string;
  amountLabel: string | null;
  busy?: boolean;
  onWaive: () => void;
  onRequirePayment: () => void;
}) {
  const ar = locale === 'ar';
  return (
    <ModalPortal {...(busy ? {} : { onClose: onRequirePayment })}>
      <div
        className="ops-modal guest-stay-dialog"
        role="presentation"
        onMouseDown={(event) => {
          if (!busy && event.target === event.currentTarget) onRequirePayment();
        }}
      >
        <section
          className="ops-modal__card"
          role="dialog"
          aria-modal="true"
          aria-labelledby="deposit-waive-title"
          dir={ar ? 'rtl' : 'ltr'}
        >
          <header>
            <div>
              <span className="ops-kicker">{ar ? 'تأمين الإقامة' : 'Stay deposit'}</span>
              <h2 id="deposit-waive-title">
                {ar ? 'مبلغ التأمين غير مدفوع' : 'Deposit not paid'}
              </h2>
            </div>
            <button
              type="button"
              onClick={onRequirePayment}
              disabled={busy}
              aria-label={ar ? 'إغلاق' : 'Close'}
            >
              ×
            </button>
          </header>
          <div className="guest-stay-dialog__body">
            <p>
              {ar
                ? `المستأجر لم يدفع مبلغ التأمين المسترد${amountLabel ? ` (${amountLabel})` : ''}.`
                : `The guest has not paid the refundable deposit${amountLabel ? ` (${amountLabel})` : ''}.`}
            </p>
            <p className="muted">
              {ar
                ? 'يمكنك المتابعة بتسجيل الدخول واستثناء التأمين (يُفتح باركود الضيف)، أو إلغاء الانتظار حتى يدفع الضيف أولاً.'
                : 'Continue check-in and waive the deposit (guest barcode unlocks), or cancel and require payment first.'}
            </p>
          </div>
          <footer className="ops-modal__actions">
            <button
              type="button"
              className="button button--quiet"
              disabled={busy}
              onClick={onRequirePayment}
            >
              {ar ? 'عليه الدفع أولاً' : 'Require payment first'}
            </button>
            <button
              type="button"
              className="button button--primary"
              disabled={busy}
              onClick={onWaive}
            >
              {busy
                ? ar
                  ? 'جارٍ المتابعة…'
                  : 'Continuing…'
                : ar
                  ? 'متابعة بدون تأمين'
                  : 'Continue without deposit'}
            </button>
          </footer>
        </section>
      </div>
    </ModalPortal>
  );
}
