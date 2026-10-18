"use strict";

/* G10: $(...) and backticks. What they run is decided at run time, which the guard cannot see.
   v0.1 matched a $( with a ) somewhere after it, or two backticks; the same two questions are
   asked here with indexOf, which never backtracks. An unclosed $( or backtick never gets here:
   the parser throws on it and judge() makes that G17. */
module.exports = {
  id: "G10",
  name: "command-substitution",
  tier: "deny",
  reason: "command substitution",
  test: ({ line }) => {
    const dollar = line.indexOf("$(");
    if (dollar !== -1 && line.indexOf(")", dollar + 2) !== -1) return true;
    const tick = line.indexOf("`");
    return tick !== -1 && line.indexOf("`", tick + 1) !== -1;
  },
};
