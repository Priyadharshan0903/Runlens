import { RobotIcon } from "@phosphor-icons/react";
import type { SessionSource } from "../../src/core/types.js";
import claudeLogo from "../assets/brands/claude.svg";
import openaiLogo from "../assets/brands/openai.svg";

const LOGOS: Record<string, string> = { claude: claudeLogo, codex: openaiLogo };

function AgentLogo({ id, size = 14 }: { id: string; size?: number }) {
  const logo = LOGOS[id];
  if (!logo) return <RobotIcon size={size} aria-hidden="true" />;
  return (
    <span
      class="agent-logo"
      aria-hidden="true"
      style={{ maskImage: `url("data:image/svg+xml;base64,${logo}")`, width: size, height: size }}
    />
  );
}

/** Brand marks identify the reader; the visible name keeps them understandable without the logo. */
export function AgentIdentity({ source }: { source?: SessionSource }) {
  return (
    <span class="agent-identity">
      {source?.id === "all" ? (
        <span class="agent-logo-pair" aria-hidden="true">
          <AgentLogo id="claude" />
          <AgentLogo id="codex" />
        </span>
      ) : (
        <AgentLogo id={source?.id ?? "unknown"} />
      )}
      <span>{source?.name ?? "Unknown agent"}</span>
    </span>
  );
}
