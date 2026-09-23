<script lang="ts">
  import CalendarDaysIcon from '@lucide/svelte/icons/calendar-days';
  import ClockIcon from '@lucide/svelte/icons/clock';
  import { onMount } from 'svelte';
  import FeedbackAlert from '$lib/components/feedback-alert.svelte';
  import PageHeader from '$lib/components/page-header.svelte';
  import StatusBadge from '$lib/components/status-badge.svelte';
  import { Badge } from '$lib/components/ui/badge/index.js';
  import { Button } from '$lib/components/ui/button/index.js';
  import * as Card from '$lib/components/ui/card/index.js';
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
  let slots = $derived(data.calendarDays.flatMap((day) => day.slots));
  const slotIndex = (value: string | undefined, boundary: 'startAt' | 'endAt') => {
    if (!value) return null;
    const index = data.calendarDays
      .flatMap((day) => day.slots)
      .findIndex((slot) => slot[boundary] === value);
    return index < 0 ? null : index;
  };
  let gpuChoice = $state<string | null>(null);
  let dayChoice = $state<string | null>(null);
  let startChoice = $state<number | null | undefined>(undefined);
  let endChoice = $state<number | null | undefined>(undefined);
  let selectedGpuId = $derived(
    gpuChoice ??
      (form?.action === 'create' && form.values?.gpuId
        ? form.values.gpuId
        : (data.gpus[0]?.id ?? ''))
  );
  let selectedDayKey = $derived(
    dayChoice ??
      data.calendarDays.find((day) =>
        day.slots.some((slot) => slot.startAt === form?.values?.startAt)
      )?.key ??
      data.calendarDays[0]?.key ??
      ''
  );
  let selectedStart = $derived(
    startChoice === undefined
      ? slotIndex(form?.action === 'create' ? form.values?.startAt : undefined, 'startAt')
      : startChoice
  );
  let selectedEnd = $derived(
    endChoice === undefined
      ? slotIndex(form?.action === 'create' ? form.values?.endAt : undefined, 'endAt')
      : endChoice
  );
  let nowMs = $state(Date.now());
  let currentDay = $derived(data.calendarDays.find((day) => day.key === selectedDayKey));
  let selectedCount = $derived(
    selectedStart === null || selectedEnd === null ? 0 : selectedEnd - selectedStart + 1
  );
  let selectedValid = $derived(
    selectedStart !== null &&
      selectedEnd !== null &&
      selectedCount >= 1 &&
      selectedCount <= 6 &&
      slots.slice(selectedStart, selectedEnd + 1).every((slot) => slotAvailable(slot))
  );

  const reservationAt = (slot: (typeof data.calendarDays)[number]['slots'][number]) =>
    data.schedule.find(
      (reservation) =>
        reservation.gpuId === selectedGpuId &&
        reservation.startAt.getTime() < Date.parse(slot.endAt) &&
        reservation.endAt.getTime() > Date.parse(slot.startAt)
    );
  const slotAvailable = (slot: (typeof data.calendarDays)[number]['slots'][number]) =>
    Date.parse(slot.startAt) > nowMs && !reservationAt(slot);

  function chooseSlot(index: number) {
    if (!slotAvailable(slots[index])) return;
    if (selectedStart === index && selectedEnd === index) {
      startChoice = null;
      endChoice = null;
      return;
    }
    if (
      selectedStart === null ||
      index < selectedStart ||
      index > selectedStart + 5 ||
      !slots.slice(selectedStart, index + 1).every(slotAvailable)
    ) {
      startChoice = index;
      endChoice = index;
      return;
    }
    endChoice = index;
  }

  onMount(() => {
    const timer = window.setInterval(() => (nowMs = Date.now()), 60_000);
    return () => window.clearInterval(timer);
  });
</script>

<svelte:head><title>Reservations</title></svelte:head>

<main class="mx-auto grid w-full max-w-7xl gap-6 px-4 py-8 sm:px-6 lg:px-8">
  <PageHeader
    title="GPU reservations"
    description={`Choose consecutive one-hour slots. All times are ${data.timeZone}.`}
  />

  {#if form?.message}
    <FeedbackAlert message={form.message} success={form.success} />
  {/if}

  {#if data.assignments.length > 0}
    <Card.Root>
      <Card.Header>
        <Card.Title class="flex items-center gap-2"
          ><CalendarDaysIcon class="size-5" />Reserve a GPU</Card.Title
        >
        <Card.Description>
          Choose a GPU, then select up to six consecutive hours within the next seven days.
        </Card.Description>
      </Card.Header>
      <Card.Content class="min-w-0">
        {#if data.gpus.length === 0}
          <p class="text-muted-foreground text-sm">No active GPUs are available to reserve.</p>
        {:else}
          <div class="grid min-w-0 gap-5">
            <div class="grid min-w-0 max-w-xl gap-2">
              <Label for="reservation-gpu">GPU</Label>
              <Select.Root
                type="single"
                value={selectedGpuId}
                onValueChange={(value) => {
                  gpuChoice = value;
                  startChoice = null;
                  endChoice = null;
                }}
                items={data.gpus.map((gpu) => ({
                  value: gpu.id,
                  label: `${gpu.workstationName} · GPU ${gpu.index} — ${gpu.model}`
                }))}
              >
                <Select.Trigger id="reservation-gpu" class="min-w-0 max-w-full"
                  ><Select.Value /></Select.Trigger
                >
                <Select.Content>
                  {#each data.gpus as gpu (gpu.id)}
                    <Select.Item value={gpu.id}
                      >{gpu.workstationName} · GPU {gpu.index} — {gpu.model}</Select.Item
                    >
                  {/each}
                </Select.Content>
              </Select.Root>
            </div>

            <div class="flex gap-2 overflow-x-auto pb-1" aria-label="Reservation dates">
              {#each data.calendarDays as day (day.key)}
                <Button
                  type="button"
                  variant={selectedDayKey === day.key ? 'default' : 'outline'}
                  class="shrink-0"
                  aria-pressed={selectedDayKey === day.key}
                  onclick={() => (dayChoice = day.key)}
                >
                  {day.label}
                </Button>
              {/each}
            </div>

            <div>
              <p class="mb-3 text-sm font-medium">{currentDay?.label} · one-hour slots</p>
              <div class="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">
                {#each currentDay?.slots ?? [] as slot (slot.startAt)}
                  {@const index = slots.findIndex(
                    (candidate) => candidate.startAt === slot.startAt
                  )}
                  {@const reservation = reservationAt(slot)}
                  {@const past = Date.parse(slot.startAt) <= nowMs}
                  {@const selected =
                    selectedStart !== null &&
                    selectedEnd !== null &&
                    index >= selectedStart &&
                    index <= selectedEnd}
                  <Button
                    type="button"
                    variant={selected ? 'default' : 'outline'}
                    class="h-auto min-h-16 flex-col items-start gap-1 py-2 text-left"
                    disabled={past || !!reservation}
                    aria-pressed={selected}
                    onclick={() => chooseSlot(index)}
                  >
                    <span>{slot.label}</span>
                    <span
                      class={selected
                        ? 'text-primary-foreground/75 text-xs'
                        : 'text-muted-foreground text-xs'}
                    >
                      {reservation
                        ? reservation.mine
                          ? 'Your reservation'
                          : 'Reserved'
                        : past
                          ? 'Past'
                          : selected
                            ? 'Selected'
                            : 'Available'}
                    </span>
                  </Button>
                {/each}
              </div>
            </div>

            <div
              class="bg-muted/50 flex flex-wrap items-center justify-between gap-4 rounded-lg border p-4"
            >
              <div class="grid gap-1">
                <strong
                  >{selectedCount > 0
                    ? `${selectedCount} hour${selectedCount === 1 ? '' : 's'} selected`
                    : 'Choose a time slot'}</strong
                >
                <p class="text-muted-foreground text-sm">
                  {selectedValid && selectedStart !== null && selectedEnd !== null
                    ? `${dateTime.format(new Date(slots[selectedStart].startAt))} – ${dateTime.format(new Date(slots[selectedEnd].endAt))}`
                    : 'Select a start slot, then another slot to extend the reservation.'}
                </p>
              </div>
              <form method="POST" action="?/create">
                <input type="hidden" name="gpuId" value={selectedGpuId} />
                <input
                  type="hidden"
                  name="startAt"
                  value={selectedStart === null ? '' : slots[selectedStart].startAt}
                />
                <input
                  type="hidden"
                  name="endAt"
                  value={selectedEnd === null ? '' : slots[selectedEnd].endAt}
                />
                <Button type="submit" disabled={!selectedValid}>Reserve GPU</Button>
              </form>
            </div>
          </div>
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
        <Card.Description>Current and upcoming reservations on your workstations.</Card.Description>
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
                <Table.Cell class="pl-6 font-medium"
                  >{reservation.workstationName} · GPU {reservation.gpuIndex}</Table.Cell
                >
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
