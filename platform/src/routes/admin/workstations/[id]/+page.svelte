<script lang="ts">
  import { resolve } from '$app/paths';
  let { data } = $props();
  let ws = $derived(data.workstation);
  const dateTime = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'medium' });
  const bytes = new Intl.NumberFormat(undefined, {
    style: 'unit',
    unit: 'gigabyte',
    maximumFractionDigits: 1
  });
  const gigabytes = (value: number) => bytes.format(value / 1_000_000_000);
</script>

<svelte:head><title>{ws.name} · Workstations · Cluster Manager</title></svelte:head>
<main class="page-shell">
  <a class="back" href={resolve('/admin/workstations')}>← All workstations</a>
  <header class="page-heading">
    <h1>{ws.displayName}</h1>
    <p><code>{ws.name}</code> · {ws.connectionState} · {ws.status}</p>
  </header>
  <section class="panel facts">
    <div>
      <span>Last heartbeat</span><strong
        >{ws.lastHeartbeatAt ? dateTime.format(ws.lastHeartbeatAt) : 'Never'}</strong
      >
    </div>
    <div><span>Node version</span><strong>{ws.nodeVersion ?? 'Unknown'}</strong></div>
    <div><span>Hostname</span><strong>{ws.hostname ?? 'Unknown'}</strong></div>
    <div>
      <span>Uptime</span><strong
        >{ws.uptimeSeconds === null
          ? 'Unknown'
          : `${ws.uptimeSeconds.toLocaleString()} seconds`}</strong
      >
    </div>
  </section>
  {#if ws.inventory}
    <section class="cards">
      <article class="panel">
        <h2>CPU</h2>
        <strong>{ws.inventory.cpu.utilizationPercent.toFixed(1)}%</strong>
        <p>{ws.inventory.cpu.model} · {ws.inventory.cpu.logicalCores} logical cores</p>
      </article>
      <article class="panel">
        <h2>Memory</h2>
        <strong>{ws.inventory.memory.utilizationPercent.toFixed(1)}%</strong>
        <p>
          {gigabytes(ws.inventory.memory.usedBytes)} of {gigabytes(ws.inventory.memory.totalBytes)}
        </p>
      </article>
      <article class="panel">
        <h2>Storage</h2>
        <strong>{ws.inventory.storage.utilizationPercent.toFixed(1)}%</strong>
        <p>
          {gigabytes(ws.inventory.storage.usedBytes)} of {gigabytes(
            ws.inventory.storage.totalBytes
          )} at {ws.inventory.storage.path}
        </p>
      </article>
    </section>
    <section class="panel sessions">
      <h2>Logged-in sessions</h2>
      {#if ws.inventory.sessions.length === 0}<p class="muted">No sessions reported.</p>{:else}<ul>
          {#each ws.inventory.sessions as session}<li>
              <strong>{session.username}</strong> on {session.terminal}{session.remoteHost
                ? ` from ${session.remoteHost}`
                : ''}
            </li>{/each}
        </ul>{/if}
    </section>
  {:else}
    <section class="panel">
      <h2>Waiting for inventory</h2>
      <p class="muted">Enroll and start this node to receive its first report.</p>
    </section>
  {/if}
</main>

<style>
  .back {
    display: inline-block;
    margin-bottom: 1rem;
    color: #324d7e;
    text-decoration: none;
  }
  .facts,
  .cards {
    display: grid;
    grid-template-columns: repeat(4, 1fr);
    gap: 1rem;
    margin-bottom: 1rem;
  }
  .facts div {
    display: grid;
    gap: 0.25rem;
  }
  .facts span,
  article p {
    color: #687386;
  }
  .cards {
    grid-template-columns: repeat(3, 1fr);
  }
  article strong {
    font-size: 2rem;
  }
  article p {
    margin: 0.5rem 0 0;
  }
  .sessions ul {
    margin-bottom: 0;
  }
  @media (max-width: 800px) {
    .facts,
    .cards {
      grid-template-columns: 1fr;
    }
  }
</style>
