// Adapted from Motion Primitives' "In View", https://motion-primitives.com/c/in-view.json.
// MIT License: see LICENSE-motion-primitives.txt.
// Changes: a div that fades and rises once, and is simply there under reduced motion.
import { motion, useReducedMotion } from 'motion/react';
import type { ReactNode } from 'react';

/** Content that fades up the first time it scrolls into view. */
export function InView({
  children,
  className,
}: {
  readonly children: ReactNode;
  readonly className?: string;
}) {
  const still = useReducedMotion() === true;
  return (
    <motion.div
      className={className}
      initial={still ? false : { opacity: 0, y: 24 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: '0px 0px -10% 0px' }}
      transition={{ duration: 0.4, ease: [0.23, 1, 0.32, 1] }}
    >
      {children}
    </motion.div>
  );
}
