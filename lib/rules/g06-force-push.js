"use strict";
const { pushesOf } = require("../parse");

/* G06: a force push, judged per command: --force, --force-with-lease, --force-if-includes, -f
   alone or among short flags (like -uf), or a positional starting with +, wherever git appears as
   a word in the command. */
const forcePushes = (words) =>
  pushesOf(words).some((p) => p.options.some((o) => /^--force(-with-lease|-if-includes)?(=.*)?$/.test(o) || /^-[A-Za-z]*f[A-Za-z]*$/.test(o)) || p.positionals.some((a) => a.startsWith("+")));

module.exports = {
  id: "G06",
  name: "force-push",
  tier: "deny",
  reason: "force push",
  test: ({ commands }) => commands.some(forcePushes),
};
