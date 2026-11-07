// Adapted from Kokonutui's "Flick Card" 2.0.0 (2026-10-14) by @dorianbaffier,
// https://kokonutui.com/r/card-flip.json. MIT License: see LICENSE-kokonutui.txt.
// Changes: controlled only, turned by a click, Enter or Space or the caller's own button; no drag
// physics, hover tilt or thickness slices; Cronista's tokens; instant under reduced motion.
import { motion, useReducedMotion } from 'motion/react';
import type { ReactNode } from 'react';

import { cn } from './class-names.ts';

/**
 * A card with two faces that turns over. The face turned away is inert, so neither keyboard nor
 * screen reader can reach it.
 */
export function CardFlip({
  front,
  back,
  flipped,
  onFlippedChange,
  label,
  className,
}: {
  readonly front: ReactNode;
  readonly back: ReactNode;
  readonly flipped: boolean;
  readonly onFlippedChange: (flipped: boolean) => void;
  readonly label: string;
  readonly className?: string;
}) {
  const still = useReducedMotion() === true;
  const face = 'absolute inset-0 backface-hidden';
  return (
    <div
      role="group"
      aria-label={label}
      aria-roledescription="ficha que se da la vuelta"
      tabIndex={0}
      className={cn('relative perspective-[1100px] select-none', className)}
      onClick={(event) => {
        if (!(event.target instanceof Element) || event.target.closest('a, button') === null) {
          onFlippedChange(!flipped);
        }
      }}
      onKeyDown={(event) => {
        if (event.target !== event.currentTarget) return;
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          onFlippedChange(!flipped);
        }
      }}
    >
      <motion.div
        className="preserve-3d relative h-full w-full"
        initial={false}
        animate={{ rotateY: flipped ? 180 : 0 }}
        transition={still ? { duration: 0 } : { type: 'spring', stiffness: 170, damping: 20 }}
      >
        <div className={face} inert={flipped} aria-hidden={flipped || undefined}>
          {front}
        </div>
        <div
          className={face}
          inert={!flipped}
          aria-hidden={!flipped || undefined}
          style={{ transform: 'rotateY(180deg)' }}
        >
          {back}
        </div>
      </motion.div>
    </div>
  );
}
