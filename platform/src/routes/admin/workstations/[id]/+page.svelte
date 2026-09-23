<script lang="ts">
  import ArrowLeftIcon from '@lucide/svelte/icons/arrow-left';
  import RefreshCwIcon from '@lucide/svelte/icons/refresh-cw';
  import ShieldCheckIcon from '@lucide/svelte/icons/shield-check';
  import FlameIcon from '@lucide/svelte/icons/flame';
  import { onMount } from 'svelte';
  import { invalidateAll } from '$app/navigation';
  import { resolve } from '$app/paths';
  import CredentialDisplay from '$lib/components/credential-display.svelte';
  import FeedbackAlert from '$lib/components/feedback-alert.svelte';
  import GpuMonitor from '$lib/components/gpu-monitor.svelte';
  import HostMonitor from '$lib/components/host-monitor.svelte';
  import MonitoringHistoryProvider from '$lib/components/monitoring-history-provider.svelte';
  import MonitoringRangeSelector from '$lib/components/monitoring-range-selector.svelte';
  import PageHeader from '$lib/components/page-header.svelte';
  import StatusBadge from '$lib/components/status-badge.svelte';
  import { Button } from '$lib/components/ui/button/index.js';
  import * as Card from '$lib/components/ui/card/index.js';
  import { Input } from '$lib/components/ui/input/index.js';
  import { Label } from '$lib/components/ui/label/index.js';
  import * as Table from '$lib/components/ui/table/index.js';

  type DetailTab = 'overview' | 'monitoring' | 'updates' | 'diagnostics' | 'settings';
  const sections: { id: DetailTab; label: string }[] = [
    { id: 'overview', label: 'Overview' },
    { id: 'monitoring', label: 'Monitoring' },
    { id: 'updates', label: 'Software updates' },
    { id: 'diagnostics', label: 'GPU diagnostics' },
    { id: 'settings', label: 'Settings' }
  ];
  const tabForAction = (action?: string): DetailTab | null => {
    if (action === 'issueEnrollment' || action === 'revoke' || action === 'setStatus')
      return 'settings';
    if (action === 'queueUpdate' || action === 'cancelUpdate') return 'updates';
    if (action === 'queueDiagnostic' || action === 'cancelDiagnostic') return 'diagnostics';
    return null;
  };

  let { data, form } = $props();
  let manualTab = $state<DetailTab | null>(null);
  let activeTab = $derived(manualTab ?? tabForAction(form?.action) ?? 'overview');
  let ws = $derived(data.workstation);
  let supportsManagedUpdate = $derived(ws.nodeCapabilities.includes(data.managedUpdateCapability));
  let supportsGpuDiagnostics = $derived(
    ws.nodeCapabilities.includes(data.gpuDiagnosticsCapability)
  );
  let activeUpdate = $derived(
    data.updates.find((update) => ['pending', 'dispatched', 'restarting'].includes(update.status))
  );
  let activeDiagnostic = $derived(
    data.diagnostics.find((run) =>
      ['pending', 'dispatched', 'running', 'cancel_requested'].includes(run.status)
    )
  );
  let dateTime = $derived(
    new Intl.DateTimeFormat(undefined, {
      dateStyle: 'medium',
      timeStyle: 'medium',
      timeZone: data.user.timeZone ?? 'UTC'
    })
  );
  onMount(() => {
    const timer = window.setInterval(() => {
      if (!form?.enrollmentToken && activeTab !== 'settings') void invalidateAll();
    }, 10_000);
    return () => window.clearInterval(timer);
  });
</script>

<svelte:head><title>{ws.name} · Workstations</title></svelte:head>

<MonitoringHistoryProvider workstationIds={[ws.id]} range={data.range}>
  <main class="mx-auto grid w-full max-w-7xl gap-6 px-4 py-8 sm:px-6 lg:px-8">
    <Button variant="ghost" size="sm" href={resolve('/admin/workstations')} class="w-fit">
      <ArrowLeftIcon aria-hidden="true" />
      All workstations
    </Button>

    <div class="flex flex-col justify-between gap-4 sm:flex-row sm:items-end">
      <PageHeader title={ws.displayName} description={ws.name} />
      <div class="flex flex-wrap gap-2">
        <StatusBadge status={ws.connectionState} />
        <StatusBadge status={ws.status} />
      </div>
    </div>

    {#if form?.message}
      <FeedbackAlert message={form.message} success={form.success} />
    {/if}

    {#if form?.enrollmentToken}
      <CredentialDisplay
        title="Copy this enrollment token now"
        description={`It is shown only in this response and expires at ${dateTime.format(new Date(form.enrollmentExpiresAt))}.`}
        entries={[
          { label: 'Workstation', value: form.enrollmentName },
          { label: 'Enrollment token', value: form.enrollmentToken }
        ]}
      />
    {/if}

    <div class="grid min-w-0 gap-6 lg:grid-cols-[12rem_minmax(0,1fr)]">
      <nav
        class="grid grid-cols-2 gap-1 sm:flex sm:flex-wrap lg:sticky lg:top-4 lg:self-start lg:flex-col"
        aria-label="Workstation sections"
      >
        {#each sections as section (section.id)}
          <Button
            type="button"
            variant={activeTab === section.id ? 'secondary' : 'ghost'}
            class="justify-start lg:w-full"
            aria-pressed={activeTab === section.id}
            onclick={() => (manualTab = section.id)}
          >
            {section.label}
          </Button>
        {/each}
      </nav>

      <div class="grid min-w-0 content-start gap-6">
        {#if activeTab === 'overview'}
          <Card.Root>
            <Card.Header>
              <Card.Title>Node facts</Card.Title>
              <Card.Description
                >Identity and health information from the latest heartbeat.</Card.Description
              >
            </Card.Header>
            <Card.Content class="grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
              <div class="grid gap-1">
                <span class="text-muted-foreground text-sm">Last heartbeat</span>
                <strong>{ws.lastHeartbeatAt ? dateTime.format(ws.lastHeartbeatAt) : 'Never'}</strong
                >
              </div>
              <div class="grid gap-1">
                <span class="text-muted-foreground text-sm">Node version</span>
                <strong>{ws.nodeVersion ?? 'Unknown'}</strong>
              </div>
              <div class="grid gap-1">
                <span class="text-muted-foreground text-sm">Hostname</span>
                <strong class="break-all">{ws.hostname ?? 'Unknown'}</strong>
              </div>
              <div class="grid gap-1">
                <span class="text-muted-foreground text-sm">Uptime</span>
                <strong
                  >{ws.uptimeSeconds === null
                    ? 'Unknown'
                    : `${ws.uptimeSeconds.toLocaleString()} seconds`}</strong
                >
              </div>
            </Card.Content>
          </Card.Root>
        {/if}

        {#if activeTab === 'overview' || activeTab === 'monitoring'}
          {#if ws.inventory}
            {#if activeTab === 'monitoring'}
              <section class="grid gap-3" aria-labelledby="resource-monitoring-heading">
                <div class="flex flex-wrap items-end justify-between gap-3">
                  <div>
                    <h2
                      id="resource-monitoring-heading"
                      class="text-xl font-semibold tracking-tight"
                    >
                      Resource monitoring
                    </h2>
                    <p class="text-muted-foreground text-sm">
                      Current values and recent history from the node.
                    </p>
                  </div>
                  <MonitoringRangeSelector range={data.range} />
                </div>
                <HostMonitor
                  workstationId={ws.id}
                  inventory={ws.inventory}
                  observedAt={ws.inventoryObservedAt}
                  telemetryState={ws.connectionState}
                  timeZone={data.user.timeZone ?? 'UTC'}
                />
              </section>

              <section class="grid gap-3" aria-labelledby="gpu-monitoring-heading">
                <div>
                  <h2 id="gpu-monitoring-heading" class="text-xl font-semibold tracking-tight">
                    GPU monitoring
                  </h2>
                  <p class="text-muted-foreground text-sm">
                    Current NVIDIA telemetry refreshes every 10 seconds.
                  </p>
                </div>
                <GpuMonitor
                  workstationId={ws.id}
                  gpus={data.gpus}
                  gpuStatus={ws.inventory.gpuStatus}
                  autoRefresh={false}
                  timeZone={data.user.timeZone ?? 'UTC'}
                />
              </section>
            {/if}

            {#if activeTab === 'overview'}
              <Card.Root>
                <Card.Header>
                  <Card.Title>Logged-in sessions</Card.Title>
                  <Card.Description>Interactive sessions reported by the node.</Card.Description>
                </Card.Header>
                <Card.Content class={ws.inventory.sessions.length > 0 ? 'px-0' : undefined}>
                  {#if ws.inventory.sessions.length === 0}
                    <p class="text-muted-foreground text-sm">No sessions reported.</p>
                  {:else}
                    <Table.Root>
                      <Table.Header>
                        <Table.Row>
                          <Table.Head class="pl-6">User</Table.Head>
                          <Table.Head>Terminal</Table.Head>
                          <Table.Head class="pr-6">Remote host</Table.Head>
                        </Table.Row>
                      </Table.Header>
                      <Table.Body>
                        {#each ws.inventory.sessions as session (session.username + session.terminal)}
                          <Table.Row>
                            <Table.Cell class="pl-6 font-medium">{session.username}</Table.Cell>
                            <Table.Cell><code>{session.terminal}</code></Table.Cell>
                            <Table.Cell class="pr-6">{session.remoteHost ?? 'Local'}</Table.Cell>
                          </Table.Row>
                        {/each}
                      </Table.Body>
                    </Table.Root>
                  {/if}
                </Card.Content>
              </Card.Root>
            {/if}
          {:else}
            <Card.Root>
              <Card.Header>
                <Card.Title>Waiting for inventory</Card.Title>
                <Card.Description
                  >Enroll and start this node to receive its first report.</Card.Description
                >
              </Card.Header>
            </Card.Root>
          {/if}
        {/if}

        {#if activeTab === 'updates'}
          <Card.Root>
            <Card.Header>
              <Card.Title class="flex items-center gap-2">
                <RefreshCwIcon class="size-5" aria-hidden="true" />
                Node software update
              </Card.Title>
              <Card.Description>
                Install a verified GitHub release. The node keeps its current binary and service
                definition until the replacement authenticates and sends a healthy heartbeat.
              </Card.Description>
            </Card.Header>
            <Card.Content class="grid gap-5">
              <div class="bg-muted/50 grid gap-3 rounded-lg border p-4 sm:grid-cols-3">
                <div class="grid gap-1">
                  <span class="text-muted-foreground text-sm">Managed updates</span>
                  <strong>{supportsManagedUpdate ? 'Supported' : 'Manual upgrade required'}</strong>
                </div>
                <div class="grid gap-1">
                  <span class="text-muted-foreground text-sm">Current version</span>
                  <strong>{ws.nodeVersion ?? 'Unknown'}</strong>
                </div>
                <div class="grid gap-1">
                  <span class="text-muted-foreground text-sm">Update state</span>
                  {#if activeUpdate}
                    <StatusBadge status={activeUpdate.status} />
                  {:else}
                    <strong>Idle</strong>
                  {/if}
                </div>
              </div>

              {#if activeUpdate}
                <div
                  class="grid gap-3 rounded-lg border p-4 sm:grid-cols-[1fr_auto] sm:items-center"
                >
                  <div class="grid gap-1">
                    <strong>{activeUpdate.sourceVersion} → {activeUpdate.targetVersion}</strong>
                    <p class="text-muted-foreground text-sm">
                      {activeUpdate.detail ?? 'Waiting for the node to report progress.'}
                    </p>
                    <p class="text-muted-foreground text-xs">
                      Requested {dateTime.format(activeUpdate.createdAt)} · expires {dateTime.format(
                        activeUpdate.expiresAt
                      )}
                    </p>
                  </div>
                  {#if activeUpdate.status === 'pending'}
                    <form method="POST" action="?/cancelUpdate">
                      <input type="hidden" name="updateId" value={activeUpdate.id} />
                      <Button type="submit" variant="outline">Cancel</Button>
                    </form>
                  {/if}
                </div>
              {:else if supportsManagedUpdate}
                <form
                  method="POST"
                  action="?/queueUpdate"
                  class="grid items-end gap-4 lg:grid-cols-[1fr_1fr_auto]"
                >
                  <div class="grid gap-2">
                    <Label for="node-target-version">Exact stable release</Label>
                    <Input
                      id="node-target-version"
                      name="targetVersion"
                      required
                      placeholder="v0.3.0"
                      pattern="v(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)"
                      value={form?.action === 'queueUpdate' &&
                      form.values &&
                      'targetVersion' in form.values
                        ? (form.values.targetVersion ?? '')
                        : ''}
                    />
                  </div>
                  <div class="grid gap-2">
                    <Label for="node-update-confirmation">Type {ws.name} to confirm</Label>
                    <Input
                      id="node-update-confirmation"
                      name="confirmation"
                      required
                      autocomplete="off"
                      value={form?.action === 'queueUpdate'
                        ? (form.values?.confirmation ?? '')
                        : ''}
                    />
                  </div>
                  <Button
                    type="submit"
                    disabled={ws.connectionState !== 'online' || ws.status !== 'active'}
                  >
                    Install release
                  </Button>
                </form>
              {:else}
                <p class="text-muted-foreground text-sm">
                  Install the first compatible release with
                  <code>sudo /usr/local/sbin/cluster-node upgrade</code>. After that, future updates
                  can be safely requested here.
                </p>
              {/if}

              <div class="flex gap-3 rounded-lg border p-4">
                <ShieldCheckIcon
                  class="text-muted-foreground mt-0.5 size-5 shrink-0"
                  aria-hidden="true"
                />
                <p class="text-muted-foreground text-sm">
                  Only the node binary and systemd service are updated. Configuration, credentials,
                  Linux users, homes, and running jobs are left alone. If the new node cannot
                  authenticate and complete three healthy heartbeats, the local watchdog restores
                  the previous version automatically.
                </p>
              </div>

              {#if data.updates.length > 0}
                <div class="grid gap-3">
                  <h3 class="font-medium">Recent update history</h3>
                  <div class="overflow-hidden rounded-lg border">
                    <Table.Root>
                      <Table.Header>
                        <Table.Row>
                          <Table.Head class="pl-4">Release</Table.Head>
                          <Table.Head>Status</Table.Head>
                          <Table.Head>Detail</Table.Head>
                          <Table.Head class="pr-4">Requested</Table.Head>
                        </Table.Row>
                      </Table.Header>
                      <Table.Body>
                        {#each data.updates as update (update.id)}
                          <Table.Row>
                            <Table.Cell class="pl-4 font-medium"
                              >{update.sourceVersion} → {update.targetVersion}</Table.Cell
                            >
                            <Table.Cell><StatusBadge status={update.status} /></Table.Cell>
                            <Table.Cell class="max-w-md text-sm">{update.detail ?? '—'}</Table.Cell>
                            <Table.Cell class="pr-4 text-sm"
                              >{dateTime.format(update.createdAt)}</Table.Cell
                            >
                          </Table.Row>
                        {/each}
                      </Table.Body>
                    </Table.Root>
                  </div>
                </div>
              {/if}
            </Card.Content>
          </Card.Root>
        {/if}

        {#if activeTab === 'diagnostics'}
          <Card.Root>
            <Card.Header>
              <Card.Title class="flex items-center gap-2">
                <FlameIcon class="size-5" aria-hidden="true" />
                GPU diagnostics
              </Card.Title>
              <Card.Description>
                Run a guarded gpu-burn stress test. The node refuses to start when a target has a
                process, reservation, stale identity, untrusted image, or unsafe temperature.
              </Card.Description>
            </Card.Header>
            <Card.Content class="grid gap-5">
              <div class="bg-muted/50 grid gap-3 rounded-lg border p-4 sm:grid-cols-3">
                <div class="grid gap-1">
                  <span class="text-muted-foreground text-sm">Diagnostics</span>
                  <strong>{supportsGpuDiagnostics ? 'Ready' : 'Not configured'}</strong>
                </div>
                <div class="grid gap-1">
                  <span class="text-muted-foreground text-sm">Target availability</span>
                  <strong
                    >{data.gpus.filter((gpu) => gpu.processCount === 0).length} of {data.gpus
                      .length} idle</strong
                  >
                </div>
                <div class="grid gap-1">
                  <span class="text-muted-foreground text-sm">Test state</span>
                  {#if activeDiagnostic}
                    <StatusBadge status={activeDiagnostic.status} />
                  {:else}
                    <strong>Idle</strong>
                  {/if}
                </div>
              </div>

              {#if activeDiagnostic}
                <div
                  class="grid gap-3 rounded-lg border p-4 sm:grid-cols-[1fr_auto] sm:items-center"
                >
                  <div class="grid gap-1">
                    <strong>
                      {activeDiagnostic.scope === 'all' ? 'All GPUs' : 'Single GPU'} ·
                      {activeDiagnostic.durationSeconds}s · {activeDiagnostic.memoryPercent}% VRAM
                    </strong>
                    <p class="text-muted-foreground text-sm">
                      {activeDiagnostic.detail ?? 'Waiting for the node to report progress.'}
                    </p>
                    <Button
                      variant="link"
                      class="h-auto w-fit p-0"
                      href={resolve(
                        `/admin/workstations/${ws.id}/diagnostics/${activeDiagnostic.id}`
                      )}>View live diagnostic</Button
                    >
                  </div>
                  <form method="POST" action="?/cancelDiagnostic">
                    <input type="hidden" name="runId" value={activeDiagnostic.id} />
                    <Button type="submit" variant="destructive">Cancel test</Button>
                  </form>
                </div>
              {:else if supportsGpuDiagnostics && data.gpus.length > 0}
                <form method="POST" action="?/queueDiagnostic" class="grid gap-4">
                  <div class="grid gap-4 md:grid-cols-2 lg:grid-cols-5">
                    <div class="grid gap-2">
                      <Label for="diagnostic-target">GPU target</Label>
                      <select
                        id="diagnostic-target"
                        name="target"
                        class="border-input bg-background h-9 rounded-md border px-3 text-sm shadow-xs"
                        required
                      >
                        <option value="all">All GPUs</option>
                        {#each data.gpus as gpu (gpu.id)}
                          <option value={gpu.id}>GPU {gpu.index} · {gpu.model}</option>
                        {/each}
                      </select>
                    </div>
                    <div class="grid gap-2">
                      <Label for="diagnostic-duration">Duration (seconds)</Label>
                      <Input
                        id="diagnostic-duration"
                        name="durationSeconds"
                        type="number"
                        min="10"
                        max="1800"
                        value="60"
                        required
                      />
                    </div>
                    <div class="grid gap-2">
                      <Label for="diagnostic-memory">VRAM (%)</Label>
                      <Input
                        id="diagnostic-memory"
                        name="memoryPercent"
                        type="number"
                        min="50"
                        max="90"
                        value="90"
                        required
                      />
                    </div>
                    <div class="grid gap-2">
                      <Label for="diagnostic-workload">Workload</Label>
                      <select
                        id="diagnostic-workload"
                        name="workload"
                        class="border-input bg-background h-9 rounded-md border px-3 text-sm shadow-xs"
                        required
                      >
                        <option value="fp32">FP32</option>
                        <option value="fp64">FP64</option>
                        <option value="tensor">Tensor Core</option>
                      </select>
                    </div>
                    <div class="grid gap-2">
                      <Label for="diagnostic-temperature">Stop at (°C)</Label>
                      <Input
                        id="diagnostic-temperature"
                        name="temperatureCutoffC"
                        type="number"
                        min="70"
                        max="90"
                        value="85"
                        required
                      />
                    </div>
                  </div>
                  <div class="grid items-end gap-4 sm:grid-cols-[1fr_auto]">
                    <div class="grid gap-2">
                      <Label for="diagnostic-confirmation"
                        >Type {ws.name} to confirm this intensive test</Label
                      >
                      <Input
                        id="diagnostic-confirmation"
                        name="confirmation"
                        required
                        autocomplete="off"
                      />
                    </div>
                    <Button
                      type="submit"
                      variant="destructive"
                      disabled={ws.connectionState !== 'online'}
                    >
                      Start stress test
                    </Button>
                  </div>
                </form>
              {:else}
                <p class="text-muted-foreground text-sm">
                  {supportsGpuDiagnostics
                    ? 'No active NVIDIA GPU is available.'
                    : 'Run sudo /usr/local/sbin/cluster-node diagnostics setup on the workstation, then re-run node doctor.'}
                </p>
              {/if}

              {#if data.diagnostics.length > 0}
                <div class="grid gap-3">
                  <h3 class="font-medium">Recent diagnostic history</h3>
                  <div class="overflow-hidden rounded-lg border">
                    <Table.Root>
                      <Table.Header>
                        <Table.Row>
                          <Table.Head class="pl-4">Target</Table.Head>
                          <Table.Head>Status</Table.Head>
                          <Table.Head>Settings</Table.Head>
                          <Table.Head class="pr-4">Requested</Table.Head>
                        </Table.Row>
                      </Table.Header>
                      <Table.Body>
                        {#each data.diagnostics as diagnostic (diagnostic.id)}
                          <Table.Row>
                            <Table.Cell class="pl-4 font-medium">
                              <a
                                class="hover:underline"
                                href={resolve(
                                  `/admin/workstations/${ws.id}/diagnostics/${diagnostic.id}`
                                )}
                              >
                                {diagnostic.scope === 'all' ? 'All GPUs' : 'Single GPU'}
                              </a>
                            </Table.Cell>
                            <Table.Cell><StatusBadge status={diagnostic.status} /></Table.Cell>
                            <Table.Cell class="text-sm"
                              >{diagnostic.durationSeconds}s · {diagnostic.memoryPercent}% · {diagnostic.workload.toUpperCase()}</Table.Cell
                            >
                            <Table.Cell class="pr-4 text-sm"
                              >{dateTime.format(diagnostic.createdAt)}</Table.Cell
                            >
                          </Table.Row>
                        {/each}
                      </Table.Body>
                    </Table.Root>
                  </div>
                </div>
              {/if}
            </Card.Content>
          </Card.Root>
        {/if}

        {#if activeTab === 'settings'}
          <Card.Root>
            <Card.Header>
              <Card.Title>Workstation settings</Card.Title>
              <Card.Description
                >Manage enrollment, credentials, and availability for {ws.name}.</Card.Description
              >
            </Card.Header>
            <Card.Content class="grid gap-4">
              <div class="flex flex-wrap items-center justify-between gap-4 rounded-lg border p-4">
                <div class="grid gap-1">
                  <strong>Enrollment</strong>
                  <p class="text-muted-foreground text-sm">
                    Issuing a new token revokes the current node credential. Copy the token before
                    leaving this page.
                  </p>
                  <div><StatusBadge status={ws.enrolled ? 'enrolled' : 'not enrolled'} /></div>
                </div>
                <form method="POST" action="?/issueEnrollment">
                  <Button variant="outline" type="submit"
                    >{ws.enrolled ? 'Rotate token' : 'Issue token'}</Button
                  >
                </form>
              </div>

              {#if ws.enrolled}
                <div
                  class="flex flex-wrap items-center justify-between gap-4 rounded-lg border p-4"
                >
                  <div class="grid gap-1">
                    <strong>Node credential</strong>
                    <p class="text-muted-foreground text-sm">
                      Revoke this workstation’s credential to disconnect it until it enrolls again.
                    </p>
                  </div>
                  <form method="POST" action="?/revoke">
                    <Button variant="destructive" type="submit">Revoke credential</Button>
                  </form>
                </div>
              {/if}

              <div class="flex flex-wrap items-center justify-between gap-4 rounded-lg border p-4">
                <div class="grid gap-1">
                  <strong>Availability</strong>
                  <p class="text-muted-foreground text-sm">
                    {ws.status === 'active'
                      ? 'Disable this workstation to stop new work from being assigned.'
                      : 'Enable this workstation for new work.'}
                  </p>
                  <div><StatusBadge status={ws.status} /></div>
                </div>
                <form method="POST" action="?/setStatus">
                  <input
                    type="hidden"
                    name="status"
                    value={ws.status === 'active' ? 'disabled' : 'active'}
                  />
                  <Button
                    variant={ws.status === 'active' ? 'destructive' : 'outline'}
                    type="submit"
                  >
                    {ws.status === 'active' ? 'Disable workstation' : 'Enable workstation'}
                  </Button>
                </form>
              </div>
            </Card.Content>
          </Card.Root>
        {/if}
      </div>
    </div>
  </main>
</MonitoringHistoryProvider>
