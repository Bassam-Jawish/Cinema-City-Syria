import { clsx } from 'clsx';
import type { ReactNode } from 'react';
import type { Format, Rating } from '@shared/types';
import { useI18n } from '@/i18n';

export type BadgeTone = 'neutral' | 'gold' | 'brand' | 'ok' | 'warn' | 'bad' | 'info';

const tones: Record<BadgeTone, string> = {
  neutral: 'border-cream/15 bg-cream/[0.05] text-cream-200',
  gold: 'border-marquee/40 bg-marquee/[0.1] text-marquee-bright',
  brand: 'border-velvet-bright/45 bg-velvet/[0.16] text-[#ff8f95]',
  ok: 'border-ok/35 bg-ok/[0.1] text-ok',
  warn: 'border-warn/40 bg-warn/[0.1] text-warn',
  bad: 'border-bad/40 bg-bad/[0.1] text-bad',
  info: 'border-info/35 bg-info/[0.1] text-info',
};

export interface BadgeProps {
  tone?: BadgeTone;
  size?: 'sm' | 'md';
  icon?: ReactNode;
  className?: string;
  children: ReactNode;
  title?: string;
}

/** Small pill for statuses and attributes. */
export function Badge({ tone = 'neutral', size = 'sm', icon, className, children, title }: BadgeProps) {
  return (
    <span
      title={title}
      className={clsx(
        'inline-flex items-center gap-1.5 rounded-full border font-medium whitespace-nowrap',
        size === 'sm' ? 'h-6 px-2.5 text-xs' : 'h-8 px-3.5 text-sm',
        tones[tone],
        className,
      )}
    >
      {icon}
      {children}
    </span>
  );
}

/** Age-rating chip, e.g. "12+", with the full meaning as a tooltip. */
export function RatingBadge({ rating, className }: { rating: Rating; className?: string }) {
  const { t } = useI18n();
  return (
    <span
      title={t(`common.ratings.${rating}`)}
      className={clsx(
        'ltr inline-flex h-6 min-w-9 items-center justify-center rounded-md border border-cream/30 px-1.5 font-mono text-[0.7rem] font-semibold text-cream',
        className,
      )}
      dir="ltr"
    >
      {rating}
    </span>
  );
}

/** 2D / 3D chip. 3D gets the gold treatment. */
export function FormatBadge({ format, className }: { format: Format; className?: string }) {
  return (
    <span
      dir="ltr"
      className={clsx(
        'ltr inline-flex h-6 items-center justify-center rounded-md px-1.5 font-mono text-[0.7rem] font-semibold',
        format === '3D' ? 'bg-velvet text-white' : 'border border-cream/30 text-cream',
        className,
      )}
    >
      {format}
    </span>
  );
}
