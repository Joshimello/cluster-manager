<script lang="ts">
  import KeyRoundIcon from '@lucide/svelte/icons/key-round';
  import FeedbackAlert from '$lib/components/feedback-alert.svelte';
  import { Button } from '$lib/components/ui/button/index.js';
  import * as Card from '$lib/components/ui/card/index.js';
  import { Input } from '$lib/components/ui/input/index.js';
  import { Label } from '$lib/components/ui/label/index.js';

  let { data, form } = $props();
</script>

<svelte:head><title>Change password</title></svelte:head>

<main class="mx-auto flex min-h-[calc(100vh-3.5rem)] w-full max-w-md items-center px-4 py-12">
  <Card.Root class="w-full">
    <Card.Header>
      <Card.Description>Signed in as {data.user.username}</Card.Description>
      <Card.Title class="text-2xl"
        >{data.user.mustChangePassword ? 'Choose a new password' : 'Change password'}</Card.Title
      >
      <Card.Description>
        {data.user.mustChangePassword
          ? 'Your temporary password must be replaced before you can continue.'
          : 'Changing your password closes your other active sessions.'}
      </Card.Description>
    </Card.Header>
    <Card.Content class="gap-4">
      {#if form?.message}<FeedbackAlert message={form.message} />{/if}
      <form class="grid gap-4" method="POST">
        <div class="grid gap-2">
          <Label for="current-password">Current password</Label>
          <Input
            id="current-password"
            name="currentPassword"
            type="password"
            autocomplete="current-password"
            required
          />
        </div>
        <div class="grid gap-2">
          <Label for="new-password">New password</Label>
          <Input
            id="new-password"
            name="newPassword"
            type="password"
            autocomplete="new-password"
            minlength={8}
            maxlength={128}
            required
          />
        </div>
        <div class="grid gap-2">
          <Label for="confirmation">Confirm new password</Label>
          <Input
            id="confirmation"
            name="confirmation"
            type="password"
            autocomplete="new-password"
            minlength={8}
            maxlength={128}
            required
          />
        </div>
        <Button class="w-full" type="submit"
          ><KeyRoundIcon data-icon="inline-start" />Save new password</Button
        >
      </form>
    </Card.Content>
  </Card.Root>
</main>
