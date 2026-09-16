<script lang="ts">
  import { resolve } from '$app/paths';

  let { data, form } = $props();
  const dateTime = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'medium' });
</script>

<svelte:head><title>Workstations · Cluster Manager</title></svelte:head>

<main class="page-shell">
  <header class="page-heading">
    <h1>Workstations</h1>
    <p>Create node identities, manage enrollment, and see their latest connection state.</p>
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

  {#if form?.enrollmentToken}
    <section class="credential-panel" aria-label="Enrollment token">
      <strong>Copy this enrollment token now</strong>
      <p>
        It is shown only in this response and expires at {dateTime.format(
          new Date(form.enrollmentExpiresAt)
        )}.
      </p>
      <dl>
        <div>
          <dt>Workstation</dt>
          <dd><code>{form.enrollmentName}</code></dd>
        </div>
        <div>
          <dt>Enrollment token</dt>
          <dd><code>{form.enrollmentToken}</code></dd>
        </div>
      </dl>
    </section>
  {/if}

  <section class="panel create-panel">
    <div>
      <h2>Create workstation</h2>
      <p class="muted">A one-time enrollment token will be generated.</p>
    </div>
    <form class="create-form" method="POST" action="?/create">
      <label
        >Name<input
          name="name"
          pattern={'[a-z][a-z0-9-]{1,31}'}
          maxlength="32"
          required
          value={form?.action === 'create' ? (form.values?.name ?? '') : ''}
        /></label
      >
      <label
        >Display name<input
          name="displayName"
          maxlength="120"
          required
          value={form?.action === 'create' ? (form.values?.displayName ?? '') : ''}
        /></label
      >
      <button type="submit">Create workstation</button>
    </form>
  </section>

  <section class="panel">
    <div class="list-heading">
      <h2>Managed workstations</h2>
      <span>{data.workstations.length} total</span>
    </div>
    {#if data.workstations.length === 0}
      <p class="empty">No workstations have been created.</p>
    {:else}
      {#each data.workstations as workstation (workstation.id)}
        <article class="workstation-row">
          <div class="summary">
            <a href={resolve('/admin/workstations/[id]', { id: workstation.id })}
              ><strong>{workstation.name}</strong></a
            >
            <span>{workstation.displayName}</span>
            <small
              >{workstation.lastHeartbeatAt
                ? `Last heartbeat ${dateTime.format(workstation.lastHeartbeatAt)}`
                : 'Not yet connected'}</small
            >
          </div>
          <div class="badges">
            <span
              class:good={workstation.connectionState === 'online'}
              class:warning={workstation.connectionState === 'stale'}
              class:bad={workstation.connectionState === 'offline'}
              class="badge">{workstation.connectionState}</span
            >
            <span class:bad={workstation.status === 'disabled'} class="badge"
              >{workstation.status}</span
            >
            <span class="badge">{workstation.enrolled ? 'enrolled' : 'not enrolled'}</span>
          </div>
          <div class="actions">
            <form method="POST" action="?/issueEnrollment">
              <input type="hidden" name="workstationId" value={workstation.id} /><button
                class="secondary"
                type="submit">Rotate / enroll</button
              >
            </form>
            {#if workstation.enrolled}<form method="POST" action="?/revoke">
                <input type="hidden" name="workstationId" value={workstation.id} /><button
                  class="danger"
                  type="submit">Revoke</button
                >
              </form>{/if}
            <form method="POST" action="?/setStatus">
              <input type="hidden" name="workstationId" value={workstation.id} /><input
                type="hidden"
                name="status"
                value={workstation.status === 'active' ? 'disabled' : 'active'}
              /><button
                class={workstation.status === 'active' ? 'danger' : 'secondary'}
                type="submit">{workstation.status === 'active' ? 'Disable' : 'Enable'}</button
              >
            </form>
          </div>
        </article>
      {/each}
    {/if}
  </section>
</main>

<style>
  .feedback,
  .credential-panel,
  .create-panel {
    margin-bottom: 1rem;
  }
  .credential-panel {
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
    display: grid;
    grid-template-columns: 0.8fr 2fr;
    gap: 2rem;
  }
  .create-panel h2,
  .create-panel p {
    margin-bottom: 0;
  }
  .create-form {
    display: grid;
    grid-template-columns: 1fr 1.5fr auto;
    gap: 0.75rem;
    align-items: end;
  }
  .list-heading {
    display: flex;
    justify-content: space-between;
    align-items: baseline;
    padding-bottom: 1rem;
    border-bottom: 1px solid #e6eaf0;
  }
  .list-heading h2 {
    margin: 0;
  }
  .workstation-row {
    display: grid;
    grid-template-columns: 1fr auto auto;
    gap: 1.25rem;
    align-items: center;
    padding: 1.25rem 0;
    border-bottom: 1px solid #e6eaf0;
  }
  .workstation-row:last-child {
    border: 0;
    padding-bottom: 0;
  }
  .summary {
    display: grid;
    gap: 0.2rem;
  }
  .summary a {
    color: #243b68;
    text-decoration: none;
  }
  .summary span,
  small,
  .list-heading span,
  .empty {
    color: #687386;
  }
  .badges,
  .actions {
    display: flex;
    gap: 0.5rem;
    flex-wrap: wrap;
  }
  .badge.good {
    color: #12643b;
    background: #e2f6e9;
  }
  .badge.warning {
    color: #805800;
    background: #fff3d1;
  }
  .badge.bad {
    color: #912d2d;
    background: #fde8e8;
  }
  @media (max-width: 900px) {
    .create-panel,
    .workstation-row {
      grid-template-columns: 1fr;
    }
    .create-form {
      grid-template-columns: 1fr;
    }
  }
</style>
