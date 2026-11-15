/**
 * The lighting "cue" for the hall, shared by every 3D component.
 *
 * A real cinema has two states: house lights up while people find their seats, and
 * house lights down when the film plays. `house` is the single dimmer everything follows:
 *
 *   house = 1 → hall fully lit (overview: seats and their colours must read clearly)
 *   house = 0 → house lights down (seated POV: the screen is the main light source)
 *
 * <LightDirector> (see HallExperience) eases `house` once per frame, in step with the camera
 * fly-in. Scene components read it inside useFrame and scale their light intensities and
 * emissive materials — never keep a private dimmer.
 */
export interface LightState {
  /** 0–1 house-light level, eased. */
  house: number;
  /** 0–1 where the dimmer is heading. */
  houseTarget: number;
  /** 0–1 how "on" the film is: 0.35 idle slide with the lights up → 1 full picture in the dark. */
  screen: number;
}

export const lightState: LightState = {
  house: 1,
  houseTarget: 1,
  screen: 0.35,
};

export function resetLightState(): void {
  lightState.house = 1;
  lightState.houseTarget = 1;
  lightState.screen = 0.35;
}

/** Linear blend helper for per-frame use: value when the house lights are down / up. */
export function byHouse(dark: number, lit: number): number {
  return dark + (lit - dark) * lightState.house;
}
