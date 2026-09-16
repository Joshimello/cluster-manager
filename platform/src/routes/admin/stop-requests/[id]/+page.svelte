<script lang="ts">
  import ArrowLeftIcon from '@lucide/svelte/icons/arrow-left';
  import { resolve } from '$app/paths';
  import FeedbackAlert from '$lib/components/feedback-alert.svelte';
  import PageHeader from '$lib/components/page-header.svelte';
  import StatusBadge from '$lib/components/status-badge.svelte';
  import { Badge } from '$lib/components/ui/badge/index.js';
  import { Button } from '$lib/components/ui/button/index.js';
  import * as Card from '$lib/components/ui/card/index.js';
  import { Input } from '$lib/components/ui/input/index.js';
  import { Label } from '$lib/components/ui/label/index.js';

  let { data, form } = $props();
  const dateTime = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'medium' });
  const gigabytes = (value: number) => `${(value / 1_000_000_000).toFixed(1)} GB`;
</script>

<svelte:head><title>Review stop request · Administration · Cluster Manager</title></svelte:head>

<main class="mx-auto grid w-full max-w-5xl gap-6 px-4 py-8 sm:px-6 lg:px-8">
  <div>
    <Button href={resolve('/admin/stop-requests')} variant="ghost" size="sm">
      <ArrowLeftIcon data-icon="inline-start" />Queue
    </Button>
  </div>
  <PageHeader
    title="Review stop request"
    description="Compare the immutable capture with the latest node observation before deciding."
  />

  {#if form?.message}
    <FeedbackAlert message={form.message} success={form.success} />
  {/if}

  <div class="flex flex-wrap items-center gap-2">
    <StatusBadge status={data.item.status.replaceAll('_', ' ')} />
    <Badge variant={data.identityMatches ? 'default' : 'destructive'}>
      {data.identityMatches ? 'Identity still matches' : 'Identity changed or absent'}
    </Badge>
  </div>

  <section class="grid gap-4 md:grid-cols-2">
    <Card.Root>
      <Card.Header>
        <Card.Title>Request context</Card.Title>
        <Card.Description>Submitted {dateTime.format(data.item.requestedAt)}</Card.Description>
      </Card.Header>
      <Card.Content class="grid gap-3 text-sm">
        <div>
          <span class="text-muted-foreground">Reservation owner</span><br /><strong
            >{data.item.requesterDisplayName}</strong
          >
          · {data.item.requesterUsername}
        </div>
        <div>
          <span class="text-muted-foreground">Workstation</span><br /><strong
            >{data.item.workstationDisplayName}</strong
          >
          · {data.item.workstationName}
        </div>
        <div>
          <span class="text-muted-foreground">GPU</span><br /><strong
            >GPU {data.item.gpuIndex}</strong
          >
          · {data.item.gpuModel}
        </div>
        <div>
          <span class="text-muted-foreground">Reservation window</span><br />{dateTime.format(
            data.item.reservationStartAt
          )}–{dateTime.format(data.item.reservationEndAt)}
        </div>
      </Card.Content>
    </Card.Root>

    <Card.Root>
      <Card.Header>
        <Card.Title>Captured target</Card.Title>
        <Card.Description
          >Immutable identity recorded when the user requested intervention.</Card.Description
        >
      </Card.Header>
      <Card.Content class="grid grid-cols-2 gap-3 text-sm">
        <div>
          <span class="text-muted-foreground">Linux user</span><br /><strong
            >{data.item.targetUsername}</strong
          >
          · UID {data.item.targetUid}
        </div>
        <div>
          <span class="text-muted-foreground">PID</span><br /><code>{data.item.targetPid}</code>
        </div>
        <div>
          <span class="text-muted-foreground">Executable</span><br /><code
            >{data.item.targetCommand}</code
          >
        </div>
        <div>
          <span class="text-muted-foreground">GPU memory</span><br />{gigabytes(
            data.item.targetMemoryUsedBytes
          )}
        </div>
        <div class="col-span-2">
          <span class="text-muted-foreground">Process start ticks</span><br /><code
            >{data.item.targetProcessStartTicks}</code
          >
        </div>
      </Card.Content>
    </Card.Root>
  </section>

  <Card.Root>
    <Card.Header>
      <Card.Title>Latest observation</Card.Title>
      <Card.Description
        >The node will independently repeat these checks immediately before signaling.</Card.Description
      >
    </Card.Header>
    <Card.Content class="text-sm">
      {#if data.current?.pid}
        <div class="grid gap-3 sm:grid-cols-4">
          <div>
            <span class="text-muted-foreground">Observed</span><br />{dateTime.format(
              data.current.observedAt
            )}
          </div>
          <div>
            <span class="text-muted-foreground">User / UID</span><br />{data.current.username} / {data
              .current.uid}
          </div>
          <div>
            <span class="text-muted-foreground">PID / start</span><br />{data.current.pid} / {data
              .current.processStartTicks}
          </div>
          <div>
            <span class="text-muted-foreground">Executable</span><br />{data.current.command}
          </div>
        </div>
      {:else}
        <p class="text-muted-foreground">The captured PID is absent from the latest GPU sample.</p>
      {/if}
    </Card.Content>
  </Card.Root>

  {#if data.item.status === 'pending'}
    <section class="grid gap-4 lg:grid-cols-3" aria-label="Admin decisions">
      <Card.Root>
        <Card.Header
          ><Card.Title>Dismiss</Card.Title><Card.Description
            >Reject this request without taking action.</Card.Description
          ></Card.Header
        >
        <Card.Content>
          <form method="POST" action="?/dismiss" class="grid gap-3">
            <Label for="dismiss-reason">Reason</Label>
            <Input id="dismiss-reason" name="reason" minlength={3} maxlength={500} required />
            <Button type="submit" variant="outline">Dismiss request</Button>
          </form>
        </Card.Content>
      </Card.Root>
      <Card.Root>
        <Card.Header
          ><Card.Title>Resolve</Card.Title><Card.Description
            >Record that intervention is no longer needed.</Card.Description
          ></Card.Header
        >
        <Card.Content>
          <form method="POST" action="?/resolve" class="grid gap-3">
            <Label for="resolve-reason">Reason</Label>
            <Input id="resolve-reason" name="reason" minlength={3} maxlength={500} required />
            <Button type="submit" variant="secondary">Resolve without termination</Button>
          </form>
        </Card.Content>
      </Card.Root>
      <Card.Root class="border-destructive/40">
        <Card.Header
          ><Card.Title>Terminate target</Card.Title><Card.Description
            >Queue one short-lived instruction for this workstation only.</Card.Description
          ></Card.Header
        >
        <Card.Content>
          <form method="POST" action="?/terminate" class="grid gap-3">
            <Label for="terminate-reason">Reason</Label>
            <Input id="terminate-reason" name="reason" minlength={3} maxlength={500} required />
            <label class="flex items-start gap-2 text-sm"
              ><input class="mt-1" type="checkbox" name="allowSigkill" value="yes" />Allow SIGKILL
              after the grace period</label
            >
            <label class="flex items-start gap-2 text-sm"
              ><input class="mt-1" type="checkbox" name="confirmIdentity" value="yes" required />I
              confirm the captured PID, UID, and start identity.</label
            >
            <Button type="submit" variant="destructive" disabled={!data.identityMatches}
              >Queue termination</Button
            >
          </form>
        </Card.Content>
      </Card.Root>
    </section>
  {:else if data.item.instructionId}
    <Card.Root>
      <Card.Header>
        <Card.Title>Termination instruction</Card.Title>
        <Card.Description>Instruction {data.item.instructionId}</Card.Description>
      </Card.Header>
      <Card.Content class="grid gap-2 text-sm">
        <div><StatusBadge status={data.item.instructionStatus ?? 'unknown'} /></div>
        <p>Outcome: <strong>{data.item.instructionOutcome ?? 'Awaiting node result'}</strong></p>
        <p class="text-muted-foreground">
          {data.item.instructionDetail ?? 'No result details yet.'}
        </p>
        <p>
          Signals: SIGTERM {data.item.termSent ? 'sent' : 'not sent'} · SIGKILL {data.item.killSent
            ? 'sent'
            : 'not sent'}
        </p>
      </Card.Content>
    </Card.Root>
  {:else if data.item.decisionReason || data.item.resultMessage}
    <Card.Root>
      <Card.Header><Card.Title>Decision</Card.Title></Card.Header>
      <Card.Content class="grid gap-2 text-sm">
        {#if data.item.decisionReason}<p>{data.item.decisionReason}</p>{/if}
        {#if data.item.resultMessage}<p class="text-muted-foreground">
            {data.item.resultMessage}
          </p>{/if}
      </Card.Content>
    </Card.Root>
  {/if}
</main>
