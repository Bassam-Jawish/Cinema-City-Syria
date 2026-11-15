import { Clapperboard, RotateCcw, WifiOff } from 'lucide-react';
import type { ReactNode } from 'react';
import { useI18n, type TKey } from '@/i18n';
import { errorCodeOf } from '@/lib/api';
import { Button } from '../ui/Button';
import { Spinner } from '../ui/Spinner';

/** Centered loading state for a page or panel. */
export function LoadingState({ label }: { label?: string }) {
  const { t } = useI18n();
  return (
    <div className="flex min-h-[40vh] flex-col items-center justify-center gap-4 text-sand" role="status">
      <Spinner size={28} className="text-velvet" />
      <span className="text-sm">{label ?? t('common.a11y.loading')}</span>
    </div>
  );
}

/** Error state that explains what happened and offers a way forward. */
export function ErrorState({
  error,
  notFoundKey = 'common.errors.notFoundBody',
  onRetry,
  action,
}: {
  error: unknown;
  notFoundKey?: TKey;
  onRetry?: () => void;
  action?: ReactNode;
}) {
  const { t } = useI18n();
  const code = errorCodeOf(error);
  const notFound = code === 'NOT_FOUND';
  const network = code === 'NETWORK';
  return (
    <div className="mx-auto flex min-h-[46vh] max-w-md flex-col items-center justify-center gap-4 px-6 text-center">
      <div className="flex size-16 items-center justify-center rounded-full border border-cream/10 bg-night-800 text-velvet-bright">
        {network ? <WifiOff size={26} /> : <Clapperboard size={26} />}
      </div>
      <h1 className="text-2xl text-cream">{notFound ? t('common.errors.notFoundTitle') : t('common.errors.title')}</h1>
      <p className="text-sand">
        {notFound ? t(notFoundKey) : network ? t('common.errors.network') : t('common.errors.generic')}
      </p>
      <div className="mt-2 flex flex-wrap justify-center gap-3">
        {onRetry && !notFound && (
          <Button variant="secondary" icon={<RotateCcw size={16} />} onClick={onRetry}>
            {t('common.actions.retry')}
          </Button>
        )}
        {action ?? (
          <Button variant="ghost" to="/">
            {t('common.actions.backHome')}
          </Button>
        )}
      </div>
    </div>
  );
}
