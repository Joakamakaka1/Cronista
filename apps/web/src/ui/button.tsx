// Adapted from shadcn/ui (https://ui.shadcn.com), MIT License, Copyright (c) 2023 shadcn.
import { cva, type VariantProps } from 'class-variance-authority';
import { Slot } from 'radix-ui';
import type { ComponentProps } from 'react';

import { cn } from './class-names.ts';

const buttonVariants = cva(
  'inline-flex min-h-11 items-center justify-center gap-2 rounded-lg px-5 font-medium transition-colors disabled:pointer-events-none disabled:opacity-50',
  {
    variants: {
      variant: {
        primary: 'bg-pen text-paper hover:bg-pen/90 active:bg-pen/80',
        quiet: 'text-pen hover:bg-pen-soft',
        outline: 'border border-rule text-ink hover:bg-sheet',
      },
    },
    defaultVariants: { variant: 'primary' },
  },
);

/**
 * A button, or with `asChild` a link that looks like one. Touch targets are at least 44px high.
 */
export function Button({
  className,
  variant,
  asChild = false,
  ...props
}: ComponentProps<'button'> & VariantProps<typeof buttonVariants> & { asChild?: boolean }) {
  const Component = asChild ? Slot.Root : 'button';
  return <Component className={cn(buttonVariants({ variant }), className)} {...props} />;
}
