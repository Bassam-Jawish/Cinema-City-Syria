/**
 * Tiny, dependency-free i18n for the two interface languages: Arabic (default, RTL) and English.
 *
 *   const { t, lang, dir, L } = useI18n();
 *   t('seats.tray.continue')                       → string
 *   t('common.seatCount', { count: 3 })            → plural-aware (Arabic has six plural forms)
 *   L(movie.title)                                 → picks ar / en from a Localized value
 *
 * Dictionaries live in ./locales/<lang>/<namespace>.ts. English is the source of truth for
 * the key set: each Arabic namespace is typed against its English twin, so a missing or
 * misspelled key is a compile error.
 */
import { useMemo } from 'react';
import { create } from 'zustand';
import type { Lang, Localized } from '@shared/types';
import { ar } from './locales/ar';
import { en } from './locales/en';

export type Dictionary = typeof en;

/** A plural entry: pick a form with Intl.PluralRules. `other` is the mandatory fallback. */
export interface PluralForms {
  zero?: string;
  one?: string;
  two?: string;
  few?: string;
  many?: string;
  other: string;
}

type Join<P extends string, K extends string> = P extends '' ? K : `${P}.${K}`;
type KeyPaths<T, P extends string = ''> = T extends string
  ? P
  : T extends PluralForms
    ? P
    : { [K in keyof T & string]: KeyPaths<T[K], Join<P, K>> }[keyof T & string];

/** Every valid translation key, e.g. "common.nav.home". */
export type TKey = KeyPaths<Dictionary>;
export type TParams = Record<string, string | number>;
export type TFunction = (key: TKey, params?: TParams) => string;

const DICTIONARIES: Record<Lang, Dictionary> = { en, ar: ar as Dictionary };
const STORAGE_KEY = 'ccs.lang';
export const DEFAULT_LANG: Lang = 'ar';
export const LANGS: readonly Lang[] = ['ar', 'en'];

export const dirOf = (lang: Lang): 'rtl' | 'ltr' => (lang === 'ar' ? 'rtl' : 'ltr');

function isPlural(value: unknown): value is PluralForms {
  return typeof value === 'object' && value !== null && typeof (value as PluralForms).other === 'string';
}

const pluralRules: Partial<Record<Lang, Intl.PluralRules>> = {};
function pluralCategory(lang: Lang, count: number): Intl.LDMLPluralRule {
  const rules = (pluralRules[lang] ??= new Intl.PluralRules(lang));
  return rules.select(count);
}

function interpolate(template: string, params?: TParams): string {
  if (!params) return template;
  return template.replace(/\{(\w+)\}/g, (match, name: string) => (name in params ? String(params[name]) : match));
}

function lookup(dictionary: Dictionary, key: string): unknown {
  let node: unknown = dictionary;
  for (const part of key.split('.')) {
    if (typeof node !== 'object' || node === null) return undefined;
    node = (node as Record<string, unknown>)[part];
  }
  return node;
}

/** Translate outside React (stores, utilities). Components should use useI18n(). */
export function translate(lang: Lang, key: TKey, params?: TParams): string {
  const value = lookup(DICTIONARIES[lang], key) ?? lookup(DICTIONARIES.en, key);
  if (typeof value === 'string') return interpolate(value, params);
  if (isPlural(value)) {
    const count = Number(params?.count ?? 0);
    const form = value[pluralCategory(lang, count)] ?? value.other;
    return interpolate(form, params);
  }
  return key;
}

function readInitialLang(): Lang {
  try {
    const fromUrl = new URLSearchParams(window.location.search).get('lang');
    if (fromUrl === 'ar' || fromUrl === 'en') {
      // A shared ?lang= link sets the language for the rest of the visit too.
      localStorage.setItem(STORAGE_KEY, fromUrl);
      return fromUrl;
    }
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored === 'ar' || stored === 'en') return stored;
  } catch {
    // ignore (SSR / storage disabled)
  }
  return DEFAULT_LANG;
}

function applyToDocument(lang: Lang): void {
  if (typeof document === 'undefined') return;
  document.documentElement.lang = lang;
  document.documentElement.dir = dirOf(lang);
}

interface LangState {
  lang: Lang;
  setLang: (lang: Lang) => void;
}

export const useLangStore = create<LangState>()((set) => {
  const initial = typeof window === 'undefined' ? DEFAULT_LANG : readInitialLang();
  applyToDocument(initial);
  return {
    lang: initial,
    setLang: (lang) => {
      applyToDocument(lang);
      try {
        localStorage.setItem(STORAGE_KEY, lang);
      } catch {
        // ignore
      }
      set({ lang });
    },
  };
});

export interface I18n {
  lang: Lang;
  dir: 'rtl' | 'ltr';
  isRtl: boolean;
  t: TFunction;
  /** Pick the current language from a Localized value. */
  L: (value: Localized) => string;
  setLang: (lang: Lang) => void;
  toggleLang: () => void;
}

export function useI18n(): I18n {
  const lang = useLangStore((s) => s.lang);
  const setLang = useLangStore((s) => s.setLang);
  return useMemo<I18n>(
    () => ({
      lang,
      dir: dirOf(lang),
      isRtl: lang === 'ar',
      t: (key, params) => translate(lang, key, params),
      L: (value) => value[lang] || value.en,
      setLang,
      toggleLang: () => setLang(lang === 'ar' ? 'en' : 'ar'),
    }),
    [lang, setLang],
  );
}
