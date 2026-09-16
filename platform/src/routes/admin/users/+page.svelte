<script lang="ts">
  let { data, form } = $props();
  const dateFormatter = new Intl.DateTimeFormat(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short'
  });
</script>

<svelte:head><title>Users · Cluster Manager</title></svelte:head>

<main class="page-shell">
  <header class="page-heading">
    <h1>Users</h1>
    <p>Create platform accounts, control access, and reset credentials.</p>
  </header>

  {#if form?.message}
    <div
      class:success={form.success}
      class:error={!form.success}
      class="notice feedback"
      role="status"
    >
      {form.message}
    </div>
  {/if}

  {#if form?.temporaryPassword}
    <section class="credential-panel" aria-label="Temporary credential">
      <strong>Copy this temporary credential now</strong>
      <p>It is shown only in this response. The user must change it at first login.</p>
      <dl>
        <div>
          <dt>Username</dt>
          <dd><code>{form.credentialUsername}</code></dd>
        </div>
        <div>
          <dt>Temporary password</dt>
          <dd><code>{form.temporaryPassword}</code></dd>
        </div>
      </dl>
    </section>
  {/if}

  <section class="panel create-panel">
    <div>
      <h2>Create user</h2>
      <p class="muted">A secure temporary password will be generated and displayed once.</p>
    </div>
    <form class="create-form" method="POST" action="?/create">
      <label>
        Username
        <input
          name="username"
          pattern={'[a-z][a-z0-9_-]{2,31}'}
          maxlength="32"
          autocapitalize="none"
          required
          value={form?.action === 'create' ? (form.values?.username ?? '') : ''}
        />
      </label>
      <label>
        Display name
        <input
          name="displayName"
          maxlength="120"
          required
          value={form?.action === 'create' ? (form.values?.displayName ?? '') : ''}
        />
      </label>
      <label>
        Role
        <select name="role"
          ><option value="user">User</option><option value="admin">Admin</option></select
        >
      </label>
      <button type="submit">Create user</button>
    </form>
  </section>

  <section class="panel user-list">
    <div class="list-heading">
      <h2>Platform users</h2>
      <span>{data.users.length} total</span>
    </div>
    {#each data.users as user (user.id)}
      <article class="user-row">
        <div class="user-summary">
          <div><strong>{user.username}</strong><span>{user.displayName}</span></div>
          <div class="cluster">
            <span class="badge">{user.role}</span>
            <span
              class:success={user.status === 'active'}
              class:danger={user.status === 'disabled'}
              class="badge">{user.status}</span
            >
            {#if user.mustChangePassword}<span class="badge">password change required</span>{/if}
          </div>
          <small>Created {dateFormatter.format(user.createdAt)}</small>
        </div>
        <form class="edit-form" method="POST" action="?/edit">
          <input type="hidden" name="userId" value={user.id} />
          <label
            >Display name<input
              name="displayName"
              maxlength="120"
              required
              value={user.displayName}
            /></label
          >
          <label>
            Role
            <select name="role" value={user.role}
              ><option value="user">User</option><option value="admin">Admin</option></select
            >
          </label>
          <button class="secondary" type="submit">Save</button>
        </form>
        <div class="row-actions">
          <form method="POST" action="?/setStatus">
            <input type="hidden" name="userId" value={user.id} />
            <input
              type="hidden"
              name="status"
              value={user.status === 'active' ? 'disabled' : 'active'}
            />
            <button class={user.status === 'active' ? 'danger' : 'secondary'} type="submit"
              >{user.status === 'active' ? 'Disable' : 'Enable'}</button
            >
          </form>
          <form method="POST" action="?/resetPassword">
            <input type="hidden" name="userId" value={user.id} />
            <button class="secondary" type="submit">Reset password</button>
          </form>
        </div>
      </article>
    {/each}
  </section>
</main>

<style>
  .feedback {
    margin-bottom: 1rem;
  }
  .credential-panel {
    margin-bottom: 1rem;
    padding: 1.25rem;
    color: #4c3408;
    background: #fff6df;
    border: 1px solid #e9c675;
    border-radius: 0.9rem;
  }
  .credential-panel p {
    margin: 0.35rem 0 1rem;
  }
  dl {
    margin: 0;
    display: grid;
    gap: 0.5rem;
  }
  dl div {
    display: grid;
    grid-template-columns: 10rem 1fr;
    gap: 1rem;
  }
  dt {
    font-weight: 700;
  }
  dd {
    margin: 0;
    overflow-wrap: anywhere;
  }
  .create-panel {
    margin-bottom: 1.25rem;
    display: grid;
    grid-template-columns: minmax(12rem, 0.7fr) minmax(0, 2fr);
    gap: 2rem;
  }
  .create-panel h2,
  .create-panel p {
    margin-bottom: 0;
  }
  .create-form {
    display: grid;
    grid-template-columns: 1fr 1.5fr 0.7fr auto;
    gap: 0.75rem;
    align-items: end;
  }
  .list-heading {
    display: flex;
    justify-content: space-between;
    align-items: baseline;
    gap: 1rem;
    padding-bottom: 1rem;
    border-bottom: 1px solid #e6eaf0;
  }
  .list-heading h2 {
    margin-bottom: 0;
  }
  .list-heading span,
  small,
  .user-summary > div:first-child span {
    color: #687386;
  }
  .user-row {
    display: grid;
    grid-template-columns: minmax(13rem, 0.8fr) minmax(22rem, 1.5fr) auto;
    gap: 1.25rem;
    align-items: end;
    padding: 1.25rem 0;
    border-bottom: 1px solid #e6eaf0;
  }
  .user-row:last-child {
    padding-bottom: 0;
    border-bottom: 0;
  }
  .user-summary {
    display: grid;
    gap: 0.65rem;
  }
  .user-summary > div:first-child {
    display: grid;
    gap: 0.15rem;
  }
  .edit-form {
    display: grid;
    grid-template-columns: 1.4fr 0.7fr auto;
    gap: 0.6rem;
    align-items: end;
  }
  .row-actions {
    display: flex;
    gap: 0.5rem;
  }
  @media (max-width: 980px) {
    .create-panel,
    .user-row {
      grid-template-columns: 1fr;
    }
    .create-form {
      grid-template-columns: 1fr 1fr;
    }
  }
  @media (max-width: 560px) {
    .create-form,
    .edit-form {
      grid-template-columns: 1fr;
    }
    dl div {
      grid-template-columns: 1fr;
      gap: 0.15rem;
    }
  }
</style>
