<script lang="ts">
  let { title, description }: { title: string; description: string } = $props();
</script>

<header class="space-y-1.5">
  <h1 class="text-3xl font-semibold tracking-tight sm:text-4xl">{title}</h1>
  <p class="text-muted-foreground max-w-3xl text-sm sm:text-base">{description}</p>
</header>
