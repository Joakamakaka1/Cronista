// Adapted from React Bits' "SpringCheck" (TS + Tailwind), https://reactbits.dev/r/SpringCheck-TS-TW.json.
// MIT + Commons Clause: see LICENSE-react-bits.txt. Part of this application only, never redistributed.
// Changes: display only (it checks once, on mount, and is not a control), the hugeicons tick drawn as
// a plain path, Cronista's colours, and still under reduced motion.
import { animate, useMotionValue, useMotionValueEvent, useReducedMotion } from 'motion/react';
import { useEffect, useLayoutEffect, useRef } from 'react';

const SWELL = 0.35;
const TICK_PATH = 'M5 14L8.5 17.5L19 6.5';

const clamp01 = (value: number) => Math.min(1, Math.max(0, value));

/** A box that fills and ticks itself with a small spring, once: "it landed". Decoration only. */
export function SpringCheck({ size = 40 }: { readonly size?: number }) {
  const still = useReducedMotion() === true;
  const t = useMotionValue(still ? 1 : 0);
  const boxRef = useRef<HTMLSpanElement>(null);
  const fillRef = useRef<HTMLSpanElement>(null);
  const tickRef = useRef<SVGPathElement>(null);

  // Written through the DOM, as the original does: no style tag, so the CSP allows it.
  const write = (value: number) => {
    if (fillRef.current) fillRef.current.style.transform = `scale(${String(Math.max(value, 0))})`;
    if (boxRef.current) {
      boxRef.current.style.transform = `scale(${String(1 + SWELL * Math.max(0, value - 1))})`;
    }
    if (tickRef.current) tickRef.current.style.strokeDashoffset = String(1 - clamp01(value));
  };
  useMotionValueEvent(t, 'change', write);
  useLayoutEffect(() => {
    write(t.get());
  });

  useEffect(() => {
    if (still) {
      t.jump(1);
      return undefined;
    }
    const controls = animate(t, 1, { type: 'spring', visualDuration: 0.35, bounce: 0.45 });
    return () => {
      controls.stop();
    };
  }, [still, t]);

  return (
    <span
      aria-hidden
      ref={boxRef}
      className="relative grid place-items-center overflow-hidden rounded-[30%] shadow-[inset_0_0_0_2.5px_#1f1e1b]"
      style={{ width: size, height: size }}
    >
      <span ref={fillRef} className="absolute inset-0 origin-center rounded-[inherit] bg-accent" />
      <svg
        className="relative h-[68%] w-[68%] overflow-visible fill-none stroke-white"
        viewBox="0 0 24 24"
        strokeWidth={2.8}
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path ref={tickRef} d={TICK_PATH} pathLength={1} strokeDasharray={1} />
      </svg>
    </span>
  );
}
