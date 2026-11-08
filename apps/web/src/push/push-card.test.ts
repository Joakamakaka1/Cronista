import { describe, expect, it } from 'vitest';

import { type PushEnvironment, pushCardFor } from './push-card.ts';

const installed: PushEnvironment = {
  supported: true,
  standalone: true,
  permission: 'default',
  subscribed: false,
};

describe('pushCardFor', () => {
  it('shows the install guide while the app runs in the browser', () => {
    expect(pushCardFor({ ...installed, standalone: false })).toBe('install');
    // An iPhone's Safari has no Push API at all until the app is on the home screen.
    expect(pushCardFor({ ...installed, standalone: false, supported: false })).toBe('install');
  });

  it('offers to enable pushes once installed, and only then', () => {
    expect(pushCardFor(installed)).toBe('enable');
  });

  it('explains how to unblock notifications the player denied', () => {
    expect(pushCardFor({ ...installed, permission: 'denied' })).toBe('blocked');
  });

  it('says so when an installed app still cannot receive pushes', () => {
    expect(pushCardFor({ ...installed, supported: false })).toBe('unsupported');
  });

  it('shows nothing once pushes arrive, installed or not', () => {
    expect(pushCardFor({ ...installed, permission: 'granted', subscribed: true })).toBeNull();
    expect(
      pushCardFor({ ...installed, standalone: false, permission: 'granted', subscribed: true }),
    ).toBeNull();
  });

  it('asks again when permission stands but the subscription is gone', () => {
    expect(pushCardFor({ ...installed, permission: 'granted' })).toBe('enable');
  });
});
