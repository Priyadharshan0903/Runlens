import { CheckIcon, CopyIcon, StackIcon, XIcon } from "@phosphor-icons/react";
import { useEffect, useRef, useState } from "preact/hooks";
import type { Session } from "../../../src/core/types.js";
import { formatAgo, formatCost } from "../../shared/format.js";
import type { SessionMeta } from "../../shared/use-preferences.js";
import type { SessionOverview } from "./session-data.js";

interface InspectorProps {
  session: Session;
  overview: SessionOverview;
  meta: SessionMeta;
  open: boolean;
  storageError: boolean;
  onClose: () => void;
  onShowCall: (id: string) => void;
  onMeta: (patch: Partial<SessionMeta>) => void;
}

export function SessionInspector({
  session,
  overview,
  meta,
  open,
  storageError,
  onClose,
  onShowCall,
  onMeta,
}: InspectorProps) {
  const [notesDraft, setNotesDraft] = useState(meta.notes ?? "");
  const [copyStatus, setCopyStatus] = useState<"idle" | "copied" | "error">("idle");
  const copyTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  // Keep keystrokes in the editor. Persist after a pause, or immediately when leaving the field.
  useEffect(() => {
    if (notesDraft === (meta.notes ?? "")) return;
    const timer = setTimeout(() => onMeta({ notes: notesDraft }), 400);
    return () => clearTimeout(timer);
  }, [notesDraft, meta.notes, onMeta]);

  useEffect(() => () => clearTimeout(copyTimer.current), []);

  async function copySessionId() {
    clearTimeout(copyTimer.current);

    try {
      await navigator.clipboard.writeText(session.id);
      setCopyStatus("copied");
      copyTimer.current = setTimeout(() => setCopyStatus("idle"), 1800);
    } catch {
      setCopyStatus("error");
    }
  }

  function saveTags(value: string) {
    const tags = value
      .split(",")
      .map((tag) => tag.trim())
      .filter(Boolean);
    onMeta({ tags: [...new Set(tags)].slice(0, 12) });
  }

  return (
    <aside class={`session-inspector ${open ? "is-open" : ""}`} aria-label="Session details">
      <div class="inspector-title">
        <h2>Session details</h2>
        <button
          class="icon-button inspector-close"
          aria-label="Close session details"
          onClick={onClose}
        >
          <XIcon size={16} />
        </button>
      </div>
      <dl class="detail-list">
        <div>
          <dt>Session ID</dt>
          <dd>
            <code title={session.id}>{session.id.slice(0, 8)}</code>
            <button
              class="icon-button"
              onClick={copySessionId}
              aria-label="Copy session ID"
              title={copyStatus === "copied" ? "Copied" : "Copy session ID"}
            >
              {copyStatus === "copied" ? <CheckIcon size={13} /> : <CopyIcon size={13} />}
            </button>
          </dd>
        </div>
        <div>
          <dt>Last activity</dt>
          <dd>{formatAgo(session.endedAt) || "—"}</dd>
        </div>
        <div>
          <dt>Recorded cost</dt>
          <dd>{session.costUSD === undefined ? "—" : formatCost(session.costUSD)}</dd>
        </div>
        <div>
          <dt>Compactions</dt>
          <dd>{overview.compactionCount}</dd>
        </div>
      </dl>
      {copyStatus === "error" && (
        <p class="field-help" role="status">
          Couldn't copy. Select the ID from the JSON export.
        </p>
      )}

      <div class="inspector-section">
        <h3>Project folder</h3>
        <p class="project-path">{session.cwd || "Not recorded"}</p>
      </div>
      <div class="inspector-section">
        <h3>Agents</h3>
        <div class="agent-roster">
          <div>
            <span class="roster-mark">
              <StackIcon size={13} />
            </span>
            <span>Main agent</span>
            <span class="num">{overview.mainCallCount} calls</span>
          </div>
          {overview.agents.map(({ run, call }) => (
            <button
              key={run.id}
              onClick={() => {
                onClose();
                onShowCall(call?.id ?? `agent-${run.id}`);
              }}
            >
              <span class="roster-branch">↳</span>
              <span title={run.description}>{run.description || run.type}</span>
              <span class="num">{run.stats.toolCalls}</span>
            </button>
          ))}
        </div>
      </div>

      <div class="inspector-section annotation-fields">
        <label for="session-name">Display name</label>
        <input
          id="session-name"
          defaultValue={meta.title ?? ""}
          placeholder={session.title}
          onBlur={(event) => onMeta({ title: event.currentTarget.value.trim() || undefined })}
          onKeyDown={(event) => {
            if (event.key === "Enter") event.currentTarget.blur();
          }}
        />
        <label for="session-tags">Tags</label>
        <input
          id="session-tags"
          defaultValue={meta.tags?.join(", ") ?? ""}
          placeholder="debugging, review…"
          onBlur={(event) => saveTags(event.currentTarget.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") event.currentTarget.blur();
          }}
        />
        <p class="field-help">Separate tags with commas.</p>

        <div class="notes-label">
          <label for="session-notes">Your notes</label>
          <span>
            {storageError
              ? "This visit only"
              : notesDraft === (meta.notes ?? "")
                ? "Saved locally"
                : "Saving…"}
          </span>
        </div>
        <textarea
          id="session-notes"
          rows={5}
          value={notesDraft}
          placeholder="What worked? What would you change next time?"
          onInput={(event) => setNotesDraft(event.currentTarget.value)}
          onBlur={() => {
            if (notesDraft !== (meta.notes ?? "")) onMeta({ notes: notesDraft });
          }}
        />
        <p class="field-help">Notes, pins, and tags stay in this browser.</p>
      </div>
    </aside>
  );
}
