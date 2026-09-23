<script lang="ts">
  import BoxesIcon from '@lucide/svelte/icons/boxes';
  import LayoutDashboardIcon from '@lucide/svelte/icons/layout-dashboard';
  import MenuIcon from '@lucide/svelte/icons/menu';
  import SettingsIcon from '@lucide/svelte/icons/settings';
  import UserRoundCogIcon from '@lucide/svelte/icons/user-round-cog';
  import XIcon from '@lucide/svelte/icons/x';
  import { browser } from '$app/environment';
  import { invalidateAll } from '$app/navigation';
  import { resolve } from '$app/paths';
  import { Button } from '$lib/components/ui/button/index.js';
  import '../app.css';

  const navigation = [
    { href: '/dashboard', label: 'Dashboard', icon: LayoutDashboardIcon },
    { href: '/admin/users', label: 'Administration', icon: SettingsIcon },
    { href: '/settings', label: 'Account', icon: UserRoundCogIcon }
  ] as const;

  let { data, children } = $props();
  let detectingTimeZone = false;
  let mobileMenuOpen = $state(false);
  let visibleNavigation = $derived(
    navigation.filter(({ href }) => href !== '/admin/users' || data.user?.role === 'admin')
  );

  $effect(() => {
    if (!browser || !data.user || data.user.timeZone || detectingTimeZone) return;
    detectingTimeZone = true;
    const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    void fetch(resolve('/api/account/time-zone'), {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ timeZone })
    })
      .then(async (response) => {
        if (response.ok) await invalidateAll();
      })
      .catch(() => undefined);
  });
</script>

<svelte:window onkeydown={(event) => event.key === 'Escape' && (mobileMenuOpen = false)} />

<header
  class="bg-background/95 supports-[backdrop-filter]:bg-background/75 sticky top-0 z-50 border-b backdrop-blur"
>
  <div
    class="mx-auto flex h-14 w-full max-w-7xl items-center justify-between gap-4 px-4 sm:px-6 lg:px-8"
  >
    <a
      class="focus-visible:ring-ring flex items-center gap-2 rounded-md font-semibold tracking-tight outline-none focus-visible:ring-2"
      aria-label={data.user
        ? data.user.mustChangePassword
          ? 'Change password'
          : 'Dashboard'
        : 'Log in'}
      href={resolve(
        data.user ? (data.user.mustChangePassword ? '/change-password' : '/dashboard') : '/login'
      )}
      onclick={() => (mobileMenuOpen = false)}
    >
      <BoxesIcon class="size-5" aria-hidden="true" />
    </a>
    {#if data.user && !data.user.mustChangePassword}
      <Button
        class="lg:hidden"
        variant="ghost"
        size="icon"
        aria-label={mobileMenuOpen ? 'Close menu' : 'Open menu'}
        aria-expanded={mobileMenuOpen}
        aria-controls="mobile-navigation"
        onclick={() => (mobileMenuOpen = !mobileMenuOpen)}
      >
        {#if mobileMenuOpen}<XIcon aria-hidden="true" />{:else}<MenuIcon aria-hidden="true" />{/if}
      </Button>
    {:else if !data.user}
      <Button class="lg:hidden" href={resolve('/login')} size="sm">Log in</Button>
    {/if}
    <nav class="hidden items-center gap-1 lg:flex" aria-label="Primary navigation">
      {#if data.user}
        {#if !data.user.mustChangePassword}
          {#each visibleNavigation as item (item.href)}
            <Button href={resolve(item.href)} variant="ghost" size="sm">
              <item.icon data-icon="inline-start" />{item.label}
            </Button>
          {/each}
        {/if}
      {:else}
        <Button href={resolve('/login')} size="sm">Log in</Button>
      {/if}
    </nav>
  </div>
  {#if data.user && !data.user.mustChangePassword}
    <nav
      id="mobile-navigation"
      class="border-t px-4 py-2 lg:hidden"
      class:hidden={!mobileMenuOpen}
      aria-label="Mobile navigation"
    >
      <div class="mx-auto grid max-w-7xl gap-1">
        {#each visibleNavigation as item (item.href)}
          <Button
            class="h-11 justify-start"
            href={resolve(item.href)}
            variant="ghost"
            onclick={() => (mobileMenuOpen = false)}
          >
            <item.icon data-icon="inline-start" />{item.label}
          </Button>
        {/each}
      </div>
    </nav>
  {/if}
</header>

{@render children()}
