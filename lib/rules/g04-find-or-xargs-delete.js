"use strict";
const { COMMAND_START } = require("../parse");

/* G04: the ways around rm -r that run a delete through another program: find -delete, find -exec
   rm (and -execdir), and xargs rm. find and xargs are matched as commands, so a search whose
   pattern mentions them is left alone. Three checks, three reasons, one id; the reason names the
   shape that hit, word for word as v0.1 said it. */
const CHECKS = [
  [new RegExp(`${COMMAND_START}find\\b[^|;&]*\\s-delete\\b`), "find -delete is a delete"],
  [new RegExp(`${COMMAND_START}find\\b[^|;&]*\\s-exec(dir)?\\s+rm\\b`), "find -exec rm is a delete"],
  [new RegExp(`${COMMAND_START}xargs\\b[^|;&]*\\brm\\b`), "xargs rm is a delete"],
];

module.exports = {
  id: "G04",
  name: "find-or-xargs-delete",
  tier: "deny",
  reason: "find -delete is a delete",
  reasons: CHECKS.map(([, reason]) => reason),
  test: ({ line }) => {
    for (const [re, reason] of CHECKS) if (re.test(line)) return reason;
    return false;
  },
};
