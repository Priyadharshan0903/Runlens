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
import type { ToolStatus, ToolIconName } from "../../src/core/types.js";

const TOOL_ICONS: Record<ToolIconName, Icon> = {
  file: FileTextIcon,
  search: MagnifyingGlassIcon,
  files: FilesIcon,
  edit: PencilSimpleLineIcon,
  write: FilePlusIcon,
  terminal: TerminalWindowIcon,
  agent: RobotIcon,
  skill: MagicWandIcon,
  web: GlobeIcon,
  link: LinkIcon,
  todo: ListChecksIcon,
  tools: ToolboxIcon,
  mcp: PlugIcon,
  other: WrenchIcon,
};

export function ToolIcon({ icon, size = 16 }: { icon: ToolIconName; size?: number }) {
  const Component = TOOL_ICONS[icon];
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
