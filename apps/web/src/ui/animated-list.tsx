// Adapted from React Bits' "AnimatedList" (TS + Tailwind), https://reactbits.dev/r/AnimatedList-TS-TW.json.
// MIT + Commons Clause: see LICENSE-react-bits.txt. Part of this application only, never redistributed.
// Changes: reduced to its staggered reveal of items as they scroll into view, with no selection,
// keyboard cursor, scroll fades or hugeicons; nothing moves under reduced motion.
import { motion, useReducedMotion } from 'motion/react';
import type { ReactNode } from 'react';

/** An ordered list whose rows rise into place one after another the first time they show. */
export function AnimatedList({
  items,
  className,
  label,
}: {
  readonly items: readonly { readonly key: string | number; readonly content: ReactNode }[];
  readonly className?: string;
  readonly label?: string;
}) {
  const still = useReducedMotion() === true;
  return (
    <ol className={className} aria-label={label}>
      {items.map(({ key, content }, index) => (
        <motion.li
          key={key}
          initial={still ? false : { opacity: 0, y: 14, scale: 0.98 }}
          whileInView={{ opacity: 1, y: 0, scale: 1 }}
          viewport={{ once: true, margin: '0px 0px -10% 0px' }}
          transition={{
            duration: 0.32,
            delay: Math.min(index, 6) * 0.06,
            ease: [0.23, 1, 0.32, 1],
          }}
        >
          {content}
        </motion.li>
      ))}
    </ol>
  );
}
