<script lang="ts">
  import ShieldAlertIcon from '@lucide/svelte/icons/shield-alert';
  import FeedbackAlert from '$lib/components/feedback-alert.svelte';
  import PageHeader from '$lib/components/page-header.svelte';
  import StatusBadge from '$lib/components/status-badge.svelte';
  import { Badge } from '$lib/components/ui/badge/index.js';
  import * as Card from '$lib/components/ui/card/index.js';
  import * as Table from '$lib/components/ui/table/index.js';

  let { data, form } = $props();
  let dateTime = $derived(
    new Intl.DateTimeFormat(undefined, {
      dateStyle: 'medium',
      timeStyle: 'medium',
      timeZone: data.user?.timeZone ?? 'UTC'
    })
  );
</script>

<svelte:head><title>Stop requests</title></svelte:head>

<main class="mx-auto grid w-full max-w-7xl gap-6 px-4 py-8 sm:px-6 lg:px-8">
  <PageHeader
    title="Stop requests"
    description="Track intervention requests for conflicts affecting your current reservations. Only an administrator can terminate a process."
  />

  {#if form?.message}
    <FeedbackAlert message={form.message} success={form.success} />
  {/if}

  <Card.Root>
    <Card.Header class="flex-row items-center justify-between gap-4">
      <div class="space-y-1.5">
        <Card.Title>Your requests</Card.Title>
        <Card.Description
          >Process identities remain visible only to administrators.</Card.Description
        >
      </div>
      <Badge variant="secondary">{data.requests.length} shown</Badge>
    </Card.Header>
    <Card.Content class={data.requests.length > 0 ? 'px-0' : undefined}>
      {#if data.requests.length === 0}
        <div class="text-muted-foreground flex flex-col items-center gap-3 py-10 text-sm">
          <ShieldAlertIcon class="size-9" aria-hidden="true" />
          <p>No stop requests have been created.</p>
        </div>
      {:else}
        <Table.Root>
          <Table.Header>
            <Table.Row>
              <Table.Head class="pl-6">Requested</Table.Head>
              <Table.Head>Workstation</Table.Head>
              <Table.Head>GPU</Table.Head>
              <Table.Head>Status</Table.Head>
              <Table.Head class="pr-6">Result</Table.Head>
            </Table.Row>
          </Table.Header>
          <Table.Body>
            {#each data.requests as item (item.id)}
              <Table.Row>
                <Table.Cell class="pl-6">{dateTime.format(item.requestedAt)}</Table.Cell>
                <Table.Cell>{item.workstationDisplayName}</Table.Cell>
                <Table.Cell>GPU {item.gpuIndex} · {item.gpuModel}</Table.Cell>
                <Table.Cell><StatusBadge status={item.status.replaceAll('_', ' ')} /></Table.Cell>
                <Table.Cell class="text-muted-foreground pr-6 text-sm"
                  >{item.resultMessage ?? 'Awaiting an administrator decision.'}</Table.Cell
                >
              </Table.Row>
            {/each}
          </Table.Body>
        </Table.Root>
      {/if}
    </Card.Content>
  </Card.Root>
</main>
