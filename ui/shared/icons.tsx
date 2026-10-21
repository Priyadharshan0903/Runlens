// One place for icons, so every tool and state uses the same set and weight.

import {
  CheckCircleIcon,
  CircleDashedIcon,
  FilesIcon,
  FileTextIcon,
  GlobeIcon,
  LinkIcon,
  ListChecksIcon,
  MagicWandIcon,
  MagnifyingGlassIcon,
  PencilSimpleLineIcon,
  PlugIcon,
  RobotIcon,
  TerminalWindowIcon,
  ToolboxIcon,
  WrenchIcon,
  XCircleIcon,
  FilePlusIcon,
  type Icon,
} from "@phosphor-icons/react";
import type { ToolStatus } from "../../src/core/types.js";

const TOOL_ICONS: Record<string, Icon> = {
  Read: FileTextIcon,
  Grep: MagnifyingGlassIcon,
  Glob: FilesIcon,
  LS: FilesIcon,
  Edit: PencilSimpleLineIcon,
  MultiEdit: PencilSimpleLineIcon,
  NotebookEdit: PencilSimpleLineIcon,
  Write: FilePlusIcon,
  Bash: TerminalWindowIcon,
  BashOutput: TerminalWindowIcon,
  KillShell: TerminalWindowIcon,
  Agent: RobotIcon,
  Task: RobotIcon,
  Skill: MagicWandIcon,
  WebSearch: GlobeIcon,
  WebFetch: LinkIcon,
  TodoWrite: ListChecksIcon,
  ToolSearch: ToolboxIcon,
};

export function ToolIcon({ name, size = 16 }: { name: string; size?: number }) {
  const Component = name.startsWith("mcp__") ? PlugIcon : (TOOL_ICONS[name] ?? WrenchIcon);
  return <Component size={size} weight="regular" aria-hidden="true" />;
}

export function StatusIcon({ status }: { status: ToolStatus }) {
  if (status === "ok")
    return <CheckCircleIcon className="status ok" size={16} weight="fill" aria-label="Succeeded" />;
  if (status === "error")
    return <XCircleIcon className="status fail" size={16} weight="fill" aria-label="Failed" />;
  return (
    <CircleDashedIcon
      className="status pending"
      size={16}
      weight="bold"
      aria-label="No result recorded"
    />
  );
}
