// Adapted from React Bits' "CountUp" (TS + Tailwind), https://reactbits.dev/r/CountUp-TS-TW.json.
// MIT + Commons Clause: see LICENSE-react-bits.txt. Part of this application only, never redistributed.
// Changes: whole numbers only, always the "roll" mode with the spring easing, no compact format,
// separator, prefix or hover replay; digits centred in their column, for fonts without tabular
// figures; the typographic minus; it rolls again from the last shown value when the value changes,
// and lands at once under reduced motion.
import { animate, useInView } from 'motion/react';
import { useEffect, useId, useMemo, useRef, useState } from 'react';

const CELL = 1.2;
const STAGGER = 0.07;
const MINUS = '−';

interface Column {
  readonly slot: number;
  readonly index: number;
  readonly place: number;
  readonly from: number;
  readonly to: number;
  readonly enter: boolean;
  readonly leave: boolean;
  delta: number;
}

interface Mark {
  readonly char: string;
  readonly enter?: boolean;
  readonly leave?: boolean;
}

type Slot = Column | Mark;

const clamp01 = (value: number) => Math.min(1, Math.max(0, value));
const smooth = (edge0: number, edge1: number, value: number) => {
  const t = clamp01((value - edge0) / (edge1 - edge0));
  return t * t * (3 - 2 * t);
};
const mod10 = (value: number) => ((value % 10) + 10) % 10;

// An easing that overshoots a little and settles, like a spring, ending exactly at 1.
const makeSpring = (overshoot: number) => {
  const log = Math.log(Math.min(0.5, Math.max(0.001, overshoot)));
  const zeta = -log / Math.sqrt(Math.PI * Math.PI + log * log);
  const damped = Math.PI / 0.52;
  const natural = damped / Math.sqrt(1 - zeta * zeta);
  const raw = (t: number) =>
    1 -
    Math.exp(-zeta * natural * t) *
      (Math.cos(damped * t) + ((zeta * natural) / damped) * Math.sin(damped * t));
  const residual = 1 - raw(1);
  return (t: number) => (t >= 1 ? 1 : raw(t) + residual * t * t * t);
};

// The digit columns that roll from `a` to `b`, and the minus sign that comes or goes.
function buildRoll(a: number, b: number) {
  const digitsOf = (value: number) => String(Math.abs(Math.round(value)));
  const da = digitsOf(a);
  const db = digitsOf(b);
  const length = Math.max(da.length, db.length);
  const slots: Slot[] = [];
  const columns: Column[] = [];
  if (a < 0 || b < 0) slots.push({ char: MINUS, enter: a >= 0, leave: b >= 0 });
  const digitAt = (digits: string, place: number) => {
    const index = digits.length - 1 - place;
    return index >= 0 ? Number(digits[index]) : null;
  };
  for (let place = length - 1; place >= 0; place--) {
    const start = digitAt(da, place);
    const end = digitAt(db, place);
    const column: Column = {
      slot: slots.length,
      index: columns.length,
      place,
      from: start ?? 0,
      to: end ?? 0,
      enter: start === null,
      leave: end === null,
      delta: 0,
    };
    slots.push(column);
    columns.push(column);
  }
  const up = b >= a;
  columns.forEach((column, index) => {
    const rank = columns.length - 1 - index;
    const base = up ? mod10(column.to - column.from) : -mod10(column.from - column.to);
    const turns = Math.min(
      Math.floor(Math.abs(b - a) / 10 ** (column.place + 1)),
      Math.max(0, 3 - rank),
    );
    column.delta = base + (up ? 10 : -10) * turns;
  });
  return { slots, columns };
}

/**
 * A whole number whose digits roll like a slot machine to their value when it comes into view,
 * blurring as they spin. Screen readers and copies get the value itself.
 */
export function CountUp({
  value,
  duration = 1.4,
  className,
}: {
  readonly value: number;
  readonly duration?: number;
  readonly className?: string;
}) {
  const ref = useRef<HTMLSpanElement>(null);
  const slotRefs = useRef<(HTMLSpanElement | null)[]>([]);
  const filterRefs = useRef<(SVGFEGaussianBlurElement | null)[]>([]);
  const uid = useId().replace(/[^\w-]/g, '');
  const shown = useRef(0);
  const inView = useInView(ref, { once: true });
  const [play, setPlay] = useState<{
    readonly id: number;
    readonly from: number;
    readonly to: number;
  } | null>(null);

  useEffect(() => {
    if (!inView) return;
    setPlay((previous) => ({ id: (previous?.id ?? 0) + 1, from: shown.current, to: value }));
  }, [inView, value]);

  const model = useMemo(() => buildRoll(play?.from ?? 0, play?.to ?? 0), [play]);

  useEffect(() => {
    if (play === null || ref.current === null) return undefined;
    const fontSize = Number.parseFloat(getComputedStyle(ref.current).fontSize) || 16;
    const cell = CELL * fontSize;
    const total = duration;
    const stagger =
      model.columns.length > 1 ? Math.min(STAGGER, (total * 0.4) / (model.columns.length - 1)) : 0;
    const span = Math.max(0.001, total - stagger * (model.columns.length - 1));
    const columns = model.columns.map((column) => {
      const box = slotRefs.current[column.slot] ?? null;
      const strip = box?.firstElementChild instanceof HTMLElement ? box.firstElementChild : null;
      return {
        ...column,
        box,
        strip,
        blur: filterRefs.current[column.index] ?? null,
        cells: strip === null ? [] : Array.from(strip.children, (child) => child.firstChild),
        width: box?.scrollWidth ?? 0,
        ease: makeSpring(
          Math.min(0.12, Math.max(0.01, 0.35 / Math.max(1, Math.abs(column.delta)))),
        ),
        base: Math.floor(column.from),
        sigma: 0,
        presence: column.enter ? 0 : 1,
      };
    });
    const marks = model.slots.flatMap((slot, index) => {
      const node = slotRefs.current[index];
      return 'char' in slot && node && (slot.enter === true || slot.leave === true)
        ? [{ ...slot, node, width: node.scrollWidth }]
        : [];
    });
    const fade = (
      node: HTMLSpanElement | null,
      width: number,
      presence: number,
      settled: boolean,
    ) => {
      if (node === null) return;
      node.style.width = settled ? '' : `${(presence * width).toFixed(2)}px`;
      node.style.opacity = settled ? '' : presence.toFixed(3);
    };

    // Written through the DOM, as the original does: no style tag, so the CSP allows it.
    const render = (t: number) => {
      columns.forEach((column, index) => {
        if (column.strip === null) return;
        const u = clamp01((t - index * stagger) / span);
        const position = column.from + column.delta * column.ease(u);
        const base = Math.floor(position);
        if (base !== column.base) {
          column.base = base;
          column.cells.forEach((node, offset) => {
            if (node) node.nodeValue = String(mod10(base + offset - 1));
          });
        }
        column.strip.style.transform = `translateY(${(-(1 + position - base) * CELL).toFixed(4)}em)`;
        const u0 = Math.max(0, u - 0.004);
        const u1 = Math.min(1, u + 0.004);
        const speed =
          u1 > u0
            ? (Math.abs(column.delta) * Math.abs(column.ease(u1) - column.ease(u0))) /
              (u1 - u0) /
              span
            : 0;
        const sigma = u > 0 && u < 1 ? Math.min(cell * 0.05, (speed * cell) / 600) : 0;
        if (Math.abs(sigma - column.sigma) > 0.05 || (sigma === 0 && column.sigma !== 0)) {
          column.sigma = sigma;
          if (sigma > 0.2 && column.blur) {
            column.blur.setAttribute('stdDeviation', `0 ${sigma.toFixed(2)}`);
            column.strip.style.filter = `url(#${uid}-${String(index)})`;
          } else {
            column.strip.style.filter = '';
          }
        }
        if (column.enter || column.leave) {
          column.presence = column.enter ? smooth(0, 0.45, u) : 1 - smooth(0.55, 1, u);
          fade(column.box, column.width, column.presence, column.enter && u >= 1);
        }
      });
      const overall = clamp01(t / total);
      shown.current = Math.round(play.from + (play.to - play.from) * overall);
      marks.forEach((mark) => {
        const presence =
          mark.enter === true ? smooth(0, 0.3, overall) : 1 - smooth(0.7, 1, overall);
        fade(mark.node, mark.width, presence, mark.enter === true && overall >= 1);
      });
    };

    const finish = () => {
      render(Number.POSITIVE_INFINITY);
      shown.current = play.to;
    };
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      finish();
      return undefined;
    }
    const controls = animate(0, total, {
      duration: total,
      ease: 'linear',
      onUpdate: render,
      onComplete: finish,
    });
    return () => {
      controls.stop();
    };
  }, [play, model, duration, uid]);

  return (
    <span ref={ref} className={`tabular-nums ${className ?? ''}`}>
      <span
        key={`roll-${String(play?.id ?? 0)}`}
        aria-hidden
        className="inline-flex whitespace-pre select-none"
      >
        {model.slots.map((slot, index) => {
          const hidden = slot.enter;
          const collapsed = hidden === true ? { width: 0, opacity: 0 } : undefined;
          if ('char' in slot) {
            return (
              <span
                key={index}
                ref={(node) => {
                  slotRefs.current[index] = node;
                }}
                className="inline-block h-[1.2em] overflow-hidden leading-[1.2em]"
                style={collapsed}
              >
                {slot.char}
              </span>
            );
          }
          return (
            <span
              key={index}
              ref={(node) => {
                slotRefs.current[index] = node;
              }}
              className="relative inline-block h-[1.2em] overflow-hidden text-center leading-[1.2em]"
              style={collapsed}
            >
              <span
                className="flex flex-col"
                style={{ transform: `translateY(${String(-CELL)}em)` }}
              >
                {[-1, 0, 1, 2].map((offset) => (
                  <span key={offset} className="h-[1.2em]">
                    {mod10(slot.from + offset)}
                  </span>
                ))}
              </span>
            </span>
          );
        })}
      </span>
      <span className="sr-only">{value < 0 ? `${MINUS}${String(-value)}` : value}</span>
      <svg aria-hidden width="0" height="0" className="absolute">
        <defs>
          {model.columns.map((column) => (
            <filter
              key={column.index}
              id={`${uid}-${String(column.index)}`}
              x="-20%"
              y="-50%"
              width="140%"
              height="200%"
              colorInterpolationFilters="sRGB"
            >
              <feGaussianBlur
                ref={(node) => {
                  filterRefs.current[column.index] = node;
                }}
                stdDeviation="0 0"
              />
            </filter>
          ))}
        </defs>
      </svg>
    </span>
  );
}
