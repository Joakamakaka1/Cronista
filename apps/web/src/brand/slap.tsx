import { motion, useReducedMotion } from 'motion/react';
import type { ReactNode } from 'react';

/**
 * A sticker or stamp slapped onto the page: it lands from slightly bigger with a spring and settles
 * at its tilt, and gives a little when pressed. Still under reduced motion.
 */
export function Slap({
  rotate,
  delay = 0,
  onView = false,
  className,
  children,
}: {
  /** The tilt it rests at, in degrees. */
  readonly rotate: number;
  readonly delay?: number;
  /** Lands when it first scrolls into view, instead of on mount. */
  readonly onView?: boolean;
  readonly className?: string;
  readonly children: ReactNode;
}) {
  const still = useReducedMotion() === true;
  const landed = { scale: 1, rotate, opacity: 1 };
  return (
    <motion.span
      className={className}
      initial={still ? { rotate } : { scale: 1.6, rotate: rotate - 16, opacity: 0 }}
      {...(onView ? { whileInView: landed, viewport: { once: true } } : { animate: landed })}
      whileTap={still ? {} : { scale: 0.92, rotate: rotate + 4 }}
      transition={still ? { duration: 0 } : { type: 'spring', stiffness: 420, damping: 15, delay }}
    >
      {children}
    </motion.span>
  );
}
