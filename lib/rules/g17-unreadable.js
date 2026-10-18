"use strict";

/* G17: what the guard cannot read is blocked, never let through. This rule has no test of its
   own: judge() gives its id to a line the parser cannot read (an unclosed quote, a heredoc with no
   end, shells nested more than three deep), to a rule that threw, to a config that fails
   validation, and to a command too long to judge; guard.js gives it to a tool call that is not
   JSON, to a config file it cannot read (missing, unreadable, not JSON), to a log it cannot write,
   to a lib/ it cannot load (a missing folder, a rule file that throws when it loads), and to
   anything that throws anywhere in the hook process. The first three reasons are v0.1's, word for
   word; the fourth is from R1; the config and length reasons are from R2; the log reason is from
   R3. */
// One line, whatever the error says: Node's "Cannot find module" carries a require stack over several lines.
const message = (err) => (err && err.message ? err.message : String(err)).replace(/\s+/g, " ").trim();

module.exports = {
  id: "G17",
  name: "unreadable",
  tier: "deny",
  reason: "could not read the command",
  reasons: [
    "could not read the tool call",
    "could not read the command: <why>",
    "the guard could not judge the command: <why>",
    "the guard could not load: <why>",
    "could not read the config: <why>",
    "the config is not valid: <why>",
    "the command is too long to judge: <length> characters; the guard reads at most <limit>. Put long content in a file with the Write tool",
    "could not write the log: <why>",
  ],
  test: null,
  toolCall: () => "could not read the tool call",
  command: (err) => `could not read the command: ${message(err)}`,
  rule: (err) => `the guard could not judge the command: ${message(err)}`,
  load: (err) => `the guard could not load: ${message(err)}`,
  readConfig: (err) => `could not read the config: ${message(err)}`,
  config: (err) => `the config is not valid: ${message(err)}`,
  tooLong: (length, limit) => `the command is too long to judge: ${length} characters; the guard reads at most ${limit}. Put long content in a file with the Write tool`,
  writeLog: (err) => `could not write the log: ${message(err)}`,
};
