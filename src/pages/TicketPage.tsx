import { clsx } from 'clsx';
import { CalendarPlus, Check, Copy, Eye, Printer, Ticket as TicketIcon, XCircle } from 'lucide-react';
import { motion } from 'motion/react';
import QRCode from 'qrcode';
import { useEffect, useState, type ReactNode } from 'react';
import { useParams, useSearchParams } from 'react-router';
import type { Booking } from '@shared/types';
import { Ltr } from '@/components/common/Bidi';
import { ErrorState, LoadingState } from '@/components/common/PageState';
import { Logo } from '@/components/brand/Logo';
import { Poster } from '@/components/movie/Poster';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Dialog } from '@/components/ui/Dialog';
import { useI18n } from '@/i18n';
import { api, errorCodeOf } from '@/lib/api';
import { formatPhone, useFormat } from '@/lib/format';
import { useAsync, useDocumentTitle } from '@/lib/hooks';
import { notify } from '@/store/notices';

export default function TicketPage() {
  const { code = '' } = useParams();
  const [params] = useSearchParams();
  const isNew = params.get('new') === '1';
  const { t } = useI18n();
  useDocumentTitle(`${t('ticket.ticketTitle')} · ${t('common.brand.name')}`);
  const { data: booking, error, loading, reload, setData } = useAsync((signal) => api.getBooking(code, signal), [code]);
  const mine = useAsync((signal) => api.myBookings(signal).catch(() => [] as Booking[]), []);

  if (loading && !booking) return <LoadingState />;
  if (error && !booking) return <ErrorState error={error} notFoundKey="ticket.notFound" onRetry={reload} />;
  if (!booking) return null;

  const owned = Boolean(mine.data?.some((b) => b.code === booking.code));
  return (
    <div className="mx-auto max-w-3xl px-4 pb-10 pt-6 sm:px-6">
      {isNew && booking.status === 'confirmed' && <Celebration />}
      <TicketCard booking={booking} />
      <TicketActions booking={booking} owned={owned} onChange={setData} />
    </div>
  );
}

function Celebration() {
  const { t } = useI18n();
  return (
    <div className="mb-8 flex flex-col items-center text-center">
      <motion.span
        initial={{ scale: 0.3, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        transition={{ type: 'spring', stiffness: 260, damping: 16 }}
        className="relative flex size-16 items-center justify-center rounded-full bg-ok text-night-950"
      >
        <span className="absolute inset-0 animate-pulse-ring rounded-full border-2 border-ok" aria-hidden="true" />
        <Check size={32} strokeWidth={3} aria-hidden="true" />
      </motion.span>
      <motion.h1
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.2 }}
        className="mt-5 text-4xl text-cream"
      >
        {t('ticket.confirmedTitle')}
      </motion.h1>
      <p className="mt-2 text-sand">{t('ticket.confirmedBody')}</p>
    </div>
  );
}

function TicketCard({ booking }: { booking: Booking }) {
  const { t, L } = useI18n();
  const f = useFormat();
  const [qr, setQr] = useState<string | null>(null);
  const url = `${window.location.origin}/tickets/${booking.code}`;

  useEffect(() => {
    let cancelled = false;
    QRCode.toString(url, {
      type: 'svg',
      margin: 1,
      errorCorrectionLevel: 'M',
      color: { dark: '#0d0c0c', light: '#ffffff' },
    })
      .then((svg) => {
        if (!cancelled) setQr(svg);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [url]);

  const { movie, showtime, hall } = booking;
  const cancelled = booking.status === 'cancelled';
  const statusTone = booking.status === 'confirmed' ? 'ok' : booking.status === 'checked_in' ? 'info' : 'bad';

  return (
    <motion.article
      initial={{ opacity: 0, y: 24 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.6, ease: [0.16, 1, 0.3, 1] }}
      className={clsx('ticket-notch relative overflow-hidden rounded-[var(--radius-ticket)] bg-night-800', cancelled && 'opacity-70')}
    >
      <div
        className="absolute inset-x-0 top-0 h-64 opacity-60"
        style={{ background: `radial-gradient(80% 100% at 85% 0%, ${movie.accent}55, transparent 70%)` }}
        aria-hidden="true"
      />
      <div className="relative p-6 sm:p-8">
        <div className="flex items-center justify-between gap-3">
          <Logo compact />
          <Badge tone={statusTone}>{t(`common.booking.status.${booking.status}`)}</Badge>
        </div>
        <div className="mt-6 flex gap-5">
          <Poster movie={movie} className="w-24 shrink-0 rounded-xl ring-1 ring-cream/10 sm:w-28" />
          <div className="min-w-0">
            <h2 className="text-3xl leading-tight text-white">{L(movie.title)}</h2>
            <p className="mt-1 text-sm text-sand">
              {L(hall.name)} · {showtime.format}
            </p>
          </div>
        </div>
        <dl className="mt-7 grid grid-cols-2 gap-x-6 gap-y-4 sm:grid-cols-4">
          <Fact label={t('ticket.date')} value={<bdi>{f.dayShort(showtime.startsAt)}</bdi>} />
          <Fact label={t('ticket.time')} value={<bdi className="nums">{f.time(showtime.startsAt)}</bdi>} />
          <Fact label={t('ticket.hall')} value={L(hall.name)} />
          <Fact label={t('ticket.total')} value={<span className="nums">{f.price(booking.total)}</span>} />
        </dl>
        <div className="mt-5">
          <p className="text-xs text-sand">{t('ticket.seats')}</p>
          <ul className="mt-2 flex flex-wrap gap-2">
            {booking.seats.map((seat) => (
              <li key={seat.seatId} className="rounded-lg border border-marquee/40 bg-marquee/10 px-2.5 py-1 text-sm">
                <Ltr className="font-mono font-semibold text-marquee-bright">{seat.seatId}</Ltr>
                <span className="ms-2 text-xs text-sand">{t(`common.seat.types.${seat.type}`)}</span>
              </li>
            ))}
          </ul>
        </div>
      </div>

      <div className="perforation mx-6" />

      <div className="relative grid gap-6 p-6 sm:grid-cols-[auto_1fr] sm:items-center sm:p-8">
        <div className="mx-auto w-40 overflow-hidden rounded-xl bg-white p-2 sm:mx-0">
          {qr ? (
            <div aria-label={t('ticket.scan')} role="img" dangerouslySetInnerHTML={{ __html: qr }} />
          ) : (
            <div className="aspect-square animate-pulse bg-night-600/20" />
          )}
        </div>
        <div className="space-y-3 text-center sm:text-start">
          <p className="text-xs text-sand">{t('ticket.reference')}</p>
          <Ltr className="block font-mono text-3xl font-semibold tracking-wider text-white">{booking.code}</Ltr>
          <p className="text-sm text-sand">{t('ticket.scan')}</p>
          <p className="text-sm text-cream-200">
            {booking.customer.name} · <Ltr className="nums">{formatPhone(booking.customer.phone)}</Ltr>
          </p>
          {booking.status === 'confirmed' &&
            (booking.payment.status === 'due' ? (
              <p className="rounded-xl border border-warn/30 bg-warn/10 px-3 py-2 text-sm text-warn">
                {t('ticket.payDue', { total: f.price(booking.total) })}
              </p>
            ) : (
              <Badge tone="ok">{t('ticket.paid')}</Badge>
            ))}
          {booking.status === 'cancelled' && <p className="text-sm text-bad">{t('ticket.cancelledBanner')}</p>}
          {booking.status === 'checked_in' && <p className="text-sm text-info">{t('ticket.checkedInBanner')}</p>}
        </div>
      </div>
    </motion.article>
  );
}

function Fact({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div>
      <dt className="text-xs text-sand">{label}</dt>
      <dd className="mt-1 font-semibold text-cream">{value}</dd>
    </div>
  );
}

function TicketActions({ booking, owned, onChange }: { booking: Booking; owned: boolean; onChange: (b: Booking) => void }) {
  const { t, L } = useI18n();
  const [confirming, setConfirming] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const started = Date.parse(booking.showtime.startsAt) <= Date.now();
  const canCancel = owned && booking.status === 'confirmed' && !started;

  const copyLink = async () => {
    try {
      await navigator.clipboard.writeText(`${window.location.origin}/tickets/${booking.code}`);
      notify('success', 'copied');
    } catch {
      notify('error', 'generic');
    }
  };

  const downloadCalendar = () => {
    const stamp = (iso: string) => iso.replace(/[-:]/g, '').replace(/\.\d{3}/, '');
    const seats = booking.seats.map((s) => s.seatId).join(', ');
    const lines = [
      'BEGIN:VCALENDAR',
      'VERSION:2.0',
      'PRODID:-//Cinema City Syria//Booking demo//EN',
      'BEGIN:VEVENT',
      `UID:${booking.code}@cinemacity.sy`,
      `DTSTAMP:${stamp(new Date().toISOString())}`,
      `DTSTART:${stamp(booking.showtime.startsAt)}`,
      `DTEND:${stamp(booking.showtime.endsAt)}`,
      `SUMMARY:${t('ticket.calendarTitle', { film: L(booking.movie.title) })}`,
      `LOCATION:${t('common.footer.address')}`,
      `DESCRIPTION:${booking.code} · ${L(booking.hall.name)} · ${seats}`,
      'END:VEVENT',
      'END:VCALENDAR',
    ];
    const blob = new Blob([lines.join('\r\n')], { type: 'text/calendar;charset=utf-8' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = `${booking.code}.ics`;
    link.click();
    setTimeout(() => URL.revokeObjectURL(link.href), 1000);
  };

  const cancel = async () => {
    setCancelling(true);
    try {
      const updated = await api.cancelBooking(booking.code);
      onChange(updated);
      notify('success', 'bookingCancelled');
      setConfirming(false);
    } catch (error) {
      const code = errorCodeOf(error);
      notify('error', code === 'NETWORK' ? 'network' : 'generic');
    } finally {
      setCancelling(false);
    }
  };

  return (
    <div className="no-print mt-6 space-y-6">
      <div className="flex flex-wrap justify-center gap-2">
        <Button variant="secondary" size="sm" icon={<Printer size={15} />} onClick={() => window.print()}>
          {t('ticket.actions.print')}
        </Button>
        <Button variant="secondary" size="sm" icon={<CalendarPlus size={15} />} onClick={downloadCalendar}>
          {t('ticket.actions.calendar')}
        </Button>
        <Button variant="secondary" size="sm" icon={<Copy size={15} />} onClick={copyLink}>
          {t('ticket.actions.copyLink')}
        </Button>
        {canCancel && (
          <Button variant="danger" size="sm" icon={<XCircle size={15} />} onClick={() => setConfirming(true)}>
            {t('ticket.actions.cancel')}
          </Button>
        )}
      </div>
      <div className="flex flex-wrap justify-center gap-3">
        {booking.status !== 'cancelled' && booking.seats[0] && (
          <Button
            to={`/showtimes/${booking.showtime.id}/seats?view=${booking.seats[0].seatId}`}
            variant="gold"
            icon={<Eye size={16} />}
          >
            {t('ticket.actions.seeSeat')}
          </Button>
        )}
        <Button to="/" variant="primary">
          {t('ticket.actions.bookMore')}
        </Button>
        <Button to="/tickets" variant="ghost" icon={<TicketIcon size={16} />}>
          {t('ticket.actions.myTickets')}
        </Button>
      </div>

      <Dialog
        open={confirming}
        onClose={() => setConfirming(false)}
        title={t('ticket.cancel.title')}
        description={t('ticket.cancel.body')}
        footer={
          <>
            <Button variant="ghost" onClick={() => setConfirming(false)}>
              {t('ticket.cancel.keep')}
            </Button>
            <Button variant="danger" loading={cancelling} onClick={cancel}>
              {t('ticket.cancel.confirm')}
            </Button>
          </>
        }
      />
    </div>
  );
}
