<script lang="ts">
  import ActivityIcon from '@lucide/svelte/icons/activity';
  import MemoryStickIcon from '@lucide/svelte/icons/memory-stick';
  import ThermometerIcon from '@lucide/svelte/icons/thermometer';
  import ZapIcon from '@lucide/svelte/icons/zap';
  import { onMount } from 'svelte';
  import { invalidateAll } from '$app/navigation';
  import CoordinationBadge from '$lib/components/coordination-badge.svelte';
  import { getMonitoringHistoryContext } from '$lib/components/monitoring-history-context';
  import StatusBadge from '$lib/components/status-badge.svelte';
  import TelemetryLineChart from '$lib/components/telemetry-line-chart.svelte';
  import { Badge } from '$lib/components/ui/badge/index.js';
  import { Button } from '$lib/components/ui/button/index.js';
  import * as Card from '$lib/components/ui/card/index.js';
  import * as Table from '$lib/components/ui/table/index.js';
  import type { CoordinationState } from '$lib/server/reservations/correlation';

  type Metric = 'utilization' | 'memory' | 'temperature' | 'power';

  type GPU = {
    id: string;
    uuid: string;
    index: number;
    model: string;
    observedAt: Date;
    telemetryState: string;
    utilizationPercent: number;
    memoryUsedBytes: number;
    memoryTotalBytes: number;
    temperatureC: number | null;
    powerWatts: number | null;
    coordinationState: CoordinationState;
    processCount: number;
    ownerProcessCount: number;
    otherProcessCount: number;
    reservation: null | {
      id: string;
      ownerLabel: string;
      username: string | null;
      startAt: Date;
      endAt: Date;
      isViewer: boolean;
    };
    processes: Array<{
      id: string;
      pid: number;
      uid: number;
      username: string;
      command: string;
      memoryUsedBytes: number;
      processStartTicks: number | null;
    }>;
  };

  let {
    workstationId,
    gpus,
    gpuStatus = 'available',
    processScope = 'all',
    autoRefresh = true,
    allowStopRequests = false,
    timeZone = 'UTC'
  }: {
    workstationId: string;
    gpus: GPU[];
    gpuStatus?: 'available' | 'unavailable';
    processScope?: 'all' | 'user';
    autoRefresh?: boolean;
    allowStopRequests?: boolean;
    timeZone?: string;
  } = $props();

  const historyContext = getMonitoringHistoryContext();
  let selectedMetrics = $state<Record<string, Metric>>({});

  let dateTime = $derived(
    new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'medium', timeZone })
  );
  const bytes = new Intl.NumberFormat(undefined, {
    style: 'unit',
    unit: 'gigabyte',
    maximumFractionDigits: 1
  });
  const gigabytes = (value: number) => bytes.format(value / 1_000_000_000);
  const numeric = new Intl.NumberFormat(undefined, { maximumFractionDigits: 1 });
  const percent = (value: number) => `${numeric.format(value)}%`;
  const celsius = (value: number) => `${numeric.format(value)} °C`;
  const watts = (value: number) => `${numeric.format(value)} W`;
  const selectedMetric = (gpuId: string): Metric => selectedMetrics[gpuId] ?? 'utilization';
  const historyFor = (gpuId: string) =>
    historyContext?.response?.workstations
      .find((workstation) => workstation.workstationId === workstationId)
      ?.gpus.find((gpu) => gpu.gpuId === gpuId)?.points ?? [];
  const metricLabel = (metric: Metric) =>
    metric === 'utilization'
      ? 'GPU utilization'
      : metric === 'memory'
        ? 'VRAM used'
        : metric === 'temperature'
          ? 'Temperature'
          : 'Power draw';
  const currentValue = (gpu: GPU, metric: Metric) => {
    if (metric === 'utilization') return percent(gpu.utilizationPercent);
    if (metric === 'temperature')
      return gpu.temperatureC === null ? 'N/A' : celsius(gpu.temperatureC);
    if (metric === 'power') return gpu.powerWatts === null ? 'N/A' : watts(gpu.powerWatts);
    const usage =
      gpu.memoryTotalBytes === 0 ? 0 : (gpu.memoryUsedBytes / gpu.memoryTotalBytes) * 100;
    return `${gigabytes(gpu.memoryUsedBytes)} of ${gigabytes(gpu.memoryTotalBytes)} · ${percent(usage)}`;
  };
  const chartPoints = (gpu: GPU, metric: Metric) =>
    historyFor(gpu.id).map((point) => {
      if (metric === 'utilization') {
        return {
          observedAt: point.observedAt,
          value: point.utilizationPercent,
          detail: percent(point.utilizationPercent)
        };
      }
      if (metric === 'temperature') {
        return {
          observedAt: point.observedAt,
          value: point.temperatureC,
          detail: point.temperatureC === null ? 'N/A' : celsius(point.temperatureC)
        };
      }
      if (metric === 'power') {
        return {
          observedAt: point.observedAt,
          value: point.powerWatts,
          detail: point.powerWatts === null ? 'N/A' : watts(point.powerWatts)
        };
      }
      const usage =
        point.memoryTotalBytes === 0 ? 0 : (point.memoryUsedBytes / point.memoryTotalBytes) * 100;
      return {
        observedAt: point.observedAt,
        value: point.memoryUsedBytes / 1_000_000_000,
        detail: `${gigabytes(point.memoryUsedBytes)} of ${gigabytes(point.memoryTotalBytes)} · ${percent(usage)}`
      };
    });
  const maximum = (gpu: GPU, metric: Metric) => {
    if (metric === 'utilization') return 100;
    if (metric === 'memory') return gpu.memoryTotalBytes / 1_000_000_000;
    if (metric === 'power') {
      const observed = historyFor(gpu.id)
        .map((point) => point.powerWatts ?? 0)
        .concat(gpu.powerWatts ?? 0);
      return Math.max(100, Math.ceil(Math.max(...observed) / 50) * 50);
    }
    const observed = historyFor(gpu.id)
      .map((point) => point.temperatureC ?? 0)
      .concat(gpu.temperatureC ?? 0);
    return Math.max(100, Math.ceil(Math.max(...observed) / 10) * 10);
  };
  const valueFormatter = (metric: Metric) =>
    metric === 'utilization'
      ? percent
      : metric === 'temperature'
        ? celsius
        : metric === 'power'
          ? watts
          : (value: number) => bytes.format(value);
  const coordinationDescription = (gpu: GPU) => {
    if (gpu.coordinationState === 'unknown') return 'Fresh telemetry is required to determine use.';
    if (gpu.coordinationState === 'available') return 'No current reservation or observed process.';
    if (gpu.coordinationState === 'unbooked-use')
      return `${gpu.processCount} observed process${gpu.processCount === 1 ? '' : 'es'} without a reservation.`;
    if (gpu.coordinationState === 'booked-idle') return 'Reserved, with no GPU process observed.';
    if (gpu.coordinationState === 'booked-active')
      return `${gpu.ownerProcessCount} owner process${gpu.ownerProcessCount === 1 ? '' : 'es'} observed.`;
    return `${gpu.otherProcessCount} non-owner or unresolved process${gpu.otherProcessCount === 1 ? '' : 'es'} observed.`;
  };

  onMount(() => {
    if (!autoRefresh) return;
    const timer = window.setInterval(() => void invalidateAll(), 10_000);
    return () => window.clearInterval(timer);
  });
</script>

{#if gpuStatus === 'unavailable'}
  <Card.Root class="border-dashed" size="sm">
    <Card.Header>
      <Card.Title>NVIDIA telemetry unavailable</Card.Title>
      <Card.Description
        >The node is online, but no usable NVIDIA driver or hardware was detected. Previously
        reported devices are not presented as current.</Card.Description
      >
    </Card.Header>
  </Card.Root>
{:else if gpus.length === 0}
  <Card.Root class="border-dashed" size="sm">
    <Card.Header>
      <Card.Title>No NVIDIA GPUs reported</Card.Title>
      <Card.Description>The node reported a valid empty GPU inventory.</Card.Description>
    </Card.Header>
  </Card.Root>
{:else}
  <section class="grid gap-4" aria-label="GPU monitoring">
    <div class="grid gap-4 lg:grid-cols-2">
      {#each gpus as gpu (gpu.id)}
        {@const metric = selectedMetric(gpu.id)}
        <Card.Root>
          <Card.Header>
            <div class="flex flex-wrap items-start justify-between gap-3">
              <div class="space-y-1.5">
                <Card.Title>GPU {gpu.index} · {gpu.model}</Card.Title>
                <Card.Description class="break-all">{gpu.uuid}</Card.Description>
              </div>
              <div class="flex flex-wrap justify-end gap-2">
                <CoordinationBadge state={gpu.coordinationState} />
                <StatusBadge status={gpu.telemetryState} />
              </div>
            </div>
          </Card.Header>
          <Card.Content class="grid gap-5">
            <div class="flex min-w-0 flex-wrap items-center justify-between gap-3">
              <div class="grid min-w-0 flex-1 basis-64 gap-1">
                <span class="text-muted-foreground text-xs font-medium uppercase"
                  >{metricLabel(metric)}</span
                >
                <strong
                  class="max-w-full text-xl leading-tight tracking-tight break-words tabular-nums sm:text-2xl"
                  >{currentValue(gpu, metric)}</strong
                >
              </div>
              <div class="flex max-w-full flex-wrap gap-1" aria-label={`GPU ${gpu.index} metric`}>
                <Button
                  type="button"
                  size="sm"
                  variant={metric === 'utilization' ? 'default' : 'outline'}
                  aria-pressed={metric === 'utilization'}
                  onclick={() => (selectedMetrics[gpu.id] = 'utilization')}
                  ><ActivityIcon aria-hidden="true" />Utilization</Button
                >
                <Button
                  type="button"
                  size="sm"
                  variant={metric === 'memory' ? 'default' : 'outline'}
                  aria-pressed={metric === 'memory'}
                  onclick={() => (selectedMetrics[gpu.id] = 'memory')}
                  ><MemoryStickIcon aria-hidden="true" />VRAM</Button
                >
                <Button
                  type="button"
                  size="sm"
                  variant={metric === 'temperature' ? 'default' : 'outline'}
                  aria-pressed={metric === 'temperature'}
                  onclick={() => (selectedMetrics[gpu.id] = 'temperature')}
                  ><ThermometerIcon aria-hidden="true" />Temperature</Button
                >
                <Button
                  type="button"
                  size="sm"
                  variant={metric === 'power' ? 'default' : 'outline'}
                  aria-pressed={metric === 'power'}
                  onclick={() => (selectedMetrics[gpu.id] = 'power')}
                  ><ZapIcon aria-hidden="true" />Power</Button
                >
              </div>
            </div>

            {#if historyContext?.loading && historyFor(gpu.id).length === 0}
              <div
                class="bg-muted/30 text-muted-foreground grid h-52 animate-pulse place-items-center rounded-md border text-sm"
              >
                Loading GPU history…
              </div>
            {:else}
              <TelemetryLineChart
                points={chartPoints(gpu, metric)}
                bucketSeconds={historyContext?.response?.bucketSeconds ?? 30}
                {timeZone}
                label={metricLabel(metric)}
                ariaLabel={`GPU ${gpu.index} ${metricLabel(metric)} history`}
                valueFormatter={valueFormatter(metric)}
                axisFormatter={valueFormatter(metric)}
                maximum={maximum(gpu, metric)}
              />
            {/if}

            <div class="bg-muted/50 grid gap-1 rounded-md border px-3 py-2 text-sm">
              <div class="flex flex-wrap items-center justify-between gap-2">
                <strong>Coordination</strong>
                {#if gpu.reservation}
                  <span>
                    Reserved by {gpu.reservation.ownerLabel}{gpu.reservation.username
                      ? ` (${gpu.reservation.username})`
                      : ''}
                  </span>
                {/if}
              </div>
              <span class="text-muted-foreground">{coordinationDescription(gpu)}</span>
              {#if gpu.reservation}
                <span class="text-muted-foreground text-xs">
                  {dateTime.format(gpu.reservation.startAt)}–{dateTime.format(
                    gpu.reservation.endAt
                  )}
                </span>
              {/if}
              {#if allowStopRequests && gpu.coordinationState === 'conflict' && gpu.reservation?.isViewer}
                <form method="POST" action="/stop-requests?/create" class="mt-2">
                  <input type="hidden" name="gpuId" value={gpu.id} />
                  <Button type="submit" variant="destructive" size="sm">Request intervention</Button
                  >
                </form>
              {/if}
            </div>

            <div class="grid gap-2">
              <div class="flex items-center justify-between gap-3 text-sm">
                <span class="font-medium">Current activity</span>
                <Badge variant={gpu.processCount > 0 ? 'default' : 'secondary'}>
                  {gpu.processCount > 0
                    ? `${gpu.processCount} observed process${gpu.processCount === 1 ? '' : 'es'}`
                    : 'No observed processes'}
                </Badge>
              </div>
              <div class="flex flex-wrap items-center justify-between gap-2 text-xs">
                <span class="text-muted-foreground">Observed {dateTime.format(gpu.observedAt)}</span
                >
                {#if historyContext?.error}
                  <span class="text-destructive"
                    >History refresh failed; showing available data.</span
                  >
                {/if}
              </div>
            </div>
          </Card.Content>
        </Card.Root>
      {/each}
    </div>

    <Card.Root>
      <Card.Header>
        <Card.Title>{processScope === 'user' ? 'Your GPU processes' : 'GPU processes'}</Card.Title>
        <Card.Description>
          {processScope === 'user'
            ? 'Only processes attributed to your Linux username are shown.'
            : 'Commands are limited to executable names; arguments and environment variables are never collected.'}
        </Card.Description>
      </Card.Header>
      {@const processes = gpus.flatMap((gpu) =>
        gpu.processes.map((process) => ({ ...process, gpuIndex: gpu.index }))
      )}
      <Card.Content class={processes.length > 0 ? 'px-0' : undefined}>
        {#if processes.length === 0}
          <p class="text-muted-foreground text-sm">
            No GPU processes are visible in the latest sample.
          </p>
        {:else}
          <Table.Root>
            <Table.Header>
              <Table.Row>
                <Table.Head class="pl-6">GPU</Table.Head>
                <Table.Head>User</Table.Head>
                <Table.Head>PID</Table.Head>
                <Table.Head>Command</Table.Head>
                <Table.Head class="pr-6 text-right">GPU memory</Table.Head>
              </Table.Row>
            </Table.Header>
            <Table.Body>
              {#each processes as process (process.id)}
                <Table.Row>
                  <Table.Cell class="pl-6 font-medium">{process.gpuIndex}</Table.Cell>
                  <Table.Cell
                    >{process.username}{processScope === 'all'
                      ? ` (${process.uid})`
                      : ''}</Table.Cell
                  >
                  <Table.Cell><code>{process.pid}</code></Table.Cell>
                  <Table.Cell><code>{process.command}</code></Table.Cell>
                  <Table.Cell class="pr-6 text-right"
                    >{gigabytes(process.memoryUsedBytes)}</Table.Cell
                  >
                </Table.Row>
              {/each}
            </Table.Body>
          </Table.Root>
        {/if}
      </Card.Content>
    </Card.Root>
  </section>
{/if}
