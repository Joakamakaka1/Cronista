import type { ReactNode } from 'react';
import { Link } from 'react-router';

import { Isotipo } from '../brand/isotipo.tsx';

/** The top of Today: the isotipo and the name, and whatever the screen puts on the right. */
export function ScreenHeader({ children }: { readonly children?: ReactNode }) {
  return (
    <header className="relative flex items-center justify-between gap-2 px-1">
      <Link to="/" className="flex items-center gap-[7px] text-ink">
        <Isotipo size={26} />
        <span className="font-display text-xl text-heading">Cronista</span>
      </Link>
      <div className="flex items-center gap-2">{children}</div>
    </header>
  );
}
