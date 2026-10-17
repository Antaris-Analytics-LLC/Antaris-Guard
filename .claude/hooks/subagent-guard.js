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

let input = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk) => (input += chunk));
process.stdin.on("end", () => {
  let data;
  try {
    data = JSON.parse(input);
  } catch {
    block("could not read the tool call");
  }

  const tool = String(data.tool_name || "");
  if (tool !== "Agent" && tool !== "Task") process.exit(0);
  const call = data.tool_input || {};

  if (data.agent_id) {
    block("this call came from inside a subagent, and nesting is off in this repo");
  }
  if (call.subagent_type === "fork") {
    block("forks are off in this repo because they always run on the main session's model");
  }
  if (call.isolation) {
    block(`isolation "${call.isolation}" is off in this repo; run the subagent in the main checkout`);
  }

  const model = String(call.model || "").toLowerCase();
  if (model && !ALLOWED_MODEL.test(model)) {
    block(`subagents run on sonnet or opus only, and this call asked for "${model}"`);
  }
  if (!model) {
    const pinned =
      process.env.CLAUDE_CODE_SUBAGENT_MODEL_FORCE === "1" &&
      ALLOWED_MODEL.test(String(process.env.CLAUDE_CODE_SUBAGENT_MODEL || "").toLowerCase());
    if (!pinned) {
      block('every subagent call names its model: set model to "sonnet" for shorter, well-defined jobs, or "opus" when the task needs more reasoning');
    }
  }

  // One empty file per subagent, in the system temp folder. Opening with the "wx" flag fails
  // when the file already exists, and that check is atomic, so subagents launched in parallel
  // can't claim the same slot.
  const session = String(data.session_id || "unknown").replace(/[^a-zA-Z0-9_-]/g, "") || "unknown";
  for (let n = 1; n <= MAX_PER_SESSION; n++) {
    const slot = path.join(os.tmpdir(), `antaris-guard-subagent-${session}-${n}`);
    try {
      fs.closeSync(fs.openSync(slot, "wx"));
      process.exit(0);
    } catch (err) {
      if (err.code !== "EEXIST") block(`could not record the subagent count (${err.code || err.message})`);
    }
  }
  block(`this session has used all ${MAX_PER_SESSION} of its subagents; finish the work in the main session`);
});

function block(reason) {
  process.stderr.write(`subagent-guard: blocked (${reason})\n`);
  process.exit(2);
}
