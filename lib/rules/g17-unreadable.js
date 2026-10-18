"use strict";

/* G17: what the guard cannot read is blocked, never let through. This rule has no test of its
   own: judge() gives its id to a line the parser cannot read (an unclosed quote, a heredoc with no
   end, shells nested more than three deep) and to a rule that threw; guard.js gives it to a tool
   call that is not JSON, to a lib/ it cannot load (a missing folder, a rule file that throws when
   it loads), and to anything that throws anywhere in the hook process. The first three reasons
   are v0.1's, word for word; the fourth is new in R1. */
// One line, whatever the error says: Node's "Cannot find module" carries a require stack over several lines.
const message = (err) => (err && err.message ? err.message : String(err)).replace(/\s+/g, " ").trim();

module.exports = {
  id: "G17",
  name: "unreadable",
  tier: "deny",
  reason: "could not read the command",
  reasons: ["could not read the tool call", "could not read the command: <why>", "the guard could not judge the command: <why>", "the guard could not load: <why>"],
  test: null,
  toolCall: () => "could not read the tool call",
  command: (err) => `could not read the command: ${message(err)}`,
  rule: (err) => `the guard could not judge the command: ${message(err)}`,
  load: (err) => `the guard could not load: ${message(err)}`,
};
