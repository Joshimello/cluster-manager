<script lang="ts">
  import UsersIcon from '@lucide/svelte/icons/users';
  import CredentialDisplay from '$lib/components/credential-display.svelte';
  import FeedbackAlert from '$lib/components/feedback-alert.svelte';
  import PageHeader from '$lib/components/page-header.svelte';
  import StatusBadge from '$lib/components/status-badge.svelte';
  import { Badge } from '$lib/components/ui/badge/index.js';
  import { Button } from '$lib/components/ui/button/index.js';
  import * as Card from '$lib/components/ui/card/index.js';
  import { Input } from '$lib/components/ui/input/index.js';
  import { Label } from '$lib/components/ui/label/index.js';
  import * as Select from '$lib/components/ui/select/index.js';
  import { Separator } from '$lib/components/ui/separator/index.js';

  let { data, form } = $props();
  let dateFormatter = $derived(
    new Intl.DateTimeFormat(undefined, {
      dateStyle: 'medium',
      timeStyle: 'short',
      timeZone: data.user.timeZone ?? 'UTC'
    })
  );
  const bytes = new Intl.NumberFormat(undefined, {
    style: 'unit',
    unit: 'gigabyte',
    maximumFractionDigits: 1
  });
  const gigabytes = (value: number) => bytes.format(value / 1_000_000_000);
</script>

<svelte:head><title>Users</title></svelte:head>

<main class="mx-auto grid w-full max-w-7xl gap-6 px-4 py-8 sm:px-6 lg:px-8">
  <PageHeader
    title="Users"
    description="Create platform accounts, control access, and reset credentials."
  />

  {#if form?.message}
    <FeedbackAlert message={form.message} success={form.success} />
  {/if}

  {#if form?.temporaryPassword}
    <CredentialDisplay
      title="Copy this temporary credential now"
      description="It is shown only in this response. The user must change it at first login."
      entries={[
        { label: 'Username', value: form.credentialUsername },
        { label: 'Temporary password', value: form.temporaryPassword }
      ]}
    />
  {/if}

  <Card.Root>
    <Card.Header>
      <Card.Title>Create user</Card.Title>
      <Card.Description
        >A secure temporary password will be generated and displayed once.</Card.Description
      >
    </Card.Header>
    <Card.Content>
      <form
        class="grid items-end gap-4 md:grid-cols-2 xl:grid-cols-[1fr_1.5fr_0.75fr_auto]"
        method="POST"
        action="?/create"
      >
        <div class="grid gap-2">
          <Label for="create-username">Username / Linux login</Label>
          <Input
            id="create-username"
            name="username"
            pattern={'[a-z][a-z0-9_-]{2,31}'}
            maxlength={32}
            autocapitalize="none"
            required
            value={form?.action === 'create' ? (form.values?.username ?? '') : ''}
          />
        </div>
        <div class="grid gap-2">
          <Label for="create-display-name">Display name</Label>
          <Input
            id="create-display-name"
            name="displayName"
            maxlength={120}
            required
            value={form?.action === 'create' ? (form.values?.displayName ?? '') : ''}
          />
        </div>
        <div class="grid gap-2">
          <Label for="create-role">Role</Label>
          <Select.Root type="single" name="role" value="user">
            <Select.Trigger id="create-role" class="w-full"><Select.Value /></Select.Trigger>
            <Select.Content>
              <Select.Item value="user">User</Select.Item>
              <Select.Item value="admin">Admin</Select.Item>
            </Select.Content>
          </Select.Root>
        </div>
        <Button type="submit">Create user</Button>
      </form>
    </Card.Content>
  </Card.Root>

  <Card.Root>
    <Card.Header class="flex-row items-center justify-between gap-4">
      <div class="space-y-1.5">
        <Card.Title>Platform users</Card.Title>
        <Card.Description>Manage identities and access to the control plane.</Card.Description>
      </div>
      <Badge variant="secondary">{data.users.length} total</Badge>
    </Card.Header>
    <Card.Content>
      {#if data.users.length === 0}
        <div
          class="text-muted-foreground flex flex-col items-center gap-3 py-12 text-center text-sm"
        >
          <UsersIcon class="size-9" aria-hidden="true" />
          <p>No platform users have been created.</p>
        </div>
      {:else}
        {#each data.users as user, index (user.id)}
          {@const userAssignments = data.assignments.filter(
            (candidate) => candidate.userId === user.id
          )}
          {@const assignableWorkstations = data.workstations.filter(
            (workstation) =>
              !userAssignments.some((assignment) => assignment.workstationId === workstation.id)
          )}
          <article
            class="grid gap-5 py-6 first:pt-0 last:pb-0 lg:grid-cols-[minmax(12rem,0.8fr)_minmax(22rem,1.5fr)_auto] lg:items-end"
          >
            <div class="grid gap-3">
              <div class="grid gap-0.5">
                <strong>{user.username}</strong>
                <span class="text-muted-foreground text-sm">{user.displayName}</span>
              </div>
              <div class="flex flex-wrap gap-2">
                <Badge variant="outline" class="capitalize">{user.role}</Badge>
                <StatusBadge status={user.status} />
                {#if user.mustChangePassword}
                  <Badge variant="secondary">Password change required</Badge>
                {/if}
              </div>
              <small class="text-muted-foreground"
                >Created {dateFormatter.format(user.createdAt)}</small
              >
              <small class="text-muted-foreground font-mono"
                >UID {user.posixUid} · GID {user.posixGid}</small
              >
            </div>

            <form
              class="grid items-end gap-3 sm:grid-cols-[1.4fr_0.7fr_auto]"
              method="POST"
              action="?/edit"
            >
              <input type="hidden" name="userId" value={user.id} />
              <div class="grid gap-2">
                <Label for={`display-${user.id}`}>Display name</Label>
                <Input
                  id={`display-${user.id}`}
                  name="displayName"
                  maxlength={120}
                  required
                  value={user.displayName}
                />
              </div>
              <div class="grid gap-2">
                <Label for={`role-${user.id}`}>Role</Label>
                <Select.Root type="single" name="role" value={user.role}>
                  <Select.Trigger id={`role-${user.id}`} class="w-full"
                    ><Select.Value /></Select.Trigger
                  >
                  <Select.Content>
                    <Select.Item value="user">User</Select.Item>
                    <Select.Item value="admin">Admin</Select.Item>
                  </Select.Content>
                </Select.Root>
              </div>
              <Button variant="secondary" type="submit">Save</Button>
            </form>

            <div class="flex flex-wrap gap-2">
              <form method="POST" action="?/setStatus">
                <input type="hidden" name="userId" value={user.id} />
                <input
                  type="hidden"
                  name="status"
                  value={user.status === 'active' ? 'disabled' : 'active'}
                />
                <Button
                  variant={user.status === 'active' ? 'destructive' : 'outline'}
                  type="submit"
                >
                  {user.status === 'active' ? 'Disable' : 'Enable'}
                </Button>
              </form>
              <form method="POST" action="?/resetPassword">
                <input type="hidden" name="userId" value={user.id} />
                <Button variant="outline" type="submit">Reset password</Button>
              </form>
            </div>

            <div class="bg-muted/40 grid gap-4 rounded-lg border p-4 lg:col-span-3">
              <div class="flex flex-wrap items-center justify-between gap-2">
                <span class="text-sm font-medium">Workstation access</span>
                <Badge variant="secondary">{userAssignments.length} assigned</Badge>
              </div>

              {#if userAssignments.length === 0}
                <span class="text-muted-foreground text-sm">Not assigned</span>
              {:else}
                <div class="grid gap-3 xl:grid-cols-2">
                  {#each userAssignments as assignment (assignment.id)}
                    <div class="grid gap-2 rounded-md border bg-background p-3">
                      <div class="flex flex-wrap items-center gap-2">
                        <strong>{assignment.workstationName}</strong>
                        <StatusBadge status={assignment.provisioningStatus} />
                        <StatusBadge status={assignment.connectionState} />
                      </div>
                      <small class="text-muted-foreground">
                        Desired generation {assignment.desiredGeneration}; applied {assignment.appliedGeneration}
                      </small>
                      {#if assignment.provisioningMessage}
                        <small
                          class={assignment.provisioningStatus === 'error'
                            ? 'text-destructive'
                            : 'text-muted-foreground'}
                        >
                          {assignment.provisioningMessage}
                        </small>
                      {/if}
                      {#if assignment.provisioningErrorCode === 'username_collision'}
                        <small class="text-destructive font-medium">
                          Username collision: choose another platform username or deliberately
                          rename/remove the local account. No local ownership or credential data was
                          changed.
                        </small>
                      {:else if assignment.provisioningErrorCode === 'uid_collision'}
                        <small class="text-destructive font-medium">
                          UID collision: UID {user.posixUid} is already in use locally. Remove or renumber
                          the unrelated local identity before retrying. No ownership, credentials, groups,
                          or files were changed.
                        </small>
                      {:else if assignment.provisioningErrorCode === 'gid_collision'}
                        <small class="text-destructive font-medium">
                          GID collision: GID {user.posixGid} or the private group name is already in use.
                          Resolve the unrelated local group before retrying. No ownership, credentials,
                          groups, or files were changed.
                        </small>
                      {:else if assignment.provisioningErrorCode === 'managed_identity_mismatch'}
                        <small class="text-destructive font-medium">
                          Managed identity mismatch: purge and recreate this node-managed account so
                          it can use platform UID/GID {user.posixUid}. The node will not renumber it
                          in place.
                        </small>
                      {/if}
                      <small class="text-muted-foreground">
                        Node {assignment.nodeVersion ?? 'version unknown'}
                        {#if assignment.inventory}
                          · Disk {gigabytes(assignment.inventory.storage.usedBytes)} used of {gigabytes(
                            assignment.inventory.storage.totalBytes
                          )}
                        {/if}
                      </small>
                      <form class="mt-1" method="POST" action="?/revokeWorkstation">
                        <input type="hidden" name="assignmentId" value={assignment.id} />
                        <Button variant="destructive" size="sm" type="submit">Revoke access</Button>
                      </form>
                    </div>
                  {/each}
                </div>
              {/if}

              {#if assignableWorkstations.length > 0}
                <form
                  class="grid items-end gap-3 sm:max-w-2xl sm:grid-cols-[1fr_auto]"
                  method="POST"
                  action="?/assignWorkstation"
                >
                  <input type="hidden" name="userId" value={user.id} />
                  <div class="grid gap-2">
                    <Label for={`workstation-${user.id}`}>Add workstation</Label>
                    <Select.Root
                      type="single"
                      name="workstationId"
                      value={assignableWorkstations[0].id}
                      items={assignableWorkstations.map((workstation) => ({
                        value: workstation.id,
                        label: `${workstation.name} — ${workstation.displayName}`
                      }))}
                    >
                      <Select.Trigger id={`workstation-${user.id}`} class="w-full"
                        ><Select.Value /></Select.Trigger
                      >
                      <Select.Content>
                        {#each assignableWorkstations as workstation (workstation.id)}
                          <Select.Item value={workstation.id}
                            >{workstation.name} — {workstation.displayName}</Select.Item
                          >
                        {/each}
                      </Select.Content>
                    </Select.Root>
                  </div>
                  <Button variant="secondary" type="submit">Add access</Button>
                </form>
              {:else if data.workstations.length === 0}
                <p class="text-muted-foreground text-sm">
                  Create an active workstation before assigning users.
                </p>
              {:else}
                <p class="text-muted-foreground text-sm">Assigned to every active workstation.</p>
              {/if}

              <div class="grid gap-2 sm:grid-cols-2">
                <div class="rounded-md border bg-background p-3">
                  <span class="text-muted-foreground text-xs font-medium uppercase"
                    >Active GPU processes</span
                  >
                  <p class="mt-1 text-lg font-semibold">{user.gpuProcessCount}</p>
                </div>
                <div class="rounded-md border bg-background p-3">
                  <span class="text-muted-foreground text-xs font-medium uppercase"
                    >Current / upcoming reservations</span
                  >
                  {#if user.reservations.length === 0}
                    <p class="text-muted-foreground mt-1 text-sm">None</p>
                  {:else}
                    <div class="mt-1 flex flex-wrap gap-2">
                      {#each user.reservations as reservation (reservation.id)}
                        <Badge variant="outline">
                          {reservation.workstationName} GPU {reservation.gpuIndex} · {reservation.state}
                          · {dateFormatter.format(reservation.startAt)}
                        </Badge>
                      {/each}
                    </div>
                  {/if}
                </div>
              </div>
            </div>
          </article>
          {#if index < data.users.length - 1}<Separator />{/if}
        {/each}
      {/if}
    </Card.Content>
  </Card.Root>
</main>
