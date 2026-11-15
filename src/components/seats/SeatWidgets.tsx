import { clsx } from 'clsx';
import { Timer } from 'lucide-react';
import { useEffect, useRef } from 'react';
import type { SeatType } from '@shared/hall';
import { useI18n } from '@/i18n';
import { formatCountdown } from '@/lib/format';
import { useNow } from '@/lib/hooks';
import { useBooking } from '@/store/booking';
import { MAP_COLORS } from '@/three/palette';

/** Seat colour key. Only lists the seat types this hall actually has. */
export function SeatLegend({ types, className }: { types: SeatType[]; className?: string }) {
  const { t } = useI18n();
  const items: Array<{ key: string; label: string; color: string; ring?: string; pulse?: boolean }> = [
    ...types.map((type) => ({
      key: type,
      label: type === 'vip' ? t('common.seat.types.vip') : t(`seats.legend.${type}`),
      color: MAP_COLORS.available[type],
      ring: MAP_COLORS.accent[type],
    })),
    { key: 'selected', label: t('seats.legend.selected'), color: MAP_COLORS.selected },
    { key: 'booked', label: t('seats.legend.booked'), color: MAP_COLORS.booked },
    { key: 'held', label: t('seats.legend.held'), color: MAP_COLORS.held, pulse: true },
  ];
  return (
    <ul className={clsx('flex flex-wrap gap-x-4 gap-y-2 text-xs text-cream-200', className)}>
      {items.map((item) => (
        <li key={item.key} className="inline-flex items-center gap-2">
          <span
            className={clsx('inline-block h-3 w-4 rounded-[4px]', item.pulse && 'animate-pulse')}
            style={{
              background: item.color,
              boxShadow: item.ring && item.ring !== 'transparent' ? `inset 0 0 0 1.5px ${item.ring}` : undefined,
            }}
            aria-hidden="true"
          />
          {item.label}
        </li>
      ))}
    </ul>
  );
}

/** "Seats held for 08:42" — turns amber under two minutes, red under thirty seconds; releases the seats at zero. */
export function HoldTimer({ className, compact = false }: { className?: string; compact?: boolean }) {
  const { t } = useI18n();
  const holdExpiresAt = useBooking((s) => s.holdExpiresAt);
  const handleHoldExpired = useBooking((s) => s.handleHoldExpired);
  const now = useNow(250);
  const fired = useRef<number | null>(null);

  const remaining = holdExpiresAt ? holdExpiresAt - now : null;
  useEffect(() => {
    if (holdExpiresAt && remaining !== null && remaining <= 0 && fired.current !== holdExpiresAt) {
      fired.current = holdExpiresAt;
      handleHoldExpired();
    }
  }, [holdExpiresAt, remaining, handleHoldExpired]);

  if (remaining === null) return null;
  const tone = remaining < 30_000 ? 'text-bad' : remaining < 120_000 ? 'text-warn' : 'text-cream';
  return (
    <div className={clsx('inline-flex items-center gap-2', className)} role="timer" aria-live="off" title={t('common.hold.hint')}>
      <Timer size={16} className={tone} aria-hidden="true" />
      {!compact && <span className="text-xs text-sand">{t('common.hold.label')}</span>}
      <span dir="ltr" className={clsx('nums font-mono text-sm font-semibold', tone)}>
        {formatCountdown(remaining)}
      </span>
    </div>
  );
}

/** Small dot showing whether seat availability is streaming live. */
export function LiveIndicator({ className }: { className?: string }) {
  const { t } = useI18n();
  const live = useBooking((s) => s.live);
  const label = live === 'live' ? t('common.live.live') : live === 'connecting' ? t('common.live.connecting') : t('common.live.offline');
  return (
    <span className={clsx('inline-flex items-center gap-2 text-xs', className)} title={label}>
      <span className="relative flex size-2">
        {live === 'live' && <span className="absolute inline-flex size-full animate-ping rounded-full bg-ok opacity-60" />}
        <span
          className={clsx(
            'relative inline-flex size-2 rounded-full',
            live === 'live' ? 'bg-ok' : live === 'connecting' ? 'bg-warn' : 'bg-bad',
          )}
        />
      </span>
      <span className="hidden text-sand sm:inline">{label}</span>
    </span>
  );
}
