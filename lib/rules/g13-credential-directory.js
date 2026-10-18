"use strict";

/* G13: ~/.aws, ~/.ssh, ~/.config, ~/.netrc, ~/.npmrc anywhere in the line. The list is hard-coded
   until R2 moves it to config. */
module.exports = {
  id: "G13",
  name: "credential-directory",
  tier: "deny",
  reason: "reading credential directories",
  test: ({ line }) => /~\/\.(aws|ssh|config|netrc|npmrc)/.test(line),
};
