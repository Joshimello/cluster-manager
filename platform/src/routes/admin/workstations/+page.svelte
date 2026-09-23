<script lang="ts">
  import MonitorIcon from '@lucide/svelte/icons/monitor';
  import PlusIcon from '@lucide/svelte/icons/plus';
  import XIcon from '@lucide/svelte/icons/x';
  import { onMount } from 'svelte';
  import { invalidateAll } from '$app/navigation';
  import { resolve } from '$app/paths';
  import CoordinationBadge from '$lib/components/coordination-badge.svelte';
  import CredentialDisplay from '$lib/components/credential-display.svelte';
  import FeedbackAlert from '$lib/components/feedback-alert.svelte';
  import PageHeader from '$lib/components/page-header.svelte';
  import StatusBadge from '$lib/components/status-badge.svelte';
  import { Badge } from '$lib/components/ui/badge/index.js';
  import { Button } from '$lib/components/ui/button/index.js';
  import * as Card from '$lib/components/ui/card/index.js';
  import { Input } from '$lib/components/ui/input/index.js';
  import { Label } from '$lib/components/ui/label/index.js';

  let { data, form } = $props();
  let createDialog = $state<HTMLDialogElement>();
  const stateOrder = [
    'conflict',
    'unbooked-use',
    'booked-active',
    'booked-idle',
    'available',
    'unknown'
  ] as const;
  let allGpus = $derived(data.workstations.flatMap((workstation) => workstation.gpus));
  let dateTime = $derived(
    new Intl.DateTimeFormat(undefined, {
      dateStyle: 'medium',
      timeStyle: 'medium',
      timeZone: data.user.timeZone ?? 'UTC'
    })
  );
  const number = new Intl.NumberFormat(undefined, { maximumFractionDigits: 0 });
  const gigabytes = new Intl.NumberFormat(undefined, {
    style: 'unit',
    unit: 'gigabyte',
    maximumFractionDigits: 1
  });
  const formatMemory = (value: number) => gigabytes.format(value / 1_000_000_000);

  $effect(() => {
    if (form?.action === 'create' && !form.success && createDialog && !createDialog.open) {
      createDialog.showModal();
    }
  });

  onMount(() => {
    const timer = window.setInterval(() => {
      if (!form?.enrollmentToken && !createDialog?.open) void invalidateAll();
    }, 10_000);
    return () => window.clearInterval(timer);
  });
</script>

<svelte:head><title>Workstations</title></svelte:head>

<main class="mx-auto grid w-full max-w-7xl gap-6 px-4 py-8 sm:px-6 lg:px-8">
  <div class="flex flex-wrap items-start justify-between gap-4">
    <PageHeader
      title="Workstations"
      description="See each machine and its GPUs, manage enrollment, and open detailed monitoring."
    />
    <Button onclick={() => createDialog?.showModal()}>
      <PlusIcon data-icon="inline-start" />Create workstation
    </Button>
  </div>

  {#if form?.message}
    <FeedbackAlert message={form.message} success={form.success} />
  {/if}

  {#if form?.enrollmentToken}
    <CredentialDisplay
      title="Copy this enrollment token now"
      description={`It is shown only in this response and expires at ${dateTime.format(new Date(form.enrollmentExpiresAt))}.`}
      entries={[
        { label: 'Workstation', value: form.enrollmentName },
        { label: 'Enrollment token', value: form.enrollmentToken }
      ]}
    />
  {/if}

  <dialog
    id="create-workstation-dialog"
    bind:this={createDialog}
    aria-labelledby="create-workstation-title"
    class="bg-background text-foreground fixed inset-0 m-auto max-h-[calc(100dvh-2rem)] w-[min(32rem,calc(100vw-2rem))] overflow-y-auto rounded-xl border p-6 shadow-xl backdrop:bg-black/50"
  >
    <div class="mb-5 flex items-start justify-between gap-4">
      <div class="space-y-1">
        <h2 id="create-workstation-title" class="text-xl font-semibold">Create workstation</h2>
        <p class="text-muted-foreground text-sm">
          A one-time enrollment token will be generated and displayed once.
        </p>
      </div>
      <Button
        variant="ghost"
        size="icon-sm"
        aria-label="Close create workstation dialog"
        onclick={() => createDialog?.close()}
      >
        <XIcon aria-hidden="true" />
      </Button>
    </div>
    {#if form?.action === 'create' && !form.success && form.message}
      <div class="mb-4"><FeedbackAlert message={form.message} /></div>
    {/if}
    <form class="grid gap-4" method="POST" action="?/create">
      <div class="grid gap-2">
        <Label for="workstation-name">Name</Label>
        <Input
          id="workstation-name"
          name="name"
          pattern={'[a-z][a-z0-9-]{1,31}'}
          maxlength={32}
          required
          value={form?.action === 'create' ? (form.values?.name ?? '') : ''}
        />
      </div>
      <div class="grid gap-2">
        <Label for="workstation-display-name">Display name</Label>
        <Input
          id="workstation-display-name"
          name="displayName"
          maxlength={120}
          required
          value={form?.action === 'create' ? (form.values?.displayName ?? '') : ''}
        />
      </div>
      <div class="flex justify-end gap-2 pt-2">
        <Button type="button" variant="outline" onclick={() => createDialog?.close()}>Cancel</Button
        >
        <Button type="submit">Create workstation</Button>
      </div>
    </form>
  </dialog>

  {#if allGpus.length > 0}
    <section class="flex flex-wrap items-center gap-2" aria-label="GPU status across workstations">
      <Badge variant="secondary"
        >{allGpus.length} total {allGpus.length === 1 ? 'GPU' : 'GPUs'}</Badge
      >
      {#each stateOrder as state (state)}
        {@const count = allGpus.filter((gpu) => gpu.coordinationState === state).length}
        {#if count > 0}
          <div class="flex items-center gap-1 rounded-full border px-2 py-1 text-xs">
            <CoordinationBadge {state} />
            <strong class="tabular-nums">{count}</strong>
          </div>
        {/if}
      {/each}
    </section>
  {/if}

  <section class="grid gap-4" aria-labelledby="managed-workstations-heading">
    <div class="flex flex-wrap items-center justify-between gap-3">
      <div>
        <h2 id="managed-workstations-heading" class="text-lg font-semibold">
          Managed workstations
        </h2>
        <p class="text-muted-foreground text-sm">Current connectivity and GPU status.</p>
      </div>
      <Badge variant="secondary">{data.workstations.length} total</Badge>
    </div>

    {#if data.workstations.length === 0}
      <Card.Root class="border-dashed">
        <Card.Content
          class="text-muted-foreground flex flex-col items-center gap-3 py-12 text-center text-sm"
        >
          <MonitorIcon class="size-9" aria-hidden="true" />
          <p>No workstations have been created.</p>
        </Card.Content>
      </Card.Root>
    {:else}
      <div class="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {#each data.workstations as workstation (workstation.id)}
          <Card.Root class="h-full min-w-0">
            <Card.Header class="gap-3">
              <div class="flex flex-wrap items-start justify-between gap-2">
                <div class="min-w-0 space-y-1">
                  <Card.Title>
                    <a
                      class="underline-offset-4 hover:underline"
                      href={resolve('/admin/workstations/[id]', { id: workstation.id })}
                      >{workstation.displayName}</a
                    >
                  </Card.Title>
                  <Card.Description class="break-all">{workstation.name}</Card.Description>
                </div>
                <StatusBadge status={workstation.connectionState} />
              </div>
              <div class="flex flex-wrap gap-1.5">
                <StatusBadge status={workstation.status} />
                <StatusBadge status={workstation.enrolled ? 'enrolled' : 'not enrolled'} />
                <Badge variant="outline"
                  >{workstation.gpuCount} {workstation.gpuCount === 1 ? 'GPU' : 'GPUs'}</Badge
                >
              </div>
              <p class="text-muted-foreground text-xs xl:min-h-8">
                {workstation.lastHeartbeatAt
                  ? `Last heartbeat ${dateTime.format(workstation.lastHeartbeatAt)}`
                  : 'Not yet connected'}
                · node {workstation.nodeVersion ?? 'unknown'}
              </p>
            </Card.Header>

            <Card.Content class="grow gap-2">
              {#if workstation.gpus.length === 0}
                <div
                  class="bg-muted/30 text-muted-foreground rounded-lg border border-dashed p-4 text-sm"
                >
                  No GPUs reported by this workstation.
                </div>
              {:else}
                {#each workstation.gpus as gpu (gpu.id)}
                  <div class="bg-muted/30 grid min-w-0 gap-2 rounded-lg border p-3">
                    <div class="flex flex-wrap items-start justify-between gap-2">
                      <div class="min-w-0">
                        <div class="text-muted-foreground text-xs font-medium">GPU {gpu.index}</div>
                        <div class="truncate text-sm font-semibold" title={gpu.model}>
                          {gpu.model}
                        </div>
                      </div>
                      <CoordinationBadge state={gpu.coordinationState} />
                    </div>
                    <div
                      class="text-muted-foreground flex flex-wrap gap-x-3 gap-y-1 text-xs tabular-nums"
                    >
                      <span>{number.format(gpu.utilizationPercent)}% utilization</span>
                      <span
                        >{formatMemory(gpu.memoryUsedBytes)} / {formatMemory(gpu.memoryTotalBytes)} VRAM</span
                      >
                      <span
                        >{gpu.processCount} {gpu.processCount === 1 ? 'process' : 'processes'}</span
                      >
                    </div>
                    {#if gpu.telemetryState !== 'online'}
                      <div><StatusBadge status={gpu.telemetryState} /></div>
                    {/if}
                  </div>
                {/each}
              {/if}
            </Card.Content>

            <Card.Footer class="mt-auto border-t pt-4">
              <Button
                variant="outline"
                size="sm"
                class="w-full"
                href={resolve('/admin/workstations/[id]', { id: workstation.id })}
                >View details</Button
              >
            </Card.Footer>
          </Card.Root>
        {/each}
      </div>
    {/if}
  </section>
</main>
