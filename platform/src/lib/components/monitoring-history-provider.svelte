<script lang="ts">
  import { onMount, untrack, type Snippet } from 'svelte';
  import { SvelteURLSearchParams } from 'svelte/reactivity';

  import { setMonitoringHistoryContext } from '$lib/components/monitoring-history-context';
  import type { MonitoringHistoryResponse, MonitoringRange } from '$lib/monitoring-history';

  let {
    workstationIds,
    range,
    from,
    to,
    children
  }: {
    workstationIds: string[];
    range: MonitoringRange;
    from?: string;
    to?: string;
    children: Snippet;
  } = $props();

  let response = $state<MonitoringHistoryResponse | null>(null);
  let loading = $state(true);
  let error = $state<string | null>(null);
  let activeController: AbortController | null = null;

  setMonitoringHistoryContext({
    get response() {
      return response;
    },
    get loading() {
      return loading;
    },
    get error() {
      return error;
    }
  });

  function chunks<T>(values: T[], size: number): T[][] {
    const result: T[][] = [];
    for (let index = 0; index < values.length; index += size) {
      result.push(values.slice(index, index + size));
    }
    return result;
  }

  async function refresh(
    requestedIds = workstationIds,
    requestedRange = range,
    requestedFrom = from,
    requestedTo = to
  ) {
    const ids = [...new Set(requestedIds)];
    if (ids.length === 0) {
      response = null;
      loading = false;
      error = null;
      return;
    }

    activeController?.abort();
    const controller = new AbortController();
    activeController = controller;
    loading = response === null;

    try {
      const batches = await Promise.all(
        chunks(ids, 100).map(async (batch) => {
          const parameters = new SvelteURLSearchParams({ range: requestedRange });
          if (requestedFrom && requestedTo) {
            parameters.set('from', requestedFrom);
            parameters.set('to', requestedTo);
          }
          for (const workstationId of batch) parameters.append('workstationId', workstationId);
          const fetched = await fetch(`/api/monitoring/history?${parameters}`, {
            signal: controller.signal,
            headers: { accept: 'application/json' }
          });
          if (!fetched.ok) throw new Error(`Telemetry history request failed (${fetched.status}).`);
          return (await fetched.json()) as MonitoringHistoryResponse;
        })
      );

      if (controller.signal.aborted) return;
      const first = batches[0];
      response = {
        ...first,
        workstations: batches.flatMap((batch) => batch.workstations)
      };
      error = null;
    } catch (caught) {
      if (!controller.signal.aborted) {
        error = caught instanceof Error ? caught.message : 'Telemetry history could not be loaded.';
      }
    } finally {
      if (!controller.signal.aborted) loading = false;
    }
  }

  $effect(() => {
    const requestedIds = workstationIds;
    const requestedRange = range;
    const requestedFrom = from;
    const requestedTo = to;
    untrack(() => void refresh(requestedIds, requestedRange, requestedFrom, requestedTo));
    return () => activeController?.abort();
  });

  onMount(() => {
    const refreshWhenVisible = () => {
      if (document.visibilityState === 'visible') void refresh();
    };
    const timer = window.setInterval(refreshWhenVisible, 15_000);
    document.addEventListener('visibilitychange', refreshWhenVisible);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', refreshWhenVisible);
      activeController?.abort();
    };
  });
</script>

{@render children()}
