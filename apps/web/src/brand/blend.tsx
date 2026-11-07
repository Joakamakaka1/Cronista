import { useTheme } from '../theme/theme.ts';
import { useSvgId } from './mascot.tsx';

// Ported from the canvas "Cronista: diseño v1" (Mezcla): grainy brush strokes, colour blooms, pencil
// doodles and sparkles, all inline SVG filters, so nothing breaks `style-src 'self'`.
const palettes = {
  dark: {
    c1: '#f44612',
    c2: '#ff3d7f',
    c3: '#6b3cff',
    c4: '#ffc93a',
    c5: '#ff9ad5',
    c6: '#36b8a6',
    c7: '#7cb6ff',
  },
  light: {
    c1: '#ff9a72',
    c2: '#ffaf98',
    c3: '#a9c2f5',
    c4: '#f8d470',
    c5: '#f2a1c2',
    c6: '#7fc8b2',
    c7: '#c4b2f4',
  },
} as const;

const turns = {
  1: 'none',
  2: 'translate(390 0) scale(-1 1)',
  3: 'translate(390 40) scale(-1 1) rotate(14 195 215)',
} as const;

const ribbon =
  'M -10 210 C 90 150, 210 260, 300 150 C 360 76, 330 30, 280 50 C 236 68, 260 150, 330 168 C 370 178, 400 160, 420 150';

/**
 * The painterly blend behind a header: soft and pastel on paper, at full strength at night. It
 * fills its box from the top and fades out downwards. It stays still. Decoration only.
 */
export function Blend({
  variant,
  className,
}: {
  readonly variant: 1 | 2 | 3;
  readonly className?: string;
}) {
  const [theme] = useTheme();
  const id = useSvgId();
  const dark = theme === 'dark';
  const p = palettes[theme];
  const url = (name: string) => `url(#${id(name)})`;

  return (
    <svg
      aria-hidden
      className={className}
      viewBox="0 0 390 430"
      preserveAspectRatio="xMidYMin slice"
      style={{ display: 'block', pointerEvents: 'none' }}
    >
      <defs>
        <filter id={id('brush')} x="-20%" y="-30%" width="140%" height="160%">
          <feTurbulence
            type="fractalNoise"
            baseFrequency="0.011 0.11"
            numOctaves="3"
            seed={variant * 5 + 2}
            result="streak"
          />
          <feDisplacementMap
            in="SourceGraphic"
            in2="streak"
            scale="30"
            xChannelSelector="R"
            yChannelSelector="G"
            result="moved"
          />
          <feTurbulence
            type="fractalNoise"
            baseFrequency="0.85"
            numOctaves="2"
            seed="7"
            result="dust"
          />
          <feColorMatrix
            in="dust"
            type="matrix"
            values="0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  3.2 0 0 0 -0.75"
            result="mask"
          />
          <feComposite in="moved" in2="mask" operator="in" />
        </filter>
        <filter id={id('spray')} x="-40%" y="-40%" width="180%" height="180%">
          <feGaussianBlur stdDeviation="9" result="soft" />
          <feTurbulence
            type="fractalNoise"
            baseFrequency="0.95"
            numOctaves="1"
            seed="3"
            result="dust"
          />
          <feColorMatrix
            in="dust"
            type="matrix"
            values="0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  4 0 0 0 -1.4"
            result="mask"
          />
          <feComposite in="soft" in2="mask" operator="in" />
        </filter>
        <filter id={id('bloom')} x="-60%" y="-60%" width="220%" height="220%">
          <feGaussianBlur stdDeviation="26" />
        </filter>
        <filter id={id('crayon')} x="-10%" y="-10%" width="120%" height="120%">
          <feTurbulence
            type="fractalNoise"
            baseFrequency="0.9"
            numOctaves="2"
            seed="11"
            result="n"
          />
          <feDisplacementMap
            in="SourceGraphic"
            in2="n"
            scale="2.6"
            xChannelSelector="R"
            yChannelSelector="G"
            result="moved"
          />
          <feColorMatrix
            in="n"
            type="matrix"
            values="0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  3 0 0 0 -0.6"
            result="mask"
          />
          <feComposite in="moved" in2="mask" operator="in" />
        </filter>
        <filter id={id('grain')} x="0" y="0" width="100%" height="100%">
          <feTurbulence
            type="fractalNoise"
            baseFrequency="0.95"
            numOctaves="2"
            stitchTiles="stitch"
          />
          <feColorMatrix type="saturate" values="0" />
          <feComponentTransfer>
            <feFuncA type="table" tableValues={dark ? '0 0.32' : '0 0.26'} />
          </feComponentTransfer>
        </filter>
        <linearGradient id={id('sweep1')} x1="0" y1="0" x2="1" y2="0">
          <stop offset="0" stopColor={p.c4} />
          <stop offset="0.35" stopColor={p.c1} />
          <stop offset="0.7" stopColor={p.c2} />
          <stop offset="1" stopColor={p.c3} />
        </linearGradient>
        <linearGradient id={id('sweep2')} x1="0" y1="0" x2="1" y2="0">
          <stop offset="0" stopColor={p.c7} />
          <stop offset="0.5" stopColor={p.c3} />
          <stop offset="1" stopColor={p.c5} />
        </linearGradient>
        <linearGradient id={id('fadeGradient')} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#ffffff" />
          <stop offset={dark ? '0.55' : '0.5'} stopColor="#ffffff" />
          <stop offset="1" stopColor="#ffffff" stopOpacity="0" />
        </linearGradient>
        <mask id={id('fade')}>
          <rect width="390" height="430" fill={url('fadeGradient')} />
        </mask>
      </defs>
      <g mask={url('fade')} opacity={dark ? 1 : 0.82}>
        <g transform={turns[variant]}>
          <ellipse
            cx="300"
            cy="70"
            rx="120"
            ry="70"
            fill={p.c3}
            filter={url('bloom')}
            opacity="0.85"
          />
          <ellipse
            cx="70"
            cy="250"
            rx="90"
            ry="60"
            fill={p.c7}
            filter={url('bloom')}
            opacity="0.7"
          />
          <ellipse
            cx="220"
            cy="190"
            rx="70"
            ry="40"
            fill={p.c5}
            filter={url('bloom')}
            opacity="0.6"
          />

          <path
            d="M -40 300 C 60 250, 150 230, 240 150 S 380 40, 450 30"
            fill="none"
            stroke={url('sweep1')}
            strokeWidth="74"
            strokeLinecap="round"
            filter={url('brush')}
          />
          <path
            d="M -30 360 C 80 330, 200 300, 300 220 S 400 150, 440 140"
            fill="none"
            stroke={url('sweep2')}
            strokeWidth="34"
            strokeLinecap="round"
            filter={url('brush')}
            opacity="0.9"
          />
          <path
            d="M 120 120 C 180 80, 250 110, 330 70"
            fill="none"
            stroke={p.c4}
            strokeWidth="16"
            strokeLinecap="round"
            filter={url('brush')}
            opacity="0.8"
          />

          <circle cx="330" cy="200" r="46" fill={p.c2} filter={url('spray')} />
          <circle cx="96" cy="120" r="34" fill={p.c6} filter={url('spray')} opacity="0.9" />

          {dark && (
            <>
              <path
                d="M 250 260 C 236 214, 282 186, 318 204 C 352 222, 360 272, 330 300 C 300 326, 262 306, 250 260 Z"
                fill="#0c0b0f"
              />
              <path
                d="M 330 18 C 352 2, 392 10, 400 34 C 404 56, 380 70, 356 62 C 334 54, 316 34, 330 18 Z"
                fill="#0c0b0f"
              />
            </>
          )}

          <path
            d={ribbon}
            fill="none"
            stroke="#ffffff"
            strokeOpacity={dark ? 0.14 : 0.35}
            strokeWidth="10"
            strokeLinecap="round"
          />
          <path
            d={ribbon}
            fill="none"
            stroke="#ffffff"
            strokeOpacity={dark ? 0.75 : 0.9}
            strokeWidth="2.4"
            strokeLinecap="round"
          />

          <g filter={url('crayon')} fill="none" strokeLinecap="round" strokeLinejoin="round">
            <path
              d="M 150 64 C 140 44, 166 36, 168 58 C 178 40, 200 52, 180 66 C 202 70, 196 94, 176 82 C 180 104, 156 104, 160 84 C 142 98, 128 78, 150 70 Z M 168 84 C 170 110, 160 140, 164 170"
              stroke={p.c6}
              strokeWidth="2"
            />
            <path
              d="M 40 40 C 90 10, 140 60, 110 90 C 86 112, 60 80, 90 66 C 130 50, 190 40, 220 10"
              stroke={p.c3}
              strokeWidth="1.8"
            />
            <ellipse
              cx="230"
              cy="330"
              rx="120"
              ry="22"
              stroke={p.c6}
              strokeWidth="1.6"
              transform="rotate(-8 230 330)"
            />
          </g>

          <path
            d="M 96 236 Q 99 262 126 266 Q 99 270 96 296 Q 93 270 66 266 Q 93 262 96 236 Z"
            fill={p.c5}
          />
          <path
            d="M 352 112 Q 353.6 124 366 126 Q 353.6 128 352 140 Q 350.4 128 338 126 Q 350.4 124 352 112 Z"
            fill={p.c5}
            opacity="0.9"
          />
          <path
            d="M 206 36 Q 207 44 215 45 Q 207 46 206 54 Q 205 46 197 45 Q 205 44 206 36 Z"
            fill={p.c4}
          />
        </g>
        <rect width="390" height="430" filter={url('grain')} fill={dark ? '#ffffff' : '#000000'} />
      </g>
    </svg>
  );
}
