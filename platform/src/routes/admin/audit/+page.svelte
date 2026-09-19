<script lang="ts">
  import ScrollTextIcon from '@lucide/svelte/icons/scroll-text';
  import PageHeader from '$lib/components/page-header.svelte';
  import { Button } from '$lib/components/ui/button/index.js';
  import * as Card from '$lib/components/ui/card/index.js';
  import { Input } from '$lib/components/ui/input/index.js';
  import { Label } from '$lib/components/ui/label/index.js';
  import * as Select from '$lib/components/ui/select/index.js';
  import * as Table from '$lib/components/ui/table/index.js';

  let { data } = $props();
  let dateFormatter = $derived(
    new Intl.DateTimeFormat(undefined, {
      dateStyle: 'medium',
      timeStyle: 'medium',
      timeZone: data.user.timeZone ?? 'UTC'
    })
  );
</script>

<svelte:head><title>Audit history · Cluster Manager</title></svelte:head>

<main class="mx-auto grid w-full max-w-7xl gap-6 px-4 py-8 sm:px-6 lg:px-8">
  <PageHeader
    title="Audit history"
    description="Search retained privileged, credential, reservation, and process-control events."
  />

  <Card.Root>
    <Card.Header>
      <Card.Title>Filter events</Card.Title>
      <Card.Description
        >Dates are interpreted as {data.user.timeZone ?? 'UTC'}. Audit history is retained
        indefinitely by default; include it in database backups.</Card.Description
      >
    </Card.Header>
    <Card.Content>
      <form method="GET" class="grid items-end gap-4 md:grid-cols-2 xl:grid-cols-6">
        <div class="grid gap-2 xl:col-span-2">
          <Label for="audit-query">Search</Label>
          <Input
            id="audit-query"
            name="q"
            value={data.filters.query}
            placeholder="target, action, or metadata"
          />
        </div>
        <div class="grid gap-2">
          <Label for="audit-action">Action</Label>
          <Select.Root type="single" name="action" value={data.filters.action || 'all'}>
            <Select.Trigger id="audit-action" class="w-full"><Select.Value /></Select.Trigger>
            <Select.Content>
              <Select.Item value="all">All actions</Select.Item>
              {#each data.actions as item (item.action)}
                <Select.Item value={item.action}>{item.action}</Select.Item>
              {/each}
            </Select.Content>
          </Select.Root>
        </div>
        <div class="grid gap-2">
          <Label for="audit-actor">Actor username</Label>
          <Input id="audit-actor" name="actor" value={data.filters.actor} />
        </div>
        <div class="grid gap-2">
          <Label for="audit-from">From</Label>
          <Input id="audit-from" name="from" type="date" value={data.filters.from} />
        </div>
        <div class="grid gap-2">
          <Label for="audit-to">To</Label>
          <Input id="audit-to" name="to" type="date" value={data.filters.to} />
        </div>
        <div class="flex gap-2 xl:col-span-6">
          <Button type="submit">Apply filters</Button>
          <Button href="/admin/audit" variant="outline">Clear</Button>
        </div>
      </form>
    </Card.Content>
  </Card.Root>

  <Card.Root class="overflow-hidden">
    <Card.Header>
      <Card.Title>{data.pagination.total} matching events</Card.Title>
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
    {#if data.pagination.previous || data.pagination.next}
      <Card.Footer class="justify-between border-t">
        <span class="text-muted-foreground text-sm">Page {data.pagination.page}</span>
        <div class="flex gap-2">
          {#if data.pagination.previous}<Button href={data.pagination.previous} variant="outline"
              >Previous</Button
            >{/if}
          {#if data.pagination.next}<Button href={data.pagination.next} variant="outline"
              >Next</Button
            >{/if}
        </div>
      </Card.Footer>
    {/if}
  </Card.Root>
</main>
