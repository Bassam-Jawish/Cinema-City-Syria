import { clsx } from 'clsx';
import { Link } from 'react-router';
import { cinemaDate } from '@shared/time';
import type { ShowtimeSummary } from '@shared/types';
import { useI18n } from '@/i18n';
import { useFormat } from '@/lib/format';

/** A bookable showtime: time, format and availability, linking straight into the 3D hall. */
export function ShowtimeChip({
  showtime,
  size = 'md',
  showHall = false,
  className,
}: {
  showtime: ShowtimeSummary;
  size?: 'sm' | 'md';
  showHall?: boolean;
  className?: string;
}) {
  const { t, L } = useI18n();
  const f = useFormat();
  const disabled = showtime.status === 'closed' || showtime.status === 'sold_out';
  const statusLabel = t(`common.showtime.status.${showtime.status}`);
  // Chips can list shows on different days: name the day unless it is today.
  const date = cinemaDate(showtime.startsAt);
  const dayLabel = date === cinemaDate(Date.now()) ? null : f.day(date).label;

  const content = (
    <>
      <span className={clsx('nums font-semibold text-cream', size === 'sm' ? 'text-sm' : 'text-base')}>
        {dayLabel && <span className="me-1.5 text-[0.75em] font-medium text-sand">{dayLabel}</span>}
        <bdi>{f.time(showtime.startsAt)}</bdi>
      </span>
      <span className="flex items-center gap-1.5 text-[0.7rem] leading-none">
        {showtime.format === '3D' && (
          <span dir="ltr" className="rounded bg-velvet px-1 py-0.5 font-mono font-semibold text-white">
            3D
          </span>
        )}
        {showHall && <span className="text-sand">{L(showtime.hall.name)}</span>}
        {showtime.status === 'filling_fast' && <span className="text-warn">{statusLabel}</span>}
        {disabled && <span className="text-dust">{statusLabel}</span>}
      </span>
    </>
  );

  const classes = clsx(
    'group relative inline-flex min-w-[5.5rem] flex-col items-start gap-1 rounded-xl border px-3 transition-[border-color,background-color,transform] duration-200',
    size === 'sm' ? 'py-1.5' : 'py-2.5',
    disabled
      ? 'cursor-not-allowed border-cream/[0.06] bg-transparent opacity-50'
      : 'border-cream/12 bg-cream/[0.03] hover:-translate-y-0.5 hover:border-velvet/70 hover:bg-velvet/10',
    className,
  );

  if (disabled) {
    return (
      <span className={classes} aria-disabled="true">
        {content}
      </span>
    );
  }
  return (
    <Link to={`/showtimes/${showtime.id}/seats`} className={classes}>
      {content}
    </Link>
  );
}
