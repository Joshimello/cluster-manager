import { fail } from '@sveltejs/kit';
import { eq, sql } from 'drizzle-orm';
import { randomBytes } from 'node:crypto';
import { requireAdmin } from '$lib/server/auth/guards';
import { getDatabase } from '$lib/server/db';
import { oidcClients, oidcObjects } from '$lib/server/db/schema';
import { recordAudit } from '$lib/server/audit';
import { encrypt, encryptionKey, validateClient } from '../../../../runtime/oidc.mjs';

export const load = async ({ locals, setHeaders }) => {
  setHeaders({ 'cache-control': 'private, no-store' });
  requireAdmin(locals);
  return {
    configured: Boolean(process.env.AUTH_ENCRYPTION_KEY),
    issuer: `${process.env.ORIGIN}/oidc`,
    clients: await getDatabase()
      .select({
        id: oidcClients.id,
        name: oidcClients.name,
        redirectUris: oidcClients.redirectUris,
        enabled: oidcClients.enabled
      })
      .from(oidcClients)
      .orderBy(oidcClients.createdAt)
  };
};
export const actions = {
  save: async ({ locals, request, setHeaders }) => {
    setHeaders({ 'cache-control': 'private, no-store' });
    const actor = requireAdmin(locals);
    const form = await request.formData();
    try {
      encryptionKey();
      const { name, redirectUris } = validateClient(form.get('name'), form.get('redirectUris'));
      const id = String(form.get('id') || '');
      if (id && !/^[0-9a-f-]{36}$/i.test(id)) return fail(400, { message: 'Invalid application.' });
      const secret = id ? null : randomBytes(32).toString('base64url');
      const result = await getDatabase().transaction(async (tx) => {
        const [client] = id
          ? await tx
              .update(oidcClients)
              .set({ name, redirectUris, updatedAt: new Date() })
              .where(eq(oidcClients.id, id))
              .returning()
          : await tx
              .insert(oidcClients)
              .values({ name, redirectUris, secret: encrypt(secret) })
              .returning();
        if (!client) throw new Error('Application not found.');
        if (id) await tx.delete(oidcObjects).where(eq(oidcObjects.clientId, id));
        await recordAudit((q) => tx.execute(q), {
          actorUserId: actor.id,
          action: id ? 'identity.client_updated' : 'identity.client_created',
          targetType: 'connected_application',
          targetId: client.id
        });
        return client.id;
      });
      return {
        message: id
          ? 'Application updated. Existing authorizations have been revoked.'
          : 'Application created. Save this secret now; it will not be shown again.',
        clientId: result,
        secret
      };
    } catch (error) {
      return fail(400, {
        message:
          error instanceof Error &&
          /application|callback|HTTPS|AUTH_ENCRYPTION|characters|URL/i.test(error.message)
            ? error.message
            : 'Could not save application.'
      });
    }
  },
  update: async ({ locals, request, setHeaders }) => {
    setHeaders({ 'cache-control': 'private, no-store' });
    const actor = requireAdmin(locals),
      form = await request.formData();
    const id = String(form.get('id') || ''),
      operation = String(form.get('operation') || '');
    if (!/^[0-9a-f-]{36}$/i.test(id) || !['enable', 'disable', 'rotate'].includes(operation))
      return fail(400, { message: 'Invalid application action.' });
    const secret = operation === 'rotate' ? randomBytes(32).toString('base64url') : null;
    await getDatabase().transaction(async (tx) => {
      const rows = await tx
        .update(oidcClients)
        .set({
          ...(secret ? { secret: encrypt(secret) } : { enabled: operation === 'enable' }),
          updatedAt: new Date()
        })
        .where(eq(oidcClients.id, id))
        .returning({ id: oidcClients.id });
      if (!rows.length) throw new Error('Application not found');
      await tx.delete(oidcObjects).where(sql`${oidcObjects.clientId} = ${id}::uuid`);
      await recordAudit((q) => tx.execute(q), {
        actorUserId: actor.id,
        action: `identity.client_${operation}`,
        targetType: 'connected_application',
        targetId: id
      });
    });
    return {
      message: secret
        ? 'Secret rotated. Update the application configuration; existing authorizations have been revoked.'
        : 'Application updated.',
      secret,
      clientId: id
    };
  }
};
