/*
 * Antaris-Guard: the judge. One command in, one decision out.
 *
 *   judge(command, config, context) -> { decision, rule, name, tier, reason, parse }
 *
 * decision is "allow" or "deny" (R4 adds "ask"); rule is the id of the rule that decided, null on
 * allow; reason is the text a person reads, without the id; parse is what the parser saw, or
 * { line } alone when the line could not be read. config is the object from .claude/guard.config.json
 * (or any object of that shape); judge() validates it itself, so a malformed config fails closed
 * rather than matching the wrong thing in silence, and no config at all is a block. context is
 * reserved for what later rounds pass in (a file reader for scanned scripts); nothing reads it yet.
 *
 * judge() is pure: it touches no process, no stdin and no disk, so the same command and config
 * give the same decision anywhere. The guard fails closed. A command longer than
 * MAX_COMMAND_LENGTH is G17 before the parser sees it, so nothing runs on a line of any length.
 * A line the parser cannot read is G17. A rule that throws has not judged the line, so the line
 * is G17 rather than let through.
 */
"use strict";
const { parse, lineOf } = require("./parse");
const { RULES, UNREADABLE } = require("./rules");
const { validate } = require("./config");

/** The longest command the guard judges, in characters. Longer is G17: put long content in a file with the Write tool. */
const MAX_COMMAND_LENGTH = 262144;
/** How much of an over-long command the stderr line shows. */
const EXCERPT = 200;

const deny = (rule, reason, parsed) => ({ decision: "deny", rule: rule.id, name: rule.name, tier: rule.tier, reason, parse: parsed });

function judge(command, config, context = {}) {
  void context;
  let settings;
  try {
    settings = validate(config);
  } catch (e) {
    return deny(UNREADABLE, UNREADABLE.config(e), { line: lineOf(command) });
  }
  const text = String(command);
  if (text.length > MAX_COMMAND_LENGTH) {
    return deny(UNREADABLE, UNREADABLE.tooLong(text.length, MAX_COMMAND_LENGTH), { line: `${lineOf(text.slice(0, EXCERPT))} ...` });
  }
  let parsed;
  try {
    parsed = parse(text);
  } catch (e) {
    return deny(UNREADABLE, UNREADABLE.command(e), { line: lineOf(text) });
  }
  for (const rule of RULES) {
    if (settings.rules[rule.id] === "off") continue;
    let hit;
    try {
      hit = rule.test(parsed, settings);
    } catch (e) {
      return deny(UNREADABLE, UNREADABLE.rule(e), parsed);
    }
    if (hit) return deny(rule, typeof hit === "string" ? hit : rule.reason, parsed);
  }
  return { decision: "allow", rule: null, name: null, tier: null, reason: "", parse: parsed };
}

/** The stderr line for a denied command, in v0.1's shape with the id and name at the front of the reason. */
const blockedLine = (verdict) => `guard: blocked (${verdict.rule} ${verdict.name}: ${verdict.reason}): ${verdict.parse.line}`;

module.exports = { judge, blockedLine, MAX_COMMAND_LENGTH };
