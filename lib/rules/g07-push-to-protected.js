"use strict";
const { pushesOf } = require("../parse");

/* G07: a push to main or master, by any way of naming it: HEAD:main, :main, --delete origin
   main, refs/heads/main, a leading +. The branch list is hard-coded until R2 moves it to config. */
const MAIN_REFS = new Set(["main", "master", "refs/heads/main", "refs/heads/master"]);

/** A push whose positional argument names main or master, once a leading + and anything before a colon are removed. */
const pushesToMain = (words) =>
  pushesOf(words).some((p) => p.positionals.some((a) => MAIN_REFS.has(a.replace(/^\+/, "").replace(/^[^:]*:/, ""))));

module.exports = {
  id: "G07",
  name: "push-to-protected",
  tier: "deny",
  reason: "direct push to main; open a PR instead",
  test: ({ commands }) => commands.some(pushesToMain),
};
