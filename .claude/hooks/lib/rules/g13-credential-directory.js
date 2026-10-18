"use strict";

/* G13: a credential directory or file named anywhere in the line, by the config's
   credentialPaths list: ~/.aws, ~/.ssh, ~/.config, ~/.netrc, ~/.npmrc by default. Each entry is
   matched as a prefix, as v0.1 did, so ~/.aws covers ~/.aws/credentials. */
const escape = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const credentialLine = (paths) => new RegExp(paths.map(escape).join("|"));

module.exports = {
  id: "G13",
  name: "credential-directory",
  tier: "deny",
  reason: "reading credential directories",
  test: ({ line }, config) => config.credentialPaths.length > 0 && credentialLine(config.credentialPaths).test(line),
};
