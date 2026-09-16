<script lang="ts">
  let { data } = $props();
  const dateFormatter = new Intl.DateTimeFormat(undefined, {
    dateStyle: 'medium',
    timeStyle: 'medium'
  });
</script>

<svelte:head><title>Audit history · Cluster Manager</title></svelte:head>

<main class="page-shell">
  <header class="page-heading">
    <h1>Audit history</h1>
    <p>The 200 most recent privileged and credential events.</p>
  </header>
  <section class="panel table-wrap">
    <table>
      <thead><tr><th>When</th><th>Who</th><th>Action</th><th>Target</th><th>Details</th></tr></thead
      >
      <tbody>
        {#each data.events as event (event.id)}
          <tr>
            <td
              ><time datetime={event.createdAt.toISOString()}
                >{dateFormatter.format(event.createdAt)}</time
              ></td
            >
            <td>{event.actorUsername ?? 'system'}</td>
            <td><code>{event.action}</code></td>
            <td
              >{event.targetType}{#if event.metadata.username}<strong
                  >{String(event.metadata.username)}</strong
                >{/if}{#if event.targetId}<small>{event.targetId}</small>{/if}</td
            >
            <td><code>{JSON.stringify(event.metadata)}</code></td>
          </tr>
        {/each}
      </tbody>
    </table>
  </section>
</main>

<style>
  td:first-child {
    min-width: 12rem;
  }
  td:nth-child(4) {
    display: grid;
    gap: 0.2rem;
  }
  td:last-child code {
    display: block;
    min-width: 15rem;
    white-space: normal;
    overflow-wrap: anywhere;
  }
  small {
    color: #768196;
    font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  }
</style>
