<script lang="ts">
  import { onMount } from 'svelte';
  import { invalidateAll } from '$app/navigation';
  import { allocateReservationSlot, dynamicAllowance, quotaWeek } from '$lib/reservation-limits';
  import ReservationTimeline from '$lib/components/reservation-timeline.svelte';
  import FeedbackAlert from '$lib/components/feedback-alert.svelte';
  import StatusBadge from '$lib/components/status-badge.svelte';
  import { Badge } from '$lib/components/ui/badge/index.js';
  import { Button } from '$lib/components/ui/button/index.js';
  import * as Card from '$lib/components/ui/card/index.js';
  import { Input } from '$lib/components/ui/input/index.js';
  import { Label } from '$lib/components/ui/label/index.js';
  import * as Select from '$lib/components/ui/select/index.js';
  import * as Table from '$lib/components/ui/table/index.js';

  let { data, form } = $props();
  let reserveDialog = $state<HTMLDialogElement>();
  let gpuChoice = $state<string | null>(null);
  let dayChoice = $state<string | null>(null);
  let slotChoice = $state<string | null>(null);
  let bypass = $state(false);
  let nowMs = $state(Date.now());
  let selectedGpuId = $derived(
    gpuChoice ??
      (form?.action === 'create' ? form.values?.gpuId : undefined) ??
      data.gpus[0]?.id ??
      ''
  );
  let selectedDayKey = $derived(
    dayChoice ??
      data.calendarDays.find((day) =>
        day.slots.some((slot) => slot.startAt === form?.values?.startAt)
      )?.key ??
      data.todayKey
  );
  let currentDay = $derived(data.calendarDays.find((day) => day.key === selectedDayKey));
  let selectedSlot = $derived(
    currentDay?.slots.find(
      (slot) =>
        slot.startAt === (slotChoice ?? (form?.action === 'create' ? form.values?.startAt : null))
    )
  );
  let allocation = $derived(
    selectedSlot
      ? allocateReservationSlot(
          selectedDayKey,
          selectedSlot.overnight,
          data.todayKey,
          data.usage,
          data.policy
        )
      : null
  );
  let selectedValid = $derived(
    !!selectedSlot &&
      slotAvailable(selectedSlot) &&
      ((data.user.role === 'admin' && bypass) || (!!allocation && !('error' in allocation)))
  );
  let week = $derived(quotaWeek(selectedDayKey));
  let dateTime = $derived(
    new Intl.DateTimeFormat('en-MY', {
      timeZone: data.timeZone,
      dateStyle: 'medium',
      timeStyle: 'short'
    })
  );
  const reservationAt = (slot: { startAt: string; endAt: string }) =>
    data.schedule.find(
      (booking) =>
        booking.gpuId === selectedGpuId &&
        booking.startAt.getTime() < Date.parse(slot.endAt) &&
        booking.endAt.getTime() > Date.parse(slot.startAt)
    );
  function slotAvailable(slot: { startAt: string; endAt: string }) {
    return Date.parse(slot.startAt) > nowMs && !reservationAt(slot);
  }
  $effect(() => {
    if (form?.action === 'create' && !form.success && reserveDialog && !reserveDialog.open)
      reserveDialog.showModal();
  });
  onMount(() => {
    const timer = window.setInterval(() => {
      nowMs = Date.now();
      if (!document.querySelector('dialog[open]')) void invalidateAll();
    }, 30_000);
    return () => window.clearInterval(timer);
  });
</script>

<svelte:head><title>Dashboard</title></svelte:head>
<main class="mx-auto grid w-full max-w-7xl gap-6 px-4 py-8 sm:px-6 lg:px-8">
  <div class="flex flex-wrap items-start justify-between gap-4">
    <h1 class="text-3xl font-semibold tracking-tight sm:text-4xl">Dashboard</h1>
    <Button disabled={data.gpus.length === 0} onclick={() => reserveDialog?.showModal()}
      >Reserve a GPU</Button
    >
  </div>
  {#if form?.message}<FeedbackAlert message={form.message} success={form.success} />{/if}

  {#if data.gpus.length > 0}
    <dialog
      id="reserve-gpu-dialog"
      bind:this={reserveDialog}
      aria-labelledby="reserve-gpu-title"
      class="bg-background text-foreground fixed inset-0 m-auto max-h-[calc(100dvh-2rem)] w-[min(52rem,calc(100vw-2rem))] overflow-y-auto rounded-xl border p-6 shadow-xl backdrop:bg-black/50"
    >
      <div class="mb-5 flex items-start justify-between gap-4">
        <div>
          <h2 id="reserve-gpu-title" class="text-xl font-semibold">Reserve a GPU</h2>
          <p class="text-muted-foreground mt-1 text-sm">
            Choose one slot. Daytime slots are 2 hours; overnight slots are 4 hours. All times are {data.timeZone}.
          </p>
        </div>
        <Button variant="outline" onclick={() => reserveDialog?.close()}>Close</Button>
      </div>
      {#if form?.action === 'create' && !form.success && form.message}<FeedbackAlert
          message={form.message}
        />{/if}
      <div class="mb-4 flex flex-wrap gap-2" role="group" aria-label="Booking allowances remaining">
        <Badge
          variant="secondary"
          class="h-auto py-1"
          title={`Standard slots remaining for the week starting ${week}`}
        >
          Standard: {Math.max(
            0,
            data.policy.standardSlotsPerWeek - (data.usage.standardByWeek[week] ?? 0)
          )} left/week
        </Badge>
        {#each data.calendarDays.slice(0, 3) as day, index (day.key)}
          <Badge
            variant="outline"
            class="h-auto py-1"
            title={`Dynamic slots remaining for ${day.label}`}
          >
            Dynamic {['today', 'tomorrow', 'in 2 days'][index]}: {Math.max(
              0,
              dynamicAllowance(day.key, data.todayKey, data.policy) -
                (data.usage.dynamicByDate[day.key] ?? 0)
            )} left
          </Badge>
        {/each}
        <Badge
          variant="secondary"
          class="h-auto py-1"
          title={`Overnight slots remaining for the week starting ${week}`}
        >
          Overnight: {Math.max(
            0,
            data.policy.overnightSlotsPerWeek - (data.usage.overnightByWeek[week] ?? 0)
          )} left/week
        </Badge>
      </div>
      <div class="my-4 grid gap-2">
        <Label for="reservation-gpu">GPU</Label>
        <Select.Root
          type="single"
          value={selectedGpuId}
          onValueChange={(value) => {
            gpuChoice = value;
            slotChoice = null;
          }}
          items={data.gpus.map((gpu) => ({
            value: gpu.id,
            label: `${gpu.workstationName} · GPU ${gpu.index} — ${gpu.model}`
          }))}
        >
          <Select.Trigger id="reservation-gpu"><Select.Value /></Select.Trigger><Select.Content
            portalProps={{ to: '#reserve-gpu-dialog' }}
            >{#each data.gpus as gpu (gpu.id)}<Select.Item value={gpu.id}
                >{gpu.workstationName} · GPU {gpu.index} — {gpu.model}</Select.Item
              >{/each}</Select.Content
          >
        </Select.Root>
      </div>
      <div class="my-4 flex gap-2 overflow-x-auto pb-2" aria-label="Reservation dates">
        {#each data.calendarDays as day (day.key)}<Button
            variant={selectedDayKey === day.key ? 'default' : 'outline'}
            aria-pressed={selectedDayKey === day.key}
            onclick={() => {
              dayChoice = day.key;
              slotChoice = null;
            }}>{day.label}</Button
          >{/each}
      </div>
      <div class="grid gap-2 sm:grid-cols-2 lg:grid-cols-5">
        {#each currentDay?.slots ?? [] as slot (slot.startAt)}
          {@const booking = reservationAt(slot)}
          <Button
            variant={selectedSlot?.startAt === slot.startAt ? 'default' : 'outline'}
            class="h-auto min-h-16 flex-col gap-1 py-3"
            disabled={!slotAvailable(slot)}
            aria-pressed={selectedSlot?.startAt === slot.startAt}
            onclick={() => (slotChoice = slot.startAt)}
          >
            <span>{slot.label}</span><span class="text-xs opacity-75"
              >{booking
                ? booking.owner
                : Date.parse(slot.startAt) <= nowMs
                  ? 'Past'
                  : slot.overnight
                    ? '4h · Overnight'
                    : '2h · Daytime'}</span
            >
          </Button>
        {/each}
      </div>
      <form method="POST" action="?/create" class="mt-5 grid gap-4">
        <input type="hidden" name="gpuId" value={selectedGpuId} /><input
          type="hidden"
          name="startAt"
          value={selectedSlot?.startAt ?? ''}
        /><input type="hidden" name="endAt" value={selectedSlot?.endAt ?? ''} />
        {#if data.user.role === 'admin'}
          <Label class="flex items-center gap-2"
            ><input type="checkbox" name="adminOverride" value="true" bind:checked={bypass} />Bypass
            booking limits</Label
          >
          {#if bypass}<div class="grid gap-2">
              <Label for="dashboard-override-reason">Bypass reason</Label><Input
                id="dashboard-override-reason"
                name="overrideReason"
                required
                minlength={3}
                maxlength={500}
              />
            </div>{/if}
        {/if}
        <div
          class="bg-muted/40 flex flex-wrap items-center justify-between gap-3 rounded-lg border p-4"
        >
          <div class="text-sm">
            {#if data.user.role === 'admin' && bypass}Admin bypass — no quota consumed.{:else if allocation && 'kind' in allocation}<strong
                >{allocation.kind === 'dynamic' ? 'Dynamic' : 'Standard'} slot</strong
              > will be used.{:else if allocation && 'error' in allocation}<span
                class="text-destructive">{allocation.error}</span
              >{:else}Choose a slot to see which allowance it uses.{/if}
          </div>
          <Button type="submit" disabled={!selectedValid}>Reserve GPU</Button>
        </div>
      </form>
    </dialog>
  {/if}

  <section class="min-w-0" aria-label="Seven-day reservation schedule">
    <ReservationTimeline
      bookings={data.schedule}
      days={data.calendarDays}
      timeZone={data.timeZone}
      viewerId={data.user.id}
    />
    {#if data.schedule.length === 0}
      <p class="text-muted-foreground mt-4 text-sm">No bookings in this view.</p>
    {/if}
  </section>
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
              {#if assignment.provisioningStatus === 'applied' && assignment.sshAddress}
                <code class="bg-muted block overflow-x-auto rounded-md border p-3 text-sm">
                  ssh {data.user.username}@{assignment.sshAddress}
                </code>
              {:else if assignment.provisioningStatus === 'applied'}
                <p class="text-muted-foreground text-sm">
                  The SSH address is not available yet. Ask an administrator to set it in
                  workstation settings.
                </p>
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
          An administrator must assign your account before SSH access is available. Administrators
          can reserve any active GPU without an assignment.
        </Card.Description>
      </Card.Header>
    </Card.Root>
  {/if}
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
