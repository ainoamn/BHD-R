'use client';

import { useEffect } from 'react';
import { rememberStayTripAlert } from '@/lib/stay-trip-alerts';

/** Persist booking on confirmation so the header bell can show it immediately. */
export function RememberStayTripAlert({
  id,
  referenceCode,
  status,
  checkInOn,
  checkOutOn,
  currency,
  totalMinor,
}: {
  id: string;
  referenceCode: string;
  status: string;
  checkInOn?: string;
  checkOutOn?: string;
  currency?: string;
  totalMinor?: string;
}) {
  useEffect(() => {
    rememberStayTripAlert({
      id,
      referenceCode,
      status,
      checkInOn: checkInOn ?? '',
      checkOutOn: checkOutOn ?? '',
      ...(currency ? { currency } : {}),
      ...(totalMinor ? { totalMinor } : {}),
    });
  }, [id, referenceCode, status, checkInOn, checkOutOn, currency, totalMinor]);

  return null;
}
