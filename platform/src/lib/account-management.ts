export const accountManagementCapability = 'account-management-v1';
export type LocalAccount = {
  username: string;
  uid: number;
  gid: number;
  home: string;
  primaryGroup: string;
  fingerprint: string;
  eligible: boolean;
  reason: string;
  ownerWorkstationId: string;
  exists: boolean;
};
export type AccountSnapshot = { observedAt: string; complete: boolean; accounts: LocalAccount[] };
export function parseAccountSnapshot(value: unknown): AccountSnapshot | null {
  if (!value || typeof value !== 'object') return null;
  const s = value as AccountSnapshot;
  if (
    typeof s.observedAt !== 'string' ||
    !Number.isFinite(Date.parse(s.observedAt)) ||
    typeof s.complete !== 'boolean' ||
    !Array.isArray(s.accounts) ||
    s.accounts.length > 4096
  )
    return null;
  const names = new Set<string>();
  for (const a of s.accounts) {
    if (
      !a ||
      typeof a !== 'object' ||
      typeof a.username !== 'string' ||
      a.username.length < 1 ||
      a.username.length > 32 ||
      /[\s:/]/.test(a.username) ||
      [...a.username].some((c) => c.charCodeAt(0) < 32) ||
      names.has(a.username) ||
      !Number.isSafeInteger(a.uid) ||
      a.uid < 1000 ||
      a.uid > 4294967294 ||
      !Number.isSafeInteger(a.gid) ||
      a.gid < 0 ||
      a.gid > 4294967294 ||
      typeof a.home !== 'string' ||
      a.home.length > 4096 ||
      typeof a.primaryGroup !== 'string' ||
      a.primaryGroup.length > 32 ||
      typeof a.fingerprint !== 'string' ||
      !/^[a-f0-9]{64}$/.test(a.fingerprint) ||
      typeof a.eligible !== 'boolean' ||
      typeof a.reason !== 'string' ||
      a.reason.length > 500 ||
      typeof a.ownerWorkstationId !== 'string' ||
      (a.ownerWorkstationId !== '' && !/^[a-f0-9-]{36}$/.test(a.ownerWorkstationId)) ||
      typeof a.exists !== 'boolean'
    )
      return null;
    if (
      a.eligible &&
      (!/^[a-z][a-z0-9_-]{2,31}$/.test(a.username) ||
        !a.exists ||
        a.uid < 20000 ||
        a.uid > 59999 ||
        a.uid !== a.gid ||
        a.home !== `/home/${a.username}` ||
        a.primaryGroup !== a.username)
    )
      return null;
    names.add(a.username);
  }
  // Copy only the documented public metadata; never persist arbitrary node-supplied properties.
  return {
    observedAt: s.observedAt,
    complete: s.complete,
    accounts: s.accounts.map((a) => ({
      username: a.username,
      uid: a.uid,
      gid: a.gid,
      home: a.home,
      primaryGroup: a.primaryGroup,
      fingerprint: a.fingerprint,
      eligible: a.eligible,
      reason: a.reason,
      ownerWorkstationId: a.ownerWorkstationId,
      exists: a.exists
    }))
  };
}
