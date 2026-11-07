// Adapted from Motion Primitives' "AnimatedGroup", https://motion-primitives.com/c/animated-group.json.
// MIT License: see LICENSE-motion-primitives.txt.
// Changes: only the "slide" preset, rendered as a list, and still under reduced motion.
import { motion, stagger, useReducedMotion, type Variants } from 'motion/react';
import type { ReactNode } from 'react';

const container: Variants = { visible: { transition: { delayChildren: stagger(0.08) } } };
const item: Variants = { hidden: { opacity: 0, y: 20 }, visible: { opacity: 1, y: 0 } };

/** A list whose items slide up and fade in one after another when it first renders. */
export function AnimatedGroup({
  children,
  className,
}: {
  readonly children: readonly { readonly key: string; readonly node: ReactNode }[];
  readonly className?: string;
}) {
  const still = useReducedMotion() === true;
  return (
    <motion.ul
      className={className}
      initial={still ? false : 'hidden'}
      animate="visible"
      variants={container}
    >
      {children.map(({ key, node }) => (
        <motion.li key={key} variants={item}>
          {node}
        </motion.li>
      ))}
    </motion.ul>
  );
}
