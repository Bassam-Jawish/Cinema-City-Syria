import { clsx } from 'clsx';
import { ChevronRight } from 'lucide-react';
import { Link } from 'react-router';
import type { Booking } from '@shared/types';
import { Ltr } from '@/components/common/Bidi';
import { ErrorState, LoadingState } from '@/components/common/PageState';
import { Poster } from '@/components/movie/Poster';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { useI18n } from '@/i18n';
import { api } from '@/lib/api';
import { useFormat } from '@/lib/format';
import { useAsync, useDocumentTitle } from '@/lib/hooks';

export default function MyTicketsPage() {
  const { t } = useI18n();
  useDocumentTitle(`${t('ticket.my.title')} · ${t('common.brand.name')}`);
  const { data, error, loading, reload } = useAsync((signal) => api.myBookings(signal), []);

  if (loading && !data) return <LoadingState />;
  if (error && !data) return <ErrorState error={error} onRetry={reload} />;
  const bookings = data ?? [];
  const now = Date.now();
  const upcoming = bookings.filter((b) => b.status !== 'cancelled' && Date.parse(b.showtime.endsAt) > now);
  const past = bookings.filter((b) => !upcoming.includes(b));

  return (
    <div className="mx-auto max-w-4xl px-4 pb-10 pt-6 sm:px-6">
      <h1 className="text-4xl text-cream sm:text-5xl">{t('ticket.my.title')}</h1>
      <p className="mt-2 text-sand">{t('ticket.my.subtitle')}</p>

      {bookings.length === 0 ? (
        <div className="surface mt-10 flex flex-col items-center gap-4 rounded-3xl p-10 text-center">
          <p className="text-sand">{t('ticket.my.empty')}</p>
          <Button to="/">{t('common.actions.bookTickets')}</Button>
        </div>
      ) : (
        <div className="mt-10 space-y-10">
          {upcoming.length > 0 && <Group title={t('ticket.my.upcoming')} bookings={upcoming} />}
          {past.length > 0 && <Group title={t('ticket.my.past')} bookings={past} muted />}
        </div>
      )}
    </div>
  );
}

function Group({ title, bookings, muted = false }: { title: string; bookings: Booking[]; muted?: boolean }) {
  const { t, L } = useI18n();
  const f = useFormat();
  return (
    <section>
      <h2 className="mb-4 text-xl text-cream">{title}</h2>
      <ul className="space-y-3">
        {bookings.map((booking) => (
          <li key={booking.code}>
            <Link
              to={`/tickets/${booking.code}`}
              className={clsx(
                'surface group flex items-center gap-4 rounded-2xl p-3 pe-4 transition-colors hover:border-cream/20',
                muted && 'opacity-60',
              )}
            >
              <Poster movie={booking.movie} className="w-14 shrink-0 rounded-lg" />
              <div className="min-w-0 flex-1">
                <p className="truncate font-display text-lg text-white">{L(booking.movie.title)}</p>
                <p className="text-sm text-sand">
                  <bdi>{f.dayShort(booking.showtime.startsAt)}</bdi> · <bdi className="nums">{f.time(booking.showtime.startsAt)}</bdi> ·{' '}
                  {L(booking.hall.name)}
                </p>
                <p className="mt-1 text-xs text-dust">
                  <Ltr className="font-mono">{booking.code}</Ltr> · {booking.seats.map((s) => s.seatId).join(' ')}
                </p>
              </div>
              <Badge tone={booking.status === 'confirmed' ? 'ok' : booking.status === 'checked_in' ? 'info' : 'bad'}>
                {t(`common.booking.status.${booking.status}`)}
              </Badge>
              <ChevronRight size={18} className="shrink-0 text-dust transition-transform group-hover:translate-x-0.5 rtl:-scale-x-100" aria-hidden="true" />
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}
