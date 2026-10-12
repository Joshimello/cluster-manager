<script lang="ts">
  import { Button } from '$lib/components/ui/button/index.js';
  import { Input } from '$lib/components/ui/input/index.js';
  import { Label } from '$lib/components/ui/label/index.js';
  let {
    action,
    username,
    label,
    description,
    fields = {},
    targets = [],
    allowHomeDeletion = false,
    disabled = false
  }: {
    action: string;
    username: string;
    label: string;
    description: string;
    fields?: Record<string, string>;
    targets?: string[];
    allowHomeDeletion?: boolean;
    disabled?: boolean;
  } = $props();
  const confirmationId = $props.id();
  let dialog: HTMLDialogElement;
  let confirmation = $state('');
  let deleteHome = $state(false);
</script>

<Button
  type="button"
  variant={allowHomeDeletion ? 'destructive' : 'outline'}
  size="sm"
  {disabled}
  onclick={() => {
    confirmation = '';
    deleteHome = false;
    dialog.showModal();
  }}>{label}</Button
>
<dialog
  bind:this={dialog}
  aria-label={label}
  class="bg-background text-foreground whitespace-normal fixed inset-0 m-auto max-h-[calc(100dvh-2rem)] w-[min(32rem,calc(100vw-2rem))] overflow-y-auto rounded-xl border p-6 shadow-xl backdrop:bg-black/50"
>
  <h2 class="text-xl font-semibold">{label}</h2>
  <p class="text-muted-foreground mt-2 text-sm">{description}</p>
  {#if targets.length}<ul class="my-4 grid gap-2 text-sm">
      {#each targets as target (target)}<li class="break-all">{target}</li>{/each}
    </ul>{/if}
  <form method="POST" {action} class="mt-4 grid gap-4">
    {#each Object.entries(fields) as [name, value] (name)}<input
        type="hidden"
        {name}
        {value}
      />{/each}
    {#if allowHomeDeletion}<label class="flex items-start gap-2 text-sm"
        ><input
          type="checkbox"
          name="deleteHome"
          bind:checked={deleteHome}
          class="mt-1"
        />Permanently delete home directory files. This cannot be undone.</label
      >{/if}
    <div class="grid gap-2">
      <Label for={confirmationId}>Type {username} to confirm</Label>
      <Input
        id={confirmationId}
        name="confirmation"
        bind:value={confirmation}
        autocomplete="off"
        required
      />
    </div>
    <div class="flex justify-end gap-2">
      <Button type="button" variant="outline" onclick={() => dialog.close()}>Cancel</Button><Button
        type="submit"
        variant={allowHomeDeletion ? 'destructive' : 'default'}
        disabled={confirmation !== username}>{label}</Button
      >
    </div>
  </form>
</dialog>
