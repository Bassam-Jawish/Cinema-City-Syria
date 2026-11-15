import { Clapperboard } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { useI18n } from '@/i18n';
import { useDocumentTitle } from '@/lib/hooks';

export default function NotFoundPage() {
  const { t } = useI18n();
  useDocumentTitle(`${t('common.errors.notFoundTitle')} · ${t('common.brand.name')}`);
  return (
    <div className="mx-auto flex min-h-[60vh] max-w-md flex-col items-center justify-center gap-5 px-6 text-center">
      <span className="flex size-16 items-center justify-center rounded-full bg-velvet/15 text-velvet-bright">
        <Clapperboard size={28} aria-hidden="true" />
      </span>
      <h1 className="text-4xl text-cream">{t('common.errors.notFoundTitle')}</h1>
      <p className="text-sand">{t('common.errors.notFoundBody')}</p>
      <Button to="/">{t('common.actions.backHome')}</Button>
    </div>
  );
}
