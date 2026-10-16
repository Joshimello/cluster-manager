<script lang="ts">
  import { Button } from '$lib/components/ui/button';
  import { Input } from '$lib/components/ui/input';
  import { resolve } from '$app/paths';
  let { data, form } = $props();
</script>

<svelte:head><title>Connected applications</title></svelte:head>
<main class="mx-auto max-w-4xl space-y-6 px-4 py-8">
  <div>
    <h1 class="text-2xl font-semibold">Connected applications</h1>
    <p class="text-muted-foreground mt-2">
      Let trusted applications use platform accounts for sign-in.
    </p>
  </div>
  <p class="text-sm">Issuer: <code>{data.issuer}</code></p>
  {#if !data.configured}<p role="alert" class="rounded-lg border p-4">
      Set AUTH_ENCRYPTION_KEY on the platform before configuring connected sign-in.
    </p>{/if}
  {#if form?.message}<div role="status" class="rounded-lg border p-4">
      <p>{form.message}</p>
      {#if form.secret}<p class="mt-2">Client ID: <code>{form.clientId}</code></p>
        <p class="mt-2 break-all">Client secret: <code>{form.secret}</code></p>{/if}
    </div>{/if}
  <form
    method="POST"
    action={resolve('/admin/applications') + '?/save'}
    class="grid gap-3 rounded-xl border p-5"
  >
    <h2 class="font-medium">Register application</h2>
    <label class="grid gap-1 text-sm"
      >Application name<Input name="name" required maxlength={120} /></label
    >
    <label class="grid gap-1 text-sm"
      >Exact callback URLs, one per line<textarea
        class="min-h-20 rounded-md border p-2"
        name="redirectUris"
        required></textarea></label
    >
    <Button type="submit" disabled={!data.configured}>Create application</Button>
  </form>
  {#each data.clients as client (client.id)}
    <section class="space-y-4 rounded-xl border p-5">
      <div>
        <h2 class="font-medium">{client.name} · {client.enabled ? 'Enabled' : 'Disabled'}</h2>
        <p class="text-muted-foreground break-all text-sm">Client ID: {client.id}</p>
      </div>
      <form method="POST" action={resolve('/admin/applications') + '?/save'} class="grid gap-3">
        <input type="hidden" name="id" value={client.id} />
        <label class="grid gap-1 text-sm"
          >Application name<Input name="name" value={client.name} required maxlength={120} /></label
        >
        <label class="grid gap-1 text-sm"
          >Exact callback URLs<textarea
            class="min-h-20 rounded-md border p-2"
            name="redirectUris"
            required>{client.redirectUris.join('\n')}</textarea
          ></label
        >
        <p class="text-muted-foreground text-sm">
          Saving changes or rotating a secret revokes existing authorizations.
        </p>
        <Button type="submit" variant="outline">Save changes</Button>
      </form>
      <form
        method="POST"
        action={resolve('/admin/applications') + '?/update'}
        class="flex flex-wrap gap-2"
      >
        <input type="hidden" name="id" value={client.id} />
        <Button
          type="submit"
          name="operation"
          value={client.enabled ? 'disable' : 'enable'}
          variant="outline">{client.enabled ? 'Disable' : 'Enable'}</Button
        >
        <Button type="submit" name="operation" value="rotate" variant="outline"
          >Rotate secret</Button
        >
      </form>
    </section>
  {/each}
</main>
