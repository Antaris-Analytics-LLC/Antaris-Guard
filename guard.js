#!/usr/bin/env node
/*
 * Antaris-Guard: the Bash guard. PreToolUse hook for Bash in Claude Code.
 *
 * Reads the tool call from stdin, hands the command to judge() in lib/judge.js, exits 2 with the
 * rule and reason on stderr to block, exits 0 in silence to allow. The permission rules in
 * settings.json are prefix matches on the first command; the judge reads the whole line the way
 * a shell would run it, so chained commands, subshells, pipes into interpreters, shell strings,
 * inline code and secret-shaped arguments are caught too.
 *
 * The guard fails closed by itself. A tool call that is not JSON, a lib/ folder that is missing
 * or a rule file that throws when it loads, and anything else that throws anywhere in this
 * process, is a G17 block with exit 2, never a crash with exit 1. Claude Code reads exit 1 as a
 * non-blocking error unless the hook has onFailure: block (2.1.295 and later), so that setting
 * is the second layer, not the first: nothing above the try below may throw, and the
 * uncaughtException handler is the last net under all of it.
 *
 * The parser is lib/parse.js, the rules are lib/rules/ (one file each, with an id), and the order
 * they run in is lib/rules/index.js. This file requires them relatively, so a copied install
 * carries lib/ beside it. No dependencies, Node 22 or later.
 *
 * The stderr line keeps v0.1's shape, with the rule's id and name at the front of the reason:
 *   guard: blocked (G07 push-to-protected: direct push to main; open a PR instead): git push origin main
 *   guard: blocked (G17 unreadable: the guard could not load: Cannot find module '.../lib/judge.js')
 */
"use strict";

// G17's id, name and the two reasons this file prints are spelled out here rather than read from
// lib/, because this file has to block when lib/ is not there. test/judge.test.ts holds them
// against lib/rules/g17-unreadable.js so they cannot drift.
const UNREADABLE = "G17 unreadable";
const block = (reason) => { process.stderr.write(`guard: blocked (${UNREADABLE}: ${reason})\n`); process.exit(2); };
// One line on stderr, whatever the error says: Node's "Cannot find module" carries a require stack over several lines.
const message = (err) => (err && err.message ? err.message : String(err)).replace(/\s+/g, " ").trim();
const couldNotLoad = (err) => block(`the guard could not load: ${message(err)}`);
process.on("uncaughtException", couldNotLoad);
process.on("unhandledRejection", couldNotLoad);

let judge, blockedLine;
try {
  const path = require("node:path");
  ({ judge, blockedLine } = require(path.join(__dirname, "lib", "judge.js")));
  if (typeof judge !== "function" || typeof blockedLine !== "function") throw new Error("lib/judge.js does not export judge() and blockedLine()");
} catch (err) {
  couldNotLoad(err);
}

let input = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (d) => (input += d));
process.stdin.on("end", () => {
  let cmd = "";
  try {
    cmd = String(JSON.parse(input).tool_input?.command || "");
  } catch {
    block("could not read the tool call");
  }
  try {
    const verdict = judge(cmd);
    if (verdict.decision !== "allow") {
      process.stderr.write(`${blockedLine(verdict)}\n`);
      process.exit(2);
    }
  } catch (err) {
    // judge() turns a rule's throw into G17 itself; a throw that reaches here is a fault in the
    // guard, and the command still does not run.
    block(`the guard could not judge the command: ${message(err)}`);
  }
  process.exit(0);
});
