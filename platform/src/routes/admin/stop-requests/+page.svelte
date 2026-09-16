<script lang="ts">
  import ShieldAlertIcon from '@lucide/svelte/icons/shield-alert';
  import { resolve } from '$app/paths';
  import PageHeader from '$lib/components/page-header.svelte';
  import StatusBadge from '$lib/components/status-badge.svelte';
  import { Badge } from '$lib/components/ui/badge/index.js';
  import { Button } from '$lib/components/ui/button/index.js';
  import * as Card from '$lib/components/ui/card/index.js';
  import * as Table from '$lib/components/ui/table/index.js';

  let { data } = $props();
  const dateTime = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'medium' });
</script>

<svelte:head><title>Stop requests · Administration · Cluster Manager</title></svelte:head>

<main class="mx-auto grid w-full max-w-7xl gap-6 px-4 py-8 sm:px-6 lg:px-8">
  <PageHeader
    title="Stop requests"
    description="Review detected reservation conflicts and decide whether a specific captured process should be terminated."
  />

  <div class="flex items-center gap-2">
    <Badge variant={data.actionableCount > 0 ? 'destructive' : 'secondary'}>
      {data.actionableCount} actionable
    </Badge>
    <Badge variant="outline">{data.requests.length} shown</Badge>
  </div>

  <Card.Root>
    <Card.Content class={data.requests.length > 0 ? 'px-0 pt-6' : undefined}>
      {#if data.requests.length === 0}
        <div class="text-muted-foreground flex flex-col items-center gap-3 py-10 text-sm">
          <ShieldAlertIcon class="size-9" aria-hidden="true" />
          <p>No stop requests have been submitted.</p>
        </div>
      {:else}
        <Table.Root>
          <Table.Header>
            <Table.Row>
              <Table.Head class="pl-6">Requested</Table.Head>
              <Table.Head>Owner</Table.Head>
              <Table.Head>Target</Table.Head>
              <Table.Head>Location</Table.Head>
              <Table.Head>Status</Table.Head>
              <Table.Head class="pr-6 text-right">Review</Table.Head>
            </Table.Row>
          </Table.Header>
          <Table.Body>
            {#each data.requests as item (item.id)}
              <Table.Row>
                <Table.Cell class="pl-6">{dateTime.format(item.requestedAt)}</Table.Cell>
                <Table.Cell>
                  <div class="grid">
                    <strong>{item.requesterDisplayName}</strong>
                    <span class="text-muted-foreground text-xs">{item.requesterUsername}</span>
                  </div>
                </Table.Cell>
                <Table.Cell>
                  <code>{item.targetUsername} · PID {item.targetPid}</code>
                </Table.Cell>
                <Table.Cell>{item.workstationName} · GPU {item.gpuIndex}</Table.Cell>
                <Table.Cell><StatusBadge status={item.status.replaceAll('_', ' ')} /></Table.Cell>
                <Table.Cell class="pr-6 text-right">
                  <Button
                    href={resolve('/admin/stop-requests/[id]', { id: item.id })}
                    variant="outline"
                    size="sm">Review</Button
                  >
                </Table.Cell>
              </Table.Row>
            {/each}
          </Table.Body>
        </Table.Root>
      {/if}
    </Card.Content>
  </Card.Root>
</main>
