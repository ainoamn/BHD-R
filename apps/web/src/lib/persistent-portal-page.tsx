import type { ReactNode } from 'react';
import { PortalPage } from '@/components/portal-page';

/** Keep the actual page tree in the shared shell across route transitions. */
export function persistentPortalPage<
  P extends { params: Promise<Record<string, string | string[]>> },
>(pattern: string, Page: (props: P) => ReactNode | Promise<ReactNode>) {
  return async function PersistentPage(props: P) {
    const params = await props.params;
    const path = pattern.replace(/\[([^\]]+)\]/g, (_, name: string) => {
      const value = params[name];
      return encodeURIComponent(String(value ?? ''));
    });
    return <PortalPage path={path}>{await Page(props)}</PortalPage>;
  };
}
