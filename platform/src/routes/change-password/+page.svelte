<script lang="ts">
  let { data, form } = $props();
</script>

<svelte:head><title>Change password · Cluster Manager</title></svelte:head>

<main class="narrow-shell">
  <section class="panel stack">
    <div>
      <p class="muted">Signed in as {data.user.username}</p>
      <h1>{data.user.mustChangePassword ? 'Choose a new password' : 'Change password'}</h1>
      <p class="muted">
        {data.user.mustChangePassword
          ? 'Your temporary password must be replaced before you can continue.'
          : 'Changing your password closes your other active sessions.'}
      </p>
    </div>
    {#if form?.message}<div class="notice error" role="alert">{form.message}</div>{/if}
    <form class="stack" method="POST">
      <label>
        Current password
        <input name="currentPassword" type="password" autocomplete="current-password" required />
      </label>
      <label>
        New password
        <input
          name="newPassword"
          type="password"
          autocomplete="new-password"
          minlength="12"
          maxlength="128"
          required
        />
      </label>
      <label>
        Confirm new password
        <input
          name="confirmation"
          type="password"
          autocomplete="new-password"
          minlength="12"
          maxlength="128"
          required
        />
      </label>
      <button type="submit">Save new password</button>
    </form>
  </section>
</main>
