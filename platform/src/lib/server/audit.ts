import { sql, type SQL } from 'drizzle-orm';

import type { AuditMetadata } from '$lib/server/db/schema';

type SqlExecutor = (query: SQL) => Promise<unknown>;

export type AuditInput = Readonly<{
  actorUserId: string | null;
  action: string;
  targetType: string;
  targetId: string | null;
  metadata?: AuditMetadata;
}>;

export async function recordAudit(execute: SqlExecutor, event: AuditInput): Promise<void> {
  const metadata = JSON.stringify(event.metadata ?? {});

  await execute(sql`
    insert into audit_events (actor_user_id, action, target_type, target_id, metadata)
    values (
      ${event.actorUserId}::uuid,
      ${event.action},
      ${event.targetType},
      ${event.targetId}::uuid,
      ${metadata}::jsonb
    )
  `);
}
