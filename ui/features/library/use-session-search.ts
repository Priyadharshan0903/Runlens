import { useMemo } from "preact/hooks";
import type { SearchMatch } from "../../../src/core/types.js";
import { useResource } from "../../shared/use-resource.js";

/** One search request supplies both sidebar groups and the library table. */
export function useSessionSearch(query: string, enabled: boolean) {
  const search = query.trim();
  const url = enabled && search.length >= 2 ? `/api/search?q=${encodeURIComponent(search)}` : null;
  const resource = useResource<{ matches: SearchMatch[] }>(url, { debounce: 300 });
  const matches = useMemo(
    () => new Map(resource.data?.matches.map((match) => [match.id, match])),
    [resource.data],
  );

  return { ...resource, matches };
}
