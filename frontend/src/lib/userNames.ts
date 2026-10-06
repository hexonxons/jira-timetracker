import { useEffect, useState } from "react";
import { api, ApiError, type JiraUser } from "../api";

// Display names from Jira, kept for the page's lifetime: lower-cased username -> user (null = not in Jira).
const cache = new Map<string, JiraUser | null>();

export async function lookupUser(username: string): Promise<JiraUser | null> {
  const key = username.trim().toLowerCase();
  if (cache.has(key)) return cache.get(key)!;
  const { users } = await api.lookupUsers([username.trim()]);
  const user = Object.values(users)[0] ?? null;
  cache.set(key, user);
  return user;
}

/** Looks up the display names of the given usernames (missing ones only), re-rendering when they arrive. */
export function useUserNames(usernames: string[]) {
  const [, setVersion] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const missing = [...new Set(usernames.map((u) => u.trim()).filter((u) => u && !cache.has(u.toLowerCase())))];
  const missingKey = missing.join("\n");

  useEffect(() => {
    if (!missing.length) return;
    let cancelled = false;
    api
      .lookupUsers(missing)
      .then(({ users }) => {
        for (const u of missing) cache.set(u.toLowerCase(), users[u] ?? null);
        if (!cancelled) {
          setError(null);
          setVersion((v) => v + 1);
        }
      })
      .catch((e) => !cancelled && setError(e instanceof ApiError ? e.errors.join("; ") : String(e)));
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [missingKey]);

  return {
    /** undefined = not looked up yet, null = not found in Jira. */
    get: (username: string): JiraUser | null | undefined => cache.get(username.trim().toLowerCase()),
    error,
  };
}
