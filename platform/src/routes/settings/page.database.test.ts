import { randomUUID } from 'node:crypto';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { describe, expect, it, vi } from 'vitest';
import * as schema from '$lib/server/db/schema';

describe.skipIf(process.env.RUN_DATABASE_TESTS !== 'true')('profile settings authorization', () => {
  it('changes only the session user display name, validates names, refreshes profile data, and keeps time-zone settings independent', async () => {
    const client = postgres(process.env.DATABASE_URL!, { prepare: false });
    const database = drizzle(client, { schema });
    const prefix = `profile-${randomUUID().slice(0, 8)}`;
    const made =
      await client`insert into users(username,display_name,posix_uid,posix_gid,password_hash,must_change_password,time_zone)
      select name,'Original',nextval('user_posix_identity_sequence')::integer,currval('user_posix_identity_sequence')::integer,'original-hash',false,'Asia/Taipei'
      from unnest(array[${prefix},${prefix + '-other'}]) name returning *`;
    vi.resetModules();
    vi.doMock('$lib/server/db', () => ({ getDatabase: () => database }));
    try {
      const { actions, load } = await import('./+page.server');
      const own = made[0],
        other = made[1];
      const sessionUser = {
        id: own.id,
        username: own.username,
        displayName: own.display_name,
        role: 'user' as const,
        posixUid: own.posix_uid,
        posixGid: own.posix_gid,
        mustChangePassword: false,
        timeZone: 'Asia/Taipei'
      };
      const locals = { user: sessionUser };
      const event = (values: Record<string, string>, user: unknown = locals.user) => ({
        locals: { user },
        request: new Request('http://localhost/settings', {
          method: 'POST',
          body: new URLSearchParams(values)
        })
      });
      const save = actions.displayName!;
      await expect(
        save(event({ displayName: 'Someone' }, null) as Parameters<typeof save>[0])
      ).rejects.toMatchObject({ location: '/login' });
      await expect(
        save(
          event(
            { displayName: 'Someone' },
            { ...sessionUser, mustChangePassword: true }
          ) as Parameters<typeof save>[0]
        )
      ).rejects.toMatchObject({ location: '/change-password' });
      for (const displayName of ['   ', 'x'.repeat(121)])
        expect(await save(event({ displayName }) as Parameters<typeof save>[0])).toMatchObject({
          status: 400,
          data: { action: 'displayName' }
        });
      const request = event({
        displayName: '  Researcher   One  ',
        userId: other.id,
        username: 'newname',
        role: 'admin',
        timeZone: 'UTC'
      });
      expect(await save(request as Parameters<typeof save>[0])).toMatchObject({
        success: true,
        action: 'displayName',
        displayName: 'Researcher One'
      });
      expect(
        (await load({ locals: request.locals } as Parameters<typeof load>[0]))!.user.displayName
      ).toBe('Researcher One');
      const [after] = await client`select * from users where id=${own.id}`;
      const immutable = (row: Record<string, unknown>) =>
        Object.fromEntries(
          Object.entries(row).filter(([key]) => key !== 'display_name' && key !== 'updated_at')
        );
      const rest = immutable(after),
        before = immutable(own);
      expect(rest).toEqual(before);
      expect(
        (await client`select display_name from users where id=${other.id}`)[0].display_name
      ).toBe('Original');
      // Duplicate display names are allowed, including for administrators.
      expect(
        await save(
          event(
            { displayName: 'Researcher One' },
            { ...sessionUser, id: other.id, role: 'admin' }
          ) as Parameters<typeof save>[0]
        )
      ).toMatchObject({ success: true });
      const zone = actions.timeZone!;
      expect(await zone(event({ timeZone: 'UTC' }) as Parameters<typeof zone>[0])).toMatchObject({
        success: true,
        action: 'timeZone'
      });
      expect(
        await zone(event({ timeZone: 'invalid' }) as Parameters<typeof zone>[0])
      ).toMatchObject({ status: 400, data: { action: 'timeZone' } });
      expect(
        (await client`select display_name,time_zone from users where id=${own.id}`)[0]
      ).toEqual({ display_name: 'Researcher One', time_zone: 'UTC' });
      expect(
        (
          await client`select actor_user_id,target_id from audit_events where action='user.display_name_changed' and actor_user_id=${own.id}`
        )[0]
      ).toEqual({ actor_user_id: own.id, target_id: own.id });
    } finally {
      await client`delete from audit_events where actor_user_id in (${made[0].id},${made[1].id})`;
      await client`delete from users where id in (${made[0].id},${made[1].id})`;
      vi.doUnmock('$lib/server/db');
      await client.end();
    }
  });
});
