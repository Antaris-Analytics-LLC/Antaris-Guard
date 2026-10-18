#!/usr/bin/env node
/*
 * Antaris-Guard: the command line. This round, one command:
 *
 *   node bin/antaris-guard.js explain "<command>"
 *
 * prints what the parser saw (the commands with their programs, which are piped, which came out
 * of a shell string, the inline code) and the decision with its rule and reason, reading the
 * config the hook would read: .claude/guard.config.json under CLAUDE_PROJECT_DIR, else the
 * working directory. Exit 0 is allow, exit 2 is deny, as the hook does it; exit 1 is a usage
 * error. A config the guard cannot read is a deny with G17's reason, as the hook does it.
 *
 * Not yet a package command; R7 adds the rest (test, init, upgrade, check, compare, log,
 * verify-log) and the package.json bin entry.
 */
"use strict";
const path = require("node:path");
const { judge } = require(path.join(__dirname, "..", "lib", "judge.js"));
const { parse, programOf } = require(path.join(__dirname, "..", "lib", "parse.js"));
const { readConfig, projectDir } = require(path.join(__dirname, "..", "lib", "config.js"));
const { UNREADABLE } = require(path.join(__dirname, "..", "lib", "rules", "index.js"));

const out = (s = "") => process.stdout.write(`${s}\n`);
const usage = () => { process.stderr.write('usage: antaris-guard explain "<command>"\n'); process.exit(1); };

function explain(command) {
  const dir = projectDir({ env: process.env });
  let config, configPath;
  try {
    ({ raw: config, path: configPath } = readConfig(dir));
  } catch (err) {
    out(`config: none (${err.message})`);
    out(`command: ${command}`);
    out("decision: deny");
    out(`rule: ${UNREADABLE.id} ${UNREADABLE.name} (${UNREADABLE.tier})`);
    out(`reason: ${UNREADABLE.readConfig(err)}`);
    return 2;
  }
  out(`config: ${configPath}`);
  const verdict = judge(command, config);
  out(`command: ${verdict.parse.line}`);
  let parsed = null;
  try { parsed = parse(command); } catch { /* the decision below says why */ }
  if (parsed) {
    out("commands:");
    parsed.commands.forEach((words, i) => {
      const { program } = programOf(words);
      const notes = [`program ${program === undefined ? "(none)" : program}`];
      if (words.piped) notes.push("piped");
      if (words.depth) notes.push(`inside a shell string, ${words.depth} deep`);
      out(`  ${String(i + 1).padStart(2)}. ${words.join(" ")}    [${notes.join(", ")}]`);
    });
    out(parsed.inlineCode.length ? "inline code:" : "inline code: none");
    for (const code of parsed.inlineCode) out(`  ${code}`);
  } else {
    out("commands: the line could not be read");
  }
  out(`decision: ${verdict.decision}`);
  if (verdict.decision === "allow") return 0;
  out(`rule: ${verdict.rule} ${verdict.name} (${verdict.tier})`);
  out(`reason: ${verdict.reason}`);
  return 2;
}

const [, , verb, ...rest] = process.argv;
if (verb !== "explain" || rest.length !== 1) usage();
process.exit(explain(rest[0]));
