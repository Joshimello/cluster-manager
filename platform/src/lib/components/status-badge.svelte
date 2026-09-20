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
      value === 'revoked' ||
      value === 'failed' ||
      value === 'faulty' ||
      value === 'refused' ||
      value === 'rolled_back' ||
      value === 'expired'
    ) {
      return 'destructive';
    }
    if (
      value === 'online' ||
      value === 'active' ||
      value === 'enrolled' ||
      value === 'applied' ||
      value === 'current' ||
      value === 'succeeded' ||
      value === 'passed'
    )
      return 'default';
    return 'secondary';
  };
</script>

<Badge variant={variantFor(status)} class="capitalize">
  <CircleIcon class="size-2 fill-current" aria-hidden="true" />
  {status.replaceAll('_', ' ')}
</Badge>
