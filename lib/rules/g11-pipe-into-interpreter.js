"use strict";
const { programOf } = require("../parse");

/* G11: a command after a real pipe whose program is sh, bash, zsh, node or python, by name or
   path: what comes down the pipe is run as code. */
const pipesIntoInterpreter = (words) => !!words.piped && /^(sh|bash|zsh|node|python(3(\.\d+)?)?)$/.test((programOf(words).program ?? "").split("/").pop());

module.exports = {
  id: "G11",
  name: "pipe-into-interpreter",
  tier: "deny",
  reason: "piping into an interpreter",
  test: ({ commands }) => commands.some(pipesIntoInterpreter),
};
