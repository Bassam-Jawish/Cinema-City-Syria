import { clsx } from 'clsx';
import { Ticket } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Link, NavLink, Outlet, useLocation } from 'react-router';
import { useI18n } from '@/i18n';
import { Ltr } from '../common/Bidi';
import { Logo } from '../brand/Logo';
import { LanguageToggle } from './LanguageToggle';

/** Header + page + footer, for every page except the full-screen 3D hall. */
export function AppLayout() {
  const { pathname } = useLocation();
  useEffect(() => {
    window.scrollTo({ top: 0, behavior: 'instant' as ScrollBehavior });
  }, [pathname]);

  return (
    <div className="grain relative flex min-h-dvh flex-col">
      {/* A faint crimson glow at the top of every page (heroes paint over it). */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-x-0 top-0 -z-10 h-[38rem] bg-[radial-gradient(110%_90%_at_50%_-20%,rgb(219_32_41/0.13),transparent_65%)]"
      />
      <SkipLink />
      <SiteHeader />
      <main id="main" className="flex-1">
        <Outlet />
      </main>
      <SiteFooter />
    </div>
  );
}

function SkipLink() {
  const { t } = useI18n();
  return (
    <a
      href="#main"
      className="sr-only focus:not-sr-only focus:fixed focus:start-4 focus:top-4 focus:z-[100] focus:rounded-full focus:bg-velvet focus:px-4 focus:py-2 focus:text-white"
    >
      {t('common.nav.skipToContent')}
    </a>
  );
}

export function SiteHeader() {
  const { t } = useI18n();
  const [scrolled, setScrolled] = useState(false);
  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 12);
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  const link = ({ isActive }: { isActive: boolean }, display = 'inline-flex') =>
    clsx(
      display,
      'h-10 items-center gap-2 rounded-full px-3 text-sm font-medium transition-colors sm:px-4',
      isActive ? 'bg-cream/10 text-cream' : 'text-cream-200 hover:text-cream',
    );

  return (
    <header
      className={clsx(
        'no-print sticky top-0 z-50 transition-[background-color,box-shadow,backdrop-filter] duration-300',
        scrolled ? 'bg-night-950/85 shadow-[0_1px_0_0_rgb(244_241_236/0.06)] backdrop-blur-xl' : 'bg-transparent',
      )}
    >
      <div className="mx-auto flex h-18 max-w-7xl items-center justify-between gap-4 px-4 sm:px-6">
        <Link to="/" className="rounded-lg" aria-label={t('common.brand.full')}>
          <Logo />
        </Link>
        <nav className="flex items-center gap-1 sm:gap-2" aria-label={t('common.nav.menu')}>
          <NavLink to="/" end className={(s) => link(s, 'hidden md:inline-flex')}>
            {t('common.nav.nowShowing')}
          </NavLink>
          <NavLink to="/tickets" className={(s) => link(s)}>
            <Ticket size={16} aria-hidden="true" />
            <span className="hidden sm:inline">{t('common.nav.myTickets')}</span>
          </NavLink>
          <LanguageToggle />
        </nav>
      </div>
    </header>
  );
}

export function SiteFooter() {
  const { t } = useI18n();
  return (
    <footer className="no-print mt-24 border-t border-cream/[0.06] bg-night-950/60">
      <div className="mx-auto grid max-w-7xl gap-10 px-4 py-12 sm:px-6 md:grid-cols-[1.4fr_1fr_1fr]">
        <div className="space-y-4">
          <Logo />
          <p className="max-w-sm text-sm text-sand">{t('common.footer.about')}</p>
        </div>
        <div className="space-y-2 text-sm">
          <h2 className="mb-3 font-display text-base text-cream">{t('common.footer.visit')}</h2>
          <p className="text-sand">{t('common.footer.address')}</p>
          <p className="text-sand">{t('common.footer.hours')}</p>
        </div>
        <div className="space-y-2 text-sm">
          <h2 className="mb-3 font-display text-base text-cream">{t('common.footer.boxOffice')}</h2>
          <p>
            <a href="tel:+963992009424" className="text-cream-200 hover:text-cream">
              <Ltr className="nums">+963 992 009 424</Ltr>
            </a>
          </p>
          <p>
            <a
              href="https://www.facebook.com/cinemacitysyria/"
              target="_blank"
              rel="noreferrer"
              className="text-cream-200 hover:text-cream"
            >
              <Ltr>facebook.com/cinemacitysyria</Ltr>
            </a>
          </p>
          <p>
            <Link to="/staff" className="text-dust hover:text-cream-200">
              {t('common.nav.staff')}
            </Link>
          </p>
        </div>
      </div>
      <div className="border-t border-cream/[0.06]">
        <p className="mx-auto max-w-7xl px-4 py-5 text-xs text-dust sm:px-6">{t('common.footer.demoNote')}</p>
      </div>
    </footer>
  );
}
