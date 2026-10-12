/** Desktop sidebar preference; read by the portal shell so the first paint matches. */
export const PORTAL_NAV_COOKIE = 'bhd_r_nav';

export function persistPortalNavCollapsed(collapsed: boolean): void {
  document.cookie = collapsed
    ? `${PORTAL_NAV_COOKIE}=collapsed; Path=/; Max-Age=31536000; SameSite=Lax`
    : `${PORTAL_NAV_COOKIE}=; Path=/; Max-Age=0; SameSite=Lax`;
}
