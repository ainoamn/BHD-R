import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { setRequestLocale } from 'next-intl/server';
import { BadgeChips } from '@/components/badges/badge-chips';
import { BadgeEmblem } from '@/components/badges/badge-emblem';
import { BadgeShowcaseSection } from '@/components/badges/badge-showcase';
import { IdentityAvatar, VerifiedMark } from '@/components/identity/verified-mark';
import { Link } from '@/i18n/navigation';
import { hasDatabaseUrl } from '@/lib/bhd/identity-session';
import { loadBadgeShowcaseSafe, type BadgeShowcase } from '@/lib/badges-neon';
import {
  BADGE_LEVELS,
  BADGE_SUBJECTS,
  BADGE_TIERS,
  DEFAULT_BADGES,
  GRANT_LABELS,
  LEVEL_LABELS,
  SUBJECT_LABELS,
  TIER_LABELS,
  awardSerial,
  describeCriterion,
  parseAwardSerial,
  type BadgeChip,
  type BadgeIcon,
  type BadgeTier,
} from '@/lib/badges-shared';
import { bilingualAlternates } from '@/lib/seo';

export const dynamic = 'force-dynamic';

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const ar = locale !== 'en';
  return {
    title: ar ? 'الشارات والأوسمة والحسابات الموثّقة' : 'Badges, medals and verified accounts',
    description: ar
      ? 'ما تعنيه شارات BHD R وأوسمتها ودروعها وشهاداتها، وكيف تُمنح وتُسحب، وكيف يظهر الحساب الموثّق وكيف يُفعّل.'
      : 'What BHD R badges, shields, certificates and medals mean, how they are earned and withdrawn, and how verified accounts appear and are activated.',
    alternates: bilingualAlternates(locale, '/badges'),
  };
}

const TIER_ICON: Record<BadgeTier, BadgeIcon> = {
  badge: 'star',
  shield: 'shield',
  certificate: 'handshake',
  medal: 'trophy',
};

const TIER_MEANING: Record<BadgeTier, { ar: string; en: string }> = {
  badge: {
    ar: 'تقدير لأداء محدد يتحقق باستمرار: تقييم مرتفع، سداد في الموعد، صيانة سريعة. تُمنح غالباً تلقائياً وتسقط إذا انخفض الأداء.',
    en: 'Recognises one sustained strength: high ratings, on-time payment, fast maintenance. Usually automatic, and withdrawn if performance drops.',
  },
  shield: {
    ar: 'درجة أعلى تجمع أكثر من معيار لمدة أطول، ويعتمدها المالك أو مدير المؤسسة بعد أن يقترحها النظام.',
    en: 'A higher honour combining several criteria over a longer period; proposed by the system, then approved by the owner or organization admin.',
  },
  certificate: {
    ar: 'شهادة تميّز لشريك أو مقاول أثبت جودته على مدى طويل، بشهادة قابلة للطباعة ورمز QR للتحقق.',
    en: 'An excellence certificate for a partner or contractor with a long record of quality, printable with a QR code for verification.',
  },
  medal: {
    ar: 'أرفع الأوسمة: إنجاز استثنائي في فترة محددة (مثل موظف الشهر). يُعتمد يدوياً ويبقى في سجل صاحبه.',
    en: 'The highest honour: an exceptional achievement in a set period (such as employee of the month). Approved by hand and kept on record.',
  },
};

const SAMPLE_CHIPS: BadgeChip[] = [
  {
    serial: 'AWD-0000-000000',
    nameAr: 'نجم التقييم',
    nameEn: 'Top rated',
    tier: 'badge',
    level: 'gold',
    icon: 'star',
  },
  {
    serial: 'AWD-0000-000001',
    nameAr: 'درع العقار المتميز',
    nameEn: 'Property excellence shield',
    tier: 'shield',
    level: 'platinum',
    icon: 'shield',
  },
];

export default async function BadgesGuidePage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ serial?: string | string[] }>;
}) {
  const { locale: rawLocale } = await params;
  const locale = rawLocale === 'en' ? 'en' : 'ar';
  const ar = locale === 'ar';
  const lang = ar ? 'ar' : 'en';
  setRequestLocale(locale);

  const query = await searchParams;
  const serialQuery = typeof query.serial === 'string' ? query.serial : undefined;
  const parsed = serialQuery ? parseAwardSerial(serialQuery) : null;
  if (parsed) redirect(`/${locale}/verify/badge/${awardSerial(parsed.year, parsed.no)}`);

  const showcase: BadgeShowcase = hasDatabaseUrl()
    ? await loadBadgeShowcaseSafe(6)
    : { awards: [], activeCount: 0, holderCount: 0 };

  return (
    <main className="badges-guide">
      <section className="section badges-guide__hero">
        <div className="container">
          <span className="section-kicker section-kicker--gold">BHD R · EXCELLENCE</span>
          <h1>
            {ar
              ? 'الشارات والأوسمة: تميّز يُقاس ويُتحقق منه'
              : 'Badges and medals: measured, verifiable excellence'}
          </h1>
          <p className="badges-guide__lead">
            {ar
              ? 'كل شارة في BHD R تُمنح لعقار أو مالك أو مستأجر أو موظف أو مقاول لأن بياناته الفعلية في المنصة حققت معياراً واضحاً، لا بالمجاملة. تظهر الشارة بجانب الاسم في كل مكان: بطاقات العقارات، صفحة العقار، الحجوزات، العقود، دفتر العناوين وصفحة الفريق، وتنعكس فور منحها أو سحبها.'
              : 'Every BHD R badge goes to a property, owner, tenant, staff member or contractor because their real data on the platform met a clear standard, never as a favour. It appears beside the name everywhere: property cards and pages, bookings, contracts, the address book and the team page, and updates the moment it is granted or withdrawn.'}
          </p>
          <div className="badges-guide__demo" aria-hidden="true">
            <span className="name-with-mark">
              <strong>{ar ? 'برج الواحة السكني' : 'Al Waha Residence'}</strong>
              <BadgeChips badges={SAMPLE_CHIPS} locale={locale} linked={false} />
            </span>
            <small className="muted">
              {ar
                ? 'هكذا تظهر الشارات بجانب اسم العقار'
                : 'How badges appear beside a property name'}
            </small>
          </div>
        </div>
      </section>

      <section className="section">
        <div className="container">
          <div className="section-heading">
            <div>
              <span className="section-kicker">{ar ? 'الأنواع' : 'Types'}</span>
              <h2>{ar ? 'أربع درجات من التقدير' : 'Four kinds of recognition'}</h2>
            </div>
          </div>
          <div className="badges-guide__tiers">
            {BADGE_TIERS.map((tier) => (
              <article key={tier} className="badges-guide__tier">
                <BadgeEmblem tier={tier} level="gold" icon={TIER_ICON[tier]} size={64} />
                <h3>{TIER_LABELS[tier][lang]}</h3>
                <p>{TIER_MEANING[tier][lang]}</p>
              </article>
            ))}
          </div>
        </div>
      </section>

      <section className="section badges-guide__levels-section">
        <div className="container">
          <div className="section-heading">
            <div>
              <span className="section-kicker">{ar ? 'المستويات' : 'Levels'}</span>
              <h2>
                {ar ? 'لون الشارة يدل على صعوبتها' : 'The colour shows how hard it is to earn'}
              </h2>
            </div>
          </div>
          <ol className="badges-guide__levels">
            {BADGE_LEVELS.map((level) => (
              <li key={level}>
                <BadgeEmblem tier="badge" level={level} icon="star" size={48} />
                <strong>{LEVEL_LABELS[level][lang]}</strong>
              </li>
            ))}
          </ol>
          <p className="muted">
            {ar
              ? 'من البرونزي (بداية التميّز) إلى الماسي (الأندر). داخل النوع الواحد يُعرض الأعلى مستوى أولاً.'
              : 'From bronze (a first mark of excellence) to diamond (the rarest). Within each type the higher level is shown first.'}
          </p>
        </div>
      </section>

      <section className="section">
        <div className="container">
          <div className="section-heading">
            <div>
              <span className="section-kicker">{ar ? 'القواعد' : 'Rules'}</span>
              <h2>{ar ? 'كيف تُمنح الشارة وكيف تُسحب' : 'How awards are granted and withdrawn'}</h2>
            </div>
          </div>
          <div className="badges-guide__rules">
            <article>
              <h3>{ar ? 'قياس من البيانات الفعلية' : 'Measured from real data'}</h3>
              <p>
                {ar
                  ? 'يقيس النظام كل ليلة التقييمات ونسبة الإشغال والسداد في الموعد ومدة إنجاز الصيانة والمهام، لكل عقار وشخص في المؤسسة.'
                  : 'Every night the system measures ratings, occupancy, on-time payment and maintenance and task turnaround for every property and person.'}
              </p>
            </article>
            <article>
              <h3>{ar ? 'طرق المنح' : 'Ways of granting'}</h3>
              <ul>
                {(['auto', 'approval', 'manual'] as const).map((mode) => (
                  <li key={mode}>{GRANT_LABELS[mode][lang]}</li>
                ))}
              </ul>
            </article>
            <article>
              <h3>{ar ? 'الاستمرار والصلاحية' : 'Sustain and validity'}</h3>
              <p>
                {ar
                  ? 'بعض الشارات تتطلب أن يستمر الأداء أياماً قبل المنح، ولكل شارة مدة صلاحية تُجدَّد تلقائياً ما دام المعيار متحققاً، وتُسحب إذا انخفض الأداء.'
                  : 'Some badges require performance to hold for a number of days first. Each has a validity period that renews while the standard holds, and is withdrawn if it slips.'}
              </p>
            </article>
            <article>
              <h3>{ar ? 'شهادة قابلة للتحقق' : 'A verifiable certificate'}</h3>
              <p>
                {ar
                  ? 'لكل شارة ممنوحة رقم تسلسلي (مثل AWD-2026-000001) وشهادة برمز QR. يُعرض اسم الشخص مختصراً حفاظاً على خصوصيته.'
                  : 'Every award has a serial (e.g. AWD-2026-000001) and a certificate with a QR code. People are shown by given name and initial to protect privacy.'}
              </p>
              <form className="badges-guide__lookup" action={`/${locale}/badges`} method="get">
                <label>
                  <span>{ar ? 'تحقق من شهادة' : 'Verify a certificate'}</span>
                  <input
                    name="serial"
                    dir="ltr"
                    placeholder="AWD-2026-000001"
                    defaultValue={serialQuery ?? ''}
                    required
                  />
                </label>
                <button type="submit" className="button button--primary">
                  {ar ? 'تحقق' : 'Verify'}
                </button>
              </form>
              {serialQuery && !parsed ? (
                <p className="notice notice--error" role="alert">
                  {ar
                    ? 'صيغة الرقم غير صحيحة. اكتبه كما في الشهادة.'
                    : 'That serial is not in the right format.'}
                </p>
              ) : null}
            </article>
          </div>
        </div>
      </section>

      <section className="section badges-guide__levels-section" id="ranking">
        <div className="container">
          <div className="section-heading">
            <div>
              <span className="section-kicker">{ar ? 'الترتيب' : 'Ranking'}</span>
              <h2>{ar ? 'كيف نختار «الأفضل على BHD R»' : 'How we pick “The best on BHD R”'}</h2>
              <p>
                {ar
                  ? 'قوائم الصفحة الرئيسية تُحسب تلقائياً من بيانات آخر 12 شهراً وتتحدّث كل 30 دقيقة تقريباً، دون أي تدخّل يدوي.'
                  : 'The homepage lists are computed automatically from the last 12 months of data and refresh about every 30 minutes, with no manual picks.'}
              </p>
            </div>
          </div>
          <div className="badges-guide__rules">
            <article>
              <h3>{ar ? 'تقييم عادل لقلة التقييمات' : 'Fair to small numbers'}</h3>
              <p>
                {ar
                  ? 'لا يتصدّر أحد بتقييم واحد بخمس نجوم: يُوزن المتوسط مع عدد التقييمات، فيقترب من المتوسط العام حتى تتراكم تقييمات كافية.'
                  : 'A single five-star review cannot top the list: the average is weighted by how many ratings there are, staying near the overall mean until enough build up.'}
              </p>
            </article>
            <article>
              <h3>{ar ? 'أداء فعلي لا تقييم فقط' : 'Real performance, not only stars'}</h3>
              <ul>
                <li>
                  {ar
                    ? 'العقارات: تقييم الضيوف والإشغال وسرعة الصيانة.'
                    : 'Properties: guest ratings, occupancy and maintenance speed.'}
                </li>
                <li>
                  {ar
                    ? 'الشركاء: الإنجاز في الموعد والجودة والتكلفة.'
                    : 'Partners: on-time work, quality and cost.'}
                </li>
                <li>
                  {ar
                    ? 'الملاك والإدارات: تقييم مبانيهم والإشغال والتوثيق.'
                    : 'Owners and managers: their buildings’ ratings, occupancy and verification.'}
                </li>
                <li>
                  {ar
                    ? 'المستأجرون: السداد في الموعد وتقييم الملاك، ويُستبعد من عليه قضايا أو تأخر متكرر.'
                    : 'Tenants: on-time payment and hosts’ ratings; anyone with legal cases or repeated arrears is excluded.'}
                </li>
              </ul>
            </article>
            <article>
              <h3>{ar ? 'الشارات ترفع الترتيب قليلاً' : 'Badges give a small lift'}</h3>
              <p>
                {ar
                  ? 'الشارات والأوسمة النشطة تضيف حتى 5% للنتيجة، والحساب الموثّق يظهر بعلامته.'
                  : 'Active badges and medals add up to 5% to the score, and verified accounts show their tick.'}
              </p>
            </article>
            <article>
              <h3>{ar ? 'الخصوصية أولاً' : 'Privacy first'}</h3>
              <p>
                {ar
                  ? 'يظهر الأشخاص بالاسم الأول والحرف الأول فقط، ولا يظهر اسم المالك الفرد إلا إذا اختار إظهاره، ولا تظهر إلا العقارات المعروضة للعامة.'
                  : 'People appear by first name and initial only, an individual owner’s name shows only if they chose to show it, and only public listings appear.'}
              </p>
            </article>
          </div>
        </div>
      </section>

      <BadgeShowcaseSection showcase={showcase} locale={locale} guideLink={false} />

      <section className="section">
        <div className="container">
          <div className="section-heading">
            <div>
              <span className="section-kicker">{ar ? 'الدليل' : 'Catalogue'}</span>
              <h2>{ar ? 'الشارات الأساسية ومعاييرها' : 'Core badges and their criteria'}</h2>
              <p>
                {ar
                  ? 'هذه الشارات متاحة لكل مؤسسة، ويمكن لكل مؤسسة تعديل معاييرها أو إضافة شارات خاصة بها.'
                  : 'Every organization starts with these badges and can adjust their criteria or add its own.'}
              </p>
            </div>
          </div>
          {BADGE_SUBJECTS.map((subject) => {
            const list = DEFAULT_BADGES.filter((badge) => badge.subjectType === subject);
            if (!list.length) return null;
            return (
              <div key={subject} className="badges-guide__group">
                <h3>
                  {ar ? SUBJECT_LABELS[subject].arMany : `${SUBJECT_LABELS[subject].en} badges`}
                </h3>
                <div className="badges-guide__catalogue">
                  {list.map((badge) => (
                    <article key={badge.code} className="badges-guide__badge">
                      <BadgeEmblem
                        tier={badge.tier}
                        level={badge.level}
                        icon={badge.icon}
                        size={52}
                      />
                      <div>
                        <h4>{ar ? badge.nameAr : badge.nameEn}</h4>
                        <small className="muted">
                          {TIER_LABELS[badge.tier][lang]} · {LEVEL_LABELS[badge.level][lang]} ·{' '}
                          {GRANT_LABELS[badge.grantMode][lang]}
                        </small>
                        <p>{ar ? badge.descriptionAr : badge.descriptionEn}</p>
                        <ul>
                          {badge.criteria.map((criterion) => (
                            <li key={criterion.metric}>{describeCriterion(criterion, ar)}</li>
                          ))}
                        </ul>
                      </div>
                    </article>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      </section>

      <section className="section badges-guide__verified" id="verified">
        <div className="container">
          <div className="section-heading">
            <div>
              <span className="section-kicker">{ar ? 'التوثيق' : 'Verification'}</span>
              <h2>{ar ? 'الحساب الموثّق: العلامة الزرقاء' : 'Verified accounts: the blue tick'}</h2>
              <p>
                {ar
                  ? 'العلامة الزرقاء تعني أن فريق بن حمود طابق اسم صاحب الحساب مع مستند رسمي ساري. وهي مستقلة عن الشارات: الشارة تقيس الأداء، والتوثيق يؤكد الهوية.'
                  : 'The blue tick means the BHD team matched the account holder’s name with a valid official document. It is separate from badges: badges measure performance, verification confirms identity.'}
              </p>
            </div>
          </div>
          <div className="badges-guide__verified-grid">
            <article>
              <h3>{ar ? 'كيف يظهر على الشاشة' : 'How it appears'}</h3>
              <ul className="badges-guide__samples">
                <li>
                  <span className="name-with-mark">
                    <strong>{ar ? 'سالم الهنائي' : 'Salim Al Hinai'}</strong>
                    <VerifiedMark verified locale={locale} />
                  </span>
                  <small className="muted">{ar ? 'بجانب الاسم' : 'Beside the name'}</small>
                </li>
                <li>
                  <IdentityAvatar
                    name={ar ? 'سالم' : 'Salim'}
                    mark={{ verified: true, avatarUrl: null }}
                    locale={locale}
                    size={48}
                  />
                  <small className="muted">
                    {ar ? 'على زاوية الصورة الشخصية' : 'On the corner of the profile picture'}
                  </small>
                </li>
                <li>
                  <span className="name-with-mark">
                    <strong>{ar ? 'شركة الواحة للعقارات' : 'Al Waha Real Estate'}</strong>
                    <VerifiedMark verified locale={locale} business />
                  </span>
                  <small className="muted">
                    {ar ? 'منشأة موثّقة بسجلها التجاري' : 'A business verified by its registration'}
                  </small>
                </li>
                <li>
                  <span className="name-with-mark">
                    <strong>{ar ? 'سالم الهنائي' : 'Salim Al Hinai'}</strong>
                    <VerifiedMark verified locale={locale} />
                    <BadgeChips badges={SAMPLE_CHIPS.slice(0, 1)} locale={locale} linked={false} />
                  </span>
                  <small className="muted">
                    {ar ? 'حساب موثّق يحمل شارة' : 'A verified account holding a badge'}
                  </small>
                </li>
              </ul>
              <p className="muted">
                {ar
                  ? 'تظهر العلامة في دفتر العناوين وصفحة الطرف وصفحة الفريق وبطاقة المضيف في صفحات العقارات العامة.'
                  : 'The tick shows in the address book, party pages, the team page and the host card on public property pages.'}
              </p>
            </article>
            <article>
              <h3>{ar ? 'كيف يُفعّل' : 'How to activate it'}</h3>
              <ol className="badges-guide__steps">
                <li>
                  {ar
                    ? 'افتح «حسابي» واختر «ابدأ توثيق حسابي»، أو «توثيق المنشأة» لمنشأتك.'
                    : 'Open “My account” and choose “Verify my account”, or “Verify business” for your organization.'}
                </li>
                <li>
                  {ar
                    ? 'أرفق مستنداً رسمياً: البطاقة الشخصية أو جواز السفر أو بطاقة الإقامة للأفراد، والسجل التجاري للمنشآت، واكتب الاسم كما في المستند.'
                    : 'Attach an official document: civil ID, passport or residence card for people, commercial registration for businesses, and enter the name exactly as written.'}
                </li>
                <li>
                  {ar
                    ? 'اختر باقة التوثيق وسدّد رسومها. لا يطّلع على مستنداتك إلا فريق التوثيق المخوّل.'
                    : 'Choose a verification plan and settle its fee. Only the authorized verification team sees your documents.'}
                </li>
                <li>
                  {ar
                    ? 'يراجع الفريق الطلب ويطابق الاسم؛ عند الاعتماد تظهر العلامة فوراً حتى تاريخ انتهاء التوثيق، ويمكن تجديدها.'
                    : 'The team reviews the request and matches the name; once approved the tick appears at once until the verification expires, and can be renewed.'}
                </li>
              </ol>
              <p className="muted">
                {ar
                  ? 'إذا غيّرت اسم الحساب بحيث لم يعد يطابق المستند تختفي العلامة تلقائياً حتى يُعاد التوثيق.'
                  : 'If the account name is changed so it no longer matches the document, the tick disappears until verification is redone.'}
              </p>
              <a className="button button--gold" href={`/${locale}/account`}>
                {ar ? 'وثّق حسابي الآن' : 'Verify my account'}
              </a>
            </article>
          </div>
        </div>
      </section>

      <section className="section final-cta">
        <div className="container final-cta__inner">
          <div>
            <span className="section-kicker section-kicker--gold">BHD R</span>
            <h2>
              {ar
                ? 'ابحث عن عقار يحمل شارة تميّز'
                : 'Find a property that holds an excellence badge'}
            </h2>
          </div>
          <Link href="/properties" className="button button--gold">
            {ar ? 'العقارات المتاحة' : 'Available properties'}
            <span aria-hidden="true">←</span>
          </Link>
        </div>
      </section>
    </main>
  );
}
