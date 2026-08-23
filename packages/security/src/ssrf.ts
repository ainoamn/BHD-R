import { isIP } from 'node:net';

export type ResolveHost = (hostname: string) => Promise<readonly string[]>;

function isPrivateIp(address: string): boolean {
  const normalized = address.toLowerCase();
  if (normalized === '::1' || normalized === '::') return true;
  if (normalized.startsWith('::ffff:')) return isPrivateIp(normalized.slice(7));
  if (normalized.includes(':')) {
    return (
      normalized.startsWith('fc') ||
      normalized.startsWith('fd') ||
      /^(?:fe[89ab])/.test(normalized) ||
      normalized.startsWith('ff') ||
      normalized.startsWith('2001:db8:')
    );
  }
  const octets = normalized.split('.').map(Number);
  if (
    octets.length !== 4 ||
    octets.some((part) => !Number.isInteger(part) || part < 0 || part > 255)
  )
    return true;
  const [a = -1, b = -1, c = -1] = octets;
  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 0 && c === 0) ||
    (a === 192 && b === 0 && c === 2) ||
    (a === 192 && b === 168) ||
    (a === 198 && (b === 18 || b === 19)) ||
    (a === 198 && b === 51 && c === 100) ||
    (a === 203 && b === 0 && c === 113) ||
    a >= 224
  );
}

export interface SafeOutboundTarget {
  url: URL;
  resolvedAddresses: readonly string[];
}

export async function assertSafeOutboundUrl(
  rawUrl: string,
  resolveHost: ResolveHost,
  allowedHosts: readonly string[] = [],
): Promise<SafeOutboundTarget> {
  const url = new URL(rawUrl);
  if (url.protocol !== 'https:' || url.username || url.password || url.port) {
    throw new Error('Payment endpoint must be HTTPS without credentials or a custom port');
  }
  const hostname = url.hostname.toLowerCase();
  if (
    hostname === 'localhost' ||
    ['.localhost', '.local', '.internal', '.home.arpa'].some((suffix) => hostname.endsWith(suffix))
  ) {
    throw new Error('Local endpoints are forbidden');
  }
  if (
    allowedHosts.length > 0 &&
    !allowedHosts.map((host) => host.toLowerCase()).includes(hostname)
  ) {
    throw new Error('Payment endpoint host is not allow-listed');
  }
  const addresses = isIP(hostname) ? [hostname] : [...(await resolveHost(hostname))];
  if (addresses.length === 0 || addresses.some(isPrivateIp))
    throw new Error('Private or unresolved endpoint is forbidden');
  return { url, resolvedAddresses: addresses };
}
