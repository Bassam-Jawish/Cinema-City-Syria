/**
 * Measures the trailer picture's average colour and brightness — for the light the screen throws
 * into the room — as cheaply as the GPU allows, and only while that is cheap.
 *
 * The frame the screen already holds as a texture is box-filtered down to 16×9 pixels on the GPU,
 * and those 576 bytes are read back. Any read-back waits for the GPU to finish its queued work: on
 * a GPU with headroom that is a millisecond or two, but where the GPU is the bottleneck (a 1080p
 * trailer on a modest laptop) it is 40 ms or more — and the 3D hall and the trailer stutter. So
 * the meter times every read: when it is slow it measures less often, and after two very slow
 * reads it stops for good. The room then keeps the film's own colour; the trailer stays smooth.
 *
 * (The hall used to draw each frame into a 2D canvas to read it, which copies the full 1080p frame
 * back from the GPU — about 60 ms, eight times a second.)
 */
import * as THREE from 'three';
import { averageColour } from '../screenState';

const WIDTH = 16;
const HEIGHT = 9;
/** Measure this often while reads are cheap (ms); the room light eases between measurements. */
const MEASURE_EVERY_MS = 250;
/** Measure no less often than this while reads are merely slow (ms). */
const SLOWEST_EVERY_MS = 4000;
/** A read taking longer than this halves the measuring rate (ms of main thread). */
const SLOW_READ_MS = 4;
/** Two reads in a row taking longer than this stop the measuring for good (a dropped frame each). */
const GIVE_UP_READ_MS = 12;

const vertexShader = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = vec4(position.xy, 0.0, 1.0);
  }
`;

// Each output pixel averages 6×6 samples spread over its own sixteenth-by-ninth of the frame.
const fragmentShader = /* glsl */ `
  uniform sampler2D uMap;
  varying vec2 vUv;
  void main() {
    vec2 cell = vec2(1.0 / ${WIDTH}.0, 1.0 / ${HEIGHT}.0);
    vec3 sum = vec3(0.0);
    for (int i = 0; i < 6; i++) {
      for (int j = 0; j < 6; j++) {
        sum += texture2D(uMap, vUv + (vec2(float(i), float(j)) - 2.5) / 6.0 * cell).rgb;
      }
    }
    gl_FragColor = vec4(sum / 36.0, 1.0);
  }
`;

export type PictureMeasurement = ReturnType<typeof averageColour>;

export class PictureMeter {
  private readonly target = new THREE.WebGLRenderTarget(WIDTH, HEIGHT, {
    depthBuffer: false,
    type: THREE.UnsignedByteType,
    format: THREE.RGBAFormat,
    generateMipmaps: false,
  });
  private readonly camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  private readonly quad: THREE.Mesh<THREE.PlaneGeometry, THREE.ShaderMaterial>;
  private readonly scene = new THREE.Scene();
  private readonly pixels = new Uint8Array(WIDTH * HEIGHT * 4);
  private every = MEASURE_EVERY_MS;
  private measuredAt = Number.NEGATIVE_INFINITY;
  private verySlowReads = 0;
  /** Measuring costs this device too much (or cannot be done): the room keeps the film's colour. */
  private off = false;
  private latest: PictureMeasurement | null = null;

  constructor(private readonly renderer: THREE.WebGLRenderer) {
    const material = new THREE.ShaderMaterial({
      uniforms: { uMap: { value: null } },
      vertexShader,
      fragmentShader,
      depthTest: false,
      depthWrite: false,
    });
    this.quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), material);
    this.quad.frustumCulled = false;
    this.scene.add(this.quad);
  }

  /** Measures `texture` now and then; cheap to call every frame. */
  update(texture: THREE.Texture, now: number): void {
    if (this.off || now - this.measuredAt < this.every) return;
    this.measuredAt = now;
    const renderer = this.renderer;
    const previous = renderer.getRenderTarget();
    this.quad.material.uniforms.uMap.value = texture;
    let cost: number;
    try {
      renderer.setRenderTarget(this.target);
      renderer.render(this.scene, this.camera);
      const started = performance.now();
      renderer.readRenderTargetPixels(this.target, 0, 0, WIDTH, HEIGHT, this.pixels);
      cost = performance.now() - started;
    } catch {
      this.off = true;
      return;
    } finally {
      renderer.setRenderTarget(previous);
    }
    this.latest = averageColour(this.pixels);

    this.verySlowReads = cost > GIVE_UP_READ_MS ? this.verySlowReads + 1 : 0;
    if (this.verySlowReads >= 2) this.off = true;
    else if (cost > SLOW_READ_MS) this.every = Math.min(this.every * 2, SLOWEST_EVERY_MS);
    else this.every = Math.max(MEASURE_EVERY_MS, this.every / 2);
  }

  /** Whether the meter gave up on this device. */
  get stopped(): boolean {
    return this.off;
  }

  /** The newest measurement, handed out once (null when there is nothing new). */
  take(): PictureMeasurement | null {
    const latest = this.latest;
    this.latest = null;
    return latest;
  }

  dispose(): void {
    this.off = true;
    this.target.dispose();
    this.quad.geometry.dispose();
    this.quad.material.dispose();
  }
}
