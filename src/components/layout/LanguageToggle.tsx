import { clsx } from 'clsx';
import { Languages } from 'lucide-react';
import { useI18n } from '@/i18n';

/** Switches between Arabic and English. The label is always written in the language you switch TO. */
export function LanguageToggle({ className, compact = false }: { className?: string; compact?: boolean }) {
  const { t, toggleLang, lang } = useI18n();
  return (
    <button
      type="button"
      onClick={toggleLang}
      title={t('common.nav.switchLanguageHint')}
      aria-label={t('common.nav.switchLanguageHint')}
      lang={lang === 'ar' ? 'en' : 'ar'}
      className={clsx(
        'inline-flex h-10 items-center gap-2 rounded-full border border-cream/15 px-3.5 text-sm font-medium text-cream-200 transition-colors hover:border-cream/35 hover:text-cream',
        className,
      )}
    >
      <Languages size={16} aria-hidden="true" />
      {!compact && (
        <span className={clsx('hidden sm:inline', lang === 'ar' ? 'font-sans' : 'font-display')}>
          {t('common.nav.switchLanguage')}
        </span>
      )}
    </button>
  );
}
