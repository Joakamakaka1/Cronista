import { LogOut, Moon } from 'lucide-react';
import { useEffect, useId, useRef, useState } from 'react';

import { Mascot } from '../brand/mascot.tsx';
import type { Seat } from '../brand/seat.ts';
import { supabase } from '../supabase.ts';
import { useTheme } from '../theme/theme.ts';

/**
 * The player's own mascot in Today's header, which opens a small panel with the light or dark
 * switch and the way out. It is a disclosure, not a dialog: nothing locks the page behind it.
 */
export function AccountPanel({
  seat,
  nickname,
}: {
  readonly seat: Seat | null;
  readonly nickname: string | null;
}) {
  const [open, setOpen] = useState(false);
  const [theme, setTheme] = useTheme();
  const panelId = useId();
  const root = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return undefined;
    const closeOutside = (event: PointerEvent) => {
      if (event.target instanceof Node && root.current?.contains(event.target) !== true) {
        setOpen(false);
      }
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    document.addEventListener('pointerdown', closeOutside);
    document.addEventListener('keydown', closeOnEscape);
    return () => {
      document.removeEventListener('pointerdown', closeOutside);
      document.removeEventListener('keydown', closeOnEscape);
    };
  }, [open]);

  const dark = theme === 'dark';

  return (
    <div ref={root} className="relative">
      <button
        type="button"
        aria-label={nickname === null ? 'Tu cuenta' : `Tu cuenta, ${nickname}`}
        aria-expanded={open}
        aria-controls={panelId}
        className="grid size-12 place-items-center rounded-2xl"
        onClick={() => {
          setOpen(!open);
        }}
      >
        <Mascot who={seat ?? 'narrator'} size={46} alive />
      </button>
      <div
        id={panelId}
        hidden={!open}
        className="card absolute top-14 right-0 z-30 w-60 rounded-3xl p-2 shadow-[0_14px_34px_rgb(0_0_0/0.25)]"
      >
        <button
          type="button"
          role="switch"
          aria-checked={dark}
          className="flex min-h-12 w-full items-center gap-3 rounded-2xl px-3 text-left font-semibold text-ink hover:bg-chip"
          onClick={() => {
            setTheme(dark ? 'light' : 'dark');
          }}
        >
          <Moon aria-hidden size={18} />
          <span className="flex-1">Modo oscuro</span>
          <span
            aria-hidden
            className={`relative h-7 w-12 rounded-full transition-colors ${dark ? 'bg-accent' : 'bg-track'}`}
          >
            <span
              className={`absolute top-1 size-5 rounded-full bg-white transition-[left] ${dark ? 'left-6' : 'left-1'}`}
            />
          </span>
        </button>
        <button
          type="button"
          className="flex min-h-12 w-full items-center gap-3 rounded-2xl px-3 text-left font-semibold text-ink hover:bg-chip"
          onClick={() => {
            void supabase.auth.signOut();
          }}
        >
          <LogOut aria-hidden size={18} />
          Salir
        </button>
      </div>
    </div>
  );
}
