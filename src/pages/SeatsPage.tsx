/**
 * Seat selection: a full-screen live 3D model of the hall with a HUD on top.
 *
 *   overview → click a free seat (in 3D or on the mini-map) → the seat is held for you and the
 *   camera flies into it → look around from your seat → add more seats or continue to checkout.
 *
 * Without WebGL (or if the 3D scene fails) the 2D seat map takes over — the booking flow is the same.
 */
import { clsx } from 'clsx';
import {
  ArrowLeft,
  ArrowRight,
  ChevronLeft,
  ChevronRight,
  Crosshair,
  LayoutGrid,
  Lightbulb,
  LightbulbOff,
  Map as MapIcon,
  MousePointer2,
  Sparkles,
  Trash2,
  Users,
  X,
} from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';
import { lazy, Suspense, useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router';
import { MAX_SEATS_PER_BOOKING } from '@shared/constants';
import type { HallGeometry, SeatInfo, SeatType } from '@shared/hall';
import { Emblem } from '@/components/brand/Logo';
import { ErrorBoundary } from '@/components/ErrorBoundary';
import { ErrorState } from '@/components/common/PageState';
import { LanguageToggle } from '@/components/layout/LanguageToggle';
import { SeatMap2D } from '@/components/seats/SeatMap2D';
import { HoldTimer, LiveIndicator, SeatLegend } from '@/components/seats/SeatWidgets';
import { Button, IconButton } from '@/components/ui/Button';
import { useI18n } from '@/i18n';
import { ApiError } from '@/lib/api';
import { useFormat } from '@/lib/format';
import { useDocumentTitle, useMediaQuery } from '@/lib/hooks';
import {
  seatPrice,
  useBooking,
  usePovSeat,
  useSelectedSeats,
  useSelectionTotal,
  type LightsMode,
} from '@/store/booking';
import { MAP_COLORS } from '@/three/palette';
import { isCoarsePointer, isWebGLAvailable } from '@/three/support';

// The 3D bundle (three.js, react-three-fiber) loads only when the hall is opened.
const HallExperience = lazy(() => import('@/three/HallExperience'));

export default function SeatsPage() {
  const { showtimeId = '' } = useParams();
  const navigate = useNavigate();
  const { t, L } = useI18n();
  const open = useBooking((s) => s.open);
  const disconnect = useBooking((s) => s.disconnect);
  const load = useBooking((s) => s.load);
  const loadError = useBooking((s) => s.loadError);
  const storeShowtimeId = useBooking((s) => s.showtimeId);
  const detail = useBooking((s) => s.detail);
  const geometry = useBooking((s) => s.geometry);
  const setMapOpen = useBooking((s) => s.setMapOpen);
  const desktop = useMediaQuery('(min-width: 768px)');

  const [webgl] = useState(() => isWebGLAvailable());
  const [sceneFailed, setSceneFailed] = useState(false);
  const [sceneReady, setSceneReady] = useState(false);
  const use3d = webgl && !sceneFailed;

  useEffect(() => {
    void open(showtimeId);
    return () => disconnect();
  }, [showtimeId, open, disconnect]);

  // ?view=F12 (from an e-ticket): once the hall is ready, sit in that seat to preview the view.
  const [params, setParams] = useSearchParams();
  const previewId = params.get('view');
  const previewSeat = useBooking((s) => s.previewSeat);
  const hallReady = storeShowtimeId === showtimeId && load === 'ready';
  useEffect(() => {
    if (!previewId || !hallReady) return;
    previewSeat(previewId);
    setParams({}, { replace: true });
  }, [previewId, hallReady, previewSeat, setParams]);

  // The mini-map starts open on large screens only.
  useEffect(() => setMapOpen(desktop), [desktop, setMapOpen]);

  useDocumentTitle(detail ? `${L(detail.movie.title)} · ${t('common.brand.name')}` : null);

  const current = storeShowtimeId === showtimeId;
  if (current && load === 'error') {
    return (
      <div className="min-h-dvh bg-night-950">
        <ErrorState
          error={new ApiError(loadError ?? 'INTERNAL', 0, 'Showtime could not be loaded')}
          notFoundKey="seats.notFound"
          onRetry={() => void open(showtimeId)}
        />
      </div>
    );
  }

  const ready = current && load === 'ready' && geometry && detail;
  const goCheckout = () => navigate(`/showtimes/${showtimeId}/checkout`);

  return (
    <div className="fixed inset-0 overflow-hidden bg-night-950 text-cream">
      {ready && use3d && (
        <ErrorBoundary fallback={null} onError={() => setSceneFailed(true)}>
          <Suspense fallback={null}>
            <HallExperience className="absolute inset-0" onReady={() => setSceneReady(true)} />
          </Suspense>
        </ErrorBoundary>
      )}
      {ready && !use3d && <FallbackMap geometry={geometry} />}

      {ready && (
        <>
          <TopBar />
          <StatusBanner />
          {use3d && <HallControls />}
          {use3d && <MiniMap geometry={geometry} />}
          {use3d && <PovCard />}
          <div className="pointer-events-none absolute inset-x-0 bottom-0 z-30 flex flex-col items-center gap-3 px-3 pb-3 sm:px-5 sm:pb-5">
            {use3d && <HintPill />}
            <SeatTray onContinue={goCheckout} />
          </div>
        </>
      )}

      <CurtainVeil open={Boolean(ready) && (!use3d || sceneReady)} />
    </div>
  );
}

// ───────────────────────────── top bar ─────────────────────────────

function TopBar() {
  const { t, L } = useI18n();
  const f = useFormat();
  const navigate = useNavigate();
  const detail = useBooking((s) => s.detail)!;
  const { movie, showtime, hall } = detail;
  return (
    <div className="pointer-events-none absolute inset-x-0 top-0 z-30 bg-linear-to-b from-night-950/90 via-night-950/45 to-transparent pb-10">
      <div className="pointer-events-auto flex items-center gap-3 px-3 pt-3 sm:px-5 sm:pt-4">
        <IconButton
          label={t('seats.back')}
          icon={<ArrowLeft size={18} className="rtl:-scale-x-100" />}
          variant="glass"
          onClick={() => navigate(`/movies/${movie.id}`)}
        />
        <Emblem className="hidden h-7 w-auto sm:block" />
        <div className="min-w-0 flex-1">
          <h1 className="truncate font-display text-lg leading-tight text-white sm:text-xl">{L(movie.title)}</h1>
          <p className="mt-0.5 flex flex-wrap items-center gap-x-2 text-xs text-sand sm:text-sm">
            <bdi>{f.dayShort(showtime.startsAt)}</bdi>
            <span aria-hidden="true">·</span>
            <bdi className="nums">{f.time(showtime.startsAt)}</bdi>
            <span aria-hidden="true">·</span>
            <span>{L(hall.name)}</span>
            {showtime.format === '3D' && (
              <span dir="ltr" className="rounded bg-velvet px-1 font-mono text-[0.65rem] font-semibold text-white">
                3D
              </span>
            )}
          </p>
        </div>
        <LiveIndicator />
        <LanguageToggle compact />
      </div>
    </div>
  );
}

function StatusBanner() {
  const { t } = useI18n();
  const status = useBooking((s) => s.detail?.showtime.status);
  if (status !== 'closed' && status !== 'sold_out') return null;
  return (
    <div className="pointer-events-none absolute inset-x-0 top-20 z-30 flex justify-center px-4">
      <p className="glass rounded-full px-4 py-2 text-sm text-warn">
        {status === 'closed' ? t('seats.closed') : t('seats.soldOut')}
      </p>
    </div>
  );
}

// ───────────────────────────── controls ─────────────────────────────

function HallControls() {
  const { t } = useI18n();
  const lights = useBooking((s) => s.lights);
  const setLights = useBooking((s) => s.setLights);
  const showAudience = useBooking((s) => s.showAudience);
  const setShowAudience = useBooking((s) => s.setShowAudience);
  const mapOpen = useBooking((s) => s.mapOpen);
  const setMapOpen = useBooking((s) => s.setMapOpen);

  const nextLights: Record<LightsMode, LightsMode> = { auto: 'off', off: 'on', on: 'auto' };
  const lightsLabel = lights === 'auto' ? t('seats.controls.lightsAuto') : lights === 'on' ? t('seats.controls.lightsOn') : t('seats.controls.lightsOff');

  return (
    <div className="absolute end-3 top-20 z-30 flex flex-col gap-2 sm:end-5 sm:top-24">
      <IconButton
        variant="glass"
        label={lightsLabel}
        active={lights !== 'auto'}
        icon={lights === 'off' ? <LightbulbOff size={18} /> : lights === 'on' ? <Lightbulb size={18} /> : <Sparkles size={18} />}
        onClick={() => setLights(nextLights[lights])}
      />
      <IconButton
        variant="glass"
        label={showAudience ? t('seats.controls.hideAudience') : t('seats.controls.showAudience')}
        active={showAudience}
        icon={<Users size={18} />}
        onClick={() => setShowAudience(!showAudience)}
      />
      <IconButton
        variant="glass"
        label={mapOpen ? t('seats.controls.hideMap') : t('seats.controls.showMap')}
        active={mapOpen}
        icon={<MapIcon size={18} />}
        onClick={() => setMapOpen(!mapOpen)}
      />
    </div>
  );
}

function MiniMap({ geometry }: { geometry: HallGeometry }) {
  const { t } = useI18n();
  const mapOpen = useBooking((s) => s.mapOpen);
  const setMapOpen = useBooking((s) => s.setMapOpen);
  const view = useBooking((s) => s.view);
  const types = useMemo(
    () => (['standard', 'premium', 'vip'] as SeatType[]).filter((type) => geometry.seatCountByType[type] > 0),
    [geometry],
  );
  return (
    <AnimatePresence>
      {mapOpen && (
        <motion.aside
          key="minimap"
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: 12 }}
          transition={{ duration: 0.25 }}
          className="glass absolute start-3 bottom-44 z-30 w-[min(20rem,calc(100vw-1.5rem))] rounded-2xl p-3 sm:start-5 sm:bottom-32 sm:w-80"
          aria-label={t('seats.map.title')}
        >
          <div className="mb-2 flex items-center justify-between">
            <h2 className="text-sm font-semibold text-cream">{t('seats.map.title')}</h2>
            <button
              type="button"
              onClick={() => setMapOpen(false)}
              aria-label={t('common.actions.close')}
              className="inline-flex size-7 items-center justify-center rounded-full text-sand hover:bg-cream/10 hover:text-cream"
            >
              <X size={14} />
            </button>
          </div>
          <SeatMap2D geometry={geometry} variant="mini" className="max-h-[38vh]" />
          {view === 'overview' && <SeatLegend types={types} className="mt-3 border-t border-cream/10 pt-3" />}
        </motion.aside>
      )}
    </AnimatePresence>
  );
}

// ───────────────────────────── seated view card ─────────────────────────────

function PovCard() {
  const { t } = useI18n();
  const f = useFormat();
  const view = useBooking((s) => s.view);
  const seat = usePovSeat();
  const detail = useBooking((s) => s.detail);
  const selected = useBooking((s) => s.selected);
  const pending = useBooking((s) => s.pending);
  const enterPov = useBooking((s) => s.enterPov);
  const exitPov = useBooking((s) => s.exitPov);
  const removeSeat = useBooking((s) => s.removeSeat);
  const recenterLook = useBooking((s) => s.recenterLook);
  const show = view === 'pov' && seat;

  const step = (delta: number) => {
    if (!seat) return;
    const i = selected.indexOf(seat.id);
    const next = selected[(i + delta + selected.length) % selected.length];
    if (next) enterPov(next);
  };

  return (
    <AnimatePresence>
      {show && (
        <motion.section
          key="pov"
          initial={{ opacity: 0, x: 16 }}
          animate={{ opacity: 1, x: 0 }}
          exit={{ opacity: 0, x: 16 }}
          transition={{ duration: 0.3, delay: 0.35 }}
          className="glass absolute end-3 top-20 z-30 w-[min(19rem,calc(100vw-5.5rem))] rounded-2xl p-4 me-14 sm:end-5 sm:top-24 sm:me-14"
          aria-live="polite"
        >
          <p className="text-xs text-sand">{t('seats.pov.sittingIn')}</p>
          <div className="mt-1 flex items-center justify-between gap-2">
            <p className="font-display text-xl leading-tight whitespace-nowrap text-white">{f.seat(seat)}</p>
            {selected.length > 1 && (
              <div className="flex shrink-0 gap-1">
                <IconButton size="sm" label={t('seats.pov.previous')} icon={<ChevronLeft size={16} className="rtl:-scale-x-100" />} onClick={() => step(-1)} />
                <IconButton size="sm" label={t('seats.pov.next')} icon={<ChevronRight size={16} className="rtl:-scale-x-100" />} onClick={() => step(1)} />
              </div>
            )}
          </div>
          <div className="mt-2 flex items-center gap-2 text-sm">
            <SeatTypeDot type={seat.type} />
            <span className="text-cream-200">{t(`common.seat.types.${seat.type}`)}</span>
            <span className="text-dust">·</span>
            <span className="nums font-semibold text-cream">{f.price(seatPrice(detail, seat))}</span>
            {pending[seat.id] && <span className="size-1.5 animate-pulse rounded-full bg-marquee" aria-hidden="true" />}
          </div>
          <ViewScore seat={seat} />
          <div className="mt-3 grid grid-cols-2 gap-2 sm:mt-4">
            <Button size="sm" variant="secondary" icon={<Crosshair size={15} />} onClick={recenterLook}>
              {t('seats.pov.recenter')}
            </Button>
            <Button size="sm" variant="secondary" icon={<LayoutGrid size={15} />} onClick={exitPov}>
              {t('seats.pov.backToHall')}
            </Button>
          </div>
          {selected.includes(seat.id) && (
            <button
              type="button"
              onClick={() => removeSeat(seat.id)}
              className="mt-3 inline-flex items-center gap-1.5 text-xs text-sand transition-colors hover:text-bad"
            >
              <Trash2 size={13} aria-hidden="true" />
              {t('seats.pov.remove')}
            </button>
          )}
        </motion.section>
      )}
    </AnimatePresence>
  );
}

function ViewScore({ seat }: { seat: SeatInfo }) {
  const { t } = useI18n();
  const { screenAngle, offAxis, tilt } = seat.view;
  const tone =
    seat.viewRating === 'excellent' ? 'bg-ok' : seat.viewRating === 'great' ? 'bg-[#9bd16a]' : seat.viewRating === 'good' ? 'bg-warn' : 'bg-bad';
  const notes = [
    t('seats.pov.viewNote', { angle: Math.round(screenAngle) }),
    offAxis < 4 ? t('seats.pov.centred') : t('seats.pov.offCentre', { angle: Math.round(offAxis) }),
    tilt > 4 ? t('seats.pov.lookUp', { angle: Math.round(tilt) }) : tilt < -4 ? t('seats.pov.lookDown', { angle: Math.round(-tilt) }) : null,
  ].filter(Boolean);
  return (
    <div className="mt-4">
      <div className="flex items-center justify-between text-xs">
        <span className="text-sand">{t('seats.pov.viewScore')}</span>
        <span className="font-semibold text-cream">
          {t(`common.seat.view.${seat.viewRating}`)} · <span className="nums" dir="ltr">{seat.viewScore}/100</span>
        </span>
      </div>
      <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-cream/10">
        <div className={clsx('h-full rounded-full transition-[width] duration-700', tone)} style={{ width: `${seat.viewScore}%` }} />
      </div>
      <ul className="mt-3 hidden space-y-1 text-xs text-cream-200 sm:block">
        {notes.map((note) => (
          <li key={note} className="flex gap-2">
            <span className="mt-1.5 size-1 shrink-0 rounded-full bg-velvet" aria-hidden="true" />
            {note}
          </li>
        ))}
      </ul>
    </div>
  );
}

function SeatTypeDot({ type }: { type: SeatType }) {
  return (
    <span
      className="inline-block h-2.5 w-3.5 rounded-[3px]"
      style={{
        background: MAP_COLORS.available[type],
        boxShadow: MAP_COLORS.accent[type] !== 'transparent' ? `inset 0 0 0 1.5px ${MAP_COLORS.accent[type]}` : undefined,
      }}
      aria-hidden="true"
    />
  );
}

// ───────────────────────────── hints & tray ─────────────────────────────

function HintPill() {
  const { t } = useI18n();
  const view = useBooking((s) => s.view);
  const selectedCount = useBooking((s) => s.selected.length);
  const [coarse] = useState(() => isCoarsePointer());
  const [visible, setVisible] = useState(true);

  useEffect(() => {
    setVisible(true);
    const id = window.setTimeout(() => setVisible(false), view === 'pov' ? 7000 : 12000);
    return () => window.clearTimeout(id);
  }, [view]);

  const pov = view === 'pov';
  const title = pov ? (coarse ? t('seats.hints.povTouch') : t('seats.hints.pov')) : coarse ? t('seats.hints.overviewTouch') : t('seats.hints.overview');
  const sub = pov ? (coarse ? t('seats.hints.povSubTouch') : t('seats.hints.povSub')) : coarse ? t('seats.hints.overviewSubTouch') : t('seats.hints.overviewSub');
  const show = visible && !(view === 'overview' && selectedCount > 0);

  return (
    <AnimatePresence>
      {show && (
        <motion.div
          key={view}
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: 8 }}
          transition={{ duration: 0.35, delay: pov ? 0.9 : 0.4 }}
          className="glass pointer-events-none flex items-center gap-3 rounded-full py-2 ps-2.5 pe-5"
        >
          <span className="flex size-8 items-center justify-center rounded-full bg-velvet text-white">
            <MousePointer2 size={15} aria-hidden="true" />
          </span>
          <span className="flex flex-col leading-tight">
            <span className="text-sm font-semibold text-cream">{title}</span>
            <span className="text-[0.7rem] text-sand">{sub}</span>
          </span>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

function SeatTray({ onContinue }: { onContinue: () => void }) {
  const { t } = useI18n();
  const f = useFormat();
  const seats = useSelectedSeats();
  const total = useSelectionTotal();
  const detail = useBooking((s) => s.detail);
  const pending = useBooking((s) => s.pending);
  const povSeatId = useBooking((s) => s.povSeatId);
  const view = useBooking((s) => s.view);
  const enterPov = useBooking((s) => s.enterPov);
  const removeSeat = useBooking((s) => s.removeSeat);
  const busy = Object.keys(pending).length > 0;

  return (
    <section
      className="glass pointer-events-auto flex w-full max-w-3xl flex-wrap items-center gap-x-4 gap-y-3 rounded-2xl p-3 sm:flex-nowrap sm:p-3.5"
      aria-label={t('seats.tray.title')}
    >
      <div className="min-w-0 flex-1 basis-full sm:basis-auto">
        {seats.length === 0 ? (
          <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 px-1">
            <div>
              <p className="text-sm font-semibold text-cream">{t('seats.tray.empty')}</p>
              <p className="text-xs text-sand">{t('seats.tray.emptyHint')}</p>
            </div>
            <BestSeatButton />
          </div>
        ) : (
          <ul className="no-scrollbar flex gap-2 overflow-x-auto">
            {seats.map((seat) => {
              const active = view === 'pov' && povSeatId === seat.id;
              return (
                <li key={seat.id} className="shrink-0">
                  <span
                    className={clsx(
                      'inline-flex items-center rounded-xl border transition-colors',
                      active ? 'border-marquee bg-marquee/15' : 'border-cream/12 bg-night-900/60',
                    )}
                  >
                    <button
                      type="button"
                      onClick={() => enterPov(seat.id)}
                      title={t('seats.tray.viewFrom', { seat: seat.id })}
                      className="flex items-center gap-2 py-1.5 ps-2.5 pe-1.5 text-start"
                    >
                      <SeatTypeDot type={seat.type} />
                      <span dir="ltr" className="font-mono text-sm font-semibold text-cream">
                        {seat.id}
                      </span>
                      <span className="nums text-xs text-sand">{f.price(seatPrice(detail, seat))}</span>
                      {pending[seat.id] && <span className="size-1.5 animate-pulse rounded-full bg-marquee" aria-hidden="true" />}
                    </button>
                    <button
                      type="button"
                      onClick={() => removeSeat(seat.id)}
                      aria-label={t('seats.tray.removeSeat', { seat: seat.id })}
                      className="me-1 inline-flex size-6 items-center justify-center rounded-full text-dust hover:bg-cream/10 hover:text-cream"
                    >
                      <X size={12} />
                    </button>
                  </span>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      <div className="flex w-full items-center justify-between gap-4 sm:w-auto sm:justify-end">
        <HoldTimer compact />
        <div className="text-end">
          <p className="text-[0.7rem] leading-none text-sand">
            {seats.length > 0 ? t('seats.tray.count', { count: seats.length }) : t('seats.tray.max', { max: MAX_SEATS_PER_BOOKING })}
          </p>
          <p className="nums mt-1 font-display text-lg leading-none text-cream">{f.price(total)}</p>
        </div>
        <Button
          onClick={onContinue}
          disabled={seats.length === 0 || busy}
          iconEnd={<ArrowRight size={17} className="rtl:-scale-x-100" aria-hidden="true" />}
        >
          {t('seats.tray.continue')}
        </Button>
      </div>
    </section>
  );
}

/** Picks the free seat with the highest view score (ties: nearest the centre line) and sits you in it. */
function BestSeatButton() {
  const { t } = useI18n();
  const geometry = useBooking((s) => s.geometry);
  const taken = useBooking((s) => s.taken);
  const selected = useBooking((s) => s.selected);
  const status = useBooking((s) => s.detail?.showtime.status);
  const pickSeat = useBooking((s) => s.pickSeat);
  const best = useMemo(() => {
    if (!geometry) return null;
    let choice: SeatInfo | null = null;
    for (const seat of geometry.seats) {
      if (taken[seat.id] || selected.includes(seat.id)) continue;
      if (
        !choice ||
        seat.viewScore > choice.viewScore ||
        (seat.viewScore === choice.viewScore && Math.abs(seat.position[0]) < Math.abs(choice.position[0]))
      ) {
        choice = seat;
      }
    }
    return choice;
  }, [geometry, taken, selected]);

  if (!best || status === 'closed') return null;
  return (
    <Button size="sm" variant="gold" icon={<Sparkles size={15} />} onClick={() => pickSeat(best.id)} title={t('seats.tray.bestHint')}>
      {t('seats.tray.best')}
    </Button>
  );
}

// ───────────────────────────── fallback & veil ─────────────────────────────

function FallbackMap({ geometry }: { geometry: HallGeometry }) {
  const { t } = useI18n();
  const types = (['standard', 'premium', 'vip'] as SeatType[]).filter((type) => geometry.seatCountByType[type] > 0);
  return (
    <div className="absolute inset-0 overflow-y-auto px-4 pb-48 pt-24">
      <div className="mx-auto max-w-3xl">
        <p className="mb-4 rounded-xl border border-warn/30 bg-warn/10 px-4 py-3 text-sm text-warn">{t('seats.noWebgl')}</p>
        <div className="surface rounded-3xl p-4 sm:p-6">
          <SeatMap2D geometry={geometry} variant="full" />
          <SeatLegend types={types} className="mt-5 justify-center" />
        </div>
      </div>
    </div>
  );
}

/** Velvet curtains that part when the hall is ready. */
function CurtainVeil({ open }: { open: boolean }) {
  const { t } = useI18n();
  const ease = [0.7, 0, 0.2, 1] as const;
  const fabric =
    'repeating-linear-gradient(90deg, rgb(0 0 0 / 0.35) 0 6px, rgb(255 255 255 / 0.04) 14px, rgb(0 0 0 / 0.3) 26px), linear-gradient(180deg, #a3121c, #5e070d)';
  return (
    <AnimatePresence>
      {!open && (
        <motion.div key="veil" className="pointer-events-auto absolute inset-0 z-50" exit={{ opacity: 1 }} transition={{ duration: 1.3 }}>
          <motion.div
            className="absolute inset-y-0 left-0 w-1/2 shadow-[20px_0_60px_rgb(0_0_0/0.6)]"
            style={{ background: fabric }}
            exit={{ x: '-102%' }}
            transition={{ duration: 1.25, ease }}
          />
          <motion.div
            className="absolute inset-y-0 right-0 w-1/2 shadow-[-20px_0_60px_rgb(0_0_0/0.6)]"
            style={{ background: fabric }}
            exit={{ x: '102%' }}
            transition={{ duration: 1.25, ease }}
          />
          <motion.div
            className="absolute inset-0 flex flex-col items-center justify-center gap-5 text-center"
            exit={{ opacity: 0 }}
            transition={{ duration: 0.3 }}
          >
            <Emblem className="h-14 w-auto drop-shadow-[0_6px_20px_rgb(0_0_0/0.5)]" />
            <p className="font-display text-xl text-white">{t('seats.loading')}</p>
            <span className="relative h-1 w-40 overflow-hidden rounded-full bg-white/15" dir="ltr">
              <motion.span
                className="absolute inset-y-0 left-0 w-1/3 rounded-full bg-white/75"
                animate={{ x: ['-100%', '300%'] }}
                transition={{ repeat: Infinity, duration: 1.3, ease: 'easeInOut' }}
              />
            </span>
            <p className="text-xs text-white/60">{t('seats.loadingHint')}</p>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
