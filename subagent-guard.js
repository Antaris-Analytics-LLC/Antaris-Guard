#!/usr/bin/env node
/*
 * Antaris-Guard: the subagent guard. The hook that runs in Inventaris (Antaris Analytics) as
 * .claude/hooks/subagent-guard.js, published as it is there.
 *
 * PreToolUse hook for the Agent tool (named Task before Claude Code 2.1.63).
 *
 * The env block in .claude/settings.json does most of the work: at most three subagents at a
 * time, with no forks, no nesting, no workflows and no teams. Subagents run on Sonnet or Opus,
 * whichever the call names: Sonnet for shorter, well-defined jobs, Opus when the task needs
 * more reasoning (CLAUDE.md says when). This hook backs those settings up and adds the one
 * limit Claude Code has no setting for: a total number of subagents per session.
 *
 * A subagent call is blocked when:
 *   1. it comes from inside another subagent (no nesting),
 *   2. it asks for a fork (a fork always runs on the main session's model),
 *   3. it asks for isolation ("remote" starts a separate cloud machine; worktrees live
 *      under .claude/, which sessions can't edit),
 *   4. it names a model other than sonnet, opus or haiku (never Fable or Mythos, and never
 *      "inherit", which would take the main session's model), or names none while no
 *      model pin is active in settings.json. Without a pin, a call that names no model can
 *      fall back to the main session's model, so every call has to name one,
 *   5. the session has already started MAX_PER_SESSION subagents, whatever their model.
 *
 * Since v0.2 round 3 every decision is logged through lib/log.js, with tool Agent and the model
 * asked for, into the same chain as the session's commands; the hook reads the config under the
 * project root for the log's path and fails closed, as guard.js does, when lib/ or the config
 * cannot be read or the log cannot be written. Since round 4b a missing config falls back as it
 * does for guard.js: to configs/<name>.json when the hook is started with --fallback <name>, else
 * to the built-in defaults. The limits above stay constants until the subagents config key lands.
 *
 * Exit 2 blocks the call and shows the reason to the session. Exit 0 lets it through.
 * Anything unexpected blocks. This file is CommonJS; if the root package.json ever gets
 * "type": "module", rename it to .cjs and update settings.json.
 */
"use strict";
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const MAX_PER_SESSION = 5;
const ALLOWED_MODEL = /^(haiku|sonnet|opus)$|^claude-(haiku|sonnet|opus)-/;

function block(reason) {
  process.stderr.write(`subagent-guard: blocked (${reason})\n`);
  process.exit(2);
}
const message = (err) => (err && err.message ? err.message : String(err)).replace(/\s+/g, " ").trim();
const couldNotLoad = (err) => block(`the guard could not load: ${message(err)}`);
process.on("uncaughtException", couldNotLoad);
process.on("unhandledRejection", couldNotLoad);

let resolveConfig, fallbackArg, projectDir, validate, logPath, appendLog, sha256;
try {
  ({ resolveConfig, fallbackArg, projectDir, validate } = require(path.join(__dirname, "lib", "config.js")));
  if (typeof resolveConfig !== "function" || typeof fallbackArg !== "function" || typeof projectDir !== "function" || typeof validate !== "function") throw new Error("lib/config.js does not export resolveConfig(), fallbackArg(), projectDir() and validate()");
  ({ logPath, append: appendLog, sha256 } = require(path.join(__dirname, "lib", "log.js")));
  if (typeof logPath !== "function" || typeof appendLog !== "function" || typeof sha256 !== "function") throw new Error("lib/log.js does not export logPath(), append() and sha256()");
} catch (err) {
  couldNotLoad(err);
}

/** The reason to block one Agent call, or null to allow it, with the session's slot taken. The checks and their words are v0.1's. */
function decide(data) {
  const call = data.tool_input || {};
  if (data.agent_id) return "this call came from inside a subagent, and nesting is off in this repo";
  if (call.subagent_type === "fork") return "forks are off in this repo because they always run on the main session's model";
  if (call.isolation) return `isolation "${call.isolation}" is off in this repo; run the subagent in the main checkout`;

  const model = String(call.model || "").toLowerCase();
  if (model && !ALLOWED_MODEL.test(model)) return `subagents run on sonnet or opus only, and this call asked for "${model}"`;
  if (!model) {
    const pinned =
      process.env.CLAUDE_CODE_SUBAGENT_MODEL_FORCE === "1" &&
      ALLOWED_MODEL.test(String(process.env.CLAUDE_CODE_SUBAGENT_MODEL || "").toLowerCase());
    if (!pinned) return 'every subagent call names its model: set model to "sonnet" for shorter, well-defined jobs, or "opus" when the task needs more reasoning';
  }

  // One empty file per subagent, in the system temp folder. Opening with the "wx" flag fails
  // when the file already exists, and that check is atomic, so subagents launched in parallel
  // can't claim the same slot.
  const session = String(data.session_id || "unknown").replace(/[^a-zA-Z0-9_-]/g, "") || "unknown";
  for (let n = 1; n <= MAX_PER_SESSION; n++) {
    const slot = path.join(os.tmpdir(), `antaris-guard-subagent-${session}-${n}`);
    try {
      fs.closeSync(fs.openSync(slot, "wx"));
      return null;
    } catch (err) {
      if (err.code !== "EEXIST") return `could not record the subagent count (${err.code || err.message})`;
    }
  }
  return `this session has used all ${MAX_PER_SESSION} of its subagents; finish the work in the main session`;
}

let input = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk) => (input += chunk));
process.stdin.on("end", () => {
  let data = null, unreadable = false;
  try {
    data = JSON.parse(input);
    if (data === null || typeof data !== "object") data = {};
  } catch {
    unreadable = true;
  }
  if (!unreadable) {
    const tool = String(data.tool_name || "");
    if (tool !== "Agent" && tool !== "Task") process.exit(0);
  }

  // The config comes first, even for a tool call that is not JSON, so that decision is logged too:
  // the project's file, or the fallback when there is none.
  const dir = projectDir({ env: process.env, cwd: unreadable ? undefined : data.cwd });
  let raw;
  try {
    ({ raw } = resolveConfig(dir, fallbackArg(process.argv.slice(2))));
  } catch (err) {
    block(`could not read the config: ${message(err)}`);
  }
  let settings;
  try {
    settings = validate(raw);
  } catch (err) {
    block(`the config is not valid: ${message(err)}`);
  }

  const reason = unreadable ? "could not read the tool call" : decide(data);

  const file = logPath(settings, dir);
  if (file) {
    const call = unreadable ? {} : data.tool_input || {};
    const session = !unreadable && typeof data.session_id === "string" && data.session_id ? data.session_id.slice(0, 128) : "unknown";
    try {
      appendLog(file, {
        t: new Date().toISOString(),
        session,
        tool: "Agent",
        model: String(call.model || "").toLowerCase(),
        decision: reason ? "deny" : "allow",
        rule: reason ? "subagent-guard" : null,
        reason: reason || "",
        cmd_sha256: sha256(unreadable ? input : JSON.stringify(call)),
      });
    } catch (err) {
      if (!reason) block(`could not write the log: ${message(err)}`);
      process.stderr.write(`subagent-guard: blocked (${reason})\nsubagent-guard: could not write the log (${message(err)})\n`);
      process.exit(2);
    }
  }

  if (reason) block(reason);
  process.exit(0);
});
