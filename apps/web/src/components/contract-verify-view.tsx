import type { ReactNode } from 'react';
import type { ContractVerification, VerifiedParty } from '@/lib/contract-verify-neon';

const BRAND_LOGO = '/brand/bhd-official-symbol.svg';

type Pair = readonly [string, string];

const TYPES: Record<string, Pair> = {
  stay: ['عقد إقامة قصيرة', 'Short-stay agreement'],
  lease: ['عقد إيجار', 'Lease agreement'],
  sale: ['عقد بيع عقار', 'Property sale agreement'],
  renewal: ['ملحق تجديد عقد', 'Contract renewal addendum'],
};

const ID_KINDS: Record<string, Pair> = {
  civil_id: ['الرقم المدني', 'Civil ID'],
  passport: ['جواز السفر', 'Passport'],
  commercial_registration: ['السجل التجاري', 'Commercial registration'],
};

type Verdict = 'valid' | 'pending' | 'revoked';

function verdictOf(status: string): Verdict {
  if (status === 'signed' || status === 'active' || status === 'completed') return 'valid';
  if (status === 'void' || status === 'terminated' || status === 'cancelled') return 'revoked';
  return 'pending';
}

const VERDICTS: Record<Verdict, { icon: string; title: Pair; note: Pair }> = {
  valid: {
    icon: '✓',
    title: ['عقد معتمد وموثّق', 'Verified & approved contract'],
    note: [
      'هذا العقد صادر من المنصة، ووقّعه أطرافه إلكترونياً، وهو معتمد ونافذ.',
      'This contract was issued through the platform, signed electronically by its parties, and is approved and in force.',
    ],
  },
  pending: {
    icon: '…',
    title: ['عقد صحيح بانتظار اكتمال التوقيع', 'Genuine contract — awaiting signatures'],
    note: [
      'هذا العقد صادر من المنصة، لكن لم يكتمل توقيع جميع الأطراف بعد.',
      'This contract was issued through the platform, but not every party has signed yet.',
    ],
  },
  revoked: {
    icon: '!',
    title: ['عقد ملغى أو منتهٍ', 'Contract void or terminated'],
    note: [
      'هذا العقد صادر من المنصة، لكنه أُلغي أو أُنهي ولم يعد نافذاً.',
      'This contract was issued through the platform but has been voided or terminated.',
    ],
  },
};

function Bi({ value, ar }: { value: Pair; ar: boolean }) {
  const [first, second] = ar ? value : [value[1], value[0]];
  if (first === second) return <span>{first}</span>;
  return (
    <span className="verify-bi">
      <span>{first}</span>
      <small lang={ar ? 'en' : 'ar'} dir={ar ? 'ltr' : 'rtl'}>
        {second}
      </small>
    </span>
  );
}

function formatDay(value: string, lang: 'ar' | 'en'): string {
  const date = new Date(value.length === 10 ? `${value}T00:00:00Z` : value);
  return date.toLocaleDateString(lang === 'ar' ? 'ar-OM' : 'en-GB', {
    timeZone: value.length === 10 ? 'UTC' : 'Asia/Muscat',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });
}

function formatDateTime(value: string, lang: 'ar' | 'en'): string {
  return new Date(value).toLocaleString(lang === 'ar' ? 'ar-OM' : 'en-GB', {
    timeZone: 'Asia/Muscat',
    dateStyle: 'medium',
    timeStyle: 'short',
  });
}

const day = (value: string | null): Pair | null =>
  value ? [formatDay(value, 'ar'), formatDay(value, 'en')] : null;

/** Public verification card: parties, approval and e-signature serials; no terms or documents. */
export function ContractVerifyView({
  result,
  locale,
}: {
  result: ContractVerification | null;
  locale: 'ar' | 'en';
}) {
  const ar = locale === 'ar';
  if (!result) {
    return (
      <main className="verify-page" dir={ar ? 'rtl' : 'ltr'}>
        <article className="verify-card verify-card--invalid">
          <div className="verify-card__status">
            <span className="verify-card__icon" aria-hidden="true">
              ✕
            </span>
            <h1>
              <Bi
                value={['لا يوجد عقد مطابق لهذا الرمز', 'No contract matches this code']}
                ar={ar}
              />
            </h1>
          </div>
          <p className="verify-card__note">
            <Bi
              value={[
                'تأكد من مسح الرمز الموجود على العقد الأصلي. إن استمرت المشكلة فقد تكون الوثيقة غير صادرة من المنصة.',
                'Make sure you scanned the code printed on the original contract. If this persists, the document may not have been issued by the platform.',
              ]}
              ar={ar}
            />
          </p>
        </article>
      </main>
    );
  }

  const verdict = verdictOf(result.status);
  const copy = VERDICTS[verdict];
  const title = result.kind === 'renewal' ? TYPES.renewal! : (TYPES[result.type] ?? TYPES.lease!);
  const ended =
    verdict === 'valid' && result.endsOn && result.endsOn < new Date().toISOString().slice(0, 10);
  const firstRole: Pair = result.type === 'sale' ? ['البائع', 'Seller'] : ['المؤجر', 'Landlord'];
  const secondRole: Pair =
    result.type === 'sale'
      ? ['المشتري', 'Buyer']
      : result.type === 'stay'
        ? ['الضيف المستأجر', 'Guest']
        : ['المستأجر', 'Tenant'];
  const unitName: Pair | null = result.unit
    ? [
        [result.property?.nameAr, result.unit.nameAr].filter(Boolean).join(' — '),
        [result.property?.nameEn, result.unit.nameEn].filter(Boolean).join(' — '),
      ]
    : null;

  const fact = (term: Pair, value: ReactNode) =>
    value ? (
      <div className="verify-fact">
        <dt>
          <Bi value={term} ar={ar} />
        </dt>
        <dd>{value}</dd>
      </div>
    ) : null;

  const partyCard = (role: Pair, order: Pair, party: VerifiedParty | null) => (
    <section className="verify-party">
      <h3>
        <Bi value={[`${order[0]} — ${role[0]}`, `${order[1]} — ${role[1]}`]} ar={ar} />
      </h3>
      {party ? (
        <dl>
          {fact(['الاسم', 'Name'], <bdi>{party.name}</bdi>)}
          {party.idMasked && party.idKind
            ? fact(ID_KINDS[party.idKind]!, <bdi dir="ltr">{party.idMasked}</bdi>)
            : null}
          {party.nationality ? fact(['الجنسية', 'Nationality'], party.nationality) : null}
          {party.phoneMasked
            ? fact(['الهاتف', 'Phone'], <bdi dir="ltr">{party.phoneMasked}</bdi>)
            : null}
          {party.emailMasked
            ? fact(['البريد الإلكتروني', 'Email'], <bdi dir="ltr">{party.emailMasked}</bdi>)
            : null}
        </dl>
      ) : (
        <p className="muted">—</p>
      )}
    </section>
  );

  return (
    <main className="verify-page" dir={ar ? 'rtl' : 'ltr'}>
      <article className={`verify-card verify-card--${verdict}`}>
        <header className="verify-card__issuer">
          <img src={result.issuer.logoDataUrl || BRAND_LOGO} alt="" width={120} height={48} />
          <div>
            <strong lang="ar" dir="rtl">
              {result.issuer.nameAr}
            </strong>
            {result.issuer.nameEn !== result.issuer.nameAr ? (
              <span lang="en" dir="ltr">
                {result.issuer.nameEn}
              </span>
            ) : null}
          </div>
        </header>

        <div className="verify-card__status">
          <span className="verify-card__icon" aria-hidden="true">
            {copy.icon}
          </span>
          <h1>
            <Bi value={copy.title} ar={ar} />
          </h1>
        </div>
        <p className="verify-card__note">
          <Bi value={copy.note} ar={ar} />
        </p>

        {result.serial && verdict === 'valid' ? (
          <p className="verify-card__statement">
            <Bi
              value={[
                'تم توثيق هذا العقد بتوقيع إلكتروني رقم',
                'This contract was authenticated by electronic signature No.',
              ]}
              ar={ar}
            />
            <b dir="ltr">{result.serial}</b>
          </p>
        ) : null}

        {ended ? (
          <p className="verify-card__ended">
            <Bi
              value={[
                `انتهت مدة هذا العقد في ${formatDay(result.endsOn!, 'ar')}.`,
                `The term of this contract ended on ${formatDay(result.endsOn!, 'en')}.`,
              ]}
              ar={ar}
            />
          </p>
        ) : null}

        <dl className="verify-card__facts">
          {fact(['رقم العقد', 'Contract No.'], <bdi dir="ltr">{result.reference}</bdi>)}
          {fact(['نوع العقد', 'Type'], <Bi value={title} ar={ar} />)}
          {fact(['تاريخ التحرير', 'Issued on'], <Bi value={day(result.createdAt)!} ar={ar} />)}
          {result.startsOn && result.endsOn
            ? fact(
                ['مدة العقد', 'Term'],
                <Bi
                  value={[
                    `من ${formatDay(result.startsOn, 'ar')} إلى ${formatDay(result.endsOn, 'ar')}`,
                    `${formatDay(result.startsOn, 'en')} – ${formatDay(result.endsOn, 'en')}`,
                  ]}
                  ar={ar}
                />,
              )
            : null}
          {unitName
            ? fact(
                ['العقار والوحدة', 'Property & unit'],
                <>
                  <Bi value={unitName} ar={ar} />
                  {unitName.join(' ').includes(result.unit!.code) ? null : (
                    <bdi dir="ltr"> ({result.unit!.code})</bdi>
                  )}
                </>,
              )
            : null}
        </dl>

        <div className="verify-card__parties">
          {partyCard(firstRole, ['الطرف الأول', 'First party'], result.landlord)}
          {partyCard(secondRole, ['الطرف الثاني', 'Second party'], result.tenant)}
        </div>

        {result.signatures.length ? (
          <section className="verify-card__signatures">
            <h2>
              <Bi value={['التواقيع الإلكترونية', 'Electronic signatures']} ar={ar} />
            </h2>
            <ul>
              {result.signatures.map((signature) => (
                <li key={`${signature.role}-${signature.signedAt}`}>
                  <span className="verify-sign__role">
                    <Bi value={signature.role === 'owner' ? firstRole : secondRole} ar={ar} />
                  </span>
                  <span>
                    <bdi>{signature.name ?? '—'}</bdi>
                  </span>
                  <span>
                    <Bi
                      value={[
                        formatDateTime(signature.signedAt, 'ar'),
                        formatDateTime(signature.signedAt, 'en'),
                      ]}
                      ar={ar}
                    />
                  </span>
                  {signature.serial ? (
                    <b className="verify-sign__serial" dir="ltr">
                      {signature.serial}
                    </b>
                  ) : null}
                </li>
              ))}
            </ul>
          </section>
        ) : null}

        <p className="verify-card__privacy">
          <span aria-hidden="true">🔒</span>
          <Bi
            value={[
              'حفاظاً على الخصوصية لا تُعرض شروط العقد ولا قيمته ولا مستنداته، وتظهر بيانات الاتصال والهوية مخفية جزئياً.',
              'For privacy, the contract terms, amounts and documents are not shown, and contact and ID details are partly hidden.',
            ]}
            ar={ar}
          />
        </p>
        <footer className="verify-card__foot">
          <Bi
            value={[
              `تم التحقق في ${formatDateTime(new Date().toISOString(), 'ar')} · منصة BHD R`,
              `Checked on ${formatDateTime(new Date().toISOString(), 'en')} · BHD R platform`,
            ]}
            ar={ar}
          />
        </footer>
      </article>
    </main>
  );
}
