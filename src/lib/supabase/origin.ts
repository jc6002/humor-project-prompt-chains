function parseHttpOrigin(raw: string | undefined): string | null {
  const trimmed = raw?.trim();
  if (!trimmed) return null;
  try {
    const parsed = new URL(trimmed);
    if (parsed.protocol === 'http:' || parsed.protocol === 'https:') {
      return parsed.origin;
    }
  } catch {
    return null;
  }
  return null;
}

function normalizeHostOnly(raw: string | null | undefined): string {
  const trimmed = raw?.trim().toLowerCase() ?? '';
  if (!trimmed) return '';
  if (/[/?#@\\\s]/.test(trimmed)) return '';
  const withoutProto = trimmed.replace(/^https?:\/\//, '');
  try {
    const parsed = new URL(`http://${withoutProto}`);
    return parsed.host.toLowerCase();
  } catch {
    return '';
  }
}

function isLoopbackHostname(hostname: string): boolean {
  const clean = hostname.toLowerCase();
  return clean === 'localhost' || clean === '127.0.0.1' || clean === '[::1]' || clean === '::1';
}

// Resolves a safe origin without trusting spoofable forwarded headers.
export function resolveSafeOrigin(
  request: Request,
  env: Record<string, string | undefined> = process.env
): string {
  const explicitOrigin = parseHttpOrigin(env.NEXT_PUBLIC_SITE_URL);
  if (explicitOrigin) {
    return explicitOrigin;
  }

  const reqUrl = new URL(request.url);
  const reqHost = reqUrl.host.toLowerCase();
  const headerHost = normalizeHostOnly(request.headers.get('host'));

  const vercelCandidates = [
    normalizeHostOnly(env.VERCEL_PROJECT_PRODUCTION_URL),
    normalizeHostOnly(env.VERCEL_URL),
  ].filter(Boolean);

  for (const candidateHost of vercelCandidates) {
    if (candidateHost === reqHost || (headerHost && candidateHost === headerHost)) {
      const validated = parseHttpOrigin(`https://${candidateHost}`);
      if (validated) {
        return validated;
      }
    }
  }

  let canonicalHost = reqHost;
  let canonicalHostname = reqUrl.hostname.toLowerCase();

  if (headerHost) {
    const headerUrl = new URL(`http://${headerHost}`);
    if (
      isLoopbackHostname(canonicalHostname) &&
      isLoopbackHostname(headerUrl.hostname) &&
      headerUrl.port === reqUrl.port
    ) {
      canonicalHost = headerUrl.host.toLowerCase();
      canonicalHostname = headerUrl.hostname.toLowerCase();
    }
  }

  const safeScheme = isLoopbackHostname(canonicalHostname) ? 'http' : 'https';
  return parseHttpOrigin(`${safeScheme}://${canonicalHost}`) ?? reqUrl.origin;
}

export function resolveOptionalHttpUrl(raw: string | undefined): string | null {
  const trimmed = raw?.trim();
  if (!trimmed) return null;
  try {
    const parsed = new URL(trimmed);
    if (parsed.protocol === 'http:' || parsed.protocol === 'https:') {
      return parsed.toString();
    }
  } catch {
    return null;
  }
  return null;
}

export function resolveSafeNextPath(
  nextParam: string | null | undefined,
  origin: string,
  fallback = '/'
): string {
  if (typeof nextParam !== 'string') return fallback;
  const trimmed = nextParam.trim();
  if (
    !trimmed ||
    trimmed.length > 1024 ||
    !trimmed.startsWith('/') ||
    trimmed.startsWith('//') ||
    trimmed.includes('\\') ||
    /[\u0000-\u001f\u007f]/.test(trimmed)
  ) {
    return fallback;
  }

  try {
    const base = new URL(origin);
    const candidate = new URL(trimmed, base.origin);
    if (candidate.origin === base.origin) {
      return `${candidate.pathname}${candidate.search}${candidate.hash}`;
    }
  } catch {
    return fallback;
  }

  return fallback;
}
