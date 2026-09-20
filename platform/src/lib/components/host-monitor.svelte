<script lang="ts">
  import CpuIcon from '@lucide/svelte/icons/cpu';
  import DatabaseIcon from '@lucide/svelte/icons/database';
  import MemoryStickIcon from '@lucide/svelte/icons/memory-stick';

  import { getMonitoringHistoryContext } from '$lib/components/monitoring-history-context';
  import StatusBadge from '$lib/components/status-badge.svelte';
  import TelemetryLineChart from '$lib/components/telemetry-line-chart.svelte';
  import { Button } from '$lib/components/ui/button/index.js';
  import * as Card from '$lib/components/ui/card/index.js';

  type Inventory = {
    cpu: { model: string; logicalCores: number; utilizationPercent: number };
    memory: { usedBytes: number; totalBytes: number; utilizationPercent: number };
    storage: { path: string; usedBytes: number; totalBytes: number; utilizationPercent: number };
  };
  type Metric = 'cpu' | 'memory' | 'storage';

  let {
    workstationId,
    inventory,
    observedAt,
    telemetryState,
    timeZone = 'UTC'
  }: {
    workstationId: string;
    inventory: Inventory;
    observedAt: Date | null;
    telemetryState: string;
    timeZone?: string;
  } = $props();

  const historyContext = getMonitoringHistoryContext();
  let metric = $state<Metric>('cpu');
  const history = $derived(
    historyContext?.response?.workstations.find((item) => item.workstationId === workstationId)
  );
  const bucketSeconds = $derived(historyContext?.response?.bucketSeconds ?? 30);
  const number = new Intl.NumberFormat(undefined, { maximumFractionDigits: 1 });
  const gigabytes = new Intl.NumberFormat(undefined, {
    style: 'unit',
    unit: 'gigabyte',
    maximumFractionDigits: 1
  });
  const dateTime = $derived(
    new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'medium', timeZone })
  );
  const gb = (value: number) => value / 1_000_000_000;
  const percent = (value: number) => `${number.format(value)}%`;
  const formattedGb = (value: number) => gigabytes.format(value);

  const metricLabel = $derived(
    metric === 'cpu' ? 'CPU utilization' : metric === 'memory' ? 'Memory used' : 'Storage used'
  );
  const currentValue = $derived.by(() => {
    if (metric === 'cpu') return percent(inventory.cpu.utilizationPercent);
    const current = metric === 'memory' ? inventory.memory : inventory.storage;
    return `${gigabytes.format(gb(current.usedBytes))} of ${gigabytes.format(gb(current.totalBytes))} · ${percent(current.utilizationPercent)}`;
  });
  const detail = $derived(
    metric === 'cpu'
      ? `${inventory.cpu.model} · ${inventory.cpu.logicalCores} logical cores`
      : metric === 'memory'
        ? 'Physical memory reported by the node'
        : `Root filesystem at ${inventory.storage.path}`
  );
  const chartPoints = $derived(
    (history?.points ?? []).map((point) => {
      if (metric === 'cpu') {
        return {
          observedAt: point.observedAt,
          value: point.cpuUtilizationPercent,
          detail: percent(point.cpuUtilizationPercent)
        };
      }
      const used = metric === 'memory' ? point.memoryUsedBytes : point.storageUsedBytes;
      const total = metric === 'memory' ? point.memoryTotalBytes : point.storageTotalBytes;
      return {
        observedAt: point.observedAt,
        value: gb(used),
        detail: `${gigabytes.format(gb(used))} of ${gigabytes.format(gb(total))} · ${percent(total === 0 ? 0 : (used / total) * 100)}`
      };
    })
  );
  const maximum = $derived(
    metric === 'cpu'
      ? 100
      : gb(metric === 'memory' ? inventory.memory.totalBytes : inventory.storage.totalBytes)
  );
</script>

<Card.Root>
  <Card.Header>
    <div class="flex flex-wrap items-start justify-between gap-3">
      <div class="space-y-1.5">
        <Card.Title>System resources</Card.Title>
        <Card.Description>{detail}</Card.Description>
      </div>
      <StatusBadge status={telemetryState} />
    </div>
  </Card.Header>
  <Card.Content class="grid gap-4">
    <div class="flex min-w-0 flex-wrap items-center justify-between gap-3">
      <div class="grid min-w-0 flex-1 basis-64 gap-1">
        <span class="text-muted-foreground text-xs font-medium uppercase">{metricLabel}</span>
        <strong
          class="max-w-full text-xl leading-tight tracking-tight break-words tabular-nums sm:text-2xl"
          >{currentValue}</strong
        >
      </div>
      <div class="flex max-w-full flex-wrap gap-1" aria-label="System resource metric">
        <Button
          type="button"
          size="sm"
          variant={metric === 'cpu' ? 'default' : 'outline'}
          aria-pressed={metric === 'cpu'}
          onclick={() => (metric = 'cpu')}><CpuIcon aria-hidden="true" />CPU</Button
        >
        <Button
          type="button"
          size="sm"
          variant={metric === 'memory' ? 'default' : 'outline'}
          aria-pressed={metric === 'memory'}
          onclick={() => (metric = 'memory')}><MemoryStickIcon aria-hidden="true" />Memory</Button
        >
        <Button
          type="button"
          size="sm"
          variant={metric === 'storage' ? 'default' : 'outline'}
          aria-pressed={metric === 'storage'}
          onclick={() => (metric = 'storage')}><DatabaseIcon aria-hidden="true" />Storage</Button
        >
      </div>
    </div>

    {#if historyContext?.loading && !history}
      <div
        class="bg-muted/30 text-muted-foreground grid h-52 animate-pulse place-items-center rounded-md border text-sm"
      >
        Loading resource history…
      </div>
    {:else}
      <TelemetryLineChart
        points={chartPoints}
        {bucketSeconds}
        {timeZone}
        label={metricLabel}
        ariaLabel={`${metricLabel} history`}
        valueFormatter={metric === 'cpu' ? percent : formattedGb}
        axisFormatter={metric === 'cpu' ? percent : formattedGb}
        {maximum}
      />
    {/if}

    <div class="flex flex-wrap items-center justify-between gap-2 text-xs">
      <span class="text-muted-foreground">
        {observedAt
          ? `Current reading observed ${dateTime.format(observedAt)}`
          : 'No current reading'}
      </span>
      {#if historyContext?.error}
        <span class="text-destructive"
          >History refresh failed; showing the last available data.</span
        >
      {/if}
    </div>
  </Card.Content>
</Card.Root>
