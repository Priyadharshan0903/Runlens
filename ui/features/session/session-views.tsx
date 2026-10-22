import { CaretDownIcon, FileTextIcon } from "@phosphor-icons/react";
import { useState } from "preact/hooks";
import type { Session } from "../../../src/core/types.js";
import { formatClock, plural } from "../../shared/format.js";
import { AgentStep, CallDetails, ToolStepRow, TurnView } from "./transcript.js";
import {
  formatNumber,
  relativePath,
  totalTokens,
  type CallRef,
  type FileActivity,
  type SessionOverview,
} from "./session-data.js";

export function ActivityTrace({
  calls,
  onPick,
}: {
  calls: CallRef[];
  onPick: (id: string) => void;
}) {
  if (!calls.length) return null;

  const shown = calls.slice(0, 180);
  const hasErrors = calls.some(({ step }) => step.result?.status === "error");

  return (
    <div class="activity-trace">
      <div class="trace-label">
        <span>Run activity</span>
        <span>
          {calls.length > shown.length
            ? `First ${shown.length} of ${calls.length} calls`
            : `${calls.length} calls, in transcript order`}
        </span>
      </div>
      <div class="ribbon-track" aria-label="Tool call activity">
        {shown.map(({ step }) => (
          <button
            key={step.id}
            class="tick"
            data-kind={step.action.kind}
            data-failed={step.result?.status === "error" || undefined}
            aria-label={`Go to ${step.name}: ${step.summary}`}
            title={`${step.name} · ${step.summary}`}
            onClick={() => onPick(step.id)}
          />
        ))}
      </div>
      <div class="trace-key">
        <span>
          <i data-kind="look" />
          Read / search
        </span>
        <span>
          <i data-kind="change" />
          Edit
        </span>
        <span>
          <i data-kind="delegate" />
          Delegate
        </span>
        {hasErrors && (
          <span>
            <i data-kind="failed" />
            Error
          </span>
        )}
      </div>
    </div>
  );
}

export function FilteredCalls({ rows, onShow }: { rows: CallRef[]; onShow: (id: string) => void }) {
  if (!rows.length) return <p class="empty-block">No tool calls match this view.</p>;

  return (
    <div class="matches">
      {rows.map(({ step, turn, agent }) => (
        <div class="match" key={step.id}>
          <div class="match-context">
            <span>
              Turn {turn + 1} · {agent?.type ?? "Main agent"}
            </span>
            <button class="text-button" onClick={() => onShow(step.id)}>
              Show in timeline
            </button>
          </div>
          <div class="timeline">
            <ToolStepRow step={step} />
          </div>
        </div>
      ))}
    </div>
  );
}

export function Conversation({ session, query }: { session: Session; query: string }) {
  const search = query.trim().toLowerCase();
  const turns = session.turns
    .map((turn, index) => ({ turn, index }))
    .filter(({ turn }) => `${turn.prompt}\n${turn.final ?? ""}`.toLowerCase().includes(search));

  if (!turns.length) return <p class="empty-block">No messages match this search.</p>;

  return (
    <>
      {turns.map(({ turn, index }) => (
        <TurnView key={index} turn={turn} index={index} conversation />
      ))}
    </>
  );
}

export function AgentRuns({ agents }: { agents: SessionOverview["agents"] }) {
  return (
    <section class="agents-view">
      <div class="section-heading">
        <h2>Agent runs</h2>
        <span>{plural(agents.length, "subagent")}</span>
      </div>
      {agents.length ? (
        <div class="timeline">
          {agents.map(({ run, call }) => (
            <AgentStep key={run.id} run={run} call={call} />
          ))}
        </div>
      ) : (
        <p class="empty-block">No subagents were recorded in this session.</p>
      )}
    </section>
  );
}

export function FileChanges({ files, cwd }: { files: FileActivity[]; cwd?: string }) {
  return (
    <section class="changes-view">
      <div class="section-heading">
        <h2>File changes</h2>
        <span>{plural(files.length, "file")}</span>
      </div>
      <p class="section-caption">
        Recorded edit blocks, including subagents. Counts describe successful replacements, not a
        net Git diff.
      </p>
      {files.length ? (
        files.map((file) => <FileChange key={file.path} file={file} cwd={cwd} />)
      ) : (
        <p class="empty-block">No file edits were recorded in this session.</p>
      )}
    </section>
  );
}

function FileChange({ file, cwd }: { file: FileActivity; cwd?: string }) {
  const [open, setOpen] = useState(false);

  return (
    <details class="file-change" onToggle={(event) => setOpen(event.currentTarget.open)}>
      <summary>
        <FileTextIcon size={16} />
        <code title={file.path}>{relativePath(file.path, cwd)}</code>
        <span class="diff-counts">
          <span class="added">+{file.added}</span>
          <span class="removed">−{file.removed}</span>
        </span>
        <CaretDownIcon size={14} />
      </summary>
      {open && (
        <div class="file-change-body">
          {file.calls
            .filter((step) =>
              step.action.files?.some(
                (effect) => effect.path === file.path && effect.operation === "change",
              ),
            )
            .map((step) => (
              <div key={step.id}>
                <div class="change-call-label">
                  <span>
                    {step.name} · {formatClock(step.at)}
                  </span>
                  <span class={step.result?.status === "error" ? "fail-text" : "quiet"}>
                    {step.result?.status === "error"
                      ? "Failed"
                      : step.result
                        ? "Recorded"
                        : "No result"}
                  </span>
                </div>
                <CallDetails step={step} />
              </div>
            ))}
        </div>
      )}
    </details>
  );
}

export function Statistics({ session, overview }: { session: Session; overview: SessionOverview }) {
  const { calls, files, tools } = overview;
  const largestToolCount = tools[0]?.calls ?? 1;
  const usage = session.usage;

  return (
    <div class="statistics-view">
      <section>
        <div class="section-heading">
          <h2>Token usage</h2>
          <span>Recorded usage</span>
        </div>
        {usage ? (
          <>
            <div class="usage-grid">
              {[
                { label: "Input", value: usage.input },
                { label: "Output", value: usage.output },
                { label: "Cache read", value: usage.cacheRead },
                { label: "Cache write", value: usage.cacheWrite },
              ].map(({ label, value }) => (
                <div key={label}>
                  <span>{label}</span>
                  <strong>{formatNumber(value)}</strong>
                </div>
              ))}
            </div>
            <p class="section-caption">
              {session.usageScope === "main"
                ? "Main agent only. Child totals are excluded because forked history can repeat parent usage."
                : "Includes main agent and subagents. Shared message IDs are counted once."}{" "}
              Cache reads and writes are listed separately.
            </p>
          </>
        ) : (
          <p class="empty-block">This transcript doesn't include token usage.</p>
        )}
      </section>

      <section>
        <div class="section-heading">
          <h2>Tool distribution</h2>
          <span>{plural(calls.length, "call")}</span>
        </div>
        {tools.length ? (
          <div class="tool-distribution">
            {tools.map((tool, index) => (
              <div class="distribution-row" key={tool.name}>
                <span>{tool.name}</span>
                <div class="bar-track">
                  <span
                    class={index === 0 ? "primary-bar" : ""}
                    style={{ width: `${(tool.calls / largestToolCount) * 100}%` }}
                  />
                </div>
                <span class="num">{formatNumber(tool.calls)}</span>
                {tool.errors > 0 ? (
                  <span class="distribution-errors">{tool.errors} failed</span>
                ) : (
                  <span />
                )}
              </div>
            ))}
          </div>
        ) : (
          <p class="empty-block">This session answered without using tools.</p>
        )}
      </section>

      <section>
        <div class="section-heading">
          <h2>Models</h2>
          <span>{plural(session.models?.length ?? 0, "model")}</span>
        </div>
        {session.models?.length ? (
          <div class="models-table">
            <div class="models-header">
              <span>Model</span>
              <span class="num">Usage records</span>
              <span class="num">Tokens</span>
            </div>
            {session.models.map((model) => (
              <div key={model.model}>
                <code>{model.model}</code>
                <span class="num">{formatNumber(model.messages)}</span>
                <span class="num">{formatNumber(totalTokens(model.usage))}</span>
              </div>
            ))}
          </div>
        ) : (
          <p class="empty-block">Model usage wasn't recorded in this transcript.</p>
        )}
      </section>

      <section>
        <div class="section-heading">
          <h2>File activity</h2>
          <span>{plural(files.length, "file")}</span>
        </div>
        {files.length ? (
          <div class="file-activity">
            {files.map((file) => (
              <div key={file.path}>
                <code title={file.path}>{relativePath(file.path, session.cwd)}</code>
                <span class="num">{file.reads} reads</span>
                <span class="num">{file.edits} edits</span>
              </div>
            ))}
          </div>
        ) : (
          <p class="empty-block">No file paths were recorded for tool calls.</p>
        )}
      </section>
    </div>
  );
}
