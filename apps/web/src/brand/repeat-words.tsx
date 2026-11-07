import { motion } from 'motion/react';

import { cn } from '../ui/class-names.ts';
import { useAmbient } from '../ui/use-ambient.ts';

/**
 * A big word repeated tone on tone behind a screen or a card (CRONISTA, FIAMBRE, a character's name),
 * drifting sideways very slowly while it is on screen. Decoration, never read.
 */
export function RepeatWords({
  word,
  count,
  className,
  color,
}: {
  readonly word: string;
  readonly count: number;
  readonly className?: string;
  readonly color?: string;
}) {
  const [ref, alive] = useAmbient<HTMLDivElement>();
  return (
    <motion.div
      ref={ref}
      aria-hidden
      className={cn('repeat-word', className)}
      style={color === undefined ? {} : { color }}
      animate={alive ? { x: [0, -36, 0] } : { x: 0 }}
      transition={alive ? { duration: 28, repeat: Infinity, ease: 'easeInOut' } : { duration: 0 }}
    >
      {Array.from({ length: count }, () => word).join('\n')}
    </motion.div>
  );
}
