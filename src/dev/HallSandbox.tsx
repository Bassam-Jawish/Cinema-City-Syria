/**
 * DEV ONLY (/dev/hall): renders any hall with fake seat data and no server, for tuning the 3D scene.
 * Not included in production builds.
 */
import { useEffect, useState } from 'react';
import { buildHallGeometry } from '@shared/hall';
import { CONCEPT_VIP_LOUNGE, HALLS as LIVE_HALLS } from '@shared/halls';

const HALLS = [...LIVE_HALLS, CONCEPT_VIP_LOUNGE];
import type { ShowtimeDetail } from '@shared/types';
import { CATALOG } from '../../server/data/catalog';
import { useBooking } from '@/store/booking';
import { HallExperience } from '@/three/HallExperience';
import { runtime } from '@/three/runtime';

export default function HallSandbox() {
  const [hallIndex, setHallIndex] = useState(0);
  const [movieIndex, setMovieIndex] = useState(0);
  const view = useBooking((s) => s.view);
  const lights = useBooking((s) => s.lights);
  const selected = useBooking((s) => s.selected);
  const geometry = useBooking((s) => s.geometry);

  useEffect(() => {
    const hall = HALLS[hallIndex];
    const movie = CATALOG[movieIndex];
    const g = buildHallGeometry(hall.layout);
    const taken: Record<string, 'booked' | 'held'> = {};
    g.seats.forEach((seat, i) => {
      if ((i * 7) % 5 === 0 || seat.viewScore > 96) taken[seat.id] = 'booked';
      else if (i % 29 === 0) taken[seat.id] = 'held';
    });
    const detail = {
      showtime: { id: 'sandbox', prices: { standard: 30000, premium: 40000, vip: 75000 } },
      movie,
      hall: { ...hall, seatCount: g.seatCount },
      seats: {},
      holdExpiresAt: null,
      serverTime: new Date().toISOString(),
    } as unknown as ShowtimeDetail;
    useBooking.setState({
      load: 'ready',
      showtimeId: 'sandbox',
      detail,
      geometry: g,
      taken,
      selected: [],
      pending: {},
      view: 'overview',
      povSeatId: null,
      // Local-only seat picking (no API in the sandbox).
      pickSeat: (seatId: string) => {
        const s = useBooking.getState();
        if (s.taken[seatId]) return;
        useBooking.setState({
          selected: s.selected.includes(seatId) ? s.selected : [...s.selected, seatId],
          view: 'pov',
          povSeatId: seatId,
          hoveredSeatId: null,
        });
      },
    });
  }, [hallIndex, movieIndex]);

  const sitBest = () => {
    if (!geometry) return;
    const id = geometry.bestSeatId;
    useBooking.setState((s) => ({
      selected: s.selected.includes(id) ? s.selected : [...s.selected, id],
      taken: Object.fromEntries(Object.entries(s.taken).filter(([k]) => k !== id)),
      view: 'pov',
      povSeatId: id,
    }));
  };

  return (
    <div className="fixed inset-0 bg-night-950" dir="ltr">
      {geometry && <HallExperience className="absolute inset-0" />}
      <div className="absolute start-3 top-3 z-50 flex flex-wrap gap-2 font-mono text-xs">
        {HALLS.map((h, i) => (
          <button key={h.id} className="rounded bg-night-700 px-2 py-1" onClick={() => setHallIndex(i)}>
            {h.id}
          </button>
        ))}
        <button className="rounded bg-night-700 px-2 py-1" onClick={() => setMovieIndex((i) => (i + 1) % CATALOG.length)}>
          film {movieIndex}
        </button>
        <button className="rounded bg-night-700 px-2 py-1" onClick={sitBest}>
          sit best
        </button>
        <button className="rounded bg-night-700 px-2 py-1" onClick={() => useBooking.getState().exitPov()}>
          overview
        </button>
        <button
          className="rounded bg-night-700 px-2 py-1"
          onClick={() => useBooking.getState().setLights(lights === 'auto' ? 'off' : lights === 'off' ? 'on' : 'auto')}
        >
          lights:{lights}
        </button>
        <span className="rounded bg-night-800 px-2 py-1">
          {view} · {selected.join(',')}
        </span>
        <Probe />
      </div>
    </div>
  );
}

function Probe() {
  const [text, setText] = useState('');
  useEffect(() => {
    const id = setInterval(
      () => setText(`blend ${runtime.povBlend.toFixed(2)} yaw ${(runtime.lookYaw * 57.3).toFixed(0)} fov ${runtime.fov.toFixed(0)}`),
      250,
    );
    return () => clearInterval(id);
  }, []);
  return <span className="rounded bg-night-800 px-2 py-1">{text}</span>;
}
