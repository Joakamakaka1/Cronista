// Adapted from shadcn/ui (https://ui.shadcn.com), MIT License, Copyright (c) 2023 shadcn.
import type { ComponentProps } from 'react';

import { cn } from './class-names.ts';

/** A multi-line text field in the reading face, since what a player writes is read later. */
export function Textarea({ className, ...props }: ComponentProps<'textarea'>) {
  return (
    <textarea
      className={cn(
        'w-full resize-none rounded-lg border border-rule bg-sheet px-4 py-3 font-serif text-[1.0625rem] leading-relaxed text-ink placeholder:text-muted focus-visible:border-pen',
        className,
      )}
      {...props}
    />
  );
}
