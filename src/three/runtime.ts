/**
 * Per-frame values shared between the camera rig, the 3D scene and DOM overlays.
 *
 * These change every frame, so they deliberately live OUTSIDE React/zustand state:
 * the camera rig writes them inside its frame loop and everyone else just reads them
 * (in useFrame, or in a requestAnimationFrame loop for DOM widgets such as the mini-map compass).
 */
export interface HallRuntime {
  /**
   * 0 = hall overview, 1 = seated at the chosen seat. Eased by the camera rig during the
   * fly-in / fly-out. The scene uses it to dim the house lights in step with the camera.
   */
  povBlend: number;
  /** True while the camera is travelling between the overview and a seat (or between two seats). */
  travelling: boolean;
  /** Look-around offset from "facing the screen", in radians. + yaw = looking to the right. */
  lookYaw: number;
  /** + pitch = looking up. */
  lookPitch: number;
  /**
   * Heading of the camera on the floor plan, in radians: 0 = looking straight at the screen wall (-z),
   * + = turned to the right (+x). Valid in POV; used by the 2D seat map to draw the view cone.
   */
  heading: number;
  /** Current vertical field of view of the camera in degrees. */
  fov: number;
  /**
   * performance.now() until which seat clicks are ignored: the click that ends an orbit drag
   * must not pick the seat under the cursor, even if the pointer came back near where it started.
   */
  suppressClickUntil: number;
}

export const runtime: HallRuntime = {
  povBlend: 0,
  travelling: false,
  lookYaw: 0,
  lookPitch: 0,
  heading: 0,
  fov: 50,
  suppressClickUntil: 0,
};

export function resetRuntime(): void {
  runtime.povBlend = 0;
  runtime.travelling = false;
  runtime.lookYaw = 0;
  runtime.lookPitch = 0;
  runtime.heading = 0;
  runtime.fov = 50;
  runtime.suppressClickUntil = 0;
}
