import { pushSubscriptionSchema } from '@cronista/core';

import { supabase } from '../supabase.ts';
import { base64UrlBytes, isSameKey, type PushEnvironment } from './push-card.ts';

/**
 * Registers the service worker, in a build only: the dev server emits none. A failure leaves the app
 * as a plain page, so it is never reported as an error.
 */
export function registerServiceWorker(): void {
  if (!import.meta.env.PROD || !('serviceWorker' in navigator)) return;
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(() => undefined);
  });
}

/** Whether the app runs installed, from the home screen. */
export function isStandalone(): boolean {
  // `navigator.standalone` is Safari's own, from before the display-mode query.
  return (
    window.matchMedia('(display-mode: standalone)').matches ||
    ('standalone' in navigator && navigator.standalone === true)
  );
}

function isPushSupported(): boolean {
  return (
    import.meta.env.PROD &&
    'serviceWorker' in navigator &&
    'PushManager' in window &&
    'Notification' in window
  );
}

/** What the app knows now about push on this device. */
export async function readPushEnvironment(): Promise<PushEnvironment> {
  const supported = isPushSupported();
  const permission = 'Notification' in window ? Notification.permission : 'default';
  let subscribed = false;
  if (supported) {
    const registration = await navigator.serviceWorker.getRegistration();
    subscribed = (await registration?.pushManager.getSubscription()) != null;
  }
  return { supported, standalone: isStandalone(), permission, subscribed };
}

/** How enabling pushes ended. */
export type EnablePushResult = 'enabled' | 'denied' | 'dismissed' | 'unsupported' | 'failed';

const applicationServerKey = base64UrlBytes(__VAPID_PUBLIC_KEY__);

/**
 * Asks for permission and subscribes this browser, then stores the subscription for the signed-in
 * player. Call it from the player's own tap: Safari only shows the prompt for one.
 */
export async function enablePush(): Promise<EnablePushResult> {
  if (!isPushSupported()) return 'unsupported';
  // First, while the tap still counts as the player's gesture.
  const permission = await Notification.requestPermission();
  if (permission === 'denied') return 'denied';
  if (permission !== 'granted') return 'dismissed';

  try {
    // A browser that blocks service workers never makes `ready` resolve: give up after a while.
    const registration = await Promise.race([
      navigator.serviceWorker.ready,
      new Promise<undefined>((resolve) => setTimeout(resolve, 10_000)),
    ]);
    if (registration === undefined) return 'failed';
    let subscription = await registration.pushManager.getSubscription();
    if (
      subscription !== null &&
      !isSameKey(subscription.options.applicationServerKey, applicationServerKey)
    ) {
      await subscription.unsubscribe();
      subscription = null;
    }
    subscription ??= await subscribe(registration);
    let stored = await storeSubscription(subscription);
    if (stored === 'taken') {
      // Another player subscribed this browser before signing out here: a new endpoint is ours.
      await subscription.unsubscribe();
      stored = await storeSubscription(await subscribe(registration));
    }
    return stored === 'stored' ? 'enabled' : 'failed';
  } catch {
    return 'failed';
  }
}

/**
 * Stops pushes to this browser: it removes the stored subscription and unsubscribes. Signing out
 * calls it first, so the next player on the same phone never gets someone else's pushes.
 */
export async function disablePush(): Promise<void> {
  if (!isPushSupported()) return;
  const registration = await navigator.serviceWorker.getRegistration();
  const subscription = await registration?.pushManager.getSubscription();
  if (subscription == null) return;
  await supabase.from('push_subscriptions').delete().eq('endpoint', subscription.endpoint);
  await subscription.unsubscribe();
}

function subscribe(registration: ServiceWorkerRegistration): Promise<PushSubscription> {
  return registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey });
}

async function storeSubscription(
  subscription: PushSubscription,
): Promise<'stored' | 'taken' | 'failed'> {
  const { endpoint, keys } = subscription.toJSON();
  const parsed = pushSubscriptionSchema.safeParse({
    endpoint,
    keys: { p256dh: keys?.p256dh, auth: keys?.auth },
  });
  if (!parsed.success) return 'failed';
  const { data } = parsed;

  // The same browser stored again replaces its row: new keys come with the same endpoint.
  const removed = await supabase.from('push_subscriptions').delete().eq('endpoint', data.endpoint);
  if (removed.error !== null) return 'failed';
  const inserted = await supabase
    .from('push_subscriptions')
    .insert({ endpoint: data.endpoint, p256dh: data.keys.p256dh, auth: data.keys.auth });
  if (inserted.error === null) return 'stored';
  return inserted.error.code === '23505' ? 'taken' : 'failed';
}
