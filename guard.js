#!/usr/bin/env node
/*
 * Antaris-Guard: the Bash guard. PreToolUse hook for Bash in Claude Code.
 *
 * Reads the tool call from stdin, hands the command to judge() in lib/judge.js, exits 2 with the
 * rule and reason on stderr to block, exits 0 in silence to allow. The permission rules in
 * settings.json are prefix matches on the first command; the judge reads the whole line the way
 * a shell would run it, so chained commands, subshells, pipes into interpreters, shell strings,
 * inline code and secret-shaped arguments are caught too. A tool call that is not JSON is
 * blocked (G17): the guard fails closed.
 *
 * The parser is lib/parse.js, the rules are lib/rules/ (one file each, with an id), and the order
 * they run in is lib/rules/index.js. This file requires them relatively, so a copied install
 * carries lib/ beside it. No dependencies, Node 22 or later.
 *
 * The stderr line keeps v0.1's shape, with the rule's id and name at the front of the reason:
 *   guard: blocked (G07 push-to-protected: direct push to main; open a PR instead): git push origin main
 */
"use strict";
const path = require("node:path");
const { judge, blockedLine } = require(path.join(__dirname, "lib", "judge.js"));
const { UNREADABLE } = require(path.join(__dirname, "lib", "rules", "index.js"));

let input = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (d) => (input += d));
process.stdin.on("end", () => {
  let cmd = "";
  try {
    cmd = String(JSON.parse(input).tool_input?.command || "");
  } catch {
    process.stderr.write(`guard: blocked (${UNREADABLE.id} ${UNREADABLE.name}: ${UNREADABLE.toolCall()})\n`);
    process.exit(2);
  }
  const verdict = judge(cmd);
  if (verdict.decision !== "allow") {
    process.stderr.write(`${blockedLine(verdict)}\n`);
    process.exit(2);
  }
  process.exit(0);
});
