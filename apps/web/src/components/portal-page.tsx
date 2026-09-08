'use client';

import { createContext, useContext, useLayoutEffect, type ReactNode } from 'react';

export const PortalPageContext = createContext<((path: string, content: ReactNode) => void) | null>(
  null,
);

/** Register page content, not Next's live LayoutRouter children. */
export function PortalPage({ path, children }: { path: string; children: ReactNode }) {
  const register = useContext(PortalPageContext);
  useLayoutEffect(() => {
    register?.(path, children);
  }, [register, path, children]);
  return register ? null : children;
}
