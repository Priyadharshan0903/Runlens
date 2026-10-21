import { useCallback, useEffect, useState } from "preact/hooks";

export type Theme = "light" | "dark" | "system";

export interface SessionMeta {
  pinned?: boolean;
  title?: string;
  tags?: string[];
  notes?: string;
}

interface Preferences {
  theme: Theme;
  live: boolean;
  sessions: Record<string, SessionMeta>;
}

const STORAGE_KEY = "runlens.workspace.v1";
const DEFAULT_PREFERENCES: Preferences = { theme: "system", live: false, sessions: {} };

function readPreferences(): Preferences {
  try {
    const stored = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "null");
    if (!stored || typeof stored !== "object") return DEFAULT_PREFERENCES;

    const sessions: Record<string, SessionMeta> = {};

    for (const [id, value] of Object.entries(stored.sessions ?? {})) {
      if (!value || typeof value !== "object") continue;
      const annotation = value as SessionMeta;

      sessions[id] = {
        pinned: annotation.pinned === true,
        title: typeof annotation.title === "string" ? annotation.title : undefined,
        notes: typeof annotation.notes === "string" ? annotation.notes : "",
        tags: Array.isArray(annotation.tags)
          ? annotation.tags.filter((tag): tag is string => typeof tag === "string")
          : [],
      };
    }

    return {
      theme: ["light", "dark", "system"].includes(stored.theme) ? stored.theme : "system",
      live: stored.live === true,
      sessions,
    };
  } catch {
    return DEFAULT_PREFERENCES;
  }
}

export function usePreferences() {
  const [preferences, setPreferences] = useState<Preferences>(readPreferences);
  const [storageError, setStorageError] = useState(false);

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(preferences));
      setStorageError(false);
    } catch {
      setStorageError(true);
    }
  }, [preferences]);

  useEffect(() => {
    const systemTheme = matchMedia("(prefers-color-scheme: dark)");

    function applyTheme() {
      let theme = preferences.theme;
      if (theme === "system") theme = systemTheme.matches ? "dark" : "light";
      document.documentElement.dataset.theme = theme;
    }

    applyTheme();
    systemTheme.addEventListener("change", applyTheme);
    return () => systemTheme.removeEventListener("change", applyTheme);
  }, [preferences.theme]);

  const updateMeta = useCallback(function updateSessionMeta(
    id: string,
    patch: Partial<SessionMeta>,
  ) {
    setPreferences((previous) => {
      const current = previous.sessions[id] ?? {};
      const unchanged = Object.entries(patch).every(([key, value]) => {
        const oldValue = current[key as keyof SessionMeta];
        if (Array.isArray(value) && Array.isArray(oldValue)) {
          return (
            value.length === oldValue.length && value.every((tag, index) => tag === oldValue[index])
          );
        }
        return value === oldValue;
      });

      if (unchanged) return previous;

      return {
        ...previous,
        sessions: { ...previous.sessions, [id]: { ...current, ...patch } },
      };
    });
  }, []);

  const setTheme = useCallback(function setTheme(theme: Theme) {
    setPreferences((previous) => (previous.theme === theme ? previous : { ...previous, theme }));
  }, []);

  const setLive = useCallback(function setLive(live: boolean) {
    setPreferences((previous) => (previous.live === live ? previous : { ...previous, live }));
  }, []);

  return { preferences, storageError, updateMeta, setTheme, setLive };
}
