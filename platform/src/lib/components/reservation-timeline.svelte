<script lang="ts">
  import { enhance } from '$app/forms';
  import { reservationSegmentsForDay, type WeekDay } from '$lib/reservation-week';
  import { Button } from '$lib/components/ui/button/index.js';
  import { Badge } from '$lib/components/ui/badge/index.js';

  type Booking = {
    id: string;
    userId: string;
    username: string;
    owner?: string;
    displayName?: string;
    workstationName: string;
    gpuIndex: number;
    gpuModel?: string;
    startAt: Date;
    endAt: Date;
    quotaKind?: string;
    overnightSlot?: boolean;
    isAdminOverride: boolean;
  };
  let {
    bookings,
    days,
    timeZone,
    viewerId,
    cancelAction = '?/cancel'
  }: {
    bookings: Booking[];
    days: WeekDay[];
    timeZone: string;
    viewerId: string;
    cancelAction?: string | null;
  } = $props();
  let dialog = $state<HTMLDialogElement>();
  let selected = $state<Booking | null>(null);
  let rows = $derived(
    days.map((day) => ({
      ...day,
      segments: reservationSegmentsForDay(bookings, day.key, timeZone)
    }))
  );
  let dateTime = $derived(
    new Intl.DateTimeFormat('en-MY', { timeZone, dateStyle: 'medium', timeStyle: 'short' })
  );
  const hue = (id: string) => {
    let hash = 0;
    for (const character of id) hash = (hash * 31 + character.charCodeAt(0)) | 0;
    return [210, 145, 275, 25, 335, 180, 50, 240][Math.abs(hash) % 8];
  };
  const owner = (booking: Booking) => booking.owner ?? booking.displayName ?? booking.username;
</script>

<div class="min-w-0 overflow-x-auto rounded-lg border" aria-label="Seven-day reservation timeline">
  <div class="min-w-[52rem]">
    <div class="bg-muted/40 grid grid-cols-[7rem_minmax(0,1fr)] border-b">
      <div class="px-3 py-3 text-xs font-medium">{timeZone}</div>
      <div class="relative h-10 text-xs">
        {#each [0, 4, 8, 12, 16, 20, 24] as hour (hour)}
          <span
            class="absolute top-3"
            style={`left: ${(hour / 24) * 100}%; transform: translateX(${hour === 0 ? '0' : hour === 24 ? '-100%' : '-50%'});`}
          >
            {hour === 24 ? '24:00' : `${String(hour).padStart(2, '0')}:00`}
          </span>
        {/each}
      </div>
    </div>
    {#each rows as day, index (day.key)}
      {@const laneCount = day.segments[0]?.laneCount ?? 1}
      <div
        class="grid grid-cols-[7rem_minmax(0,1fr)] border-b last:border-b-0"
        aria-label={day.label}
      >
        <div
          class={index === 0
            ? 'bg-primary/5 border-r p-3 text-sm font-semibold'
            : 'bg-background border-r p-3 text-sm'}
        >
          <div>{day.label}</div>
          {#if index === 0}<div class="text-primary mt-1 text-xs font-medium">Today</div>{/if}
        </div>
        <div
          class="relative"
          style={`height: ${Math.max(68, laneCount * 40 + 16)}px; background-image: repeating-linear-gradient(to right, transparent 0, transparent calc(8.3333% - 1px), var(--border) calc(8.3333% - 1px), var(--border) 8.3333%);`}
        >
          <div class="bg-muted/30 pointer-events-none absolute inset-y-0 left-0 w-1/3"></div>
          {#each day.segments as segment (segment.reservation.id)}
            {@const booking = segment.reservation}
            <button
              type="button"
              class="text-foreground absolute z-10 overflow-hidden rounded-md border px-2 text-left text-xs shadow-sm transition hover:brightness-95 focus-visible:outline-2 focus-visible:outline-offset-2"
              style={`top: ${segment.lane * 40 + 8}px; height: 32px; left: calc(${(segment.startMinute / 1440) * 100}% + 2px); width: calc(${((segment.endMinute - segment.startMinute) / 1440) * 100}% - 4px); border-color: hsl(${hue(booking.userId)} 65% 55%); background: color-mix(in srgb, hsl(${hue(booking.userId)} 65% 55%) 22%, var(--background));`}
              aria-label={`${owner(booking)}, ${booking.workstationName} GPU ${booking.gpuIndex}, ${dateTime.format(booking.startAt)} to ${dateTime.format(booking.endAt)}. Show reservation details.`}
              title={`${owner(booking)} · ${booking.workstationName} GPU ${booking.gpuIndex}`}
              onclick={() => {
                selected = booking;
                dialog?.showModal();
              }}
              ><span class="block truncate font-medium"
                >{owner(booking)} · {booking.workstationName} GPU {booking.gpuIndex}</span
              ></button
            >
          {/each}
        </div>
      </div>
    {/each}
  </div>
</div>
<p class="text-muted-foreground mt-3 text-xs">
  Time runs left to right. Colors identify users; click a bar for booking details. Shaded hours are
  overnight slots. Scroll sideways on smaller screens.
</p>

<dialog
  bind:this={dialog}
  aria-labelledby="reservation-details-title"
  class="bg-background text-foreground fixed inset-0 m-auto max-h-[calc(100dvh-2rem)] w-[min(32rem,calc(100vw-2rem))] overflow-y-auto rounded-xl border p-6 shadow-xl backdrop:bg-black/50"
>
  <h2 id="reservation-details-title" class="text-xl font-semibold">Reservation details</h2>
  {#if selected}
    <dl class="my-5 grid grid-cols-[auto_1fr] gap-x-5 gap-y-3 text-sm">
      <dt class="text-muted-foreground">Booked by</dt>
      <dd>
        {selected.displayName ?? selected.owner ?? selected.username}
        <span class="text-muted-foreground">({selected.username})</span>
      </dd>
      <dt class="text-muted-foreground">Workstation</dt>
      <dd>{selected.workstationName}</dd>
      <dt class="text-muted-foreground">GPU</dt>
      <dd>GPU {selected.gpuIndex}{selected.gpuModel ? ` · ${selected.gpuModel}` : ''}</dd>
      <dt class="text-muted-foreground">Starts</dt>
      <dd>{dateTime.format(selected.startAt)}</dd>
      <dt class="text-muted-foreground">Ends</dt>
      <dd>{dateTime.format(selected.endAt)}</dd>
      <dt class="text-muted-foreground">Timezone</dt>
      <dd>{timeZone}</dd>
      <dt class="text-muted-foreground">Slot</dt>
      <dd>
        <Badge variant="outline"
          >{selected.isAdminOverride
            ? 'Admin bypass'
            : selected.quotaKind === 'dynamic'
              ? 'Dynamic'
              : selected.quotaKind === 'standard'
                ? 'Standard'
                : 'Existing booking'}</Badge
        >{#if selected.overnightSlot}<Badge variant="secondary" class="ml-2">Overnight</Badge>{/if}
      </dd>
    </dl>
    <div class="flex justify-end gap-2">
      {#if cancelAction && selected.userId === viewerId && selected.endAt.getTime() > Date.now()}
        <form
          method="POST"
          action={cancelAction}
          use:enhance={() =>
            async ({ result, update }) => {
              if (result.type === 'success') dialog?.close();
              await update();
            }}
        >
          <input type="hidden" name="reservationId" value={selected.id} />
          <Button type="submit" variant="destructive">Cancel reservation</Button>
        </form>
      {/if}
      <Button type="button" variant="outline" onclick={() => dialog?.close()}>Close</Button>
    </div>
  {/if}
</dialog>
