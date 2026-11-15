/**
 * Composition root of the 3D hall. Each part is self-contained and derives everything it
 * needs from the hall geometry, the booking store, and the shared runtime / lightState modules.
 */
import type { HallGeometry } from '@shared/hall';
import { HallArchitecture } from './architecture/HallArchitecture';
import { CinemaScreen } from './screen/CinemaScreen';
import { HallLighting } from './screen/HallLighting';
import { Seats } from './seats/Seats';

export interface HallPartProps {
  geometry: HallGeometry;
}

export function HallScene({ geometry }: HallPartProps) {
  return (
    <group name="hall">
      <HallLighting geometry={geometry} />
      <HallArchitecture geometry={geometry} />
      <CinemaScreen geometry={geometry} />
      <Seats geometry={geometry} />
    </group>
  );
}
