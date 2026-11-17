import { clsx } from 'clsx';
import { ArrowUpRight } from 'lucide-react';
import { Link } from 'react-router';
import type { MovieWithShowtimes } from '@shared/types';
import { useI18n } from '@/i18n';
import { useFormat } from '@/lib/format';
import { MovieMeta } from './MovieMeta';
import { Poster } from './Poster';
import { ShowtimeChip } from './ShowtimeChip';

/** Poster card for the film grids, with the next few showtimes underneath. */
export function MovieCard({ movie, index = 0 }: { movie: MovieWithShowtimes; index?: number }) {
  const { t, L } = useI18n();
  const f = useFormat();
  const comingSoon = movie.status === 'coming_soon';
  /** Not out yet, but its opening week is on sale. */
  const inAdvance = comingSoon && movie.nextShowtimes.length > 0;
  const chips = (
    <div className={clsx('flex flex-wrap gap-2')}>
      {movie.nextShowtimes.slice(0, 3).map((showtime) => (
        <ShowtimeChip key={showtime.id} showtime={showtime} size="sm" />
      ))}
    </div>
  );

  return (
    <article
      className="group animate-fade-up flex flex-col"
      style={{ animationDelay: `${Math.min(index, 8) * 70}ms` }}
    >
      <Link
        to={`/movies/${movie.id}`}
        className="relative block overflow-hidden rounded-2xl ring-1 ring-cream/[0.08] transition-[transform,box-shadow] duration-500 ease-(--ease-out-expo) group-hover:-translate-y-1.5 group-hover:shadow-[0_30px_60px_-30px_rgb(219_32_41/0.55)]"
      >
        <Poster movie={movie} eager={index < 4} className="rounded-2xl">
          <div className="absolute inset-x-0 bottom-0 h-3/5 bg-linear-to-t from-night-950 via-night-950/75 to-transparent" />
          <div
            className="absolute inset-0 opacity-0 transition-opacity duration-500 group-hover:opacity-100"
            style={{ background: `radial-gradient(90% 60% at 50% 100%, ${movie.accent}40, transparent 70%)` }}
          />
          <div className="absolute inset-x-0 bottom-0 p-4">
            {comingSoon && (
              <span className="mb-2 inline-block rounded-full bg-marquee px-2.5 py-0.5 text-[0.7rem] font-semibold text-night-950">
                {inAdvance ? t('movie.advanceBadge') : t('movie.comingSoonTitle')}
              </span>
            )}
            <h3 className="font-display text-xl leading-tight text-white drop-shadow-[0_2px_8px_rgb(0_0_0/0.6)] sm:text-2xl">
              {L(movie.title)}
            </h3>
          </div>
          <span className="absolute end-3 top-3 inline-flex size-9 items-center justify-center rounded-full bg-night-950/70 text-cream opacity-0 backdrop-blur transition-opacity duration-300 group-hover:opacity-100">
            <ArrowUpRight size={18} className="rtl:-scale-x-100" aria-hidden="true" />
          </span>
        </Poster>
      </Link>

      <div className="mt-3 space-y-3 px-0.5">
        <MovieMeta movie={movie} className="text-xs" maxGenres={2} />
        {comingSoon ? (
          <>
            <p className="text-sm text-sand">{t('common.movie.inCinemas', { date: f.dateLong(`${movie.releaseDate}T12:00:00Z`) })}</p>
            {inAdvance && chips}
          </>
        ) : movie.nextShowtimes.length > 0 ? (
          chips
        ) : (
          <p className="text-sm text-dust">{t('home.card.noShows')}</p>
        )}
      </div>
    </article>
  );
}
