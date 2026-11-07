import { motion, useReducedMotion } from 'motion/react';
import type { ReactNode } from 'react';

/** A headline or line that rises into place out of a light blur when the screen opens. */
export function Rise({
  delay = 0,
  className,
  children,
}: {
  readonly delay?: number;
  readonly className?: string;
  readonly children: ReactNode;
}) {
  const still = useReducedMotion() === true;
  return (
    <motion.div
      className={className}
      initial={still ? false : { opacity: 0, y: 22, filter: 'blur(6px)' }}
      animate={{ opacity: 1, y: 0, filter: 'blur(0px)' }}
      transition={still ? { duration: 0 } : { duration: 0.55, ease: [0.23, 1, 0.32, 1], delay }}
    >
      {children}
    </motion.div>
  );
}
