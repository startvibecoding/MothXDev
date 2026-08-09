import { derived, writable } from 'svelte/store';
import zh from './preferences/locales/zh.js';
import en from './preferences/locales/en.js';

const storageKeys = {
  language: 'mothx.webui.language',
  themeMode: 'mothx.webui.themeMode'
};

const dictionaries = { zh, en };

const isBrowser = typeof window !== 'undefined';
const mediaQuery = isBrowser && typeof window.matchMedia === 'function'
  ? window.matchMedia('(prefers-color-scheme: dark)')
  : null;

function loadPreference(key, fallback, allowed) {
  if (!isBrowser) return fallback;
  const value = window.localStorage.getItem(key);
  return allowed.includes(value) ? value : fallback;
}

export const language = writable(loadPreference(storageKeys.language, 'zh', ['zh', 'en']));
export const themeMode = writable(loadPreference(storageKeys.themeMode, 'auto', ['light', 'dark', 'auto']));
export const effectiveTheme = writable(resolveEffectiveTheme(loadPreference(storageKeys.themeMode, 'auto', ['light', 'dark', 'auto'])));

export const t = derived(language, ($language) => {
  const dict = dictionaries[$language] || dictionaries.zh;
  return (key, params) => formatTemplate(dict[key] || dictionaries.zh[key] || key, params);
});

function formatTemplate(template, params) {
  if (!params || typeof params !== 'object') return template;
  return template.replace(/\{([a-zA-Z0-9_]+)\}/g, (match, key) => {
    const value = params[key];
    return value === undefined || value === null ? match : String(value);
  });
}

export function setLanguage(value) {
  if (!['zh', 'en'].includes(value)) return;
  language.set(value);
  if (isBrowser) window.localStorage.setItem(storageKeys.language, value);
}

export function setThemeMode(value) {
  if (!['light', 'dark', 'auto'].includes(value)) return;
  themeMode.set(value);
  if (isBrowser) window.localStorage.setItem(storageKeys.themeMode, value);
  applyTheme(value);
}

export function resolveEffectiveTheme(mode, prefersDark = mediaQuery?.matches) {
  if (mode === 'dark' || mode === 'light') return mode;
  return prefersDark ? 'dark' : 'light';
}


function applyTheme(mode) {
  const theme = resolveEffectiveTheme(mode);
  effectiveTheme.set(theme);
  if (!isBrowser) return;
  document.documentElement.dataset.theme = theme;
  document.documentElement.dataset.themeMode = mode;
}

if (isBrowser) {
  let currentMode = loadPreference(storageKeys.themeMode, 'auto', ['light', 'dark', 'auto']);
  applyTheme(currentMode);
  themeMode.subscribe((mode) => {
    currentMode = mode;
    applyTheme(mode);
  });
  mediaQuery?.addEventListener('change', () => {
    if (currentMode === 'auto') applyTheme(currentMode);
  });
}
