/**
 * Trailer videos, one per film, uploaded by staff and kept as plain files in a folder
 * (TRAILERS_DIR, default data/trailers):
 *
 *     data/trailers/avengers-doomsday.mp4
 *     data/trailers/dune-part-three.webm
 *
 * A file dropped into the folder with the film's id as its name works too (read at start-up).
 *
 * Uploads stream straight to disk — a trailer can be hundreds of megabytes, so it is never held
 * in memory — and stop as soon as they pass the size limit. The file's first bytes, not what the
 * browser claims, decide whether it is an MP4 or WebM video; anything else is refused. A finished
 * upload replaces the film's previous trailer only once it is complete, so a half-written file is
 * never served — and the replacement works even while someone is still watching the old file,
 * which Windows would otherwise refuse.
 */
import { randomUUID } from 'node:crypto';
import { createWriteStream, existsSync, mkdirSync, readdirSync, renameSync, rmSync, statSync, type WriteStream } from 'node:fs';
import path from 'node:path';
import type { Readable } from 'node:stream';
import type { Trailer, TrailerLimits, TrailerType } from '../shared/types';
import { TRAILER_EXTENSIONS, VIDEO_SNIFF_BYTES, sniffVideo, type TrailerExtension } from '../shared/video';
import { HttpError } from './errors';

/** <film id>.<mp4|webm>. Film ids are catalogue slugs. */
const FILE_NAME = /^([a-z0-9][a-z0-9-]*)\.(mp4|webm)$/;
/** An upload being written. */
const TEMP_PREFIX = '.upload-';
/** A replaced or removed trailer, deleted as soon as nobody reads it any more. */
const RETIRED_PREFIX = '.retired-';

interface StoredTrailer {
  extension: TrailerExtension;
  size: number;
  modifiedMs: number;
}

/** The `v` in a trailer URL: changes with every upload, so each version of a file has its own URL. */
const versionOf = (file: StoredTrailer): string => String(Math.round(file.modifiedMs));

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
      // Leftovers of uploads interrupted by a crash or restart, and old files that were still open.
      if (name.startsWith(TEMP_PREFIX) || name.startsWith(RETIRED_PREFIX)) {
        discard(path.join(dir, name));
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
        this.files.set(movieId, { extension: extension as TrailerExtension, size: stat.size, modifiedMs: stat.mtimeMs });
      }
    }
  }

  /** What an upload may be. */
  limits(): TrailerLimits {
    return { maxBytes: this.maxBytes, accepted: Object.values(TRAILER_EXTENSIONS) };
  }

  /** The film's trailer as the API describes it, or null. */
  get(movieId: string): Trailer | null {
    const file = this.files.get(movieId);
    if (!file) return null;
    return {
      url: `/api/trailers/${movieId}.${file.extension}?v=${versionOf(file)}`,
      type: TRAILER_EXTENSIONS[file.extension],
      size: file.size,
      updatedAt: new Date(file.modifiedMs).toISOString(),
    };
  }

  /**
   * Path and type of a served file name ("<film id>.<ext>"), or null if there is no such trailer.
   * A `version` (the URL's `v`) of a file that has since been replaced is null too: a player still
   * holding the old URL must not be handed ranges of a different file.
   */
  resolve(fileName: string, version?: string): { path: string; type: TrailerType } | null {
    const match = FILE_NAME.exec(fileName);
    if (!match) return null;
    const file = this.files.get(match[1]);
    if (!file || file.extension !== match[2]) return null;
    if (version !== undefined && version !== versionOf(file)) return null;
    return { path: path.join(this.dir, fileName), type: TRAILER_EXTENSIONS[file.extension] };
  }

  /**
   * Streams an upload to disk and makes it the film's trailer. The caller has already checked that
   * the film exists. `declaredBytes` (the Content-Length) lets an oversized upload fail before it starts.
   */
  async save(movieId: string, body: Readable, declaredBytes?: number): Promise<Trailer> {
    // Nothing has been read yet, so Node discards the body by itself once the answer is sent.
    if (declaredBytes !== undefined && declaredBytes > this.maxBytes) throw this.tooLarge();

    const temp = path.join(this.dir, `${TEMP_PREFIX}${randomUUID()}`);
    const out = createWriteStream(temp);
    let failure: Error | null = null;
    out.on('error', (error) => (failure ??= error));
    /** Stops writing; the rest of the upload is read and dropped. */
    const fail = (error: Error): void => {
      failure ??= error;
      out.destroy();
    };
    /** Deletes the partial file once it is closed (deleting it earlier could race its creation). */
    const abandon = async (): Promise<void> => {
      out.destroy();
      if (!out.closed) await new Promise<void>((resolve) => out.once('close', () => resolve()));
      discard(temp);
    };
    let size = 0;
    let head = Buffer.alloc(0);
    let extension: TrailerExtension | null = null;

    try {
      // Read by hand: pipeline() would destroy the request on the first refusal, cutting the connection,
      // and the browser — which only reads the answer once it has sent the whole file — would report a
      // network error instead of the reason. So a refused upload is read to the end and dropped.
      for await (const chunk of body.iterator({ destroyOnReturn: false }) as AsyncIterable<Buffer>) {
        if (failure) continue;
        size += chunk.length;
        if (size > this.maxBytes) {
          fail(this.tooLarge());
          continue;
        }
        // Decide from the first bytes, so a file that is not a video is never written to disk.
        if (!extension) {
          if (head.length < VIDEO_SNIFF_BYTES) head = Buffer.concat([head, chunk.subarray(0, VIDEO_SNIFF_BYTES - head.length)]);
          if (head.length >= VIDEO_SNIFF_BYTES && !(extension = sniffVideo(head))) {
            fail(notVideo());
            continue;
          }
        }
        if (!out.write(chunk)) await drained(out);
      }
      if (!failure && !extension) fail(notVideo()); // shorter than any video
      if (!failure) await closed(out);
    } catch (error) {
      await abandon();
      // The browser went away mid-upload (Cancel, a closed tab, a lost network): nobody to answer.
      if (isClientAbort(error)) throw new HttpError(400, 'VALIDATION', 'The upload was interrupted before it finished');
      throw error;
    }
    if (failure || !extension) {
      await abandon();
      throw failure ?? notVideo();
    }

    const target = path.join(this.dir, `${movieId}.${extension}`);
    replaceFile(temp, target);
    // A trailer of the other format would otherwise linger on disk.
    const previous = this.files.get(movieId);
    if (previous && previous.extension !== extension) retire(path.join(this.dir, `${movieId}.${previous.extension}`));
    const stat = statSync(target);
    this.files.set(movieId, { extension, size: stat.size, modifiedMs: stat.mtimeMs });
    return this.get(movieId)!;
  }

  /** Deletes the film's trailer. Returns whether there was one. */
  remove(movieId: string): boolean {
    const file = this.files.get(movieId);
    if (!file) return false;
    retire(path.join(this.dir, `${movieId}.${file.extension}`));
    this.files.delete(movieId);
    return true;
  }

  private tooLarge(): HttpError {
    const maxMegabytes = Math.floor(this.maxBytes / (1024 * 1024));
    return new HttpError(413, 'FILE_TOO_LARGE', `Trailers can be at most ${maxMegabytes} MB`, { maxBytes: this.maxBytes, maxMegabytes });
  }
}

const notVideo = (): HttpError =>
  new HttpError(415, 'UNSUPPORTED_FILE', 'Upload an MP4 or WebM video file', { accepted: Object.values(TRAILER_EXTENSIONS) });

/** The customer's browser went away mid-upload (staff pressed Cancel, closed the tab, lost the network). */
function isClientAbort(error: unknown): boolean {
  const { code, message } = (error ?? {}) as { code?: unknown; message?: unknown };
  return code === 'ECONNRESET' || code === 'ECONNABORTED' || message === 'aborted';
}

/** Waits until the file takes more data — or fails, which its 'error' listener records. */
function drained(out: WriteStream): Promise<void> {
  if (out.destroyed) return Promise.resolve();
  return new Promise((resolve) => {
    const done = () => {
      out.off('drain', done);
      out.off('error', done);
      out.off('close', done);
      resolve();
    };
    out.on('drain', done);
    out.on('error', done);
    out.on('close', done);
  });
}

/** Ends the file and waits until it is closed (Windows will not rename a file that is still open). */
function closed(out: WriteStream): Promise<void> {
  if (out.closed) return Promise.resolve();
  return new Promise((resolve, reject) => {
    out.once('close', resolve);
    out.once('error', reject);
    out.end();
  });
}

/**
 * Puts `source` in place of `target`. Windows refuses to rename over a file that is open — and a
 * trailer is open whenever someone is watching it — but it does let the open file be moved aside
 * (readers keep reading it) and then deleted.
 */
function replaceFile(source: string, target: string): void {
  let aside: string | null = null;
  try {
    if (existsSync(target)) {
      const away = path.join(path.dirname(target), `${RETIRED_PREFIX}${randomUUID()}`);
      renameSync(target, away);
      aside = away;
    }
    renameSync(source, target);
  } catch (error) {
    discard(source);
    if (aside) {
      try {
        renameSync(aside, target); // put the old trailer back
      } catch {
        // Left aside; it is swept at the next start-up.
      }
    }
    throw error;
  }
  if (aside) discard(aside);
}

/** Takes a trailer file out of service, deleting it if the system allows it while it is open. */
function retire(file: string): void {
  const aside = path.join(path.dirname(file), `${RETIRED_PREFIX}${randomUUID()}`);
  try {
    renameSync(file, aside);
  } catch {
    discard(file);
    return;
  }
  discard(aside);
}

/** Deletes a file if it can; what cannot be deleted now is swept at the next start-up. */
function discard(file: string): void {
  try {
    rmSync(file, { force: true });
  } catch {
    // Still open somewhere on a system that forbids it: the start-up sweep gets it.
  }
}
