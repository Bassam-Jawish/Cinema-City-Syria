import { clsx } from 'clsx';
import { ArrowLeft, ArrowRight, Armchair, Clapperboard, Eye, Ticket } from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';
import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router';
import type { HallSummary, MovieWithShowtimes, ShowtimeSummary } from '@shared/types';
import { cinemaDate } from '@shared/time';
import { ErrorState } from '@/components/common/PageState';
import { MovieCard } from '@/components/movie/MovieCard';
import { MovieMeta } from '@/components/movie/MovieMeta';
import { Backdrop } from '@/components/movie/Poster';
import { ShowtimeChip } from '@/components/movie/ShowtimeChip';
import { Button } from '@/components/ui/Button';
import { Skeleton } from '@/components/ui/Spinner';
import { useI18n } from '@/i18n';
import { api } from '@/lib/api';
import { useAsync, useDocumentTitle } from '@/lib/hooks';

export default function HomePage() {
  const { t } = useI18n();
  useDocumentTitle(`${t('common.brand.name')} · ${t('common.brand.city')}`);
  const movies = useAsync((signal) => api.listMovies(signal), []);
  const halls = useAsync((signal) => api.listHalls(signal), []);

  const nowShowing = useMemo(() => movies.data?.movies.filter((m) => m.status === 'now_showing') ?? [], [movies.data]);
  const comingSoon = useMemo(() => movies.data?.movies.filter((m) => m.status === 'coming_soon') ?? [], [movies.data]);
  const featured = useMemo(() => {
    const list = nowShowing.filter((m) => m.featured);
    return (list.length > 0 ? list : nowShowing).slice(0, 3);
  }, [nowShowing]);
  const firstShowtime = useMemo(
    () =>
      nowShowing
        .flatMap((m) => m.nextShowtimes)
        .filter((s) => s.status === 'open' || s.status === 'filling_fast')
        .sort((a, b) => a.startsAt.localeCompare(b.startsAt))[0] ?? null,
    [nowShowing],
  );

  if (movies.error && !movies.data) {
    return <ErrorState error={movies.error} onRetry={movies.reload} />;
  }

  return (
    <>
      <Hero movies={featured} loading={movies.loading && !movies.data} />
      <HowItWorks showtime={firstShowtime} />

      <section id="now-showing" className="mx-auto max-w-7xl scroll-mt-24 px-4 pt-20 sm:px-6">
        <SectionHeading title={t('home.sections.nowShowing')} subtitle={t('home.sections.nowShowingSub')} />
        {movies.loading && !movies.data ? (
          <div className="grid grid-cols-2 gap-x-5 gap-y-10 sm:grid-cols-3 lg:grid-cols-4">
            {Array.from({ length: 8 }, (_, i) => (
              <div key={i} className="space-y-3">
                <Skeleton className="aspect-[2/3] w-full rounded-2xl" />
                <Skeleton className="h-4 w-2/3" />
              </div>
            ))}
          </div>
        ) : nowShowing.length === 0 ? (
          <p className="text-sand">{t('home.empty')}</p>
        ) : (
          <div className="grid grid-cols-2 gap-x-5 gap-y-10 sm:grid-cols-3 lg:grid-cols-4">
            {nowShowing.map((movie, index) => (
              <MovieCard key={movie.id} movie={movie} index={index} />
            ))}
          </div>
        )}
      </section>

      {comingSoon.length > 0 && (
        <section className="mx-auto max-w-7xl px-4 pt-20 sm:px-6">
          <SectionHeading title={t('home.sections.comingSoon')} subtitle={t('home.sections.comingSoonSub')} />
          <div className="grid grid-cols-2 gap-x-5 gap-y-10 sm:grid-cols-3 lg:grid-cols-4">
            {comingSoon.map((movie, index) => (
              <MovieCard key={movie.id} movie={movie} index={index} />
            ))}
          </div>
        </section>
      )}

      {halls.data && halls.data.halls.length > 0 && <Halls halls={halls.data.halls} movies={nowShowing} />}
    </>
  );
}

function SectionHeading({ title, subtitle }: { title: string; subtitle?: string }) {
  return (
    <div className="mb-8 flex items-end justify-between gap-4">
      <div>
        <h2 className="flex items-center gap-3 text-3xl text-cream sm:text-4xl">
          <span className="inline-block h-7 w-1.5 rounded-full bg-velvet" aria-hidden="true" />
          {title}
        </h2>
        {subtitle && <p className="mt-2 text-sand">{subtitle}</p>}
      </div>
    </div>
  );
}

// ───────────────────────────── hero ─────────────────────────────

function Hero({ movies, loading }: { movies: MovieWithShowtimes[]; loading: boolean }) {
  const { t, L } = useI18n();
  const [index, setIndex] = useState(0);
  const [paused, setPaused] = useState(false);
  const movie = movies[index % Math.max(1, movies.length)];

  useEffect(() => {
    if (paused || movies.length < 2) return;
    const id = window.setInterval(() => setIndex((i) => (i + 1) % movies.length), 7000);
    return () => window.clearInterval(id);
  }, [paused, movies.length]);

  const today = cinemaDate(Date.now());
  const todays = movie?.nextShowtimes.filter((s) => cinemaDate(s.startsAt) === today) ?? [];
  const upcoming: ShowtimeSummary[] = todays.length > 0 ? todays : (movie?.nextShowtimes ?? []);

  return (
    <section
      className="relative -mt-18 flex min-h-[min(86svh,54rem)] items-end overflow-hidden pt-18"
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
      aria-roledescription="carousel"
    >
      <div className="absolute inset-0 bg-night-950">
        <AnimatePresence initial={false}>
          {movie && (
            <motion.div
              key={movie.id}
              className="absolute inset-0"
              initial={{ opacity: 0, scale: 1.06 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0 }}
              transition={{ opacity: { duration: 1.1 }, scale: { duration: 7.5, ease: 'linear' } }}
            >
              <Backdrop movie={movie} eager />
            </motion.div>
          )}
        </AnimatePresence>
        <div className="absolute inset-0 bg-linear-to-r from-night-950 via-night-950/75 to-night-950/10 rtl:bg-linear-to-l" />
        <div className="absolute inset-x-0 bottom-0 h-2/5 bg-linear-to-t from-night-950 to-transparent" />
        <div className="absolute inset-x-0 top-0 h-40 bg-linear-to-b from-night-950/80 to-transparent" />
      </div>

      <div className="relative mx-auto w-full max-w-7xl px-4 pb-16 sm:px-6 sm:pb-20">
        {loading || !movie ? (
          <div className="max-w-2xl space-y-5">
            <Skeleton className="h-5 w-32" />
            <Skeleton className="h-16 w-4/5" />
            <Skeleton className="h-5 w-3/5" />
          </div>
        ) : (
          <AnimatePresence mode="wait">
            <motion.div
              key={movie.id}
              className="max-w-2xl"
              initial={{ opacity: 0, y: 24 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -12 }}
              transition={{ duration: 0.6, ease: [0.16, 1, 0.3, 1] }}
            >
              <p className="mb-4 inline-flex items-center gap-2 rounded-full border border-velvet/50 bg-velvet/15 px-3 py-1 text-xs font-semibold text-[#ff9a9f]">
                <span className="size-1.5 animate-pulse rounded-full bg-velvet-bright" />
                {t('home.hero.eyebrow')}
              </p>
              <h1 className="text-5xl text-white sm:text-6xl lg:text-7xl">{L(movie.title)}</h1>
              <p className="mt-4 max-w-xl text-lg text-cream-200 sm:text-xl">{L(movie.tagline)}</p>
              <MovieMeta movie={movie} showFormats showScore maxGenres={3} className="mt-5" />

              <div className="mt-8 flex flex-wrap items-center gap-3">
                <Button
                  size="lg"
                  to={`/movies/${movie.id}`}
                  iconEnd={<ArrowRight size={18} className="rtl:-scale-x-100" aria-hidden="true" />}
                >
                  {t('common.actions.bookNow')}
                </Button>
              </div>

              {upcoming.length > 0 && (
                <div className="mt-8">
                  <p className="mb-3 text-xs font-semibold text-sand">
                    {todays.length > 0 ? t('home.hero.todayAt') : t('home.hero.nextShows')}
                  </p>
                  <div className="flex flex-wrap gap-2">
                    {upcoming.slice(0, 4).map((showtime) => (
                      <ShowtimeChip key={showtime.id} showtime={showtime} showHall />
                    ))}
                  </div>
                </div>
              )}
            </motion.div>
          </AnimatePresence>
        )}

        {movies.length > 1 && (
          <div className="mt-10 flex items-center gap-2" role="tablist">
            {movies.map((m, i) => (
              <button
                key={m.id}
                type="button"
                role="tab"
                aria-selected={i === index}
                aria-label={t('home.hero.slide', { index: i + 1, count: movies.length })}
                onClick={() => setIndex(i)}
                className={clsx(
                  'h-1.5 rounded-full transition-all duration-500',
                  i === index ? 'w-10 bg-velvet' : 'w-5 bg-cream/25 hover:bg-cream/50',
                )}
              />
            ))}
          </div>
        )}
      </div>
    </section>
  );
}

// ───────────────────────────── how it works ─────────────────────────────

function HowItWorks({ showtime }: { showtime: ShowtimeSummary | null }) {
  const { t } = useI18n();
  const steps = [
    { icon: <Clapperboard size={22} />, key: 'step1' },
    { icon: <Armchair size={22} />, key: 'step2' },
    { icon: <Eye size={22} />, key: 'step3' },
    { icon: <Ticket size={22} />, key: 'step4' },
  ] as const;
  return (
    <section className="relative mx-auto max-w-7xl px-4 pt-8 sm:px-6">
      <div className="surface relative overflow-hidden rounded-[2rem] p-8 sm:p-12">
        <div className="lattice pointer-events-none absolute inset-0 opacity-[0.07]" aria-hidden="true" />
        <div
          className="pointer-events-none absolute -end-24 -top-24 size-80 rounded-full bg-velvet/25 blur-3xl"
          aria-hidden="true"
        />
        <div className="relative grid gap-10 lg:grid-cols-[1fr_1.5fr] lg:items-center">
          <div>
            <p className="text-sm font-semibold text-velvet-bright">{t('home.how.eyebrow')}</p>
            <h2 className="mt-3 text-3xl text-cream sm:text-4xl">{t('home.how.title')}</h2>
            <p className="mt-4 text-sand">{t('home.how.body')}</p>
            {showtime && (
              <Button
                className="mt-7"
                to={`/showtimes/${showtime.id}/seats`}
                iconEnd={<ArrowRight size={18} className="rtl:-scale-x-100" aria-hidden="true" />}
              >
                {t('home.how.cta')}
              </Button>
            )}
          </div>
          <ol className="grid gap-4 sm:grid-cols-2">
            {steps.map((step, i) => (
              <li key={step.key} className="relative rounded-2xl border border-cream/[0.08] bg-night-900/60 p-5">
                <div className="flex items-center gap-3">
                  <span className="flex size-11 items-center justify-center rounded-xl bg-velvet/15 text-velvet-bright">
                    {step.icon}
                  </span>
                  <span className="nums font-display text-3xl text-cream/15">{String(i + 1).padStart(2, '0')}</span>
                </div>
                <h3 className="mt-4 text-lg text-cream">{t(`home.how.${step.key}.title`)}</h3>
                <p className="mt-1.5 text-sm text-sand">{t(`home.how.${step.key}.body`)}</p>
              </li>
            ))}
          </ol>
        </div>
      </div>
    </section>
  );
}

// ───────────────────────────── halls ─────────────────────────────

function Halls({ halls, movies }: { halls: HallSummary[]; movies: MovieWithShowtimes[] }) {
  const { t, L } = useI18n();
  const nextByHall = useMemo(() => {
    const map = new Map<string, ShowtimeSummary>();
    const all = movies
      .flatMap((m) => m.nextShowtimes)
      .filter((s) => s.status === 'open' || s.status === 'filling_fast')
      .sort((a, b) => a.startsAt.localeCompare(b.startsAt));
    for (const showtime of all) if (!map.has(showtime.hallId)) map.set(showtime.hallId, showtime);
    return map;
  }, [movies]);

  return (
    <section className="mx-auto max-w-7xl px-4 pt-20 sm:px-6">
      <SectionHeading title={t('home.sections.halls')} subtitle={t('home.sections.hallsSub')} />
      <div className="grid gap-5 md:grid-cols-2">
        {halls.map((hall) => {
          const next = nextByHall.get(hall.id);
          return (
            <div key={hall.id} className="surface group relative overflow-hidden rounded-3xl p-7">
              <HallGlyph seats={hall.seatCount} />
              <div className="relative">
                <h3 className="text-2xl text-cream">{L(hall.name)}</h3>
                <div className="mt-3 flex flex-wrap gap-2">
                  {hall.features.map((feature) => (
                    <span key={feature.en} className="rounded-full border border-cream/12 px-3 py-1 text-xs text-cream-200">
                      {L(feature)}
                    </span>
                  ))}
                </div>
                {next && (
                  <Link
                    to={`/showtimes/${next.id}/seats`}
                    className="mt-6 inline-flex items-center gap-2 text-sm font-semibold text-velvet-bright hover:text-white"
                  >
                    {t('home.hallCard.explore')}
                    <ArrowLeft size={16} className="ltr:-scale-x-100" aria-hidden="true" />
                  </Link>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}

/** Decorative seat-grid silhouette for the hall cards. */
function HallGlyph({ seats }: { seats: number }) {
  const rows = seats > 200 ? 9 : 7;
  const cols = seats > 200 ? 16 : 12;
  return (
    <svg
      viewBox={`0 0 ${cols * 10} ${rows * 10 + 16}`}
      className="pointer-events-none absolute -bottom-6 end-[-1rem] w-64 opacity-[0.16] transition-opacity duration-500 group-hover:opacity-30"
      aria-hidden="true"
    >
      <path d={`M${cols * 1.5} 6 Q${cols * 5} -2 ${cols * 8.5} 6`} stroke="#f4f1ec" strokeWidth="2" fill="none" />
      {Array.from({ length: rows }, (_, r) =>
        Array.from({ length: cols }, (_, c) => (
          <rect
            key={`${r}-${c}`}
            x={c * 10 + 1.5 + (r % 2) * 0}
            y={16 + r * 10}
            width="7"
            height="6"
            rx="1.5"
            fill={r === 4 && c > 5 && c < 9 ? '#ffd166' : '#db2029'}
          />
        )),
      )}
    </svg>
  );
}
