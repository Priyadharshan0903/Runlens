import { CaretLeftIcon, CaretRightIcon } from "@phosphor-icons/react";
import type { SessionSummary } from "../../../src/core/types.js";
import type { SessionMeta } from "../../shared/use-preferences.js";
import type { SessionNeighbors } from "./session-neighbors.js";

interface SessionPagerProps {
  neighbors: SessionNeighbors | undefined;
  annotations: Record<string, SessionMeta>;
}

/** Lives in the shell so the controls remain available while a chat loads or fails. */
export function SessionPager({ neighbors, annotations }: SessionPagerProps) {
  if (!neighbors) return null;

  return (
    <nav class="session-pager" aria-label="Chats">
      <ChatLink session={neighbors.previous} direction="previous" annotations={annotations} />
      <span
        class="session-position"
        role="status"
        aria-atomic="true"
        aria-label={`Chat ${neighbors.position} of ${neighbors.total}`}
        title="All chats, in sidebar order"
      >
        {neighbors.position} of {neighbors.total}
      </span>
      <ChatLink session={neighbors.next} direction="next" annotations={annotations} />
    </nav>
  );
}

interface ChatLinkProps {
  session: SessionSummary | undefined;
  direction: "previous" | "next";
  annotations: Record<string, SessionMeta>;
}

function ChatLink({ session, direction, annotations }: ChatLinkProps) {
  const label = direction === "previous" ? "Previous" : "Next";
  const title = session ? annotations[session.id]?.title || session.title : undefined;
  const description = title ? `${label} chat: ${title}` : `No ${direction} chat`;

  return (
    <a
      class="session-pager-link"
      role="link"
      href={session ? `#/s/${session.id}` : undefined}
      aria-label={description}
      title={description}
      aria-disabled={!session}
      tabIndex={session ? undefined : -1}
      rel={direction === "previous" ? "prev" : "next"}
    >
      {direction === "previous" && <CaretLeftIcon size={15} aria-hidden="true" />}
      <span>{label}</span>
      {direction === "next" && <CaretRightIcon size={15} aria-hidden="true" />}
    </a>
  );
}
