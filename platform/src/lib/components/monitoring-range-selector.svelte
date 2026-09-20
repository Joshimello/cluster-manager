<script lang="ts">
  import { goto } from '$app/navigation';
  import { page } from '$app/state';
  import { Button } from '$lib/components/ui/button/index.js';
  import {
    monitoringRangeConfig,
    monitoringRanges,
    type MonitoringRange
  } from '$lib/monitoring-history';

  let { range }: { range: MonitoringRange } = $props();

  function select(next: MonitoringRange) {
    const url = new URL(page.url);
    if (next === '1h') url.searchParams.delete('range');
    else url.searchParams.set('range', next);
    // The current typed route is preserved; only its query string changes.
    // eslint-disable-next-line svelte/no-navigation-without-resolve
    void goto(url, { keepFocus: true, noScroll: true });
  }
</script>

<div class="flex flex-wrap items-center gap-1" aria-label="Monitoring time range">
  {#each monitoringRanges as option (option)}
    <Button
      type="button"
      size="sm"
      variant={range === option ? 'default' : 'outline'}
      aria-pressed={range === option}
      onclick={() => select(option)}
    >
      {monitoringRangeConfig[option].label}
    </Button>
  {/each}
</div>
