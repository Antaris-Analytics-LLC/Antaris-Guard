"use strict";
const { readPathsOf } = require("../parse");

/* G12: cat, less, head, tail, grep or rg reading a secret file, judged on the paths it reads and
   never on a grep or rg pattern. A secret file is one whose name matches a pattern in the config's
   secretPaths: a glob on the file's name alone (the last path part), where * is any run of
   characters and ? is one. The defaults are v0.1's: .env, .env.*, *.pem, *.key, *.p12. */

/** A name glob as a regex: * and ? only, anchored to the whole name. */
const globToRegExp = (glob) => new RegExp(`^${glob.replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*").replace(/\?/g, ".")}$`);

/** The file's name, with a redirection's arrows removed and the directories dropped. */
const nameOf = (w) => w.replace(/^\d*[<>]+&?/, "").split("/").pop();

const readsSecret = (words, patterns) => {
  const read = readPathsOf(words);
  return !!read && read.paths.some((p) => { const name = nameOf(p); return patterns.some((re) => re.test(name)); });
};

module.exports = {
  id: "G12",
  name: "reads-secret-file",
  tier: "deny",
  reason: "reading a secret file",
  test: ({ commands }, config) => {
    const patterns = config.secretPaths.map(globToRegExp);
    return commands.some((words) => readsSecret(words, patterns));
  },
};
