'use client';

import { formatMoney } from '@/lib/format';
import { maskAccount } from '@/lib/stay-deposit-refund';

type Row = Record<string, string | null | undefined>;

export type DepositReceiptKind = 'refund' | 'income';

const METHOD_LABELS: Record<string, [string, string]> = {
  bank: ['تحويل بنكي', 'Bank transfer'],
  phone: ['تحويل عبر رقم الهاتف', 'Transfer by phone number'],
};

function esc(value: string | null | undefined): string {
  return (value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function dateText(value: string | null | undefined, ar: boolean): string {
  if (!value) return '—';
  const date = new Date(value.length === 10 ? `${value}T12:00:00+04:00` : value);
  if (Number.isNaN(date.getTime())) return value;
  const options: Intl.DateTimeFormatOptions = {
    dateStyle: 'long',
    timeZone: 'Asia/Muscat',
  };
  if (value.length > 10) options.timeStyle = 'short';
  return new Intl.DateTimeFormat(ar ? 'ar-OM' : 'en-GB', options).format(date);
}

/** Opens the printable receipt of one side of a deposit settlement. Returns an error message. */
export function printDepositReceipt(
  row: Row,
  kind: DepositReceiptKind,
  locale: 'ar' | 'en',
): string | null {
  const ar = locale === 'ar';
  const currency = row.currency || 'OMR';
  const money = (value: string | null | undefined) =>
    value ? formatMoney(value, currency, locale) : '—';
  const number = kind === 'refund' ? row.refundReceiptNo : row.incomeReceiptNo;
  const linked = kind === 'refund' ? row.incomeReceiptNo : row.refundReceiptNo;
  if (!number) return ar ? 'لا يوجد إيصال لهذه العملية بعد' : 'No receipt for this yet';
  const rejected = row.refundStatus === 'rejected';
  const title =
    kind === 'refund'
      ? ar
        ? 'إيصال استرداد مبلغ تأمين'
        : 'Deposit refund receipt'
      : ar
        ? 'إيصال دخل — مخصوم من مبلغ التأمين'
        : 'Income receipt — kept from the deposit';
  const method = row.refundPaidMethod ? METHOD_LABELS[row.refundPaidMethod] : null;
  const line = (label: string, value: string, strong = false) =>
    `<tr${strong ? ' class="strong"' : ''}><th>${esc(label)}</th><td>${value}</td></tr>`;
  const ltr = (value: string) => `<span dir="ltr">${esc(value)}</span>`;
  const rows = [
    line(ar ? 'رقم الإيصال' : 'Receipt no.', ltr(number), true),
    line(ar ? 'التاريخ' : 'Date', esc(dateText(row.settledOn, ar))),
    line(ar ? 'الحجز' : 'Booking', ltr(row.reference ?? '—')),
    line(
      ar ? 'العقار' : 'Property',
      esc([ar ? row.propertyName : row.propertyNameEn, row.unitCode].filter(Boolean).join(' · ')),
    ),
    line(ar ? 'الضيف' : 'Guest', esc(row.party ?? '—')),
    line(ar ? 'مبلغ التأمين المستلم' : 'Deposit received', ltr(money(row.depositMinor))),
  ];
  if (kind === 'refund') {
    rows.push(
      line(
        ar ? 'المبلغ المُسترد للضيف' : 'Refunded to the guest',
        ltr(money(row.refundedMinor)),
        true,
      ),
      line(ar ? 'طريقة التحويل' : 'Method', esc(method ? method[ar ? 0 : 1] : '—')),
      line(
        ar ? 'حُوّل إلى' : 'Paid to',
        esc(
          [row.refundPaidBank, maskAccount(row.refundPaidAccount ?? ''), row.refundPaidHolder]
            .filter(Boolean)
            .join(' · ') || '—',
        ),
      ),
      line(ar ? 'مرجع التحويل' : 'Transfer reference', ltr(row.refundPaidReference || '—')),
      line(ar ? 'تاريخ التحويل' : 'Transferred at', esc(dateText(row.refundPaidAt, ar))),
    );
    if (row.retainedMinor) {
      rows.push(
        line(
          ar ? 'المخصوم دخلاً للعقار' : 'Kept as property income',
          `${ltr(money(row.retainedMinor))} · ${ar ? 'إيصال' : 'receipt'} ${ltr(linked ?? '—')}`,
        ),
      );
    }
  } else {
    rows.push(
      line(
        ar ? 'المخصوم دخلاً للعقار' : 'Kept as property income',
        ltr(money(row.retainedMinor)),
        true,
      ),
      rejected
        ? line(
            ar ? 'المُسترد للضيف' : 'Refunded to the guest',
            esc(ar ? 'لا شيء — رُفض الاسترداد' : 'Nothing — refund rejected'),
          )
        : line(
            ar ? 'المُسترد للضيف' : 'Refunded to the guest',
            `${ltr(money(row.refundedMinor))} · ${ar ? 'إيصال' : 'receipt'} ${ltr(linked ?? '—')}`,
          ),
    );
  }
  rows.push(
    line(ar ? 'ملاحظة الاسترداد' : 'Refund note', esc(row.refundDecisionNote || '—')),
    line(ar ? 'اعتمده' : 'Approved by', esc(row.refundDecidedBy || '—')),
  );
  if (kind === 'refund' || !rejected) {
    rows.push(line(ar ? 'سجّل التحويل' : 'Transfer recorded by', esc(row.refundPaidBy || '—')));
  }
  const reconcile = linked
    ? ar
      ? `هذا الإيصال مرتبط بالإيصال ${ltr(linked)}، ومعاً يكمّلان مبلغ التأمين المستلم ${ltr(money(row.depositMinor))}: ${ltr(money(row.refundedMinor))} مُسترد للضيف + ${ltr(money(row.retainedMinor))} دخل للعقار.`
      : `Linked to receipt ${ltr(linked)}; together they account for the ${ltr(money(row.depositMinor))} deposit received: ${ltr(money(row.refundedMinor))} refunded + ${ltr(money(row.retainedMinor))} property income.`
    : rejected
      ? ar
        ? `رُفض الاسترداد، فأصبح مبلغ التأمين المستلم ${ltr(money(row.depositMinor))} كاملاً دخلاً للعقار.`
        : `The refund was rejected, so the whole ${ltr(money(row.depositMinor))} deposit became property income.`
      : ar
        ? `استُرد مبلغ التأمين المستلم ${ltr(money(row.depositMinor))} كاملاً للضيف دون خصم.`
        : `The whole ${ltr(money(row.depositMinor))} deposit was refunded without deduction.`;
  const html = `<!DOCTYPE html><html lang="${locale}" dir="${ar ? 'rtl' : 'ltr'}"><head><meta charset="utf-8"/><title>${esc(title)} ${esc(number)}</title>
<style>body{font-family:Tahoma,Arial,sans-serif;padding:28px;color:#111;max-width:760px;margin:auto}h1{font-size:1.25rem;margin:0 0 .25rem}p.sub{margin:0 0 1rem;color:#555}table{width:100%;border-collapse:collapse}th,td{border:1px solid #bbb;padding:.45rem .6rem;font-size:.92rem;text-align:start;vertical-align:top}th{background:#f3f3f3;width:38%;font-weight:600}tr.strong td{font-weight:700}.reconcile{margin-top:1rem;padding:.75rem 1rem;border:1px dashed #888;background:#fafafa;font-size:.92rem}.sign{display:flex;justify-content:space-between;margin-top:2.5rem;font-size:.9rem}.sign span{border-top:1px solid #333;padding-top:.3rem;min-width:12rem;text-align:center}</style></head><body>
<h1>BHD R · ${esc(title)}</h1>
<p class="sub">${ar ? 'مبالغ التأمين أمانة معزولة عن الإيرادات؛ لا يدخل منها في الدخل إلا ما يُخصم عند الاسترداد.' : 'Deposits are held in trust apart from income; only a deduction at refund becomes income.'}</p>
<table><tbody>${rows.join('')}</tbody></table>
<p class="reconcile">${reconcile}</p>
<div class="sign"><span>${ar ? 'المحاسب' : 'Accountant'}</span><span>${ar ? 'المالك / الإدارة' : 'Owner / management'}</span></div>
</body></html>`;
  const popup = window.open('', '_blank', 'width=860,height=900');
  if (!popup) {
    return ar ? 'اسمح بالنوافذ المنبثقة لطباعة الإيصال' : 'Allow pop-ups to print the receipt';
  }
  popup.document.write(html);
  popup.document.close();
  popup.focus();
  window.setTimeout(() => popup.print(), 250);
  return null;
}

/**
 * Where one stay's deposit went: received, refunded to the guest and kept as income, with the
 * refund note and the two linked receipts that together account for the whole deposit.
 */
export function DepositReconciliation({
  row,
  locale,
  onError,
  hideNote = false,
}: {
  row: Row;
  locale: 'ar' | 'en';
  onError?: (message: string) => void;
  /** When the refund details beside it already show the note. */
  hideNote?: boolean;
}) {
  const ar = locale === 'ar';
  const currency = row.currency || 'OMR';
  const money = (value: string | null | undefined) =>
    value ? formatMoney(value, currency, locale) : '—';
  const print = (kind: DepositReceiptKind) => {
    const failed = printDepositReceipt(row, kind, locale);
    if (failed) onError?.(failed);
  };
  const awaitingTransfer = row.refundStatus === 'approved';
  const pendingKept =
    awaitingTransfer &&
    /^\d+$/.test(row.depositMinor ?? '') &&
    /^\d+$/.test(row.refundAmountMinor ?? '')
      ? BigInt(row.depositMinor!) - BigInt(row.refundAmountMinor!)
      : 0n;
  return (
    <div className="deposit-recon">
      <dl className="deposit-recon__lines">
        <div>
          <dt>{ar ? 'التأمين المستلم' : 'Deposit received'}</dt>
          <dd dir="ltr">{money(row.depositMinor)}</dd>
        </div>
        {awaitingTransfer ? (
          <div>
            <dt>{ar ? 'معتمد للاسترداد' : 'Approved to refund'}</dt>
            <dd dir="ltr">{money(row.refundAmountMinor)}</dd>
          </div>
        ) : null}
        {row.refundedMinor ? (
          <div>
            <dt>{ar ? 'مُسترد للضيف' : 'Refunded'}</dt>
            <dd>
              <span dir="ltr">{money(row.refundedMinor)}</span>
              {row.refundReceiptNo ? (
                <small dir="ltr" className="deposit-recon__no">
                  {row.refundReceiptNo}
                </small>
              ) : null}
            </dd>
          </div>
        ) : null}
        {row.retainedMinor ? (
          <div className="deposit-recon__income">
            <dt>{ar ? 'دخل للعقار (خصم)' : 'Property income (kept)'}</dt>
            <dd>
              <span dir="ltr">{money(row.retainedMinor)}</span>
              {row.incomeReceiptNo ? (
                <small dir="ltr" className="deposit-recon__no">
                  {row.incomeReceiptNo}
                </small>
              ) : null}
            </dd>
          </div>
        ) : null}
        {pendingKept > 0n ? (
          <div className="deposit-recon__income">
            <dt>{ar ? 'يصبح دخلاً بعد التحويل' : 'Becomes income after transfer'}</dt>
            <dd dir="ltr">{money(pendingKept.toString())}</dd>
          </div>
        ) : null}
      </dl>
      {row.refundDecisionNote && !hideNote ? (
        <p className="deposit-recon__note">
          <strong>{ar ? 'ملاحظة الاسترداد: ' : 'Refund note: '}</strong>
          <bdi>{row.refundDecisionNote}</bdi>
        </p>
      ) : null}
      {row.refundReceiptNo || row.incomeReceiptNo ? (
        <div className="deposit-recon__actions">
          {row.refundReceiptNo ? (
            <button type="button" className="button button--quiet" onClick={() => print('refund')}>
              {ar
                ? `إيصال الاسترداد ${row.refundReceiptNo}`
                : `Refund receipt ${row.refundReceiptNo}`}
            </button>
          ) : null}
          {row.incomeReceiptNo ? (
            <button type="button" className="button button--quiet" onClick={() => print('income')}>
              {ar ? `إيصال الدخل ${row.incomeReceiptNo}` : `Income receipt ${row.incomeReceiptNo}`}
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
