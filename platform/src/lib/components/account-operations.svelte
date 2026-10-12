<script lang="ts">
  import AccountConfirmation from './account-confirmation.svelte';
  import type { accountOperations } from '$lib/server/db/schema';
  let {
    operations,
    action = '?/retryAccount'
  }: {
    operations: (typeof accountOperations.$inferSelect & { workstationName: string })[];
    action?: string;
  } = $props();
</script>

{#if operations.length}
  <section class="grid gap-3" aria-label="Account operation progress">
    <h3 class="font-semibold">Account operations</h3>
    {#each operations as op (op.id)}
      <div class="flex flex-wrap items-center justify-between gap-3 rounded-lg border p-3 text-sm">
        <div>
          <strong>{op.account.username}</strong> · {op.workstationName} · {op.kind === 'adopt'
            ? 'Import'
            : 'Removal'} · {op.status}
          <p class="text-muted-foreground">
            {op.detail ||
              (op.kind === 'adopt'
                ? 'Awaiting node adoption and password synchronization.'
                : 'Awaiting node cleanup.')}
            {op.kind === 'remove'
              ? op.deleteHome
                ? 'Home deletion requested.'
                : 'Home files will be preserved.'
              : ''}
          </p>
        </div>
        {#if ['blocked', 'failed', 'expired'].includes(op.status) && op.detail !== 'Import cancelled because access was revoked.' && !operations.some((other) => other.assignmentId === op.assignmentId && other.createdAt > op.createdAt)}<AccountConfirmation
            {action}
            username={op.account.username}
            label="Retry"
            description="Retry this account operation using a fresh node scan. Existing home-deletion choices remain unchanged."
            fields={{ operationId: op.id }}
            targets={[`${op.workstationName} · ${op.account.home}`]}
          />{/if}
      </div>
    {/each}
  </section>
{/if}
