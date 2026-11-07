// Adapted from React Bits' "RotatingText" (TS + Tailwind), https://reactbits.dev/r/RotatingText-TS-TW.json.
// MIT + Commons Clause: see LICENSE-react-bits.txt. Part of this application only, never redistributed.
// Changes: the "flip" effect with a light blur, characters staggered from the first, grapheme split
// in Spanish, AnimatePresence mode="wait", no layout animation or highlight, and a player who asks
// for less motion sees the first line, still.
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import { useEffect, useState } from 'react';

const STAGGER = 0.025;
const BLUR = 'blur(4px)';
const segmenter = new Intl.Segmenter('es', { granularity: 'grapheme' });

/**
 * Lines that take turns in one place, each flipping in letter by letter. Screen readers hear the
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
  const words = text
    .split(' ')
    .map((word) => Array.from(segmenter.segment(word), ({ segment }) => segment));

  return (
    <span className={className}>
      <span className="sr-only">{texts[0]}</span>
      <span aria-hidden className="relative inline-flex">
        <AnimatePresence mode="wait" initial={false}>
          <motion.span key={text} className="inline-flex flex-wrap whitespace-pre">
            {words.map((characters, wordIndex) => {
              const before = words.slice(0, wordIndex).reduce((sum, word) => sum + word.length, 0);
              return (
                <span key={wordIndex} className="inline-flex">
                  {characters.map((character, characterIndex) => {
                    const delay = (before + characterIndex) * STAGGER;
                    return (
                      <motion.span
                        key={characterIndex}
                        className="inline-block"
                        style={{ transformOrigin: '50% 50% -0.45em', backfaceVisibility: 'hidden' }}
                        initial={{
                          rotateX: -90,
                          opacity: 0,
                          filter: BLUR,
                          transformPerspective: 480,
                        }}
                        animate={{
                          rotateX: 0,
                          opacity: 1,
                          filter: 'blur(0px)',
                          transformPerspective: 480,
                        }}
                        exit={{
                          rotateX: 90,
                          opacity: 0,
                          filter: BLUR,
                          transition: still
                            ? { duration: 0 }
                            : { type: 'tween', duration: 0.32, ease: [0.5, 0, 0.75, 0], delay },
                        }}
                        transition={
                          still
                            ? { duration: 0 }
                            : { type: 'tween', duration: 0.6, ease: [0.34, 1.4, 0.64, 1], delay }
                        }
                      >
                        {character}
                      </motion.span>
                    );
                  })}
                  {wordIndex < words.length - 1 && <span className="whitespace-pre"> </span>}
                </span>
              );
            })}
          </motion.span>
        </AnimatePresence>
      </span>
    </span>
  );
}
