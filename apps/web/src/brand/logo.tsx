import { motion, type TargetAndTransition, type Transition } from 'motion/react';

import { useAmbient } from '../ui/use-ambient.ts';
import { NARRATOR_MASK_PATH, useSvgId } from './mascot.tsx';

/**
 * The sign-in logo: "Cronista" in Rammetto One with an orange offset shadow, stars, the subtitle and
 * the narrator's bare silhouette. Ink on paper, bone at night, through the `--logo-*` tokens. While
 * it is on screen its stars twinkle and the embers behind the mask flicker.
 */
export function Logo({ width }: { readonly width: number }) {
  const id = useSvgId();
  const [ref, alive] = useAmbient<SVGSVGElement>();
  const ink = { fill: 'var(--ink)' };
  const twinkle = (delay: number): { animate: TargetAndTransition; transition: Transition } =>
    alive
      ? {
          animate: { scale: [1, 0.5, 1.15, 1], rotate: [0, 30, -10, 0] },
          transition: { duration: 2.4, repeat: Infinity, repeatDelay: 2, delay, ease: 'easeInOut' },
        }
      : { animate: { scale: 1, rotate: 0 }, transition: { duration: 0 } };
  return (
    <motion.svg
      ref={ref}
      role="img"
      aria-label="Cronista, la crónica negra de las diez"
      width={width}
      height={Math.round((width * 160) / 380)}
      viewBox="0 0 380 160"
      style={{ display: 'block', overflow: 'visible' }}
    >
      <motion.path
        {...twinkle(0)}
        d="M 150 1 Q 151.8 14.2 165 16 Q 151.8 17.8 150 31 Q 148.2 17.8 135 16 Q 148.2 14.2 150 1 Z"
        fill="#f44612"
      />
      <motion.path
        {...twinkle(0.9)}
        d="M 10 51 Q 10.84 57.16 17 58 Q 10.84 58.84 10 65 Q 9.16 58.84 3 58 Q 9.16 57.16 10 51 Z"
        style={ink}
      />
      <g style={{ fontFamily: 'var(--font-display)', fontSize: 54, fontWeight: 400 }}>
        <text
          x="23"
          y="94"
          transform="translate(4 4)"
          textLength="262"
          lengthAdjust="spacingAndGlyphs"
          fill="#f44612"
        >
          Cronista
        </text>
        <text x="23" y="94" textLength="262" lengthAdjust="spacingAndGlyphs" style={ink}>
          Cronista
        </text>
      </g>
      <g transform="translate(290 0) rotate(8 50 56) scale(0.9)">
        <defs>
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
          <linearGradient id={id('mask')} x1="0.2" y1="0" x2="0.6" y2="1">
            <stop offset="0" style={{ stopColor: 'var(--logo-mask-top)' }} />
            <stop offset="0.55" style={{ stopColor: 'var(--logo-mask-mid)' }} />
            <stop offset="1" style={{ stopColor: 'var(--logo-mask-bottom)' }} />
          </linearGradient>
        </defs>
        <path
          d={NARRATOR_MASK_PATH}
          fill="#f44612"
          fillRule="evenodd"
          transform="translate(4.5 4.5)"
        />
        <motion.g
          fill="#ff7a2b"
          filter={`url(#${id('fire')})`}
          initial={{ opacity: 0.95 }}
          animate={alive ? { opacity: [0.95, 0.55, 1, 0.7, 0.95] } : { opacity: 0.95 }}
          transition={
            alive ? { duration: 2, repeat: Infinity, ease: 'easeInOut' } : { duration: 0 }
          }
        >
          <ellipse cx="34" cy="77" rx="8" ry="9" />
          <ellipse cx="66" cy="77" rx="8" ry="9" />
          <ellipse cx="50" cy="38" rx="9" ry="16" opacity="0.6" />
        </motion.g>
        <path
          d={NARRATOR_MASK_PATH}
          fill={`url(#${id('mask')})`}
          fillRule="evenodd"
          filter={`url(#${id('rough')})`}
        />
      </g>
      <text
        x="30"
        y="150"
        style={{
          fontFamily: 'var(--font-display)',
          fontSize: 19,
          letterSpacing: '-0.3px',
          fill: 'var(--logo-subtitle)',
        }}
      >
        la crónica negra de las diez
      </text>
      <motion.path
        {...twinkle(1.7)}
        d="M 364 136 Q 365.14 144.36 373.5 145.5 Q 365.14 146.64 364 155 Q 362.86 146.64 354.5 145.5 Q 362.86 144.36 364 136 Z"
        fill="#f44612"
      />
    </motion.svg>
  );
}
