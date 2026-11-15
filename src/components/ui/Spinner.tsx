import { clsx } from 'clsx';

/** A small film-reel spinner. Inherits the current text colour. */
export function Spinner({ size = 20, className }: { size?: number; className?: string }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      role="status"
      aria-hidden="true"
      className={clsx('animate-spin', className)}
      style={{ animationDuration: '0.9s' }}
    >
      <circle cx="12" cy="12" r="9.5" stroke="currentColor" strokeOpacity="0.22" strokeWidth="2.5" />
      <path d="M21.5 12a9.5 9.5 0 0 0-9.5-9.5" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" />
    </svg>
  );
}

/** Rectangular shimmer placeholder. Size it with className (h-*, w-*, aspect-*). */
export function Skeleton({ className }: { className?: string }) {
  return <div aria-hidden="true" className={clsx('skeleton', className)} />;
}
