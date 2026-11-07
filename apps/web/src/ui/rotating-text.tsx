// Adapted from React Bits' "RotatingText" (TS + Tailwind), https://reactbits.dev/r/RotatingText-TS-TW.json.
// MIT + Commons Clause: see LICENSE-react-bits.txt. Part of this application only, never redistributed.
// Changes: reduced to the slide effect by characters, AnimatePresence mode="wait", no layout
// animation, and a player who asks for less motion sees the first line, still.
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import { useEffect, useState } from 'react';

/**
 * Lines that take turns in one place, each sliding in letter by letter. Screen readers hear the
 * first line once, not every change.
 */
export function RotatingText({
  texts,
  interval = 2600,
  className,
}: {
  readonly texts: readonly string[];
  readonly interval?: number;
  readonly className?: string;
}) {
  const still = useReducedMotion() === true;
  const [index, setIndex] = useState(0);

  useEffect(() => {
    if (still || texts.length < 2) return;
    const timer = setTimeout(() => {
      setIndex((current) => (current + 1) % texts.length);
    }, interval);
    return () => {
      clearTimeout(timer);
    };
  }, [still, texts.length, interval, index]);

  const text = texts[still ? 0 : index] ?? '';

  return (
    <span className={className}>
      <span className="sr-only">{texts[0]}</span>
      <span aria-hidden className="relative inline-flex overflow-hidden">
        <AnimatePresence mode="wait" initial={false}>
          <motion.span key={text} className="inline-flex whitespace-pre">
            {Array.from(new Intl.Segmenter('es').segment(text), ({ segment }) => segment).map(
              (character, position) => (
                <motion.span
                  key={position}
                  className="inline-block"
                  initial={{ y: '100%', opacity: 0 }}
                  animate={{ y: 0, opacity: 1 }}
                  exit={{ y: '-120%', opacity: 0 }}
                  transition={
                    still
                      ? { duration: 0 }
                      : { type: 'spring', damping: 30, stiffness: 400, delay: position * 0.012 }
                  }
                >
                  {character}
                </motion.span>
              ),
            )}
          </motion.span>
        </AnimatePresence>
      </span>
    </span>
  );
}
