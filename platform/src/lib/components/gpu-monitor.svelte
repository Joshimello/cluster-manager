<script lang="ts">
  import ActivityIcon from '@lucide/svelte/icons/activity';
  import ThermometerIcon from '@lucide/svelte/icons/thermometer';
  import { onMount } from 'svelte';
  import { invalidateAll } from '$app/navigation';
  import StatusBadge from '$lib/components/status-badge.svelte';
  import { Badge } from '$lib/components/ui/badge/index.js';
  import * as Card from '$lib/components/ui/card/index.js';
  import * as Table from '$lib/components/ui/table/index.js';

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
    gpus,
    gpuStatus = 'available',
    processScope = 'all'
  }: {
    gpus: GPU[];
    gpuStatus?: 'available' | 'unavailable';
    processScope?: 'all' | 'user';
  } = $props();

  const dateTime = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'medium' });
  const bytes = new Intl.NumberFormat(undefined, {
    style: 'unit',
    unit: 'gigabyte',
    maximumFractionDigits: 1
  });
  const gigabytes = (value: number) => bytes.format(value / 1_000_000_000);

  onMount(() => {
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
        <Card.Root>
          <Card.Header>
            <div class="flex flex-wrap items-start justify-between gap-3">
              <div class="space-y-1.5">
                <Card.Title>GPU {gpu.index} · {gpu.model}</Card.Title>
                <Card.Description class="break-all">{gpu.uuid}</Card.Description>
              </div>
              <StatusBadge status={gpu.telemetryState} />
            </div>
          </Card.Header>
          <Card.Content class="grid gap-5">
            <div class="grid grid-cols-2 gap-4 sm:grid-cols-3">
              <div class="grid gap-1">
                <span class="text-muted-foreground text-xs font-medium uppercase">Utilization</span>
                <strong class="text-2xl tracking-tight">{gpu.utilizationPercent.toFixed(1)}%</strong
                >
              </div>
              <div class="grid gap-1">
                <span class="text-muted-foreground text-xs font-medium uppercase">VRAM</span>
                <strong>{gigabytes(gpu.memoryUsedBytes)}</strong>
                <span class="text-muted-foreground text-xs"
                  >of {gigabytes(gpu.memoryTotalBytes)}</span
                >
              </div>
              <div class="grid gap-1">
                <span class="text-muted-foreground text-xs font-medium uppercase">Temperature</span>
                <strong class="flex items-center gap-1 text-lg">
                  <ThermometerIcon class="size-4" aria-hidden="true" />
                  {gpu.temperatureC === null ? 'N/A' : `${gpu.temperatureC.toFixed(0)} °C`}
                </strong>
              </div>
            </div>

            <div class="grid gap-2">
              <div class="flex items-center justify-between gap-3 text-sm">
                <span class="flex items-center gap-1.5 font-medium"
                  ><ActivityIcon class="size-4" aria-hidden="true" />GPU load</span
                >
                <Badge variant={gpu.processes.length > 0 ? 'default' : 'secondary'}>
                  {gpu.processes.length > 0
                    ? `${gpu.processes.length} visible processes`
                    : 'No visible processes'}
                </Badge>
              </div>
              <div
                class="bg-muted h-2 overflow-hidden rounded-full"
                role="meter"
                aria-label={`GPU ${gpu.index} utilization`}
                aria-valuemin="0"
                aria-valuemax="100"
                aria-valuenow={gpu.utilizationPercent}
              >
                <div
                  class="bg-primary h-full rounded-full transition-all"
                  style={`width: ${gpu.utilizationPercent}%`}
                ></div>
              </div>
              <span class="text-muted-foreground text-xs"
                >Observed {dateTime.format(gpu.observedAt)}</span
              >
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
