"use strict";

/* G10: $(...) and backticks. What they run is decided at run time, which the guard cannot see. */
module.exports = {
  id: "G10",
  name: "command-substitution",
  tier: "deny",
  reason: "command substitution",
  test: ({ line }) => /\$\(.*\)|`[^`]*`/.test(line),
};
