import { motion } from 'motion/react';

import { cn } from '../ui/class-names.ts';
import { useAmbient } from '../ui/use-ambient.ts';

// Copies of the word in each third of a row: enough to overflow the widest screen it sits behind.
const COPIES = 6;

/**
 * A big word repeated tone on tone behind a screen or a card (CRONISTA, FIAMBRE, a character's name),
 * as rows that scroll sideways forever like a ticker, each in the opposite direction to the one
 * above. They run only while on screen, and keep still under reduced motion. Decoration, never read.
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
  const third = Array.from({ length: COPIES }, () => `${word}\u00a0`).join('');
  return (
    <div
      ref={ref}
      aria-hidden
      className={cn('repeat-word overflow-visible', className)}
      style={color === undefined ? {} : { color }}
    >
      {Array.from({ length: count }, (_, row) => {
        const leftward = row % 2 === 0;
        return (
          <motion.div
            key={row}
            className="w-max whitespace-nowrap"
            // Three equal thirds, kept a third off each side: moving by one third lands on the same
            // picture, so the loop has no seam and no edge ever shows, whatever the tilt.
            initial={{ x: leftward ? '-33.333%' : '-66.666%' }}
            animate={
              alive
                ? { x: leftward ? '-66.666%' : '-33.333%' }
                : { x: leftward ? '-33.333%' : '-66.666%' }
            }
            transition={
              alive
                ? { duration: 72 + row * 10, repeat: Infinity, ease: 'linear' }
                : { duration: 0 }
            }
          >
            {third}
            {third}
            {third}
          </motion.div>
        );
      })}
    </div>
  );
}
