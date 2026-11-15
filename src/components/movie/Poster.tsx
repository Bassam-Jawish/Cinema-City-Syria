import { clsx } from 'clsx';
import { useState, type ReactNode } from 'react';
import type { Movie } from '@shared/types';
import { useI18n } from '@/i18n';

/**
 * Film key art (2:3). Falls back to a gradient in the film's colour if the image is missing.
 * The art is text-free; pass `children` to typeset the title over it.
 */
export function Poster({
  movie,
  className,
  eager = false,
  children,
}: {
  movie: Pick<Movie, 'poster' | 'title' | 'accent'>;
  className?: string;
  eager?: boolean;
  children?: ReactNode;
}) {
  const { t, L } = useI18n();
  const [failed, setFailed] = useState(false);
  return (
    <div className={clsx('relative isolate overflow-hidden bg-night-800', className)} style={{ aspectRatio: '2 / 3' }}>
      {failed ? (
        <div
          className="absolute inset-0"
          style={{
            background: `radial-gradient(120% 70% at 50% 18%, ${movie.accent}66, transparent 70%), linear-gradient(180deg, #1b1a19, #0d0c0c)`,
          }}
        />
      ) : (
        <img
          src={movie.poster}
          alt={t('common.a11y.poster', { title: L(movie.title) })}
          loading={eager ? 'eager' : 'lazy'}
          decoding="async"
          onError={() => setFailed(true)}
          className="absolute inset-0 h-full w-full object-cover"
          draggable={false}
        />
      )}
      {children}
    </div>
  );
}

/** Wide film still (16:9) used behind hero text. */
export function Backdrop({
  movie,
  className,
  eager = false,
}: {
  movie: Pick<Movie, 'backdrop' | 'accent'>;
  className?: string;
  eager?: boolean;
}) {
  const [failed, setFailed] = useState(false);
  if (failed) {
    return (
      <div
        className={clsx('absolute inset-0', className)}
        style={{ background: `radial-gradient(90% 80% at 60% 40%, ${movie.accent}44, transparent 70%), #0d0c0c` }}
      />
    );
  }
  return (
    <img
      src={movie.backdrop}
      alt=""
      aria-hidden="true"
      loading={eager ? 'eager' : 'lazy'}
      decoding="async"
      onError={() => setFailed(true)}
      className={clsx('absolute inset-0 h-full w-full object-cover', className)}
      draggable={false}
    />
  );
}
