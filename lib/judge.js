/*
 * Antaris-Guard: the judge. One command in, one decision out.
 *
 *   judge(command, config, context) -> { decision, rule, name, tier, reason, parse }
 *
 * decision is "allow", "ask" or "deny"; rule is the id of the rule that decided, null on allow;
 * tier is the tier it decided at, its own or the one the config gives it. A deny wins over an ask
 * wherever the two sit on the line. reason is the text a person reads, without the id: on an ask, the
 * rule's ask wording when it has one, since some deny reasons tell the session to stop, which reads
 * wrong in a prompt the operator answers (since the G02 PR); parse is what the parser saw, or
 * { line } alone when the line could not be read. config is the object from .claude/guard.config.json
 * (or any object of that shape); judge() validates it itself, so a malformed config fails closed
 * rather than matching the wrong thing in silence, and no config at all is a block. context is
 * what the hook knows and the parser cannot: { home }, the user's home folder, handed to every
 * rule as its third argument; a caller that leaves it out gets the stricter decision. Later
 * rounds add to it (a file reader for scanned scripts).
 *
 * judge() is pure: it touches no process, no stdin and no disk, so the same command, config and
 * context give the same decision anywhere. The guard fails closed. A command longer than
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

const deny = (rule, reason, parsed) => ({ decision: "deny", rule: rule.id, name: rule.name, tier: "deny", reason, parse: parsed });
const ask = (rule, reason, parsed) => ({ decision: "ask", rule: rule.id, name: rule.name, tier: "ask", reason, parse: parsed });

function judge(command, config, context = {}) {
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
  // Each rule runs at the tier the config gives it, else its own. A deny wins over an ask wherever
  // the two sit on the line, so the loop goes on past an ask and stops at the first deny; with no
  // deny, the first ask in rule order is the answer. A rule's test answers false, true (its own
  // reason), a reason, or { reason, askReason } when what it found changes both wordings; a rule may
  // also export askReason, the words an ask uses in place of its deny reason. The deny text is
  // never changed by either.
  let asked = null;
  for (const rule of RULES) {
    const tier = settings.rules[rule.id] ?? rule.tier;
    if (tier === "off") continue;
    let hit;
    try {
      hit = rule.test(parsed, settings, context);
    } catch (e) {
      return deny(UNREADABLE, UNREADABLE.rule(e), parsed);
    }
    if (!hit) continue;
    const found = typeof hit === "object" ? hit : {};
    const reason = typeof hit === "string" ? hit : found.reason ?? rule.reason;
    if (tier === "deny") return deny(rule, reason, parsed);
    if (asked === null) asked = ask(rule, found.askReason ?? rule.askReason ?? reason, parsed);
  }
  return asked ?? { decision: "allow", rule: null, name: null, tier: null, reason: "", parse: parsed };
}

/** The stderr line for a denied command, in v0.1's shape with the id and name at the front of the reason. */
const blockedLine = (verdict) => `guard: blocked (${verdict.rule} ${verdict.name}: ${verdict.reason}): ${verdict.parse.line}`;

/** The line the operator sees in the permission prompt for an ask: the rule, the reason and the command. */
const askLine = (verdict) => `guard: ask (${verdict.rule} ${verdict.name}: ${verdict.reason}): ${verdict.parse.line}`;

module.exports = { judge, blockedLine, askLine, MAX_COMMAND_LENGTH };
