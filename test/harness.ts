import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

/*
 * How every table runs a hook: the way Claude Code runs it. The tool call as JSON on stdin, exit 2
 * with a reason on stderr to block, exit 0 to allow. The same helpers run the current hooks and
 * the frozen v0.1 copies under bench/versions/, so test/compare.test.ts can hold them side by side.
 */
export const ROOT = fileURLToPath(new URL("..", import.meta.url));
export const CURRENT = { guard: path.join(ROOT, "guard.js"), subagent: path.join(ROOT, "subagent-guard.js") };
export const FROZEN = { guard: path.join(ROOT, "bench", "versions", "v0.1", "guard.js"), subagent: path.join(ROOT, "bench", "versions", "v0.1", "subagent-guard.js") };

export type GuardRun = { allowed: boolean; code: number | null; reason: string; stderr: string };

/** The Bash guard at `file`, given `input` on stdin as it is. */
export function runGuardRaw(file: string, input: string): GuardRun {
  const run = spawnSync(process.execPath, [file], { input, encoding: "utf8" });
  const stderr = (run.stderr || "").trim();
  // The reason inside the parentheses, as the v0.1 harness read it; the id prefix, when there is one, is part of it.
  const reason = stderr.match(/guard: blocked \(([^)]*)\)/)?.[1] ?? "";
  return { allowed: run.status === 0, code: run.status, reason, stderr };
}

/** The Bash guard at `file`, given a Bash tool call for `command`. */
export const runGuard = (file: string, command: string): GuardRun => runGuardRaw(file, JSON.stringify({ tool_name: "Bash", tool_input: { command } }));

/** A current stderr line with the rule id and name removed, so it can be held against a v0.1 line. */
export const stripId = (stderr: string): string => stderr.replace(/^guard: blocked \((?:G\d\d|[a-z][a-z0-9]*(?:-[a-z0-9]+)*-\d\d) [a-z0-9-]+: /, "guard: blocked (");

/** A command run by n shells, each handing the next its string: bash -c "bash -c \"...\"". */
export const nest = (n: number, inner: string): string => (n === 0 ? inner : nest(n - 1, `bash -c ${JSON.stringify(inner)}`));

/** An environment whose temp folder is empty and its own, so a subagent count starts at zero. Linux and macOS read TMPDIR; Windows reads TEMP and TMP. */
export function tempEnv(extra: Record<string, string>): NodeJS.ProcessEnv {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "antaris-guard-test-"));
  return { ...process.env, TMPDIR: dir, TEMP: dir, TMP: dir, ...extra };
}

export type SubagentRun = { code: number | null; stderr: string };

/** The subagent guard at `file`, given a payload (an object, or a raw string) on stdin. */
export function runSubagent(file: string, payload: unknown, env: NodeJS.ProcessEnv): SubagentRun {
  const text = typeof payload === "string" ? payload : JSON.stringify(payload);
  const r = spawnSync(process.execPath, [file], { input: text, env, encoding: "utf8" });
  return { code: r.status, stderr: (r.stderr || "").trim() };
}

/** The subagent guard at `file`, started `n` times at once, as if a session asked for `n` subagents in one message. */
export function runSubagentParallel(file: string, payloads: unknown[], env: NodeJS.ProcessEnv): Promise<(number | null)[]> {
  return Promise.all(payloads.map((payload) => new Promise<number | null>((resolve) => {
    const child = spawn(process.execPath, [file], { env, stdio: ["pipe", "ignore", "ignore"] });
    child.on("close", resolve);
    child.stdin.end(JSON.stringify(payload));
  })));
}

/** An Agent tool call as Claude Code sends it, with the fields a test wants to vary. */
export function agentCall(toolInput: Record<string, unknown> = {}, extra: Record<string, unknown> = {}) {
  return {
    session_id: "test-session",
    hook_event_name: "PreToolUse",
    tool_name: "Agent",
    tool_input: { description: "test", prompt: "test", subagent_type: "Explore", ...toolInput },
    ...extra,
  };
}
