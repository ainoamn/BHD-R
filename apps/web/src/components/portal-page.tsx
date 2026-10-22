'use client';

import { createContext, useContext, useLayoutEffect, type ReactNode } from 'react';

export const PortalPageContext = createContext<((path: string, content: ReactNode) => void) | null>(
  null,
);

/**
 * Paint the live RSC tree for the active route, and mirror it into the portal
 * keep-alive cache for soft-nav back. Returning null here blanks the main area
 * until setState lands — and LiveSync refresh remounts caused visible flicker.
 */
export function PortalPage({ path, children }: { path: string; children: ReactNode }) {
  const register = useContext(PortalPageContext);
  useLayoutEffect(() => {
    register?.(path, children);
  }, [register, path, children]);
  return children;
}
