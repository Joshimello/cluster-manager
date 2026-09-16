<script lang="ts">
  import CalendarDaysIcon from '@lucide/svelte/icons/calendar-days';
  import ClockIcon from '@lucide/svelte/icons/clock';
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

<svelte:head><title>Reservations · Cluster Manager</title></svelte:head>

<main class="mx-auto grid w-full max-w-7xl gap-6 px-4 py-8 sm:px-6 lg:px-8">
  <PageHeader
    title="GPU reservations"
    description={`Coordinate GPU use in 30-minute increments. All times are ${data.timeZone}.`}
  />

  {#if form?.message}
    <FeedbackAlert message={form.message} success={form.success} />
  {/if}

  {#if data.assignment}
    <Card.Root>
      <Card.Header>
        <Card.Title class="flex items-center gap-2"
          ><CalendarDaysIcon class="size-5" />Reserve a GPU</Card.Title
        >
        <Card.Description>
          {data.assignment.workstationDisplayName} · maximum six hours · up to seven days ahead
        </Card.Description>
      </Card.Header>
      <Card.Content>
        {#if data.gpus.length === 0}
          <p class="text-muted-foreground text-sm">No active GPUs are available to reserve.</p>
        {:else}
          <form
            method="POST"
            action="?/create"
            class="grid items-end gap-4 lg:grid-cols-[1fr_1fr_1fr_auto]"
          >
            <div class="grid gap-2">
              <Label for="reservation-gpu">GPU</Label>
              <Select.Root
                type="single"
                name="gpuId"
                value={form?.action === 'create' && form.values?.gpuId
                  ? form.values.gpuId
                  : data.gpus[0].id}
                items={data.gpus.map((gpu) => ({
                  value: gpu.id,
                  label: `GPU ${gpu.index} — ${gpu.model}`
                }))}
              >
                <Select.Trigger id="reservation-gpu" class="w-full"><Select.Value /></Select.Trigger
                >
                <Select.Content>
                  {#each data.gpus as gpu (gpu.id)}
                    <Select.Item value={gpu.id}>GPU {gpu.index} — {gpu.model}</Select.Item>
                  {/each}
                </Select.Content>
              </Select.Root>
            </div>
            <div class="grid gap-2">
              <Label for="reservation-start">Start ({data.timeZone})</Label>
              <Input
                id="reservation-start"
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
              <Label for="reservation-end">End ({data.timeZone})</Label>
              <Input
                id="reservation-end"
                name="endAt"
                type="datetime-local"
                step="1800"
                required
                value={form?.action === 'create'
                  ? (form.values?.endAt ?? data.defaultEnd)
                  : data.defaultEnd}
              />
            </div>
            <Button type="submit">Reserve GPU</Button>
          </form>
        {/if}
      </Card.Content>
    </Card.Root>
  {:else}
    <Card.Root class="border-dashed" size="sm">
      <Card.Header>
        <Card.Title>No workstation assignment</Card.Title>
        <Card.Description
          >An administrator must assign you before you can reserve a GPU.</Card.Description
        >
      </Card.Header>
    </Card.Root>
  {/if}

  <Card.Root>
    <Card.Header class="flex-row items-center justify-between gap-4">
      <div class="space-y-1.5">
        <Card.Title class="flex items-center gap-2"><ClockIcon class="size-5" />Schedule</Card.Title
        >
        <Card.Description>Current and upcoming reservations on your workstation.</Card.Description>
      </div>
      <Badge variant="secondary">{data.schedule.length} reservations</Badge>
    </Card.Header>
    <Card.Content class={data.schedule.length > 0 ? 'px-0' : undefined}>
      {#if data.schedule.length === 0}
        <p class="text-muted-foreground text-sm">No current or upcoming reservations.</p>
      {:else}
        <Table.Root>
          <Table.Header>
            <Table.Row>
              <Table.Head class="pl-6">GPU</Table.Head>
              <Table.Head>Reserved by</Table.Head>
              <Table.Head>Start</Table.Head>
              <Table.Head>End</Table.Head>
              <Table.Head>Status</Table.Head>
              <Table.Head class="pr-6 text-right">Action</Table.Head>
            </Table.Row>
          </Table.Header>
          <Table.Body>
            {#each data.schedule as reservation (reservation.id)}
              <Table.Row>
                <Table.Cell class="pl-6 font-medium"
                  >{reservation.workstationName} · GPU {reservation.gpuIndex}</Table.Cell
                >
                <Table.Cell>{reservation.owner}</Table.Cell>
                <Table.Cell>{dateTime.format(reservation.startAt)}</Table.Cell>
                <Table.Cell>{dateTime.format(reservation.endAt)}</Table.Cell>
                <Table.Cell><StatusBadge status={reservation.state} /></Table.Cell>
                <Table.Cell class="pr-6 text-right">
                  {#if reservation.mine}
                    <form method="POST" action="?/cancel">
                      <input type="hidden" name="reservationId" value={reservation.id} />
                      <Button type="submit" variant="outline" size="sm">Cancel</Button>
                    </form>
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

  <Card.Root>
    <Card.Header>
      <Card.Title>Your reservation history</Card.Title>
      <Card.Description>Completed and cancelled bookings are retained.</Card.Description>
    </Card.Header>
    <Card.Content class={data.history.length > 0 ? 'px-0' : undefined}>
      {#if data.history.length === 0}
        <p class="text-muted-foreground text-sm">No completed or cancelled reservations.</p>
      {:else}
        <Table.Root>
          <Table.Header>
            <Table.Row>
              <Table.Head class="pl-6">GPU</Table.Head>
              <Table.Head>Start</Table.Head>
              <Table.Head>End</Table.Head>
              <Table.Head class="pr-6">Result</Table.Head>
            </Table.Row>
          </Table.Header>
          <Table.Body>
            {#each data.history as reservation (reservation.id)}
              <Table.Row>
                <Table.Cell class="pl-6 font-medium">GPU {reservation.gpuIndex}</Table.Cell>
                <Table.Cell>{dateTime.format(reservation.startAt)}</Table.Cell>
                <Table.Cell>{dateTime.format(reservation.endAt)}</Table.Cell>
                <Table.Cell class="pr-6">
                  <StatusBadge
                    status={reservation.status === 'cancelled' ? 'cancelled' : 'completed'}
                  />
                </Table.Cell>
              </Table.Row>
            {/each}
          </Table.Body>
        </Table.Root>
      {/if}
    </Card.Content>
  </Card.Root>
</main>
