<script lang="ts">
  import ScrollTextIcon from '@lucide/svelte/icons/scroll-text';
  import PageHeader from '$lib/components/page-header.svelte';
  import * as Card from '$lib/components/ui/card/index.js';
  import * as Table from '$lib/components/ui/table/index.js';

  let { data } = $props();
  const dateFormatter = new Intl.DateTimeFormat(undefined, {
    dateStyle: 'medium',
    timeStyle: 'medium'
  });
</script>

<svelte:head><title>Audit history · Cluster Manager</title></svelte:head>

<main class="mx-auto grid w-full max-w-7xl gap-6 px-4 py-8 sm:px-6 lg:px-8">
  <PageHeader
    title="Audit history"
    description="The 200 most recent privileged and credential events."
  />

  <Card.Root class="overflow-hidden">
    <Card.Header>
      <Card.Title>Recent events</Card.Title>
      <Card.Description
        >Security-sensitive activity across users and managed nodes.</Card.Description
      >
    </Card.Header>
    <Card.Content class="px-0">
      {#if data.events.length === 0}
        <div
          class="text-muted-foreground flex flex-col items-center gap-3 px-6 py-12 text-center text-sm"
        >
          <ScrollTextIcon class="size-9" aria-hidden="true" />
          <p>No audit events have been recorded.</p>
        </div>
      {:else}
        <Table.Root>
          <Table.Header>
            <Table.Row>
              <Table.Head class="min-w-48 pl-6">When</Table.Head>
              <Table.Head>Who</Table.Head>
              <Table.Head>Action</Table.Head>
              <Table.Head>Target</Table.Head>
              <Table.Head class="min-w-64 pr-6">Details</Table.Head>
            </Table.Row>
          </Table.Header>
          <Table.Body>
            {#each data.events as event (event.id)}
              <Table.Row>
                <Table.Cell class="pl-6 align-top">
                  <time datetime={event.createdAt.toISOString()}
                    >{dateFormatter.format(event.createdAt)}</time
                  >
                </Table.Cell>
                <Table.Cell class="align-top">{event.actorUsername ?? 'system'}</Table.Cell>
                <Table.Cell class="align-top"
                  ><code class="text-xs">{event.action}</code></Table.Cell
                >
                <Table.Cell class="align-top">
                  <div class="grid gap-1">
                    <span>{event.targetType}</span>
                    {#if event.metadata.username}<strong>{String(event.metadata.username)}</strong
                      >{/if}
                    {#if event.targetId}
                      <small class="text-muted-foreground max-w-48 break-all font-mono"
                        >{event.targetId}</small
                      >
                    {/if}
                  </div>
                </Table.Cell>
                <Table.Cell class="pr-6 align-top">
                  <code class="block max-w-xl min-w-64 whitespace-normal break-all text-xs">
                    {JSON.stringify(event.metadata)}
                  </code>
                </Table.Cell>
              </Table.Row>
            {/each}
          </Table.Body>
        </Table.Root>
      {/if}
    </Card.Content>
  </Card.Root>
</main>
