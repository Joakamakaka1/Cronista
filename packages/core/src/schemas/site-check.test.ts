import { describe, expect, it } from 'vitest';

import { siteCheckEventSchema } from './site-check.ts';

describe('siteCheckEventSchema', () => {
  it('accepts only the site check event', () => {
    expect(siteCheckEventSchema.safeParse({ check: 'site' }).success).toBe(true);
    expect(siteCheckEventSchema.safeParse({ check: 'providers' }).success).toBe(false);
    expect(siteCheckEventSchema.safeParse({ check: 'site', url: 'https://x' }).success).toBe(false);
  });
});
