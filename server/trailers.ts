/**
 * Trailer videos, one per film, uploaded by staff and kept as plain files in a folder
 * (TRAILERS_DIR, default data/trailers):
 *
 *     data/trailers/the-last-caravan.mp4
 *     data/trailers/the-silent-orbit.webm
 *
 * A file dropped into the folder with the film's id as its name works too (read at start-up).
 *
 * Uploads stream straight to disk — a trailer can be hundreds of megabytes, so it is never held
 * in memory — and stop as soon as they pass the size limit. The file's first bytes, not what the
 * browser claims, decide whether it is an MP4 or WebM video; anything else is refused. A finished
 * upload replaces the film's previous trailer in one rename, so a half-written file is never served.
 */
import { randomUUID } from 'node:crypto';
import { createWriteStream, mkdirSync, readdirSync, renameSync, rmSync, statSync } from 'node:fs';
import path from 'node:path';
import type { Readable } from 'node:stream';
import { Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import type { Trailer, TrailerType } from '../shared/types';
import { HttpError } from './errors';

const EXTENSIONS = { mp4: 'video/mp4', webm: 'video/webm' } as const satisfies Record<string, TrailerType>;
type Extension = keyof typeof EXTENSIONS;

/** <film id>.<mp4|webm>. Film ids are catalogue slugs. */
const FILE_NAME = /^([a-z0-9][a-z0-9-]*)\.(mp4|webm)$/;
const TEMP_PREFIX = '.upload-';

interface StoredTrailer {
  extension: Extension;
  size: number;
  modifiedMs: number;
}

/** Recognises a video container from its first bytes. */
export function sniffVideo(head: Uint8Array): Extension | null {
  // ISO base media (MP4, M4V): a box size, then the "ftyp" box type.
  if (head.length >= 8 && head[4] === 0x66 && head[5] === 0x74 && head[6] === 0x79 && head[7] === 0x70) return 'mp4';
  // Matroska / WebM: the EBML magic number.
  if (head.length >= 4 && head[0] === 0x1a && head[1] === 0x45 && head[2] === 0xdf && head[3] === 0xa3) return 'webm';
  return null;
}

export class TrailerStore {
  /** Absolute path of the folder. */
  readonly dir: string;
  private readonly files = new Map<string, StoredTrailer>();

  constructor(
    folder: string,
    readonly maxBytes: number,
  ) {
    const dir = (this.dir = path.resolve(folder));
    mkdirSync(dir, { recursive: true });
    for (const name of readdirSync(dir)) {
      // Leftovers of uploads interrupted by a crash or restart.
      if (name.startsWith(TEMP_PREFIX)) {
        rmSync(path.join(dir, name), { force: true });
        continue;
      }
      const match = FILE_NAME.exec(name);
      if (!match) continue;
      const stat = statSync(path.join(dir, name));
      if (!stat.isFile() || stat.size === 0) continue;
      const [, movieId, extension] = match;
      const known = this.files.get(movieId);
      // Two files for one film (an .mp4 and a .webm): the newer one wins.
      if (!known || stat.mtimeMs > known.modifiedMs) {
        this.files.set(movieId, { extension: extension as Extension, size: stat.size, modifiedMs: stat.mtimeMs });
      }
    }
  }

  /** The film's trailer as the API describes it, or null. */
  get(movieId: string): Trailer | null {
    const file = this.files.get(movieId);
    if (!file) return null;
    return {
      url: `/api/trailers/${movieId}.${file.extension}?v=${Math.round(file.modifiedMs)}`,
      type: EXTENSIONS[file.extension],
      size: file.size,
      updatedAt: new Date(file.modifiedMs).toISOString(),
    };
  }

  /** Path and type of a served file name ("<film id>.<ext>"), or null if there is no such trailer. */
  resolve(fileName: string): { path: string; type: TrailerType } | null {
    const match = FILE_NAME.exec(fileName);
    if (!match) return null;
    const file = this.files.get(match[1]);
    if (!file || file.extension !== match[2]) return null;
    return { path: path.join(this.dir, fileName), type: EXTENSIONS[file.extension] };
  }

  /**
   * Streams an upload to disk and makes it the film's trailer. The caller has already checked that
   * the film exists. `declaredBytes` (the Content-Length) lets an oversized upload fail before it starts.
   */
  async save(movieId: string, body: Readable, declaredBytes?: number): Promise<Trailer> {
    if (declaredBytes !== undefined && declaredBytes > this.maxBytes) throw this.tooLarge();
    const temp = path.join(this.dir, `${TEMP_PREFIX}${randomUUID()}`);
    let size = 0;
    let head = Buffer.alloc(0);
    let extension: Extension | null = null;
    const limit = this.maxBytes;
    const meter = new Transform({
      transform(chunk: Buffer, _encoding, callback) {
        size += chunk.length;
        if (size > limit) {
          callback(new UploadRefused('too-large'));
          return;
        }
        // Decide from the first bytes, so a file that is not a video is refused at once, not after it all arrived.
        if (!extension) {
          head = Buffer.concat([head, chunk.subarray(0, 16 - Math.min(16, head.length))]);
          if (head.length >= 8) {
            extension = sniffVideo(head);
            if (!extension) {
              callback(new UploadRefused('not-video'));
              return;
            }
          }
        }
        callback(null, chunk);
      },
    });
    try {
      await pipeline(body, meter, createWriteStream(temp));
    } catch (error) {
      rmSync(temp, { force: true });
      if (error instanceof UploadRefused) throw error.reason === 'too-large' ? this.tooLarge() : notVideo();
      throw error;
    }
    if (!extension) {
      rmSync(temp, { force: true });
      throw notVideo();
    }
    const target = path.join(this.dir, `${movieId}.${extension}`);
    renameSync(temp, target);
    // A trailer of the other format would otherwise linger on disk.
    const previous = this.files.get(movieId);
    if (previous && previous.extension !== extension) rmSync(path.join(this.dir, `${movieId}.${previous.extension}`), { force: true });
    const stat = statSync(target);
    this.files.set(movieId, { extension, size: stat.size, modifiedMs: stat.mtimeMs });
    return this.get(movieId)!;
  }

  /** Deletes the film's trailer. Returns whether there was one. */
  remove(movieId: string): boolean {
    const file = this.files.get(movieId);
    if (!file) return false;
    rmSync(path.join(this.dir, `${movieId}.${file.extension}`), { force: true });
    this.files.delete(movieId);
    return true;
  }

  private tooLarge(): HttpError {
    const maxMegabytes = Math.floor(this.maxBytes / (1024 * 1024));
    return new HttpError(413, 'FILE_TOO_LARGE', `Trailers can be at most ${maxMegabytes} MB`, { maxBytes: this.maxBytes, maxMegabytes });
  }
}

const notVideo = (): HttpError =>
  new HttpError(415, 'UNSUPPORTED_FILE', 'Upload an MP4 or WebM video file', { accepted: Object.values(EXTENSIONS) });

/** Stops an upload mid-stream. */
class UploadRefused extends Error {
  constructor(readonly reason: 'too-large' | 'not-video') {
    super(`Upload refused: ${reason}`);
    this.name = 'UploadRefused';
  }
}
