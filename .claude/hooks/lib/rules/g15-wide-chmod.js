"use strict";

/* G15: chmod 777 or chmod -R. */
module.exports = {
  id: "G15",
  name: "wide-chmod",
  tier: "deny",
  reason: "wide chmod",
  test: ({ line }) => /\bchmod\s+(777|-R)/.test(line),
};
