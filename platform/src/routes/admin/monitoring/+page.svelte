<script lang="ts">
  import ScanSearchIcon from '@lucide/svelte/icons/scan-search';
  import { onMount } from 'svelte';
  import { SvelteURLSearchParams } from 'svelte/reactivity';
  import { invalidateAll } from '$app/navigation';
  import { resolve } from '$app/paths';
  import CoordinationBadge from '$lib/components/coordination-badge.svelte';
  import GpuMonitor from '$lib/components/gpu-monitor.svelte';
  import HostMonitor from '$lib/components/host-monitor.svelte';
  import MonitoringHistoryProvider from '$lib/components/monitoring-history-provider.svelte';
  import MonitoringRangeSelector from '$lib/components/monitoring-range-selector.svelte';
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
  const monitoringUrl = (state?: CoordinationState) => {
    const parameters = new SvelteURLSearchParams();
    if (state) parameters.set('state', state);
    if (data.range !== '1h') parameters.set('range', data.range);
    const query = parameters.toString();
    return `${resolve('/admin/monitoring')}${query ? `?${query}` : ''}`;
  };
  onMount(() => {
    const timer = window.setInterval(() => void invalidateAll(), 10_000);
    return () => window.clearInterval(timer);
  });
</script>

<svelte:head><title>GPU status · Administration · Cluster Manager</title></svelte:head>

<MonitoringHistoryProvider
  workstationIds={data.workstations.map((workstation) => workstation.id)}
  range={data.range}
>
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
          href={monitoringUrl(state)}
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
      <div class="flex flex-wrap items-center gap-2">
        <MonitoringRangeSelector range={data.range} />
        {#if data.filter !== 'all'}
          <Button href={monitoringUrl()} variant="outline" size="sm">Clear filter</Button>
        {/if}
      </div>
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
          {#if workstation.inventory}
            <HostMonitor
              workstationId={workstation.id}
              inventory={workstation.inventory}
              observedAt={workstation.inventoryObservedAt}
              telemetryState={workstation.connectionState}
              timeZone={data.user.timeZone ?? 'UTC'}
            />
          {/if}
          <GpuMonitor
            workstationId={workstation.id}
            gpus={workstation.gpus}
            gpuStatus={workstation.inventory?.gpuStatus ?? 'unavailable'}
            autoRefresh={false}
            timeZone={data.user.timeZone ?? 'UTC'}
          />
        </section>
      {/each}
    {/if}
  </main>
</MonitoringHistoryProvider>
