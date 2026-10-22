import type { FileEffect } from "../../../src/core/types.js";

/** Bound expanded previews; the original tool record remains available separately. */
export function changePreview(preview: NonNullable<FileEffect["preview"]>) {
  const text = preview.text.slice(0, 40_000);
  const lines = text.replace(/\r?\n$/, "").split(/\r?\n/);
  return {
    label: {
      diff: "Recorded patch",
      added: "Added file",
      removed: "Removed file",
      content: "Recorded file content",
    }[preview.kind],
    truncated: text.length < preview.text.length || lines.length > 400,
    lines: lines.slice(0, 400).map((line) => {
      if (preview.kind === "added") return { kind: "added", text: `+${line}` };
      if (preview.kind === "removed") return { kind: "removed", text: `-${line}` };
      if (preview.kind === "diff") {
        if (/^(?:@@|--- |\+\+\+ )/.test(line)) return { kind: "context", text: line };
        if (line.startsWith("+")) return { kind: "added", text: line };
        if (line.startsWith("-")) return { kind: "removed", text: line };
      }
      return { kind: "context", text: line };
    }),
  };
}
