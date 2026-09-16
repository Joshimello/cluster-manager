import { relations, sql } from 'drizzle-orm';
import {
  boolean,
  bigint,
  check,
  doublePrecision,
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
export const reservationStatus = pgEnum('reservation_status', ['active', 'cancelled']);

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
  gpuStatus: 'available' | 'unavailable';
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

export const gpus = pgTable(
  'gpus',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    workstationId: uuid('workstation_id')
      .notNull()
      .references(() => workstations.id, { onDelete: 'cascade' }),
    gpuUuid: varchar('gpu_uuid', { length: 128 }).notNull(),
    localIndex: integer('local_index').notNull(),
    model: varchar('model', { length: 255 }).notNull(),
    active: boolean('active').notNull().default(true),
    lastObservedAt: timestamp('last_observed_at', { withTimezone: true }).notNull(),
    utilizationPercent: doublePrecision('utilization_percent').notNull(),
    memoryUsedBytes: bigint('memory_used_bytes', { mode: 'number' }).notNull(),
    memoryTotalBytes: bigint('memory_total_bytes', { mode: 'number' }).notNull(),
    temperatureC: doublePrecision('temperature_c'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow()
  },
  (table) => [
    uniqueIndex('gpus_workstation_uuid_unique').on(table.workstationId, table.gpuUuid),
    index('gpus_workstation_active_index').on(table.workstationId, table.active),
    index('gpus_last_observed_at_index').on(table.lastObservedAt)
  ]
);

export const gpuObservations = pgTable(
  'gpu_observations',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    gpuId: uuid('gpu_id')
      .notNull()
      .references(() => gpus.id, { onDelete: 'cascade' }),
    observedAt: timestamp('observed_at', { withTimezone: true }).notNull(),
    utilizationPercent: doublePrecision('utilization_percent').notNull(),
    memoryUsedBytes: bigint('memory_used_bytes', { mode: 'number' }).notNull(),
    memoryTotalBytes: bigint('memory_total_bytes', { mode: 'number' }).notNull(),
    temperatureC: doublePrecision('temperature_c'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow()
  },
  (table) => [
    uniqueIndex('gpu_observations_gpu_time_unique').on(table.gpuId, table.observedAt),
    index('gpu_observations_observed_at_index').on(table.observedAt)
  ]
);

export const gpuProcessObservations = pgTable(
  'gpu_process_observations',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    observationId: uuid('observation_id')
      .notNull()
      .references(() => gpuObservations.id, { onDelete: 'cascade' }),
    pid: integer('pid').notNull(),
    uid: integer('uid').notNull(),
    username: varchar('username', { length: 64 }).notNull(),
    command: varchar('command', { length: 128 }).notNull(),
    memoryUsedBytes: bigint('memory_used_bytes', { mode: 'number' }).notNull(),
    processStartTicks: bigint('process_start_ticks', { mode: 'number' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow()
  },
  (table) => [
    index('gpu_process_observations_observation_index').on(table.observationId),
    index('gpu_process_observations_username_index').on(table.username)
  ]
);

export const reservations = pgTable(
  'reservations',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    gpuId: uuid('gpu_id')
      .notNull()
      .references(() => gpus.id, { onDelete: 'restrict' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    createdByUserId: uuid('created_by_user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    status: reservationStatus('status').notNull().default('active'),
    startAt: timestamp('start_at', { withTimezone: true }).notNull(),
    endAt: timestamp('end_at', { withTimezone: true }).notNull(),
    isAdminOverride: boolean('is_admin_override').notNull().default(false),
    overrideReason: text('override_reason'),
    cancelledAt: timestamp('cancelled_at', { withTimezone: true }),
    cancelledByUserId: uuid('cancelled_by_user_id').references(() => users.id, {
      onDelete: 'restrict'
    }),
    cancellationReason: text('cancellation_reason'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow()
  },
  (table) => [
    check('reservations_end_after_start', sql`${table.endAt} > ${table.startAt}`),
    check(
      'reservations_half_hour_boundaries',
      sql`mod(extract(epoch from ${table.startAt})::bigint, 1800) = 0 and mod(extract(epoch from ${table.endAt})::bigint, 1800) = 0`
    ),
    index('reservations_gpu_start_index').on(table.gpuId, table.startAt),
    index('reservations_user_start_index').on(table.userId, table.startAt),
    index('reservations_status_end_index').on(table.status, table.endAt)
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
  workstationAssignments: many(workstationAssignments),
  reservations: many(reservations, { relationName: 'reservationOwner' }),
  createdReservations: many(reservations, { relationName: 'reservationCreator' }),
  cancelledReservations: many(reservations, { relationName: 'reservationCanceller' })
}));

export const workstationsRelations = relations(workstations, ({ many }) => ({
  assignments: many(workstationAssignments),
  gpus: many(gpus)
}));

export const gpusRelations = relations(gpus, ({ one, many }) => ({
  workstation: one(workstations, { fields: [gpus.workstationId], references: [workstations.id] }),
  observations: many(gpuObservations),
  reservations: many(reservations)
}));

export const reservationsRelations = relations(reservations, ({ one }) => ({
  gpu: one(gpus, { fields: [reservations.gpuId], references: [gpus.id] }),
  user: one(users, {
    relationName: 'reservationOwner',
    fields: [reservations.userId],
    references: [users.id]
  }),
  createdBy: one(users, {
    relationName: 'reservationCreator',
    fields: [reservations.createdByUserId],
    references: [users.id]
  }),
  cancelledBy: one(users, {
    relationName: 'reservationCanceller',
    fields: [reservations.cancelledByUserId],
    references: [users.id]
  })
}));

export const gpuObservationsRelations = relations(gpuObservations, ({ one, many }) => ({
  gpu: one(gpus, { fields: [gpuObservations.gpuId], references: [gpus.id] }),
  processes: many(gpuProcessObservations)
}));

export const gpuProcessObservationsRelations = relations(gpuProcessObservations, ({ one }) => ({
  observation: one(gpuObservations, {
    fields: [gpuProcessObservations.observationId],
    references: [gpuObservations.id]
  })
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
export type Gpu = typeof gpus.$inferSelect;
export type GpuObservation = typeof gpuObservations.$inferSelect;
export type GpuProcessObservation = typeof gpuProcessObservations.$inferSelect;
export type Reservation = typeof reservations.$inferSelect;
export type ReservationStatus = Reservation['status'];
