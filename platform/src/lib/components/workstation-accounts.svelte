<script lang="ts">
  import type { loadAccountManagement } from '$lib/server/nodes/accounts';
  import AccountConfirmation from './account-confirmation.svelte';
  import AccountOperations from './account-operations.svelte';
  import { Input } from '$lib/components/ui/input/index.js';
  let { management }: { management: Awaited<ReturnType<typeof loadAccountManagement>> } = $props();
  let query = $state('');
  let visible = $derived(
    management.accounts.filter((a) => a.username.toLowerCase().includes(query.toLowerCase().trim()))
  );
</script>

<section class="grid min-w-0 gap-4" aria-label="Local workstation accounts">
  <div>
    <h2 class="text-xl font-semibold">Local accounts</h2>
    <p class="text-muted-foreground text-sm">
      Import existing accounts to give this platform full management, including account deletion.
    </p>
  </div>
  {#if !management.supported}<p>
      Node update required for account discovery, import, and removal.
    </p>{:else if !management.fresh}<p class="text-muted-foreground text-sm">
      Waiting for a fresh complete scan from the online node. Import and removal are unavailable.
    </p>{/if}
  <Input
    type="search"
    aria-label="Search local accounts"
    placeholder="Search local accounts…"
    bind:value={query}
    class="sm:max-w-xs"
  />
  <div class="overflow-x-auto rounded-lg border">
    <table class="w-full text-left text-sm">
      <thead
        ><tr class="border-b"
          ><th class="p-3">Account</th><th class="p-3">UID / GID</th><th class="p-3">Home</th><th
            class="p-3">Status</th
          ><th class="p-3">Actions</th></tr
        ></thead
      ><tbody>
        {#each visible as a (a.username)}<tr class="border-b last:border-0"
            ><td class="p-3 font-medium">{a.username}</td><td class="p-3">{a.uid} / {a.gid}</td><td
              class="p-3">{a.home}</td
            ><td class="p-3"
              >{a.managed ? 'Managed' : a.ownerWorkstationId ? 'Previously managed' : 'Unmanaged'}
              <p class="text-muted-foreground">
                {a.conflict || (a.canImport ? 'Eligible to import' : '')}
              </p></td
            ><td class="p-3">
              {#if a.managed && a.userId}<AccountConfirmation
                  action="?/removeAccount"
                  username={a.username}
                  label="Remove workstation account"
                  description="Revoke access and remove this Linux account from this workstation. The platform user and other workstation assignments remain. Home files are kept unless selected below."
                  fields={{ userId: a.userId }}
                  targets={[`${management.workstationName} · ${a.home}`]}
                  allowHomeDeletion
                  disabled={!management.fresh}
                />
              {:else}<AccountConfirmation
                  action="?/importAccount"
                  username={a.username}
                  label="Import account"
                  description="Transfer full management of this existing Linux account, including deletion rights. Its numeric identity and home files will be preserved. A new platform user receives a temporary password; an existing matching user keeps their platform password."
                  fields={{ username: a.username, fingerprint: a.fingerprint }}
                  targets={[
                    `${a.username} · UID/GID ${a.uid}:${a.gid}`,
                    `${management.workstationName} · ${a.home}`
                  ]}
                  disabled={!a.canImport}
                />{/if}
            </td></tr
          >{:else}<tr
            ><td colspan="5" class="p-6 text-center text-muted-foreground"
              >No local accounts reported.</td
            ></tr
          >{/each}
      </tbody>
    </table>
  </div>
  <AccountOperations operations={management.operations} />
</section>
