import { EmptyState } from '@bhd-r/ui';
import { Link } from '@/i18n/navigation';
import { formatMoney } from '@/lib/format';
import { TenantRequestLauncher, type RequestLease } from '@/components/tenant-request-form';
import {
  rentDocHref,
  rentDocKindsOf,
  rentDocSubjects,
  rentMonthLabel,
  type RentDocSubject,
} from '@/lib/rent-documents';
import { chargeCategoryOf, chargeLabel } from '@/lib/tenant-charges-shared';
import {
  arrearsLabel,
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
      maintenanceBlocked: item.maintenanceBlocked,
      arrearsMinor: item.statement.arrears.totalMinor,
      arrears: item.statement.arrears.byCategory,
    }));
}

/** Links to the signed receipt (anything paid) and demand invoice (anything left) of one item. */
function DocLinks({
  leaseId,
  subject,
  ar,
}: {
  leaseId: string;
  subject: RentDocSubject | undefined;
  ar: boolean;
}) {
  if (!subject) return null;
  const kinds = rentDocKindsOf(subject);
  if (!kinds.length) return null;
  return (
    <span className="tenant-statement__docs">
      {kinds.map((kind) => (
        <Link
          key={kind}
          className={`tenant-doc-link tenant-doc-link--${kind}`}
          href={rentDocHref('tenant', leaseId, subject.key, kind)}
          prefetch={false}
        >
          {kind === 'receipt'
            ? ar
              ? '🧾 إيصال القبض'
              : '🧾 Receipt'
            : ar
              ? '📄 الفاتورة'
              : '📄 Invoice'}
        </Link>
      ))}
    </span>
  );
}

/** Everything the tenant is late on for this lease: rent, utility bills, maintenance, damage. */
function ArrearsPanel({
  item,
  ar,
  money,
}: {
  item: TenancyStatement;
  ar: boolean;
  money: (minor: string) => string;
}) {
  const { arrears } = item.statement;
  if (arrears.totalMinor === '0') return null;
  return (
    <section className="tenant-arrears" aria-labelledby={`arrears-${item.leaseId}`}>
      <header>
        <h3 id={`arrears-${item.leaseId}`}>{ar ? 'المتأخرات عليك' : 'Your arrears'}</h3>
        <strong>{money(arrears.totalMinor)}</strong>
      </header>
      <ul className="tenant-arrears__totals">
        {arrears.byCategory.map((group) => (
          <li key={group.category}>
            <span>{arrearsLabel(group.category, ar)}</span>
            <b>{money(group.amountMinor)}</b>
          </li>
        ))}
      </ul>
      <ul className="tenant-arrears__items">
        {arrears.items.map((entry) => (
          <li key={entry.key}>
            <span>
              {arrearsLabel(entry.category, ar)}
              {entry.index ? ` ${entry.index}` : ''}
              {entry.invoiceNumber ? (
                <small className="tenant-table__sub">
                  <bdi>{entry.invoiceNumber}</bdi>
                </small>
              ) : null}
            </span>
            <span>
              {ar ? 'استحق في ' : 'Due '}
              {day(entry.dueOn, ar)}
            </span>
            <b>{money(entry.amountMinor)}</b>
          </li>
        ))}
      </ul>
      {item.maintenanceBlocked ? (
        <p className="notice notice--error">
          {ar
            ? 'حسب سياسة إدارة العقار لا تُقبل طلبات الصيانة العادية قبل تسوية هذه المبالغ. يمكنك دائماً تقديم طلب صيانة مستعجل يخص سلامة المبنى أو القاطنين.'
            : 'Under the property management’s rule, ordinary maintenance requests open once these are settled. You can always send an urgent request about the building’s or occupants’ safety.'}
        </p>
      ) : null}
    </section>
  );
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
  const subjects = new Map(rentDocSubjects(statement).map((subject) => [subject.key, subject]));

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

      <ArrearsPanel item={item} ar={ar} money={money} />

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
                <th>{ar ? 'الإيصال والفاتورة' : 'Receipt & invoice'}</th>
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
                    {line.kind === 'rent' ? (
                      <small className="tenant-table__sub">
                        {ar ? 'عن شهر ' : 'For '}
                        {rentMonthLabel(line, ar)}
                      </small>
                    ) : null}
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
                  <td data-label={ar ? 'الإيصال والفاتورة' : 'Receipt & invoice'}>
                    <DocLinks leaseId={item.leaseId} subject={subjects.get(line.key)} ar={ar} />
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
            {statement.otherInvoices.map((invoice) => {
              const category = chargeCategoryOf(invoice.number);
              return (
                <li key={invoice.id}>
                  {category ? <strong>{chargeLabel(category, ar)}</strong> : null}
                  <bdi>{invoice.number}</bdi>
                  <span>{day(invoice.dueOn, ar)}</span>
                  <span>{money(invoice.totalMinor)}</span>
                  <span className="tenant-status">{domainStatusLabel(invoice.status, ar)}</span>
                  <DocLinks
                    leaseId={item.leaseId}
                    subject={subjects.get(`charge-${invoice.id}`)}
                    ar={ar}
                  />
                </li>
              );
            })}
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
            <TenantRequestLauncher
              locale={locale}
              leases={leases}
              leaseId={item.leaseId}
              type="report_property"
              label={ar ? 'بلاغ عن العقار' : 'Report about the property'}
            />
            <TenantRequestLauncher
              locale={locale}
              leases={leases}
              leaseId={item.leaseId}
              type="report_staff"
              label={ar ? 'بلاغ عن موظف' : 'Report a staff member'}
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

/** A short reminder of the arrears on the requests page, with the way to the full statement. */
export function TenantArrearsSummary({
  statements,
  ar,
  locale,
}: {
  statements: TenancyStatement[];
  ar: boolean;
  locale: 'ar' | 'en';
}) {
  const owing = statements.filter((item) => item.statement.arrears.totalMinor !== '0');
  if (!owing.length) return null;
  return (
    <div className="tenant-arrears tenant-arrears--summary">
      {owing.map((item) => (
        <div key={item.leaseId}>
          <header>
            <h3>
              {ar ? 'المتأخرات عليك — ' : 'Your arrears — '}
              {tenancyUnitLabel(item, ar)}
            </h3>
            <strong>{formatMoney(item.statement.arrears.totalMinor, item.currency, locale)}</strong>
          </header>
          <ul className="tenant-arrears__totals">
            {item.statement.arrears.byCategory.map((group) => (
              <li key={group.category}>
                <span>{arrearsLabel(group.category, ar)}</span>
                <b>{formatMoney(group.amountMinor, item.currency, locale)}</b>
              </li>
            ))}
          </ul>
          {item.maintenanceBlocked ? (
            <p className="muted">
              {ar
                ? 'طلبات الصيانة العادية لهذا العقد تُفتح بعد تسوية المتأخرات؛ الطلبات المستعجلة متاحة دائماً.'
                : 'Ordinary maintenance for this lease opens once the arrears are settled; urgent requests are always open.'}
            </p>
          ) : null}
        </div>
      ))}
      <Link className="button button--quiet button--tiny" href="/tenant/invoices">
        {ar ? 'كشف الحساب الكامل' : 'Full statement'}
      </Link>
    </div>
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
