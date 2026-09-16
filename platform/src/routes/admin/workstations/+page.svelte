<script lang="ts">
  import MonitorIcon from '@lucide/svelte/icons/monitor';
  import { resolve } from '$app/paths';
  import CredentialDisplay from '$lib/components/credential-display.svelte';
  import FeedbackAlert from '$lib/components/feedback-alert.svelte';
  import PageHeader from '$lib/components/page-header.svelte';
  import StatusBadge from '$lib/components/status-badge.svelte';
  import { Badge } from '$lib/components/ui/badge/index.js';
  import { Button } from '$lib/components/ui/button/index.js';
  import * as Card from '$lib/components/ui/card/index.js';
  import { Input } from '$lib/components/ui/input/index.js';
  import { Label } from '$lib/components/ui/label/index.js';
  import { Separator } from '$lib/components/ui/separator/index.js';

  let { data, form } = $props();
  const dateTime = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'medium' });
</script>

<svelte:head><title>Workstations · Cluster Manager</title></svelte:head>

<main class="mx-auto grid w-full max-w-7xl gap-6 px-4 py-8 sm:px-6 lg:px-8">
  <PageHeader
    title="Workstations"
    description="Create node identities, manage enrollment, and see their latest connection state."
  />

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

  <Card.Root>
    <Card.Header>
      <Card.Title>Create workstation</Card.Title>
      <Card.Description
        >A one-time enrollment token will be generated and displayed once.</Card.Description
      >
    </Card.Header>
    <Card.Content>
      <form
        class="grid items-end gap-4 md:grid-cols-[1fr_1.5fr_auto]"
        method="POST"
        action="?/create"
      >
        <div class="grid gap-2">
          <Label for="workstation-name">Name</Label>
          <Input
            id="workstation-name"
            name="name"
            pattern={'[a-z][a-z0-9-]{1,31}'}
            maxlength={32}
            required
            value={form?.action === 'create' ? (form.values?.name ?? '') : ''}
          />
        </div>
        <div class="grid gap-2">
          <Label for="workstation-display-name">Display name</Label>
          <Input
            id="workstation-display-name"
            name="displayName"
            maxlength={120}
            required
            value={form?.action === 'create' ? (form.values?.displayName ?? '') : ''}
          />
        </div>
        <Button type="submit">Create workstation</Button>
      </form>
    </Card.Content>
  </Card.Root>

  <Card.Root>
    <Card.Header class="flex-row items-center justify-between gap-4">
      <div class="space-y-1.5">
        <Card.Title>Managed workstations</Card.Title>
        <Card.Description>Enrollment and connectivity at a glance.</Card.Description>
      </div>
      <Badge variant="secondary">{data.workstations.length} total</Badge>
    </Card.Header>
    <Card.Content>
      {#if data.workstations.length === 0}
        <div
          class="text-muted-foreground flex flex-col items-center gap-3 py-12 text-center text-sm"
        >
          <MonitorIcon class="size-9" aria-hidden="true" />
          <p>No workstations have been created.</p>
        </div>
      {:else}
        {#each data.workstations as workstation, index (workstation.id)}
          <article
            class="grid gap-4 py-6 first:pt-0 last:pb-0 lg:grid-cols-[minmax(14rem,1fr)_auto_auto] lg:items-center"
          >
            <div class="grid gap-1">
              <a
                class="font-semibold underline-offset-4 hover:underline"
                href={resolve('/admin/workstations/[id]', { id: workstation.id })}
                >{workstation.name}</a
              >
              <span class="text-muted-foreground text-sm">{workstation.displayName}</span>
              <small class="text-muted-foreground">
                {workstation.lastHeartbeatAt
                  ? `Last heartbeat ${dateTime.format(workstation.lastHeartbeatAt)}`
                  : 'Not yet connected'}
              </small>
            </div>

            <div class="flex flex-wrap gap-2">
              <StatusBadge status={workstation.connectionState} />
              <StatusBadge status={workstation.status} />
              <StatusBadge status={workstation.enrolled ? 'enrolled' : 'not enrolled'} />
            </div>

            <div class="flex flex-wrap gap-2 lg:justify-end">
              <form method="POST" action="?/issueEnrollment">
                <input type="hidden" name="workstationId" value={workstation.id} />
                <Button variant="outline" type="submit">Rotate / enroll</Button>
              </form>
              {#if workstation.enrolled}
                <form method="POST" action="?/revoke">
                  <input type="hidden" name="workstationId" value={workstation.id} />
                  <Button variant="destructive" type="submit">Revoke</Button>
                </form>
              {/if}
              <form method="POST" action="?/setStatus">
                <input type="hidden" name="workstationId" value={workstation.id} />
                <input
                  type="hidden"
                  name="status"
                  value={workstation.status === 'active' ? 'disabled' : 'active'}
                />
                <Button
                  variant={workstation.status === 'active' ? 'destructive' : 'outline'}
                  type="submit"
                >
                  {workstation.status === 'active' ? 'Disable' : 'Enable'}
                </Button>
              </form>
            </div>
          </article>
          {#if index < data.workstations.length - 1}<Separator />{/if}
        {/each}
      {/if}
    </Card.Content>
  </Card.Root>
</main>
