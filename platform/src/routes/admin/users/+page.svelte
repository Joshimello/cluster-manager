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
  const dateFormatter = new Intl.DateTimeFormat(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short'
  });
</script>

<svelte:head><title>Users · Cluster Manager</title></svelte:head>

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
          <Label for="create-username">Username</Label>
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
          {@const assignment = data.assignments.find((candidate) => candidate.userId === user.id)}
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

            <div
              class="bg-muted/40 grid gap-4 rounded-lg border p-4 lg:col-span-3 lg:grid-cols-[minmax(12rem,0.8fr)_minmax(22rem,1.5fr)_auto] lg:items-end"
            >
              <div class="grid gap-2">
                <span class="text-sm font-medium">Workstation access</span>
                {#if assignment}
                  <div class="flex flex-wrap items-center gap-2">
                    <strong>{assignment.workstationName}</strong>
                    <StatusBadge status={assignment.provisioningStatus} />
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
                {:else}
                  <span class="text-muted-foreground text-sm">Not assigned</span>
                {/if}
              </div>

              {#if data.workstations.length > 0}
                <form
                  class="grid items-end gap-3 sm:grid-cols-[1fr_auto]"
                  method="POST"
                  action="?/assignWorkstation"
                >
                  <input type="hidden" name="userId" value={user.id} />
                  <div class="grid gap-2">
                    <Label for={`workstation-${user.id}`}
                      >{assignment ? 'Move to workstation' : 'Assign workstation'}</Label
                    >
                    <Select.Root
                      type="single"
                      name="workstationId"
                      value={assignment?.workstationId ?? data.workstations[0].id}
                    >
                      <Select.Trigger id={`workstation-${user.id}`} class="w-full"
                        ><Select.Value /></Select.Trigger
                      >
                      <Select.Content>
                        {#each data.workstations as workstation (workstation.id)}
                          <Select.Item value={workstation.id}
                            >{workstation.name} — {workstation.displayName}</Select.Item
                          >
                        {/each}
                      </Select.Content>
                    </Select.Root>
                  </div>
                  <Button variant="secondary" type="submit">{assignment ? 'Move' : 'Assign'}</Button
                  >
                </form>
              {:else}
                <p class="text-muted-foreground text-sm">
                  Create an active workstation before assigning users.
                </p>
              {/if}

              <div class="flex lg:justify-end">
                {#if assignment}
                  <form method="POST" action="?/revokeWorkstation">
                    <input type="hidden" name="userId" value={user.id} />
                    <Button variant="destructive" type="submit">Revoke access</Button>
                  </form>
                {/if}
              </div>
            </div>
          </article>
          {#if index < data.users.length - 1}<Separator />{/if}
        {/each}
      {/if}
    </Card.Content>
  </Card.Root>
</main>
