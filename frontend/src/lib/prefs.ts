// Per-browser UI preferences (units, column width). Storage may be unavailable
// (private windows, blocked site data); then defaults are used and nothing is remembered.

export function readPref<T>(key: string, fallback: T, valid: (v: unknown) => v is T): T {
  try {
    const raw = window.localStorage.getItem(key);
    if (raw === null) return fallback;
    const value: unknown = JSON.parse(raw);
    return valid(value) ? value : fallback;
  } catch {
    return fallback;
  }
}

export function writePref(key: string, value: unknown): void {
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // not remembered
  }
}
