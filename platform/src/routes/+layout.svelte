<script lang="ts">
  import BoxesIcon from '@lucide/svelte/icons/boxes';
  import CalendarDaysIcon from '@lucide/svelte/icons/calendar-days';
  import LayoutDashboardIcon from '@lucide/svelte/icons/layout-dashboard';
  import LogOutIcon from '@lucide/svelte/icons/log-out';
  import ShieldAlertIcon from '@lucide/svelte/icons/shield-alert';
  import SettingsIcon from '@lucide/svelte/icons/settings';
  import UserRoundCogIcon from '@lucide/svelte/icons/user-round-cog';
  import { browser } from '$app/environment';
  import { invalidateAll } from '$app/navigation';
  import { resolve } from '$app/paths';
  import { Button } from '$lib/components/ui/button/index.js';
  import '../app.css';

  let { data, children } = $props();
  let detectingTimeZone = false;

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
    >
      <BoxesIcon class="size-5" aria-hidden="true" />
    </a>
    <nav class="flex items-center gap-1" aria-label="Primary navigation">
      {#if data.user}
        {#if !data.user.mustChangePassword}
          <Button href={resolve('/dashboard')} variant="ghost" size="sm">
            <LayoutDashboardIcon data-icon="inline-start" />
            <span class="hidden sm:inline">Dashboard</span>
            <span class="sr-only sm:hidden">Dashboard</span>
          </Button>
          <Button href={resolve('/reservations')} variant="ghost" size="sm">
            <CalendarDaysIcon data-icon="inline-start" />
            <span class="hidden sm:inline">Reservations</span>
            <span class="sr-only sm:hidden">Reservations</span>
          </Button>
          <Button href={resolve('/stop-requests')} variant="ghost" size="sm">
            <ShieldAlertIcon data-icon="inline-start" />
            <span class="hidden sm:inline">Stop requests</span>
            <span class="sr-only sm:hidden">Stop requests</span>
          </Button>
          {#if data.user.role === 'admin'}
            <Button href={resolve('/admin/users')} variant="ghost" size="sm">
              <SettingsIcon data-icon="inline-start" />
              <span class="hidden sm:inline">Administration</span>
              <span class="sr-only sm:hidden">Administration</span>
            </Button>
          {/if}
          <Button href={resolve('/settings')} variant="ghost" size="sm">
            <UserRoundCogIcon data-icon="inline-start" />
            <span class="hidden sm:inline">Account</span>
            <span class="sr-only sm:hidden">Account settings</span>
          </Button>
        {/if}
        <span class="text-muted-foreground hidden max-w-40 truncate px-2 text-sm md:inline"
          >{data.user.displayName}</span
        >
        <form method="POST" action="/logout">
          <Button variant="outline" size="sm" type="submit">
            <LogOutIcon data-icon="inline-start" />
            <span class="hidden sm:inline">Log out</span>
            <span class="sr-only sm:hidden">Log out</span>
          </Button>
        </form>
      {:else}
        <Button href={resolve('/login')} size="sm">Log in</Button>
      {/if}
    </nav>
  </div>
</header>

{@render children()}
