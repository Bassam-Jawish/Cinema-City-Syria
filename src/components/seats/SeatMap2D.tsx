/**
 * The 2D seat map — drawn from the same hall geometry as the 3D scene, so the two always agree.
 *
 * It is the accessible way to choose seats (every seat is a focusable control with a full
 * spoken label; arrow keys move between seats, Enter/Space picks), the fallback when WebGL is
 * unavailable, and a mini-map while you are in the 3D hall — with a view cone showing where
 * you are looking. The hall is physical: it is never mirrored for right-to-left languages.
 */
import { clsx } from 'clsx';
import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import type { HallGeometry, SeatInfo } from '@shared/hall';
import { useI18n } from '@/i18n';
import { formatPrice } from '@/lib/format';
import { seatPrice, seatUiState, useBooking } from '@/store/booking';
import { MAP_COLORS } from '@/three/palette';
import { runtime } from '@/three/runtime';

const DEG = 180 / Math.PI;

export function SeatMap2D({
  geometry: g,
  variant = 'mini',
  className,
}: {
  geometry: HallGeometry;
  /** mini = HUD panel over the 3D hall; full = primary seat picker (no-WebGL fallback). */
  variant?: 'mini' | 'full';
  className?: string;
}) {
  const { t, lang } = useI18n();
  const taken = useBooking((s) => s.taken);
  const selected = useBooking((s) => s.selected);
  const hoveredSeatId = useBooking((s) => s.hoveredSeatId);
  const povSeatId = useBooking((s) => s.povSeatId);
  const view = useBooking((s) => s.view);
  const detail = useBooking((s) => s.detail);
  const pickSeat = useBooking((s) => s.pickSeat);
  const hover = useBooking((s) => s.hover);

  // Layout in metres; the screen is drawn just above row A to save space.
  const layout = useMemo(() => {
    const seatW = g.layout.seatWidth;
    const labelGap = seatW * 1.5;
    const minX = g.seating.minX - seatW / 2 - labelGap;
    const maxX = g.seating.maxX + seatW / 2 + labelGap;
    const screenY = g.seating.minZ - g.layout.rowPitch * 1.6;
    const minY = screenY - g.layout.rowPitch * 0.9;
    const maxY = g.seating.maxZ + g.layout.rowPitch * 0.7;
    return { seatW, labelGap, minX, maxX, minY, maxY, screenY };
  }, [g]);

  const seatHeight = g.layout.rowPitch * (g.layout.seatStyle === 'recliner' ? 0.5 : 0.56);
  const seatWidth = layout.seatW * 0.8;
  const screenHalf = Math.min(g.screen.width / 2, (layout.maxX - layout.minX) / 2 - layout.seatW);

  // ── keyboard: roving focus across the seat grid ──
  const [focusId, setFocusId] = useState<string | null>(null);
  const refs = useRef(new Map<string, SVGGElement>());
  const firstSeatId = g.seatById[g.bestSeatId]?.id ?? g.seats[0]?.id;
  const activeId = focusId ?? selected[selected.length - 1] ?? firstSeatId;

  const moveFocus = (seat: SeatInfo, key: string): SeatInfo | null => {
    const row = g.rows[seat.rowIndex].seats;
    const i = row.indexOf(seat);
    if (key === 'ArrowLeft') return row[i - 1] ?? null;
    if (key === 'ArrowRight') return row[i + 1] ?? null;
    const targetRow = g.rows[seat.rowIndex + (key === 'ArrowUp' ? -1 : 1)];
    if (!targetRow) return null;
    // Nearest seat by position in the neighbouring row.
    let best = targetRow.seats[0];
    for (const candidate of targetRow.seats) {
      if (Math.abs(candidate.position[0] - seat.position[0]) < Math.abs(best.position[0] - seat.position[0])) best = candidate;
    }
    return best;
  };

  const onKeyDown = (event: KeyboardEvent<SVGGElement>, seat: SeatInfo) => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      pickSeat(seat.id);
      return;
    }
    if (!event.key.startsWith('Arrow')) return;
    event.preventDefault();
    event.stopPropagation();
    const next = moveFocus(seat, event.key);
    if (next) {
      setFocusId(next.id);
      refs.current.get(next.id)?.focus();
      if (view === 'overview') hover(next.id);
    }
  };

  const describe = (seat: SeatInfo): string => {
    const state = seatUiState({ taken, selected }, seat.id);
    const base = t('seats.map.seatAria', {
      row: seat.row,
      number: seat.number,
      type: t(`common.seat.types.${seat.type}`),
      state: t(`common.seat.states.${state}`),
    });
    return state === 'available' ? `${base}${lang === 'ar' ? '، ' : ', '}${formatPrice(seatPrice(detail, seat), lang)}` : base;
  };

  const full = variant === 'full';

  return (
    <svg
      viewBox={`${layout.minX} ${layout.minY} ${layout.maxX - layout.minX} ${layout.maxY - layout.minY}`}
      className={clsx('block h-auto w-full select-none', className)}
      style={{ direction: 'ltr' }}
      role="group"
      aria-label={t('seats.map.title')}
    >
      <defs>
        <linearGradient id="map-screen" x1="0" x2="0" y1="0" y2="1">
          <stop offset="0" stopColor="#f4f1ec" stopOpacity="0.9" />
          <stop offset="1" stopColor="#f4f1ec" stopOpacity="0" />
        </linearGradient>
        <radialGradient id="map-cone" cx="0.5" cy="1" r="1">
          <stop offset="0" stopColor="#ffd166" stopOpacity="0.55" />
          <stop offset="1" stopColor="#ffd166" stopOpacity="0" />
        </radialGradient>
      </defs>

      {/* Screen */}
      <path
        d={`M ${-screenHalf} ${layout.screenY + 0.25} Q 0 ${layout.screenY - 0.35} ${screenHalf} ${layout.screenY + 0.25}`}
        fill="none"
        stroke="#f4f1ec"
        strokeWidth={0.09}
        strokeLinecap="round"
      />
      <path
        d={`M ${-screenHalf} ${layout.screenY + 0.25} Q 0 ${layout.screenY - 0.35} ${screenHalf} ${layout.screenY + 0.25} L ${screenHalf * 0.8} ${layout.screenY + 1.2} L ${-screenHalf * 0.8} ${layout.screenY + 1.2} Z`}
        fill="url(#map-screen)"
        opacity={0.12}
      />
      <text
        x={0}
        y={layout.screenY - 0.35}
        textAnchor="middle"
        fontSize={0.42}
        fill="#aaa39b"
        style={{ fontFamily: 'var(--font-sans)', direction: lang === 'ar' ? 'rtl' : 'ltr' }}
      >
        {t('seats.map.screen')}
      </text>

      {/* Row letters at both ends */}
      {g.rows.map((row) => (
        <g key={row.label} fill="#7a736d" fontSize={0.36} style={{ fontFamily: 'var(--font-mono)' }}>
          <text x={row.seats[0].position[0] - layout.seatW * 1.05} y={row.z + 0.13} textAnchor="middle">
            {row.label}
          </text>
          <text x={row.seats[row.seats.length - 1].position[0] + layout.seatW * 1.05} y={row.z + 0.13} textAnchor="middle">
            {row.label}
          </text>
        </g>
      ))}

      {/* Seats */}
      {g.seats.map((seat) => {
        const state = seatUiState({ taken, selected }, seat.id);
        const isHovered = seat.id === hoveredSeatId && view === 'overview';
        const isPov = seat.id === povSeatId && view === 'pov';
        const fill =
          state === 'selected'
            ? MAP_COLORS.selected
            : state === 'booked'
              ? MAP_COLORS.booked
              : state === 'held'
                ? MAP_COLORS.held
                : MAP_COLORS.available[seat.type];
        const x = seat.position[0] - seatWidth / 2;
        const y = seat.position[2] - seatHeight / 2;
        const interactive = state === 'available' || state === 'selected';
        return (
          <g
            key={seat.id}
            ref={(el) => {
              if (el) refs.current.set(seat.id, el);
              else refs.current.delete(seat.id);
            }}
            role="button"
            tabIndex={seat.id === activeId ? 0 : -1}
            aria-label={describe(seat)}
            aria-pressed={state === 'selected'}
            aria-disabled={!interactive}
            onClick={() => pickSeat(seat.id)}
            onMouseEnter={() => view === 'overview' && hover(seat.id)}
            onMouseLeave={() => view === 'overview' && hover(null)}
            onFocus={() => setFocusId(seat.id)}
            onKeyDown={(event) => onKeyDown(event, seat)}
            className={clsx('outline-none', interactive ? 'cursor-pointer' : 'cursor-not-allowed')}
          >
            <rect
              x={x}
              y={y}
              width={seatWidth}
              height={seatHeight}
              rx={seatWidth * 0.22}
              fill={fill}
              stroke={
                isHovered || seat.id === focusId
                  ? '#ffe2a8'
                  : state === 'available'
                    ? MAP_COLORS.accent[seat.type]
                    : 'transparent'
              }
              strokeWidth={isHovered || seat.id === focusId ? 0.08 : 0.05}
              opacity={state === 'booked' ? 0.85 : 1}
            />
            {state === 'held' && (
              <rect x={x} y={y} width={seatWidth} height={seatHeight} rx={seatWidth * 0.22} fill="#ffd166" opacity={0.25}>
                <animate attributeName="opacity" values="0.05;0.35;0.05" dur="1.8s" repeatCount="indefinite" />
              </rect>
            )}
            {isPov && (
              <circle
                cx={seat.position[0]}
                cy={seat.position[2]}
                r={seatWidth * 0.95}
                fill="none"
                stroke="#ffd166"
                strokeWidth={0.07}
              />
            )}
            {full && state === 'selected' && (
              <text
                x={seat.position[0]}
                y={seat.position[2] + 0.1}
                textAnchor="middle"
                fontSize={0.26}
                fill="#0d0c0c"
                fontWeight={700}
                style={{ fontFamily: 'var(--font-mono)', pointerEvents: 'none' }}
              >
                {seat.number}
              </text>
            )}
          </g>
        );
      })}

      {/* Only the mini-map accompanies a 3D camera; the full map (no-WebGL fallback) has nothing to point. */}
      {!full && povSeatId && view === 'pov' && g.seatById[povSeatId] && <ViewCone seat={g.seatById[povSeatId]} />}
    </svg>
  );
}

/** Wedge from the seat in the direction the seated camera is looking (updated every frame). */
function ViewCone({ seat }: { seat: SeatInfo }) {
  const group = useRef<SVGGElement>(null);
  useEffect(() => {
    let frame = 0;
    const tick = () => {
      const el = group.current;
      if (el) {
        const angle = runtime.heading * DEG;
        el.setAttribute('transform', `translate(${seat.position[0]} ${seat.position[2]}) rotate(${angle.toFixed(2)})`);
      }
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [seat]);

  // A 76° wedge pointing "up" (towards the screen) before rotation.
  const length = 3.2;
  const half = (38 * Math.PI) / 180;
  const dx = Math.sin(half) * length;
  const dy = -Math.cos(half) * length;
  return (
    <g ref={group} pointerEvents="none">
      <path d={`M 0 0 L ${-dx} ${dy} A ${length} ${length} 0 0 1 ${dx} ${dy} Z`} fill="url(#map-cone)" />
      <circle r={0.16} fill="#ffd166" />
    </g>
  );
}
