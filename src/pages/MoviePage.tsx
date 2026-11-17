import { clsx } from 'clsx';
import { ArrowLeft, CalendarClock, Captions, Languages } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router';
import type { ScheduleDay, ShowtimeSummary } from '@shared/types';
import { ErrorState, LoadingState } from '@/components/common/PageState';
import { DateStrip } from '@/components/movie/DateStrip';
import { MovieMeta } from '@/components/movie/MovieMeta';
import { Backdrop, Poster } from '@/components/movie/Poster';
import { Button } from '@/components/ui/Button';
import { useI18n } from '@/i18n';
import { api } from '@/lib/api';
import { useFormat } from '@/lib/format';
import { useAsync, useDocumentTitle } from '@/lib/hooks';

export default function MoviePage() {
  const { movieId = '' } = useParams();
  const { t, L, lang } = useI18n();
  const f = useFormat();
  const { data, error, loading, reload } = useAsync((signal) => api.getMovie(movieId, signal), [movieId]);
  const movie = data?.movie;
  useDocumentTitle(movie ? `${L(movie.title)} · ${t('common.brand.name')}` : null);

  // Default to the first day that still has a bookable show.
  const [day, setDay] = useState<string | null>(null);
  useEffect(() => setDay(null), [movieId]);
  const days = data?.days ?? [];
  const selectedDay = useMemo(() => {
    if (day && days.some((d) => d.date === day)) return day;
    const firstBookable = days.find((d) => d.showtimes.some((s) => s.status !== 'closed'));
    return firstBookable?.date ?? days[0]?.date ?? null;
  }, [day, days]);

  if (loading && !data) return <LoadingState />;
  if (error && !data) return <ErrorState error={error} notFoundKey="common.errors.movieNotFound" onRetry={reload} />;
  if (!movie) return null;

  const counts = Object.fromEntries(days.map((d) => [d.date, d.showtimes.filter((s) => s.status !== 'closed').length]));
  const current = days.find((d) => d.date === selectedDay) ?? null;
  // A coming-soon film has a schedule only once its opening week is on sale (advance booking).
  const onSale = days.some((d) => d.showtimes.length > 0);
  const comingSoon = movie.status === 'coming_soon';
  const opens = f.dateLong(`${movie.releaseDate}T12:00:00Z`);

  return (
    <article>
      <header className="relative -mt-18 overflow-hidden pt-18">
        <div className="absolute inset-0">
          <Backdrop movie={movie} eager className="scale-105 blur-[2px]" />
          <div className="absolute inset-0 bg-linear-to-r from-night-950 via-night-950/85 to-night-950/40 rtl:bg-linear-to-l" />
          <div className="absolute inset-x-0 bottom-0 h-1/2 bg-linear-to-t from-night-950 to-transparent" />
        </div>
        <div className="relative mx-auto max-w-7xl px-4 pb-12 pt-8 sm:px-6">
          <Link to="/" className="inline-flex items-center gap-2 text-sm text-sand hover:text-cream">
            <ArrowLeft size={16} className="rtl:-scale-x-100" aria-hidden="true" />
            {t('movie.back')}
          </Link>
          <div className="mt-8 grid gap-8 md:grid-cols-[minmax(0,18rem)_1fr] md:items-end">
            <Poster
              movie={movie}
              eager
              className="mx-auto w-48 rounded-2xl shadow-[0_40px_80px_-30px_rgb(0_0_0/0.9)] ring-1 ring-cream/10 md:mx-0 md:w-full"
            />
            <div className="animate-fade-up">
              <h1 className="text-4xl text-white sm:text-6xl">{L(movie.title)}</h1>
              <p className="mt-3 text-lg text-cream-200">{L(movie.tagline)}</p>
              <MovieMeta movie={movie} showFormats showScore maxGenres={3} className="mt-5" />
              <div className="mt-4 flex flex-wrap gap-x-5 gap-y-2 text-sm text-sand">
                <span className="inline-flex items-center gap-1.5">
                  <Languages size={15} aria-hidden="true" />
                  {t(`common.movie.audioLang.${movie.audio}`)}
                </span>
                <span className="inline-flex items-center gap-1.5">
                  <Captions size={15} aria-hidden="true" />
                  {movie.subtitles ? t(`common.movie.subtitled.${movie.subtitles}`) : t('common.movie.noSubtitles')}
                </span>
              </div>
              {(!comingSoon || onSale) && (
                <Button
                  className="mt-7"
                  size="lg"
                  onClick={() => document.getElementById('showtimes')?.scrollIntoView({ behavior: 'smooth' })}
                  icon={<CalendarClock size={18} aria-hidden="true" />}
                >
                  {t('common.actions.showtimes')}
                </Button>
              )}
            </div>
          </div>
        </div>
      </header>

      <div className="mx-auto grid max-w-7xl gap-12 px-4 pt-6 sm:px-6 lg:grid-cols-[1.5fr_1fr]">
        <section id="showtimes" className="scroll-mt-24">
          <h2 className="mb-5 text-3xl text-cream">{t('movie.showtimes')}</h2>
          {comingSoon && !onSale ? (
            <div className="surface rounded-3xl p-7">
              <h3 className="text-xl text-cream">{t('movie.comingSoonTitle')}</h3>
              <p className="mt-2 text-sand">{t('movie.comingSoonBody', { date: opens })}</p>
            </div>
          ) : (
            <>
              {comingSoon && (
                <div className="mb-5 flex items-start gap-3 rounded-2xl border border-marquee/30 bg-marquee/10 p-4">
                  <CalendarClock size={20} className="mt-0.5 shrink-0 text-marquee-bright" aria-hidden="true" />
                  <div>
                    <h3 className="font-semibold text-cream">{t('movie.advanceTitle')}</h3>
                    <p className="mt-1 text-sm text-cream-200">{t('movie.advanceBody', { date: opens })}</p>
                  </div>
                </div>
              )}
              {selectedDay && (
                <DateStrip dates={days.map((d) => d.date)} value={selectedDay} onChange={setDay} counts={counts} />
              )}
              <div className="mt-6">{current && <DaySchedule day={current} />}</div>
            </>
          )}
        </section>

        <aside className="space-y-8">
          <section>
            <h2 className="mb-3 text-xl text-cream">{t('movie.about')}</h2>
            <p className="leading-relaxed text-cream-200">{L(movie.synopsis)}</p>
          </section>
          <dl className="grid grid-cols-[auto_1fr] gap-x-6 gap-y-3 text-sm">
            <dt className="text-sand">{t('common.movie.director')}</dt>
            <dd className="text-cream">{L(movie.director)}</dd>
            <dt className="text-sand">{t('common.movie.cast')}</dt>
            <dd className="text-cream">{movie.cast.map((person) => L(person)).join(lang === 'ar' ? '، ' : ', ')}</dd>
            <dt className="text-sand">{t('common.movie.rating')}</dt>
            <dd className="text-cream">{t(`common.ratings.${movie.rating}`)}</dd>
            <dt className="text-sand">{t('common.movie.duration')}</dt>
            <dd className="nums text-cream">{f.duration(movie.durationMin)}</dd>
          </dl>
        </aside>
      </div>
    </article>
  );
}

function DaySchedule({ day }: { day: ScheduleDay }) {
  const { t, L } = useI18n();
  const byHall = useMemo(() => {
    const groups = new Map<string, ShowtimeSummary[]>();
    for (const showtime of day.showtimes) {
      const list = groups.get(showtime.hallId) ?? [];
      list.push(showtime);
      groups.set(showtime.hallId, list);
    }
    return [...groups.values()];
  }, [day]);

  if (day.showtimes.length === 0) {
    return <p className="rounded-2xl border border-dashed border-cream/15 p-6 text-sand">{t('movie.noShowsOnDay')}</p>;
  }
  return (
    <div className="space-y-6">
      {byHall.map((showtimes) => {
        const hall = showtimes[0].hall;
        return (
          <div key={hall.id} className="surface rounded-3xl p-5 sm:p-6">
            <div className="mb-4 flex flex-wrap items-baseline justify-between gap-2">
              <h3 className="text-lg text-cream">{L(hall.name)}</h3>
              <p className="text-xs text-sand">{hall.features.map((feature) => L(feature)).join(' · ')}</p>
            </div>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
              {showtimes.map((showtime) => (
                <ShowtimeTile key={showtime.id} showtime={showtime} />
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function ShowtimeTile({ showtime }: { showtime: ShowtimeSummary }) {
  const { t } = useI18n();
  const f = useFormat();
  const disabled = showtime.status === 'closed' || showtime.status === 'sold_out';
  const prices = Object.values(showtime.prices).filter((p): p is number => typeof p === 'number');
  const from = prices.length ? Math.min(...prices) : 0;
  const body = (
    <>
      <div className="flex items-center justify-between gap-2">
        <span className="nums font-display text-2xl text-cream">
          <bdi>{f.time(showtime.startsAt)}</bdi>
        </span>
        {showtime.format === '3D' && (
          <span dir="ltr" className="rounded-md bg-velvet px-1.5 py-0.5 font-mono text-[0.7rem] font-semibold text-white">
            3D
          </span>
        )}
      </div>
      <div className="mt-2 flex items-center justify-between gap-2 text-xs">
        <span
          className={clsx(
            showtime.status === 'filling_fast' && 'text-warn',
            showtime.status === 'open' && 'text-ok',
            disabled && 'text-dust',
          )}
        >
          {showtime.status === 'open'
            ? t('movie.seatsLeft', { count: showtime.seatsAvailable })
            : t(`common.showtime.status.${showtime.status}`)}
        </span>
        {!disabled && <span className="nums text-sand">{t('movie.priceFrom', { price: f.price(from) })}</span>}
      </div>
    </>
  );
  const classes = clsx(
    'block rounded-2xl border p-4 transition-[transform,border-color,background-color] duration-200',
    disabled
      ? 'cursor-not-allowed border-cream/[0.06] opacity-50'
      : 'border-cream/12 bg-night-900/50 hover:-translate-y-0.5 hover:border-velvet hover:bg-velvet/10',
  );
  return disabled ? (
    <div className={classes} aria-disabled="true">
      {body}
    </div>
  ) : (
    <Link to={`/showtimes/${showtime.id}/seats`} className={classes} aria-label={`${f.time(showtime.startsAt)} ${t('movie.bookSeats')}`}>
      {body}
    </Link>
  );
}
