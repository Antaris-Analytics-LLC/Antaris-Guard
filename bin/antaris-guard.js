#!/usr/bin/env node
/*
 * Antaris-Guard: the command line. Three commands this round:
 *
 *   node bin/antaris-guard.js explain [--fallback <name>] "<command>"
 *   node bin/antaris-guard.js verify-log [--fallback <name>] [--tip <hash>]
 *   node bin/antaris-guard.js log [--fallback <name>]
 *
 * explain prints what the parser saw (the commands with their programs, which are piped, which
 * came out of a shell string, the inline code) and the decision with its rule and reason, reading
 * the config the hook would read: .claude/guard.config.json under CLAUDE_PROJECT_DIR, else the
 * working directory, and with no file there the fallback the hook would use, which --fallback
 * names as the hook's own argument does (the built-in defaults without it). Exit 0 is allow or
 * ask, exit 2 is deny, as the hook does it, and the decision line says which; exit 1 is a usage
 * error. A config the guard cannot read is a deny with G17's reason, as the hook does it.
 * explain judges and prints; it never writes the log.
 *
 * verify-log walks the decision log's chain and names every line that does not hold, saying when a
 * break looks like a fork (two lines sharing one prev); with --tip it also names the line that
 * carries that hash, which proves every line up to it unchanged, and fails when no line carries
 * it, which is how a rewrite or a cut is seen when the operator kept the tip somewhere no session
 * can write. log prints the tip and
 * the counts by decision, rule, day, session and tool, with the file's size. Both exit 0 when
 * the chain holds and 1 when it does not or there is no log.
 *
 * Not yet a package command; R7 adds the rest (test, init, upgrade, check, compare) and the
 * package.json bin entry.
 */
"use strict";
const path = require("node:path");
const os = require("node:os");
const { judge } = require(path.join(__dirname, "..", "lib", "judge.js"));
const { parse, programOf } = require(path.join(__dirname, "..", "lib", "parse.js"));
const { configPath, resolveConfig, projectDir, validate } = require(path.join(__dirname, "..", "lib", "config.js"));
const { UNREADABLE } = require(path.join(__dirname, "..", "lib", "rules", "index.js"));
const log = require(path.join(__dirname, "..", "lib", "log.js"));

const out = (s = "") => process.stdout.write(`${s}\n`);
const usage = () => { process.stderr.write('usage: antaris-guard explain [--fallback <name>] "<command>" | verify-log [--fallback <name>] [--tip <hash>] | log [--fallback <name>]\n'); process.exit(1); };

/** The config line: the project's file, or which fallback stands in for a missing one. */
function configLine(dir, found) {
  if (found.source === "project") return `config: ${found.path}`;
  const by = found.source === "defaults" ? "the built-in defaults" : `the fallback ${found.path}`;
  return `config: none at ${configPath(dir)}; judged by ${by}`;
}

/** The config the hook would read, validated, or null after printing why not. */
function settingsOrNull(fallback) {
  const dir = projectDir({ env: process.env });
  let found;
  try {
    found = resolveConfig(dir, fallback);
  } catch (err) {
    out(`config: none (${err.message})`);
    return null;
  }
  out(configLine(dir, found));
  let settings;
  try {
    settings = validate(found.raw);
  } catch (err) {
    out(`config: not valid (${err.message})`);
    return null;
  }
  return { dir, settings };
}

function explain(command, fallback) {
  const dir = projectDir({ env: process.env });
  let found;
  try {
    found = resolveConfig(dir, fallback);
  } catch (err) {
    out(`config: none (${err.message})`);
    out(`command: ${command}`);
    out("decision: deny");
    out(`rule: ${UNREADABLE.id} ${UNREADABLE.name} (${UNREADABLE.tier})`);
    out(`reason: ${UNREADABLE.readConfig(err)}`);
    return 2;
  }
  const config = found.raw;
  out(configLine(dir, found));
  const verdict = judge(command, config, { home: os.homedir() });
  let logLine = "log: not known until the config is valid";
  try { const file = log.logPath(validate(config), dir); logLine = `log: ${file ?? "off"}`; } catch { /* the decision below says why */ }
  out(logLine);
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
  // The hook's exit codes: an ask is exit 0 with the prompt's JSON, a deny is exit 2.
  return verdict.decision === "ask" ? 0 : 2;
}

function verifyLog(tip, fallback) {
  const found = settingsOrNull(fallback);
  if (!found) return 1;
  const file = log.logPath(found.settings, found.dir);
  if (!file) { out("log: off (the config turns the log off)"); return 1; }
  out(`log: ${file}`);
  const r = log.verify(file, { tip });
  for (const b of r.breaks) out(brokenLine(b));
  if (tip !== undefined) out(r.tipReason ?? `the tip given is line ${r.tipLine}: every line up to it is as it was when the tip was noted`);
  if (r.ok) out(`ok: ${r.lines} lines, tip ${r.tip}`);
  return r.ok ? 0 : 1;
}

/** One break as a line of output, saying when it looks like a fork. */
const brokenLine = (b) => `broken at line ${b.line}: ${b.reason}${b.fork ? `; lines ${b.fork} and ${b.line} share one prev, which looks like a fork: two hooks appending at once` : ""}`;

function showLog(fallback) {
  const found = settingsOrNull(fallback);
  if (!found) return 1;
  const file = log.logPath(found.settings, found.dir);
  if (!file) { out("log: off (the config turns the log off)"); return 1; }
  out(`log: ${file}`);
  let s;
  try {
    s = log.summary(file);
  } catch (err) {
    out(`no log to read: ${err.code || err.message}`);
    return 1;
  }
  out(`lines: ${s.lines}, size: ${s.size} bytes`);
  if (s.chain.ok) out(`chain: holds, tip ${s.chain.tip}`);
  else {
    const more = s.chain.breaks.length - 1;
    out(`chain: ${brokenLine(s.chain.breaks[0])}${more ? `; ${more} more ${more === 1 ? "break" : "breaks"} after it, which verify-log lists` : ""}`);
  }
  const show = (name, counts) => { const keys = Object.keys(counts).sort(); out(`${name}: ${keys.length ? keys.map((k) => `${k} ${counts[k]}`).join(", ") : "none"}`); };
  show("by decision", s.byDecision);
  show("by rule", s.byRule);
  show("by day", s.byDay);
  show("by session", s.bySession);
  show("by tool", s.byTool);
  return s.chain.ok ? 0 : 1;
}

const [, , verb, ...args] = process.argv;
// --fallback <name> comes first after the command, as the hook's own argument names its fallback.
let fallback, rest = args;
if (rest[0] === "--fallback") {
  if (rest.length < 2) usage();
  fallback = rest[1];
  rest = rest.slice(2);
}
if (verb === "explain" && rest.length === 1) process.exit(explain(rest[0], fallback));
if (verb === "verify-log") {
  let tip;
  if (rest.length === 0) tip = undefined;
  else if (rest.length === 2 && rest[0] === "--tip") tip = rest[1];
  else if (rest.length === 1 && rest[0].startsWith("--tip=")) tip = rest[0].slice("--tip=".length);
  else usage();
  process.exit(verifyLog(tip, fallback));
}
if (verb === "log" && rest.length === 0) process.exit(showLog(fallback));
usage();
