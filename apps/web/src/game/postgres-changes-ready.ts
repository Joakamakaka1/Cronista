/**
 * Whether a Realtime system message says database changes now stream to the channel.
 *
 * @remarks
 * After a while with no subscribers, Realtime stops streaming database changes, and the next
 * subscription starts it again. The channel's join is confirmed first, and changes committed between
 * that and this message are never delivered, so the app refetches when this message arrives.
 */
export function isPostgresChangesReady(payload: unknown): boolean {
  if (typeof payload !== 'object' || payload === null) return false;
  return (
    'extension' in payload &&
    payload.extension === 'postgres_changes' &&
    'status' in payload &&
    payload.status === 'ok'
  );
}
