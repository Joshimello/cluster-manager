import postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import { describe, expect, it, vi } from 'vitest';
import * as schema from '$lib/server/db/schema';

describe.skipIf(process.env.RUN_ACCOUNT_SIMULATOR_TESTS !== 'true')(
  'live simulated-node account lifecycle',
  () => {
    it('imports, synchronizes a password, removes the account, and retains its platform identity', async () => {
      const url = new URL(process.env.DATABASE_URL!);
      if (!['localhost', '127.0.0.1', '::1', '[::1]'].includes(url.hostname))
        throw new Error('Simulator smoke test requires an isolated local database');
      const client = postgres(url.toString(), { prepare: false });
      const database = drizzle(client, { schema });
      vi.resetModules();
      vi.doMock('$lib/server/db', () => ({ getDatabase: () => database }));
      try {
        const [actor] =
          await client`select id from users where role='admin' and status='active' and deleted_at is null limit 1`;
        const [ws] =
          await client`select * from workstations where name=${process.env.ACCOUNT_SIMULATOR_WORKSTATION ?? 'account-simulator'}`;
        if (!actor || ws?.inventory?.operatingSystem !== 'Simulated Linux 1.0')
          throw new Error('Requires a running account simulator and a fixture administrator');
        const candidate = ws.account_snapshot?.accounts.find(
          (a: { username: string; ownerWorkstationId: string }) =>
            a.username === 'migration-test' && !a.ownerWorkstationId
        );
        if (!candidate)
          throw new Error('Requires the fresh, unimported migration-test simulator fixture');
        const service = await import('./accounts');
        const imported = await service.importAccount(
          {
            actorId: actor.id,
            workstationId: ws.id,
            username: candidate.username,
            fingerprint: candidate.fingerprint,
            confirmation: candidate.username
          },
          database
        );
        expect(imported.temporaryPassword).toBeTruthy();
        const waitFor = async (check: () => Promise<boolean>) => {
          const deadline = Date.now() + 15000;
          while (Date.now() < deadline) {
            if (await check()) return;
            await new Promise((resolve) => setTimeout(resolve, 100));
          }
          throw new Error('Live simulator did not complete the account operation');
        };
        await waitFor(
          async () =>
            (
              await client`select status from account_operations where id=${imported.operationId}`
            )[0].status === 'completed'
        );
        await waitFor(async () =>
          (
            await client`select account_snapshot from workstations where id=${ws.id}`
          )[0].account_snapshot.accounts.some(
            (a: { username: string; ownerWorkstationId: string }) =>
              a.username === candidate.username && a.ownerWorkstationId === ws.id
          )
        );
        const [user] = await client`select * from users where username=${candidate.username}`;
        expect(user.posix_uid).toBe(20501);
        expect(user.posix_gid).toBe(20501);
        expect(user.must_change_password).toBe(true);
        const removal = await service.removeAccount(
          {
            actorId: actor.id,
            userId: user.id,
            workstationId: ws.id,
            confirmation: candidate.username,
            deleteHome: false
          },
          database
        );
        await waitFor(
          async () =>
            (await client`select status from account_operations where id=${removal.id}`)[0]
              .status === 'completed'
        );
        await waitFor(
          async () =>
            !(
              await client`select account_snapshot from workstations where id=${ws.id}`
            )[0].account_snapshot.accounts.some(
              (a: { username: string }) => a.username === candidate.username
            )
        );
        expect((await client`select status from users where id=${user.id}`)[0].status).toBe(
          'active'
        );
        expect(
          (
            await client`select account_state from workstation_assignments where id=${removal.assignmentId}`
          )[0].account_state
        ).toBe('removed');
        expect(
          (
            await client`select posix_id from posix_identity_reservations where username=${candidate.username}`
          )[0].posix_id
        ).toBe(20501);
        // Keep the simulator's tombstone and operation history for review; never recycle its numeric identity.
        const { deleteUser } = await import('../deletion');
        await deleteUser(
          { actorId: actor.id, targetId: user.id, confirmation: user.username },
          database
        );
      } finally {
        vi.doUnmock('$lib/server/db');
        await client.end();
      }
    }, 40000);
  }
);
