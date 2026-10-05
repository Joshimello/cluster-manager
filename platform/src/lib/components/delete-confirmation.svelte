<script lang="ts">
  import { enhance } from '$app/forms';
  import FeedbackAlert from '$lib/components/feedback-alert.svelte';
  import { Button } from '$lib/components/ui/button/index.js';

  let {
    kind,
    name,
    targetId,
    field,
    description,
    action = '?/delete',
    disabled = false
  }: {
    kind: 'user' | 'workstation';
    name: string;
    targetId: string;
    field: 'userId' | 'workstationId';
    description: string;
    action?: string;
    disabled?: boolean;
  } = $props();
  let dialog = $state<HTMLDialogElement>();
  let submitting = $state(false);
  let message = $state<string | null>(null);
  const titleId = $derived(`delete-${kind}-${targetId}-title`);
  const descriptionId = $derived(`delete-${kind}-${targetId}-description`);
</script>

<Button
  variant="destructive"
  {disabled}
  aria-label={`Delete ${kind} ${name}`}
  onclick={() => {
    message = null;
    dialog?.showModal();
  }}>Delete {kind}</Button
>

<dialog
  bind:this={dialog}
  aria-labelledby={titleId}
  aria-describedby={descriptionId}
  oncancel={(event) => {
    if (submitting) event.preventDefault();
  }}
  class="bg-background text-foreground fixed inset-0 m-auto max-h-[calc(100dvh-2rem)] w-[min(32rem,calc(100vw-2rem))] overflow-y-auto rounded-xl border p-6 shadow-xl backdrop:bg-black/50"
>
  <h2 id={titleId} class="text-xl font-semibold">Delete {kind} {name}?</h2>
  <p id={descriptionId} class="text-muted-foreground mt-3 text-sm">{description}</p>
  <p class="mt-3 text-sm font-medium">This cannot be undone.</p>
  {#if message}
    <div class="mt-4"><FeedbackAlert {message} /></div>
  {/if}
  <form
    method="POST"
    {action}
    class="mt-6 flex justify-end gap-2"
    use:enhance={() => {
      submitting = true;
      message = null;
      return async ({ result, update }) => {
        submitting = false;
        if (result.type === 'failure') {
          message = String(result.data?.message ?? 'Deletion failed. Try again.');
        } else if (result.type === 'error') {
          message = 'Deletion failed. Try again.';
        } else {
          dialog?.close();
          await update();
        }
      };
    }}
  >
    <input type="hidden" name={field} value={targetId} />
    <input type="hidden" name="confirmation" value={name} />
    <Button type="button" variant="outline" disabled={submitting} onclick={() => dialog?.close()}
      >Cancel</Button
    >
    <Button type="submit" variant="destructive" disabled={submitting}
      >{submitting ? 'Deleting…' : `Delete ${kind}`}</Button
    >
  </form>
</dialog>
