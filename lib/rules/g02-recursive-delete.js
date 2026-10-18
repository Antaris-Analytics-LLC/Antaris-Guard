"use strict";

/* G02: rm -r in any spelling, including git rm -r. */
module.exports = {
  id: "G02",
  name: "recursive-delete",
  tier: "deny",
  reason: "recursive delete",
  test: ({ line }) => /\brm\s+(-[a-zA-Z]*r[a-zA-Z]*|--recursive)/.test(line),
};
