// Adapted from Kokonutui's "Slide to Confirm" 1.0.0 (2026-10-21) by @dorianbaffier,
// https://kokonutui.com/r/slide-to-confirm.json. MIT License: see LICENSE-kokonutui.txt.
// Changes: AnimatePresence uses mode="wait" (popLayout injects a <style>), Cronista's tokens, no
// reset after it is done, and a rejected `onConfirm` sends the thumb back with nothing sent.
import { ArrowRight, Check } from 'lucide-react';
import {
  animate,
  AnimatePresence,
  motion,
  useMotionValue,
  useReducedMotion,
  useTransform,
} from 'motion/react';
import {
  type MouseEvent,
  type PointerEvent,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from 'react';

import { cn } from './class-names.ts';

const EASE_OUT = [0.23, 1, 0.32, 1] as const;
const HEIGHT = 64;
const INSET = 6;
const THUMB = HEIGHT - INSET * 2;
// Share of the track the thumb must cross before letting go commits.
const COMMIT_AT = 0.9;
// A flick this fast (px/s) commits from FLICK_FROM of the way along.
const FLICK_SPEED = 900;
const FLICK_FROM = 0.45;
// How far past either end the thumb stretches, at most.
const OVERDRAG = 8;
// A press that moves less than this is a tap.
const TAP_SLOP = 4;

type Phase = 'idle' | 'dragging' | 'confirming' | 'done';

// Past the ends the thumb follows less and less, so it stretches instead of stopping dead.
function band(raw: number, max: number) {
  if (raw > max) return max + OVERDRAG * (1 - Math.exp(-(raw - max) / 40));
  if (raw < 0) return -OVERDRAG * (1 - Math.exp(raw / 40));
  return raw;
}

/**
 * Slide the thumb to the end to confirm something that cannot be undone. A tap only nudges it; Enter
 * or Space on the focused thumb, and a screen reader's activation, confirm in one go, so the label
 * must say what happens.
 */
export function SlideToConfirm({
  label,
  accessibleLabel,
  confirmingLabel,
  onConfirm,
  disabled = false,
  className,
}: {
  /** What sliding does, shown on the track. */
  readonly label: string;
  /** What activating the thumb does, read out by screen readers. */
  readonly accessibleLabel: string;
  /** Shown and read out while `onConfirm` runs. */
  readonly confirmingLabel: string;
  /** The real work. A rejected promise sends the thumb back to the start. */
  readonly onConfirm: () => Promise<unknown>;
  readonly disabled?: boolean;
  readonly className?: string;
}) {
  const [phase, setPhase] = useState<Phase>('idle');
  const [armed, setArmed] = useState(false);
  const reduceMotion = useReducedMotion() === true;

  const trackRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef({ pointer: 0, from: 0, moved: false });
  const runRef = useRef(0);
  const confirmRef = useRef(onConfirm);
  useEffect(() => {
    confirmRef.current = onConfirm;
  });

  const x = useMotionValue(0);
  const width = useMotionValue(0);
  const cover = useMotionValue(0);

  const max = () => Math.max(0, width.get() - THUMB - INSET * 2);

  // The fill runs from the left edge to just past the thumb, and floods the track once committed.
  const fillClip = useTransform(
    [x, width, cover],
    ([value = 0, total = 0, covered = 0]: number[]) => {
      const right = (1 - covered) * Math.max(0, total - value - INSET - THUMB / 2);
      return `inset(0px ${String(right)}px 0px 0px round ${String(HEIGHT)}px)`;
    },
  );
  const fillOpacity = useTransform(x, (value) => Math.min(1, value / 20));
  const labelOpacity = useTransform([x, width], ([value = 0, total = 0]: number[]) => {
    const progress = value / Math.max(1, total - THUMB - INSET * 2);
    return Math.max(0, 1 - progress * 0.55);
  });

  useLayoutEffect(() => {
    const track = trackRef.current;
    if (track === null) return;
    const observer = new ResizeObserver(() => {
      const before = width.get();
      width.set(track.offsetWidth);
      // A thumb at the end stays at the end when the track resizes.
      if (before > 0 && x.get() >= before - THUMB - INSET * 2) {
        x.set(track.offsetWidth - THUMB - INSET * 2);
      }
    });
    observer.observe(track);
    return () => {
      observer.disconnect();
    };
  }, [width, x]);

  useEffect(
    () => () => {
      runRef.current += 1;
    },
    [],
  );

  const spring = (velocity = 0) =>
    reduceMotion
      ? { duration: 0, ease: EASE_OUT }
      : { type: 'spring' as const, stiffness: 520, damping: 42, velocity };

  const settleBack = (velocity = 0) => {
    setArmed(false);
    setPhase('idle');
    void animate(cover, 0, { duration: reduceMotion ? 0 : 0.3, ease: EASE_OUT });
    void animate(x, 0, spring(velocity));
  };

  // One motion from release to result: the thumb carries on to the end while the track floods,
  // and the work starts at once.
  const commit = async (velocity: number, glide = false) => {
    const run = ++runRef.current;
    setPhase('confirming');
    setArmed(true);
    const landing = animate(
      x,
      max(),
      glide && !reduceMotion ? { duration: 0.42, ease: EASE_OUT } : spring(velocity),
    );
    const flooding = animate(cover, 1, { duration: reduceMotion ? 0 : 0.36, ease: EASE_OUT });
    try {
      await Promise.all([confirmRef.current(), landing, flooding]);
    } catch {
      if (runRef.current === run) settleBack();
      return;
    }
    if (runRef.current === run) setPhase('done');
  };

  const onPointerDown = (event: PointerEvent<HTMLButtonElement>) => {
    if (disabled || phase !== 'idle' || event.button !== 0) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    x.stop();
    dragRef.current = { pointer: event.clientX, from: x.get(), moved: false };
    setPhase('dragging');
  };

  const onPointerMove = (event: PointerEvent<HTMLButtonElement>) => {
    if (phase !== 'dragging') return;
    const drag = dragRef.current;
    const delta = event.clientX - drag.pointer;
    if (Math.abs(delta) > TAP_SLOP) drag.moved = true;
    const raw = drag.from + delta;
    x.set(band(raw, max()));
    const isArmed = raw >= max() * COMMIT_AT;
    if (isArmed !== armed) setArmed(isArmed);
  };

  const onPointerUp = () => {
    if (phase !== 'dragging') return;
    if (!dragRef.current.moved) {
      setPhase('idle');
      return;
    }
    const velocity = x.getVelocity();
    const progress = x.get() / Math.max(1, max());
    if (progress >= COMMIT_AT || (velocity > FLICK_SPEED && progress > FLICK_FROM)) {
      void commit(velocity);
    } else {
      settleBack(velocity);
    }
  };

  const onClick = async (event: MouseEvent<HTMLButtonElement>) => {
    if (disabled || phase !== 'idle') return;
    // Enter, Space and screen readers click with no pointer, and confirm in one go.
    if (event.detail === 0) {
      void commit(0, true);
      return;
    }
    if (dragRef.current.moved || reduceMotion) return;
    // A tap shows which way to go: a short nudge that springs back.
    await animate(x, 28, { duration: 0.18, ease: EASE_OUT });
    void animate(x, 0, spring());
  };

  const busy = phase === 'confirming' || phase === 'done';

  return (
    <div className={cn('relative w-full select-none', className)} data-phase={phase}>
      <div
        ref={trackRef}
        className={cn(
          'slide-track relative overflow-hidden rounded-full',
          disabled && 'opacity-50',
        )}
        style={{ height: HEIGHT }}
      >
        <motion.span
          aria-hidden
          className="absolute inset-0 flex items-center justify-center pl-14 text-base font-bold whitespace-nowrap text-white"
          style={{ opacity: labelOpacity }}
        >
          {label}
        </motion.span>

        <motion.div
          aria-hidden
          className="absolute inset-0 bg-accent/30"
          style={{ clipPath: fillClip, opacity: fillOpacity }}
        >
          <AnimatePresence initial={false} mode="wait">
            <motion.span
              key={busy ? 'busy' : 'slide'}
              className="absolute inset-0 flex items-center justify-center pr-14 text-base font-bold whitespace-nowrap text-white"
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -8 }}
              transition={reduceMotion ? { duration: 0 } : { duration: 0.26, ease: EASE_OUT }}
            >
              {busy ? `${confirmingLabel}…` : label}
            </motion.span>
          </AnimatePresence>
        </motion.div>

        <motion.button
          type="button"
          aria-label={accessibleLabel}
          aria-disabled={disabled || phase !== 'idle'}
          className={cn(
            'absolute grid touch-none place-items-center rounded-full bg-accent text-white outline-none',
            'focus-visible:ring-2 focus-visible:ring-white focus-visible:ring-offset-2 focus-visible:ring-offset-accent',
            phase === 'idle' && !disabled && 'cursor-grab',
            phase === 'dragging' && 'cursor-grabbing',
          )}
          onClick={(event) => void onClick(event)}
          onPointerCancel={onPointerUp}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          style={{ x, left: INSET, top: INSET, width: THUMB, height: THUMB }}
        >
          <span className="relative size-[22px]">
            <ArrowRight
              aria-hidden
              size={22}
              strokeWidth={2.6}
              className={cn(
                'absolute inset-0 transition-[opacity,translate] duration-200 ease-out',
                armed && !busy && 'translate-x-0.5',
                busy && 'translate-x-1.5 opacity-0',
              )}
            />
            <Check
              aria-hidden
              size={22}
              strokeWidth={2.8}
              className={cn(
                'absolute inset-0 transition-[opacity,scale] duration-200 ease-out',
                phase === 'done' ? 'scale-100 opacity-100' : 'scale-50 opacity-0',
              )}
            />
          </span>
        </motion.button>
      </div>

      <span aria-live="polite" className="sr-only">
        {busy && `${confirmingLabel}…`}
      </span>
    </div>
  );
}
