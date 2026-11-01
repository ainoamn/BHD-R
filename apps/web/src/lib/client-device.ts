import 'server-only';

export type DeviceKind = 'phone' | 'tablet' | 'desktop' | 'unknown';

export type ClientDeviceGeo = {
  deviceKind: DeviceKind;
  deviceLabel: string | null;
  region: string | null;
  city: string | null;
};

/** Coarse device class + short label from a User-Agent (no full UA stored). */
export function parseDeviceFromUserAgent(ua: string | null | undefined): {
  kind: DeviceKind;
  label: string | null;
} {
  const raw = ua?.trim() ?? '';
  if (!raw) return { kind: 'unknown', label: null };
  const lower = raw.toLowerCase();
  let kind: DeviceKind = 'desktop';
  if (/ipad|tablet|kindle|silk|playbook/.test(lower)) kind = 'tablet';
  else if (/mobi|iphone|ipod|android.*mobile|windows phone|opera mini/.test(lower)) kind = 'phone';
  else if (/android/.test(lower) && !/mobile/.test(lower)) kind = 'tablet';

  let browser = 'Browser';
  if (/edg\//.test(lower)) browser = 'Edge';
  else if (/chrome\//.test(lower) && !/edg\//.test(lower)) browser = 'Chrome';
  else if (/safari\//.test(lower) && !/chrome\//.test(lower)) browser = 'Safari';
  else if (/firefox\//.test(lower)) browser = 'Firefox';

  let os = 'Unknown OS';
  if (/windows nt/.test(lower)) os = 'Windows';
  else if (/mac os x|macintosh/.test(lower)) os = 'macOS';
  else if (/iphone|ipod/.test(lower)) os = 'iOS';
  else if (/ipad/.test(lower)) os = 'iPadOS';
  else if (/android/.test(lower)) os = 'Android';
  else if (/linux/.test(lower)) os = 'Linux';

  return { kind, label: `${os} · ${browser}`.slice(0, 120) };
}

function header(request: Request, names: string[]): string | null {
  for (const name of names) {
    const value = request.headers.get(name)?.trim();
    if (value && value.toLowerCase() !== 'unknown' && value !== 'XX') return value.slice(0, 120);
  }
  return null;
}

/** Region/city from edge headers when the host provides them (Vercel / Cloudflare). */
export function geoFromRequest(request: Request): { region: string | null; city: string | null } {
  return {
    region: header(request, [
      'x-vercel-ip-country-region',
      'cf-region',
      'cf-region-code',
      'cloudfront-viewer-country-region',
    ]),
    city: header(request, ['x-vercel-ip-city', 'cf-ipcity', 'cloudfront-viewer-city']),
  };
}

export function deviceGeoFromRequest(request: Request): ClientDeviceGeo {
  const ua = request.headers.get('user-agent');
  const device = parseDeviceFromUserAgent(ua);
  const geo = geoFromRequest(request);
  return {
    deviceKind: device.kind,
    deviceLabel: device.label,
    region: geo.region,
    city: geo.city,
  };
}
