import { useCallback, useEffect, useState, useSyncExternalStore } from 'react';

import { pushCardFor, type PushCard, type PushEnvironment } from './push-card.ts';
import {
  disablePush,
  enablePush,
  type EnablePushResult,
  readPushEnvironment,
} from './push-subscription.ts';

/** What a screen needs to offer pushes: the device's state, its card, and the two switches. */
export interface PushControls {
  /** Undefined until the browser has answered. */
  readonly environment: PushEnvironment | undefined;
  readonly card: PushCard | null;
  readonly busy: boolean;
  readonly lastResult: EnablePushResult | undefined;
  /** Call from the player's tap. */
  readonly enable: () => void;
  readonly disable: () => void;
}

// One answer for the whole page, so Today's card and the account panel's switch always agree.
let environment: PushEnvironment | undefined;
const listeners = new Set<() => void>();

function refresh(): void {
  void readPushEnvironment().then((read) => {
    environment = read;
    for (const listener of listeners) listener();
  });
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** The pushes of this device, read when a screen first asks and after each switch. */
export function usePush(): PushControls {
  const current = useSyncExternalStore(subscribe, () => environment);
  const [busy, setBusy] = useState(false);
  const [lastResult, setLastResult] = useState<EnablePushResult>();

  useEffect(() => {
    if (environment === undefined) refresh();
  }, []);

  const enable = useCallback(() => {
    setBusy(true);
    void enablePush()
      .then(setLastResult)
      .finally(() => {
        setBusy(false);
        refresh();
      });
  }, []);

  const disable = useCallback(() => {
    setBusy(true);
    void disablePush()
      .catch(() => undefined)
      .finally(() => {
        setBusy(false);
        refresh();
      });
  }, []);

  return {
    environment: current,
    card: current === undefined ? null : pushCardFor(current),
    busy,
    lastResult,
    enable,
    disable,
  };
}
