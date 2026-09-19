const protectedMethods = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);
const formContentTypes = new Set([
  'application/x-www-form-urlencoded',
  'multipart/form-data',
  'text/plain',
  'application/x-sveltekit-formdata'
]);

export function parseTrustedOrigins(value: string | undefined): ReadonlySet<string> {
  const origins = new Set<string>();
  if (!value?.trim()) return origins;

  for (const entry of value.split(',')) {
    const candidate = entry.trim();
    if (!candidate || candidate === '*') {
      throw new Error('CSRF_TRUSTED_ORIGINS must contain explicit origins without wildcards');
    }

    const url = new URL(candidate);
    if (
      (url.protocol !== 'http:' && url.protocol !== 'https:') ||
      url.username ||
      url.password ||
      url.pathname !== '/' ||
      url.search ||
      url.hash
    ) {
      throw new Error(
        'CSRF_TRUSTED_ORIGINS entries must contain only scheme, host, and optional port'
      );
    }
    origins.add(url.origin);
  }

  return origins;
}

export function isAllowedFormSubmission(
  request: Request,
  serverOrigin: string,
  trustedOrigins: ReadonlySet<string>
): boolean {
  if (!protectedMethods.has(request.method.toUpperCase())) return true;

  const contentType = request.headers.get('content-type')?.split(';', 1)[0]?.trim().toLowerCase();
  if (!contentType || !formContentTypes.has(contentType)) return true;

  const requestOrigin = request.headers.get('origin');
  return (
    requestOrigin === serverOrigin || (requestOrigin !== null && trustedOrigins.has(requestOrigin))
  );
}
