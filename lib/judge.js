/*
 * Antaris-Guard: the judge. One command in, one decision out.
 *
 *   judge(command, context) -> { decision, rule, reason, parse }
 *
 * decision is "allow" or "deny" (R4 adds "ask"); rule is the id of the rule that decided, null on
 * allow; reason is the text a person reads, without the id; parse is what the parser saw, or
 * { line } alone when the line could not be read. judge() is pure: it touches no process, no
 * stdin and no disk, so the same command gives the same decision anywhere. context is reserved
 * for what later rounds pass in (a file reader for scanned scripts); nothing reads it yet.
 *
 * The guard fails closed. A line the parser cannot read is G17. A rule that throws has not judged
 * the line, so the line is G17 rather than let through.
 */
"use strict";
const { parse, lineOf } = require("./parse");
const { RULES, UNREADABLE } = require("./rules");

const deny = (rule, reason, parsed) => ({ decision: "deny", rule: rule.id, name: rule.name, tier: rule.tier, reason, parse: parsed });

function judge(command, context = {}) {
  void context;
  let parsed;
  try {
    parsed = parse(command);
  } catch (e) {
    return deny(UNREADABLE, UNREADABLE.command(e), { line: lineOf(command) });
  }
  for (const rule of RULES) {
    let hit;
    try {
      hit = rule.test(parsed);
    } catch (e) {
      return deny(UNREADABLE, UNREADABLE.rule(e), parsed);
    }
    if (hit) return deny(rule, typeof hit === "string" ? hit : rule.reason, parsed);
  }
  return { decision: "allow", rule: null, name: null, tier: null, reason: "", parse: parsed };
}

/** The stderr line for a denied command, in v0.1's shape with the id and name at the front of the reason. */
const blockedLine = (verdict) => `guard: blocked (${verdict.rule} ${verdict.name}: ${verdict.reason}): ${verdict.parse.line}`;

module.exports = { judge, blockedLine };
