/** Decodes a base64url string, as the VAPID public key and the subscription keys are written. */
export function base64UrlBytes(value: string): Uint8Array<ArrayBuffer> {
  const base64 = value.replaceAll('-', '+').replaceAll('_', '/');
  const binary = atob(base64.padEnd(Math.ceil(base64.length / 4) * 4, '='));
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

/** Whether a subscription was made with `key`: one made with another VAPID key cannot receive. */
export function isSameKey(subscriptionKey: ArrayBuffer | null, key: Uint8Array): boolean {
  if (subscriptionKey === null) return false;
  const bytes = new Uint8Array(subscriptionKey);
  return bytes.length === key.length && bytes.every((byte, index) => byte === key[index]);
}
