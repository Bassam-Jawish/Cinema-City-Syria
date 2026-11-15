/**
 * App-wide toast notifications. Messages are i18n keys (see src/i18n/locales/<lang>/common.ts → notices),
 * so the same notice renders correctly in Arabic and English.
 */
import { create } from 'zustand';

export type NoticeKind = 'info' | 'success' | 'warning' | 'error';

/** Keys under `common.notices`. */
export type NoticeKey =
  | 'seatTaken'
  | 'seatJustTaken'
  | 'seatLimit'
  | 'seatLost'
  | 'holdExpired'
  | 'showtimeClosed'
  | 'network'
  | 'generic'
  | 'bookingCancelled'
  | 'copied'
  | 'demoReset'
  | 'checkedIn'
  | 'wrongPin';

export interface Notice {
  id: number;
  kind: NoticeKind;
  key: NoticeKey;
  params?: Record<string, string | number>;
}

interface NoticeState {
  notices: Notice[];
  push: (kind: NoticeKind, key: NoticeKey, params?: Record<string, string | number>) => number;
  dismiss: (id: number) => void;
}

const LIFETIME_MS = 5200;
const MAX_VISIBLE = 4;
let nextId = 1;

export const useNotices = create<NoticeState>()((set, get) => ({
  notices: [],
  push: (kind, key, params) => {
    // Collapse repeats of the same message (e.g. frantic clicking on a taken seat).
    const duplicate = get().notices.find((n) => n.key === key && JSON.stringify(n.params) === JSON.stringify(params));
    if (duplicate) return duplicate.id;
    const id = nextId++;
    set((s) => ({ notices: [...s.notices, { id, kind, key, params }].slice(-MAX_VISIBLE) }));
    setTimeout(() => get().dismiss(id), LIFETIME_MS);
    return id;
  },
  dismiss: (id) => set((s) => ({ notices: s.notices.filter((n) => n.id !== id) })),
}));

/** Show a toast from anywhere (components, stores, event handlers). */
export function notify(kind: NoticeKind, key: NoticeKey, params?: Record<string, string | number>): void {
  useNotices.getState().push(kind, key, params);
}
