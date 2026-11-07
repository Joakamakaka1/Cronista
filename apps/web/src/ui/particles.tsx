// Adapted from Animate UI's "Particles" primitive, https://animate-ui.com/r/primitives-effects-particles.json.
// MIT + Commons Clause: see LICENSE-animate-ui.txt. Part of this application only, never redistributed.
// Changes: one burst on mount, its slot and in-view hooks folded in, and nothing at all under
// reduced motion.
import { motion, useReducedMotion } from 'motion/react';

/**
 * One burst of sparks from the centre of its parent, which must be positioned. Decoration only:
 * it plays once and leaves nothing behind.
 */
export function ParticlesBurst({
  count = 10,
  radius = 70,
  colors = ['#f44612', '#ffc93a', '#ff9ad5', '#7cb6ff'],
}: {
  readonly count?: number;
  readonly radius?: number;
  readonly colors?: readonly string[];
}) {
  const still = useReducedMotion() === true;
  if (still) return null;
  const step = (2 * Math.PI) / count;
  return (
    <span aria-hidden className="pointer-events-none absolute inset-0">
      {Array.from({ length: count }, (_, index) => (
        <motion.span
          key={index}
          className="absolute top-1/2 left-1/2 size-2.5 rounded-full"
          style={{
            backgroundColor: colors[index % colors.length],
            translateX: '-50%',
            translateY: '-50%',
          }}
          initial={{ x: 0, y: 0, scale: 0, opacity: 0 }}
          animate={{
            x: Math.cos(index * step) * radius,
            y: Math.sin(index * step) * radius,
            scale: [0, 1, 0],
            opacity: [0, 1, 0],
          }}
          transition={{ duration: 0.9, delay: 0.15 + index * 0.02, ease: 'easeOut' }}
        />
      ))}
    </span>
  );
}
