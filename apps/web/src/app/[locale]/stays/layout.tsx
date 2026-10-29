import { notFound } from 'next/navigation';
import type { ReactNode } from 'react';
import { isStaysPublicSurfaceEnabled } from '@/lib/stays-flags';

/**
 * Gate public stays before `loading.tsx` paints a 200 skeleton.
 * When the platform flag is off, `/[locale]/stays` must 404 (phase-0 contract).
 */
export default function PublicStaysLayout({ children }: { children: ReactNode }) {
  if (!isStaysPublicSurfaceEnabled()) notFound();
  return children;
}
