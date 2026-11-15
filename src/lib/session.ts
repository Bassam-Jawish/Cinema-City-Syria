/**
 * Anonymous browser session. The id owns seat holds on the server and lets a customer
 * see the bookings they made on this device — there are no accounts in the MVP.
 */
const STORAGE_KEY = 'ccs.session';

function generateId(): string {
  // randomUUID needs a secure context (https or localhost); fall back for plain-http LAN demos.
  const webCrypto = globalThis.crypto as Crypto | undefined;
  if (typeof webCrypto?.randomUUID === 'function') return webCrypto.randomUUID();
  const bytes = new Uint8Array(16);
  if (webCrypto) webCrypto.getRandomValues(bytes);
  else for (let i = 0; i < bytes.length; i++) bytes[i] = Math.floor(Math.random() * 256);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

let cached: string | null = null;

export function getSessionId(): string {
  if (cached) return cached;
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored && /^[A-Za-z0-9_-]{16,64}$/.test(stored)) {
      cached = stored;
      return stored;
    }
  } catch {
    // Storage can be unavailable (private mode); fall back to an in-memory id.
  }
  cached = generateId();
  try {
    localStorage.setItem(STORAGE_KEY, cached);
  } catch {
    // ignore
  }
  return cached;
}
