import { useId } from 'react';

import type { Seat } from './seat.ts';

// Ported from the canvas "Cronista: diseño v1" (Mascota). Each seat is a frosted cloud hood on a
// coloured tile, with two glowing slits in its colour; the fifth seat has one eye.
interface HoodTile {
  readonly a: string;
  readonly m: string;
  readonly b: string;
  readonly cloudMid: string;
  readonly cloudBottom: string;
  readonly shadow: string;
  readonly deep: string;
  readonly light: string;
  readonly eyeLeft: string;
  readonly eyeRight: string | null;
}

const slyLeft = 'M 40 73 Q 48 68 56 75 Q 48 78 40 73 Z';
const slyRight = 'M 80 73 Q 72 68 64 75 Q 72 78 80 73 Z';

const tiles: Readonly<Record<Seat, HoodTile>> = {
  0: {
    a: '#fff25c',
    m: '#c9f18e',
    b: '#86cfff',
    cloudMid: '#fbfdf2',
    cloudBottom: '#e3f3d9',
    shadow: '#5a7a3a',
    deep: '#1d2b14',
    light: '#fff3a6',
    eyeLeft: slyLeft,
    eyeRight: slyRight,
  },
  1: {
    a: '#0794ff',
    m: '#3fb0ff',
    b: '#a6d4ff',
    cloudMid: '#eaf6ff',
    cloudBottom: '#a9d6ff',
    shadow: '#0b4a8f',
    deep: '#07182f',
    light: '#c4ecff',
    eyeLeft: slyLeft,
    eyeRight: 'M 80 70 Q 72 68 64 72.5 Q 72 74.5 80 70 Z',
  },
  2: {
    a: '#a6f7d7',
    m: '#53dbaa',
    b: '#0fa77b',
    cloudMid: '#f0fff8',
    cloudBottom: '#bff0dc',
    shadow: '#0b6a4c',
    deep: '#05241b',
    light: '#b6ffd6',
    eyeLeft: 'M 41 76 Q 48.5 69 56 76 Q 48.5 73.5 41 76 Z',
    eyeRight: 'M 64 76 Q 71.5 69 79 76 Q 71.5 73.5 64 76 Z',
  },
  3: {
    a: '#d2c8ff',
    m: '#9a8ff2',
    b: '#6a5fe0',
    cloudMid: '#f1eeff',
    cloudBottom: '#cbc4f6',
    shadow: '#2b2580',
    deep: '#0b0926',
    light: '#e6dfff',
    eyeLeft: 'M 40 75 L 56 75.5 Q 48 79.5 40 75 Z',
    eyeRight: 'M 64 75.5 L 80 75 Q 72 79.5 64 75.5 Z',
  },
  4: {
    a: '#ffd18a',
    m: '#ff8a4a',
    b: '#f44612',
    cloudMid: '#fff5ee',
    cloudBottom: '#ffd5bf',
    shadow: '#8a2a08',
    deep: '#230b03',
    light: '#ffd27a',
    eyeLeft: slyLeft,
    eyeRight: null,
  },
};

/** The narrator's flame-headed mask: the head, the four-point-star eyes and the teeth, one path. */
export const NARRATOR_MASK_PATH =
  'M 22 58 C 18 46 22 34 30 24 C 30 32 33 37 37 34 C 37 24 42 12 48 2 C 49 14 52 22 56 28 C 59 22 61 15 59 7 C 68 16 73 28 71 38 C 75 34 77 30 77 24 C 84 33 84 46 78 56 L 86 76 L 80 86 L 72 90 L 64 106 L 40 108 L 31 94 L 22 90 L 14 77 Z M 34 30 C 31 37 32 45 37 46 C 41 46 42 41 39 36 Z M 50 16 C 46 28 46 46 49 58 C 50 61 52 61 52 57 C 54 46 54 28 50 16 Z M 61 30 C 59 37 60 45 64 46 C 68 45 67 38 64 33 Z M 44 48 C 43 51 44 53 46 53 C 47 52 46 50 44 48 Z M 34 64 Q 35.4 74.6 47 76 Q 35.4 77.4 34 92 Q 32.6 77.4 22 76 Q 32.6 74.6 34 64 Z M 66 64 Q 67.4 74.6 78 76 Q 67.4 77.4 66 92 Q 64.6 77.4 53 76 Q 64.6 74.6 66 64 Z M 50 84 L 47.6 89 L 52.4 89 Z M 41 95 L 43.5 108 L 46 95 Z M 54 95 L 56.5 108 L 59 95 Z';

/** SVG ids from React's useId, which may hold characters a `url(#…)` reference would break on. */
export function useSvgId(): (name: string) => string {
  const base = useId().replace(/[^a-zA-Z0-9-]/g, '');
  return (name) => `${name}-${base}`;
}

/**
 * A character's mascot by seat, or the narrator's mask. With a label it is an image with that
 * name; without one it is decoration, hidden from screen readers.
 */
export function Mascot({
  who,
  size,
  label,
  className,
}: {
  readonly who: Seat | 'narrator';
  readonly size: number;
  readonly label?: string;
  readonly className?: string;
}) {
  const id = useSvgId();
  const a11y =
    label === undefined
      ? ({ 'aria-hidden': true } as const)
      : ({ role: 'img', 'aria-label': label } as const);

  return (
    <svg
      {...a11y}
      width={size}
      height={size}
      viewBox="0 0 120 120"
      className={className}
      style={{ flexShrink: 0, display: 'block' }}
    >
      <defs>
        <clipPath id={id('clip')}>
          <rect x="4" y="4" width="112" height="112" rx="30" />
        </clipPath>
      </defs>
      <ellipse cx="60" cy="117" rx="42" ry="3" fill="#000000" fillOpacity="0.12" />
      {who === 'narrator' ? <NarratorTile id={id} /> : <HoodedTile tile={tiles[who]} id={id} />}
    </svg>
  );
}

function HoodedTile({
  tile,
  id,
}: {
  readonly tile: HoodTile;
  readonly id: (name: string) => string;
}) {
  const hole = 'M 32 68 C 32 46 88 46 88 68 C 88 94 74 106 60 106 C 46 106 32 94 32 68 Z';
  const eye = (path: string) => (
    <>
      <path d={path} fill={tile.light} filter={`url(#${id('halo')})`} />
      <path d={path} fill={tile.light} />
      <path d={path} fill="#ffffff" fillOpacity="0.55" transform="translate(0 -0.6)" />
    </>
  );
  return (
    <>
      <defs>
        <linearGradient id={id('tile')} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor={tile.a} />
          <stop offset="0.55" stopColor={tile.m} />
          <stop offset="1" stopColor={tile.b} />
        </linearGradient>
        <linearGradient id={id('cloud')} x1="0.2" y1="0" x2="0.5" y2="1">
          <stop offset="0" stopColor="#ffffff" />
          <stop offset="0.45" stopColor={tile.cloudMid} />
          <stop offset="1" stopColor={tile.cloudBottom} />
        </linearGradient>
        <radialGradient id={id('hole')} cx="0.5" cy="0.42" r="0.62">
          <stop offset="0" stopColor={tile.deep} />
          <stop offset="0.72" stopColor={tile.deep} stopOpacity="0.94" />
          <stop offset="1" stopColor={tile.shadow} stopOpacity="0.55" />
        </radialGradient>
        <filter id={id('soft')} x="-20%" y="-20%" width="140%" height="140%">
          <feGaussianBlur stdDeviation="1.4" />
        </filter>
        <filter id={id('glow')} x="-80%" y="-80%" width="260%" height="260%">
          <feGaussianBlur stdDeviation="6" />
        </filter>
        <filter id={id('halo')} x="-60%" y="-60%" width="220%" height="220%">
          <feGaussianBlur stdDeviation="2.2" />
        </filter>
      </defs>
      <g clipPath={`url(#${id('clip')})`}>
        <rect x="0" y="0" width="120" height="120" fill={`url(#${id('tile')})`} />
        <g filter={`url(#${id('soft')})`} fill={`url(#${id('cloud')})`} fillOpacity="0.95">
          <path d="M 2 124 C 0 76 20 30 60 24 C 100 30 120 76 118 124 Z" />
          <circle cx="34" cy="42" r="18" />
          <circle cx="60" cy="30" r="20" />
          <circle cx="86" cy="42" r="18" />
        </g>
        <g filter={`url(#${id('glow')})`} fill="#ffffff" fillOpacity="0.75">
          <ellipse cx="50" cy="26" rx="16" ry="6" />
        </g>
        <path
          d={hole}
          fill={tile.shadow}
          fillOpacity="0.35"
          filter={`url(#${id('halo')})`}
          transform="translate(0 -1.5)"
        />
        <path d={hole} fill={`url(#${id('hole')})`} />
        {eye(tile.eyeLeft)}
        {tile.eyeRight === null ? (
          <path
            d="M 64 74 L 80 74"
            stroke={tile.shadow}
            strokeOpacity="0.9"
            strokeWidth="2"
            strokeLinecap="round"
          />
        ) : (
          eye(tile.eyeRight)
        )}
      </g>
      <rect
        x="4.75"
        y="4.75"
        width="110.5"
        height="110.5"
        rx="29.25"
        fill="none"
        stroke="#ffffff"
        strokeOpacity="0.3"
        strokeWidth="1.2"
      />
    </>
  );
}

function NarratorTile({ id }: { readonly id: (name: string) => string }) {
  return (
    <>
      <defs>
        <linearGradient id={id('night')} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#4a4752" />
          <stop offset="0.5" stopColor="#1f1d24" />
          <stop offset="1" stopColor="#0b0a0e" />
        </linearGradient>
        <filter id={id('ember')} x="-80%" y="-80%" width="260%" height="260%">
          <feGaussianBlur stdDeviation="6" />
        </filter>
        <filter id={id('rough')} x="-5%" y="-5%" width="110%" height="110%">
          <feTurbulence
            type="fractalNoise"
            baseFrequency="0.7"
            numOctaves="2"
            seed="5"
            result="n"
          />
          <feDisplacementMap
            in="SourceGraphic"
            in2="n"
            scale="1.6"
            xChannelSelector="R"
            yChannelSelector="G"
          />
        </filter>
        <filter id={id('fire')} x="-60%" y="-60%" width="220%" height="220%">
          <feGaussianBlur stdDeviation="2.6" />
        </filter>
        <linearGradient id={id('bone')} x1="0.2" y1="0" x2="0.6" y2="1">
          <stop offset="0" stopColor="#ffffff" />
          <stop offset="0.6" stopColor="#f1ece3" />
          <stop offset="1" stopColor="#d9cfc0" />
        </linearGradient>
      </defs>
      <g clipPath={`url(#${id('clip')})`}>
        <rect width="120" height="120" fill={`url(#${id('night')})`} />
        <circle
          cx="60"
          cy="96"
          r="38"
          fill="#f44612"
          opacity="0.28"
          filter={`url(#${id('ember')})`}
        />
        <g transform="translate(17 10) scale(0.86)">
          <g fill="#ff7a2b" filter={`url(#${id('fire')})`} opacity="0.95">
            <ellipse cx="34" cy="77" rx="8" ry="9" />
            <ellipse cx="66" cy="77" rx="8" ry="9" />
            <ellipse cx="50" cy="38" rx="9" ry="16" opacity="0.6" />
          </g>
          <path
            d={NARRATOR_MASK_PATH}
            fill={`url(#${id('bone')})`}
            fillRule="evenodd"
            filter={`url(#${id('rough')})`}
          />
        </g>
        <g filter={`url(#${id('ember')})`} fill="#ffffff" fillOpacity="0.3">
          <ellipse cx="40" cy="12" rx="26" ry="6" />
        </g>
      </g>
      <rect
        x="4.75"
        y="4.75"
        width="110.5"
        height="110.5"
        rx="29.25"
        fill="none"
        stroke="#ffffff"
        strokeOpacity="0.22"
        strokeWidth="1.2"
      />
    </>
  );
}
