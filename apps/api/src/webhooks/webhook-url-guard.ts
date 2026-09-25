import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import { AppException } from '../common/errors/app-exception';

/**
 * Webhook endpoint URLs are the first user-supplied URL this codebase ever
 * fetches (docs/10 previously said "no user-supplied URLs are fetched
 * anywhere"; docs/18, ADR 0015 records why that changes here). This is the
 * replacement control: https only, and never a private, loopback,
 * link-local, multicast or cloud-metadata address — checked both when an
 * endpoint is registered and again at delivery time, since DNS can rebind
 * between the two.
 */

/** `URL#hostname` keeps the brackets around a literal IPv6 address (WHATWG); `isIP` needs them stripped. */
function unbracketed(hostname: string): string {
  return hostname.startsWith('[') && hostname.endsWith(']') ? hostname.slice(1, -1) : hostname;
}

function refuse(): never {
  throw new AppException(
    'WEBHOOK_URL_NOT_ALLOWED',
    'The URL must be https and resolve to a public address.',
  );
}

function ipv4Blocked(octets: number[]): boolean {
  const [a, b] = octets;
  if (a === undefined || b === undefined) return true;
  if (a === 0) return true; // "this network"
  if (a === 10) return true; // RFC1918
  if (a === 127) return true; // loopback
  if (a === 100 && b >= 64 && b <= 127) return true; // CGNAT, RFC6598
  if (a === 169 && b === 254) return true; // link-local, includes the cloud metadata address
  if (a === 172 && b >= 16 && b <= 31) return true; // RFC1918
  if (a === 192 && b === 0) return true; // IETF protocol assignments / TEST-NET-1 range
  if (a === 192 && b === 168) return true; // RFC1918
  if (a === 198 && (b === 18 || b === 19)) return true; // benchmarking
  if (a >= 224) return true; // multicast (224-239) and reserved (240-255)
  return false;
}

/** `ip` is a literal address (v4, v6, or v6 with an embedded v4). */
function isBlockedAddress(ip: string): boolean {
  const version = isIP(ip);
  if (version === 4) {
    return ipv4Blocked(ip.split('.').map(Number));
  }
  if (version === 6) {
    const lower = ip.toLowerCase();
    if (lower === '::1' || lower === '::') return true; // loopback, unspecified
    const firstHextet = Number.parseInt(lower.split(':')[0] || '0', 16);
    if (firstHextet >= 0xfe80 && firstHextet <= 0xfebf) return true; // link-local
    if ((firstHextet & 0xfe00) === 0xfc00) return true; // unique local (fc00::/7)
    if (lower.startsWith('ff')) return true; // multicast
    const embedded = /^::ffff:(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$/.exec(lower);
    if (embedded?.[1]) return ipv4Blocked(embedded[1].split('.').map(Number));
    return false;
  }
  // Not a literal IP: a bare hostname reached this function only through a
  // resolved address, so an unparseable value here is refused, not skipped.
  return true;
}

export interface WebhookUrlCheckOptions {
  /**
   * Skips the https-only and public-address checks. Callers pass
   * `config.WEBHOOK_ALLOW_INSECURE_LOCAL_URLS` (env.schema.ts), which is
   * refused outside test use and false by default even there — only the
   * webhook-delivery e2e suite turns it on, to run a real local HTTP
   * receiver, the same way object storage tests run a real local MinIO over
   * plain http (`test/test-env.ts`'s `S3_ENDPOINT`) rather than a mock.
   */
  allowInsecureLocal?: boolean;
}

/** Synchronous checks: scheme and any literal-IP host written directly in the URL. */
export function assertWebhookUrlShape(rawUrl: string, options: WebhookUrlCheckOptions = {}): URL {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    return refuse();
  }
  if (options.allowInsecureLocal) return url;
  if (url.protocol !== 'https:') refuse();
  const hostname = unbracketed(url.hostname.toLowerCase());
  if (hostname === 'localhost' || hostname.endsWith('.localhost')) refuse();
  if (isIP(hostname) && isBlockedAddress(hostname)) refuse();
  return url;
}

/**
 * Full check: shape, then every address the hostname resolves to. Call this
 * at registration time and again immediately before each delivery attempt
 * (DNS can rebind in between).
 */
export async function assertWebhookUrlIsSafe(
  rawUrl: string,
  options: WebhookUrlCheckOptions = {},
): Promise<void> {
  const url = assertWebhookUrlShape(rawUrl, options);
  if (options.allowInsecureLocal) return;
  const hostname = unbracketed(url.hostname);
  if (isIP(hostname)) return; // already checked by assertWebhookUrlShape

  let addresses: { address: string }[];
  try {
    addresses = await lookup(hostname, { all: true });
  } catch {
    return refuse();
  }
  if (addresses.length === 0 || addresses.some((a) => isBlockedAddress(a.address))) {
    refuse();
  }
}
