/**
 * Box-office dashboard for cinema staff: live occupancy and revenue per show, a booking search,
 * door check-in by booking reference, the films' trailers, and a demo reset. Protected by a PIN
 * (demo-grade).
 */
import { clsx } from 'clsx';
import {
  Armchair,
  BadgeCheck,
  Banknote,
  Clapperboard,
  DoorOpen,
  ExternalLink,
  LockKeyhole,
  LogOut,
  RotateCcw,
  ScanLine,
  Play,
  Search,
  Ticket,
  Trash2,
  Upload,
  Users,
} from 'lucide-react';
import { useEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { DEFAULT_TRAILER_MAX_MB } from '@shared/constants';
import { addDays, cinemaDate } from '@shared/time';
import type { AdminBookingRow, AdminShowtimeRow, Booking, MovieWithShowtimes, ShowtimeStatus } from '@shared/types';
import { Ltr } from '@/components/common/Bidi';
import { DateStrip } from '@/components/movie/DateStrip';
import { Poster } from '@/components/movie/Poster';
import { Badge, type BadgeTone } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Dialog } from '@/components/ui/Dialog';
import { Skeleton } from '@/components/ui/Spinner';
import { useI18n } from '@/i18n';
import { api, ApiError, errorCodeOf } from '@/lib/api';
import { formatMegabytes, formatPhone, useFormat } from '@/lib/format';
import { useAsync, useDocumentTitle, useInterval } from '@/lib/hooks';
import { notify } from '@/store/notices';

const PIN_KEY = 'ccs.staffPin';

function readPin(): string | null {
  try {
    return sessionStorage.getItem(PIN_KEY);
  } catch {
    return null;
  }
}

export default function AdminPage() {
  const { t } = useI18n();
  useDocumentTitle(`${t('admin.title')} · ${t('common.brand.name')}`);
  const [pin, setPin] = useState<string | null>(readPin);

  const signIn = (value: string) => {
    try {
      sessionStorage.setItem(PIN_KEY, value);
    } catch {
      // ignore
    }
    setPin(value);
  };
  const signOut = () => {
    try {
      sessionStorage.removeItem(PIN_KEY);
    } catch {
      // ignore
    }
    setPin(null);
  };

  return pin ? <Dashboard pin={pin} onSignOut={signOut} /> : <Login onSuccess={signIn} />;
}

// ───────────────────────────── login ─────────────────────────────

function Login({ onSuccess }: { onSuccess: (pin: string) => void }) {
  const { t } = useI18n();
  const [value, setValue] = useState('');
  const [busy, setBusy] = useState(false);
  const [wrong, setWrong] = useState(false);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!value) return;
    setBusy(true);
    setWrong(false);
    try {
      await api.admin.login(value);
      onSuccess(value);
    } catch (error) {
      const code = errorCodeOf(error);
      if (code === 'UNAUTHORIZED' || code === 'RATE_LIMITED') setWrong(true);
      else notify('error', code === 'NETWORK' ? 'network' : 'generic');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mx-auto flex min-h-[70vh] max-w-sm flex-col justify-center px-4">
      <form onSubmit={submit} className="surface rounded-3xl p-7 text-center">
        <span className="mx-auto flex size-14 items-center justify-center rounded-2xl bg-velvet/15 text-velvet-bright">
          <LockKeyhole size={26} aria-hidden="true" />
        </span>
        <h1 className="mt-5 text-3xl text-cream">{t('admin.login.title')}</h1>
        <p className="mt-2 text-sm text-sand">{t('admin.login.body')}</p>
        <label className="mt-6 block text-start text-sm text-cream-200" htmlFor="staff-pin">
          {t('admin.login.pin')}
        </label>
        <input
          id="staff-pin"
          type="password"
          inputMode="numeric"
          autoComplete="off"
          dir="ltr"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          aria-invalid={wrong}
          className="input mt-2 text-center font-mono text-lg tracking-[0.4em]"
          autoFocus
        />
        {wrong && <p className="mt-2 text-sm text-bad">{t('common.notices.wrongPin')}</p>}
        <Button type="submit" block className="mt-5" loading={busy}>
          {t('admin.login.submit')}
        </Button>
        <p className="mt-4 text-xs text-dust">{t('admin.login.demoHint')}</p>
      </form>
    </div>
  );
}

// ───────────────────────────── dashboard ─────────────────────────────

function useDebounced<T>(value: T, ms: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const id = window.setTimeout(() => setDebounced(value), ms);
    return () => window.clearTimeout(id);
  }, [value, ms]);
  return debounced;
}

function Dashboard({ pin, onSignOut }: { pin: string; onSignOut: () => void }) {
  const { t } = useI18n();
  const f = useFormat();
  const today = cinemaDate(Date.now());
  const dates = useMemo(() => Array.from({ length: 7 }, (_, i) => addDays(today, i)), [today]);
  const [date, setDate] = useState(today);
  const [query, setQuery] = useState('');
  const q = useDebounced(query.trim(), 300);
  const [resetOpen, setResetOpen] = useState(false);
  const [resetting, setResetting] = useState(false);

  const overview = useAsync((signal) => api.admin.overview(pin, date, signal), [pin, date]);
  const bookings = useAsync(
    (signal) => api.admin.bookings(pin, { date: q ? undefined : date, q: q || undefined, limit: 60 }, signal),
    [pin, date, q],
  );

  // Live: refresh every few seconds so sales from other devices appear on their own.
  useInterval(() => {
    overview.reload();
    bookings.reload();
  }, 5000);

  const unauthorized = errorCodeOf(overview.error) === 'UNAUTHORIZED' || errorCodeOf(bookings.error) === 'UNAUTHORIZED';
  useEffect(() => {
    if (unauthorized) onSignOut();
  }, [unauthorized, onSignOut]);

  const refresh = () => {
    overview.reload();
    bookings.reload();
  };

  const reset = async () => {
    setResetting(true);
    try {
      await api.admin.resetDemo(pin);
      notify('success', 'demoReset');
      setResetOpen(false);
      refresh();
    } catch (error) {
      notify('error', errorCodeOf(error) === 'NETWORK' ? 'network' : 'generic');
    } finally {
      setResetting(false);
    }
  };

  const data = overview.data;
  return (
    <div className="mx-auto max-w-7xl px-4 pb-10 pt-6 sm:px-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-4xl text-cream">{t('admin.title')}</h1>
          <p className="mt-1 flex items-center gap-2 text-sand">
            {t('admin.subtitle')}
            <span className="inline-flex items-center gap-1.5 text-xs text-ok">
              <span className="size-1.5 animate-pulse rounded-full bg-ok" />
              {t('admin.autoRefresh')}
            </span>
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="secondary" size="sm" icon={<RotateCcw size={15} />} onClick={() => setResetOpen(true)}>
            {t('admin.reset.button')}
          </Button>
          <Button variant="ghost" size="sm" icon={<LogOut size={15} className="rtl:-scale-x-100" />} onClick={onSignOut}>
            {t('admin.login.signOut')}
          </Button>
        </div>
      </div>

      <DateStrip dates={dates} value={date} onChange={setDate} className="mt-6" />

      <div className="mt-6 grid grid-cols-2 gap-3 md:grid-cols-5">
        <Kpi icon={<Ticket size={18} />} label={t('admin.kpi.tickets')} value={data ? f.number(data.totals.tickets) : null} />
        <Kpi icon={<Banknote size={18} />} label={t('admin.kpi.revenue')} value={data ? f.price(data.totals.revenue) : null} />
        <Kpi
          icon={<Users size={18} />}
          label={t('admin.kpi.occupancy')}
          value={data ? `${Math.round(data.totals.occupancy * 100)}%` : null}
          bar={data?.totals.occupancy}
        />
        <Kpi icon={<BadgeCheck size={18} />} label={t('admin.kpi.checkedIn')} value={data ? f.number(data.totals.checkedIn) : null} />
        <Kpi
          icon={<Armchair size={18} />}
          label={t('admin.kpi.holding')}
          value={data ? f.number(data.totals.seatsHeldNow) : null}
          highlight={Boolean(data && data.totals.seatsHeldNow > 0)}
        />
      </div>

      <div className="mt-8 grid gap-6 xl:grid-cols-[1.7fr_1fr]">
        <ShowsTable rows={data?.showtimes ?? null} date={date} today={today} />
        <CheckInPanel pin={pin} onDone={refresh} />
      </div>

      <BookingsTable
        pin={pin}
        rows={bookings.data?.bookings ?? null}
        total={bookings.data?.total ?? 0}
        query={query}
        onQuery={setQuery}
        onChanged={refresh}
      />

      <TrailersPanel pin={pin} />

      <Dialog
        open={resetOpen}
        onClose={() => setResetOpen(false)}
        title={t('admin.reset.title')}
        description={t('admin.reset.body')}
        footer={
          <>
            <Button variant="ghost" onClick={() => setResetOpen(false)}>
              {t('common.actions.cancel')}
            </Button>
            <Button variant="danger" loading={resetting} onClick={reset}>
              {t('admin.reset.confirm')}
            </Button>
          </>
        }
      />
    </div>
  );
}

function Kpi({
  icon,
  label,
  value,
  bar,
  highlight = false,
}: {
  icon: ReactNode;
  label: string;
  value: string | null;
  bar?: number;
  highlight?: boolean;
}) {
  return (
    <div className={clsx('surface rounded-2xl p-4', highlight && 'ring-1 ring-marquee/40')}>
      <div className="flex items-center gap-2 text-sand">
        <span className={clsx(highlight ? 'text-marquee' : 'text-velvet-bright')} aria-hidden="true">
          {icon}
        </span>
        <span className="text-xs">{label}</span>
      </div>
      {value === null ? (
        <Skeleton className="mt-3 h-8 w-24" />
      ) : (
        <p className="nums mt-2 font-display text-[clamp(1.35rem,2.1vw,1.875rem)] whitespace-nowrap text-white">{value}</p>
      )}
      {bar !== undefined && (
        <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-cream/10">
          <div className="h-full rounded-full bg-velvet transition-[width] duration-700" style={{ width: `${Math.round(bar * 100)}%` }} />
        </div>
      )}
    </div>
  );
}

const showtimeTone: Record<ShowtimeStatus, BadgeTone> = {
  open: 'ok',
  filling_fast: 'warn',
  sold_out: 'bad',
  closed: 'neutral',
};

function ShowsTable({ rows, date, today }: { rows: AdminShowtimeRow[] | null; date: string; today: string }) {
  const { t, L } = useI18n();
  const f = useFormat();
  return (
    <section className="surface overflow-hidden rounded-3xl">
      <h2 className="px-5 pt-5 text-xl text-cream">
        {date === today ? t('admin.shows.title') : t('admin.shows.titleFor', { date: f.dayShort(`${date}T09:00:00Z`) })}
      </h2>
      <div className="mt-3 overflow-x-auto">
        <table className="w-full min-w-[42rem] text-sm">
          <thead className="text-xs text-sand">
            <tr className="border-b border-cream/10">
              <th className="px-5 py-2 text-start font-medium">{t('admin.shows.time')}</th>
              <th className="px-3 py-2 text-start font-medium">{t('admin.shows.film')}</th>
              <th className="px-3 py-2 text-start font-medium">{t('admin.shows.hall')}</th>
              <th className="px-3 py-2 text-start font-medium">{t('admin.shows.occupancy')}</th>
              <th className="px-3 py-2 text-end font-medium">{t('admin.shows.revenue')}</th>
              <th className="px-5 py-2 text-end font-medium">
                <span className="sr-only">{t('admin.shows.open')}</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {rows === null ? (
              Array.from({ length: 4 }, (_, i) => (
                <tr key={i}>
                  <td colSpan={6} className="px-5 py-3">
                    <Skeleton className="h-6 w-full" />
                  </td>
                </tr>
              ))
            ) : rows.length === 0 ? (
              <tr>
                <td colSpan={6} className="px-5 py-6 text-center text-sand">
                  {t('admin.shows.none')}
                </td>
              </tr>
            ) : (
              rows.map((row) => (
                <tr key={row.id} className={clsx('border-b border-cream/[0.06] last:border-0', row.status === 'closed' && 'opacity-55')}>
                  <td className="px-5 py-3 whitespace-nowrap">
                    <bdi className="nums font-semibold text-cream">{f.time(row.startsAt)}</bdi>
                    {row.format === '3D' && (
                      <span dir="ltr" className="ms-2 rounded bg-velvet px-1 font-mono text-[0.65rem] font-semibold text-white">
                        3D
                      </span>
                    )}
                  </td>
                  <td className="px-3 py-3 text-cream">{L(row.movieTitle)}</td>
                  <td className="px-3 py-3 whitespace-nowrap text-sand">{L(row.hall.name)}</td>
                  <td className="px-3 py-3">
                    <div className="flex items-center gap-3">
                      <div className="relative h-2 w-28 overflow-hidden rounded-full bg-cream/10" title={`${row.seatsBooked} / ${row.seatsTotal}`}>
                        <div className="absolute inset-y-0 start-0 bg-velvet" style={{ width: `${(row.seatsBooked / row.seatsTotal) * 100}%` }} />
                        <div
                          className="absolute inset-y-0 bg-marquee/80"
                          style={{
                            insetInlineStart: `${(row.seatsBooked / row.seatsTotal) * 100}%`,
                            width: `${(row.seatsHeld / row.seatsTotal) * 100}%`,
                          }}
                        />
                      </div>
                      <span className="nums text-xs text-cream-200" dir="ltr">
                        {row.seatsBooked}/{row.seatsTotal}
                      </span>
                      <Badge tone={showtimeTone[row.status]}>{t(`common.showtime.status.${row.status}`)}</Badge>
                    </div>
                  </td>
                  <td className="nums px-3 py-3 text-end whitespace-nowrap text-cream-200">{f.price(row.revenue)}</td>
                  <td className="px-5 py-3 text-end whitespace-nowrap">
                    {row.status !== 'closed' && (
                      <a
                        href={`/showtimes/${row.id}/seats`}
                        target="_blank"
                        rel="noreferrer"
                        className="inline-flex items-center gap-1 text-xs font-semibold text-velvet-bright hover:text-white"
                      >
                        {t('admin.shows.open')}
                        <ExternalLink size={12} aria-hidden="true" />
                      </a>
                    )}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function CheckInPanel({ pin, onDone }: { pin: string; onDone: () => void }) {
  const { t } = useI18n();
  const [value, setValue] = useState('');
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ tone: 'ok' | 'warn' | 'bad'; text: string } | null>(null);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const code = value.trim().toUpperCase();
    if (!code) return;
    setBusy(true);
    setResult(null);
    try {
      const booking: Booking = await api.admin.checkIn(pin, code);
      setResult({
        tone: 'ok',
        text: t('admin.checkIn.success', { name: booking.customer.name, seats: booking.seats.map((s) => s.seatId).join(' ') }),
      });
      setValue('');
      notify('success', 'checkedIn');
      onDone();
    } catch (error) {
      const errorCode = errorCodeOf(error);
      if (errorCode === 'NOT_FOUND') setResult({ tone: 'bad', text: t('admin.checkIn.notFound') });
      else if (errorCode === 'BOOKING_NOT_CHECKINABLE') {
        const details = (error as { details?: { status?: string } }).details;
        setResult({ tone: 'warn', text: details?.status === 'cancelled' ? t('admin.checkIn.cancelled') : t('admin.checkIn.alreadyIn') });
      } else setResult({ tone: 'bad', text: t('common.errors.generic') });
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="surface rounded-3xl p-5">
      <h2 className="flex items-center gap-2 text-xl text-cream">
        <DoorOpen size={20} className="text-velvet-bright" aria-hidden="true" />
        {t('admin.checkIn.title')}
      </h2>
      <p className="mt-1 text-sm text-sand">{t('admin.checkIn.body')}</p>
      <form onSubmit={submit} className="mt-4 flex gap-2">
        <div className="relative flex-1">
          <ScanLine size={16} className="pointer-events-none absolute start-3 top-1/2 -translate-y-1/2 text-dust" aria-hidden="true" />
          <input
            value={value}
            onChange={(e) => setValue(e.target.value)}
            placeholder={t('admin.checkIn.placeholder')}
            dir="ltr"
            autoCapitalize="characters"
            className="input ps-9 font-mono uppercase"
            aria-label={t('admin.checkIn.title')}
          />
        </div>
        <Button type="submit" loading={busy}>
          {t('admin.checkIn.submit')}
        </Button>
      </form>
      {result && (
        <p
          role="status"
          className={clsx(
            'mt-4 rounded-2xl border px-4 py-4 text-base font-semibold',
            result.tone === 'ok' && 'border-ok/40 bg-ok/15 text-ok',
            result.tone === 'warn' && 'border-warn/40 bg-warn/10 text-warn',
            result.tone === 'bad' && 'border-bad/40 bg-bad/10 text-bad',
          )}
        >
          {result.text}
        </p>
      )}
    </section>
  );
}

// ───────────────────────────── trailers ─────────────────────────────

/** Upload, replace or remove the video each film plays on the hall's screen when a customer sits down. */
function TrailersPanel({ pin }: { pin: string }) {
  const { t, L } = useI18n();
  const movies = useAsync((signal) => api.listMovies(signal), []);
  const [removeTarget, setRemoveTarget] = useState<MovieWithShowtimes | null>(null);
  const [removing, setRemoving] = useState(false);

  const remove = async () => {
    if (!removeTarget) return;
    setRemoving(true);
    try {
      await api.admin.removeTrailer(pin, removeTarget.id);
      notify('success', 'trailerRemoved');
      setRemoveTarget(null);
      movies.reload();
    } catch (error) {
      notify('error', errorCodeOf(error) === 'NETWORK' ? 'network' : 'generic');
    } finally {
      setRemoving(false);
    }
  };

  return (
    <section className="surface mt-6 rounded-3xl p-5" aria-labelledby="trailers-title">
      <h2 id="trailers-title" className="flex items-center gap-2 text-xl text-cream">
        <Clapperboard size={20} className="text-velvet-bright" aria-hidden="true" />
        {t('admin.trailers.title')}
      </h2>
      <p className="mt-1 max-w-3xl text-sm text-sand">{t('admin.trailers.body', { max: DEFAULT_TRAILER_MAX_MB })}</p>
      {movies.data ? (
        <ul className="mt-5 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {movies.data.movies.map((movie) => (
            <TrailerCard key={movie.id} pin={pin} movie={movie} onChanged={movies.reload} onRemove={() => setRemoveTarget(movie)} />
          ))}
        </ul>
      ) : movies.error ? (
        <p className="mt-5 text-sm text-bad">{t('common.errors.generic')}</p>
      ) : (
        <div className="mt-5 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {Array.from({ length: 6 }, (_, i) => (
            <Skeleton key={i} className="h-28 rounded-2xl" />
          ))}
        </div>
      )}
      <Dialog
        open={removeTarget !== null}
        onClose={() => setRemoveTarget(null)}
        title={t('admin.trailers.removeTitle')}
        description={removeTarget ? `${L(removeTarget.title)} — ${t('admin.trailers.removeBody')}` : undefined}
        footer={
          <>
            <Button variant="ghost" onClick={() => setRemoveTarget(null)}>
              {t('common.actions.cancel')}
            </Button>
            <Button variant="danger" loading={removing} onClick={remove}>
              {t('admin.trailers.remove')}
            </Button>
          </>
        }
      />
    </section>
  );
}

function TrailerCard({
  pin,
  movie,
  onChanged,
  onRemove,
}: {
  pin: string;
  movie: MovieWithShowtimes;
  onChanged: () => void;
  onRemove: () => void;
}) {
  const { t, L, lang } = useI18n();
  const f = useFormat();
  const input = useRef<HTMLInputElement>(null);
  const upload = useRef<AbortController | null>(null);
  const [progress, setProgress] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const trailer = movie.trailer;

  // Leaving the page cancels an upload in flight.
  useEffect(() => () => upload.current?.abort(), []);

  const send = async (file: File) => {
    setError(null);
    setProgress(0);
    const controller = new AbortController();
    upload.current = controller;
    try {
      await api.admin.uploadTrailer(pin, movie.id, file, setProgress, controller.signal);
      notify('success', 'trailerUploaded', { title: L(movie.title) });
      onChanged();
    } catch (failure) {
      if (failure instanceof DOMException && failure.name === 'AbortError') return;
      const code = errorCodeOf(failure);
      if (code === 'FILE_TOO_LARGE') {
        const max = (failure as ApiError).details as { maxMegabytes?: number } | undefined;
        setError(t('admin.trailers.tooLarge', { max: max?.maxMegabytes ?? DEFAULT_TRAILER_MAX_MB }));
      } else if (code === 'UNSUPPORTED_FILE') {
        setError(t('admin.trailers.unsupported'));
      } else if (code === 'UNAUTHORIZED') {
        notify('error', 'wrongPin');
      } else {
        setError(code === 'NETWORK' ? t('common.errors.network') : t('admin.trailers.failed'));
      }
    } finally {
      upload.current = null;
      setProgress(null);
      if (input.current) input.current.value = '';
    }
  };

  const megabytes = trailer ? t('admin.trailers.megabytes', { size: formatMegabytes(trailer.size, lang) }) : '';

  return (
    <li className="flex gap-3 rounded-2xl border border-cream/10 bg-night-900/50 p-3">
      <Poster movie={movie} className="w-16 shrink-0 self-start rounded-lg" />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <p className="truncate font-semibold text-cream">{L(movie.title)}</p>
          {movie.status === 'coming_soon' && <Badge>{t('admin.trailers.comingSoon')}</Badge>}
        </div>
        <p className={clsx('mt-0.5 text-xs', trailer ? 'text-ok' : 'text-sand')}>
          {trailer ? t('admin.trailers.ready', { size: megabytes, date: f.dateTime(trailer.updatedAt) }) : t('admin.trailers.none')}
        </p>

        {progress !== null ? (
          <div className="mt-3">
            <div
              role="progressbar"
              aria-label={L(movie.title)}
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={Math.round(progress * 100)}
              className="h-1.5 overflow-hidden rounded-full bg-cream/10"
            >
              <div className="h-full rounded-full bg-marquee transition-[width] duration-200" style={{ width: `${progress * 100}%` }} />
            </div>
            <div className="mt-1.5 flex items-center justify-between gap-2 text-xs text-sand">
              <span className="nums">{t('admin.trailers.uploading', { percent: Math.round(progress * 100) })}</span>
              <button type="button" onClick={() => upload.current?.abort()} className="text-sand underline-offset-2 hover:text-cream hover:underline">
                {t('admin.trailers.cancel')}
              </button>
            </div>
          </div>
        ) : (
          <div className="mt-2.5 flex flex-wrap gap-1.5">
            <Button
              size="sm"
              variant={trailer ? 'secondary' : 'primary'}
              icon={<Upload size={14} aria-hidden="true" />}
              onClick={() => input.current?.click()}
            >
              {trailer ? t('admin.trailers.replace') : t('admin.trailers.upload')}
            </Button>
            {trailer && (
              <Button
                size="sm"
                variant="ghost"
                icon={<Play size={14} aria-hidden="true" />}
                onClick={() => window.open(trailer.url, '_blank', 'noopener,noreferrer')}
              >
                {t('admin.trailers.watch')}
              </Button>
            )}
            {trailer && (
              <Button size="sm" variant="ghost" icon={<Trash2 size={14} aria-hidden="true" />} onClick={onRemove}>
                {t('admin.trailers.remove')}
              </Button>
            )}
          </div>
        )}
        {error && (
          <p role="alert" className="mt-2 text-xs text-bad">
            {error}
          </p>
        )}
      </div>
      <input
        ref={input}
        type="file"
        accept="video/mp4,video/webm,.mp4,.m4v,.webm"
        className="hidden"
        aria-label={`${t('admin.trailers.upload')} — ${L(movie.title)}`}
        onChange={(event) => {
          const file = event.target.files?.[0];
          if (file) void send(file);
        }}
      />
    </li>
  );
}

function BookingsTable({
  pin,
  rows,
  total,
  query,
  onQuery,
  onChanged,
}: {
  pin: string;
  rows: AdminBookingRow[] | null;
  total: number;
  query: string;
  onQuery: (q: string) => void;
  onChanged: () => void;
}) {
  const { t, L } = useI18n();
  const f = useFormat();
  const [busyCode, setBusyCode] = useState<string | null>(null);
  const [cancelTarget, setCancelTarget] = useState<AdminBookingRow | null>(null);

  const act = async (code: string, action: 'checkIn' | 'cancel') => {
    setBusyCode(code);
    try {
      if (action === 'checkIn') await api.admin.checkIn(pin, code);
      else await api.admin.cancel(pin, code);
      notify('success', action === 'checkIn' ? 'checkedIn' : 'bookingCancelled');
      setCancelTarget(null);
      onChanged();
    } catch (error) {
      notify('error', errorCodeOf(error) === 'NETWORK' ? 'network' : 'generic');
    } finally {
      setBusyCode(null);
    }
  };

  const statusTone = (status: Booking['status']): BadgeTone => (status === 'confirmed' ? 'ok' : status === 'checked_in' ? 'info' : 'bad');

  return (
    <section className="surface mt-6 overflow-hidden rounded-3xl">
      <div className="flex flex-wrap items-center justify-between gap-3 px-5 pt-5">
        <h2 className="text-xl text-cream">{t('admin.bookings.title')}</h2>
        <div className="relative w-full sm:w-80">
          <Search size={16} className="pointer-events-none absolute start-3 top-1/2 -translate-y-1/2 text-dust" aria-hidden="true" />
          <input
            value={query}
            onChange={(e) => onQuery(e.target.value)}
            placeholder={t('admin.bookings.search')}
            className="input h-10 ps-9 text-sm"
            aria-label={t('admin.bookings.search')}
          />
        </div>
      </div>
      <div className="mt-3 overflow-x-auto">
        <table className="w-full min-w-[56rem] text-sm">
          <thead className="text-xs text-sand">
            <tr className="border-b border-cream/10">
              <th className="px-5 py-2 text-start font-medium">{t('admin.bookings.ref')}</th>
              <th className="px-3 py-2 text-start font-medium">{t('admin.bookings.customer')}</th>
              <th className="px-3 py-2 text-start font-medium">{t('admin.bookings.show')}</th>
              <th className="px-3 py-2 text-start font-medium">{t('admin.bookings.seats')}</th>
              <th className="px-3 py-2 text-end font-medium">{t('admin.bookings.total')}</th>
              <th className="px-3 py-2 text-start font-medium">{t('admin.bookings.payment')}</th>
              <th className="px-3 py-2 text-start font-medium">{t('admin.bookings.status')}</th>
              <th className="px-5 py-2 text-end font-medium">{t('admin.bookings.actions')}</th>
            </tr>
          </thead>
          <tbody>
            {rows === null ? (
              Array.from({ length: 5 }, (_, i) => (
                <tr key={i}>
                  <td colSpan={8} className="px-5 py-3">
                    <Skeleton className="h-6 w-full" />
                  </td>
                </tr>
              ))
            ) : rows.length === 0 ? (
              <tr>
                <td colSpan={8} className="px-5 py-6 text-center text-sand">
                  {t('admin.bookings.none')}
                </td>
              </tr>
            ) : (
              rows.map((row) => (
                <tr key={row.code} className="border-b border-cream/[0.06] last:border-0">
                  <td className="px-5 py-3 whitespace-nowrap">
                    <Ltr className="font-mono font-semibold text-cream">{row.code}</Ltr>
                    {row.seeded && <span className="ms-2 text-[0.65rem] text-dust">{t('admin.bookings.demoData')}</span>}
                  </td>
                  <td className="px-3 py-3">
                    <p className="text-cream">
                      <bdi>{row.customer.name}</bdi>
                    </p>
                    <Ltr className="nums text-xs text-sand">{formatPhone(row.customer.phone)}</Ltr>
                  </td>
                  <td className="px-3 py-3">
                    <p className="text-cream-200">{L(row.movie.title)}</p>
                    <p className="text-xs text-sand">
                      <bdi>{f.dayShort(row.showtime.startsAt)}</bdi> · <bdi className="nums">{f.time(row.showtime.startsAt)}</bdi>
                    </p>
                  </td>
                  <td className="px-3 py-3">
                    <Ltr className="font-mono text-xs text-cream-200">{row.seats.map((s) => s.seatId).join(' ')}</Ltr>
                  </td>
                  <td className="nums px-3 py-3 text-end whitespace-nowrap text-cream-200">{f.price(row.total)}</td>
                  <td className="px-3 py-3 text-xs">
                    <span className={row.payment.status === 'paid' ? 'text-ok' : 'text-warn'}>
                      {t(`common.booking.payment.${row.payment.status}`)}
                    </span>
                    {row.payment.method === 'online_demo' && <span className="ms-1 text-dust">· {t('admin.bookings.online')}</span>}
                  </td>
                  <td className="px-3 py-3">
                    <Badge tone={statusTone(row.status)}>{t(`common.booking.status.${row.status}`)}</Badge>
                  </td>
                  <td className="px-5 py-3 text-end">
                    {row.status === 'confirmed' && (
                      <div className="inline-flex gap-1.5">
                        <Button size="sm" variant="secondary" loading={busyCode === row.code} onClick={() => act(row.code, 'checkIn')}>
                          {t('admin.bookings.checkIn')}
                        </Button>
                        <Button size="sm" variant="ghost" onClick={() => setCancelTarget(row)}>
                          {t('admin.bookings.cancel')}
                        </Button>
                      </div>
                    )}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
      {rows && rows.length > 0 && (
        <p className="px-5 py-3 text-xs text-dust">{t('admin.bookings.showing', { shown: rows.length, total })}</p>
      )}

      <Dialog
        open={cancelTarget !== null}
        onClose={() => setCancelTarget(null)}
        title={t('ticket.cancel.title')}
        description={cancelTarget ? `${cancelTarget.code} · ${cancelTarget.customer.name}` : undefined}
        footer={
          <>
            <Button variant="ghost" onClick={() => setCancelTarget(null)}>
              {t('ticket.cancel.keep')}
            </Button>
            <Button
              variant="danger"
              loading={cancelTarget !== null && busyCode === cancelTarget.code}
              onClick={() => cancelTarget && act(cancelTarget.code, 'cancel')}
            >
              {t('ticket.cancel.confirm')}
            </Button>
          </>
        }
      />
    </section>
  );
}
