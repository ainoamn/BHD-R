import { Link } from '@/i18n/navigation';
import {
  rentDocHref,
  rentDocKindsOf,
  type RentDocSubject,
} from '@/lib/rent-documents';

/** Pill links to the signed receipt and/or demand invoice for one rent line. */
export function RentDocLinks({
  portal,
  leaseId,
  subject,
  ar,
  lineKey,
  paidMinor,
  outstandingMinor,
}: {
  portal: 'tenant' | 'owner';
  leaseId: string;
  ar: boolean;
  subject?: Pick<RentDocSubject, 'key' | 'paidMinor' | 'outstandingMinor'> | undefined;
  lineKey?: string;
  paidMinor?: string;
  outstandingMinor?: string;
}) {
  const key = subject?.key ?? lineKey;
  if (!key || !leaseId) return null;
  const kinds = rentDocKindsOf(
    subject ?? {
      paidMinor: paidMinor ?? '0',
      outstandingMinor: outstandingMinor ?? '0',
    },
  );
  if (!kinds.length) return null;
  return (
    <span className="tenant-statement__docs">
      {kinds.map((kind) => (
        <Link
          key={kind}
          className={`tenant-doc-link tenant-doc-link--${kind}`}
          href={rentDocHref(portal, leaseId, key, kind)}
          prefetch={false}
        >
          {kind === 'receipt'
            ? ar
              ? 'إيصال القبض'
              : 'Receipt'
            : ar
              ? 'الفاتورة'
              : 'Invoice'}
        </Link>
      ))}
    </span>
  );
}

/** Amount still open on a line (never negative). */
export function outstandingMinorOf(amountMinor: string, paidMinor: string): string {
  try {
    const left = BigInt(amountMinor || '0') - BigInt(paidMinor || '0');
    return left > 0n ? left.toString() : '0';
  } catch {
    return '0';
  }
}
