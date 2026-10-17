import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/*
 * The subagent guard, run as Claude Code runs it: the tool call as JSON on stdin, exit 2 with a
 * reason on stderr to block, exit 0 to allow. It counts subagents in the system temp folder, so
 * every test here gets an empty one of its own. Linux and macOS read TMPDIR; Windows reads TEMP
 * and TMP.
 */
const SUBAGENT_GUARD = fileURLToPath(new URL("../subagent-guard.js", import.meta.url));

function tempEnv(extra: Record<string, string>): NodeJS.ProcessEnv {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "antaris-guard-test-"));
  return { ...process.env, TMPDIR: dir, TEMP: dir, TMP: dir, ...extra };
}
// No pin: a call that names Opus gets Opus, and the guard makes every call name its model.
const SETTINGS = { CLAUDE_CODE_SUBAGENT_MODEL: "sonnet", CLAUDE_CODE_SUBAGENT_MODEL_FORCE: "" };
// With a Sonnet pin on, a call that names no model is fine: it gets Sonnet.
const PINNED = { CLAUDE_CODE_SUBAGENT_MODEL: "sonnet", CLAUDE_CODE_SUBAGENT_MODEL_FORCE: "1" };

function run(payload: unknown, env: NodeJS.ProcessEnv): { code: number | null; stderr: string } {
  const text = typeof payload === "string" ? payload : JSON.stringify(payload);
  const r = spawnSync(process.execPath, [SUBAGENT_GUARD], { input: text, env, encoding: "utf8" });
  return { code: r.status, stderr: (r.stderr || "").trim() };
}

function agentCall(toolInput: Record<string, unknown> = {}, extra: Record<string, unknown> = {}) {
  return {
    session_id: "test-session",
    hook_event_name: "PreToolUse",
    tool_name: "Agent",
    tool_input: { description: "test", prompt: "test", subagent_type: "Explore", ...toolInput },
    ...extra,
  };
}

const CASES: [name: string, payload: unknown, env: Record<string, string>, exit: number][] = [
  ["ignores other tools", { ...agentCall(), tool_name: "Bash", tool_input: { command: "ls" } }, SETTINGS, 0],
  ["allows model sonnet", agentCall({ model: "sonnet" }), SETTINGS, 0],
  ["allows model opus", agentCall({ model: "opus" }), SETTINGS, 0],
  ["allows a full Opus model id", agentCall({ model: "claude-opus-5-5" }), SETTINGS, 0],
  ["allows model haiku under the old Task name", { ...agentCall({ model: "haiku" }), tool_name: "Task" }, SETTINGS, 0],
  ["blocks a call that names no model, since there is no pin", agentCall(), SETTINGS, 2],
  ["allows a call that names no model when a Sonnet pin is on", agentCall(), PINNED, 0],
  ["blocks model fable", agentCall({ model: "fable" }), SETTINGS, 2],
  ["blocks a full Fable model id", agentCall({ model: "claude-fable-5-1" }), SETTINGS, 2],
  ["blocks model mythos", agentCall({ model: "mythos" }), SETTINGS, 2],
  ["blocks inherit, which would take the main session's model", agentCall({ model: "inherit" }), SETTINGS, 2],
  ["blocks a fork", agentCall({ subagent_type: "fork", model: "sonnet" }), SETTINGS, 2],
  ["blocks remote isolation", agentCall({ isolation: "remote", model: "sonnet" }), SETTINGS, 2],
  ["blocks worktree isolation", agentCall({ isolation: "worktree", model: "opus" }), SETTINGS, 2],
  ["blocks a subagent starting its own subagent", agentCall({ model: "sonnet" }, { agent_id: "a1", agent_type: "Explore" }), SETTINGS, 2],
  ["blocks when the tool call cannot be read", "not json", SETTINGS, 2],
];

describe("the subagent guard", () => {
  it.each(CASES)("%s", (_name, payload, env, exit) => {
    const r = run(payload, tempEnv(env));
    expect(r.code, r.stderr).toBe(exit);
  });

  it("allows five subagents in one session, Sonnet and Opus together, and blocks the sixth", () => {
    const env = tempEnv(SETTINGS);
    const codes = ["sonnet", "opus", "sonnet", "opus", "sonnet", "sonnet"].map((model) => run(agentCall({ model }), env).code);
    expect(codes).toEqual([0, 0, 0, 0, 0, 2]);
    // A different session starts its own count.
    expect(run(agentCall({ model: "opus" }, { session_id: "another-session" }), env).code).toBe(0);
  });

  it("lets exactly five of eight parallel calls through", async () => {
    // Eight calls at once, as if the session asked for eight subagents in one message. The
    // processes cannot start closely enough to prove there is no race; the guarantee is the
    // "wx" flag in subagent-guard.js, which the operating system makes atomic.
    const env = tempEnv(SETTINGS);
    const runs = Array.from({ length: 8 }, (_, i) => new Promise<number | null>((resolve) => {
      const child = spawn(process.execPath, [SUBAGENT_GUARD], { env, stdio: ["pipe", "ignore", "ignore"] });
      child.on("close", resolve);
      child.stdin.end(JSON.stringify(agentCall({ model: i % 2 ? "opus" : "sonnet" })));
    }));
    const codes = await Promise.all(runs);
    expect(codes.filter((c) => c === 0)).toHaveLength(5);
  });
});
