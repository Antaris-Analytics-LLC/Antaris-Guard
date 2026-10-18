"use strict";

/* G01: a program from the config's blockedPrograms list, as a command anywhere in the line. Read
   off the collapsed line in v0.1's shape, broad on purpose: the name at the start of the line or
   after ; & | ` (, followed by a word boundary. R5 judges it per command. */
const escape = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** The v0.1 regex, built from the list: longer names first so python3 is tried before python. */
const blockedProgramLine = (names) => new RegExp(`(^|[;&|\`(]\\s*)(${[...names].sort((a, b) => b.length - a.length).map(escape).join("|")})\\b`);

module.exports = {
  id: "G01",
  name: "blocked-program",
  tier: "deny",
  reason: "a blocked program appears somewhere in the line",
  test: ({ line }, config) => config.blockedPrograms.length > 0 && blockedProgramLine(config.blockedPrograms).test(line),
};
