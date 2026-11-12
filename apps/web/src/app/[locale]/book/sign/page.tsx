import type { Metadata } from 'next';
import { notFound, redirect } from 'next/navigation';
import { setRequestLocale } from 'next-intl/server';
import { ContractArticle, type ContractArticleLinks } from '@/components/contract-document-view';
import { ContractDocumentToolbar } from '@/components/contract-document-toolbar';
import { LeaseInviteAccountGate } from '@/components/lease-invite-account-gate';
import { StayEsignWizard } from '@/components/stays/stay-esign-wizard';
import { hasDatabaseUrl } from '@/lib/bhd/identity-session';
import { formatMoney } from '@/lib/format';
import { leaseBookingAgreement, leaseContractTitle } from '@/lib/lease-booking-contract';
import { leaseConfirmedPath, leaseSignPath } from '@/lib/lease-booking-paths';
import { resolveOwnerInviteAccountGate } from '@/lib/lease-invite-account-gate';
import { readClaims } from '@/lib/portal-ops-data';
import { ActiveAccountChip } from '@/components/active-account-chip';
import {
  leaseInviteeIdentitySubject,
  leasePaymentPath,
  leaseReservationIdForStaff,
  loadLeaseBookingAgreement,
  loadLeaseBookingForStaff,
  loadLeaseBookingForViewer,
} from '@/lib/public-lease-booking-neon';
import { getViewer } from '@/lib/viewer';
import { Link } from '@/i18n/navigation';
import { stripAuFromReturnPath } from '@/lib/bhd/oauth';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Sign contract | توقيع العقد',
  robots: { index: false, follow: false, nocache: true },
  referrer: 'no-referrer',
};

const AGREEMENT_ID = 'reservation-agreement';

export default async function LeaseBookingSignPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { locale: raw } = await params;
  const locale = raw === 'en' ? 'en' : 'ar';
  setRequestLocale(locale);
  const ar = locale === 'ar';
  const query = await searchParams;
  const refRaw = query.ref;
  const referenceCode =
    typeof refRaw === 'string' ? refRaw : Array.isArray(refRaw) ? refRaw[0] : undefined;
  if (!referenceCode || !hasDatabaseUrl()) notFound();

  const viewer = await getViewer();
  if (!viewer) {
    redirect(`/${locale}/login?next=${encodeURIComponent(leaseSignPath(locale, referenceCode))}`);
  }

  const viewOnly =
    query.view === '1' || (Array.isArray(query.view) ? query.view[0] === '1' : false);

  /** True when the signed-in user is the invitee/booker — not landlord staff peeking. */
  let asTenantActor = true;
  let booking = await loadLeaseBookingAgreement(viewer.id, referenceCode).catch(() => null);
  if (!booking) {
    // Agreement enrichment can fail while the booking itself is fine — recover via the
    // lighter viewer load, then org staff (same pattern as /book/receipt).
    const lite = await loadLeaseBookingForViewer(viewer.id, referenceCode).catch(() => null);
    if (lite) {
      if (!lite.depositPaidAt) {
        if (lite.status === 'pending') {
          redirect(leasePaymentPath(locale, lite.sessionReference, lite.referenceCode));
        }
        notFound();
      }
      redirect(leaseConfirmedPath(locale, lite.referenceCode));
    }
    const claims = await readClaims();
    const reservationId = claims
      ? await leaseReservationIdForStaff(claims, referenceCode).catch(() => null)
      : null;
    booking =
      reservationId && claims
        ? await loadLeaseBookingForStaff(claims, reservationId).catch(() => null)
        : null;
    if (!booking) notFound();
    asTenantActor = false;
  }
  if (!booking.depositPaidAt) {
    if (booking.status === 'pending') {
      redirect(leasePaymentPath(locale, booking.sessionReference, booking.referenceCode));
    }
    notFound();
  }

  // Gate by email (not only staff fallback) — cookie may be invitee while ?au= is still owner.
  const inviteeEmail =
    (booking.bookedByEmail || booking.contact?.email || '').trim().toLowerCase();
  const viewerEmail = (viewer.email || '').trim().toLowerCase();
  const inviteMismatch =
    !viewOnly &&
    booking.inviteSource === 'owner_invite' &&
    Boolean(inviteeEmail) &&
    viewerEmail !== inviteeEmail;

  if (inviteMismatch) {
    const inviteeAu = await leaseInviteeIdentitySubject(booking.bookedByUserId);
    const signBase = stripAuFromReturnPath(leaseSignPath(locale, booking.referenceCode));
    const paymentPath = inviteeAu
      ? `${signBase}${signBase.includes('?') ? '&' : '?'}au=${encodeURIComponent(inviteeAu)}`
      : signBase;
    const inviteGate = await resolveOwnerInviteAccountGate({
      locale,
      paymentPath,
      inviteeEmail,
      viewerEmail: viewer.email,
    });
    if (inviteGate && !inviteGate.matched) {
      return (
        <main className="stay-esign-shell">
          <div className="stay-esign-shell__account">
            <ActiveAccountChip viewer={viewer} locale={locale} compact />
          </div>
          <div className="panel" style={{ maxWidth: 520, margin: '2rem auto', padding: '1.5rem' }}>
            <h1 style={{ fontSize: '1.25rem', marginBottom: '0.75rem' }}>
              {ar ? 'التوقيع بحساب الدعوة' : 'Sign with the invite account'}
            </h1>
            <p className="muted" style={{ marginBottom: '1rem' }}>
              {ar
                ? 'أنت الآن على حساب آخر. بدّل إلى حساب المستأجر لإتمام التوقيع — المستندات المحفوظة لا تُفقد.'
                : 'You are on a different account. Switch to the tenant account to finish signing — saved documents are kept.'}
            </p>
            <LeaseInviteAccountGate
              locale={ar ? 'ar' : 'en'}
              purpose="sign"
              inviteeEmail={inviteGate.inviteeEmail}
              continueHref={inviteGate.continueHref}
              paymentPath={inviteGate.paymentPath}
              rosterHasInvitee={inviteGate.rosterHasInvitee}
              {...(inviteGate.inviteeSub ? { inviteeSub: inviteGate.inviteeSub } : {})}
              {...(booking.contact?.fullName
                ? { inviteeName: booking.contact.fullName }
                : {})}
              {...(viewer.email ? { currentEmail: viewer.email } : {})}
              {...(viewer.displayName || viewer.username
                ? { currentName: viewer.displayName?.trim() || viewer.username?.trim() || null }
                : {})}
            />
            <p style={{ marginTop: '1rem' }}>
              <Link
                className="button button--quiet"
                href={`/book/sign?ref=${encodeURIComponent(booking.referenceCode)}&view=1`}
              >
                {ar ? 'عرض المستند فقط' : 'View document only'}
              </Link>
            </p>
          </div>
        </main>
      );
    }
  }

  // Invitee session but wrong ?au= (owner id left in the URL) — pin the payer identity.
  if (
    !viewOnly &&
    booking.inviteSource === 'owner_invite' &&
    viewerEmail &&
    inviteeEmail &&
    viewerEmail === inviteeEmail
  ) {
    const inviteeAu = await leaseInviteeIdentitySubject(booking.bookedByUserId);
    const auRaw = query.au;
    const au =
      typeof auRaw === 'string' ? auRaw.trim() : Array.isArray(auRaw) ? auRaw[0]?.trim() : '';
    if (inviteeAu && au !== inviteeAu) {
      redirect(
        `/${locale}/book/sign?ref=${encodeURIComponent(booking.referenceCode)}&au=${encodeURIComponent(inviteeAu)}`,
      );
    }
  }

  // Staff may inspect the agreement, but must not run the tenant e-sign submit path.
  if (!asTenantActor && !viewOnly) {
    redirect(
      `/${locale}/book/sign?ref=${encodeURIComponent(booking.referenceCode)}&view=1`,
    );
  }

  const { head, doc } = leaseBookingAgreement(booking);
  const title = leaseContractTitle(booking.mode);
  const signature = booking.signature;
  // After the booking agreement is signed, the journey lives on /book/confirmed.
  if (signature && !viewOnly) {
    redirect(leaseConfirmedPath(locale, booking.referenceCode));
  }
  const links: ContractArticleLinks = {
    file: () => signature?.png ?? '',
    contract: () => leaseSignPath(locale, booking.referenceCode),
    annex: () => leaseSignPath(locale, booking.referenceCode),
  };
  const property = ar ? booking.propertyNameAr : booking.propertyNameEn;
  const unit = ar ? booking.unitNameAr : booking.unitNameEn;
  const deposit = formatMoney(booking.depositMinor, booking.currency, locale);

  const article = (
    <ContractArticle id={AGREEMENT_ID} contract={head} doc={doc} locale={locale} links={links} />
  );

  const approved = Boolean(booking.lifecycle.approvedAt);
  const contractWord = booking.mode === 'sale' ? 'عقد البيع' : 'عقد الإيجار';
  const statusText = !approved
    ? null
    : booking.lifecycle.tenantSignedAt
      ? ar
        ? `حجزك معتمد، و${contractWord} موقّع إلكترونياً من الطرفين.`
        : 'Your booking is approved and the contract is signed by both parties.'
      : booking.lifecycle.contract
        ? ar
          ? `حجزك معتمد، و${contractWord} جاهز وينتظر توقيعك.`
          : 'Your booking is approved and the contract awaits your signature.'
        : booking.lifecycle.approvedAutomatically
          ? ar
            ? `حجزك معتمد إلكترونياً من النظام وفي انتظار قيام المالك بعمل ${contractWord}.`
            : 'Your booking was approved electronically and awaits the owner’s contract.'
          : ar
            ? `حجزك معتمد من المالك وفي انتظار قيام المالك بعمل ${contractWord}.`
            : 'Your booking is approved and waiting for the owner to prepare the contract.';

  return (
    <main className="stay-esign-shell">
      <div className="stay-esign-shell__account">
        <ActiveAccountChip viewer={viewer} locale={locale} compact />
      </div>
      {statusText ? (
        <div className="lease-approved-banner" role="status">
          <span aria-hidden="true">✅</span>
          <p>{statusText}</p>
          <Link href={`/book/confirmed?ref=${encodeURIComponent(booking.referenceCode)}`}>
            {ar ? 'تابع مراحل حجزك' : 'Follow your booking'}
          </Link>
        </div>
      ) : null}
      <StayEsignWizard
        locale={locale}
        referenceCode={booking.referenceCode}
        contractDocument={
          signature ? (
            <>
              <ContractDocumentToolbar
                ar={ar}
                documentId={AGREEMENT_ID}
                title={ar ? title.ar : title.en}
                reference={booking.referenceCode}
                summary={`${booking.contact.fullName} · ${property} (${unit}) · ${deposit}`}
                recipient={null}
                recipientPath={null}
                pdfUrl={null}
                printOnly
              />
              {article}
            </>
          ) : (
            article
          )
        }
        signatureSerial={signature?.serial ?? null}
        initiallyComplete={Boolean(signature)}
        submitUrl={`/api/public/bookings/deposits/${encodeURIComponent(booking.referenceCode)}/esign`}
        continuePath={leaseConfirmedPath(locale, booking.referenceCode)}
        contractTitle={title}
        requireCsrf
        expectedAccountEmail={inviteeEmail || null}
        docsReturn={
          booking.lifecycle.bookingDocsReturn
            ? {
                note: booking.lifecycle.bookingDocsReturn.note,
                rejected: booking.lifecycle.bookingDocsReturn.rejected ?? [],
                locked: booking.lifecycle.bookingDocsReturn.locked ?? [],
                replaced: booking.lifecycle.bookingDocsReturn.replaced ?? [],
                stagedEsign: booking.lifecycle.bookingDocsReturn.stagedEsign ?? [],
                filesBase: `/api/public/bookings/deposits/${encodeURIComponent(booking.referenceCode)}/files`,
              }
            : null
        }
      />
    </main>
  );
}
