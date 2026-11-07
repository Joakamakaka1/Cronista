import { describe, expect, it } from 'vitest';

import { isPostgresChangesReady } from './postgres-changes-ready.ts';

describe('isPostgresChangesReady', () => {
  it('spots the system message that says database changes now stream to the channel', () => {
    expect(
      isPostgresChangesReady({
        message: 'Subscribed to PostgreSQL',
        status: 'ok',
        extension: 'postgres_changes',
        channel: 'game:3f9a',
      }),
    ).toBe(true);
  });

  it('ignores a failed subscription and other extensions', () => {
    expect(
      isPostgresChangesReady({
        message: 'Error subscribing to PostgreSQL',
        status: 'error',
        extension: 'postgres_changes',
      }),
    ).toBe(false);
    expect(isPostgresChangesReady({ status: 'ok', extension: 'broadcast' })).toBe(false);
  });

  it('ignores anything that is not a system message', () => {
    expect(isPostgresChangesReady(null)).toBe(false);
    expect(isPostgresChangesReady('ok')).toBe(false);
  });
});
