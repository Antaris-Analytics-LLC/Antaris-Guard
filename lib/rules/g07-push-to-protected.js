"use strict";
const { anyPush } = require("../parse");

/* G07: a push to a protected branch, by any way of naming it: HEAD:main, :main, --delete origin
   main, refs/heads/main, a leading +. The branch list is the config's protectedBranches, main and
   master by default. The reason is v0.1's, word for word, whichever protected branch was named. */

/** The refs a protected branch can be pushed as: its name and refs/heads/ plus its name. */
const protectedRefs = (branches) => new Set(branches.flatMap((b) => [b, `refs/heads/${b}`]));

/** A positional argument that names a protected branch, once a leading + and anything before a colon are removed. */
const namesProtected = (refs) => (a) => refs.has(a.replace(/^\+/, "").replace(/^[^:]*:/, ""));

module.exports = {
  id: "G07",
  name: "push-to-protected",
  tier: "deny",
  reason: "direct push to main; open a PR instead",
  test: ({ commands }, config) => {
    const positional = namesProtected(protectedRefs(config.protectedBranches));
    return commands.some((words) => anyPush(words, { positional }));
  },
};
