import { describe, expect, it } from 'vitest';
import { parseAccountSnapshot } from './account-management';

const account = {
  username: 'researcher',
  uid: 20003,
  gid: 20003,
  home: '/home/researcher',
  primaryGroup: 'researcher',
  fingerprint: 'a'.repeat(64),
  eligible: true,
  reason: '',
  ownerWorkstationId: '',
  exists: true
};
const snapshot = { observedAt: new Date().toISOString(), complete: true, accounts: [account] };
describe('account snapshots', () => {
  it('copies only public identity metadata and rejects malformed or duplicate entries', () => {
    const parsed = parseAccountSnapshot({
      ...snapshot,
      accounts: [{ ...account, password: 'secret', passwordHash: 'hash', sshKeys: ['key'] }]
    });
    expect(parsed).toEqual(snapshot);
    expect(JSON.stringify(parsed)).not.toContain('secret');
    for (const accounts of [
      [account, account],
      [{ ...account, uid: 19999 }],
      [{ ...account, home: '/root' }],
      [{ ...account, fingerprint: '' }],
      [{ ...account, gid: 20004 }]
    ])
      expect(parseAccountSnapshot({ ...snapshot, accounts })).toBeNull();
  });
  it('shows incompatible human accounts with their reasons without allowing import', () => {
    const accounts = [
      {
        ...account,
        username: 'Existing.User',
        eligible: false,
        uid: 1001,
        gid: 1002,
        reason: 'Incompatible username and identity'
      }
    ];
    expect(parseAccountSnapshot({ ...snapshot, accounts })?.accounts).toEqual(accounts);
  });
});
