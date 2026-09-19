<script lang="ts">
  import ScanSearchIcon from '@lucide/svelte/icons/scan-search';
  import { onMount } from 'svelte';
  import { invalidateAll } from '$app/navigation';
  import { resolve } from '$app/paths';
  import CoordinationBadge from '$lib/components/coordination-badge.svelte';
  import GpuMonitor from '$lib/components/gpu-monitor.svelte';
  import PageHeader from '$lib/components/page-header.svelte';
  import { Button } from '$lib/components/ui/button/index.js';
  import * as Card from '$lib/components/ui/card/index.js';
  import type { CoordinationState } from '$lib/server/reservations/correlation';

  let { data } = $props();

  const stateOrder: CoordinationState[] = [
    'conflict',
    'unbooked-use',
    'booked-active',
    'booked-idle',
    'available',
    'unknown'
  ];
  onMount(() => {
    const timer = window.setInterval(() => void invalidateAll(), 10_000);
    return () => window.clearInterval(timer);
  });
</script>

<svelte:head><title>GPU status · Administration · Cluster Manager</title></svelte:head>

<main class="mx-auto grid w-full max-w-7xl gap-6 px-4 py-8 sm:px-6 lg:px-8">
  <PageHeader
    title="GPU status"
    description="Live reservation and observed-process correlation across every managed workstation."
  />

  <section class="grid gap-3 sm:grid-cols-2 lg:grid-cols-3" aria-label="GPU status summary">
    {#each stateOrder as state (state)}
      <!-- Query strings are appended after resolving the base path. -->
      <!-- eslint-disable svelte/no-navigation-without-resolve -->
      <a
        href={`${resolve('/admin/monitoring')}?state=${state}`}
        class="rounded-xl focus-visible:outline-none focus-visible:ring-2"
      >
        <Card.Root class={data.filter === state ? 'border-primary' : ''}>
          <Card.Header class="gap-2">
            <div class="flex items-center justify-between gap-3">
              <CoordinationBadge {state} />
              <strong class="text-2xl tabular-nums">{data.summaries[state]}</strong>
            </div>
          </Card.Header>
        </Card.Root>
      </a>
      <!-- eslint-enable svelte/no-navigation-without-resolve -->
    {/each}
  </section>

  <div class="flex flex-wrap items-center justify-between gap-3">
    <p class="text-muted-foreground text-sm">
      Showing {data.filter === 'all' ? `all ${data.total} GPUs` : `GPUs marked ${data.filter}`}.
    </p>
    {#if data.filter !== 'all'}
      <Button href={resolve('/admin/monitoring')} variant="outline" size="sm">Clear filter</Button>
    {/if}
  </div>

  {#if data.workstations.length === 0}
    <Card.Root class="border-dashed" size="sm">
      <Card.Content class="text-muted-foreground flex flex-col items-center gap-3 py-10 text-sm">
        <ScanSearchIcon class="size-9" aria-hidden="true" />
        <p>No GPUs match this filter.</p>
      </Card.Content>
    </Card.Root>
  {:else}
    {#each data.workstations as workstation (workstation.id)}
      <section class="grid gap-3" aria-labelledby={`workstation-${workstation.id}`}>
        <div>
          <h2 id={`workstation-${workstation.id}`} class="text-xl font-semibold tracking-tight">
            {workstation.displayName}
          </h2>
          <p class="text-muted-foreground text-sm">{workstation.name}</p>
        </div>
        <GpuMonitor
          gpus={workstation.gpus}
          gpuStatus={workstation.inventory?.gpuStatus ?? 'unavailable'}
          autoRefresh={false}
          timeZone={data.user.timeZone ?? 'UTC'}
        />
      </section>
    {/each}
  {/if}
</main>
