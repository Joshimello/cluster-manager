<script lang="ts">
  import CircleAlertIcon from '@lucide/svelte/icons/circle-alert';
  import CircleCheckIcon from '@lucide/svelte/icons/circle-check';
  import * as Alert from '$lib/components/ui/alert/index.js';

  let { message, success = false }: { message: string; success?: boolean } = $props();
</script>

<Alert.Root variant={success ? 'default' : 'destructive'} role={success ? 'status' : 'alert'}>
  {#if success}<CircleCheckIcon />{:else}<CircleAlertIcon />{/if}
  <Alert.Title>{success ? 'Success' : 'Something needs attention'}</Alert.Title>
  <Alert.Description>{message}</Alert.Description>
</Alert.Root>
