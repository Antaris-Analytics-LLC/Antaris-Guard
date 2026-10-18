"use strict";

/* G08: git reset --hard, git clean -f, git branch -D. */
module.exports = {
  id: "G08",
  name: "destructive-git",
  tier: "deny",
  reason: "destructive git",
  test: ({ line }) => /\bgit\s+(reset\s+--hard|clean\s+-[a-zA-Z]*f|branch\s+-D)/.test(line),
};
