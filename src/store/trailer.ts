/**
 * Trailer state shared by the 3D screen (which owns the video) and the HUD (which shows the sound
 * controls). The video itself lives in the scene; the HUD reaches it only through setMuted(),
 * which forwards to it synchronously so the click counts as the user gesture browsers want for sound.
 */
import { create } from 'zustand';
import type { TrailerVideoStatus } from '@/three/trailer/TrailerVideo';

/** 'none' = this film has no trailer, or the hall is not open; 'idle' = not started yet. */
export type TrailerStatus = 'none' | 'idle' | TrailerVideoStatus;

export interface TrailerControls {
  setMuted: (muted: boolean) => void;
}

export interface TrailerState {
  status: TrailerStatus;
  /** The customer turned the trailer's sound off. Remembered on this device. */
  muted: boolean;
  /** The browser would not start the trailer with sound, so it plays muted until the customer asks. */
  soundBlocked: boolean;
  setMuted: (muted: boolean) => void;
}

const MUTED_KEY = 'ccs.trailerMuted';

function readMuted(): boolean {
  try {
    return typeof localStorage !== 'undefined' && localStorage.getItem(MUTED_KEY) === '1';
  } catch {
    return false;
  }
}

let controls: TrailerControls | null = null;

/** The scene registers the live video here (and null when it goes away). */
export function attachTrailerControls(next: TrailerControls | null): void {
  controls = next;
}

export const useTrailer = create<TrailerState>()((set) => ({
  status: 'none',
  muted: readMuted(),
  soundBlocked: false,
  setMuted: (muted) => {
    try {
      localStorage.setItem(MUTED_KEY, muted ? '1' : '0');
    } catch {
      // Private mode or storage disabled: the choice just is not remembered.
    }
    set({ muted, ...(muted ? {} : { soundBlocked: false }) });
    controls?.setMuted(muted);
  },
}));

/** Whether the trailer is audible right now (as far as the page can tell). */
export function trailerAudible(state: Pick<TrailerState, 'muted' | 'soundBlocked'>): boolean {
  return !state.muted && !state.soundBlocked;
}
