import { EmptyState } from '@bhd-r/ui';
import { Link } from '@/i18n/navigation';
import { formatMoney } from '@/lib/format';
import { TenantRequestLauncher, type RequestLease } from '@/components/tenant-request-form';
import {
  chequeIsAdjustable,
  ledgerLineLabel,
  ledgerStatusLabel,
  type LedgerLine,
} from '@/lib/tenant-ledger';
import { tenancyLandlordName, tenancyUnitLabel, type TenancyStatement } from '@/lib/tenancy-shared';
import { domainStatusLabel } from '@/lib/ui-labels';

const TONE: Partial<Record<LedgerLine['status'], string>> = {
  paid: 'good',
  overdue: 'bad',
  bounced: 'bad',
  stopped: 'bad',
  partially_paid: 'warn',
  due_soon: 'warn',
  collecting: 'info',
};

function day(value: string, ar: boolean): string {
  const date = new Date(`${value.slice(0, 10)}T00:00:00`);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat(ar ? 'ar-OM' : 'en-OM', { dateStyle: 'medium' }).format(date);
}

/** The leases the tenant can send requests about, with the cheques they may ask to move. */
export function requestLeasesOf(statements: TenancyStatement[], ar: boolean): RequestLease[] {
  return statements
    .filter((item) => ['active', 'cancel_requested', 'renewal_pending'].includes(item.status))
    .map((item) => ({
      id: item.leaseId,
      label: [
        tenancyUnitLabel(item, ar),
        tenancyLandlordName(item.landlord, ar),
        item.contractReference,
      ]
        .filter(Boolean)
        .join(' · '),
      currency: item.currency,
      cheques: item.statement.lines.filter(chequeIsAdjustable).map((line) => ({
        id: line.chequeId!,
        number: line.chequeNumber ?? '—',
        dueOn: line.dueOn,
        amountMinor: line.amountMinor,
      })),
    }));
}

function StatementCard({
  item,
  ar,
  locale,
  requestLease,
}: {
  item: TenancyStatement;
  ar: boolean;
  locale: 'ar' | 'en';
  requestLease: RequestLease | undefined;
}) {
  const { statement, currency } = item;
  const money = (minor: string) => formatMoney(minor, currency, locale);
  const total = BigInt(statement.contractTotalMinor);
  const paidShare =
    total > 0n ? Math.min(100, Number((BigInt(statement.paidMinor) * 1000n) / total) / 10) : 0;
  const leases = requestLease ? [requestLease] : [];
  const overdue = statement.overdueMinor !== '0';

  return (
    <article className="tenant-statement" aria-labelledby={`statement-${item.leaseId}`}>
      <header className="tenant-statement__head">
        <div>
          <h2 id={`statement-${item.leaseId}`}>{tenancyUnitLabel(item, ar)}</h2>
          <p className="muted">
            {[
              tenancyLandlordName(item.landlord, ar),
              item.contractReference
                ? ar
                  ? `العقد ${item.contractReference}`
                  : `Contract ${item.contractReference}`
                : null,
              `${day(item.startsOn, ar)} ${ar ? '←' : '→'} ${day(item.endsOn, ar)}`,
            ]
              .filter(Boolean)
              .join(' · ')}
          </p>
        </div>
        <span className="tenant-status">{domainStatusLabel(item.status, ar)}</span>
      </header>

      <dl className="tenant-statement__totals">
        <div>
          <dt>{ar ? 'قيمة العقد الكاملة' : 'Full contract value'}</dt>
          <dd>{money(statement.contractTotalMinor)}</dd>
        </div>
        <div className="tenant-statement__total--good">
          <dt>{ar ? 'دفعت' : 'Paid'}</dt>
          <dd>{money(statement.paidMinor)}</dd>
        </div>
        <div className={overdue ? 'tenant-statement__total--bad' : undefined}>
          <dt>{ar ? 'متأخر عليك' : 'Overdue'}</dt>
          <dd>{money(statement.overdueMinor)}</dd>
        </div>
        <div>
          <dt>{ar ? 'متبقٍ من قيمة العقد' : 'Remaining on the contract'}</dt>
          <dd>{money(statement.remainingMinor)}</dd>
        </div>
        {statement.nextDue ? (
          <div>
            <dt>{ar ? 'الاستحقاق القادم' : 'Next due'}</dt>
            <dd>
              {money(statement.nextDue.amountMinor)}
              <small>{day(statement.nextDue.dueOn, ar)}</small>
            </dd>
          </div>
        ) : null}
      </dl>
      <div
        className="tenant-statement__bar"
        role="img"
        aria-label={ar ? `مدفوع ${paidShare}% من قيمة العقد` : `${paidShare}% of the contract paid`}
      >
        <span style={{ width: `${paidShare}%` }} />
      </div>

      {statement.lines.length ? (
        <div className="data-table-wrap tenant-table-wrap">
          <table className="data-table data-table--stack tenant-table tenant-statement__table">
            <thead>
              <tr>
                <th>{ar ? 'البند' : 'Item'}</th>
                <th>{ar ? 'تاريخ الاستحقاق' : 'Due'}</th>
                <th>{ar ? 'المبلغ' : 'Amount'}</th>
                <th>{ar ? 'المدفوع' : 'Paid'}</th>
                <th>{ar ? 'الشيك' : 'Cheque'}</th>
                <th>{ar ? 'الحالة' : 'Status'}</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {statement.lines.map((line) => (
                <tr
                  key={line.key}
                  className={line.outsideTotal ? 'tenant-statement__aside' : undefined}
                >
                  <td data-label={ar ? 'البند' : 'Item'}>
                    {ledgerLineLabel(line, ar)}
                    {line.periodFrom && line.periodTo ? (
                      <small className="tenant-table__sub">
                        {day(line.periodFrom, ar)} – {day(line.periodTo, ar)}
                      </small>
                    ) : null}
                  </td>
                  <td data-label={ar ? 'تاريخ الاستحقاق' : 'Due'}>
                    {day(line.dueOn, ar)}
                    {line.originalDueOn ? (
                      <small className="tenant-table__sub">
                        {ar
                          ? `مؤجّل من ${day(line.originalDueOn, ar)}`
                          : `Moved from ${day(line.originalDueOn, ar)}`}
                      </small>
                    ) : null}
                  </td>
                  <td data-label={ar ? 'المبلغ' : 'Amount'}>{money(line.amountMinor)}</td>
                  <td data-label={ar ? 'المدفوع' : 'Paid'}>
                    {line.paidMinor !== '0' ? money(line.paidMinor) : '—'}
                  </td>
                  <td data-label={ar ? 'الشيك' : 'Cheque'}>
                    {line.chequeNumber ? (
                      <>
                        <bdi>{line.chequeNumber}</bdi>
                        {line.bankName ? (
                          <small className="tenant-table__sub">{line.bankName}</small>
                        ) : null}
                      </>
                    ) : (
                      '—'
                    )}
                  </td>
                  <td data-label={ar ? 'الحالة' : 'Status'}>
                    <span
                      className={`tenant-status${TONE[line.status] ? ` tenant-status--${TONE[line.status]}` : ''}`}
                    >
                      {ledgerStatusLabel(line.status, ar)}
                    </span>
                  </td>
                  <td>
                    {chequeIsAdjustable(line) && requestLease ? (
                      <span className="tenant-statement__row-actions">
                        <TenantRequestLauncher
                          locale={locale}
                          leases={leases}
                          leaseId={item.leaseId}
                          type="cheque_postpone"
                          chequeId={line.chequeId!}
                          label={ar ? 'طلب تأجيل' : 'Postpone'}
                        />
                        <TenantRequestLauncher
                          locale={locale}
                          leases={leases}
                          leaseId={item.leaseId}
                          type="cheque_stop"
                          chequeId={line.chequeId!}
                          label={ar ? 'طلب إيقاف' : 'Stop'}
                        />
                      </span>
                    ) : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <EmptyState
          title={ar ? 'لا أقساط مسجلة على هذا العقد بعد' : 'No installments recorded yet'}
        />
      )}

      {statement.otherInvoices.length ? (
        <div className="tenant-statement__other">
          <h3>
            {ar ? 'فواتير ومبالغ أخرى على هذا العقد' : 'Other invoices on this lease'}
            {statement.otherOutstandingMinor !== '0' ? (
              <small>
                {ar
                  ? ` · المستحق منها ${money(statement.otherOutstandingMinor)}`
                  : ` · ${money(statement.otherOutstandingMinor)} outstanding`}
              </small>
            ) : null}
          </h3>
          <ul>
            {statement.otherInvoices.map((invoice) => (
              <li key={invoice.id}>
                <bdi>{invoice.number}</bdi>
                <span>{day(invoice.dueOn, ar)}</span>
                <span>{money(invoice.totalMinor)}</span>
                <span className="tenant-status">{domainStatusLabel(invoice.status, ar)}</span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {requestLease ? (
        <footer className="tenant-statement__manage">
          <strong>{ar ? 'إدارة العقد' : 'Manage the lease'}</strong>
          <div>
            <TenantRequestLauncher
              locale={locale}
              leases={leases}
              leaseId={item.leaseId}
              type="maintenance"
              label={ar ? 'طلب صيانة' : 'Maintenance'}
            />
            <TenantRequestLauncher
              locale={locale}
              leases={leases}
              leaseId={item.leaseId}
              type="payment_arrangement"
              label={ar ? 'ترتيب سداد' : 'Payment arrangement'}
            />
            <TenantRequestLauncher
              locale={locale}
              leases={leases}
              leaseId={item.leaseId}
              type="lease_renew"
              label={ar ? 'طلب تجديد' : 'Renew'}
            />
            <TenantRequestLauncher
              locale={locale}
              leases={leases}
              leaseId={item.leaseId}
              type="contract_amend"
              label={ar ? 'تعديل بند' : 'Amend'}
            />
            <TenantRequestLauncher
              locale={locale}
              leases={leases}
              leaseId={item.leaseId}
              type="lease_cancel"
              label={ar ? 'طلب إلغاء العقد' : 'Cancel the lease'}
            />
            <TenantRequestLauncher
              locale={locale}
              leases={leases}
              leaseId={item.leaseId}
              type="other"
              label={ar ? 'طلب آخر' : 'Other'}
            />
            {item.contractId ? (
              <Link
                className="button button--quiet button--tiny"
                href={`/tenant/contracts/${item.contractId}`}
              >
                {ar ? 'عرض العقد' : 'View contract'}
              </Link>
            ) : null}
          </div>
        </footer>
      ) : null}
    </article>
  );
}

export function TenantStatements({
  statements,
  ar,
  locale,
}: {
  statements: TenancyStatement[];
  ar: boolean;
  locale: 'ar' | 'en';
}) {
  if (!statements.length) {
    return (
      <EmptyState
        title={ar ? 'لا عقود إيجار سارية لعرض كشف حسابها' : 'No leases to show a statement for'}
      />
    );
  }
  const requestLeases = requestLeasesOf(statements, ar);
  return (
    <div className="tenant-statements">
      {statements.map((item) => (
        <StatementCard
          key={item.leaseId}
          item={item}
          ar={ar}
          locale={locale}
          requestLease={requestLeases.find((lease) => lease.id === item.leaseId)}
        />
      ))}
    </div>
  );
}
