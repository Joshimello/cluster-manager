<script lang="ts">
  import { LineChart } from 'layerchart';

  import * as Chart from '$lib/components/ui/chart/index.js';

  export type TelemetryChartPoint = {
    observedAt: string;
    value: number | null;
    detail: string;
  };

  let {
    points,
    bucketSeconds,
    timeZone,
    label,
    ariaLabel,
    valueFormatter,
    axisFormatter = valueFormatter,
    maximum
  }: {
    points: TelemetryChartPoint[];
    bucketSeconds: number;
    timeZone: string;
    label: string;
    ariaLabel: string;
    valueFormatter: (value: number) => string;
    axisFormatter?: (value: number) => string;
    maximum?: number;
  } = $props();

  const chartConfig = $derived({
    value: { label, color: 'var(--chart-2)' }
  } satisfies Chart.ChartConfig);
  const time = $derived(
    new Intl.DateTimeFormat(undefined, {
      hour: 'numeric',
      minute: '2-digit',
      second: '2-digit',
      timeZone
    })
  );
  const axisTime = $derived(
    new Intl.DateTimeFormat(undefined, {
      hour: 'numeric',
      minute: '2-digit',
      timeZone
    })
  );

  const data = $derived.by(() => {
    const result: Array<{
      observedAt: Date;
      value: number | null;
      detail: string;
      gap: boolean;
    }> = [];
    let previous: Date | null = null;
    for (const point of points) {
      const observedAt = new Date(point.observedAt);
      if (previous && observedAt.getTime() - previous.getTime() > bucketSeconds * 2 * 1000) {
        result.push({
          observedAt: new Date(previous.getTime() + bucketSeconds * 1000),
          value: null,
          detail: '',
          gap: true
        });
      }
      result.push({ ...point, observedAt, gap: false });
      previous = observedAt;
    }
    return result;
  });
  const hasValues = $derived(data.some((point) => point.value !== null));
  const yDomain = $derived(maximum === undefined ? undefined : [0, maximum]);
</script>

{#if hasValues}
  <div role="img" aria-label={ariaLabel}>
    <Chart.Container config={chartConfig} class="h-52 w-full aspect-auto">
      <LineChart
        {data}
        x="observedAt"
        y="value"
        {yDomain}
        padding={{ top: 8, right: 44, bottom: 32, left: 76 }}
        series={[
          {
            key: 'value',
            label,
            color: 'var(--color-value)',
            props: {
              defined: (point: (typeof data)[number]) => point.value !== null,
              strokeWidth: 2
            }
          }
        ]}
        props={{
          xAxis: {
            format: (value: Date) => axisTime.format(value),
            ticks: 5,
            tickOcclusion: { priority: 'start-end', padding: 12 }
          },
          yAxis: { format: (value: number) => axisFormatter(value) },
          grid: { y: true }
        }}
      >
        {#snippet tooltip()}
          <Chart.Tooltip labelFormatter={(value) => time.format(value as Date)}>
            {#snippet formatter({ value, data: tooltipData })}
              <div class="flex min-w-36 items-center justify-between gap-4">
                <span class="text-muted-foreground">{label}</span>
                <span class="font-mono font-medium tabular-nums">
                  {tooltipData?.detail ?? valueFormatter(Number(value))}
                </span>
              </div>
            {/snippet}
          </Chart.Tooltip>
        {/snippet}
      </LineChart>
    </Chart.Container>
  </div>
{:else}
  <div
    class="bg-muted/30 text-muted-foreground grid h-52 place-items-center rounded-md border border-dashed px-4 text-center text-sm"
  >
    No historical readings are available for this metric yet.
  </div>
{/if}
