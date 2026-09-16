<script lang="ts">
  import CircleIcon from '@lucide/svelte/icons/circle';
  import { Badge, type BadgeVariant } from '$lib/components/ui/badge/index.js';

  let { status }: { status: string } = $props();

  const variantFor = (value: string): BadgeVariant => {
    if (
      value === 'offline' ||
      value === 'disabled' ||
      value === 'not enrolled' ||
      value === 'error' ||
      value === 'revoked'
    ) {
      return 'destructive';
    }
    if (value === 'online' || value === 'active' || value === 'enrolled' || value === 'applied')
      return 'default';
    return 'secondary';
  };
</script>

<Badge variant={variantFor(status)} class="capitalize">
  <CircleIcon class="size-2 fill-current" aria-hidden="true" />
  {status}
</Badge>
