// Adapted from shadcn/ui (https://ui.shadcn.com). MIT License, Copyright (c) 2023 shadcn: see LICENSE-shadcn.txt.
import { type ClassValue, clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';

/** Joins class names, letting a later Tailwind class override an earlier one of the same kind. */
export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}
