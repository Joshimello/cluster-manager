import { getContext, setContext } from 'svelte';

import type { MonitoringHistoryResponse } from '$lib/monitoring-history';

export type MonitoringHistoryContext = {
  readonly response: MonitoringHistoryResponse | null;
  readonly loading: boolean;
  readonly error: string | null;
};

const monitoringHistoryContextKey = Symbol('monitoring-history');

export function setMonitoringHistoryContext(context: MonitoringHistoryContext) {
  return setContext(monitoringHistoryContextKey, context);
}

export function getMonitoringHistoryContext(): MonitoringHistoryContext | null {
  return getContext<MonitoringHistoryContext | null>(monitoringHistoryContextKey) ?? null;
}
