<script lang="ts">
  import ClipboardListIcon from '@lucide/svelte/icons/clipboard-list';
  import CalendarCogIcon from '@lucide/svelte/icons/calendar-cog';
  import MonitorCogIcon from '@lucide/svelte/icons/monitor-cog';
  import UsersIcon from '@lucide/svelte/icons/users';
  import { resolve } from '$app/paths';
  import { Button } from '$lib/components/ui/button/index.js';
  import { Separator } from '$lib/components/ui/separator/index.js';

  let { children } = $props();
</script>

<div class="bg-muted/30 border-b">
  <nav
    class="mx-auto flex h-12 w-full max-w-7xl items-center gap-1 overflow-x-auto px-4 sm:px-6 lg:px-8"
    aria-label="Administration"
  >
    <strong class="mr-2 hidden text-sm font-medium sm:inline">Administration</strong>
    <Separator orientation="vertical" class="mr-2 hidden h-5 sm:block" />
    <Button href={resolve('/admin/users')} variant="ghost" size="sm"
      ><UsersIcon data-icon="inline-start" />Users</Button
    >
    <Button href={resolve('/admin/workstations')} variant="ghost" size="sm"
      ><MonitorCogIcon data-icon="inline-start" />Workstations</Button
    >
    <Button href={resolve('/admin/reservations')} variant="ghost" size="sm"
      ><CalendarCogIcon data-icon="inline-start" />Reservations</Button
    >
    <Button href={resolve('/admin/audit')} variant="ghost" size="sm"
      ><ClipboardListIcon data-icon="inline-start" />Audit history</Button
    >
  </nav>
</div>

{@render children()}
