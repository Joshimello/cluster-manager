<script lang="ts">
  import ClockIcon from '@lucide/svelte/icons/clock';
  import KeyRoundIcon from '@lucide/svelte/icons/key-round';
  import { resolve } from '$app/paths';
  import FeedbackAlert from '$lib/components/feedback-alert.svelte';
  import PageHeader from '$lib/components/page-header.svelte';
  import { Button } from '$lib/components/ui/button/index.js';
  import * as Card from '$lib/components/ui/card/index.js';
  import { Input } from '$lib/components/ui/input/index.js';
  import { Label } from '$lib/components/ui/label/index.js';
  import { defaultTimeZone } from '$lib/time-zone';

  let { data, form } = $props();
  let selectedTimeZone = $derived(form?.timeZone ?? data.user.timeZone ?? defaultTimeZone);
</script>

<svelte:head><title>Account settings · Cluster Manager</title></svelte:head>

<main class="mx-auto grid w-full max-w-2xl gap-6 px-4 py-8 sm:px-6 lg:px-8">
  <PageHeader title="Account settings" description="Control how Cluster Manager appears to you." />

  <Card.Root>
    <Card.Header>
      <Card.Title class="flex items-center gap-2"><ClockIcon class="size-5" />Time zone</Card.Title>
      <Card.Description>
        Dates and reservation inputs are shown in this time zone. Timestamps remain stored as UTC.
      </Card.Description>
    </Card.Header>
    <Card.Content class="gap-4">
      {#if form?.message}<FeedbackAlert message={form.message} success={form.success} />{/if}
      <form method="POST" class="grid gap-4 sm:grid-cols-[1fr_auto] sm:items-end">
        <div class="grid gap-2">
          <Label for="time-zone">IANA time zone</Label>
          <Input
            id="time-zone"
            name="timeZone"
            list="time-zone-options"
            value={selectedTimeZone}
            required
          />
          <datalist id="time-zone-options">
            {#each data.timeZones as timeZone (timeZone)}
              <option value={timeZone}></option>
            {/each}
          </datalist>
        </div>
        <Button type="submit">Save time zone</Button>
      </form>
    </Card.Content>
  </Card.Root>

  <Card.Root size="sm">
    <Card.Header>
      <Card.Title>Password</Card.Title>
      <Card.Description
        >Your platform and workstation password remain synchronized.</Card.Description
      >
    </Card.Header>
    <Card.Footer>
      <Button href={resolve('/change-password')} variant="outline">
        <KeyRoundIcon data-icon="inline-start" />Change password
      </Button>
    </Card.Footer>
  </Card.Root>
</main>
