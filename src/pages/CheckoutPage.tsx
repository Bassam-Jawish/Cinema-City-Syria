import { clsx } from 'clsx';
import { ArrowLeft, Banknote, CheckCircle2, Phone, ShieldCheck, Smartphone, User } from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';
import { useEffect, useId, useMemo, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { normalizeSyrianMobile } from '@shared/constants';
import type { PaymentMethod } from '@shared/types';
import { ErrorState, LoadingState } from '@/components/common/PageState';
import { Poster } from '@/components/movie/Poster';
import { HoldTimer } from '@/components/seats/SeatWidgets';
import { Button } from '@/components/ui/Button';
import { Spinner } from '@/components/ui/Spinner';
import { useI18n } from '@/i18n';
import { ApiError, errorCodeOf } from '@/lib/api';
import { useFormat } from '@/lib/format';
import { useDocumentTitle } from '@/lib/hooks';
import { seatPrice, useBooking, useSelectedSeats, useSelectionTotal } from '@/store/booking';

const CUSTOMER_KEY = 'ccs.customer';

function readSavedCustomer(): { name: string; phone: string } {
  try {
    const saved = JSON.parse(localStorage.getItem(CUSTOMER_KEY) ?? 'null') as { name?: string; phone?: string } | null;
    return { name: saved?.name ?? '', phone: saved?.phone ?? '' };
  } catch {
    return { name: '', phone: '' };
  }
}

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export default function CheckoutPage() {
  const { showtimeId = '' } = useParams();
  const navigate = useNavigate();
  const { t, L } = useI18n();
  const f = useFormat();
  useDocumentTitle(`${t('checkout.title')} · ${t('common.brand.name')}`);

  const open = useBooking((s) => s.open);
  const disconnect = useBooking((s) => s.disconnect);
  const load = useBooking((s) => s.load);
  const loadError = useBooking((s) => s.loadError);
  const storeShowtimeId = useBooking((s) => s.showtimeId);
  const detail = useBooking((s) => s.detail);
  const pending = useBooking((s) => s.pending);
  const submitBooking = useBooking((s) => s.submitBooking);
  const seats = useSelectedSeats();
  const total = useSelectionTotal();

  useEffect(() => {
    void open(showtimeId);
    return () => disconnect();
  }, [showtimeId, open, disconnect]);

  const saved = useMemo(readSavedCustomer, []);
  const [name, setName] = useState(saved.name);
  const [phone, setPhone] = useState(saved.phone);
  const [method, setMethod] = useState<PaymentMethod>('box_office');
  const [touched, setTouched] = useState(false);
  const [phase, setPhase] = useState<'idle' | 'paying' | 'confirming' | 'done'>('idle');
  const [error, setError] = useState<string | null>(null);
  const nameRef = useRef<HTMLInputElement>(null);
  const phoneRef = useRef<HTMLInputElement>(null);

  const cleanName = name.trim().replace(/\s+/g, ' ');
  const nameValid = cleanName.length >= 2 && cleanName.length <= 60;
  const normalizedPhone = normalizeSyrianMobile(phone);
  const phoneValid = normalizedPhone !== null;

  const current = storeShowtimeId === showtimeId;
  if (!current || load === 'loading' || load === 'idle') return <LoadingState />;
  if (load === 'error' || !detail) {
    return <ErrorState error={new ApiError(loadError ?? 'INTERNAL', 0, '')} notFoundKey="seats.notFound" onRetry={() => void open(showtimeId)} />;
  }

  const { movie, showtime, hall } = detail;

  if (seats.length === 0 && phase === 'idle') {
    return (
      <div className="mx-auto flex min-h-[50vh] max-w-md flex-col items-center justify-center gap-4 px-6 text-center">
        <h1 className="text-3xl text-cream">{t('checkout.empty.title')}</h1>
        <p className="text-sand">{t('checkout.empty.body')}</p>
        <Button to={`/showtimes/${showtimeId}/seats`}>{t('checkout.empty.action')}</Button>
      </div>
    );
  }

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setTouched(true);
    setError(null);
    if (!nameValid) {
      nameRef.current?.focus();
      return;
    }
    if (!phoneValid || !normalizedPhone) {
      phoneRef.current?.focus();
      return;
    }
    try {
      if (method === 'online_demo') {
        setPhase('paying');
        await wait(1400);
      }
      setPhase('confirming');
      const booking = await submitBooking({ customer: { name: cleanName, phone: normalizedPhone }, paymentMethod: method });
      try {
        localStorage.setItem(CUSTOMER_KEY, JSON.stringify({ name: cleanName, phone: normalizedPhone }));
      } catch {
        // ignore
      }
      setPhase('done');
      navigate(`/tickets/${booking.code}?new=1`, { replace: true });
    } catch (err) {
      setPhase('idle');
      const code = errorCodeOf(err);
      if (code === 'SEAT_UNAVAILABLE') {
        const details = err instanceof ApiError ? (err.details as { seatIds?: string[] } | undefined) : undefined;
        setError(t('checkout.errors.seatsTaken', { seats: (details?.seatIds ?? []).join('، ') || '—' }));
      } else if (code === 'SHOWTIME_CLOSED') {
        setError(t('seats.closed'));
      } else if (code === 'NETWORK') {
        setError(t('common.notices.network'));
      } else {
        setError(t('checkout.errors.generic'));
      }
    }
  };

  const busy = phase !== 'idle';
  const byType = seats.reduce<Record<string, number>>((acc, seat) => {
    acc[seat.type] = (acc[seat.type] ?? 0) + 1;
    return acc;
  }, {});

  return (
    <div className="mx-auto max-w-6xl px-4 pb-10 pt-6 sm:px-6">
      <Link to={`/showtimes/${showtimeId}/seats`} className="inline-flex items-center gap-2 text-sm text-sand hover:text-cream">
        <ArrowLeft size={16} className="rtl:-scale-x-100" aria-hidden="true" />
        {t('checkout.backToSeats')}
      </Link>
      <h1 className="mt-4 text-4xl text-cream sm:text-5xl">{t('checkout.title')}</h1>

      <div className="mt-8 grid gap-8 lg:grid-cols-[1.35fr_1fr] lg:items-start">
        <form onSubmit={submit} noValidate className="space-y-6">
          <section className="surface rounded-3xl p-6 sm:p-7">
            <h2 className="text-xl text-cream">{t('checkout.details.title')}</h2>
            <div className="mt-5 grid gap-5 sm:grid-cols-2">
              <Field
                label={t('checkout.details.name')}
                icon={<User size={16} />}
                error={touched && !nameValid ? t('checkout.details.nameError') : null}
              >
                {(id, describedBy) => (
                  <input
                    ref={nameRef}
                    id={id}
                    aria-describedby={describedBy}
                    aria-invalid={touched && !nameValid}
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    autoComplete="name"
                    maxLength={60}
                    placeholder={t('checkout.details.namePlaceholder')}
                    className="input"
                  />
                )}
              </Field>
              <Field
                label={t('checkout.details.phone')}
                icon={<Phone size={16} />}
                hint={t('checkout.details.phoneHint')}
                error={touched && !phoneValid ? t('checkout.details.phoneError') : null}
              >
                {(id, describedBy) => (
                  <input
                    ref={phoneRef}
                    id={id}
                    aria-describedby={describedBy}
                    aria-invalid={touched && !phoneValid}
                    value={phone}
                    onChange={(e) => setPhone(e.target.value)}
                    dir="ltr"
                    inputMode="tel"
                    autoComplete="tel"
                    maxLength={20}
                    placeholder={t('checkout.details.phonePlaceholder')}
                    className="input nums text-start"
                  />
                )}
              </Field>
            </div>
          </section>

          <section className="surface rounded-3xl p-6 sm:p-7">
            <h2 className="text-xl text-cream">{t('checkout.payment.title')}</h2>
            <div className="mt-5 grid gap-3" role="radiogroup" aria-label={t('checkout.payment.title')}>
              <PaymentOption
                checked={method === 'box_office'}
                onSelect={() => setMethod('box_office')}
                icon={<Banknote size={20} />}
                title={t('checkout.payment.boxOffice')}
                body={t('checkout.payment.boxOfficeBody')}
                tag={t('checkout.payment.recommended')}
              />
              <PaymentOption
                checked={method === 'online_demo'}
                onSelect={() => setMethod('online_demo')}
                icon={<Smartphone size={20} />}
                title={t('checkout.payment.online')}
                body={t('checkout.payment.onlineBody')}
                tag={t('checkout.payment.demoBadge')}
                note={t('checkout.payment.onlineDemoNote')}
              />
            </div>
          </section>

          {error && (
            <p role="alert" className="rounded-2xl border border-bad/40 bg-bad/10 px-4 py-3 text-sm text-bad">
              {error}{' '}
              <Link to={`/showtimes/${showtimeId}/seats`} className="font-semibold underline underline-offset-4">
                {t('checkout.backToSeats')}
              </Link>
            </p>
          )}

          <div className="space-y-3">
            <Button type="submit" size="lg" block loading={busy} disabled={Object.keys(pending).length > 0}>
              {method === 'online_demo' ? t('checkout.confirmPay', { total: f.price(total) }) : t('checkout.confirm')}
            </Button>
            <p className="flex items-start gap-2 text-xs text-dust">
              <ShieldCheck size={14} className="mt-0.5 shrink-0" aria-hidden="true" />
              {t('checkout.terms')}
            </p>
          </div>
        </form>

        <aside className="surface rounded-3xl p-6 lg:sticky lg:top-24">
          <h2 className="text-lg text-cream">{t('checkout.summary.title')}</h2>
          <div className="mt-4 flex gap-4">
            <Poster movie={movie} className="w-20 shrink-0 rounded-xl" />
            <div className="min-w-0 space-y-1 text-sm">
              <p className="font-display text-lg leading-tight text-white">{L(movie.title)}</p>
              <p className="text-cream-200">
                <bdi>{f.dateLong(showtime.startsAt)}</bdi>
              </p>
              <p className="text-sand">
                <bdi className="nums">{f.time(showtime.startsAt)}</bdi> · {L(hall.name)}
                {showtime.format === '3D' && (
                  <span dir="ltr" className="ms-2 rounded bg-velvet px-1 font-mono text-[0.65rem] font-semibold text-white">
                    3D
                  </span>
                )}
              </p>
            </div>
          </div>

          <div className="perforation my-5" />

          <h3 className="text-xs font-semibold text-sand">{t('checkout.summary.seats')}</h3>
          <ul className="mt-2 flex flex-wrap gap-2">
            {seats.map((seat) => (
              <li key={seat.id} className="rounded-lg border border-marquee/40 bg-marquee/10 px-2.5 py-1 font-mono text-sm font-semibold text-marquee-bright" dir="ltr">
                {seat.id}
              </li>
            ))}
          </ul>
          <dl className="mt-4 space-y-2 text-sm">
            {Object.entries(byType).map(([type, count]) => {
              const seat = seats.find((s) => s.type === type)!;
              return (
                <div key={type} className="flex items-center justify-between gap-3">
                  <dt className="text-cream-200">{t(`common.seat.types.${seat.type}`)}</dt>
                  <dd className="nums text-sand">
                    {t('checkout.summary.perSeat', { count, price: f.price(seatPrice(detail, seat)) })}
                  </dd>
                </div>
              );
            })}
            {showtime.format === '3D' && <p className="text-xs text-dust">{t('checkout.summary.glasses')}</p>}
          </dl>
          <div className="mt-5 flex items-end justify-between border-t border-cream/10 pt-4">
            <span className="text-sand">{t('checkout.summary.total')}</span>
            <span className="nums font-display text-3xl text-white">{f.price(total)}</span>
          </div>
          <p className="mt-1 text-end text-[0.7rem] text-dust">{t('common.brand.newCurrencyNote')}</p>
          <div className="mt-5 rounded-2xl border border-cream/10 bg-night-900/60 px-4 py-3">
            <HoldTimer />
          </div>
        </aside>
      </div>

      <AnimatePresence>
        {(phase === 'paying' || phase === 'confirming') && (
          <motion.div
            className="fixed inset-0 z-[85] flex flex-col items-center justify-center gap-4 bg-night-950/80 backdrop-blur-md"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            role="status"
          >
            <Spinner size={40} className="text-velvet" />
            <p className="font-display text-xl text-cream">
              {phase === 'paying' ? t('checkout.paying') : t('checkout.processing')}
            </p>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function Field({
  label,
  icon,
  hint,
  error,
  children,
}: {
  label: string;
  icon: ReactNode;
  hint?: string;
  error: string | null;
  children: (id: string, describedBy: string | undefined) => ReactNode;
}) {
  const id = useId();
  const messageId = useId();
  return (
    <div>
      <label htmlFor={id} className="mb-2 flex items-center gap-2 text-sm font-medium text-cream-200">
        <span className="text-sand" aria-hidden="true">
          {icon}
        </span>
        {label}
      </label>
      {children(id, hint || error ? messageId : undefined)}
      {(error || hint) && (
        <p id={messageId} className={clsx('mt-1.5 text-xs', error ? 'text-bad' : 'text-dust')}>
          {error ?? hint}
        </p>
      )}
    </div>
  );
}

function PaymentOption({
  checked,
  onSelect,
  icon,
  title,
  body,
  tag,
  note,
}: {
  checked: boolean;
  onSelect: () => void;
  icon: ReactNode;
  title: string;
  body: string;
  tag?: string;
  note?: string;
}) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={checked}
      onClick={onSelect}
      className={clsx(
        'flex w-full items-start gap-4 rounded-2xl border p-4 text-start transition-colors',
        checked ? 'border-velvet bg-velvet/10' : 'border-cream/12 hover:border-cream/30',
      )}
    >
      <span
        className={clsx(
          'flex size-11 shrink-0 items-center justify-center rounded-xl',
          checked ? 'bg-velvet text-white' : 'bg-cream/[0.06] text-cream-200',
        )}
      >
        {icon}
      </span>
      <span className="min-w-0 flex-1">
        <span className="flex flex-wrap items-center gap-2">
          <span className="font-semibold text-cream">{title}</span>
          {tag && <span className="rounded-full bg-cream/10 px-2 py-0.5 text-[0.65rem] font-semibold text-cream-200">{tag}</span>}
        </span>
        <span className="mt-1 block text-sm text-sand">{body}</span>
        {note && checked && <span className="mt-2 block text-xs text-marquee-bright">{note}</span>}
      </span>
      <CheckCircle2 size={20} className={clsx('mt-0.5 shrink-0 transition-opacity', checked ? 'text-velvet-bright opacity-100' : 'opacity-0')} aria-hidden="true" />
    </button>
  );
}
