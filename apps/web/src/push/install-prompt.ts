import { useSyncExternalStore } from 'react';

/** Chrome's install offer, which it fires once it deems the app installable. */
interface InstallPromptEvent extends Event {
  readonly prompt: () => Promise<void>;
}

const isInstallPrompt = (event: Event): event is InstallPromptEvent =>
  'prompt' in event && typeof event.prompt === 'function';

let offer: InstallPromptEvent | null = null;
const listeners = new Set<() => void>();

const notify = () => {
  for (const listener of listeners) listener();
};

/**
 * Keeps Chrome's install offer for the install guide's button. Call it once at start: the event
 * fires early, often before the guide is open. Safari has no such event: its steps are by hand.
 */
export function listenForInstallPrompt(): void {
  window.addEventListener('beforeinstallprompt', (event) => {
    event.preventDefault();
    if (isInstallPrompt(event)) {
      offer = event;
      notify();
    }
  });
  window.addEventListener('appinstalled', () => {
    offer = null;
    notify();
  });
}

/** Shows Chrome's install dialog, if it offered one. Call it from the player's tap. */
export function useInstallPrompt(): (() => void) | null {
  const current = useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => offer,
  );
  if (current === null) return null;
  return () => {
    void current.prompt().finally(() => {
      offer = null;
      notify();
    });
  };
}
