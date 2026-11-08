import { describe, expect, it } from 'vitest';

import { LOCAL_DATABASE_URL, targetFrom } from './target.ts';

/** An invented pooler connection string for a role, built at run time like the real one. */
const pooled = (role: string) => {
  const url = new URL('postgresql://pooler.example.com:6543/postgres');
  url.username = `${role}.project`;
  url.password = 'invented-password';
  return url.toString();
};

describe('targetFrom', () => {
  it('reads the local Supabase when nothing says otherwise', () => {
    expect(targetFrom({})).toEqual({ ok: true, value: { kind: 'local', url: LOCAL_DATABASE_URL } });
  });

  it('ignores a database URL without the production opt-in', () => {
    const target = targetFrom({ CRONISTA_MCP_DATABASE_URL: pooled('memory_reader') });
    expect(target).toEqual({ ok: true, value: { kind: 'local', url: LOCAL_DATABASE_URL } });
  });

  it('reads production only when asked, with the URL of the read-only role', () => {
    const url = pooled('memory_reader');
    expect(targetFrom({ CRONISTA_MCP_TARGET: 'prod', CRONISTA_MCP_DATABASE_URL: url })).toEqual({
      ok: true,
      value: { kind: 'prod', url },
    });
  });

  it('refuses production without its URL', () => {
    const target = targetFrom({ CRONISTA_MCP_TARGET: 'prod' });
    expect(target.ok).toBe(false);
    expect(!target.ok && target.error).toContain('CRONISTA_MCP_DATABASE_URL');
  });

  it('refuses production as any role but memory_reader, and never echoes the URL', () => {
    const target = targetFrom({
      CRONISTA_MCP_TARGET: 'prod',
      CRONISTA_MCP_DATABASE_URL: pooled('postgres'),
    });
    expect(target.ok).toBe(false);
    expect(!target.ok && target.error).toContain('memory_reader');
    expect(!target.ok && target.error).not.toContain('invented-password');
  });

  it('refuses a target it does not know', () => {
    expect(targetFrom({ CRONISTA_MCP_TARGET: 'staging' }).ok).toBe(false);
  });
});
