"use strict";

/* G17: what the guard cannot read is blocked, never let through. This rule has no test of its
   own: judge() gives its id to a line the parser cannot read (an unclosed quote, a heredoc with no
   end, shells nested more than three deep), to a rule that threw, and guard.js gives it to a tool
   call that is not JSON. The three reasons are v0.1's, word for word. */
module.exports = {
  id: "G17",
  name: "unreadable",
  tier: "deny",
  reason: "could not read the command",
  reasons: ["could not read the tool call", "could not read the command: <why>", "the guard could not judge the command: <why>"],
  test: null,
  toolCall: () => "could not read the tool call",
  command: (err) => `could not read the command: ${err.message}`,
  rule: (err) => `the guard could not judge the command: ${err.message}`,
};
