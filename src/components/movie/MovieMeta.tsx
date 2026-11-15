import { clsx } from 'clsx';
import { Clock, Star } from 'lucide-react';
import type { Movie } from '@shared/types';
import { useI18n } from '@/i18n';
import { useFormat } from '@/lib/format';
import { FormatBadge, RatingBadge } from '../ui/Badge';

/** One line of film facts: rating · duration · genres (· formats). */
export function MovieMeta({
  movie,
  className,
  showFormats = false,
  showScore = false,
  maxGenres = 2,
}: {
  movie: Movie;
  className?: string;
  showFormats?: boolean;
  showScore?: boolean;
  maxGenres?: number;
}) {
  const { t } = useI18n();
  const f = useFormat();
  return (
    <div className={clsx('flex flex-wrap items-center gap-x-3 gap-y-2 text-sm text-sand', className)}>
      <RatingBadge rating={movie.rating} />
      <span className="inline-flex items-center gap-1.5">
        <Clock size={14} aria-hidden="true" />
        <span className="nums">{f.duration(movie.durationMin)}</span>
      </span>
      <span>{movie.genres.slice(0, maxGenres).map((g) => t(`common.genres.${g}`)).join(' · ')}</span>
      {showScore && movie.score > 0 && (
        <span className="inline-flex items-center gap-1 text-marquee-bright">
          <Star size={14} fill="currentColor" aria-hidden="true" />
          <span className="nums font-semibold" dir="ltr">
            {movie.score.toFixed(1)}
          </span>
        </span>
      )}
      {showFormats && (
        <span className="inline-flex gap-1.5">
          {movie.formats.map((format) => (
            <FormatBadge key={format} format={format} />
          ))}
        </span>
      )}
    </div>
  );
}
