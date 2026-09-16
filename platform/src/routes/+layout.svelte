<script lang="ts">
  import { resolve } from '$app/paths';
  import '../app.css';

  let { data, children } = $props();
</script>

<header class="site-header">
  <div class="header-inner">
    <a class="brand" href={resolve('/')}>Cluster Manager</a>
    <nav aria-label="Primary navigation">
      {#if data.user}
        {#if !data.user.mustChangePassword}
          <a href={resolve('/dashboard')}>Dashboard</a>
          {#if data.user.role === 'admin'}<a href={resolve('/admin/users')}>Administration</a>{/if}
        {/if}
        <span class="identity">{data.user.displayName}</span>
        <form method="POST" action="/logout">
          <button class="secondary compact" type="submit">Log out</button>
        </form>
      {:else}
        <a class="button compact" href={resolve('/login')}>Log in</a>
      {/if}
    </nav>
  </div>
</header>

{@render children()}

<style>
  .site-header {
    position: sticky;
    z-index: 10;
    top: 0;
    background: rgb(255 255 255 / 92%);
    border-bottom: 1px solid #e3e8f0;
    backdrop-filter: blur(12px);
  }

  .header-inner {
    width: min(100% - 2rem, 76rem);
    min-height: 4rem;
    margin: 0 auto;
    display: flex;
    justify-content: space-between;
    gap: 1rem;
    align-items: center;
  }

  .brand {
    color: #18233a;
    font-size: 1.05rem;
    font-weight: 800;
    letter-spacing: -0.02em;
    text-decoration: none;
  }

  nav {
    display: flex;
    align-items: center;
    gap: 1rem;
  }

  nav > a:not(.button) {
    color: #4a566b;
    font-size: 0.9rem;
    font-weight: 650;
    text-decoration: none;
  }

  nav > a:hover {
    color: #244eaf;
  }

  nav form {
    margin: 0;
  }

  .identity {
    color: #667085;
    font-size: 0.85rem;
  }

  :global(.compact) {
    min-height: 2.15rem;
    padding: 0.5rem 0.75rem;
    font-size: 0.82rem;
  }

  @media (max-width: 680px) {
    .header-inner {
      width: min(100% - 1rem, 76rem);
    }

    nav > a:not(.button),
    .identity {
      display: none;
    }
  }
</style>
