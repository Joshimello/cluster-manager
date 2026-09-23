<script lang="ts">
  import CalendarDaysIcon from '@lucide/svelte/icons/calendar-days';
  import ChevronLeftIcon from '@lucide/svelte/icons/chevron-left';
  import ChevronRightIcon from '@lucide/svelte/icons/chevron-right';
  import ClockIcon from '@lucide/svelte/icons/clock';
  import ListIcon from '@lucide/svelte/icons/list';
  import XIcon from '@lucide/svelte/icons/x';
  import { onMount, tick } from 'svelte';
  import { reservationSegmentsForDay, weekDays } from '$lib/reservation-week';
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
  let reserveDialog = $state<HTMLDialogElement>();
  let dateTime = $derived(
    new Intl.DateTimeFormat('en-MY', {
      timeZone: data.timeZone,
      dateStyle: 'medium',
      timeStyle: 'short'
    })
  );
  let timeOnly = $derived(
    new Intl.DateTimeFormat('en-MY', {
      timeZone: data.timeZone,
      hour: '2-digit',
      minute: '2-digit'
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
  let scheduleView = $state<'calendar' | 'table'>('calendar');
  let weekOffset = $state(0);
  let scheduleScroller = $state<HTMLDivElement | null>(null);
  const hourHeight = 56;
  const hours = Array.from({ length: 24 }, (_, hour) => hour);
  let week = $derived(
    weekDays(data.todayKey, weekOffset).map((day) => ({
      ...day,
      segments: reservationSegmentsForDay(data.schedule, day.key, data.timeZone)
    }))
  );
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

  function scrollToCurrentHour() {
    const hour = Number(
      new Intl.DateTimeFormat('en-GB', {
        timeZone: data.timeZone,
        hour: '2-digit',
        hourCycle: 'h23'
      })
        .formatToParts(new Date())
        .find((part) => part.type === 'hour')?.value
    );
    if (scheduleScroller) scheduleScroller.scrollTop = Math.max(0, (hour - 2) * hourHeight);
  }

  async function showCalendar() {
    scheduleView = 'calendar';
    await tick();
    scrollToCurrentHour();
  }

  $effect(() => {
    if (form?.action === 'create' && !form.success && reserveDialog && !reserveDialog.open) {
      reserveDialog.showModal();
    }
  });

  onMount(() => {
    const timer = window.setInterval(() => (nowMs = Date.now()), 60_000);
    scrollToCurrentHour();
    return () => window.clearInterval(timer);
  });
</script>

<svelte:head><title>Dashboard</title></svelte:head>

<main class="mx-auto grid w-full max-w-7xl gap-6 px-4 py-8 sm:px-6 lg:px-8">
  <div class="flex flex-wrap items-start justify-between gap-4">
    <PageHeader title="Dashboard" description="Your workstation access and GPU reservations." />
    <Button disabled={data.gpus.length === 0} onclick={() => reserveDialog?.showModal()}>
      <CalendarDaysIcon data-icon="inline-start" />Reserve a GPU
    </Button>
  </div>

  {#if form?.message}
    <FeedbackAlert message={form.message} success={form.success} />
  {/if}

  {#if data.gpus.length > 0}
    <dialog
      id="reserve-gpu-dialog"
      bind:this={reserveDialog}
      aria-labelledby="reserve-gpu-title"
      class="bg-background text-foreground fixed inset-0 m-auto max-h-[calc(100dvh-2rem)] w-[min(72rem,calc(100vw-2rem))] overflow-y-auto rounded-xl border p-6 shadow-xl backdrop:bg-black/50"
    >
      <div class="mb-5 flex items-start justify-between gap-4">
        <div class="space-y-1">
          <h2 id="reserve-gpu-title" class="text-xl font-semibold">Reserve a GPU</h2>
          <p class="text-muted-foreground text-sm">
            Choose a GPU, then select up to six consecutive hours within the next seven days.
          </p>
        </div>
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label="Close reservation dialog"
          onclick={() => reserveDialog?.close()}
        >
          <XIcon aria-hidden="true" />
        </Button>
      </div>
      {#if form?.action === 'create' && !form.success && form.message}
        <div class="mb-4"><FeedbackAlert message={form.message} /></div>
      {/if}
      <div class="grid min-w-0 grid-cols-[minmax(0,1fr)] gap-5">
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
            <Select.Content portalProps={{ to: '#reserve-gpu-dialog' }}>
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

        <div class="min-w-0">
          <p class="mb-3 text-sm font-medium">{currentDay?.label} · one-hour slots</p>
          <div class="min-w-0 overflow-x-auto pb-2">
            <div
              class="grid min-w-[40rem] grid-flow-col grid-rows-6 auto-cols-[minmax(10rem,1fr)] gap-2"
            >
              {#each currentDay?.slots ?? [] as slot (slot.startAt)}
                {@const index = slots.findIndex((candidate) => candidate.startAt === slot.startAt)}
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
          <p class="text-muted-foreground mt-1 text-xs sm:hidden">
            Scroll sideways to see later hours.
          </p>
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
    </dialog>
  {/if}

  {#if data.assignments.length > 0}
    <section class="grid gap-3" aria-labelledby="workstation-access-heading">
      <div>
        <h2 id="workstation-access-heading" class="text-xl font-semibold tracking-tight">
          Workstation access
        </h2>
        <p class="text-muted-foreground text-sm">Your assigned Linux workstations.</p>
      </div>
      <div class="grid gap-4 md:grid-cols-2">
        {#each data.assignments as assignment (assignment.workstationId)}
          <Card.Root>
            <Card.Header>
              <Card.Title>{assignment.workstationDisplayName}</Card.Title>
              <Card.Description>{assignment.workstationName}</Card.Description>
            </Card.Header>
            <Card.Content class="grid gap-3">
              <div><StatusBadge status={assignment.provisioningStatus} /></div>
              {#if assignment.provisioningStatus === 'applied'}
                <code class="bg-muted block overflow-x-auto rounded-md border p-3 text-sm">
                  ssh {data.user.username}@{assignment.hostname ?? assignment.workstationName}
                </code>
              {:else}
                <p class="text-muted-foreground text-sm">
                  SSH access will be available after your account is applied to this workstation.
                </p>
              {/if}
              {#if assignment.provisioningMessage}
                <p class="text-muted-foreground text-sm">{assignment.provisioningMessage}</p>
              {/if}
            </Card.Content>
          </Card.Root>
        {/each}
      </div>
    </section>
  {:else}
    <Card.Root class="border-dashed" size="sm">
      <Card.Header>
        <Card.Title>No workstation assignment</Card.Title>
        <Card.Description>
          An administrator must assign your account before SSH access or GPU reservations are
          available.
        </Card.Description>
      </Card.Header>
    </Card.Root>
  {/if}

  <Card.Root>
    <Card.Header class="flex flex-wrap items-center justify-between gap-4">
      <div class="space-y-1.5">
        <Card.Title class="flex items-center gap-2"><ClockIcon class="size-5" />Schedule</Card.Title
        >
        <Card.Description>Current and upcoming reservations on your workstations.</Card.Description>
      </div>
      <div class="flex flex-wrap items-center gap-3">
        <Badge variant="secondary">{data.schedule.length} reservations</Badge>
        <div class="flex gap-1 rounded-lg border p-1" role="group" aria-label="Schedule view">
          <Button
            type="button"
            size="sm"
            variant={scheduleView === 'calendar' ? 'secondary' : 'ghost'}
            aria-pressed={scheduleView === 'calendar'}
            onclick={showCalendar}
          >
            <CalendarDaysIcon aria-hidden="true" />Calendar
          </Button>
          <Button
            type="button"
            size="sm"
            variant={scheduleView === 'table' ? 'secondary' : 'ghost'}
            aria-pressed={scheduleView === 'table'}
            onclick={() => (scheduleView = 'table')}
          >
            <ListIcon aria-hidden="true" />Table
          </Button>
        </div>
      </div>
    </Card.Header>
    <Card.Content class={scheduleView === 'table' && data.schedule.length > 0 ? 'px-0' : 'min-w-0'}>
      {#if scheduleView === 'calendar'}
        <div class="grid min-w-0 gap-4">
          <div class="flex flex-wrap items-center justify-between gap-3">
            <strong>{week[0].label} – {week[6].label}</strong>
            <div class="flex flex-wrap gap-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={weekOffset === 0}
                onclick={() => (weekOffset -= 1)}
              >
                <ChevronLeftIcon aria-hidden="true" />Previous
              </Button>
              {#if weekOffset > 0}
                <Button type="button" variant="outline" size="sm" onclick={() => (weekOffset = 0)}
                  >This week</Button
                >
              {/if}
              <Button type="button" variant="outline" size="sm" onclick={() => (weekOffset += 1)}>
                Next<ChevronRightIcon aria-hidden="true" />
              </Button>
            </div>
          </div>

          <div
            class="max-h-[42rem] min-w-0 overflow-auto rounded-lg border"
            aria-label="Weekly reservation calendar"
            bind:this={scheduleScroller}
          >
            <div class="min-w-[68rem]">
              <div
                class="bg-background sticky top-0 z-20 grid border-b"
                style="grid-template-columns: 4rem repeat(7, minmax(0, 1fr))"
              >
                <div class="border-r p-2 text-xs">{data.timeZone}</div>
                {#each week as day (day.key)}
                  <div
                    class={day.key === data.todayKey
                      ? 'bg-primary/10 border-r p-2 text-center text-sm font-semibold last:border-r-0'
                      : 'border-r p-2 text-center text-sm font-semibold last:border-r-0'}
                  >
                    {day.label}
                  </div>
                {/each}
              </div>
              <div class="grid" style="grid-template-columns: 4rem repeat(7, minmax(0, 1fr))">
                <div>
                  {#each hours as hour (hour)}
                    <div
                      class="text-muted-foreground border-t px-2 pt-1 text-right text-xs"
                      style={`height: ${hourHeight}px`}
                    >
                      {String(hour).padStart(2, '0')}:00
                    </div>
                  {/each}
                </div>
                {#each week as day (day.key)}
                  <div
                    class="relative border-l"
                    style={`height: ${24 * hourHeight}px`}
                    aria-label={day.label}
                  >
                    {#each hours as hour (hour)}
                      <div
                        class="border-border/60 pointer-events-none absolute inset-x-0 border-t"
                        style={`top: ${hour * hourHeight}px`}
                      ></div>
                    {/each}
                    {#each day.segments as segment (segment.reservation.id)}
                      <div
                        class={segment.reservation.mine
                          ? 'bg-primary/15 border-primary/40 absolute z-10 overflow-hidden rounded-md border px-1.5 py-1 text-xs shadow-sm'
                          : 'bg-muted border-border absolute z-10 overflow-hidden rounded-md border px-1.5 py-1 text-xs shadow-sm'}
                        style={`top: ${(segment.startMinute / 60) * hourHeight + 2}px; height: ${Math.max(28, ((segment.endMinute - segment.startMinute) / 60) * hourHeight - 4)}px; left: calc(${(segment.lane / segment.laneCount) * 100}% + 2px); width: calc(${100 / segment.laneCount}% - 4px)`}
                        title={`${segment.reservation.workstationName} · GPU ${segment.reservation.gpuIndex} · ${segment.reservation.owner} · ${dateTime.format(segment.reservation.startAt)} – ${dateTime.format(segment.reservation.endAt)}`}
                      >
                        <div class="truncate font-semibold">
                          {segment.reservation.workstationName} · GPU {segment.reservation.gpuIndex}
                        </div>
                        <div class="truncate">{segment.reservation.owner}</div>
                        <div class="truncate">
                          {timeOnly.format(segment.reservation.startAt)}–{timeOnly.format(
                            segment.reservation.endAt
                          )}
                        </div>
                      </div>
                    {/each}
                  </div>
                {/each}
              </div>
            </div>
          </div>
          <p class="text-muted-foreground text-sm">
            {data.schedule.length === 0
              ? 'No current or upcoming reservations.'
              : 'Switch to table view to cancel a reservation.'}
          </p>
        </div>
      {:else if data.schedule.length === 0}
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
