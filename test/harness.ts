import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

/*
 * How every table runs a hook: the way Claude Code runs it. The tool call as JSON on stdin, exit 2
 * with a reason on stderr to block, exit 0 to allow. The same helpers run the current hooks and
 * the frozen v0.1 copies under bench/versions/, so test/compare.test.ts can hold them side by side.
 *
 * Since R2 the current hook reads .claude/guard.config.json under CLAUDE_PROJECT_DIR. Every run
 * here points that variable at a temporary project directory holding the config the run is for:
 * configs/inventaris.json unless a test says otherwise, because that is the repository the table
 * was written for. The frozen v0.1 hook ignores the variable.
 */
export const ROOT = fileURLToPath(new URL("..", import.meta.url));
export const CURRENT = { guard: path.join(ROOT, "guard.js"), subagent: path.join(ROOT, "subagent-guard.js"), explain: path.join(ROOT, "bin", "antaris-guard.js") };
export const FROZEN = { guard: path.join(ROOT, "bench", "versions", "v0.1", "guard.js"), subagent: path.join(ROOT, "bench", "versions", "v0.1", "subagent-guard.js") };

const require = createRequire(import.meta.url);
/** The built-in defaults, from lib/config.js. */
export const DEFAULTS: Record<string, unknown> = require(path.join(ROOT, "lib", "config.js")).DEFAULTS;
/** The worked example config, configs/inventaris.json: what every table runs under. */
export const INVENTARIS: Record<string, unknown> = JSON.parse(fs.readFileSync(path.join(ROOT, "configs", "inventaris.json"), "utf8"));

/**
 * A temporary project directory holding `config` as .claude/guard.config.json, or holding no config
 * at all when `config` is null. The directory is this test process's own and is never the repository.
 */
export function projectWith(config: unknown | null, text?: string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "antaris-guard-project-"));
  if (config !== null || text !== undefined) {
    fs.mkdirSync(path.join(dir, ".claude"));
    fs.writeFileSync(path.join(dir, ".claude", "guard.config.json"), text ?? JSON.stringify(config, null, 2));
  }
  return dir;
}

let inventarisDir: string | undefined, defaultsDir: string | undefined;
/** The project every table runs under, made once per test process. */
export const inventarisProject = (): string => (inventarisDir ??= projectWith(INVENTARIS));
/** A project holding the built-in defaults as its config file, for the defaults comparison. */
export const defaultsProject = (): string => (defaultsDir ??= projectWith(DEFAULTS));

/**
 * What a hook run came to, read the three ways Claude Code reads it: exit 2 is deny; exit 0 with
 * the ask JSON alone on stdout and nothing on stderr is ask; exit 0 with nothing on stdout or
 * stderr is allow. Anything else is "neither", which no table accepts: an allowed case must be
 * truly silent, and an ask cannot pass as an allow.
 */
export type Decision = "allow" | "ask" | "deny" | "neither";
export type GuardRun = { decision: Decision; allowed: boolean; asked: boolean; code: number | null; reason: string; stderr: string; stdout: string };

/** The reason an ask carries, or null when stdout is not exactly the hook's ask JSON. */
export function askReasonOf(stdout: string): string | null {
  let o: { hookSpecificOutput?: { hookEventName?: unknown; permissionDecision?: unknown; permissionDecisionReason?: unknown } };
  try { o = JSON.parse(stdout); } catch { return null; }
  const h = o?.hookSpecificOutput;
  if (!h || Object.keys(o).length !== 1 || h.hookEventName !== "PreToolUse" || h.permissionDecision !== "ask" || typeof h.permissionDecisionReason !== "string") return null;
  return h.permissionDecisionReason;
}

/** A finished hook process, read as a GuardRun. */
function readRun(status: number | null, rawStdout: string | null, rawStderr: string | null): GuardRun {
  const stdout = (rawStdout || "").trim(), stderr = (rawStderr || "").trim();
  const asked = status === 0 && stderr === "" ? askReasonOf(stdout) : null;
  const decision: Decision = status === 2 ? "deny" : status === 0 && stdout === "" && stderr === "" ? "allow" : asked !== null ? "ask" : "neither";
  // The reason inside the parentheses, as the v0.1 harness read it; the id prefix, when there is one, is part of it.
  const reason = decision === "ask" ? asked!.match(/^guard: ask \(([^)]*)\)/)?.[1] ?? "" : stderr.match(/guard: blocked \(([^)]*)\)/)?.[1] ?? "";
  return { decision, allowed: decision === "allow", asked: decision === "ask", code: status, reason, stderr, stdout };
}

/** The Bash guard at `file`, given `input` on stdin as it is, with CLAUDE_PROJECT_DIR pointing at `project`. */
export function runGuardRaw(file: string, input: string, project: string = inventarisProject()): GuardRun {
  const run = spawnSync(process.execPath, [file], { input, encoding: "utf8", env: { ...process.env, CLAUDE_PROJECT_DIR: project }, maxBuffer: 64 * 1024 * 1024 });
  return readRun(run.status, run.stdout, run.stderr);
}

/** A Bash tool call as Claude Code sends it, with the session id the log records. */
export const bashCall = (command: string, session = "test-session"): string => JSON.stringify({ session_id: session, hook_event_name: "PreToolUse", tool_name: "Bash", tool_input: { command } });

/** The Bash guard at `file`, given a Bash tool call for `command`. */
export const runGuard = (file: string, command: string, project?: string): GuardRun => runGuardRaw(file, bashCall(command), project);

/** The Bash guard at `file`, started once per command at the same time, as parallel tool calls run it; resolves to each run's exit code and stderr. */
export function runGuardParallel(file: string, commands: string[], project: string = inventarisProject()): Promise<{ code: number | null; stderr: string }[]> {
  return Promise.all(commands.map((command) => new Promise<{ code: number | null; stderr: string }>((resolve) => {
    const child = spawn(process.execPath, [file], { env: { ...process.env, CLAUDE_PROJECT_DIR: project }, stdio: ["pipe", "ignore", "pipe"] });
    let stderr = "";
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (d: string) => (stderr += d));
    child.on("close", (code) => resolve({ code, stderr: stderr.trim() }));
    child.stdin.end(bashCall(command));
  })));
}

/** The decision log of a project, as the config under it places it. */
export const logOf = (project: string): string => path.join(project, ".claude", "guard", "log.jsonl");

/** The Bash guard at `file`, given a Bash tool call for `command` whose stdin carries `cwd` and with no CLAUDE_PROJECT_DIR set. */
export function runGuardWithCwd(file: string, command: string, cwd: string): GuardRun {
  const env = { ...process.env };
  delete env.CLAUDE_PROJECT_DIR;
  const run = spawnSync(process.execPath, [file], { input: JSON.stringify({ tool_name: "Bash", tool_input: { command }, cwd }), encoding: "utf8", env });
  return readRun(run.status, run.stdout, run.stderr);
}

export type ExplainRun = { code: number | null; stdout: string; stderr: string };

/** bin/antaris-guard.js with `args`, with CLAUDE_PROJECT_DIR pointing at `project`. */
export function runExplain(args: string[], project: string = inventarisProject()): ExplainRun {
  const run = spawnSync(process.execPath, [CURRENT.explain, ...args], { encoding: "utf8", env: { ...process.env, CLAUDE_PROJECT_DIR: project } });
  return { code: run.status, stdout: run.stdout || "", stderr: run.stderr || "" };
}

/** A current stderr line with the rule id and name removed, so it can be held against a v0.1 line. */
export const stripId = (stderr: string): string => stderr.replace(/^guard: blocked \((?:G\d\d|[a-z][a-z0-9]*(?:-[a-z0-9]+)*-\d\d) [a-z0-9-]+: /, "guard: blocked (");

/** A command run by n shells, each handing the next its string: bash -c "bash -c \"...\"". */
export const nest = (n: number, inner: string): string => (n === 0 ? inner : nest(n - 1, `bash -c ${JSON.stringify(inner)}`));

/**
 * An environment whose temp folder is empty and its own, so a subagent count starts at zero, and
 * whose project is the worked example, so the subagent hook finds a config and a log. Linux and
 * macOS read TMPDIR; Windows reads TEMP and TMP.
 */
export function tempEnv(extra: Record<string, string>, project: string = inventarisProject()): NodeJS.ProcessEnv {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "antaris-guard-test-"));
  return { ...process.env, TMPDIR: dir, TEMP: dir, TMP: dir, CLAUDE_PROJECT_DIR: project, ...extra };
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
