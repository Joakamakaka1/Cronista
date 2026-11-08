import { describe, expect, it } from 'vitest';

import { base64UrlBytes, isSameKey } from './application-server-key.ts';

describe('base64UrlBytes', () => {
  it('decodes unpadded base64url', () => {
    expect([...base64UrlBytes('-_8')]).toEqual([0xfb, 0xff]);
    expect([...base64UrlBytes('AQID')]).toEqual([1, 2, 3]);
  });
});

describe('isSameKey', () => {
  it('compares a subscription key with the app key byte by byte', () => {
    const key = Uint8Array.from([4, 1, 2]);
    expect(isSameKey(Uint8Array.from([4, 1, 2]).buffer, key)).toBe(true);
    expect(isSameKey(Uint8Array.from([4, 1, 3]).buffer, key)).toBe(false);
    expect(isSameKey(null, key)).toBe(false);
  });
});
