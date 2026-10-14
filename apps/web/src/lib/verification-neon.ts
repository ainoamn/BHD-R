import 'server-only';
import { sql } from 'drizzle-orm';
import type { SessionClaims } from '@bhd-r/authz';
import { elevatedTx, isoOf, rowsOf, type ElevatedTx } from '@/lib/elevated-db';
import { appLink, queueBrandedEmail } from '@/lib/email-notify';
import { sendQueuedEmailsSoon } from '@/lib/email-outbox';
import { formatMoney } from '@/lib/format';
import { avatarUrl, verifiedOrganizations, verifiedUsers } from '@/lib/identity-marks-neon';
import { compactDocument, decodeDataUrl } from '@/lib/image-compact';
import { managesOrganization } from '@/lib/profile-image-neon';
import { decimalToMinor } from '@/lib/property-contracts-neon';
import { hasAdminScope } from '@/lib/site-admin-neon';
import {
  BUSINESS_DOCUMENTS,
  DOCUMENT_MAX_CHARS,
  NAME_MATCH_THRESHOLD,
  PERSONAL_DOCUMENTS,
  RENEWAL_WINDOW_DAYS,
  bestNameMatch,
  periodEnd,
  verificationSerial,
  type AccountVerificationState,
  type DocumentSlot,
  type ReviewQueueItem,
  type VerificationDocumentType,
  type VerificationKind,
  type VerificationPeriod,
  type VerificationPlan,
  type VerificationRecord,
} from '@/lib/verification-shared';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DAY_MS = 86_400_000;
const QUEUE_LIMIT = 200;

function fail(code: string): never {
  throw new Error(code);
}

type RecordRow = {
  id: string;
  serial_year: number;
  serial_no: number;
  kind: VerificationKind;
  period: VerificationPeriod;
  organization_id: string | null;
  organization_name: string | null;
  fee_minor: string;
  currency: string;
  legal_name_ar: string | null;
  legal_name_en: string | null;
  document_type: VerificationDocumentType;
  document_last4: string | null;
  document_expires_on: Date | string | null;
  name_match_score: number;
  status: VerificationRecord['status'];
  payment_status: VerificationRecord['paymentStatus'];
  paid_at: Date | string | null;
  payment_method: string | null;
  payment_reference: string | null;
  review_note: string | null;
  reviewed_at: Date | string | null;
  verified_from: Date | string | null;
  verified_until: Date | string | null;
  created_at: Date | string;
  slots: string[] | null;
  renewal_of: string | null;
};

const RECORD_COLUMNS = sql`v.id::text, v.serial_year, v.serial_no, v.kind, v.period,
  v.organization_id::text, o.display_name_ar as organization_name, v.fee_minor::text, v.currency,
  v.legal_name_ar, v.legal_name_en, v.document_type, v.document_last4, v.document_expires_on,
  v.name_match_score, v.status, v.payment_status, v.paid_at, v.payment_method, v.payment_reference,
  v.review_note, v.reviewed_at, v.verified_from, v.verified_until, v.created_at, v.renewal_of::text,
  (select array_agg(d.slot order by d.slot) from verification_documents d
    where d.verification_id = v.id) as slots`;

function day(value: Date | string | null): string | null {
  if (!value) return null;
  return value instanceof Date ? value.toISOString().slice(0, 10) : String(value).slice(0, 10);
}

function recordView(row: RecordRow): VerificationRecord {
  return {
    id: row.id,
    serial: verificationSerial(Number(row.serial_year), Number(row.serial_no)),
    kind: row.kind,
    period: row.period,
    organizationId: row.organization_id,
    organizationName: row.organization_name,
    feeMinor: row.fee_minor,
    currency: row.currency,
    legalNameAr: row.legal_name_ar,
    legalNameEn: row.legal_name_en,
    documentType: row.document_type,
    documentLast4: row.document_last4,
    documentExpiresOn: day(row.document_expires_on),
    nameMatchScore: Number(row.name_match_score),
    status: row.status,
    paymentStatus: row.payment_status,
    paidAt: isoOf(row.paid_at),
    paymentMethod: row.payment_method,
    paymentReference: row.payment_reference,
    reviewNote: row.review_note,
    reviewedAt: isoOf(row.reviewed_at),
    verifiedFrom: isoOf(row.verified_from),
    verifiedUntil: isoOf(row.verified_until),
    createdAt: isoOf(row.created_at) ?? new Date().toISOString(),
    slots: (row.slots ?? []) as DocumentSlot[],
    renewalOf: row.renewal_of,
  };
}

async function loadPlans(tx: ElevatedTx, activeOnly: boolean): Promise<VerificationPlan[]> {
  return rowsOf<{
    id: string;
    kind: VerificationKind;
    period: VerificationPeriod;
    price_minor: string;
    currency: string;
    status: string;
  }>(
    await tx.execute(sql`
      select id::text, kind, period, price_minor::text, currency, status::text as status
      from verification_plans
      ${activeOnly ? sql`where status = 'active'` : sql``}
      order by kind, period
    `),
  ).map((row) => ({
    id: row.id,
    kind: row.kind,
    period: row.period,
    priceMinor: row.price_minor,
    currency: row.currency,
    active: row.status === 'active',
  }));
}

async function accountNames(
  tx: ElevatedTx,
  kind: VerificationKind,
  userId: string,
  organizationId: string | null,
): Promise<string[]> {
  if (kind === 'personal') {
    const [user] = rowsOf<{ display_name: string }>(
      await tx.execute(sql`select display_name from users where id = ${userId}`),
    );
    return user ? [user.display_name] : [];
  }
  const [org] = rowsOf<{ display_name_ar: string; display_name_en: string; legal_name: string }>(
    await tx.execute(sql`select display_name_ar, display_name_en, legal_name from organizations
      where id = ${organizationId}`),
  );
  return org ? [org.display_name_ar, org.display_name_en, org.legal_name] : [];
}

async function nextSerial(tx: ElevatedTx, year: number): Promise<number> {
  await tx.execute(sql`select pg_advisory_xact_lock(hashtext('verification_serial'))`);
  const [row] = rowsOf<{ n: number }>(
    await tx.execute(sql`select coalesce(max(serial_no), 0)::int as n from account_verifications
      where serial_year = ${year}`),
  );
  return Number(row?.n ?? 0) + 1;
}

export async function loadAccountState(claims: SessionClaims): Promise<AccountVerificationState> {
  return elevatedTx(async (tx) => {
    const [user] = rowsOf<{ display_name: string; v: string | null }>(
      await tx.execute(sql`
        select u.display_name,
          (select extract(epoch from p.updated_at)::bigint::text from profile_images p
            where p.subject_type = 'user' and p.subject_id = u.id) as v
        from users u where u.id = ${claims.sub}
      `),
    );
    if (!user) fail('unauthorized');
    const personal = await verifiedUsers(tx, [claims.sub]);
    const [approved] = rowsOf<{ verified_until: Date | string }>(
      await tx.execute(sql`select verified_until from account_verifications
        where user_id = ${claims.sub} and kind = 'personal' and status = 'approved'
          and verified_from <= now() and verified_until > now()
        order by verified_until desc limit 1`),
    );
    const orgs = rowsOf<{ id: string; name: string; manager: boolean; v: string | null }>(
      await tx.execute(sql`
        select o.id::text, o.display_name_ar as name,
          bool_or(m.role_key in ('organization_owner', 'organization_admin')) as manager,
          (select extract(epoch from p.updated_at)::bigint::text from profile_images p
            where p.subject_type = 'organization' and p.subject_id = o.id) as v
        from memberships m join organizations o on o.id = m.organization_id
        where m.user_id = ${claims.sub} and m.status = 'active' and o.status = 'active'
        group by o.id
        order by o.display_name_ar
      `),
    );
    const verifiedOrgs = await verifiedOrganizations(
      tx,
      orgs.map((org) => org.id),
    );
    const history = rowsOf<RecordRow>(
      await tx.execute(sql`
        select ${RECORD_COLUMNS}
        from account_verifications v left join organizations o on o.id = v.organization_id
        where v.user_id = ${claims.sub}
        order by v.created_at desc
        limit 30
      `),
    ).map(recordView);
    return {
      userId: claims.sub,
      displayName: user.display_name,
      avatarUrl: user.v ? avatarUrl('user', claims.sub, user.v) : null,
      personal: {
        verified: personal.has(claims.sub),
        until: personal.get(claims.sub) ?? null,
        nameDrift: !!approved && !personal.has(claims.sub),
      },
      organizations: orgs
        .filter((org) => org.manager)
        .map((org) => ({
          id: org.id,
          name: org.name,
          canManage: org.manager,
          logoUrl: org.v ? avatarUrl('organization', org.id, org.v) : null,
          verified: verifiedOrgs.has(org.id),
          until: verifiedOrgs.get(org.id) ?? null,
        })),
      plans: await loadPlans(tx, true),
      history,
    };
  });
}

export type SubmitVerification = {
  kind: VerificationKind;
  organizationId: string | null;
  period: VerificationPeriod;
  legalNameAr: string | null;
  legalNameEn: string | null;
  documentType: VerificationDocumentType;
  documentLast4: string | null;
  documentExpiresOn: string | null;
  documents: Partial<Record<DocumentSlot, string>>;
};

function requiredSlots(type: VerificationDocumentType): DocumentSlot[] {
  if (type === 'commercial_registration') return ['registration'];
  if (type === 'passport') return ['front', 'selfie'];
  return ['front', 'back', 'selfie'];
}

export async function submitVerification(
  claims: SessionClaims,
  input: SubmitVerification,
): Promise<{ id: string; serial: string }> {
  const business = input.kind === 'business';
  const allowed: readonly string[] = business ? BUSINESS_DOCUMENTS : PERSONAL_DOCUMENTS;
  if (!allowed.includes(input.documentType)) fail('verification_invalid');
  if (business !== !!input.organizationId) fail('verification_invalid');
  if (input.organizationId && !UUID.test(input.organizationId)) fail('verification_invalid');
  if (!input.legalNameAr?.trim() && !input.legalNameEn?.trim()) fail('verification_invalid');
  if (input.documentLast4 && !/^[0-9A-Za-z]{2,4}$/.test(input.documentLast4))
    fail('verification_invalid');
  if (input.documentExpiresOn) {
    const expires = Date.parse(`${input.documentExpiresOn}T23:59:59Z`);
    if (!Number.isFinite(expires) || expires < Date.now()) fail('verification_invalid');
  }
  const slots = requiredSlots(input.documentType);
  if (slots.some((slot) => !input.documents[slot])) fail('verification_document_required');
  const stored: { slot: DocumentSlot; dataUrl: string; mime: string }[] = [];
  for (const [slot, value] of Object.entries(input.documents) as [DocumentSlot, string][]) {
    if (!value) continue;
    const compact = await compactDocument(value, DOCUMENT_MAX_CHARS, slot === 'registration');
    stored.push({ slot, ...compact });
  }

  return elevatedTx(async (tx) => {
    if (business && !(await managesOrganization(tx, claims.sub, input.organizationId!)))
      fail('forbidden');
    const names = await accountNames(tx, input.kind, claims.sub, input.organizationId);
    const score = bestNameMatch([input.legalNameAr, input.legalNameEn], names);
    if (score < NAME_MATCH_THRESHOLD) fail('verification_name_mismatch');
    const open = rowsOf<{ id: string }>(
      await tx.execute(sql`select id::text from account_verifications
        where user_id = ${claims.sub} and kind = ${input.kind} and status = 'submitted'
          and organization_id is not distinct from ${input.organizationId}::uuid limit 1`),
    );
    if (open.length) fail('verification_open');
    const plan = (await loadPlans(tx, true)).find(
      (item) => item.kind === input.kind && item.period === input.period,
    );
    const fee = plan ? BigInt(plan.priceMinor) : 0n;
    const year = new Date().getUTCFullYear();
    const serial = await nextSerial(tx, year);
    const [row] = rowsOf<{ id: string }>(
      await tx.execute(sql`
        insert into account_verifications (
          serial_year, serial_no, user_id, organization_id, kind, period, fee_minor, currency,
          legal_name_ar, legal_name_en, document_type, document_last4, document_expires_on,
          name_match_score, payment_status
        ) values (
          ${year}, ${serial}, ${claims.sub}, ${input.organizationId}, ${input.kind}, ${input.period},
          ${fee.toString()}, ${plan?.currency ?? 'OMR'}, ${input.legalNameAr?.trim() || null},
          ${input.legalNameEn?.trim() || null}, ${input.documentType},
          ${input.documentLast4?.toUpperCase() || null}, ${input.documentExpiresOn},
          ${score}, ${fee > 0n ? 'unpaid' : 'waived'}
        )
        returning id::text
      `),
    );
    for (const document of stored) {
      await tx.execute(sql`
        insert into verification_documents (verification_id, slot, mime_type, data_url)
        values (${row!.id}, ${document.slot}, ${document.mime}, ${document.dataUrl})
      `);
    }
    await queueVerificationEmail(tx, row!.id, 'submitted');
    return { id: row!.id, serial: verificationSerial(year, serial) };
  }, 15_000);
}

/** Another period on the documents already approved, while they are still valid. */
export async function renewVerification(
  claims: SessionClaims,
  verificationId: string,
  period: VerificationPeriod,
): Promise<{ id: string; serial: string }> {
  if (!UUID.test(verificationId)) fail('not_found');
  return elevatedTx(async (tx) => {
    const [previous] = rowsOf<{
      kind: VerificationKind;
      organization_id: string | null;
      legal_name_ar: string | null;
      legal_name_en: string | null;
      document_type: VerificationDocumentType;
      document_last4: string | null;
      document_expires_on: Date | string | null;
      verified_until: Date | string | null;
      status: string;
    }>(
      await tx.execute(sql`select kind, organization_id::text, legal_name_ar, legal_name_en,
          document_type, document_last4, document_expires_on, verified_until, status
        from account_verifications where id = ${verificationId} and user_id = ${claims.sub}`),
    );
    if (!previous || previous.status !== 'approved' || !previous.verified_until)
      fail('verification_renewal_closed');
    const until = new Date(previous.verified_until).getTime();
    if (until - Date.now() > RENEWAL_WINDOW_DAYS * DAY_MS) fail('verification_renewal_closed');
    if (previous.document_expires_on) {
      const expires = Date.parse(`${day(previous.document_expires_on)}T23:59:59Z`);
      if (expires < Date.now() + DAY_MS) fail('verification_renewal_closed');
    }
    if (
      previous.kind === 'business' &&
      !(await managesOrganization(tx, claims.sub, previous.organization_id!))
    )
      fail('forbidden');
    const names = await accountNames(tx, previous.kind, claims.sub, previous.organization_id);
    const score = bestNameMatch([previous.legal_name_ar, previous.legal_name_en], names);
    if (score < NAME_MATCH_THRESHOLD) fail('verification_name_mismatch');
    const open = rowsOf<{ id: string }>(
      await tx.execute(sql`select id::text from account_verifications
        where user_id = ${claims.sub} and kind = ${previous.kind} and status = 'submitted'
          and organization_id is not distinct from ${previous.organization_id}::uuid limit 1`),
    );
    if (open.length) fail('verification_open');
    const plan = (await loadPlans(tx, true)).find(
      (item) => item.kind === previous.kind && item.period === period,
    );
    const fee = plan ? BigInt(plan.priceMinor) : 0n;
    const year = new Date().getUTCFullYear();
    const serial = await nextSerial(tx, year);
    const [row] = rowsOf<{ id: string }>(
      await tx.execute(sql`
        insert into account_verifications (
          serial_year, serial_no, user_id, organization_id, kind, period, fee_minor, currency,
          legal_name_ar, legal_name_en, document_type, document_last4, document_expires_on,
          name_match_score, payment_status, renewal_of
        ) values (
          ${year}, ${serial}, ${claims.sub}, ${previous.organization_id}, ${previous.kind},
          ${period}, ${fee.toString()}, ${plan?.currency ?? 'OMR'}, ${previous.legal_name_ar},
          ${previous.legal_name_en}, ${previous.document_type}, ${previous.document_last4},
          ${day(previous.document_expires_on)}, ${score}, ${fee > 0n ? 'unpaid' : 'waived'},
          ${verificationId}
        )
        returning id::text
      `),
    );
    await tx.execute(sql`
      insert into verification_documents (verification_id, slot, mime_type, data_url)
      select ${row!.id}, slot, mime_type, data_url from verification_documents
      where verification_id = ${verificationId}
    `);
    return { id: row!.id, serial: verificationSerial(year, serial) };
  }, 15_000);
}

export async function cancelVerification(
  claims: SessionClaims,
  verificationId: string,
): Promise<{ ok: true }> {
  if (!UUID.test(verificationId)) fail('not_found');
  return elevatedTx(async (tx) => {
    const done = rowsOf<{ id: string }>(
      await tx.execute(sql`update account_verifications
        set status = 'cancelled', updated_at = now()
        where id = ${verificationId} and user_id = ${claims.sub} and status = 'submitted'
        returning id::text`),
    );
    if (!done.length) fail('verification_not_open');
    return { ok: true as const };
  });
}

async function requireSiteAdmin(claims: SessionClaims) {
  if (!(await hasAdminScope(claims, 'verification').catch(() => false))) fail('forbidden');
}

export async function loadReviewQueue(
  claims: SessionClaims,
): Promise<{ items: ReviewQueueItem[]; plans: VerificationPlan[] }> {
  await requireSiteAdmin(claims);
  return elevatedTx(async (tx) => {
    const rows = rowsOf<
      RecordRow & {
        user_id: string;
        account_name: string;
        account_email: string;
      }
    >(
      await tx.execute(sql`
        select ${RECORD_COLUMNS}, v.user_id::text, u.display_name as account_name,
          u.email as account_email
        from account_verifications v join users u on u.id = v.user_id
          left join organizations o on o.id = v.organization_id
        where v.status = 'submitted' or v.updated_at > now() - interval '120 days'
        order by v.status = 'submitted' desc, v.created_at desc
        limit ${QUEUE_LIMIT}
      `),
    );
    return {
      items: rows.map((row) => ({
        ...recordView(row),
        userId: row.user_id,
        accountName: row.account_name,
        accountEmail: row.account_email,
        subjectName:
          row.kind === 'business' ? (row.organization_name ?? row.account_name) : row.account_name,
      })),
      plans: await loadPlans(tx, false),
    };
  }, 12_000);
}

export async function recordVerificationPayment(
  claims: SessionClaims,
  verificationId: string,
  input: { waive: boolean; method: string | null; reference: string | null },
): Promise<{ ok: true }> {
  await requireSiteAdmin(claims);
  if (!UUID.test(verificationId)) fail('not_found');
  if (!input.waive && !input.method) fail('verification_invalid');
  return elevatedTx(async (tx) => {
    const done = rowsOf<{ id: string }>(
      await tx.execute(sql`
        update account_verifications set
          payment_status = ${input.waive ? 'waived' : 'paid'},
          paid_at = ${input.waive ? sql`null` : sql`now()`},
          payment_method = ${input.waive ? null : input.method},
          payment_reference = ${input.reference?.trim() || null},
          payment_recorded_by_user_id = ${claims.sub}, updated_at = now()
        where id = ${verificationId} and status = 'submitted' and payment_status = 'unpaid'
        returning id::text
      `),
    );
    if (!done.length) fail('verification_not_open');
    if (!input.waive) await queueVerificationEmail(tx, verificationId, 'paid');
    return { ok: true as const };
  });
}

export async function decideVerification(
  claims: SessionClaims,
  verificationId: string,
  input: { action: 'approve' | 'reject'; note: string | null; nameConfirmed: boolean },
): Promise<{ status: 'approved' | 'rejected'; verifiedUntil: string | null }> {
  await requireSiteAdmin(claims);
  if (!UUID.test(verificationId)) fail('not_found');
  return elevatedTx(async (tx) => {
    const [row] = rowsOf<{
      status: string;
      payment_status: string;
      period: VerificationPeriod;
      renewal_of: string | null;
      previous_until: Date | string | null;
    }>(
      await tx.execute(sql`
        select v.status, v.payment_status, v.period, v.renewal_of::text,
          (select p.verified_until from account_verifications p
            where p.id = v.renewal_of and p.status = 'approved') as previous_until
        from account_verifications v where v.id = ${verificationId}
        for update of v
      `),
    );
    if (!row || row.status !== 'submitted') fail('verification_not_open');
    if (input.action === 'reject') {
      if (!input.note?.trim()) fail('verification_invalid');
      await tx.execute(sql`
        update account_verifications set status = 'rejected', review_note = ${input.note.trim()},
          reviewed_by_user_id = ${claims.sub}, reviewed_at = now(), updated_at = now()
        where id = ${verificationId}
      `);
      await queueVerificationEmail(tx, verificationId, 'rejected');
      return { status: 'rejected' as const, verifiedUntil: null };
    }
    if (row.payment_status === 'unpaid') fail('verification_unpaid');
    if (!input.nameConfirmed) fail('verification_invalid');
    const previousUntil = row.previous_until ? new Date(row.previous_until) : null;
    const from = previousUntil && previousUntil.getTime() > Date.now() ? previousUntil : new Date();
    const until = periodEnd(from, row.period);
    await tx.execute(sql`
      update account_verifications set status = 'approved',
        review_note = ${input.note?.trim() || null}, reviewed_by_user_id = ${claims.sub},
        reviewed_at = now(), verified_from = ${from.toISOString()}::timestamptz,
        verified_until = ${until.toISOString()}::timestamptz, updated_at = now()
      where id = ${verificationId}
    `);
    await queueVerificationEmail(tx, verificationId, 'approved');
    return { status: 'approved' as const, verifiedUntil: until.toISOString() };
  });
}

type VerificationNotice = 'submitted' | 'paid' | 'approved' | 'rejected';

/** Keeps the account holder posted on their verification, in the same transaction as the step. */
async function queueVerificationEmail(
  tx: ElevatedTx,
  verificationId: string,
  notice: VerificationNotice,
): Promise<void> {
  try {
    await tx.transaction((savepoint) => writeVerificationEmail(savepoint, verificationId, notice));
    sendQueuedEmailsSoon();
  } catch (error) {
    console.error('verification email not queued', error instanceof Error ? error.message : '');
  }
}

async function writeVerificationEmail(
  tx: ElevatedTx,
  verificationId: string,
  notice: VerificationNotice,
): Promise<void> {
  const [row] = rowsOf<{
    email: string;
    name: string;
    serial_year: number;
    serial_no: number;
    kind: VerificationKind;
    fee_minor: string;
    currency: string;
    payment_status: string;
    review_note: string | null;
    verified_until: Date | string | null;
  }>(
    await tx.execute(sql`select u.email, u.display_name as name, v.serial_year, v.serial_no, v.kind,
        v.fee_minor::text, v.currency, v.payment_status, v.review_note, v.verified_until
      from account_verifications v join users u on u.id = v.user_id
      where v.id = ${verificationId}::uuid`),
  );
  if (!row) return;
  const serial = verificationSerial(Number(row.serial_year), Number(row.serial_no));
  const kind = row.kind === 'business' ? 'توثيق المنشأة' : 'توثيق الحساب';
  const fee =
    row.payment_status === 'unpaid' && row.fee_minor !== '0'
      ? formatMoney(row.fee_minor, row.currency, 'ar')
      : null;
  const content = {
    submitted: {
      subject: `🛡️ استلمنا طلب ${kind} ${serial}`,
      title: 'طلب التوثيق في الطريق الصحيح',
      intro: 'وصلتنا مستنداتك، وسيراجعها فريق المنصة قريباً.',
      lines: fee
        ? [`رسوم التوثيق ${fee}؛ تبدأ المراجعة النهائية بعد تسجيل السداد.`]
        : ['لا رسوم مطلوبة على هذا الطلب.'],
    },
    paid: {
      subject: `💳 سُجّل سداد رسوم ${kind} ${serial}`,
      title: 'استلمنا رسوم التوثيق',
      intro: 'سُجّل سداد رسوم طلب التوثيق، وطلبك الآن في مرحلة المراجعة النهائية.',
      lines: [],
    },
    approved: {
      subject: `✅ تم ${kind} — شارة التوثيق صارت لك`,
      title: 'مبروك! حسابك موثّق رسمياً',
      intro: 'اعتمد فريق المنصة طلب التوثيق، وتظهر علامة التوثيق الآن بجانب اسمك.',
      lines: row.verified_until
        ? [
            `يبقى التوثيق سارياً حتى ${new Date(row.verified_until).toISOString().slice(0, 10).split('-').reverse().join('/')}.`,
          ]
        : [],
    },
    rejected: {
      subject: `عن طلب ${kind} ${serial}`,
      title: 'طلب التوثيق يحتاج تعديلاً بسيطاً',
      intro: 'راجع فريق المنصة طلبك ولم يتمكن من اعتماده هذه المرة.',
      lines: row.review_note
        ? [`ملاحظة المراجع: «${row.review_note}»`, 'صحّح ما يلزم وأعد التقديم، فنحن بانتظارك.']
        : [],
    },
  }[notice];
  await queueBrandedEmail(tx, {
    orgId: null,
    recipient: row.email,
    recipientName: row.name,
    aggregateType: 'account_verification',
    aggregateId: verificationId,
    tone: notice === 'approved' ? 'reward' : notice === 'rejected' ? 'alert' : 'general',
    ...content,
    details: [
      { label: 'رقم الطلب', value: serial },
      { label: 'النوع', value: kind },
      ...(fee && notice === 'submitted' ? [{ label: 'الرسوم', value: fee }] : []),
    ],
    cta: { label: 'فتح حسابي', url: appLink('/ar/account') },
  });
}

export async function readVerificationDocument(
  claims: SessionClaims,
  verificationId: string,
  slot: DocumentSlot,
): Promise<{ mime: string; bytes: Buffer } | null> {
  if (!UUID.test(verificationId)) return null;
  return elevatedTx(async (tx) => {
    const [row] = rowsOf<{ data_url: string; user_id: string }>(
      await tx.execute(sql`
        select d.data_url, v.user_id::text from verification_documents d
          join account_verifications v on v.id = d.verification_id
        where d.verification_id = ${verificationId} and d.slot = ${slot}
      `),
    );
    if (!row) return null;
    if (
      row.user_id !== claims.sub &&
      !(await hasAdminScope(claims, 'verification').catch(() => false))
    )
      fail('forbidden');
    return decodeDataUrl(row.data_url);
  });
}

export async function saveVerificationPlan(
  claims: SessionClaims,
  input: { kind: VerificationKind; period: VerificationPeriod; price: string; active: boolean },
): Promise<{ ok: true }> {
  await requireSiteAdmin(claims);
  const minor = decimalToMinor(input.price || '0', 'OMR');
  return elevatedTx(async (tx) => {
    await tx.execute(sql`
      insert into verification_plans (kind, period, price_minor, currency, status, updated_by_user_id)
      values (${input.kind}, ${input.period}, ${minor.toString()}, 'OMR',
        ${input.active ? 'active' : 'inactive'}::lifecycle_status, ${claims.sub})
      on conflict (kind, period) do update set
        price_minor = excluded.price_minor, status = excluded.status,
        updated_by_user_id = excluded.updated_by_user_id, updated_at = now()
    `);
    return { ok: true as const };
  });
}
