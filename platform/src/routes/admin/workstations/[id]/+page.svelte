<script lang="ts">
  import ArrowLeftIcon from '@lucide/svelte/icons/arrow-left';
  import CpuIcon from '@lucide/svelte/icons/cpu';
  import DatabaseIcon from '@lucide/svelte/icons/database';
  import MemoryStickIcon from '@lucide/svelte/icons/memory-stick';
  import { resolve } from '$app/paths';
  import PageHeader from '$lib/components/page-header.svelte';
  import StatusBadge from '$lib/components/status-badge.svelte';
  import { Button } from '$lib/components/ui/button/index.js';
  import * as Card from '$lib/components/ui/card/index.js';
  import * as Table from '$lib/components/ui/table/index.js';

  let { data } = $props();
  let ws = $derived(data.workstation);
  const dateTime = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'medium' });
  const bytes = new Intl.NumberFormat(undefined, {
    style: 'unit',
    unit: 'gigabyte',
    maximumFractionDigits: 1
  });
  const gigabytes = (value = 0) => bytes.format(value / 1_000_000_000);
</script>

<svelte:head><title>{ws.name} · Workstations · Cluster Manager</title></svelte:head>

<main class="mx-auto grid w-full max-w-7xl gap-6 px-4 py-8 sm:px-6 lg:px-8">
  <Button variant="ghost" size="sm" href={resolve('/admin/workstations')} class="w-fit">
    <ArrowLeftIcon aria-hidden="true" />
    All workstations
  </Button>

  <div class="flex flex-col justify-between gap-4 sm:flex-row sm:items-end">
    <PageHeader title={ws.displayName} description={ws.name} />
    <div class="flex flex-wrap gap-2">
      <StatusBadge status={ws.connectionState} />
      <StatusBadge status={ws.status} />
    </div>
  </div>

  <Card.Root>
    <Card.Header>
      <Card.Title>Node facts</Card.Title>
      <Card.Description>Identity and health information from the latest heartbeat.</Card.Description
      >
    </Card.Header>
    <Card.Content class="grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
      <div class="grid gap-1">
        <span class="text-muted-foreground text-sm">Last heartbeat</span>
        <strong>{ws.lastHeartbeatAt ? dateTime.format(ws.lastHeartbeatAt) : 'Never'}</strong>
      </div>
      <div class="grid gap-1">
        <span class="text-muted-foreground text-sm">Node version</span>
        <strong>{ws.nodeVersion ?? 'Unknown'}</strong>
      </div>
      <div class="grid gap-1">
        <span class="text-muted-foreground text-sm">Hostname</span>
        <strong class="break-all">{ws.hostname ?? 'Unknown'}</strong>
      </div>
      <div class="grid gap-1">
        <span class="text-muted-foreground text-sm">Uptime</span>
        <strong
          >{ws.uptimeSeconds === null
            ? 'Unknown'
            : `${ws.uptimeSeconds.toLocaleString()} seconds`}</strong
        >
      </div>
    </Card.Content>
  </Card.Root>

  {#if ws.inventory}
    <section class="grid gap-4 md:grid-cols-3" aria-label="Resource utilization">
      <Card.Root>
        <Card.Header class="flex-row items-center justify-between gap-4">
          <Card.Title>CPU</Card.Title>
          <CpuIcon class="text-muted-foreground size-5" aria-hidden="true" />
        </Card.Header>
        <Card.Content class="grid gap-2">
          <strong class="text-3xl tracking-tight"
            >{ws.inventory.cpu.utilizationPercent.toFixed(1)}%</strong
          >
          <p class="text-muted-foreground text-sm">
            {ws.inventory.cpu.model} · {ws.inventory.cpu.logicalCores} logical cores
          </p>
        </Card.Content>
      </Card.Root>

      <Card.Root>
        <Card.Header class="flex-row items-center justify-between gap-4">
          <Card.Title>Memory</Card.Title>
          <MemoryStickIcon class="text-muted-foreground size-5" aria-hidden="true" />
        </Card.Header>
        <Card.Content class="grid gap-2">
          <strong class="text-3xl tracking-tight"
            >{ws.inventory.memory.utilizationPercent.toFixed(1)}%</strong
          >
          <p class="text-muted-foreground text-sm">
            {gigabytes(ws.inventory.memory.usedBytes)} of {gigabytes(
              ws.inventory.memory.totalBytes
            )}
          </p>
        </Card.Content>
      </Card.Root>

      <Card.Root>
        <Card.Header class="flex-row items-center justify-between gap-4">
          <Card.Title>Storage</Card.Title>
          <DatabaseIcon class="text-muted-foreground size-5" aria-hidden="true" />
        </Card.Header>
        <Card.Content class="grid gap-2">
          <strong class="text-3xl tracking-tight"
            >{ws.inventory.storage.utilizationPercent.toFixed(1)}%</strong
          >
          <p class="text-muted-foreground text-sm">
            {gigabytes(ws.inventory.storage.usedBytes)} of {gigabytes(
              ws.inventory.storage.totalBytes
            )} at
            <code class="break-all">{ws.inventory.storage.path}</code>
          </p>
        </Card.Content>
      </Card.Root>
    </section>

    <Card.Root>
      <Card.Header>
        <Card.Title>Logged-in sessions</Card.Title>
        <Card.Description>Interactive sessions reported by the node.</Card.Description>
      </Card.Header>
      <Card.Content class={ws.inventory.sessions.length > 0 ? 'px-0' : undefined}>
        {#if ws.inventory.sessions.length === 0}
          <p class="text-muted-foreground text-sm">No sessions reported.</p>
        {:else}
          <Table.Root>
            <Table.Header>
              <Table.Row>
                <Table.Head class="pl-6">User</Table.Head>
                <Table.Head>Terminal</Table.Head>
                <Table.Head class="pr-6">Remote host</Table.Head>
              </Table.Row>
            </Table.Header>
            <Table.Body>
              {#each ws.inventory.sessions as session (session.username + session.terminal)}
                <Table.Row>
                  <Table.Cell class="pl-6 font-medium">{session.username}</Table.Cell>
                  <Table.Cell><code>{session.terminal}</code></Table.Cell>
                  <Table.Cell class="pr-6">{session.remoteHost ?? 'Local'}</Table.Cell>
                </Table.Row>
              {/each}
            </Table.Body>
          </Table.Root>
        {/if}
      </Card.Content>
    </Card.Root>
  {:else}
    <Card.Root>
      <Card.Header>
        <Card.Title>Waiting for inventory</Card.Title>
        <Card.Description>Enroll and start this node to receive its first report.</Card.Description>
      </Card.Header>
    </Card.Root>
  {/if}
</main>
