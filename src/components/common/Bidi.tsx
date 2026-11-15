import { clsx } from 'clsx';
import type { ReactNode } from 'react';

/**
 * Raw identifiers that must always read left-to-right, even inside Arabic text:
 * seat codes, booking references, phone numbers, age ratings.
 */
export function Ltr({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <span dir="ltr" className={clsx('ltr', className)}>
      {children}
    </span>
  );
}

/** Isolates text whose direction depends on its content: film titles, names, formatted dates and prices. */
export function Bdi({ children, className }: { children: ReactNode; className?: string }) {
  return <bdi className={className}>{children}</bdi>;
}
