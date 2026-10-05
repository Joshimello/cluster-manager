<script lang="ts">
  import { Badge } from '$lib/components/ui/badge/index.js';
  import { Input } from '$lib/components/ui/input/index.js';
  import * as Table from '$lib/components/ui/table/index.js';
  import { storageSize, usageDuration } from '$lib/user-usage';
  import type { loadWorkstationUsers } from '$lib/server/nodes/workstation-users';
  type UserRow = Awaited<ReturnType<typeof loadWorkstationUsers>>[number];
  let {
    users,
    startedAt,
    timeZone,
    simulated = false
  }: { users: UserRow[]; startedAt: Date | null; timeZone: string; simulated?: boolean } = $props();
  let query = $state('');
  let visible = $derived(
    users.filter((user) =>
      `${user.username} ${user.displayName}`.toLowerCase().includes(query.toLowerCase().trim())
    )
  );
  let dateTime = $derived(
    new Intl.DateTimeFormat(undefined, { timeZone, dateStyle: 'medium', timeStyle: 'short' })
  );
  const time = (value: number | null) =>
    value === null ? 'Not tracked yet' : usageDuration(value);
</script>

<section class="grid min-w-0 gap-4" aria-labelledby="workstation-users-heading">
  <div>
    <h2 id="workstation-users-heading" class="text-xl font-semibold tracking-tight">Users</h2>
    <p class="text-muted-foreground mt-1 text-sm">
      All platform-managed accounts. Usage and storage below are for this workstation.
    </p>
  </div>
  {#if simulated}<p class="text-muted-foreground text-sm">
      This is a simulated workstation; reported sessions, GPU activity, and storage are simulated.
    </p>{/if}
  <div class="flex flex-wrap items-center justify-between gap-3">
    <div class="flex flex-wrap gap-2">
      <Badge variant="secondary">{users.length} users</Badge>
      <Badge variant="outline"
        >{users.filter((user) => user.assignmentStatus === 'active').length} assigned</Badge
      >
      <Badge variant="outline"
        >{users.length && users.every((user) => user.currentSessions === null)
          ? 'Live activity unknown'
          : `${users.filter((user) => (user.currentSessions ?? 0) > 0).length} logged in`}</Badge
      >
    </div>
    <Input
      type="search"
      aria-label="Search workstation users"
      placeholder="Search users…"
      bind:value={query}
      class="w-full sm:max-w-xs"
    />
  </div>
  <div class="overflow-hidden rounded-lg border">
    <Table.Root>
      <Table.Caption class="sr-only"
        >Managed users and their observed workstation usage</Table.Caption
      >
      <Table.Header
        ><Table.Row>
          <Table.Head class="bg-background sticky left-0 z-10 pl-4">User / access</Table.Head>
          <Table.Head
            title="Time with at least one interactive Linux session; concurrent sessions count once."
            >Login time</Table.Head
          >
          <Table.Head
            title="Occupied GPU time, summed across GPUs. Multiple processes on one GPU count once per user."
            >GPU time</Table.Head
          >
          <Table.Head
            title="Allocated disk usage in the managed home directory on its own filesystem."
            >Home storage</Table.Head
          >
          <Table.Head
            title="Elapsed reservation GPU-hours, including time before tracking began. Future reserved hours shown below."
            >Scheduled</Table.Head
          >
          <Table.Head
            title="GPU use during bookings divided by booked time within observed intervals. Offline gaps excluded."
            >Booked use</Table.Head
          >
          <Table.Head title="GPU time outside this user's own reservations."
            >Outside bookings</Table.Head
          >
          <Table.Head class="pr-4">Last activity / now</Table.Head>
        </Table.Row></Table.Header
      >
      <Table.Body>
        {#each visible as user (user.id)}<Table.Row>
            <Table.Cell class="bg-background sticky left-0 z-10 min-w-44 pl-4 align-top"
              ><div class="grid gap-1">
                <strong>{user.displayName}</strong><span class="text-muted-foreground text-xs"
                  >{user.username}</span
                >
                <div class="flex flex-wrap gap-1">
                  <Badge variant="outline"
                    >{user.deletedAt
                      ? 'Deleted'
                      : user.status === 'disabled'
                        ? 'Disabled'
                        : 'Active'}</Badge
                  ><Badge variant="secondary"
                    >{user.assignmentStatus === 'active'
                      ? `Assigned · ${user.provisioningStatus}`
                      : user.assignmentStatus === 'revoked'
                        ? 'Revoked'
                        : 'Unassigned'}</Badge
                  >
                </div>
              </div></Table.Cell
            >
            <Table.Cell class="align-top whitespace-nowrap"
              >{time(user.loginMilliseconds)}</Table.Cell
            >
            <Table.Cell class="align-top whitespace-nowrap">{time(user.gpuMilliseconds)}</Table.Cell
            >
            <Table.Cell class="min-w-36 align-top"
              ><div class="grid gap-1">
                <span
                  >{user.storageBytes === null
                    ? 'Not available'
                    : storageSize(user.storageBytes)}</span
                >
                <span class="text-muted-foreground text-xs"
                  >{user.storageStatus && user.storageStatus !== 'measured'
                    ? user.storageStatus.replaceAll('_', ' ')
                    : user.storageObservedAt
                      ? `${user.storageStale ? 'Stale · ' : ''}${dateTime.format(user.storageObservedAt)}`
                      : 'Awaiting node report'}</span
                >
              </div></Table.Cell
            >
            <Table.Cell class="min-w-36 align-top"
              ><div class="grid gap-1">
                <span>{usageDuration(user.scheduledMilliseconds)}</span><span
                  class="text-muted-foreground text-xs"
                  >{usageDuration(user.upcomingMilliseconds)} upcoming</span
                >
                <span class="text-muted-foreground text-xs"
                  >{user.bookingCount} bookings · {user.cancelledBookingCount} cancelled</span
                >
              </div></Table.Cell
            >
            <Table.Cell class="min-w-32 align-top"
              ><div class="grid gap-1">
                <span
                  >{user.bookingUsagePercent === null
                    ? '—'
                    : `${user.bookingUsagePercent.toFixed(1)}%`}</span
                >
                <span class="text-muted-foreground text-xs"
                  >{user.observedScheduledMilliseconds
                    ? `${usageDuration(user.bookedGpuMilliseconds ?? 0)} / ${usageDuration(user.observedScheduledMilliseconds)} observed`
                    : 'No observed booked time'}</span
                >
              </div></Table.Cell
            >
            <Table.Cell class="align-top whitespace-nowrap"
              >{time(user.outsideBookingMilliseconds)}</Table.Cell
            >
            <Table.Cell class="min-w-48 pr-4 align-top"
              ><div class="grid gap-1">
                <span
                  >{user.lastActivityAt
                    ? dateTime.format(user.lastActivityAt)
                    : 'No activity observed'}</span
                >
                <span class="text-muted-foreground text-xs"
                  >{user.currentSessions === null
                    ? 'Sessions unknown'
                    : `${user.currentSessions} sessions`} · {user.currentGpuCount === null
                    ? 'GPU activity unknown'
                    : `${user.currentGpuCount} GPUs / ${user.currentProcessCount} processes`}</span
                >
                {#if user.currentVramBytes !== null}<span class="text-muted-foreground text-xs"
                    >{storageSize(user.currentVramBytes)} VRAM now</span
                  >{/if}
              </div></Table.Cell
            >
          </Table.Row>{:else}<Table.Row
            ><Table.Cell colspan={8} class="py-8 text-center text-muted-foreground"
              >{query ? 'No matching users.' : 'No platform users.'}</Table.Cell
            ></Table.Row
          >{/each}
      </Table.Body>
    </Table.Root>
  </div>
  <p class="text-muted-foreground text-xs">
    {startedAt
      ? `Usage tracking started ${dateTime.format(startedAt)}.`
      : 'Usage tracking begins with the next accepted heartbeat.'}
  </p>
  <details class="text-muted-foreground text-xs">
    <summary class="w-fit cursor-pointer font-medium">How these metrics are measured</summary>
    <p class="mt-2 max-w-3xl leading-relaxed">
      Totals estimate time between heartbeats using the previous observation and persist across
      telemetry cleanup. Login time counts overlapping sessions once; GPU time counts each occupied
      GPU, not compute utilization. Booked use compares only intervals with GPU telemetry. Gaps
      beyond three expected heartbeats (at least two minutes), reboots, and activity before tracking
      are excluded. Storage is a snapshot scanned about every five minutes; symlinks and other
      filesystems are excluded. Scroll the table sideways to see every metric; the user column stays
      in view.
    </p>
  </details>
</section>
