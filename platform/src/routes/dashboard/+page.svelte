<script lang="ts">
  import { resolve } from '$app/paths';

  let { data } = $props();
</script>

<svelte:head><title>Dashboard · Cluster Manager</title></svelte:head>

<main class="page-shell">
  <header class="page-heading">
    <h1>Welcome, {data.user.displayName}</h1>
    <p>Your Cluster Manager account is active.</p>
  </header>
  <section class="panel account-grid">
    <div><span class="label">Username</span><strong>{data.user.username}</strong></div>
    <div><span class="label">Role</span><strong class="badge">{data.user.role}</strong></div>
    <div><span class="label">Workstation</span><strong>Not assigned yet</strong></div>
    <div><a class="button secondary" href={resolve('/change-password')}>Change password</a></div>
  </section>
  <section class="coming-soon">
    <h2>Next milestone</h2>
    <p>Workstation connectivity and status will appear here after the node connection milestone.</p>
  </section>
</main>

<style>
  .account-grid {
    display: grid;
    grid-template-columns: repeat(3, minmax(0, 1fr)) auto;
    gap: 1.5rem;
    align-items: center;
  }
  .account-grid > div:not(:last-child) {
    display: grid;
    gap: 0.45rem;
  }
  .label {
    color: #667085;
    font-size: 0.78rem;
    font-weight: 700;
    letter-spacing: 0.05em;
    text-transform: uppercase;
  }
  .coming-soon {
    margin-top: 2rem;
    padding: 1.5rem;
    color: #536075;
    border: 1px dashed #bdc6d3;
    border-radius: 0.9rem;
  }
  .coming-soon h2 {
    margin-top: 0;
    color: #344054;
  }
  .coming-soon p {
    margin-bottom: 0;
  }
  @media (max-width: 760px) {
    .account-grid {
      grid-template-columns: 1fr 1fr;
    }
  }
  @media (max-width: 480px) {
    .account-grid {
      grid-template-columns: 1fr;
    }
  }
</style>
