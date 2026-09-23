<script lang="ts">
  import LogInIcon from '@lucide/svelte/icons/log-in';
  import FeedbackAlert from '$lib/components/feedback-alert.svelte';
  import { Button } from '$lib/components/ui/button/index.js';
  import * as Card from '$lib/components/ui/card/index.js';
  import { Input } from '$lib/components/ui/input/index.js';
  import { Label } from '$lib/components/ui/label/index.js';

  let { form } = $props();
</script>

<svelte:head><title>Log in</title></svelte:head>

<main class="mx-auto flex min-h-[calc(100vh-3.5rem)] w-full max-w-md items-center px-4 py-12">
  <Card.Root class="w-full">
    <Card.Header>
      <Card.Title class="text-2xl">Log in</Card.Title>
      <Card.Description
        >Use your platform account. Workstation SSH credentials are separate.</Card.Description
      >
    </Card.Header>
    <Card.Content class="gap-4">
      {#if form?.message}<FeedbackAlert message={form.message} />{/if}
      <form class="grid gap-4" method="POST">
        <div class="grid gap-2">
          <Label for="username">Username</Label>
          <Input
            id="username"
            name="username"
            autocomplete="username"
            autocapitalize="none"
            required
            value={form?.username ?? ''}
          />
        </div>
        <div class="grid gap-2">
          <Label for="password">Password</Label>
          <Input
            id="password"
            name="password"
            type="password"
            autocomplete="current-password"
            required
          />
        </div>
        <Button class="w-full" type="submit"><LogInIcon data-icon="inline-start" />Log in</Button>
      </form>
    </Card.Content>
  </Card.Root>
</main>
