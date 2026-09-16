<script lang="ts">
  import { resolve } from '$app/paths';
  import { product } from '$lib/product';

  let { data } = $props();
</script>

<svelte:head>
  <title>{product.name}</title>
  <meta name="description" content={product.description} />
</svelte:head>

<main>
  <section>
    <p class="eyebrow">Research infrastructure</p>
    <h1>{product.name}</h1>
    <p class="description">{product.description}</p>
    <div class="actions">
      {#if data.user}
        <a
          class="button"
          href={data.user.mustChangePassword ? resolve('/change-password') : resolve('/dashboard')}
        >
          Continue to dashboard
        </a>
      {:else}
        <a class="button" href={resolve('/login')}>Log in to Cluster Manager</a>
      {/if}
    </div>
    <div class:ready={data.database.status === 'ready'} class="status">
      <span aria-hidden="true"></span>
      {data.database.status === 'ready'
        ? 'Platform and database are ready'
        : 'Platform is running; database is unavailable'}
    </div>
  </section>
</main>

<style>
  main {
    min-height: 100vh;
    display: grid;
    place-items: center;
    padding: 2rem;
  }

  section {
    width: min(100%, 42rem);
    padding: clamp(2rem, 6vw, 4rem);
    background: white;
    border: 1px solid #e3e8f0;
    border-radius: 1.25rem;
    box-shadow: 0 1.5rem 4rem rgb(23 32 51 / 8%);
  }

  .eyebrow {
    margin: 0 0 0.75rem;
    color: #3262d9;
    font-size: 0.78rem;
    font-weight: 700;
    letter-spacing: 0.12em;
    text-transform: uppercase;
  }

  h1 {
    margin: 0;
    color: #111827;
    font-size: clamp(2.5rem, 8vw, 4.5rem);
    letter-spacing: -0.055em;
    line-height: 0.95;
  }

  .description {
    margin: 1.5rem 0;
    color: #5c667a;
    font-size: 1.12rem;
    line-height: 1.6;
  }

  .actions {
    margin-bottom: 2rem;
  }

  .status {
    display: inline-flex;
    align-items: center;
    gap: 0.65rem;
    padding: 0.7rem 0.95rem;
    color: #71480f;
    background: #fff7e7;
    border-radius: 999px;
    font-size: 0.9rem;
    font-weight: 650;
  }

  .status span {
    width: 0.55rem;
    height: 0.55rem;
    background: #c17b20;
    border-radius: 50%;
    box-shadow: 0 0 0 0.25rem rgb(193 123 32 / 14%);
  }

  .status.ready span {
    background: #2a9d5b;
    box-shadow: 0 0 0 0.25rem rgb(42 157 91 / 14%);
  }

  .status.ready {
    color: #24563b;
    background: #ecf9f1;
  }
</style>
