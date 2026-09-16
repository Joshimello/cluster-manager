<script lang="ts">
  import { resolve } from '$app/paths';

  let { children } = $props();
</script>

<div class="admin-bar">
  <nav aria-label="Administration">
    <strong>Administration</strong>
    <a href={resolve('/admin/users')}>Users</a>
    <a href={resolve('/admin/audit')}>Audit history</a>
  </nav>
</div>
{@render children()}

<style>
  .admin-bar {
    background: #18233a;
  }
  nav {
    width: min(100% - 2rem, 76rem);
    min-height: 3rem;
    margin: 0 auto;
    display: flex;
    align-items: center;
    gap: 1.25rem;
  }
  strong {
    color: white;
    margin-right: 0.5rem;
  }
  a {
    color: #c9d5ef;
    font-size: 0.9rem;
    font-weight: 650;
    text-decoration: none;
  }
  a:hover {
    color: white;
  }
</style>
