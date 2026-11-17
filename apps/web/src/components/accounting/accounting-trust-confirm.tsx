'use client';

import { useCallback, useState, type ReactNode } from 'react';

export type TrustConfirmRow = { label: string; value: string };

export type TrustConfirmRequest = {
  title: string;
  subtitle?: string;
  rows: TrustConfirmRow[];
  /** What will happen on the books / audit trail. */
  impact?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  tone?: 'default' | 'danger' | 'success';
};

type Pending = {
  request: TrustConfirmRequest;
  resolve: (ok: boolean) => void;
};

/**
 * Trusted review screen before any accounting mutation (cheque, journal, expense, reverse…).
 * Use `ask` to await a boolean; the overlay blocks the UI until the user confirms or cancels.
 */
export function useAccountingTrustConfirm(locale: 'ar' | 'en') {
  const ar = locale === 'ar';
  const [pending, setPending] = useState<Pending | null>(null);

  const ask = useCallback((request: TrustConfirmRequest) => {
    return new Promise<boolean>((resolve) => {
      setPending({ request, resolve });
    });
  }, []);

  const close = useCallback((ok: boolean) => {
    setPending((current) => {
      current?.resolve(ok);
      return null;
    });
  }, []);

  const gate: ReactNode = pending ? (
    <AccountingTrustConfirm
      locale={locale}
      request={pending.request}
      onCancel={() => close(false)}
      onConfirm={() => close(true)}
    />
  ) : null;

  return { ask, gate, busy: Boolean(pending), defaults: { ar } };
}

/** Full-screen trusted confirmation before posting an accounting action. */
export function AccountingTrustConfirm({
  locale,
  request,
  onCancel,
  onConfirm,
  busy = false,
}: {
  locale: 'ar' | 'en';
  request: TrustConfirmRequest;
  onCancel: () => void;
  onConfirm: () => void;
  busy?: boolean;
}) {
  const ar = locale === 'ar';
  const tone = request.tone ?? 'default';

  return (
    <div
      className="accounting-trust"
      role="dialog"
      aria-modal="true"
      aria-labelledby="accounting-trust-title"
      onClick={(event) => {
        if (event.target === event.currentTarget && !busy) onCancel();
      }}
      onKeyDown={(event) => {
        if (event.key === 'Escape' && !busy) onCancel();
      }}
    >
      <div className={`accounting-trust__card accounting-trust__card--${tone}`}>
        <header className="accounting-trust__head">
          <p className="accounting-trust__badge">
            {ar ? 'مراجعة قبل التنفيذ' : 'Review before posting'}
          </p>
          <h2 id="accounting-trust-title">{request.title}</h2>
          {request.subtitle ? <p className="accounting-trust__sub">{request.subtitle}</p> : null}
        </header>

        <dl className="accounting-trust__rows">
          {request.rows.map((row) => (
            <div key={`${row.label}:${row.value}`} className="accounting-trust__row">
              <dt>{row.label}</dt>
              <dd>{row.value || '—'}</dd>
            </div>
          ))}
        </dl>

        <div className="accounting-trust__impact" role="note">
          <strong>{ar ? 'أثر على الدفتر' : 'Ledger impact'}</strong>
          <p>
            {request.impact ||
              (ar
                ? 'سيُسجَّل قيد محاسبي متوازن ويبقى في سجل التدقيق. التراجع يكون بعكس القيد وليس بالحذف.'
                : 'A balanced journal will be posted and kept in the audit trail. Undo reverses the entry — it does not erase it.')}
          </p>
        </div>

        <footer className="accounting-trust__actions">
          <button
            type="button"
            className="button button--quiet"
            disabled={busy}
            onClick={onCancel}
          >
            {request.cancelLabel || (ar ? 'رجوع' : 'Back')}
          </button>
          <button
            type="button"
            className={`button ${tone === 'danger' ? 'button--danger' : 'button--primary'}`}
            disabled={busy}
            autoFocus
            onClick={onConfirm}
          >
            {request.confirmLabel || (ar ? 'تأكيد وتنفيذ' : 'Confirm & post')}
          </button>
        </footer>
      </div>
    </div>
  );
}
