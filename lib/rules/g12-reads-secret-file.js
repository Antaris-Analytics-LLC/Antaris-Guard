"use strict";
const { readPathsOf } = require("../parse");

/* G12: cat, less, head, tail, grep or rg reading a secret file, judged on the paths it reads and
   never on a grep or rg pattern. The path patterns are hard-coded until R2 moves them to config. */

/** A path whose basename is .env or .env.anything, or ends in .pem, .key or .p12. A redirection's arrows are not part of it. */
const secretPath = (w) => {
  const base = w.replace(/^\d*[<>]+&?/, "").split("/").pop();
  return base === ".env" || base.startsWith(".env.") || /\.(pem|key|p12)$/.test(base);
};

const readsSecret = (words) => {
  const read = readPathsOf(words);
  return !!read && read.paths.some(secretPath);
};

module.exports = {
  id: "G12",
  name: "reads-secret-file",
  tier: "deny",
  reason: "reading a secret file",
  test: ({ commands }) => commands.some(readsSecret),
};
