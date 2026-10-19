#!/usr/bin/env node
/*
 * Antaris-Guard: the Bash guard. PreToolUse hook for Bash in Claude Code.
 *
 * Reads the tool call from stdin, reads the config file under the project root, hands the command
 * and the config to judge() in lib/judge.js, appends the decision to the log, and answers one of
 * three ways: exit 2 with the rule and reason on stderr to deny; exit 0 with the hook's JSON on
 * stdout to ask, so Claude Code shows the operator the command, the rule and the reason and
 * waits; exit 0 in silence to allow, which leaves the call to Claude Code's own permission
 * settings. The guard never prints an allow, since a printed allow would skip the permission
 * prompt for everything the guard does not name. The permission rules in
 * settings.json are prefix matches on the first command; the judge reads the whole line the way
 * a shell would run it, so chained commands, subshells, pipes into interpreters, shell strings,
 * inline code and secret-shaped arguments are caught too.
 *
 * The guard fails closed by itself. A tool call that is not JSON, a config file that is missing
 * or unreadable or not JSON or not valid, a log that cannot be written, a lib/ folder that is
 * missing or a rule file that throws when it loads, and anything else that throws anywhere in
 * this process, is a G17 block with exit 2, never a crash with exit 1. Claude Code reads exit 1 as
 * a non-blocking error unless the hook has onFailure: block (2.1.295 and later), so that setting
 * is the second layer, not the first: nothing above the try below may throw, and the
 * uncaughtException handler is the last net under all of it.
 *
 * Every decision is logged, allows included, before it is printed: one line in the log under
 * .claude/guard/ with the command's SHA-256, never its text. A decision the log cannot keep is a
 * block, because a guard that cannot keep its record is not guarding; that goes for an ask as for
 * an allow, since either lets the command run. When the decision was a deny already, the deny line
 * prints and a second line says the log failed.
 *
 * The config is .claude/guard.config.json under the project root: CLAUDE_PROJECT_DIR when Claude
 * Code sets it, else the cwd field of the tool call, else this process's working directory. No
 * file is a block, naming the file: absence is refusal.
 *
 * The parser is lib/parse.js, the rules are lib/rules/ (one file each, with an id), the order
 * they run in is lib/rules/index.js, the config is lib/config.js and the log is lib/log.js. This
 * file requires them relatively, so a copied install carries lib/ beside it. No dependencies,
 * Node 22 or later.
 *
 * The stderr line keeps v0.1's shape, with the rule's id and name at the front of the reason:
 *   guard: blocked (G07 push-to-protected: direct push to main; open a PR instead): git push origin main
 *   guard: blocked (G17 unreadable: the guard could not load: Cannot find module '.../lib/judge.js')
 * and an ask's reason, shown in the permission prompt for a rule the config moves to ask, has the same shape:
 *   guard: ask (docker-01 docker-outside-postgres: docker outside running a local Postgres): docker exec pg psql
 */
"use strict";

// G17's id, name and the reasons this file prints are spelled out here rather than read from
// lib/, because this file has to block when lib/ is not there. test/judge.test.ts holds them
// against lib/rules/g17-unreadable.js so they cannot drift.
const UNREADABLE = "G17 unreadable";
const block = (reason, line) => { process.stderr.write(`guard: blocked (${UNREADABLE}: ${reason})${line === undefined ? "" : `: ${line}`}\n`); process.exit(2); };
// One line on stderr, whatever the error says: Node's "Cannot find module" carries a require stack over several lines.
const message = (err) => (err && err.message ? err.message : String(err)).replace(/\s+/g, " ").trim();
const couldNotLoad = (err) => block(`the guard could not load: ${message(err)}`);
process.on("uncaughtException", couldNotLoad);
process.on("unhandledRejection", couldNotLoad);

let judge, blockedLine, askLine, readConfig, projectDir, validate, logPath, appendLog, sha256, homedir, writeSync;
try {
  const path = require("node:path");
  homedir = require("node:os").homedir;
  ({ writeSync } = require("node:fs"));
  ({ judge, blockedLine, askLine } = require(path.join(__dirname, "lib", "judge.js")));
  if (typeof judge !== "function" || typeof blockedLine !== "function" || typeof askLine !== "function") throw new Error("lib/judge.js does not export judge(), blockedLine() and askLine()");
  ({ readConfig, projectDir, validate } = require(path.join(__dirname, "lib", "config.js")));
  if (typeof readConfig !== "function" || typeof projectDir !== "function" || typeof validate !== "function") throw new Error("lib/config.js does not export readConfig(), projectDir() and validate()");
  ({ logPath, append: appendLog, sha256 } = require(path.join(__dirname, "lib", "log.js")));
  if (typeof logPath !== "function" || typeof appendLog !== "function" || typeof sha256 !== "function") throw new Error("lib/log.js does not export logPath(), append() and sha256()");
} catch (err) {
  couldNotLoad(err);
}

let input = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (d) => (input += d));
process.stdin.on("end", () => {
  let call = null, unreadable = false;
  try {
    call = JSON.parse(input);
    if (call === null || typeof call !== "object") call = {};
  } catch {
    unreadable = true;
  }
  const cmd = unreadable ? "" : String(call.tool_input?.command || "");
  const line = cmd.replace(/\s+/g, " ").trim();
  const dir = projectDir({ env: process.env, cwd: unreadable ? undefined : call.cwd });

  // The config comes first, even for a tool call that is not JSON, so that decision is logged too.
  let raw;
  try {
    ({ raw } = readConfig(dir));
  } catch (err) {
    block(`could not read the config: ${message(err)}`, unreadable ? undefined : line);
  }
  let settings;
  try {
    settings = validate(raw);
  } catch (err) {
    block(`the config is not valid: ${message(err)}`, unreadable ? undefined : line);
  }

  // The decision, and the line that prints it. A tool call that is not JSON is G17 before anything
  // is judged, printed without a line as v0.1 did since there is none; a throw out of judge() is a
  // fault in the guard, and the command still does not run. The two lines this file decides on are
  // composed here, not by blockedLine(), which belongs to the lib/ that just failed.
  let verdict, printed;
  if (unreadable) {
    verdict = { decision: "deny", rule: "G17", name: "unreadable", reason: "could not read the tool call" };
    printed = `guard: blocked (${UNREADABLE}: ${verdict.reason})`;
  } else {
    try {
      verdict = judge(cmd, settings, { home: homedir() });
      printed = verdict.decision === "ask" ? askLine(verdict) : blockedLine(verdict);
    } catch (err) {
      verdict = { decision: "deny", rule: "G17", name: "unreadable", reason: `the guard could not judge the command: ${message(err)}` };
      printed = `guard: blocked (${UNREADABLE}: ${verdict.reason}): ${line}`;
    }
  }

  const file = logPath(settings, dir);
  if (file) {
    const session = typeof call?.session_id === "string" && call.session_id ? call.session_id.slice(0, 128) : "unknown";
    try {
      appendLog(file, { t: new Date().toISOString(), session, tool: "Bash", decision: verdict.decision, rule: verdict.rule, reason: verdict.reason, cmd_sha256: sha256(unreadable ? input : cmd) });
    } catch (err) {
      // An allow or an ask would let the command run unrecorded, so either is a block.
      if (verdict.decision !== "deny") block(`could not write the log: ${message(err)}`, line);
      process.stderr.write(`${printed}\nguard: could not write the log (${message(err)})\n`);
      process.exit(2);
    }
  }

  // An ask is exit 0 with the hook's JSON alone on stdout: Claude Code shows the operator the
  // command and this reason, and waits. Written synchronously so the whole object is out before exit.
  if (verdict.decision === "ask") {
    writeSync(1, `${JSON.stringify({ hookSpecificOutput: { hookEventName: "PreToolUse", permissionDecision: "ask", permissionDecisionReason: printed } })}\n`);
    process.exit(0);
  }
  if (verdict.decision !== "allow") {
    process.stderr.write(`${printed}\n`);
    process.exit(2);
  }
  process.exit(0);
});
