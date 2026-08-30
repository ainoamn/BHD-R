/** Prefer same-origin relative media paths so Next/Image optimizer accepts them. */
export function toPublicMediaSrc(url: string | null | undefined): string | null {
  if (!url) return null;
  if (url.startsWith('/api/public/media/') || url.startsWith('/api/owner/media/')) return url;
  try {
    const parsed = new URL(url, 'https://r.bhd-om.com');
    if (
      parsed.pathname.startsWith('/api/public/media/') ||
      parsed.pathname.startsWith('/api/owner/media/')
    ) {
      return parsed.pathname;
    }
  } catch {
    /* keep absolute external URLs (S3/CDN) */
  }
  return url;
}
