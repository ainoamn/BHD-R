import type { ReactNode } from 'react';
import type { ReservationParty } from '@/lib/reservation-party';
import { countryName } from '@/lib/world-countries';

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <dt>{label}</dt>
      <dd>{children || '—'}</dd>
    </div>
  );
}

function Ltr({ value }: { value: string | null | undefined }) {
  return value ? <bdi dir="ltr">{value}</bdi> : null;
}

function day(iso: string, ar: boolean): string {
  const date = new Date(`${iso}T00:00:00Z`);
  return Number.isNaN(date.getTime())
    ? iso
    : date.toLocaleDateString(ar ? 'ar-OM' : 'en-GB', { timeZone: 'UTC', dateStyle: 'medium' });
}

/** Tenant or buyer details as the customer entered them while booking. */
export function ReservationPartyCard({
  party,
  locale,
  sale,
}: {
  party: ReservationParty;
  locale: 'ar' | 'en';
  sale: boolean;
}) {
  const ar = locale === 'ar';
  const role = sale ? (ar ? 'المشتري' : 'Buyer') : ar ? 'المستأجر' : 'Tenant';
  const person = party.entityType === 'person' ? party.person : null;
  const company = party.entityType === 'company' ? party.company : null;

  return (
    <section className="ops-panel party-card" aria-labelledby="party-card-title">
      <header className="party-card__head">
        <h2 id="party-card-title">
          {ar ? `بيانات ${role} كما أدخلها العميل` : `${role} details entered by the client`}
        </h2>
        <p className="muted">
          {ar
            ? 'تنتقل هذه البيانات تلقائياً إلى العقد عند تجهيزه — لا حاجة لإعادة إدخالها.'
            : 'These details flow into the contract automatically — no need to re-enter them.'}
        </p>
      </header>
      <dl className="contract-detail__facts">
        {!sale ? (
          <>
            <Row label={ar ? 'نوع العقد' : 'Contract type'}>
              {party.contractType === 'commercial'
                ? ar
                  ? 'تجاري'
                  : 'Commercial'
                : ar
                  ? 'سكني'
                  : 'Residential'}
            </Row>
            <Row label={ar ? 'مدة العقد المطلوبة' : 'Requested term'}>
              {party.termMonths ? `${party.termMonths} ${ar ? 'شهراً' : 'months'}` : null}
            </Row>
          </>
        ) : null}
        <Row label={ar ? `${role} هو` : `${role} is`}>
          {party.holder === 'self'
            ? ar
              ? 'صاحب الحساب نفسه'
              : 'The account holder'
            : ar
              ? 'شخص آخر'
              : 'Someone else'}
        </Row>
        <Row label={ar ? 'نوع الجهة' : 'Party type'}>
          {company ? (ar ? 'شركة' : 'Company') : ar ? 'فرد' : 'Individual'}
        </Row>
        {person ? (
          <>
            <Row label={ar ? 'الاسم (عربي)' : 'Name (Arabic)'}>{person.nameAr}</Row>
            <Row label={ar ? 'الاسم (إنجليزي)' : 'Name (English)'}>
              <bdi dir="ltr">{person.nameEn}</bdi>
            </Row>
            <Row label={ar ? 'الجنسية' : 'Nationality'}>
              {countryName(person.nationality, locale)}
            </Row>
            <Row label={ar ? 'الرقم المدني' : 'Civil ID'}>
              <Ltr value={person.civilId} />
            </Row>
            <Row label={ar ? 'رقم الجواز' : 'Passport'}>
              <Ltr value={person.passport} />
            </Row>
            <Row label={ar ? 'الهاتف' : 'Phone'}>
              <a href={`tel:${person.phone}`} dir="ltr">
                {person.phone}
              </a>
            </Row>
            <Row label={ar ? 'هاتف بديل' : 'Alternate phone'}>
              <a href={`tel:${person.altPhone}`} dir="ltr">
                {person.altPhone}
              </a>
            </Row>
            <Row label={ar ? 'البريد الإلكتروني' : 'Email'}>
              <Ltr value={person.email} />
            </Row>
          </>
        ) : null}
        {company ? (
          <>
            <Row label={ar ? 'اسم الشركة (عربي)' : 'Company name (Arabic)'}>{company.nameAr}</Row>
            <Row label={ar ? 'اسم الشركة (إنجليزي)' : 'Company name (English)'}>
              <bdi dir="ltr">{company.nameEn}</bdi>
            </Row>
            <Row label={ar ? 'رقم السجل التجاري' : 'CR number'}>
              <Ltr value={company.crNumber} />
            </Row>
            <Row label={ar ? 'تاريخ التأسيس' : 'Established'}>{day(company.crIssuedOn, ar)}</Row>
            <Row label={ar ? 'انتهاء السجل' : 'CR expiry'}>{day(company.crExpiry, ar)}</Row>
            <Row label={ar ? 'عنوان السجل' : 'CR address'}>{company.crAddress}</Row>
            <Row label={ar ? 'النشاط المراد الاستئجار لأجله' : 'Intended activity'}>
              {company.activity}
            </Row>
            <Row label={ar ? 'الهاتف' : 'Phone'}>
              <a href={`tel:${company.phone}`} dir="ltr">
                {company.phone}
              </a>
            </Row>
            <Row label={ar ? 'هاتف بديل' : 'Alternate phone'}>
              <a href={`tel:${company.altPhone}`} dir="ltr">
                {company.altPhone}
              </a>
            </Row>
            <Row label={ar ? 'البريد الإلكتروني' : 'Email'}>
              <Ltr value={company.email} />
            </Row>
            <Row label={ar ? 'نوع التوقيع في السجل' : 'Signing authority'}>
              {company.signingMode === 'joint'
                ? ar
                  ? 'متحد (مجتمعين)'
                  : 'Joint'
                : ar
                  ? 'منفرد'
                  : 'Individual'}
            </Row>
          </>
        ) : null}
      </dl>
      {company?.signatories.length ? (
        <div className="party-card__signatories">
          <h3>
            {company.signingMode === 'joint'
              ? ar
                ? 'الموقّعون مجتمعين حسب السجل'
                : 'Joint signatories per the CR'
              : ar
                ? 'المفوّضون بالتوقيع'
                : 'Authorised signatories'}
          </h3>
          <table className="party-card__table">
            <thead>
              <tr>
                <th>{ar ? 'الاسم' : 'Name'}</th>
                <th>{ar ? 'الرقم المدني' : 'Civil ID'}</th>
                <th>{ar ? 'الهاتف' : 'Phone'}</th>
              </tr>
            </thead>
            <tbody>
              {company.signatories.map((row, index) => (
                <tr key={`${row.name}-${index}`}>
                  <td>{row.name}</td>
                  <td>
                    <Ltr value={row.civilId} />
                  </td>
                  <td>
                    <Ltr value={row.phone} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
    </section>
  );
}
