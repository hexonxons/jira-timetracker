// A personal team config on a service instance lives in this browser only.
// Storage can be unavailable (private windows, blocked site data): then it is simply not remembered.

const KEY = "jtt.teamsConfig";

export function loadOwnTeams(): unknown | null {
  try {
    const raw = window.localStorage.getItem(KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

export function saveOwnTeams(config: unknown | null): void {
  try {
    if (config === null) window.localStorage.removeItem(KEY);
    else window.localStorage.setItem(KEY, JSON.stringify(config));
  } catch {
    // not persisted; the config still applies until the page is reloaded
  }
}
