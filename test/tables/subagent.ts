import { agentCall } from "../harness.ts";

/*
 * The v0.1 table for the subagent guard, moved here from test/subagent-guard.test.ts without a
 * change to any case. The two behaviors that are not rows (five then a sixth, eight at once) stay
 * in test/subagent-guard.test.ts and are replayed by test/compare.test.ts from the same helpers.
 */

// No pin: a call that names Opus gets Opus, and the guard makes every call name its model.
export const SETTINGS = { CLAUDE_CODE_SUBAGENT_MODEL: "sonnet", CLAUDE_CODE_SUBAGENT_MODEL_FORCE: "" };
// With a Sonnet pin on, a call that names no model is fine: it gets Sonnet.
export const PINNED = { CLAUDE_CODE_SUBAGENT_MODEL: "sonnet", CLAUDE_CODE_SUBAGENT_MODEL_FORCE: "1" };

export const CASES: [name: string, payload: unknown, env: Record<string, string>, exit: number][] = [
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

/** Six calls in one session, Sonnet and Opus together: five are let through and the sixth is blocked. */
export const SEQUENCE = { models: ["sonnet", "opus", "sonnet", "opus", "sonnet", "sonnet"], codes: [0, 0, 0, 0, 0, 2] };

/** Eight calls at once: exactly five are let through. */
export const PARALLEL = { count: 8, allowed: 5 };
