<script lang="ts">
  import CalendarCogIcon from '@lucide/svelte/icons/calendar-cog';
  import FeedbackAlert from '$lib/components/feedback-alert.svelte';
  import PageHeader from '$lib/components/page-header.svelte';
  import StatusBadge from '$lib/components/status-badge.svelte';
  import { Badge } from '$lib/components/ui/badge/index.js';
  import { Button } from '$lib/components/ui/button/index.js';
  import * as Card from '$lib/components/ui/card/index.js';
  import { Input } from '$lib/components/ui/input/index.js';
  import { Label } from '$lib/components/ui/label/index.js';
  import * as Select from '$lib/components/ui/select/index.js';
  import * as Table from '$lib/components/ui/table/index.js';

  let { data, form } = $props();
  let dateTime = $derived(
    new Intl.DateTimeFormat('en-MY', {
      timeZone: data.timeZone,
      dateStyle: 'medium',
      timeStyle: 'short'
    })
  );
</script>

<svelte:head><title>Reservations · Administration · Cluster Manager</title></svelte:head>

<main class="mx-auto grid w-full max-w-7xl gap-6 px-4 py-8 sm:px-6 lg:px-8">
  <PageHeader
    title="Reservation administration"
    description={`Inspect bookings and make explicit overrides. All times are ${data.timeZone}.`}
  />

  {#if form?.message}
    <FeedbackAlert message={form.message} success={form.success} />
  {/if}

  <Card.Root>
    <Card.Header>
      <Card.Title class="flex items-center gap-2"
        ><CalendarCogIcon class="size-5" />Create for a user</Card.Title
      >
      <Card.Description>
        Normal rules still apply unless override is checked. Overlapping bookings are never allowed.
      </Card.Description>
    </Card.Header>
    <Card.Content>
      {#if data.targets.length === 0}
        <p class="text-muted-foreground text-sm">
          No assigned users with active GPUs are available.
        </p>
      {:else}
        <form method="POST" action="?/create" class="grid gap-4">
          <div class="grid items-end gap-4 lg:grid-cols-3">
            <div class="grid gap-2">
              <Label for="admin-reservation-target">User and GPU</Label>
              <Select.Root
                type="single"
                name="target"
                value={form?.action === 'create' && form.values?.target
                  ? form.values.target
                  : data.targets[0].value}
                items={data.targets.map((target) => ({ value: target.value, label: target.label }))}
              >
                <Select.Trigger id="admin-reservation-target" class="w-full"
                  ><Select.Value /></Select.Trigger
                >
                <Select.Content>
                  {#each data.targets as target (target.value)}
                    <Select.Item value={target.value}>{target.label}</Select.Item>
                  {/each}
                </Select.Content>
              </Select.Root>
            </div>
            <div class="grid gap-2">
              <Label for="admin-reservation-start">Start ({data.timeZone})</Label>
              <Input
                id="admin-reservation-start"
                name="startAt"
                type="datetime-local"
                step="1800"
                required
                value={form?.action === 'create'
                  ? (form.values?.startAt ?? data.defaultStart)
                  : data.defaultStart}
              />
            </div>
            <div class="grid gap-2">
              <Label for="admin-reservation-end">End ({data.timeZone})</Label>
              <Input
                id="admin-reservation-end"
                name="endAt"
                type="datetime-local"
                step="1800"
                required
                value={form?.action === 'create'
                  ? (form.values?.endAt ?? data.defaultEnd)
                  : data.defaultEnd}
              />
            </div>
          </div>
          <div class="grid items-end gap-4 lg:grid-cols-[auto_1fr_auto]">
            <Label class="flex min-h-9 items-center gap-2 rounded-md border px-3">
              <input
                type="checkbox"
                name="adminOverride"
                value="true"
                checked={form?.action === 'create' && form.values?.adminOverride}
              />
              Override duration/horizon
            </Label>
            <div class="grid gap-2">
              <Label for="override-reason">Override reason</Label>
              <Input
                id="override-reason"
                name="overrideReason"
                maxlength={500}
                placeholder="Required only when override is checked"
                value={form?.action === 'create' ? (form.values?.overrideReason ?? '') : ''}
              />
            </div>
            <Button type="submit">Create reservation</Button>
          </div>
        </form>
      {/if}
    </Card.Content>
  </Card.Root>

  <Card.Root>
    <Card.Header class="flex-row items-center justify-between gap-4">
      <div class="space-y-1.5">
        <Card.Title>All reservations</Card.Title>
        <Card.Description
          >Latest 200 bookings, including completed and cancelled history.</Card.Description
        >
      </div>
      <Badge variant="secondary">{data.reservations.length} shown</Badge>
    </Card.Header>
    <Card.Content class={data.reservations.length > 0 ? 'px-0' : undefined}>
      {#if data.reservations.length === 0}
        <p class="text-muted-foreground text-sm">No reservations have been created.</p>
      {:else}
        <Table.Root>
          <Table.Header>
            <Table.Row>
              <Table.Head class="pl-6">User</Table.Head>
              <Table.Head>GPU</Table.Head>
              <Table.Head>Start</Table.Head>
              <Table.Head>End</Table.Head>
              <Table.Head>Status</Table.Head>
              <Table.Head class="pr-6">Admin action</Table.Head>
            </Table.Row>
          </Table.Header>
          <Table.Body>
            {#each data.reservations as reservation (reservation.id)}
              <Table.Row>
                <Table.Cell class="pl-6">
                  <strong>{reservation.username}</strong>
                  <span class="text-muted-foreground block text-xs">{reservation.displayName}</span>
                </Table.Cell>
                <Table.Cell>{reservation.workstationName} · GPU {reservation.gpuIndex}</Table.Cell>
                <Table.Cell>{dateTime.format(reservation.startAt)}</Table.Cell>
                <Table.Cell>{dateTime.format(reservation.endAt)}</Table.Cell>
                <Table.Cell>
                  <div class="flex flex-wrap gap-1">
                    <StatusBadge status={reservation.state} />
                    {#if reservation.isAdminOverride}<Badge variant="outline">override</Badge>{/if}
                  </div>
                  {#if reservation.overrideReason}
                    <span
                      class="text-muted-foreground block max-w-52 truncate text-xs"
                      title={reservation.overrideReason}>{reservation.overrideReason}</span
                    >
                  {/if}
                </Table.Cell>
                <Table.Cell class="pr-6">
                  {#if reservation.cancellable}
                    <form method="POST" action="?/cancel" class="flex min-w-72 gap-2">
                      <input type="hidden" name="reservationId" value={reservation.id} />
                      <Input
                        name="reason"
                        maxlength={500}
                        required
                        placeholder="Cancellation reason"
                      />
                      <Button type="submit" variant="destructive" size="sm">Cancel</Button>
                    </form>
                  {:else if reservation.cancellationReason}
                    <span class="text-muted-foreground text-xs"
                      >{reservation.cancellationReason}</span
                    >
                  {:else}
                    <span class="text-muted-foreground text-sm">—</span>
                  {/if}
                </Table.Cell>
              </Table.Row>
            {/each}
          </Table.Body>
        </Table.Root>
      {/if}
    </Card.Content>
  </Card.Root>
</main>
