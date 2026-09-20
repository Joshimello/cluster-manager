import { randomUUID } from 'node:crypto';
import postgres from 'postgres';
import { describe, expect, it } from 'vitest';

import type { AuthUser } from '$lib/server/auth/session';

import { GET } from './+server';

const runDatabaseTests = process.env.RUN_DATABASE_TESTS === 'true';

function requestEvent(user: AuthUser | null, url: URL) {
  return { locals: { user, session: null }, url } as never;
}

describe.skipIf(!runDatabaseTests)('monitoring history endpoint authorization', () => {
  it('requires authentication', async () => {
    const response = await GET(
      requestEvent(null, new URL('http://localhost/api/monitoring/history'))
    );
    expect(response.status).toBe(401);
  });

  it('limits users to actively assigned workstations while allowing administrators', async () => {
    const databaseUrl = process.env.DATABASE_URL;
    if (!databaseUrl) throw new Error('DATABASE_URL is required');

    const client = postgres(databaseUrl, { max: 1, prepare: false });
    const suffix = randomUUID().replaceAll('-', '').slice(0, 12);
    let userId: string | undefined;
    const workstationIds: string[] = [];

    try {
      const [identity] = await client`
        select nextval('user_posix_identity_sequence')::integer as posix_id
      `;
      const [createdUser] = await client`
        insert into users (
          username, display_name, posix_uid, posix_gid,
          password_hash, must_change_password
        ) values (
          ${`history-${suffix}`}, 'History endpoint test',
          ${identity.posix_id}, ${identity.posix_id}, 'test-only-hash', false
        ) returning id
      `;
      userId = createdUser.id as string;

      for (const number of [1, 2]) {
        const [workstation] = await client`
          insert into workstations (name, display_name)
          values (${`history-${number}-${suffix}`}, ${`History workstation ${number}`})
          returning id
        `;
        workstationIds.push(workstation.id as string);
      }
      await client`
        insert into workstation_assignments (user_id, workstation_id)
        values (${userId}, ${workstationIds[0]})
      `;

      const user: AuthUser = {
        id: userId,
        username: `history-${suffix}`,
        displayName: 'History endpoint test',
        role: 'user',
        posixUid: identity.posix_id as number,
        posixGid: identity.posix_id as number,
        mustChangePassword: false,
        timeZone: 'UTC'
      };
      const assigned = await GET(
        requestEvent(
          user,
          new URL(`http://localhost/api/monitoring/history?workstationId=${workstationIds[0]}`)
        )
      );
      expect(assigned.status).toBe(200);
      expect((await assigned.json()).workstations).toHaveLength(1);

      const unassigned = await GET(
        requestEvent(
          user,
          new URL(`http://localhost/api/monitoring/history?workstationId=${workstationIds[1]}`)
        )
      );
      expect(unassigned.status).toBe(404);

      const administrator = await GET(
        requestEvent(
          { ...user, role: 'admin' },
          new URL(`http://localhost/api/monitoring/history?workstationId=${workstationIds[1]}`)
        )
      );
      expect(administrator.status).toBe(200);
    } finally {
      if (userId) await client`delete from users where id = ${userId}`;
      if (workstationIds.length > 0) {
        await client`delete from workstations where id = any(${workstationIds})`;
      }
      await client.end();
    }
  });
});
