import { useInView, useReducedMotion } from 'motion/react';
import { type RefObject, useRef } from 'react';

/**
 * Whether a looping, decorative animation may run: only while its element is on screen, and never
 * for a player who asks for less motion. Hidden tabs pause on their own, since Motion runs on
 * animation frames.
 */
export function useAmbient<T extends Element>(): readonly [RefObject<T | null>, boolean] {
  const ref = useRef<T>(null);
  const inView = useInView(ref, { margin: '120px' });
  const still = useReducedMotion() === true;
  return [ref, inView && !still] as const;
}
