import { describe, expect, it } from 'vitest';
import type { Redirect } from '@sveltejs/kit';

import type { AuthUser } from './session';
import { requireAdmin, requireReadyUser, requireUser } from './guards';

function locals(user: AuthUser | null): App.Locals {
  return { session: null, user };
}

const normalUser: AuthUser = {
  id: '3d23eb0a-4fdf-436d-a1ab-ad446f94871b',
  username: 'alice',
  displayName: 'Alice',
  role: 'user',
  mustChangePassword: false
};

describe('authentication guards', () => {
  it('redirects anonymous requests to login', () => {
    expect(() => requireUser(locals(null))).toThrowError(
      expect.objectContaining<Partial<Redirect>>({ status: 303, location: '/login' })
    );
  });

  it('allows authenticated users through the basic guard', () => {
    expect(requireUser(locals(normalUser))).toBe(normalUser);
  });

  it('requires temporary credentials to be changed', () => {
    expect(() =>
      requireReadyUser(locals({ ...normalUser, mustChangePassword: true }))
    ).toThrowError(
      expect.objectContaining<Partial<Redirect>>({ status: 303, location: '/change-password' })
    );
  });

  it('redirects normal users away from administration', () => {
    expect(() => requireAdmin(locals(normalUser))).toThrowError(
      expect.objectContaining<Partial<Redirect>>({ status: 303, location: '/dashboard' })
    );
  });

  it('allows ready administrators', () => {
    const admin = { ...normalUser, role: 'admin' as const };
    expect(requireAdmin(locals(admin))).toBe(admin);
  });
});
