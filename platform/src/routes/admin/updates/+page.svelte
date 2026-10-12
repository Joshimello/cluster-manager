<script lang="ts">
  import { onMount } from 'svelte';
  import { invalidateAll } from '$app/navigation';
  import { resolve } from '$app/paths';
  import { enhance } from '$app/forms';
  import PageHeader from '$lib/components/page-header.svelte';
  import AccountConfirmation from '$lib/components/account-confirmation.svelte';
  import { Button } from '$lib/components/ui/button/index.js';
  import * as Card from '$lib/components/ui/card/index.js';
  import * as Table from '$lib/components/ui/table/index.js';
  let { data, form } = $props();
  let checking = $state(false);
  let reconnecting = $state(false);
  let active = $derived(
    data.history.find((update) =>
      ['pending', 'preparing', 'backing_up', 'restarting'].includes(update.status)
    )
  );
  onMount(() => {
    let stopped = false;
    const installedAtMount = data.installed;
    const shutdown = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      try {
        // Probe first: a planned outage should not replace this page with an error page.
        const response = await fetch(resolve('/api/updates/status'), {
          cache: 'no-store',
          signal: AbortSignal.any([shutdown.signal, AbortSignal.timeout(8000)])
        });
        if (!response.ok) throw new Error('Offline');
        const status = await response.json();
        if (stopped) return;
        if (typeof status.version === 'string' && status.version !== installedAtMount) {
          window.location.reload();
          return;
        }
        await invalidateAll();
        reconnecting = false;
      } catch {
        reconnecting = true;
      }
      if (!stopped) timer = setTimeout(poll, active ? 3000 : 60_000);
    };
    timer = setTimeout(poll, 3000);
    return () => {
      stopped = true;
      shutdown.abort();
      clearTimeout(timer);
    };
  });
  const time = (value: Date | string) => new Date(value).toLocaleString();
</script>

<svelte:head><title>Updates</title></svelte:head>
<div class="mx-auto grid max-w-7xl gap-6 px-4 py-8 sm:px-6 lg:px-8">
  <PageHeader
    title="Updates"
    description="Check releases and update your platform and workstations."
  />
  {#if form?.message}<p role="status" class="rounded-lg border p-4 text-sm">{form.message}</p>{/if}
  {#if reconnecting}<p role="status" class="rounded-lg border p-4 text-sm">
      Waiting for the platform to reconnect. Keep this page open.
    </p>{/if}
  <Card.Root>
    <Card.Header
      ><Card.Title>Platform</Card.Title><Card.Description
        >Automatic checks every six hours. Updates are installed only when an administrator requests
        them.</Card.Description
      ></Card.Header
    >
    <Card.Content class="grid gap-4">
      <div class="flex flex-wrap items-center gap-3">
        <span>Installed <strong>{data.installed}</strong></span>{#if data.available}<span
            class="bg-primary/10 rounded-full px-3 py-1 text-sm">{data.available} available</span
          >{:else if data.recognizedVersion && data.check.release && !data.check.error}<span
            class="text-muted-foreground text-sm">Up to date</span
          >{/if}
      </div>
      <p class="text-muted-foreground text-sm">
        Updater: {active && data.configured
          ? 'Updating'
          : data.ready
            ? 'Online'
            : data.configured
              ? 'Offline'
              : 'Setup required'}
      </p>
      {#if !data.ready && !active}<p class="text-muted-foreground text-sm">
          {data.configured
            ? 'Start the updater in Container Manager to install releases.'
            : 'Install the updater once on the management host to enable updates here.'}
          <a
            class="underline"
            href="https://github.com/Joshimello/cluster-manager/blob/main/docs/platform-updates.md"
            target="_blank"
            rel="noreferrer">Setup instructions</a
          >
        </p>{/if}
      {#if data.check.checkedAt}<p class="text-muted-foreground text-sm">
          Last checked {time(data.check.checkedAt)}
        </p>{/if}
      {#if data.check.error}<p role="status" class="text-sm">{data.check.error}</p>{/if}
      <div class="flex flex-wrap gap-2">
        <form
          method="POST"
          action="?/check"
          aria-busy={checking}
          use:enhance={() => {
            checking = true;
            return async ({ update }) => {
              try {
                await update();
              } finally {
                checking = false;
              }
            };
          }}
        >
          <Button type="submit" variant="outline" disabled={checking}
            >{checking ? 'Checking…' : 'Check for updates'}</Button
          >
        </form>
        {#if data.available}<AccountConfirmation
            action="?/install"
            username={data.available}
            fields={{ version: data.available }}
            label="Update platform"
            description={`Install ${data.available}? The updater will back up the database and configuration, then restart the platform. The website will briefly be unavailable. Failed migrations may require restoring the backup; older images are not automatically restored.`}
            disabled={!data.ready || !!active}
          />{/if}
      </div>
      {#if data.check.release}<details>
          <summary class="cursor-pointer text-sm font-medium"
            >Release notes · {data.check.release.version}</summary
          >
          <p class="text-muted-foreground mt-3 whitespace-pre-wrap break-words text-sm">
            {data.check.release.notes || 'No release notes provided.'}
          </p>
          <a
            class="mt-3 inline-block text-sm underline"
            href={`https://github.com/Joshimello/cluster-manager/releases/tag/${data.check.release.version}`}
            target="_blank"
            rel="noreferrer">View release on GitHub</a
          >
        </details>{/if}
    </Card.Content>
  </Card.Root>
  <Card.Root
    ><Card.Header><Card.Title>Update history</Card.Title></Card.Header><Card.Content>
      {#if data.history.length}<Table.Root
          ><Table.Header
            ><Table.Row
              ><Table.Head>Requested</Table.Head><Table.Head>Release</Table.Head><Table.Head
                >Status</Table.Head
              ><Table.Head>Details</Table.Head></Table.Row
            ></Table.Header
          ><Table.Body
            >{#each data.history as update (update.id)}<Table.Row
                ><Table.Cell>{time(update.createdAt)}</Table.Cell><Table.Cell
                  >{update.sourceVersion} → {update.targetVersion}</Table.Cell
                ><Table.Cell class="capitalize">{update.status.replaceAll('_', ' ')}</Table.Cell
                ><Table.Cell class="whitespace-normal"
                  >{update.detail}{#if ['succeeded', 'failed'].includes(update.status)}<span
                      class="text-muted-foreground mt-1 block text-xs"
                      >Backup reference: {update.id}</span
                    >{/if}</Table.Cell
                ></Table.Row
              >{/each}</Table.Body
          ></Table.Root
        >{:else}<p class="text-muted-foreground text-sm">No platform updates requested yet.</p>{/if}
    </Card.Content></Card.Root
  >
  <Card.Root
    ><Card.Header
      ><Card.Title>Workstations</Card.Title><Card.Description
        >Install node releases from each workstation’s Software updates tab.</Card.Description
      ></Card.Header
    ><Card.Content>
      {#if data.nodes.length}<Table.Root
          ><Table.Header
            ><Table.Row
              ><Table.Head>Workstation</Table.Head><Table.Head>Installed</Table.Head><Table.Head
                >Update support</Table.Head
              ><Table.Head>Latest update</Table.Head></Table.Row
            ></Table.Header
          ><Table.Body
            >{#each data.nodes as node (node.id)}<Table.Row
                ><Table.Cell
                  ><a class="underline" href={resolve('/admin/workstations/[id]', { id: node.id })}
                    >{node.name}</a
                  ></Table.Cell
                ><Table.Cell
                  >{node.version || 'Unknown'}{#if node.available}<span
                      class="bg-primary/10 ml-2 rounded-full px-2 py-1 text-xs"
                      >{node.available} available</span
                    >{/if}</Table.Cell
                ><Table.Cell
                  >{node.supported ? 'Managed updates' : 'Manual upgrade required'}</Table.Cell
                ><Table.Cell>{node.latestUpdate?.replaceAll('_', ' ') ?? '—'}</Table.Cell
                ></Table.Row
              >{/each}</Table.Body
          ></Table.Root
        >{:else}<p class="text-muted-foreground text-sm">No workstations enrolled.</p>{/if}
    </Card.Content></Card.Root
  >
</div>
