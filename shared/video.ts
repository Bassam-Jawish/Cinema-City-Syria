/**
 * Recognising a trailer video from its first bytes — used by the server, which decides by them
 * (never by the name or type a browser claims), and by the staff page, which checks a file the
 * same way before uploading it, so a wrong file is refused at once instead of after the upload.
 */
import type { TrailerType } from './types';

/** Bytes needed to recognise a file. */
export const VIDEO_SNIFF_BYTES = 8;

export const TRAILER_EXTENSIONS = { mp4: 'video/mp4', webm: 'video/webm' } as const satisfies Record<string, TrailerType>;
export type TrailerExtension = keyof typeof TRAILER_EXTENSIONS;

/** The container of a video file from its first bytes: 'mp4' (ISO base media), 'webm' (Matroska), or null. */
export function sniffVideo(head: Uint8Array): TrailerExtension | null {
  // ISO base media (MP4, M4V, MOV): a box size, then the "ftyp" box type.
  if (head.length >= 8 && head[4] === 0x66 && head[5] === 0x74 && head[6] === 0x79 && head[7] === 0x70) return 'mp4';
  // Matroska / WebM: the EBML magic number.
  if (head.length >= 4 && head[0] === 0x1a && head[1] === 0x45 && head[2] === 0xdf && head[3] === 0xa3) return 'webm';
  return null;
}
