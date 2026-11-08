/** What the app knows about push on this device. */
export interface PushEnvironment {
  /** The browser has service workers, the Push API and notifications, and the app registered one. */
  readonly supported: boolean;
  /** The app runs installed, from the home screen. */
  readonly standalone: boolean;
  readonly permission: NotificationPermission;
  /** This browser holds a push subscription for the app. */
  readonly subscribed: boolean;
}

/**
 * Which card Today shows about pushes, if any: the install guide while the app runs in the browser,
 * the button that asks for permission once it is installed, how to unblock notifications the
 * player denied, or that the phone cannot receive them.
 */
export type PushCard = 'install' | 'enable' | 'blocked' | 'unsupported';

/** The card for a device, or nothing when its pushes already arrive. */
export function pushCardFor(environment: PushEnvironment): PushCard | null {
  if (environment.subscribed && environment.permission === 'granted') return null;
  // iPhone only offers push to an installed app, so the guide comes first everywhere.
  if (!environment.standalone) return 'install';
  if (!environment.supported) return 'unsupported';
  if (environment.permission === 'denied') return 'blocked';
  return 'enable';
}
