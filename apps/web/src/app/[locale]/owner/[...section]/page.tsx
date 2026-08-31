'use client';

import { use } from 'react';
import { useLocale } from 'next-intl';
import { OperationsWorkspaceClient } from '@/components/operations-workspace-client';
import { isOperationsSection } from '@/lib/portal-ops-types';

export default function Page({ params }: { params: Promise<{ section: string[] }> }) {
  const { section } = use(params);
  const locale = useLocale() === 'en' ? 'en' : 'ar';
  const current = section[0] ?? '';

  if (!isOperationsSection(current)) {
    return (
      <div className="ops-empty">
        <strong>404</strong>
      </div>
    );
  }

  return (
    <OperationsWorkspaceClient key={current} portal="owner" section={current} locale={locale} />
  );
}
