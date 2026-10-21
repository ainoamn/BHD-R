import { PlatformAdminNav } from '@/components/platform/platform-admin-nav';

/** Shared chrome (secondary tabs) around platform admin sections. */
export function PlatformAdminFrame({
  locale,
  children,
}: {
  locale: 'ar' | 'en';
  children: React.ReactNode;
}) {
  return (
    <div className="platform-admin">
      <PlatformAdminNav locale={locale} />
      <div className="platform-admin__body">{children}</div>
    </div>
  );
}
