import { clsx } from 'clsx';

/**
 * Cinema City wordmark with a city-skyline emblem in the brand's crimson, charcoal and white.
 * This is a stand-in drawn for the demo — replace it with the cinema's official logo artwork
 * (public/brand) before any public use.
 */
export function Logo({ className, compact = false }: { className?: string; compact?: boolean }) {
  return (
    <span className={clsx('inline-flex items-center gap-2.5', className)} dir="ltr">
      <Emblem className="h-8 w-auto shrink-0" />
      <span className="flex flex-col leading-none">
        <span className="font-brand text-[0.95rem] tracking-[0.05em] text-cream">CINEMACITY</span>
        {!compact && (
          <span dir="rtl" className="mt-1 font-display text-[0.7rem] font-semibold text-velvet-bright">
            سينما سيتي · دمشق
          </span>
        )}
      </span>
    </span>
  );
}

/** A street of towers in one-point perspective, converging on a road. */
export function Emblem({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 64 46" className={className} aria-hidden="true" focusable="false">
      {/* outer towers: charcoal fronts, darker perspective sides, black floor bands */}
      <path d="M3 41V9l11-4v36z" fill="#5a5a5a" />
      <path d="M14 5l3.6 3.2V41H14z" fill="#2c2c2c" />
      <path d="M61 41V9l-11-4v36z" fill="#5a5a5a" />
      <path d="M50 5l-3.6 3.2V41H50z" fill="#2c2c2c" />
      <g stroke="#1b1b1a" strokeWidth="1.3">
        <path d="M3 15.5l11-2.8M3 22l11-2.4M3 28.5l11-2M3 35l11-1.6" />
        <path d="M61 15.5l-11-2.8M61 22l-11-2.4M61 28.5l-11-2M61 35l-11-1.6" />
      </g>
      {/* red buildings with pointed roofs and pinstripes */}
      <path d="M17.6 41V18.5l5-6.5 5 6.5V41z" fill="#db2029" />
      <path d="M46.4 41V18.5l-5-6.5-5 6.5V41z" fill="#db2029" />
      <g stroke="#8e0f16" strokeWidth=".7">
        <path d="M20 20v21M22.6 17v24M25.2 20v21M38.8 20v21M41.4 17v24M44 20v21" />
      </g>
      {/* white central tower with a V-notched top */}
      <path d="M27.6 41V6l4.4 5.2L36.4 6v35z" fill="#f4f1ec" />
      <g stroke="#c7c6c5" strokeWidth=".6">
        <path d="M27.6 16l8.8-6M27.6 22l8.8-6M27.6 28l8.8-6M27.6 34l8.8-6M27.6 40l8.8-6" />
      </g>
      {/* road converging on the vanishing point */}
      <path d="M24 46h16l-6.6-5h-2.8z" fill="#f4f1ec" opacity=".9" />
      <path d="M0 41h64v1.4H0z" fill="#db2029" opacity=".9" />
    </svg>
  );
}
