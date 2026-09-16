<script lang="ts">
  import ArrowRightIcon from '@lucide/svelte/icons/arrow-right';
  import DatabaseIcon from '@lucide/svelte/icons/database';
  import ServerCogIcon from '@lucide/svelte/icons/server-cog';
  import { resolve } from '$app/paths';
  import { Badge } from '$lib/components/ui/badge/index.js';
  import { Button } from '$lib/components/ui/button/index.js';
  import * as Card from '$lib/components/ui/card/index.js';
  import { product } from '$lib/product';

  let { data } = $props();
</script>

<svelte:head>
  <title>{product.name}</title>
  <meta name="description" content={product.description} />
</svelte:head>

<main
  class="mx-auto grid min-h-[calc(100vh-3.5rem)] w-full max-w-7xl place-items-center px-4 py-12 sm:px-6 lg:px-8"
>
  <Card.Root class="w-full max-w-2xl">
    <Card.Header class="gap-4">
      <div class="bg-muted flex size-11 items-center justify-center rounded-lg border">
        <ServerCogIcon class="size-5" aria-hidden="true" />
      </div>
      <div class="space-y-2">
        <p class="text-muted-foreground text-xs font-medium tracking-widest uppercase">
          Research infrastructure
        </p>
        <Card.Title class="text-3xl font-semibold tracking-tight sm:text-5xl"
          >{product.name}</Card.Title
        >
        <Card.Description class="max-w-xl text-base leading-relaxed"
          >{product.description}</Card.Description
        >
      </div>
    </Card.Header>
    <Card.Content class="gap-5">
      <div>
        {#if data.user}
          <Button
            href={data.user.mustChangePassword
              ? resolve('/change-password')
              : resolve('/dashboard')}
            size="lg"
          >
            Continue to dashboard <ArrowRightIcon data-icon="inline-end" />
          </Button>
        {:else}
          <Button href={resolve('/login')} size="lg">
            Log in to Cluster Manager <ArrowRightIcon data-icon="inline-end" />
          </Button>
        {/if}
      </div>
      <div class="flex items-center gap-2 border-t pt-5">
        <DatabaseIcon class="text-muted-foreground size-4" aria-hidden="true" />
        <Badge variant={data.database.status === 'ready' ? 'default' : 'destructive'}>
          {data.database.status === 'ready' ? 'Ready' : 'Unavailable'}
        </Badge>
        <span class="text-muted-foreground text-sm">
          {data.database.status === 'ready'
            ? 'Platform and database are ready'
            : 'Platform is running; database is unavailable'}
        </span>
      </div>
    </Card.Content>
  </Card.Root>
</main>
