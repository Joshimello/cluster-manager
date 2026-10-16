import { expect, it } from 'vitest';
import { authDestination } from './destination';
import { allowLoginAttempt } from '../security/login-rate-limit';
it('continues only to a provider interaction after login/password changes', () => {
  expect(authDestination('/oidc/interaction/abc_DEF-123')).toBe('/oidc/interaction/abc_DEF-123');
  for (const value of [
    null,
    'https://evil.test',
    '//evil.test',
    '/oidc/interaction/../auth',
    '/oidc/interaction/a?next=//evil.test',
    '/dashboard'
  ])
    expect(authDestination(value)).toBe('/dashboard');
});
it('limits password attempts and allows recovery after the window', () => {
  for (let i = 0; i < 10; i++) expect(allowLoginAttempt('fixture', 'test', 1000)).toBe(true);
  expect(allowLoginAttempt('fixture', 'test', 1001)).toBe(false);
  expect(allowLoginAttempt('fixture', 'test', 61001)).toBe(true);
  expect(allowLoginAttempt('other', 'test', 1001)).toBe(true);
});
