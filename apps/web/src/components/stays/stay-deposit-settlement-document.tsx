import { formatMoney } from '@/lib/format';
import type { GuestDepositSettlementDoc } from '@/lib/stay-deposit-settlement-docs-neon';

const METHOD: Record<string, { ar: string; en: string }> = {
  bank: { ar: 'تحويل بنكي', en: 'Bank transfer' },
  phone: { ar: 'تحويل عبر رقم الهاتف', en: 'Transfer by phone number' },
};

function stamp(value: string | null | undefined, ar: boolean): string {
  if (!value) return '—';
  const date = new Date(value.length === 10 ? `${value}T12:00:00+04:00` : value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat(ar ? 'ar-OM' : 'en-GB', {
    dateStyle: 'long',
    ...(value.length > 10 ? { timeStyle: 'short' as const } : {}),
    timeZone: 'Asia/Muscat',
  }).format(date);
}

/** Printable reverse / settlement document for a guest deposit refund (DR-…). */
export function StayDepositSettlementDocument({
  doc,
  locale,
}: {
  doc: GuestDepositSettlementDoc;
  locale: string;
}) {
  const ar = locale === 'ar';
  const money = (minor: string) => formatMoney(minor, doc.currency, locale);
  const method = doc.paidMethod ? METHOD[doc.paidMethod] : null;
  const property = [ar ? doc.propertyNameAr || doc.propertyNameEn : doc.propertyNameEn || doc.propertyNameAr, doc.unitCode]
    .filter(Boolean)
    .join(' · ');

  return (
    <article className="stay-deposit-settlement-doc" dir={ar ? 'rtl' : 'ltr'}>
      <header className="stay-deposit-settlement-doc__head">
        <p className="stay-deposit-settlement-doc__brand">BHD R</p>
        <h1>
          {ar ? 'إيصال استرداد مبلغ تأمين' : 'Deposit refund receipt'}
        </h1>
        <p className="stay-deposit-settlement-doc__sub">
          {ar
            ? 'مستند عكس معاملة التأمين لحساب الضيف — يُكمّل إيصال قبض مبلغ التأمين بعد التحويل.'
            : 'Reverse document for the guest deposit account — settles the deposit receipt after transfer.'}
        </p>
      </header>

      <table className="stay-deposit-settlement-doc__table">
        <tbody>
          <tr>
            <th>{ar ? 'رقم الإيصال' : 'Receipt no.'}</th>
            <td dir="ltr">{doc.refundReceiptNo}</td>
          </tr>
          <tr>
            <th>{ar ? 'التاريخ' : 'Date'}</th>
            <td>{stamp(doc.settledOn, ar)}</td>
          </tr>
          <tr>
            <th>{ar ? 'الحجز' : 'Booking'}</th>
            <td dir="ltr">{doc.referenceCode}</td>
          </tr>
          <tr>
            <th>{ar ? 'العقار' : 'Property'}</th>
            <td>{property || '—'}</td>
          </tr>
          <tr>
            <th>{ar ? 'الضيف' : 'Guest'}</th>
            <td>{doc.guestName || '—'}</td>
          </tr>
          <tr>
            <th>{ar ? 'مبلغ التأمين المستلم' : 'Deposit received'}</th>
            <td dir="ltr">{money(doc.depositMinor)}</td>
          </tr>
          <tr className="stay-deposit-settlement-doc__strong">
            <th>{ar ? 'المبلغ المُسترد للضيف' : 'Refunded to the guest'}</th>
            <td dir="ltr">{money(doc.refundedMinor)}</td>
          </tr>
          <tr>
            <th>{ar ? 'طريقة التحويل' : 'Method'}</th>
            <td>{method ? (ar ? method.ar : method.en) : '—'}</td>
          </tr>
          <tr>
            <th>{ar ? 'حُوّل إلى' : 'Paid to'}</th>
            <td>
              {[doc.paidBank, doc.paidAccountMasked, doc.paidHolder].filter(Boolean).join(' · ') ||
                '—'}
            </td>
          </tr>
          <tr>
            <th>{ar ? 'مرجع التحويل' : 'Transfer reference'}</th>
            <td dir="ltr">{doc.paidReference || '—'}</td>
          </tr>
          <tr>
            <th>{ar ? 'تاريخ التحويل' : 'Transferred at'}</th>
            <td>{stamp(doc.paidAt, ar)}</td>
          </tr>
          {doc.retainedMinor ? (
            <tr>
              <th>{ar ? 'المخصوم دخلاً للعقار' : 'Kept as property income'}</th>
              <td dir="ltr">
                {money(doc.retainedMinor)}
                {doc.incomeReceiptNo ? ` · ${doc.incomeReceiptNo}` : ''}
              </td>
            </tr>
          ) : null}
          <tr>
            <th>{ar ? 'ملاحظة الاسترداد' : 'Refund note'}</th>
            <td>{doc.decisionNote || '—'}</td>
          </tr>
          <tr>
            <th>{ar ? 'اعتمده' : 'Approved by'}</th>
            <td>{doc.decidedBy || '—'}</td>
          </tr>
          <tr>
            <th>{ar ? 'سجّل التحويل' : 'Transfer recorded by'}</th>
            <td>{doc.paidBy || '—'}</td>
          </tr>
        </tbody>
      </table>

      <p className="stay-deposit-settlement-doc__reconcile">
        {doc.incomeReceiptNo
          ? ar
            ? `هذا الإيصال مرتبط بالإيصال ${doc.incomeReceiptNo}، ومعاً يكمّلان مبلغ التأمين المستلم ${money(doc.depositMinor)}.`
            : `Linked to receipt ${doc.incomeReceiptNo}; together they account for the ${money(doc.depositMinor)} deposit received.`
          : ar
            ? `استُرد مبلغ التأمين المستلم ${money(doc.depositMinor)} كاملاً للضيف دون خصم.`
            : `The whole ${money(doc.depositMinor)} deposit was refunded without deduction.`}
      </p>
    </article>
  );
}
