import { describe, expect, it } from 'vitest';
import { DEFAULT_DEV_PORT, DEFAULT_PORT, loadConfig } from './config';

describe('server port', () => {
  it('is 4000 for the demo server, PORT or API_PORT when set', () => {
    expect(loadConfig({}, false).port).toBe(DEFAULT_PORT);
    expect(loadConfig({ PORT: '4001' }, false).port).toBe(4001);
    expect(loadConfig({ PORT: '4001', API_PORT: '4002' }, false).port).toBe(4002);
  });

  it('is its own port in development, so a demo server left running on 4000 cannot serve the dev site', () => {
    expect(DEFAULT_DEV_PORT).not.toBe(DEFAULT_PORT);
    expect(loadConfig({}, true).port).toBe(DEFAULT_DEV_PORT);
    // PORT belongs to the Vite dev server there; only API_PORT moves the API.
    expect(loadConfig({ PORT: '5173' }, true).port).toBe(DEFAULT_DEV_PORT);
    expect(loadConfig({ API_PORT: '4200' }, true).port).toBe(4200);
  });
});
