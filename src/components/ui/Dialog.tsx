import { clsx } from 'clsx';
import { X } from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';
import { useEffect, useId, useRef, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { useI18n } from '@/i18n';

export interface DialogProps {
  open: boolean;
  onClose: () => void;
  title: ReactNode;
  description?: ReactNode;
  children?: ReactNode;
  /** Buttons row. */
  footer?: ReactNode;
  /** Set false for dialogs that must be answered (no Esc / backdrop dismissal, no close button). */
  dismissible?: boolean;
  size?: 'sm' | 'md';
}

/** Accessible modal dialog: focus moves in, Esc closes, focus returns to the opener. */
export function Dialog({ open, onClose, title, description, children, footer, dismissible = true, size = 'sm' }: DialogProps) {
  const { t, dir } = useI18n();
  const titleId = useId();
  const descriptionId = useId();
  const panelRef = useRef<HTMLDivElement>(null);
  const openerRef = useRef<Element | null>(null);

  useEffect(() => {
    if (!open) return;
    openerRef.current = document.activeElement;
    const panel = panelRef.current;
    const focusable = panel?.querySelector<HTMLElement>('[data-autofocus], button, [href], input, select, textarea');
    (focusable ?? panel)?.focus();

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && dismissible) {
        event.stopPropagation();
        onClose();
      }
      if (event.key === 'Tab' && panel) {
        // Keep focus inside the dialog.
        const nodes = Array.from(
          panel.querySelectorAll<HTMLElement>(
            'button:not(:disabled), [href], input, select, textarea, [tabindex]:not([tabindex="-1"])',
          ),
        );
        if (nodes.length === 0) return;
        const first = nodes[0];
        const last = nodes[nodes.length - 1];
        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault();
          last.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first.focus();
        }
      }
    };
    document.addEventListener('keydown', onKeyDown, true);
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKeyDown, true);
      document.body.style.overflow = previousOverflow;
      if (openerRef.current instanceof HTMLElement) openerRef.current.focus();
    };
  }, [open, dismissible, onClose]);

  return createPortal(
    <AnimatePresence>
      {open && (
        <motion.div
          dir={dir}
          className="fixed inset-0 z-[80] flex items-end justify-center p-4 sm:items-center"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.2 }}
        >
          <div
            className="absolute inset-0 bg-night-950/75 backdrop-blur-sm"
            onClick={dismissible ? onClose : undefined}
            aria-hidden="true"
          />
          <motion.div
            ref={panelRef}
            role="dialog"
            aria-modal="true"
            aria-labelledby={titleId}
            aria-describedby={description ? descriptionId : undefined}
            tabIndex={-1}
            className={clsx(
              'surface relative w-full rounded-3xl p-6 outline-none sm:p-8',
              size === 'sm' ? 'max-w-md' : 'max-w-xl',
            )}
            initial={{ y: 24, scale: 0.97 }}
            animate={{ y: 0, scale: 1 }}
            exit={{ y: 16, scale: 0.98 }}
            transition={{ type: 'spring', stiffness: 380, damping: 32 }}
          >
            {dismissible && (
              <button
                type="button"
                onClick={onClose}
                aria-label={t('common.actions.close')}
                className="absolute end-4 top-4 inline-flex size-9 items-center justify-center rounded-full text-sand transition-colors hover:bg-cream/10 hover:text-cream"
              >
                <X size={18} />
              </button>
            )}
            <h2 id={titleId} className="pe-8 text-3xl text-cream">
              {title}
            </h2>
            {description && (
              <p id={descriptionId} className="mt-3 text-sand">
                {description}
              </p>
            )}
            {children && <div className="mt-5">{children}</div>}
            {footer && <div className="mt-7 flex flex-wrap items-center justify-end gap-3">{footer}</div>}
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>,
    document.body,
  );
}
