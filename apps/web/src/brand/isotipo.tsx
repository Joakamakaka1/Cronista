import { useSvgId } from './mascot.tsx';

/** The C with a speech-bubble tail and a blade into the bowl, sharp top right. */
export const ISOTIPO_PATH =
  'M 36 4 C 24 10 18 24 18 42 C 18 62 32 76 52 76 C 68 76 82 64 86 44 Q 70 44 44 50 Q 80 34 87 2 Q 86 22 99 26 C 100 36 100 44 99 52 C 97 76 80 92 56 93 C 46 93 38 91 32 88 L 10 99 L 18 82 C 6 70 2 54 3 40 C 5 18 20 4 36 4 Z';

/** The loose star in the opening of the C. */
export const ISOTIPO_STAR_PATH =
  'M 61 4 Q 62.1 11.9 70 13 Q 62.1 14.1 61 22 Q 59.9 14.1 52 13 Q 59.9 11.9 61 4 Z';

/**
 * Cronista's isotipo, in the text colour of the mode it sits on (ink on paper, bone at night). It
 * goes beside "Cronista" in the headers, so it is decoration there.
 */
export function Isotipo({
  size,
  className,
}: {
  readonly size: number;
  readonly className?: string;
}) {
  return (
    <svg
      aria-hidden
      width={size}
      height={size}
      viewBox="0 0 100 100"
      className={className}
      style={{ flexShrink: 0, fill: 'currentColor' }}
    >
      <path d={ISOTIPO_PATH} />
      <path d={ISOTIPO_STAR_PATH} />
    </svg>
  );
}

/** The app icon: the isotipo in bone on a grainy night tile with a violet glow. */
export function IsotipoIcon({ size }: { readonly size: number }) {
  const id = useSvgId();
  return (
    <svg role="img" aria-label="Cronista" width={size} height={size} viewBox="-14 -14 128 128">
      <defs>
        <filter id={id('grain')} x="0" y="0" width="100%" height="100%">
          <feTurbulence
            type="fractalNoise"
            baseFrequency="0.9"
            numOctaves="2"
            stitchTiles="stitch"
          />
          <feColorMatrix type="saturate" values="0" />
          <feComponentTransfer>
            <feFuncA type="table" tableValues="0 0.28" />
          </feComponentTransfer>
        </filter>
        <radialGradient id={id('glow')} cx="0.3" cy="0.2" r="0.9">
          <stop offset="0" stopColor="#3a2a6e" />
          <stop offset="0.55" stopColor="#16141c" />
          <stop offset="1" stopColor="#0d0c10" />
        </radialGradient>
      </defs>
      <rect x="-14" y="-14" width="128" height="128" fill={`url(#${id('glow')})`} />
      <rect
        x="-14"
        y="-14"
        width="128"
        height="128"
        filter={`url(#${id('grain')})`}
        fill="#ffffff"
      />
      <path d={ISOTIPO_PATH} fill="#efe9e0" />
      <path d={ISOTIPO_STAR_PATH} fill="#efe9e0" />
    </svg>
  );
}
