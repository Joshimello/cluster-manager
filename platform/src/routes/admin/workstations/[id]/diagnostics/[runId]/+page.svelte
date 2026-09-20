<script lang="ts">
  import ArrowLeftIcon from '@lucide/svelte/icons/arrow-left';
  import { onMount } from 'svelte';
  import { invalidateAll } from '$app/navigation';
  import { resolve } from '$app/paths';
  import FeedbackAlert from '$lib/components/feedback-alert.svelte';
  import GpuMonitor from '$lib/components/gpu-monitor.svelte';
  import MonitoringHistoryProvider from '$lib/components/monitoring-history-provider.svelte';
  import PageHeader from '$lib/components/page-header.svelte';
  import StatusBadge from '$lib/components/status-badge.svelte';
  import { Button } from '$lib/components/ui/button/index.js';
  import * as Card from '$lib/components/ui/card/index.js';
  import * as Table from '$lib/components/ui/table/index.js';

  let { data, form } = $props();
  let active = $derived(
    ['pending', 'dispatched', 'running', 'cancel_requested'].includes(data.run.status)
  );
  let dateTime = $derived(
    new Intl.DateTimeFormat(undefined, {
      dateStyle: 'medium',
      timeStyle: 'medium',
      timeZone: data.user.timeZone ?? 'UTC'
    })
  );
  let remaining = $state(0);
  const storage = new Intl.NumberFormat(undefined, { maximumFractionDigits: 1 });
  const formatMemory = (bytes: number | null) =>
    bytes === null ? '—' : `${storage.format(bytes / 1_000_000_000)} GB`;

  function updateRemaining() {
    if (!data.run.startedAt || !active) {
      remaining = 0;
      return;
    }
    remaining = Math.max(
      0,
      Math.ceil(
        (new Date(data.run.startedAt).getTime() + data.run.durationSeconds * 1000 - Date.now()) /
          1000
      )
    );
  }

  onMount(() => {
    updateRemaining();
    const timer = window.setInterval(() => {
      updateRemaining();
      if (active) void invalidateAll();
    }, 5_000);
    return () => window.clearInterval(timer);
  });
</script>

<svelte:head><title>GPU diagnostic · {data.workstation.name} · Cluster Manager</title></svelte:head>

<MonitoringHistoryProvider
  workstationIds={[data.workstation.id]}
  range="15m"
  from={new Date(
    new Date(data.run.startedAt ?? data.run.createdAt).getTime() - 10_000
  ).toISOString()}
  to={new Date(
    Math.min(
      Date.now(),
      new Date(data.run.completedAt ?? Date.now()).getTime() + (data.run.completedAt ? 10_000 : 0)
    )
  ).toISOString()}
>
  <main class="mx-auto grid w-full max-w-7xl gap-6 px-4 py-8 sm:px-6 lg:px-8">
    <Button
      variant="ghost"
      size="sm"
      href={resolve(`/admin/workstations/${data.workstation.id}`)}
      class="w-fit"
    >
      <ArrowLeftIcon aria-hidden="true" />
      {data.workstation.name}
    </Button>

    <div class="flex flex-wrap items-end justify-between gap-4">
      <PageHeader
        title="GPU diagnostic"
        description={`Requested by ${data.requester.displayName} (${data.requester.username}) · ${dateTime.format(data.run.createdAt)}`}
      />
      <StatusBadge status={data.run.status} />
    </div>

    {#if form?.message}<FeedbackAlert message={form.message} success={form.success} />{/if}

    <Card.Root>
      <Card.Header>
        <Card.Title>{data.run.scope === 'all' ? 'All GPUs' : 'Single GPU'} stress test</Card.Title>
        <Card.Description>{data.run.detail ?? 'Waiting for the node.'}</Card.Description>
      </Card.Header>
      <Card.Content class="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
        <div>
          <span class="text-muted-foreground text-sm">Duration</span><strong class="block"
            >{data.run.durationSeconds}s</strong
          >
        </div>
        <div>
          <span class="text-muted-foreground text-sm">VRAM</span><strong class="block"
            >{data.run.memoryPercent}%</strong
          >
        </div>
        <div>
          <span class="text-muted-foreground text-sm">Workload</span><strong class="block"
            >{data.run.workload.toUpperCase()}</strong
          >
        </div>
        <div>
          <span class="text-muted-foreground text-sm">Thermal cutoff</span><strong class="block"
            >{data.run.temperatureCutoffC} °C</strong
          >
        </div>
        <div>
          <span class="text-muted-foreground text-sm">Remaining</span><strong class="block"
            >{active && data.run.startedAt ? `${remaining}s` : '—'}</strong
          >
        </div>
      </Card.Content>
      {#if data.run.status === 'running'}
        <Card.Footer>
          <form method="POST" action="?/cancel">
            <Button type="submit" variant="destructive">Cancel test</Button>
          </form>
        </Card.Footer>
      {/if}
    </Card.Root>

    <section class="grid gap-3">
      <div>
        <h2 class="text-xl font-semibold">Live target telemetry</h2>
        <p class="text-muted-foreground text-sm">Charts refresh while the diagnostic is active.</p>
      </div>
      <GpuMonitor
        workstationId={data.workstation.id}
        gpus={data.gpus}
        gpuStatus="available"
        timeZone={data.user.timeZone ?? 'UTC'}
      />
    </section>

    {#if data.results.length > 0}
      <Card.Root>
        <Card.Header><Card.Title>Per-GPU results</Card.Title></Card.Header>
        <Card.Content class="px-0">
          <Table.Root>
            <Table.Header
              ><Table.Row
                ><Table.Head class="pl-6">GPU</Table.Head><Table.Head>Outcome</Table.Head
                ><Table.Head>Errors</Table.Head><Table.Head>Peak readings</Table.Head><Table.Head
                  class="pr-6">Performance</Table.Head
                ></Table.Row
              ></Table.Header
            >
            <Table.Body>
              {#each data.results as result (result.id)}
                <Table.Row>
                  <Table.Cell class="pl-6"
                    ><strong>GPU {result.localIndex}</strong><span
                      class="text-muted-foreground block text-xs">{result.model}</span
                    ></Table.Cell
                  >
                  <Table.Cell><StatusBadge status={result.outcome} /></Table.Cell>
                  <Table.Cell>{result.errorCount}</Table.Cell>
                  <Table.Cell class="text-sm">
                    <span class="block"
                      >{result.maxTemperatureC === null
                        ? '—'
                        : `${result.maxTemperatureC.toFixed(1)} °C`}</span
                    >
                    <span class="text-muted-foreground block text-xs">
                      {result.peakUtilizationPercent === null
                        ? '—'
                        : `${result.peakUtilizationPercent.toFixed(1)}%`} util ·
                      {formatMemory(result.peakMemoryBytes)} VRAM
                    </span>
                  </Table.Cell>
                  <Table.Cell class="pr-6 text-sm">
                    <span class="block"
                      >{result.maximumGflops === null
                        ? '—'
                        : `${result.maximumGflops.toFixed(1)} GFLOP/s max`}</span
                    >
                    {#if result.averageGflops !== null}
                      <span class="text-muted-foreground block text-xs"
                        >{result.averageGflops.toFixed(1)} GFLOP/s average</span
                      >
                    {/if}
                  </Table.Cell>
                </Table.Row>
              {/each}
            </Table.Body>
          </Table.Root>
        </Card.Content>
      </Card.Root>
    {/if}

    {#if data.run.outputLog}
      <Card.Root
        ><Card.Header><Card.Title>Bounded diagnostic log</Card.Title></Card.Header><Card.Content
          ><pre
            class="bg-muted max-h-96 overflow-auto rounded-md p-4 text-xs whitespace-pre-wrap">{data
              .run.outputLog}</pre></Card.Content
        ></Card.Root
      >
    {/if}
  </main>
</MonitoringHistoryProvider>
