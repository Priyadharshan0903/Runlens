import { useCallback, useEffect, useRef, useState } from "preact/hooks";

export interface Resource<T> {
  data?: T;
  status: "idle" | "loading" | "ready" | "refreshing" | "error";
  error?: string;
  updatedAt?: string;
}

interface Snapshot<T> extends Resource<T> {
  url: string | null;
}

interface ResourceOptions {
  pollInterval?: number;
  debounce?: number;
}

/** Owns a GET request's lifecycle. Components own filters and other user choices. */
export function useResource<T>(
  url: string | null,
  { pollInterval = 0, debounce = 0 }: ResourceOptions = {},
) {
  const [snapshot, setSnapshot] = useState<Snapshot<T>>({
    url: null,
    status: "idle",
  });
  const pendingRequest = useRef<AbortController | null>(null);

  const refresh = useCallback(
    async function refresh() {
      if (!url || pendingRequest.current) return;

      const controller = new AbortController();
      pendingRequest.current = controller;

      setSnapshot((previous) => {
        const data = previous.url === url ? previous.data : undefined;

        return {
          url,
          data,
          status: data ? "refreshing" : "loading",
          updatedAt: previous.url === url ? previous.updatedAt : undefined,
        };
      });

      try {
        const response = await fetch(url, { signal: controller.signal });
        const body = await response.json();

        if (!response.ok) {
          throw new Error(body.error || `Request failed (${response.status}).`);
        }

        if (!controller.signal.aborted) {
          setSnapshot({
            url,
            data: body as T,
            status: "ready",
            updatedAt: new Date().toISOString(),
          });
        }
      } catch (error) {
        if (!controller.signal.aborted) {
          setSnapshot((previous) => ({
            ...previous,
            status: "error",
            error: error instanceof Error ? error.message : "Request failed.",
          }));
        }
      } finally {
        if (pendingRequest.current === controller) {
          pendingRequest.current = null;
        }
      }
    },
    [url],
  );

  useEffect(() => {
    const timer = setTimeout(refresh, debounce);

    return () => {
      clearTimeout(timer);
      pendingRequest.current?.abort();
      pendingRequest.current = null;
    };
  }, [refresh, debounce]);

  useEffect(() => {
    if (!url || !pollInterval) return;

    const timer = setInterval(() => {
      if (!document.hidden) void refresh();
    }, pollInterval);

    return () => clearInterval(timer);
  }, [url, pollInterval, refresh]);

  // A changed URL must never display the previous request's result, even before effects run.
  const current: Resource<T> =
    snapshot.url === url ? snapshot : { status: url ? "loading" : "idle" };

  return { ...current, refresh };
}
