import { desc, eq } from 'drizzle-orm';
import { json } from '@sveltejs/kit';

import { isLinuxPasswordHash } from '$lib/server/auth/linux-password';
import { getDatabase } from '$lib/server/db';
import { users, workstationAssignments } from '$lib/server/db/schema';
import { authenticateNode } from '$lib/server/nodes/authentication';

import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ request }) => {
  const workstation = await authenticateNode(request.headers.get('authorization'));
  if (!workstation) {
    return json({ error: 'Node authentication failed.' }, { status: 401 });
  }

  const assignments = await getDatabase()
    .select({
      assignmentId: workstationAssignments.id,
      username: users.username,
      userStatus: users.status,
      assignmentStatus: workstationAssignments.status,
      passwordHash: users.linuxPasswordHash,
      generation: workstationAssignments.desiredGeneration,
      assignedAt: workstationAssignments.assignedAt
    })
    .from(workstationAssignments)
    .innerJoin(users, eq(workstationAssignments.userId, users.id))
    .where(eq(workstationAssignments.workstationId, workstation.id))
    .orderBy(desc(workstationAssignments.assignedAt));

  const selected = new Map<string, (typeof assignments)[number]>();
  for (const assignment of assignments) {
    const current = selected.get(assignment.username);
    if (!current || assignment.assignmentStatus === 'active') {
      selected.set(assignment.username, assignment);
    }
  }

  return json(
    {
      apiVersion: 'v1',
      generatedAt: new Date(),
      workstation: { id: workstation.id, name: workstation.name },
      users: Array.from(selected.values(), (assignment) => {
        const enabled =
          assignment.assignmentStatus === 'active' &&
          assignment.userStatus === 'active' &&
          assignment.passwordHash !== null &&
          isLinuxPasswordHash(assignment.passwordHash);
        return {
          assignmentId: assignment.assignmentId,
          username: assignment.username,
          enabled,
          generation: assignment.generation,
          ...(enabled ? { passwordHash: assignment.passwordHash } : {})
        };
      })
    },
    {
      headers: {
        'cache-control': 'no-store',
        pragma: 'no-cache'
      }
    }
  );
};
