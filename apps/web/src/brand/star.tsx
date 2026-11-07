import { motion } from 'motion/react';

import { useAmbient } from '../ui/use-ambient.ts';

/**
 * A four-point sparkle, the motif scattered round the logo, stickers and quotes. A twinkling one
 * shrinks and turns now and then, while it is on screen.
 */
export function Star({
  size,
  color,
  className,
  twinkle = false,
  delay = 0,
}: {
  readonly size: number;
  readonly color: string;
  readonly className?: string;
  readonly twinkle?: boolean;
  readonly delay?: number;
}) {
  const [ref, alive] = useAmbient<SVGSVGElement>();
  return (
    <motion.svg
      ref={ref}
      aria-hidden
      width={size}
      height={size}
      viewBox="0 0 24 24"
      className={className}
      animate={
        twinkle && alive
          ? { scale: [1, 0.55, 1.12, 1], rotate: [0, 25, -8, 0], opacity: [1, 0.6, 1, 1] }
          : { scale: 1, rotate: 0, opacity: 1 }
      }
      transition={
        twinkle && alive
          ? { duration: 2.6, repeat: Infinity, repeatDelay: 1.8, delay, ease: 'easeInOut' }
          : { duration: 0 }
      }
    >
      <path
        d="M12 0 Q 13.6 10.4 24 12 Q 13.6 13.6 12 24 Q 10.4 13.6 0 12 Q 10.4 10.4 12 0 Z"
        fill={color}
      />
    </motion.svg>
  );
}
