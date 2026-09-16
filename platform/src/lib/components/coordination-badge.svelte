<script lang="ts">
  import CircleIcon from '@lucide/svelte/icons/circle';
  import { Badge, type BadgeVariant } from '$lib/components/ui/badge/index.js';
  import type { CoordinationState } from '$lib/server/reservations/correlation';

  let { state }: { state: CoordinationState } = $props();

  const labels: Record<CoordinationState, string> = {
    available: 'Available',
    'booked-idle': 'Booked · idle',
    'booked-active': 'Booked · active',
    'unbooked-use': 'Unbooked use',
    conflict: 'Conflict',
    unknown: 'Unknown'
  };
  const variants: Record<CoordinationState, BadgeVariant> = {
    available: 'secondary',
    'booked-idle': 'outline',
    'booked-active': 'default',
    'unbooked-use': 'outline',
    conflict: 'destructive',
    unknown: 'secondary'
  };
</script>

<Badge variant={variants[state]}>
  <CircleIcon class="size-2 fill-current" aria-hidden="true" />
  {labels[state]}
</Badge>
