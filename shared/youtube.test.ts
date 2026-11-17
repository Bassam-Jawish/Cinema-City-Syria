import { describe, expect, it } from 'vitest';
import { CATALOG } from '../server/data/catalog';
import { FULL_FRAME_ASPECT, parseStartTime, parseYouTubeUrl, youtubeTrailer } from './youtube';

const ID = 'aqz-KE-bpKQ';

describe('parseYouTubeUrl', () => {
  it.each([
    [`https://www.youtube.com/watch?v=${ID}`, 0],
    [`https://youtube.com/watch?v=${ID}&list=PL123&index=2`, 0],
    [`https://m.youtube.com/watch?feature=share&v=${ID}`, 0],
    [`https://music.youtube.com/watch?v=${ID}`, 0],
    [`http://www.youtube.com/watch?v=${ID}`, 0],
    [`www.youtube.com/watch?v=${ID}`, 0],
    [`https://youtu.be/${ID}`, 0],
    [`youtu.be/${ID}?si=AbCdEf123`, 0],
    [`https://youtu.be/${ID}?t=42`, 42],
    [`https://www.youtube.com/watch?v=${ID}&t=1m30s`, 90],
    [`https://www.youtube.com/watch?v=${ID}#t=2m`, 120],
    [`https://www.youtube.com/embed/${ID}?start=75&rel=0`, 75],
    [`https://www.youtube-nocookie.com/embed/${ID}`, 0],
    [`https://www.youtube.com/shorts/${ID}`, 0],
    [`https://www.youtube.com/live/${ID}?feature=shared`, 0],
    [`https://www.youtube.com/v/${ID}`, 0],
    [`  https://www.YouTube.com/watch?v=${ID}  `, 0],
    [ID, 0],
  ])('reads %s', (link, start) => {
    expect(parseYouTubeUrl(link)).toEqual({ id: ID, start });
  });

  it.each([
    '',
    'not a link',
    'https://vimeo.com/123456789',
    `https://www.youtube.com.evil.example/watch?v=${ID}`,
    `https://evil.example/?u=https://youtu.be/${ID}`,
    `https://notyoutube.com/watch?v=${ID}`,
    'https://www.youtube.com/watch?v=short',
    'https://www.youtube.com/watch?v=aqz-KE-bpKQX',
    'https://www.youtube.com/playlist?list=PLx0sYbCqOb8TBPRdmBHs5Iftvv9TPboYG',
    'https://www.youtube.com/@BlenderStudio',
    'https://www.youtube.com/',
    `javascript:alert(1)//youtu.be/${ID}`,
    `ftp://youtu.be/${ID}`,
    `https://user:pass@youtu.be/${ID}`,
    `https://youtu.be/${ID.slice(0, 10)}<`,
  ])('rejects %j', (link) => {
    expect(parseYouTubeUrl(link)).toBeNull();
  });
});

describe('parseStartTime', () => {
  it.each([
    ['42', 42],
    ['42s', 42],
    ['1m', 60],
    ['1m5s', 65],
    ['1h2m3s', 3723],
    ['12.7', 12],
    [' 90 ', 90],
    ['', 0],
    [null, 0],
    ['soon', 0],
    ['-5', 0],
  ])('%j → %d', (value, seconds) => {
    expect(parseStartTime(value)).toBe(seconds);
  });
});

describe('youtubeTrailer', () => {
  it('keeps the link, the id and the start time, and defaults to a full 16:9 picture', () => {
    expect(youtubeTrailer(`https://youtu.be/${ID}?t=12`)).toEqual({
      url: `https://youtu.be/${ID}?t=12`,
      youtubeId: ID,
      start: 12,
      aspect: Math.round(FULL_FRAME_ASPECT * 1000) / 1000,
    });
  });

  it('takes an explicit start and picture shape', () => {
    expect(youtubeTrailer(`https://www.youtube.com/watch?v=${ID}&t=30`, { start: 5, aspect: 2.39 })).toMatchObject({
      start: 5,
      aspect: 2.39,
    });
  });

  it('refuses links that are not a single YouTube video, and impossible options', () => {
    expect(() => youtubeTrailer('https://vimeo.com/1')).toThrow(/Not a YouTube video link/);
    expect(() => youtubeTrailer(ID, { aspect: 0.5 })).toThrow(/aspect/);
    expect(() => youtubeTrailer(ID, { start: -1 })).toThrow(/start/);
  });

  it('gives every film in the catalogue a valid trailer or none', () => {
    for (const movie of CATALOG) {
      expect(movie.trailer === null || parseYouTubeUrl(movie.trailer.url)?.id === movie.trailer.youtubeId).toBe(true);
    }
    // Every bookable film has one, so sitting down always starts something on screen.
    expect(CATALOG.filter((movie) => movie.status === 'now_showing').every((movie) => movie.trailer)).toBe(true);
  });
});
