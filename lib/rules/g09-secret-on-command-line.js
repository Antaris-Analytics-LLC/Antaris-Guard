"use strict";

/* G09: a secret set on the command line, by the environment names that carry one. The names are
   the config's secretEnv list, matched in v0.1's shape: the name as a whole word, then = with
   optional spaces, anywhere in the line. */
const escape = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const secretSetLine = (names) => new RegExp(`\\b(${names.map(escape).join("|")})\\s*=`);

module.exports = {
  id: "G09",
  name: "secret-on-command-line",
  tier: "deny",
  reason: "setting a secret on the command line",
  test: ({ line }, config) => secretSetLine(config.secretEnv).test(line),
};
