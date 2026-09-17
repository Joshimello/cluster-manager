<script lang="ts">
  import KeyRoundIcon from '@lucide/svelte/icons/key-round';
  import DatabaseIcon from '@lucide/svelte/icons/database';
  import MonitorIcon from '@lucide/svelte/icons/monitor';
  import TerminalIcon from '@lucide/svelte/icons/terminal';
  import CalendarDaysIcon from '@lucide/svelte/icons/calendar-days';
  import UserRoundIcon from '@lucide/svelte/icons/user-round';
  import { resolve } from '$app/paths';
  import GpuMonitor from '$lib/components/gpu-monitor.svelte';
  import PageHeader from '$lib/components/page-header.svelte';
  import StatusBadge from '$lib/components/status-badge.svelte';
  import { Button } from '$lib/components/ui/button/index.js';
  import * as Card from '$lib/components/ui/card/index.js';

  let { data } = $props();
  const bytes = new Intl.NumberFormat(undefined, {
    style: 'unit',
    unit: 'gigabyte',
    maximumFractionDigits: 1
  });
  const gigabytes = (value: number) => bytes.format(value / 1_000_000_000);
  const reservationTime = new Intl.DateTimeFormat(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone: 'Asia/Kuala_Lumpur'
  });
  const now = new Date();
</script>

<svelte:head><title>Dashboard · Cluster Manager</title></svelte:head>

<main class="mx-auto grid w-full max-w-7xl gap-6 px-4 py-8 sm:px-6 lg:px-8">
  <PageHeader
    title={`Welcome, ${data.user.displayName}`}
    description="Your Cluster Manager account is active."
  />

  <Card.Root>
    <Card.Header>
      <Card.Title class="flex items-center gap-2"
        ><UserRoundIcon class="size-5" />Account</Card.Title
      >
      <Card.Description>Your platform identity and current access.</Card.Description>
    </Card.Header>
    <Card.Content class="grid gap-6 sm:grid-cols-2 lg:grid-cols-5 lg:items-end">
      <div class="grid gap-1">
        <span class="text-muted-foreground text-xs font-medium uppercase">Username</span><strong
          >{data.user.username}</strong
        >
      </div>
      <div class="grid gap-1">
        <span class="text-muted-foreground text-xs font-medium uppercase">Role</span><StatusBadge
          status={data.user.role}
        />
      </div>
      <div class="grid gap-1">
        <span class="text-muted-foreground text-xs font-medium uppercase">POSIX identity</span
        ><strong class="font-mono">{data.user.posixUid}:{data.user.posixGid}</strong>
      </div>
      <div class="grid gap-1">
        <span class="text-muted-foreground text-xs font-medium uppercase">Workstations</span><strong
          >{data.assignments.length} assigned</strong
        >
      </div>
      <Button href={resolve('/change-password')} variant="outline"
        ><KeyRoundIcon data-icon="inline-start" />Change password</Button
      >
    </Card.Content>
  </Card.Root>

  {#if data.assignments.length > 0}
    {#each data.assignments as assignment (assignment.id)}
      <section class="grid gap-4 md:grid-cols-3">
        <Card.Root>
          <Card.Header>
            <Card.Title class="flex items-center gap-2"
              ><MonitorIcon class="size-5" />{assignment.displayName}</Card.Title
            >
            <Card.Description>Your assigned Linux workstation.</Card.Description>
          </Card.Header>
          <Card.Content class="grid gap-3">
            <div class="flex flex-wrap items-center gap-2">
              <StatusBadge status={assignment.provisioningStatus} />
              <span class="text-muted-foreground text-sm">
                Generation {assignment.appliedGeneration} of {assignment.desiredGeneration}
              </span>
            </div>
            {#if assignment.provisioningMessage}
              <p
                class={assignment.provisioningStatus === 'error'
                  ? 'text-destructive text-sm'
                  : 'text-muted-foreground text-sm'}
              >
                {assignment.provisioningMessage}
              </p>
            {/if}
            {#if assignment.provisioningErrorCode === 'username_collision'}
              <p class="text-destructive text-sm font-medium">
                Ask an administrator to choose another platform username, or have the workstation
                operator deliberately rename or remove the colliding local account. No local
                ownership or credential data was changed.
              </p>
            {:else if assignment.provisioningErrorCode === 'uid_collision'}
              <p class="text-destructive text-sm font-medium">
                UID {data.user.posixUid} is already in use on this workstation. Ask its operator to resolve
                the unrelated identity; no ownership, credentials, groups, or files were changed.
              </p>
            {:else if assignment.provisioningErrorCode === 'gid_collision'}
              <p class="text-destructive text-sm font-medium">
                GID {data.user.posixGid} or your private group name is already in use on this workstation.
                No ownership, credentials, groups, or files were changed.
              </p>
            {:else if assignment.provisioningErrorCode === 'managed_identity_mismatch'}
              <p class="text-destructive text-sm font-medium">
                This managed account has the wrong numeric identity and must be purged and recreated
                by the workstation operator.
              </p>
            {/if}
          </Card.Content>
        </Card.Root>

        <Card.Root>
          <Card.Header>
            <Card.Title class="flex items-center gap-2"
              ><TerminalIcon class="size-5" />SSH access</Card.Title
            >
            <Card.Description>Use the same password as this platform account.</Card.Description>
          </Card.Header>
          <Card.Content>
            {#if assignment.provisioningStatus === 'applied'}
              <code class="bg-muted block overflow-x-auto rounded-md border p-3 text-sm">
                ssh {data.user.username}@{assignment.hostname ?? assignment.name}
              </code>
            {:else}
              <p class="text-muted-foreground text-sm">
                SSH access will be available after the node applies your account.
              </p>
            {/if}
          </Card.Content>
        </Card.Root>

        <Card.Root>
          <Card.Header>
            <Card.Title class="flex items-center gap-2"
              ><DatabaseIcon class="size-5" />Storage availability</Card.Title
            >
            <Card.Description>Latest filesystem report from your workstation.</Card.Description>
          </Card.Header>
          <Card.Content>
            {#if assignment.inventory}
              <strong class="text-2xl tracking-tight">
                {gigabytes(
                  assignment.inventory.storage.totalBytes - assignment.inventory.storage.usedBytes
                )}
              </strong>
              <p class="text-muted-foreground text-sm">
                available of {gigabytes(assignment.inventory.storage.totalBytes)} at
                <code>{assignment.inventory.storage.path}</code>
              </p>
            {:else}
              <p class="text-muted-foreground text-sm">Storage has not been reported yet.</p>
            {/if}
          </Card.Content>
        </Card.Root>
      </section>

      <section class="grid gap-3" aria-labelledby="gpu-monitoring-heading">
        <div>
          <h2 id="gpu-monitoring-heading" class="text-xl font-semibold tracking-tight">
            GPU availability
          </h2>
          <p class="text-muted-foreground text-sm">
            Current telemetry for {assignment.displayName}. Process details are limited to your
            Linux account.
          </p>
        </div>
        <GpuMonitor
          gpus={assignment.gpus}
          gpuStatus={assignment.inventory?.gpuStatus ?? 'unavailable'}
          processScope="user"
          allowStopRequests={true}
        />
      </section>
    {/each}

    <Card.Root>
      <Card.Header class="flex-row items-start justify-between gap-4">
        <div class="space-y-1.5">
          <Card.Title class="flex items-center gap-2"
            ><CalendarDaysIcon class="size-5" />Current and upcoming reservations</Card.Title
          >
          <Card.Description>Times are shown in Asia/Kuala_Lumpur.</Card.Description>
        </div>
        <Button href={resolve('/reservations')} variant="outline">Manage reservations</Button>
      </Card.Header>
      <Card.Content>
        {#if data.reservations.length === 0}
          <p class="text-muted-foreground text-sm">You have no current or upcoming reservations.</p>
        {:else}
          <div class="grid gap-3">
            {#each data.reservations as reservation (reservation.id)}
              <div class="flex flex-wrap items-center justify-between gap-3 rounded-lg border p-3">
                <div>
                  <strong
                    >{reservation.workstationName} · GPU {reservation.gpuIndex} · {reservation.gpuModel}</strong
                  >
                  <p class="text-muted-foreground text-sm">
                    {reservationTime.format(reservation.startAt)} – {reservationTime.format(
                      reservation.endAt
                    )}
                  </p>
                </div>
                <StatusBadge status={reservation.startAt <= now ? 'current' : 'upcoming'} />
              </div>
            {/each}
          </div>
        {/if}
      </Card.Content>
    </Card.Root>
  {:else}
    <Card.Root class="border-dashed" size="sm">
      <Card.Header>
        <Card.Title>No workstation assignment</Card.Title>
        <Card.Description
          >An administrator must assign your account before SSH access is provisioned.</Card.Description
        >
      </Card.Header>
    </Card.Root>
  {/if}
</main>
