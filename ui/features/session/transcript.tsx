// Each turn pairs a human question with the agent's work. Tool details and subagents
// keep their own disclosure state so opening one does not rerender the whole session.

import {
  ArrowBendDownRightIcon,
  StackIcon,
  CaretRightIcon,
  ChatCircleDotsIcon,
  ChatTextIcon,
  HandPalmIcon,
  MoonStarsIcon,
  RobotIcon,
  FilesIcon,
} from "@phosphor-icons/react";
import { createContext } from "preact";
import { useContext, useEffect, useMemo, useState } from "preact/hooks";
import type { AgentRun, NoteStep, Step, ToolStep, Turn } from "../../../src/core/types.js";
import {
  between,
  describeCall,
  firstLine,
  formatClock,
  formatDuration,
  kindOf,
  plural,
} from "../../shared/format.js";
import { StatusIcon, ToolIcon } from "../../shared/icons.js";
import { renderInline, renderMarkdown } from "../../shared/markdown.js";

/** The step the ribbon asked to show. Collapsed turns and groups holding it open themselves. */
export const Target = createContext<{ id: string } | undefined>(undefined);
export const Expansion = createContext(false);

const stepDomId = (id: string) => `step-${id}`;

/* ── Turns ───────────────────────────────────────────────────────── */

export function TurnView({
  turn,
  index,
  conversation = false,
}: {
  turn: Turn;
  index: number;
  conversation?: boolean;
}) {
  const target = useContext(Target);
  const [open, setOpen] = useState(true);
  const calls = turn.steps.filter((s) => s.kind === "tool").length;

  useEffect(() => {
    if (target && !open && containsStep(turn.steps, target.id)) setOpen(true);
  }, [target]);

  const visibleSteps = conversation
    ? turn.steps.filter((s) => s.kind === "note" && s.from !== "agent")
    : turn.steps;
  const responseId = `turn-${index + 1}-response`;

  return (
    <section class={`turn turn-pair ${open ? "" : "folded"}`} aria-label={`Turn ${index + 1}`}>
      <div class="turn-question">
        <header class="turn-head">
          <span class="turn-no">{index + 1}</span>
          <span class="who">You</span>
          <time class="turn-note">{formatClock(turn.at)}</time>
        </header>
        {turn.prompt ? (
          <Prompt text={turn.prompt} />
        ) : (
          <p class="turn-empty">No question was recorded for this turn.</p>
        )}
      </div>

      <div class="turn-agent">
        <header class="turn-head">
          <RobotIcon size={16} aria-hidden="true" />
          <span class="who">{conversation ? "Agent response" : "Agent activity"}</span>
          <button
            class="fold"
            onClick={() => setOpen(!open)}
            aria-expanded={open}
            aria-controls={responseId}
            aria-label={`${open ? "Collapse" : "Expand"} agent response for turn ${index + 1}`}
          >
            {calls > 0 ? plural(calls, "call") : "Response"}
            <CaretRightIcon size={14} weight="bold" className="chev" />
          </button>
        </header>
        <div id={responseId} hidden={!open}>
          {open && (
            <>
              {visibleSteps.length > 0 && (
                <div class="timeline">
                  <Steps steps={visibleSteps} />
                </div>
              )}
              {turn.final && (
                <Answer text={turn.final} label="Final response" showLabel={!conversation} />
              )}
              {!visibleSteps.length && !turn.final && (
                <p class="turn-empty">
                  {conversation
                    ? "No final answer was recorded for this turn."
                    : "No agent activity was recorded for this turn."}
                </p>
              )}
            </>
          )}
        </div>
      </div>
    </section>
  );
}

function Prompt({ text }: { text: string }) {
  const lines = text.split("\n").length;
  const long = lines > 8 || text.length > 700;
  const [open, setOpen] = useState(false);
  return (
    <div class="prompt-wrap">
      <p class={`prompt ${long && !open ? "clamped" : ""}`}>{text}</p>
      {long && (
        <button class="text-button" onClick={() => setOpen(!open)}>
          {open ? "Show less" : "Show full message"}
        </button>
      )}
    </div>
  );
}

/* ── Steps ───────────────────────────────────────────────────────── */

type Item = { type: "step"; step: Step } | { type: "group"; steps: ToolStep[] };

/** Three or more look-ups in a row (reads, searches) fold into one "Read 5 files" line. */
function groupSteps(steps: Step[]): Item[] {
  const items: Item[] = [];
  let run: ToolStep[] = [];
  const flush = () => {
    if (run.length >= 3) items.push({ type: "group", steps: run });
    else for (const step of run) items.push({ type: "step", step });
    run = [];
  };
  for (const step of steps) {
    const quiet =
      step.kind === "tool" &&
      kindOf(step.name) === "look" &&
      !step.agent &&
      step.result?.status !== "error";
    // A look-up that comes with its own reason starts a new group, so the reason stays visible.
    if (quiet && run.length > 0 && !step.why) {
      run.push(step);
      continue;
    }
    flush();
    if (quiet) run.push(step);
    else items.push({ type: "step", step });
  }
  flush();
  return items;
}

function Steps({ steps }: { steps: Step[] }) {
  const items = useMemo(() => groupSteps(steps), [steps]);
  return (
    <>
      {items.map((item, i) =>
        item.type === "group" ? (
          <GroupStep key={item.steps[0].id} steps={item.steps} />
        ) : item.step.kind === "note" ? (
          <NoteRow key={`n${i}`} note={item.step} />
        ) : item.step.agent ? (
          <AgentStep key={item.step.id} run={item.step.agent} call={item.step} />
        ) : (
          <ToolStepRow key={item.step.id} step={item.step} />
        ),
      )}
    </>
  );
}

function Why({ text, open }: { text: string; open: boolean }) {
  return (
    <p
      class={`why ${open ? "" : "clamped"}`}
      dangerouslySetInnerHTML={{ __html: renderInline(text) }}
    />
  );
}

export function ToolStepRow({ step }: { step: ToolStep }) {
  const [open, setOpen] = useState(false);
  const target = useContext(Target);
  const expansion = useContext(Expansion);
  useEffect(() => {
    setOpen(expansion);
  }, [expansion]);
  useEffect(() => {
    if (target?.id === step.id) setOpen(true);
  }, [target]);
  const { verb, detail } = describeCall(step.name, step.summary);
  const status = step.result?.status ?? "pending";

  return (
    <div
      class={`step ${open ? "open" : ""}`}
      id={stepDomId(step.id)}
      data-kind={kindOf(step.name)}
      data-failed={status === "error" || undefined}
    >
      <span class="node" aria-hidden="true">
        <ToolIcon name={step.name} />
      </span>
      <div class="step-body">
        {step.why && <Why text={step.why} open={open} />}
        <button class="call" onClick={() => setOpen(!open)} aria-expanded={open}>
          <span class="verb">{verb}</span>
          <code class="detail">{detail}</code>
          <span class="dur">{formatDuration(step.durationMs)}</span>
          <StatusIcon status={status} />
          <CaretRightIcon size={13} weight="bold" className="chev" />
        </button>
        {status === "error" && !open && (
          <p class="error-line">{firstLine(step.result?.output, 220)}</p>
        )}
        {open && <CallDetails step={step} />}
      </div>
    </div>
  );
}

function GroupStep({ steps }: { steps: ToolStep[] }) {
  const target = useContext(Target);
  const expansion = useContext(Expansion);
  useEffect(() => {
    setOpen(expansion);
  }, [expansion]);
  const [open, setOpen] = useState(false);
  useEffect(() => {
    if (target && !open && steps.some((s) => s.id === target.id)) setOpen(true);
  }, [target]);

  const reads = steps.filter((s) => s.name === "Read").length;
  const searches = steps.length - reads;
  const label = [
    reads && `Read ${plural(reads, "file")}`,
    searches && `${reads ? "ran" : "Ran"} ${plural(searches, "search", "searches")}`,
  ]
    .filter(Boolean)
    .join(" and ");
  const names = steps
    .map((s) => (s.name === "Read" ? s.summary.split("/").pop() : s.summary))
    .join(", ");
  const total = steps.reduce((sum, s) => sum + (s.durationMs ?? 0), 0);

  return (
    <div class={`step group ${open ? "open" : ""}`} data-kind="look">
      <span class="node" aria-hidden="true">
        <FilesIcon size={16} weight="regular" />
      </span>
      <div class="step-body">
        {steps[0].why && <Why text={steps[0].why} open={open} />}
        <button class="call" onClick={() => setOpen(!open)} aria-expanded={open}>
          <span class="verb">{label}</span>
          <code class="detail">{names}</code>
          <span class="dur">{formatDuration(total)}</span>
          <StatusIcon status={steps.some((s) => !s.result) ? "pending" : "ok"} />
          <CaretRightIcon size={13} weight="bold" className="chev" />
        </button>
        {open && (
          <div class="group-items">
            {steps.map((s) => (
              <ToolStepRow key={s.id} step={s} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

export function CallDetails({ step }: { step: ToolStep }) {
  const input = (step.input ?? {}) as Record<string, unknown>;
  let inputView;
  if (step.name === "Bash" && typeof input.command === "string") {
    inputView = <pre class="code">{input.command}</pre>;
  } else if (
    step.name === "Edit" &&
    typeof input.old_string === "string" &&
    typeof input.new_string === "string"
  ) {
    inputView = (
      <pre class="code diff">
        {input.old_string.split("\n").map((l, i) => (
          <span key={`o${i}`} class="removed">
            - {l}
            {"\n"}
          </span>
        ))}
        {input.new_string.split("\n").map((l, i) => (
          <span key={`n${i}`} class="added">
            + {l}
            {"\n"}
          </span>
        ))}
      </pre>
    );
  } else {
    inputView = <pre class="code">{JSON.stringify(step.input, null, 2)}</pre>;
  }

  return (
    <div class="call-details">
      <div class="detail-label">
        {step.name === "Bash" ? "Command" : step.name === "Edit" ? "Change" : "Input"}
      </div>
      {inputView}
      <div class="detail-label">
        Output
        {step.result?.truncated && <span class="detail-note">First 20,000 characters</span>}
      </div>
      <pre class={`code ${step.result?.status === "error" ? "failed" : ""}`}>
        {step.result ? step.result.output || "No output" : "No result was recorded for this call"}
      </pre>
    </div>
  );
}

function NoteRow({ note }: { note: NoteStep }) {
  if (note.from === "compaction")
    return (
      <div class="compaction-marker">
        <StackIcon size={14} />
        <span>Context compacted</span>
        <time>{formatClock(note.at)}</time>
      </div>
    );
  if (note.from === "user") {
    return (
      <div class="step note" data-kind="you">
        <span class="node" aria-hidden="true">
          <ChatCircleDotsIcon size={16} weight="regular" />
        </span>
        <div class="step-body">
          <p class="note-label">You added, while it worked</p>
          <p class="note-text">{note.text}</p>
        </div>
      </div>
    );
  }
  if (note.from === "interrupt") {
    return (
      <div class="step note" data-kind="stop">
        <span class="node" aria-hidden="true">
          <HandPalmIcon size={16} weight="regular" />
        </span>
        <div class="step-body">
          <p class="note-label">You stopped the agent here</p>
        </div>
      </div>
    );
  }
  return (
    <div class="step note" data-kind="said">
      <span class="node small" aria-hidden="true" />
      <div class="step-body">
        <p class="why" dangerouslySetInnerHTML={{ __html: renderInline(note.text) }} />
      </div>
    </div>
  );
}

/* ── Subagents ───────────────────────────────────────────────────── */

export function AgentStep({ run, call }: { run: AgentRun; call?: ToolStep }) {
  const target = useContext(Target);
  const expansion = useContext(Expansion);
  useEffect(() => {
    setOpen(expansion);
  }, [expansion]);
  const [open, setOpen] = useState(false);
  const steps = useMemo(() => run.turns.flatMap((t) => t.steps), [run]);
  const task = run.turns.find((t) => t.prompt)?.prompt;
  const result = [...run.turns].reverse().find((t) => t.final)?.final;
  const status = run.stoppedByUser ? "error" : result ? "ok" : "pending";

  useEffect(() => {
    if (
      target &&
      !open &&
      (call?.id === target.id || target.id === `agent-${run.id}` || containsStep(steps, target.id))
    )
      setOpen(true);
  }, [target]);

  return (
    <div
      class={`step agent-step ${open ? "open" : ""}`}
      id={stepDomId(call?.id ?? `agent-${run.id}`)}
      data-kind="delegate"
    >
      <span class="node" aria-hidden="true">
        <RobotIcon size={16} weight="regular" />
      </span>
      <div class="step-body">
        {call?.why && <Why text={call.why} open={open} />}
        <div class="agent">
          <button class="agent-head" onClick={() => setOpen(!open)} aria-expanded={open}>
            <span class="agent-title">{run.description || "Subagent"}</span>
            <span class="agent-facts">
              <span class="agent-type">{run.type}</span>
              <span>{plural(run.stats.toolCalls, "call")}</span>
              {run.stats.errors > 0 && <span class="fail-text">{run.stats.errors} failed</span>}
              <span>{formatDuration(between(run.startedAt, run.endedAt))}</span>
              {run.background && (
                <span
                  class="agent-bg"
                  title="Ran in the background while the main agent kept working"
                >
                  <MoonStarsIcon size={13} weight="regular" aria-hidden="true" /> Background
                </span>
              )}
            </span>
            <StatusIcon status={status} />
            <CaretRightIcon size={14} weight="bold" className="chev" />
          </button>

          {!open && result && (
            <p class="agent-result">
              <ArrowBendDownRightIcon size={14} weight="bold" aria-hidden="true" />
              <span>{resultLine(result)}</span>
            </p>
          )}

          {open && (
            <div class="agent-body">
              {task && (
                <details class="agent-task">
                  <summary>What it was asked to do</summary>
                  <p class="prompt">{task}</p>
                </details>
              )}
              {steps.length > 0 ? (
                <div class="timeline">
                  <Steps steps={steps} />
                </div>
              ) : (
                <p class="quiet">It answered without using any tools.</p>
              )}
              {result && <Answer text={result} label="What it returned" />}
              {run.stoppedByUser && (
                <p class="quiet">You stopped this subagent before it finished.</p>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

/** One line for a collapsed subagent. Structured output (JSON) says so instead of showing a bracket. */
function resultLine(result: string): string {
  const body = result.trim().replace(/^```\w*\s*/, "");
  if (/^[[{]/.test(body))
    return `Returned structured data (${result.length.toLocaleString()} characters)`;
  return firstLine(result, 220);
}

/* ── Answers ─────────────────────────────────────────────────────── */

function Answer({
  text,
  label = "Answer",
  showLabel = true,
}: {
  text: string;
  label?: string;
  showLabel?: boolean;
}) {
  const long = text.length > 1400 || text.split("\n").length > 22;
  const [open, setOpen] = useState(!long);
  const html = useMemo(() => renderMarkdown(text), [text]);
  return (
    <div class="answer">
      {showLabel && (
        <div class="answer-head">
          <ChatTextIcon size={16} weight="regular" aria-hidden="true" />
          {label}
        </div>
      )}
      <div class={`md ${open ? "" : "clamped"}`} dangerouslySetInnerHTML={{ __html: html }} />
      {long && (
        <button class="text-button" onClick={() => setOpen(!open)}>
          {open ? "Show less" : "Show the full answer"}
        </button>
      )}
    </div>
  );
}

function containsStep(steps: Step[], id: string): boolean {
  return steps.some(
    (s) =>
      s.kind === "tool" &&
      (s.id === id || (s.agent && s.agent.turns.some((t) => containsStep(t.steps, id)))),
  );
}
