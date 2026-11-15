import { clsx } from 'clsx';
import { CircleCheck, Info, TriangleAlert, X } from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';
import type { ReactNode } from 'react';
import { useI18n } from '@/i18n';
import { useNotices, type NoticeKind } from '@/store/notices';

const icons: Record<NoticeKind, ReactNode> = {
  info: <Info size={18} className="text-info" />,
  success: <CircleCheck size={18} className="text-ok" />,
  warning: <TriangleAlert size={18} className="text-warn" />,
  error: <TriangleAlert size={18} className="text-bad" />,
};

const accents: Record<NoticeKind, string> = {
  info: 'before:bg-info',
  success: 'before:bg-ok',
  warning: 'before:bg-warn',
  error: 'before:bg-bad',
};

/** Renders the toast stack. Mounted once in <App>. Show a toast with notify() from '@/store/notices'. */
export function Toaster() {
  const { t } = useI18n();
  const notices = useNotices((s) => s.notices);
  const dismiss = useNotices((s) => s.dismiss);

  return (
    <div
      className="no-print pointer-events-none fixed inset-x-0 top-4 z-[90] flex flex-col items-center gap-2 px-4"
      role="region"
      aria-live="polite"
    >
      <AnimatePresence initial={false}>
        {notices.map((notice) => (
          <motion.div
            key={notice.id}
            layout
            initial={{ opacity: 0, y: -18, scale: 0.96 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -12, scale: 0.97 }}
            transition={{ type: 'spring', stiffness: 420, damping: 32 }}
            role={notice.kind === 'error' ? 'alert' : 'status'}
            className={clsx(
              'glass pointer-events-auto relative flex w-full max-w-md items-start gap-3 overflow-hidden rounded-2xl py-3 ps-5 pe-3 text-sm text-cream',
              'before:absolute before:inset-y-0 before:start-0 before:w-1',
              accents[notice.kind],
            )}
          >
            <span className="mt-0.5 shrink-0">{icons[notice.kind]}</span>
            <p className="min-w-0 flex-1 leading-relaxed">{t(`common.notices.${notice.key}`, notice.params)}</p>
            <button
              type="button"
              onClick={() => dismiss(notice.id)}
              aria-label={t('common.a11y.dismiss')}
              className="inline-flex size-7 shrink-0 items-center justify-center rounded-full text-sand transition-colors hover:bg-cream/10 hover:text-cream"
            >
              <X size={14} />
            </button>
          </motion.div>
        ))}
      </AnimatePresence>
    </div>
  );
}
