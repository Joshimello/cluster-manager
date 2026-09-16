<script lang="ts">
  import KeyRoundIcon from '@lucide/svelte/icons/key-round';
  import UserRoundIcon from '@lucide/svelte/icons/user-round';
  import { resolve } from '$app/paths';
  import PageHeader from '$lib/components/page-header.svelte';
  import StatusBadge from '$lib/components/status-badge.svelte';
  import { Button } from '$lib/components/ui/button/index.js';
  import * as Card from '$lib/components/ui/card/index.js';

  let { data } = $props();
</script>

<svelte:head><title>Dashboard · Cluster Manager</title></svelte:head>

<main class="mx-auto grid w-full max-w-7xl gap-6 px-4 py-8 sm:px-6 lg:px-8">
  <PageHeader
    title={`Welcome, ${data.user.displayName}`}
    description="Your Cluster Manager account is active."
  />

  <Card.Root>
    <Card.Header>
      <Card.Title class="flex items-center gap-2"
        ><UserRoundIcon class="size-5" />Account</Card.Title
      >
      <Card.Description>Your platform identity and current access.</Card.Description>
    </Card.Header>
    <Card.Content class="grid gap-6 sm:grid-cols-2 lg:grid-cols-4 lg:items-end">
      <div class="grid gap-1">
        <span class="text-muted-foreground text-xs font-medium uppercase">Username</span><strong
          >{data.user.username}</strong
        >
      </div>
      <div class="grid gap-1">
        <span class="text-muted-foreground text-xs font-medium uppercase">Role</span><StatusBadge
          status={data.user.role}
        />
      </div>
      <div class="grid gap-1">
        <span class="text-muted-foreground text-xs font-medium uppercase">Workstation</span><strong
          >Not assigned yet</strong
        >
      </div>
      <Button href={resolve('/change-password')} variant="outline"
        ><KeyRoundIcon data-icon="inline-start" />Change password</Button
      >
    </Card.Content>
  </Card.Root>

  <Card.Root class="border-dashed" size="sm">
    <Card.Header>
      <Card.Title>Next milestone</Card.Title>
      <Card.Description
        >Workstation assignment and SSH access will appear here in Milestone 3.</Card.Description
      >
    </Card.Header>
  </Card.Root>
</main>
