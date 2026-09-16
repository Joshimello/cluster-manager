<script lang="ts">
  import KeyRoundIcon from '@lucide/svelte/icons/key-round';
  import DatabaseIcon from '@lucide/svelte/icons/database';
  import MonitorIcon from '@lucide/svelte/icons/monitor';
  import TerminalIcon from '@lucide/svelte/icons/terminal';
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
    <Card.Content class="grid gap-6 sm:grid-cols-2 lg:grid-cols-4 lg:items-end">
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
        <span class="text-muted-foreground text-xs font-medium uppercase">Workstation</span><strong
          >{data.assignment?.name ?? 'Not assigned yet'}</strong
        >
      </div>
      <Button href={resolve('/change-password')} variant="outline"
        ><KeyRoundIcon data-icon="inline-start" />Change password</Button
      >
    </Card.Content>
  </Card.Root>

  {#if data.assignment}
    <section class="grid gap-4 md:grid-cols-3">
      <Card.Root>
        <Card.Header>
          <Card.Title class="flex items-center gap-2"
            ><MonitorIcon class="size-5" />{data.assignment.displayName}</Card.Title
          >
          <Card.Description>Your assigned Linux workstation.</Card.Description>
        </Card.Header>
        <Card.Content class="grid gap-3">
          <div class="flex flex-wrap items-center gap-2">
            <StatusBadge status={data.assignment.provisioningStatus} />
            <span class="text-muted-foreground text-sm">
              Generation {data.assignment.appliedGeneration} of {data.assignment.desiredGeneration}
            </span>
          </div>
          {#if data.assignment.provisioningMessage}
            <p
              class={data.assignment.provisioningStatus === 'error'
                ? 'text-destructive text-sm'
                : 'text-muted-foreground text-sm'}
            >
              {data.assignment.provisioningMessage}
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
          {#if data.assignment.provisioningStatus === 'applied'}
            <code class="bg-muted block overflow-x-auto rounded-md border p-3 text-sm">
              ssh {data.user.username}@{data.assignment.hostname ?? data.assignment.name}
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
          {#if data.assignment.inventory}
            <strong class="text-2xl tracking-tight">
              {gigabytes(
                data.assignment.inventory.storage.totalBytes -
                  data.assignment.inventory.storage.usedBytes
              )}
            </strong>
            <p class="text-muted-foreground text-sm">
              available of {gigabytes(data.assignment.inventory.storage.totalBytes)} at
              <code>{data.assignment.inventory.storage.path}</code>
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
          Current telemetry for your assigned workstation. Process details are limited to your Linux
          account.
        </p>
      </div>
      <GpuMonitor
        gpus={data.gpus}
        gpuStatus={data.assignment.inventory?.gpuStatus ?? 'unavailable'}
        processScope="user"
      />
    </section>
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
