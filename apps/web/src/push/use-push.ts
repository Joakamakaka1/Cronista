import { useCallback, useEffect, useState } from 'react';

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

/** The pushes of this device, read when the screen mounts and after each switch. */
export function usePush(): PushControls {
  const [environment, setEnvironment] = useState<PushEnvironment>();
  const [busy, setBusy] = useState(false);
  const [lastResult, setLastResult] = useState<EnablePushResult>();

  const refresh = useCallback(() => {
    void readPushEnvironment().then(setEnvironment);
  }, []);
  useEffect(refresh, [refresh]);

  const enable = useCallback(() => {
    setBusy(true);
    void enablePush()
      .then(setLastResult)
      .finally(() => {
        setBusy(false);
        refresh();
      });
  }, [refresh]);

  const disable = useCallback(() => {
    setBusy(true);
    void disablePush()
      .catch(() => undefined)
      .finally(() => {
        setBusy(false);
        refresh();
      });
  }, [refresh]);

  return {
    environment,
    card: environment === undefined ? null : pushCardFor(environment),
    busy,
    lastResult,
    enable,
    disable,
  };
}
