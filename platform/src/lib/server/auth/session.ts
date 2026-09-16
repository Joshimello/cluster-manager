import { dev } from '$app/environment';
import { createHash, randomBytes } from 'node:crypto';
import { eq } from 'drizzle-orm';
import type { Cookies } from '@sveltejs/kit';

import { getDatabase } from '$lib/server/db';
import { sessions, users, type UserRole } from '$lib/server/db/schema';

export const sessionCookieName = 'cluster_manager_session';
export const sessionDurationMilliseconds = 7 * 24 * 60 * 60 * 1000;

export type AuthUser = Readonly<{
  id: string;
  username: string;
  displayName: string;
  role: UserRole;
  mustChangePassword: boolean;
}>;

export type AuthSession = Readonly<{
  id: string;
  expiresAt: Date;
}>;

export type SessionValidation = Readonly<{
  session: AuthSession;
  user: AuthUser;
}>;

export function hashSessionToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

export function generateSessionToken(): string {
  return randomBytes(32).toString('base64url');
}

export async function createSession(userId: string): Promise<{
  session: AuthSession;
  token: string;
}> {
  const token = generateSessionToken();
  const expiresAt = new Date(Date.now() + sessionDurationMilliseconds);

  const [session] = await getDatabase()
    .insert(sessions)
    .values({
      tokenHash: hashSessionToken(token),
      userId,
      expiresAt
    })
    .returning({ id: sessions.id, expiresAt: sessions.expiresAt });

  return { session, token };
}

export async function validateSessionToken(token: string): Promise<SessionValidation | null> {
  const database = getDatabase();
  const [result] = await database
    .select({
      sessionId: sessions.id,
      expiresAt: sessions.expiresAt,
      userId: users.id,
      username: users.username,
      displayName: users.displayName,
      role: users.role,
      status: users.status,
      mustChangePassword: users.mustChangePassword
    })
    .from(sessions)
    .innerJoin(users, eq(sessions.userId, users.id))
    .where(eq(sessions.tokenHash, hashSessionToken(token)))
    .limit(1);

  if (!result) {
    return null;
  }

  if (result.expiresAt.getTime() <= Date.now() || result.status !== 'active') {
    await database.delete(sessions).where(eq(sessions.id, result.sessionId));
    return null;
  }

  return {
    session: {
      id: result.sessionId,
      expiresAt: result.expiresAt
    },
    user: {
      id: result.userId,
      username: result.username,
      displayName: result.displayName,
      role: result.role,
      mustChangePassword: result.mustChangePassword
    }
  };
}

export async function invalidateSession(sessionId: string): Promise<void> {
  await getDatabase().delete(sessions).where(eq(sessions.id, sessionId));
}

export async function invalidateUserSessions(userId: string): Promise<void> {
  await getDatabase().delete(sessions).where(eq(sessions.userId, userId));
}

export function setSessionCookie(cookies: Cookies, token: string, expiresAt: Date): void {
  cookies.set(sessionCookieName, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: !dev,
    path: '/',
    expires: expiresAt
  });
}

export function deleteSessionCookie(cookies: Cookies): void {
  cookies.delete(sessionCookieName, {
    httpOnly: true,
    sameSite: 'lax',
    secure: !dev,
    path: '/'
  });
}
