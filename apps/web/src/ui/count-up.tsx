// Adapted from React Bits' "CountUp" (TS + Tailwind), https://reactbits.dev/r/CountUp-TS-TW.json.
// MIT + Commons Clause: see LICENSE-react-bits.txt. Part of this application only, never redistributed.
// Changes: reduced to counting from the last shown value when it comes into view, written to the
// DOM rather than re-rendering, and the final number at once under reduced motion.
import { animate, useInView, useReducedMotion } from 'motion/react';
import { useEffect, useRef } from 'react';

/** A whole number that counts up to its value. Screen readers and copies get the value itself. */
export function CountUp({
  value,
  duration = 0.9,
  className,
}: {
  readonly value: number;
  readonly duration?: number;
  readonly className?: string;
}) {
  const ref = useRef<HTMLSpanElement>(null);
  const shown = useRef(0);
  const inView = useInView(ref, { once: true });
  const still = useReducedMotion() === true;

  useEffect(() => {
    const node = ref.current;
    if (node === null || !inView) return undefined;
    if (still) {
      node.textContent = String(value);
      shown.current = value;
      return undefined;
    }
    const controls = animate(shown.current, value, {
      duration,
      ease: [0.16, 1, 0.3, 1],
      onUpdate: (latest) => {
        shown.current = latest;
        node.textContent = String(Math.round(latest));
      },
    });
    return () => {
      controls.stop();
    };
  }, [value, duration, inView, still]);

  return (
    <span className={className}>
      <span className="sr-only">{value}</span>
      <span aria-hidden ref={ref} className="tabular-nums">
        {still ? value : 0}
      </span>
    </span>
  );
}
