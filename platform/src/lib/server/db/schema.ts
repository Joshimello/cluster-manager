import { relations, sql } from 'drizzle-orm';
import {
  boolean,
  bigint,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  varchar
} from 'drizzle-orm/pg-core';

export const userRole = pgEnum('user_role', ['user', 'admin']);
export const userStatus = pgEnum('user_status', ['active', 'disabled']);
export const workstationStatus = pgEnum('workstation_status', ['active', 'disabled']);
export const assignmentStatus = pgEnum('assignment_status', ['active', 'revoked']);
export const provisioningStatus = pgEnum('provisioning_status', ['pending', 'applied', 'error']);

export const platformMetadata = pgTable('platform_metadata', {
  key: text('key').primaryKey(),
  value: text('value').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow()
});

export const users = pgTable(
  'users',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    username: varchar('username', { length: 32 }).notNull(),
    displayName: varchar('display_name', { length: 120 }).notNull(),
    role: userRole('role').notNull().default('user'),
    status: userStatus('status').notNull().default('active'),
    passwordHash: text('password_hash').notNull(),
    linuxPasswordHash: text('linux_password_hash'),
    mustChangePassword: boolean('must_change_password').notNull().default(true),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow()
  },
  (table) => [uniqueIndex('users_username_unique').on(table.username)]
);

export const sessions = pgTable(
  'sessions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tokenHash: varchar('token_hash', { length: 64 }).notNull(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow()
  },
  (table) => [
    uniqueIndex('sessions_token_hash_unique').on(table.tokenHash),
    index('sessions_user_id_index').on(table.userId),
    index('sessions_expires_at_index').on(table.expiresAt)
  ]
);

export type AuditMetadata = Record<string, boolean | number | string | null>;

export type WorkstationInventory = {
  cpu: {
    logicalCores: number;
    model: string;
    utilizationPercent: number;
  };
  memory: {
    totalBytes: number;
    usedBytes: number;
    utilizationPercent: number;
  };
  storage: {
    path: string;
    totalBytes: number;
    usedBytes: number;
    utilizationPercent: number;
  };
  sessions: Array<{
    username: string;
    terminal: string;
    remoteHost?: string;
  }>;
  operatingSystem: string;
};

export const workstations = pgTable(
  'workstations',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    name: varchar('name', { length: 32 }).notNull(),
    displayName: varchar('display_name', { length: 120 }).notNull(),
    status: workstationStatus('status').notNull().default('active'),
    enrollmentTokenHash: varchar('enrollment_token_hash', { length: 64 }),
    enrollmentExpiresAt: timestamp('enrollment_expires_at', { withTimezone: true }),
    enrollmentUsedAt: timestamp('enrollment_used_at', { withTimezone: true }),
    credentialHash: varchar('credential_hash', { length: 64 }),
    credentialIssuedAt: timestamp('credential_issued_at', { withTimezone: true }),
    enrolledAt: timestamp('enrolled_at', { withTimezone: true }),
    lastHeartbeatAt: timestamp('last_heartbeat_at', { withTimezone: true }),
    inventoryObservedAt: timestamp('inventory_observed_at', { withTimezone: true }),
    nodeVersion: varchar('node_version', { length: 64 }),
    hostname: varchar('hostname', { length: 255 }),
    bootId: varchar('boot_id', { length: 128 }),
    uptimeSeconds: bigint('uptime_seconds', { mode: 'number' }),
    inventory: jsonb('inventory').$type<WorkstationInventory>(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow()
  },
  (table) => [
    uniqueIndex('workstations_name_unique').on(table.name),
    uniqueIndex('workstations_credential_hash_unique').on(table.credentialHash),
    uniqueIndex('workstations_enrollment_token_hash_unique').on(table.enrollmentTokenHash),
    index('workstations_last_heartbeat_at_index').on(table.lastHeartbeatAt)
  ]
);

export const workstationAssignments = pgTable(
  'workstation_assignments',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    workstationId: uuid('workstation_id')
      .notNull()
      .references(() => workstations.id, { onDelete: 'restrict' }),
    status: assignmentStatus('status').notNull().default('active'),
    desiredGeneration: integer('desired_generation').notNull().default(1),
    appliedGeneration: integer('applied_generation').notNull().default(0),
    provisioningStatus: provisioningStatus('provisioning_status').notNull().default('pending'),
    provisioningMessage: text('provisioning_message'),
    assignedAt: timestamp('assigned_at', { withTimezone: true }).notNull().defaultNow(),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
    reconciledAt: timestamp('reconciled_at', { withTimezone: true }),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow()
  },
  (table) => [
    uniqueIndex('workstation_assignments_active_user_unique')
      .on(table.userId)
      .where(sql`${table.status} = 'active'`),
    index('workstation_assignments_workstation_index').on(table.workstationId),
    index('workstation_assignments_status_index').on(table.status)
  ]
);

export const auditEvents = pgTable(
  'audit_events',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    actorUserId: uuid('actor_user_id').references(() => users.id, { onDelete: 'set null' }),
    action: varchar('action', { length: 100 }).notNull(),
    targetType: varchar('target_type', { length: 50 }).notNull(),
    targetId: uuid('target_id'),
    metadata: jsonb('metadata').$type<AuditMetadata>().notNull().default({}),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow()
  },
  (table) => [
    index('audit_events_created_at_index').on(table.createdAt),
    index('audit_events_actor_user_id_index').on(table.actorUserId)
  ]
);

export const usersRelations = relations(users, ({ many }) => ({
  sessions: many(sessions),
  auditEvents: many(auditEvents),
  workstationAssignments: many(workstationAssignments)
}));

export const workstationsRelations = relations(workstations, ({ many }) => ({
  assignments: many(workstationAssignments)
}));

export const workstationAssignmentsRelations = relations(workstationAssignments, ({ one }) => ({
  user: one(users, { fields: [workstationAssignments.userId], references: [users.id] }),
  workstation: one(workstations, {
    fields: [workstationAssignments.workstationId],
    references: [workstations.id]
  })
}));

export const sessionsRelations = relations(sessions, ({ one }) => ({
  user: one(users, {
    fields: [sessions.userId],
    references: [users.id]
  })
}));

export const auditEventsRelations = relations(auditEvents, ({ one }) => ({
  actor: one(users, {
    fields: [auditEvents.actorUserId],
    references: [users.id]
  })
}));

export type User = typeof users.$inferSelect;
export type UserRole = User['role'];
export type UserStatus = User['status'];
export type Workstation = typeof workstations.$inferSelect;
export type WorkstationStatus = Workstation['status'];
export type WorkstationAssignment = typeof workstationAssignments.$inferSelect;
export type AssignmentStatus = WorkstationAssignment['status'];
export type ProvisioningStatus = WorkstationAssignment['provisioningStatus'];
