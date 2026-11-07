// Adapted from Kokonutui's "Flick Card" 2.0.0 (2026-10-14) by @dorianbaffier,
// https://kokonutui.com/r/card-flip.json. MIT License: see LICENSE-kokonutui.txt.
// Changes: always controlled, a full-width card with Cronista's tokens, Spanish screen-reader hint,
// no demo faces, the hover tilt only for a fine pointer, and the edge in the card's own colour.
import {
  type PointerEvent,
  type ReactNode,
  type Ref,
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
} from 'react';

import { cn } from './class-names.ts';

// Degrees of turn per px of drag.
const DEG_PER_PX = 0.6;
// Spring that lands the card on a face, in degrees and seconds.
const STIFFNESS = 170;
const DAMPING = 20;
// How far ahead (in seconds of release velocity) the landing face is picked.
const PROJECTION = 0.22;
// A release faster than this (deg/s) always turns at least one face.
const FLICK_SPEED = 450;
// Never spin more than this many half turns from one flick.
const MAX_HALF_TURNS = 6;
// Movement below this (px) is a tap, not a drag.
const DRAG_SLOP = 4;
// How far the card lifts toward the viewer at 90°, in px.
const LIFT = 36;
// Hover pre-tilt toward the pointer, in degrees.
const TILT = 5;
// Card thickness: stacked slices between the two faces.
const THICKNESS = 6;
const SLICES = 7;
const SLICE_DEPTHS = Array.from(
  { length: SLICES },
  (_, index) => -THICKNESS / 2 + (THICKNESS * (index + 0.5)) / SLICES,
);
const SUBSTEP = 1 / 240;
// Release velocity is read from the last this-many ms of the drag.
const VELOCITY_WINDOW = 80;

const INTERACTIVE = 'button, a, input, select, textarea, [data-no-flip]';

const mod2 = (n: number) => ((n % 2) + 2) % 2;
const sideOf = (angle: number) => mod2(Math.round(angle / 180)) === 1;
const nearestFace = (angle: number) => Math.round(angle / 180) * 180;

interface Sim {
  angle: number;
  velocity: number;
  target: number;
  raf: number;
  last: number;
  reduceMotion: boolean;
  pointerId: number | null;
  startX: number;
  startAngle: number;
  dragging: boolean;
  samples: { t: number; a: number }[];
}

const cardTransform = (angle: number, lift: number) =>
  `translateZ(${lift.toFixed(2)}px) rotateY(${angle.toFixed(2)}deg)`;

// A band of light sweeps across whichever face is showing, and the face dims as it turns away.
function paintLight(
  sin: number,
  bands: (HTMLDivElement | null)[],
  shades: (HTMLDivElement | null)[],
) {
  const turn = Math.abs(sin);
  const transform = `translateX(${(sin * 140).toFixed(1)}%) rotate(18deg)`;
  for (const band of bands) {
    if (band) {
      band.style.opacity = (turn * 0.14).toFixed(3);
      band.style.transform = transform;
    }
  }
  for (const shade of shades) {
    if (shade) shade.style.opacity = (turn * 0.16).toFixed(3);
  }
}

function releaseVelocity(samples: Sim['samples'], now: number) {
  const last = samples[samples.length - 1];
  if (!last || now - last.t > VELOCITY_WINDOW) return 0;
  const first = samples.find((sample) => last.t - sample.t <= VELOCITY_WINDOW);
  if (!first || last.t <= first.t) return 0;
  return ((last.a - first.a) / (last.t - first.t)) * 1000;
}

/**
 * A card with two faces that turns over: drag or flick it sideways, tap it, press Enter or Space,
 * or use the caller's own button. The face turned away is inert, so neither keyboard nor screen
 * reader can reach it.
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
  // Which face is turned toward the viewer right now (changes at 90°).
  const [backVisible, setBackVisible] = useState(flipped);
  const [request, setRequest] = useState(0);
  const hintId = useId();

  const rootRef = useRef<HTMLDivElement>(null);
  const tiltRef = useRef<HTMLDivElement>(null);
  const cardRef = useRef<HTMLDivElement>(null);
  const shadowRef = useRef<HTMLDivElement>(null);
  const frontBandRef = useRef<HTMLDivElement>(null);
  const backBandRef = useRef<HTMLDivElement>(null);
  const frontShadeRef = useRef<HTMLDivElement>(null);
  const backShadeRef = useRef<HTMLDivElement>(null);

  // Styles React writes once; the spring owns them after that.
  const [initial] = useState(() => {
    const angle = flipped ? 180 : 0;
    return { angle, card: { transform: cardTransform(angle, 0) } };
  });

  const sim = useRef<Sim>({
    angle: initial.angle,
    velocity: 0,
    target: initial.angle,
    raf: 0,
    last: 0,
    reduceMotion: false,
    pointerId: null,
    startX: 0,
    startAngle: 0,
    dragging: false,
    samples: [],
  });

  const latest = useRef({ flipped, onFlippedChange });
  useEffect(() => {
    latest.current = { flipped, onFlippedChange };
  });
  const backVisibleRef = useRef(backVisible);

  const render = useCallback(() => {
    const s = sim.current;
    const rad = (s.angle * Math.PI) / 180;
    const sin = Math.sin(rad);
    const turn = Math.abs(sin);
    const facing = Math.abs(Math.cos(rad));
    if (cardRef.current) cardRef.current.style.transform = cardTransform(s.angle, turn * LIFT);
    if (shadowRef.current) {
      shadowRef.current.style.transform = `scale(${(0.16 + 0.84 * facing).toFixed(3)}, ${(1 - turn * 0.12).toFixed(3)})`;
      shadowRef.current.style.opacity = (1 - turn * 0.45).toFixed(3);
    }
    paintLight(
      sin,
      [frontBandRef.current, backBandRef.current],
      [frontShadeRef.current, backShadeRef.current],
    );
    const showsBack = sideOf(s.angle);
    if (showsBack !== backVisibleRef.current) {
      backVisibleRef.current = showsBack;
      setBackVisible(showsBack);
    }
  }, []);

  // The frame loop calls itself through a ref, which always holds the latest step.
  const stepRef = useRef<(now: number) => void>(() => undefined);
  const step = useCallback(
    (now: number) => {
      const s = sim.current;
      const dt = Math.min(0.05, (now - s.last) / 1000);
      s.last = now;
      const substeps = Math.max(1, Math.ceil(dt / SUBSTEP));
      const h = dt / substeps;
      for (let index = 0; index < substeps; index++) {
        const force = -STIFFNESS * (s.angle - s.target) - DAMPING * s.velocity;
        s.velocity += force * h;
        s.angle += s.velocity * h;
      }
      if (Math.abs(s.angle - s.target) < 0.05 && Math.abs(s.velocity) < 0.5) {
        // Settled: park on 0 or 180 so the numbers never grow, then sleep.
        s.target = sideOf(s.target) ? 180 : 0;
        s.angle = s.target;
        s.velocity = 0;
        s.raf = 0;
        render();
        return;
      }
      render();
      s.raf = requestAnimationFrame(stepRef.current);
    },
    [render],
  );

  useEffect(() => {
    stepRef.current = step;
  }, [step]);

  const settle = useCallback(() => {
    const s = sim.current;
    if (s.reduceMotion) {
      cancelAnimationFrame(s.raf);
      s.raf = 0;
      s.target = sideOf(s.target) ? 180 : 0;
      s.angle = s.target;
      s.velocity = 0;
      render();
      return;
    }
    if (!s.raf) {
      s.last = performance.now();
      s.raf = requestAnimationFrame(step);
    }
  }, [render, step]);

  // Point the spring at a face and report a side change.
  const aim = useCallback(
    (target: number) => {
      sim.current.target = target;
      const next = sideOf(target);
      if (next !== latest.current.flipped) {
        setRequest((count) => count + 1);
        latest.current.onFlippedChange(next);
      }
      settle();
    },
    [settle],
  );

  const flipBy = useCallback(
    (direction: number) => {
      aim(nearestFace(sim.current.target) + 180 * direction);
    },
    [aim],
  );

  useEffect(() => {
    const s = sim.current;
    const query = window.matchMedia('(prefers-reduced-motion: reduce)');
    s.reduceMotion = query.matches;
    const onChange = () => {
      s.reduceMotion = query.matches;
    };
    query.addEventListener('change', onChange);
    return () => {
      query.removeEventListener('change', onChange);
      cancelAnimationFrame(s.raf);
      s.raf = 0;
    };
  }, []);

  // Follow the prop when it disagrees with where the card lands, swinging back the way it came.
  useEffect(() => {
    if (request < 0) return;
    const s = sim.current;
    if (s.dragging || sideOf(s.target) === flipped) return;
    const face = nearestFace(s.angle);
    s.target = sideOf(face) === flipped ? face : face + (s.angle < face ? -180 : 180);
    settle();
  }, [flipped, request, settle]);

  const setTilt = (x: number, y: number) => {
    if (tiltRef.current) {
      tiltRef.current.style.transform = `rotateX(${(-y * TILT).toFixed(2)}deg) rotateY(${(x * TILT).toFixed(2)}deg)`;
    }
  };

  const onPointerDown = (event: PointerEvent<HTMLDivElement>) => {
    const s = sim.current;
    if (
      s.pointerId !== null ||
      event.button !== 0 ||
      (event.target instanceof Element && event.target.closest(INTERACTIVE) !== null)
    ) {
      return;
    }
    s.pointerId = event.pointerId;
    s.startX = event.clientX;
    s.startAngle = s.angle;
    s.dragging = false;
    s.samples = [{ t: event.timeStamp, a: s.angle }];
    event.currentTarget.setPointerCapture(event.pointerId);
  };

  const onPointerMove = (event: PointerEvent<HTMLDivElement>) => {
    const s = sim.current;
    if (s.pointerId !== event.pointerId) {
      // The tilt follows a mouse: it is movement, so reduced motion skips it.
      if (event.pointerType !== 'mouse' || s.reduceMotion || !rootRef.current) return;
      const box = rootRef.current.getBoundingClientRect();
      setTilt(
        ((event.clientX - box.left) / box.width) * 2 - 1,
        ((event.clientY - box.top) / box.height) * 2 - 1,
      );
      return;
    }
    const dx = event.clientX - s.startX;
    if (!s.dragging) {
      if (Math.abs(dx) < DRAG_SLOP) return;
      s.dragging = true;
      cancelAnimationFrame(s.raf);
      s.raf = 0;
      s.velocity = 0;
      setTilt(0, 0);
    }
    // One to one: the card stays under the finger.
    s.angle = s.startAngle + dx * DEG_PER_PX;
    s.samples.push({ t: event.timeStamp, a: s.angle });
    if (s.samples.length > 8) s.samples.shift();
    render();
  };

  const release = (event: PointerEvent<HTMLDivElement>, cancelled: boolean) => {
    const s = sim.current;
    if (s.pointerId !== event.pointerId) return;
    s.pointerId = null;
    if (!s.dragging) {
      if (!cancelled) {
        // A tap pushes the half you pressed away from you.
        const box = event.currentTarget.getBoundingClientRect();
        flipBy(event.clientX > box.left + box.width / 2 ? 1 : -1);
      }
      return;
    }
    s.dragging = false;
    const velocity = cancelled ? 0 : releaseVelocity(s.samples, event.timeStamp);
    const from = nearestFace(s.startAngle);
    let target = nearestFace(s.angle + velocity * PROJECTION);
    if (Math.abs(velocity) > FLICK_SPEED && target === from) {
      target = from + 180 * Math.sign(velocity);
    }
    const limit = MAX_HALF_TURNS * 180;
    s.velocity = velocity;
    aim(Math.max(from - limit, Math.min(from + limit, target)));
  };

  const face = 'absolute inset-0 overflow-hidden rounded-[26px] backface-hidden';

  return (
    <div
      ref={rootRef}
      role="group"
      aria-label={label}
      aria-describedby={hintId}
      aria-roledescription="ficha que se da la vuelta"
      tabIndex={0}
      className={cn(
        'group/flick relative touch-pan-y rounded-[26px] select-none perspective-[1100px]',
        className,
      )}
      onKeyDown={(event) => {
        if (event.target !== event.currentTarget) return;
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          flipBy(1);
        }
      }}
      onLostPointerCapture={(event) => {
        release(event, true);
      }}
      onPointerCancel={(event) => {
        release(event, true);
      }}
      onPointerDown={onPointerDown}
      onPointerLeave={() => {
        if (sim.current.pointerId === null) setTilt(0, 0);
      }}
      onPointerMove={onPointerMove}
      onPointerUp={(event) => {
        release(event, false);
      }}
    >
      {/* Floor shadow: narrows and fades as the card turns edge-on. */}
      <div
        aria-hidden
        ref={shadowRef}
        className="pointer-events-none absolute inset-x-[8%] -bottom-5 h-5 rounded-[50%] bg-black/30 blur-md"
      />
      <div
        ref={tiltRef}
        className="preserve-3d relative h-full w-full transition-transform duration-500 ease-[cubic-bezier(0.23,1,0.32,1)]"
      >
        <div
          ref={cardRef}
          className="preserve-3d relative h-full w-full cursor-grab rounded-[26px] group-active/flick:cursor-grabbing"
          style={initial.card}
        >
          {/* The edge: thin slices stacked between the two faces. */}
          {SLICE_DEPTHS.map((z) => (
            <div
              aria-hidden
              key={z}
              className="absolute inset-0 rounded-[26px] bg-[var(--track)]"
              style={{ transform: `translateZ(${z.toFixed(3)}px)` }}
            />
          ))}
          <div
            className={face}
            inert={backVisible}
            aria-hidden={backVisible || undefined}
            style={{ transform: `translateZ(${String(THICKNESS / 2)}px)` }}
          >
            {front}
            <LightBand bandRef={frontBandRef} shadeRef={frontShadeRef} />
          </div>
          <div
            className={face}
            inert={!backVisible}
            aria-hidden={!backVisible || undefined}
            style={{ transform: `rotateY(180deg) translateZ(${String(THICKNESS / 2)}px)` }}
          >
            {back}
            <LightBand bandRef={backBandRef} shadeRef={backShadeRef} />
          </div>
        </div>
      </div>
      <span className="sr-only" id={hintId}>
        Muestra {flipped ? 'lo que esconde' : 'sus números'}. Pulsa Intro o Espacio, o arrástrala,
        para darle la vuelta.
      </span>
    </div>
  );
}

function LightBand({
  bandRef,
  shadeRef,
}: {
  readonly bandRef: Ref<HTMLDivElement>;
  readonly shadeRef: Ref<HTMLDivElement>;
}) {
  return (
    <div
      aria-hidden
      className="pointer-events-none absolute inset-0 flex items-center justify-center"
    >
      <div ref={shadeRef} className="absolute inset-0 bg-black opacity-0" />
      <div ref={bandRef} className="h-[220%] w-1/3 shrink-0 bg-white opacity-0" />
    </div>
  );
}
