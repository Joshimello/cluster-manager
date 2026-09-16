import type { AuthSession, AuthUser } from '$lib/server/auth/session';

declare global {
  namespace App {
    interface Locals {
      session: AuthSession | null;
      user: AuthUser | null;
    }
  }
}

export {};
