import { clsx } from 'clsx';
import { useRef, type KeyboardEvent } from 'react';
import { isWeekend } from '@shared/time';
import { useI18n } from '@/i18n';
import { useFormat } from '@/lib/format';

/** Horizontal day picker (today … +6). Arrow keys move between days. */
export function DateStrip({
  dates,
  value,
  onChange,
  counts,
  className,
}: {
  dates: string[];
  value: string;
  onChange: (date: string) => void;
  /** Optional number of shows per day; days with none are dimmed. */
  counts?: Record<string, number>;
  className?: string;
}) {
  const { t, isRtl } = useI18n();
  const f = useFormat();
  const refs = useRef<Array<HTMLButtonElement | null>>([]);

  const onKeyDown = (event: KeyboardEvent<HTMLButtonElement>, index: number) => {
    const forward = isRtl ? 'ArrowLeft' : 'ArrowRight';
    const backward = isRtl ? 'ArrowRight' : 'ArrowLeft';
    let next = index;
    if (event.key === forward) next = Math.min(dates.length - 1, index + 1);
    else if (event.key === backward) next = Math.max(0, index - 1);
    else if (event.key === 'Home') next = 0;
    else if (event.key === 'End') next = dates.length - 1;
    else return;
    event.preventDefault();
    onChange(dates[next]);
    refs.current[next]?.focus();
  };

  return (
    <div role="tablist" aria-label={t('movie.pickDay')} className={clsx('no-scrollbar flex gap-2 overflow-x-auto pb-1', className)}>
      {dates.map((date, index) => {
        const parts = f.day(date);
        const selected = date === value;
        const empty = counts ? !counts[date] : false;
        return (
          <button
            key={date}
            ref={(el) => {
              refs.current[index] = el;
            }}
            type="button"
            role="tab"
            aria-selected={selected}
            tabIndex={selected ? 0 : -1}
            onClick={() => onChange(date)}
            onKeyDown={(event) => onKeyDown(event, index)}
            className={clsx(
              'relative flex min-w-[4.75rem] shrink-0 flex-col items-center rounded-2xl border px-3 py-2.5 transition-colors',
              selected
                ? 'border-velvet bg-velvet text-white shadow-[0_10px_30px_-14px_rgb(219_32_41/0.9)]'
                : 'border-cream/10 bg-cream/[0.03] text-cream-200 hover:border-cream/30',
              empty && !selected && 'opacity-45',
            )}
          >
            <span className={clsx('text-xs', selected ? 'text-white/85' : 'text-sand')}>{parts.label}</span>
            <span className="nums font-display text-2xl leading-tight">{parts.day}</span>
            <span className={clsx('text-[0.7rem]', selected ? 'text-white/80' : 'text-dust')}>{parts.month}</span>
            {isWeekend(date) && (
              <span
                className={clsx(
                  'absolute top-1.5 end-1.5 size-1.5 rounded-full',
                  selected ? 'bg-white/80' : 'bg-marquee',
                )}
                title={t('movie.weekend')}
              />
            )}
          </button>
        );
      })}
    </div>
  );
}
