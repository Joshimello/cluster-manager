<script lang="ts">
  import KeyRoundIcon from '@lucide/svelte/icons/key-round';
  import * as Alert from '$lib/components/ui/alert/index.js';

  let {
    title,
    description,
    entries
  }: {
    title: string;
    description: string;
    entries: Array<{ label: string; value: string }>;
  } = $props();
</script>

<Alert.Root class="bg-muted/30">
  <KeyRoundIcon />
  <Alert.Title>{title}</Alert.Title>
  <Alert.Description class="space-y-4">
    <p>{description}</p>
    <dl class="grid gap-3">
      {#each entries as entry (entry.label)}
        <div class="grid gap-1 sm:grid-cols-[10rem_minmax(0,1fr)] sm:gap-4">
          <dt class="text-foreground font-medium">{entry.label}</dt>
          <dd class="min-w-0">
            <code class="bg-background block overflow-x-auto rounded-md border px-2 py-1.5 text-xs">
              {entry.value}
            </code>
          </dd>
        </div>
      {/each}
    </dl>
  </Alert.Description>
</Alert.Root>
