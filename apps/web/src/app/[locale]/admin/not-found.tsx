import { SiteAdminUnavailable } from '@/components/site-admin/site-admin-unavailable';

/** Segment not-found for /admin — never reuse the public catalogue 404 copy. */
export default function SiteAdminNotFound() {
  return <SiteAdminUnavailable locale="ar" />;
}
