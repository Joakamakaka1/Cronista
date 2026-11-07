/**
 * Whether the signed-in player changed between two auth events: another player, or none. The cached
 * game data holds what only the previous player may read, so it goes; a token refresh for the same
 * player keeps it.
 */
export function isPlayerChange(previousUserId: string | null, nextUserId: string | null): boolean {
  return previousUserId !== nextUserId;
}
