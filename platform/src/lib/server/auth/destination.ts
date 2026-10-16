export function authDestination(value: string | null): string {
  return value && /^\/oidc\/interaction\/[A-Za-z0-9_-]+$/.test(value) ? value : '/dashboard';
}
