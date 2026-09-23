<script lang="ts">
  import PlusIcon from '@lucide/svelte/icons/plus';
  import UsersIcon from '@lucide/svelte/icons/users';
  import XIcon from '@lucide/svelte/icons/x';
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
  import * as Table from '$lib/components/ui/table/index.js';

  let { data, form } = $props();
  let createDialog = $state<HTMLDialogElement>();
  let search = $state('');
  let expandedUserId = $state<string | null>(null);
  let filteredUsers = $derived(
    data.users.filter((user) =>
      `${user.username} ${user.displayName} ${user.role} ${user.status}`
        .toLowerCase()
        .includes(search.trim().toLowerCase())
    )
  );
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

  $effect(() => {
    if (form?.action === 'create' && !form.success && createDialog && !createDialog.open) {
      createDialog.showModal();
    }
  });
</script>

<svelte:head><title>Users</title></svelte:head>

<main class="mx-auto grid w-full max-w-7xl gap-6 px-4 py-8 sm:px-6 lg:px-8">
  <div class="flex flex-wrap items-start justify-between gap-4">
    <PageHeader
      title="Users"
      description="Create platform accounts, control access, and reset credentials."
    />
    <Button onclick={() => createDialog?.showModal()}>
      <PlusIcon data-icon="inline-start" />Create user
    </Button>
  </div>

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

  <dialog
    id="create-user-dialog"
    bind:this={createDialog}
    aria-labelledby="create-user-title"
    class="bg-background text-foreground fixed inset-0 m-auto max-h-[calc(100dvh-2rem)] w-[min(32rem,calc(100vw-2rem))] overflow-y-auto rounded-xl border p-6 shadow-xl backdrop:bg-black/50"
  >
    <div class="mb-5 flex items-start justify-between gap-4">
      <div class="space-y-1">
        <h2 id="create-user-title" class="text-xl font-semibold">Create user</h2>
        <p class="text-muted-foreground text-sm">
          A secure temporary password will be generated and displayed once.
        </p>
      </div>
      <Button
        variant="ghost"
        size="icon-sm"
        aria-label="Close create user dialog"
        onclick={() => createDialog?.close()}
      >
        <XIcon aria-hidden="true" />
      </Button>
    </div>
    {#if form?.action === 'create' && !form.success && form.message}
      <div class="mb-4"><FeedbackAlert message={form.message} /></div>
    {/if}
    <form class="grid gap-4" method="POST" action="?/create">
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
        <Select.Root
          type="single"
          name="role"
          value={form?.action === 'create' ? (form.values?.role ?? 'user') : 'user'}
        >
          <Select.Trigger id="create-role" class="w-full"><Select.Value /></Select.Trigger>
          <Select.Content portalProps={{ to: '#create-user-dialog' }}>
            <Select.Item value="user">User</Select.Item>
            <Select.Item value="admin">Admin</Select.Item>
          </Select.Content>
        </Select.Root>
      </div>
      <div class="flex justify-end gap-2 pt-2">
        <Button type="button" variant="outline" onclick={() => createDialog?.close()}>Cancel</Button
        >
        <Button type="submit">Create user</Button>
      </div>
    </form>
  </dialog>

  <Card.Root>
    <Card.Header class="gap-4 sm:flex-row sm:items-center sm:justify-between">
      <div class="space-y-1.5">
        <Card.Title>Platform users</Card.Title>
        <Card.Description>Manage identities and workstation access.</Card.Description>
      </div>
      <div class="flex w-full flex-wrap items-center gap-3 sm:w-auto">
        <Badge variant="secondary">
          {search.trim()
            ? `${filteredUsers.length} of ${data.users.length}`
            : `${data.users.length} total`}
        </Badge>
        <Input
          class="min-w-40 flex-1 sm:w-64"
          type="search"
          aria-label="Search users"
          placeholder="Search users"
          bind:value={search}
        />
      </div>
    </Card.Header>
    {#if data.users.length === 0}
      <div
        class="text-muted-foreground flex flex-col items-center gap-3 px-6 py-12 text-center text-sm"
      >
        <UsersIcon class="size-9" aria-hidden="true" />
        <p>No platform users have been created.</p>
      </div>
    {:else if filteredUsers.length === 0}
      <p class="text-muted-foreground px-6 py-10 text-center text-sm">
        No users match your search.
      </p>
    {:else}
      <Table.Root>
        <Table.Caption class="sr-only">Platform users and account management</Table.Caption>
        <Table.Header>
          <Table.Row>
            <Table.Head class="pl-6">User</Table.Head>
            <Table.Head class="hidden md:table-cell">Workstations</Table.Head>
            <Table.Head class="hidden lg:table-cell">Activity</Table.Head>
            <Table.Head class="hidden xl:table-cell">Created</Table.Head>
            <Table.Head class="pr-6 text-right">Actions</Table.Head>
          </Table.Row>
        </Table.Header>
        <Table.Body>
          {#each filteredUsers as user (user.id)}
            {@const userAssignments = data.assignments.filter(
              (candidate) => candidate.userId === user.id
            )}
            {@const assignableWorkstations = data.workstations.filter(
              (workstation) =>
                !userAssignments.some((assignment) => assignment.workstationId === workstation.id)
            )}
            <Table.Row>
              <Table.Cell class="pl-6 whitespace-normal">
                <div class="font-medium">{user.displayName}</div>
                <div class="text-muted-foreground text-xs">{user.username}</div>
                <div class="mt-2 flex flex-wrap gap-1">
                  <Badge variant="outline" class="capitalize">{user.role}</Badge>
                  <StatusBadge status={user.status} />
                  {#if user.mustChangePassword}
                    <Badge variant="secondary">Password change required</Badge>
                  {/if}
                </div>
              </Table.Cell>
              <Table.Cell class="hidden whitespace-normal md:table-cell">
                <span class="font-medium">{userAssignments.length} assigned</span>
                {#if userAssignments.length > 0}
                  <span class="text-muted-foreground block text-xs">
                    {userAssignments.map((assignment) => assignment.workstationName).join(', ')}
                  </span>
                {/if}
              </Table.Cell>
              <Table.Cell class="hidden lg:table-cell">
                {user.gpuProcessCount} GPU processes · {user.reservations.length} reservations
              </Table.Cell>
              <Table.Cell class="hidden xl:table-cell"
                >{dateFormatter.format(user.createdAt)}</Table.Cell
              >
              <Table.Cell class="pr-6 text-right">
                <Button
                  variant="outline"
                  size="sm"
                  aria-expanded={expandedUserId === user.id}
                  aria-label={expandedUserId === user.id
                    ? `Close details for ${user.username}`
                    : `Manage ${user.username}`}
                  onclick={() => (expandedUserId = expandedUserId === user.id ? null : user.id)}
                >
                  {expandedUserId === user.id ? 'Close' : 'Manage'}
                </Button>
              </Table.Cell>
            </Table.Row>
            {#if expandedUserId === user.id}
              <Table.Row class="hover:bg-background">
                <Table.Cell colspan={5} class="whitespace-normal p-0">
                  <div class="grid min-w-0 gap-5 border-t p-4 sm:p-6">
                    <div class="flex flex-wrap items-center justify-between gap-2">
                      <h3 class="text-base font-semibold">Manage {user.username}</h3>
                      <div class="text-muted-foreground grid gap-1 text-xs sm:text-right">
                        <span>Created {dateFormatter.format(user.createdAt)}</span>
                        <span class="font-mono">UID {user.posixUid} · GID {user.posixGid}</span>
                      </div>
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

                    <div class="bg-muted/40 grid gap-4 rounded-lg border p-4">
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
                                  Username collision: choose another platform username or
                                  deliberately rename/remove the local account. No local ownership
                                  or credential data was changed.
                                </small>
                              {:else if assignment.provisioningErrorCode === 'uid_collision'}
                                <small class="text-destructive font-medium">
                                  UID collision: UID {user.posixUid} is already in use locally. Remove
                                  or renumber the unrelated local identity before retrying. No ownership,
                                  credentials, groups, or files were changed.
                                </small>
                              {:else if assignment.provisioningErrorCode === 'gid_collision'}
                                <small class="text-destructive font-medium">
                                  GID collision: GID {user.posixGid} or the private group name is already
                                  in use. Resolve the unrelated local group before retrying. No ownership,
                                  credentials, groups, or files were changed.
                                </small>
                              {:else if assignment.provisioningErrorCode === 'managed_identity_mismatch'}
                                <small class="text-destructive font-medium">
                                  Managed identity mismatch: purge and recreate this node-managed
                                  account so it can use platform UID/GID {user.posixUid}. The node
                                  will not renumber it in place.
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
                                <Button variant="destructive" size="sm" type="submit"
                                  >Revoke access</Button
                                >
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
                        <p class="text-muted-foreground text-sm">
                          Assigned to every active workstation.
                        </p>
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
                  </div>
                </Table.Cell>
              </Table.Row>
            {/if}
          {/each}
        </Table.Body>
      </Table.Root>
    {/if}
  </Card.Root>
</main>
