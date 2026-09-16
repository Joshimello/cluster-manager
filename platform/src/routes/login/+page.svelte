<script lang="ts">
  let { form } = $props();
</script>

<svelte:head><title>Log in · Cluster Manager</title></svelte:head>

<main class="narrow-shell">
  <section class="panel stack">
    <div>
      <h1>Log in</h1>
      <p class="muted">
        Use your Cluster Manager account. Workstation SSH credentials are separate.
      </p>
    </div>
    {#if form?.message}<div class="notice error" role="alert">{form.message}</div>{/if}
    <form class="stack" method="POST">
      <label>
        Username
        <input
          name="username"
          autocomplete="username"
          autocapitalize="none"
          required
          value={form?.username ?? ''}
        />
      </label>
      <label>
        Password
        <input name="password" type="password" autocomplete="current-password" required />
      </label>
      <button type="submit">Log in</button>
    </form>
  </section>
</main>
