<script lang="ts">
  import CalendarCogIcon from '@lucide/svelte/icons/calendar-cog';
  import ChevronDownIcon from '@lucide/svelte/icons/chevron-down';
  import ClipboardListIcon from '@lucide/svelte/icons/clipboard-list';
  import MonitorCogIcon from '@lucide/svelte/icons/monitor-cog';
  import ShieldAlertIcon from '@lucide/svelte/icons/shield-alert';
  import UsersIcon from '@lucide/svelte/icons/users';
  import { page } from '$app/state';
  import { resolve } from '$app/paths';
  import { Button } from '$lib/components/ui/button/index.js';
  import { Separator } from '$lib/components/ui/separator/index.js';

  const sections = [
    { href: '/admin/users', label: 'Users', icon: UsersIcon },
    { href: '/admin/workstations', label: 'Workstations', icon: MonitorCogIcon },
    { href: '/admin/stop-requests', label: 'Stop requests', icon: ShieldAlertIcon },
    { href: '/admin/reservations', label: 'Reservations', icon: CalendarCogIcon },
    { href: '/admin/audit', label: 'Audit history', icon: ClipboardListIcon }
  ] as const;

  let { children } = $props();
  let mobileMenuOpen = $state(false);
  let currentSection = $derived(
    sections.find(({ href }) => page.url.pathname.startsWith(href))?.label ?? 'Administration'
  );
</script>

<div class="bg-muted/30 border-b">
  <div class="mx-auto max-w-7xl px-4 py-2 sm:px-6 lg:hidden">
    <Button
      class="w-full justify-between"
      variant="outline"
      aria-expanded={mobileMenuOpen}
      aria-controls="admin-navigation-mobile"
      onclick={() => (mobileMenuOpen = !mobileMenuOpen)}
    >
      {currentSection}<ChevronDownIcon
        class={mobileMenuOpen ? 'rotate-180' : ''}
        aria-hidden="true"
      />
    </Button>
    <nav
      id="admin-navigation-mobile"
      class="grid gap-1 pt-2"
      class:hidden={!mobileMenuOpen}
      aria-label="Administration"
    >
      {#each sections as section (section.href)}
        <Button
          class="h-11 justify-start"
          href={resolve(section.href)}
          variant="ghost"
          onclick={() => (mobileMenuOpen = false)}
        >
          <section.icon data-icon="inline-start" />{section.label}
        </Button>
      {/each}
    </nav>
  </div>
  <nav
    class="mx-auto hidden h-12 w-full max-w-7xl items-center gap-1 px-4 sm:px-6 lg:flex lg:px-8"
    aria-label="Administration"
  >
    <strong class="mr-2 text-sm font-medium">Administration</strong>
    <Separator orientation="vertical" class="mr-2 h-5" />
    {#each sections as section (section.href)}
      <Button href={resolve(section.href)} variant="ghost" size="sm">
        <section.icon data-icon="inline-start" />{section.label}
      </Button>
    {/each}
  </nav>
</div>

{@render children()}
