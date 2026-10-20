"use strict";
const { runOf, base, INTERPRETERS } = require("../parse");

/* G03: a delete call inside the code a command hands an interpreter on the line (node -e, tsx
   --eval, perl -e, ruby -e, bun -e, deno eval, php -r), wherever the interpreter sits in the
   command. Judged two ways, as v0.1 did: an interpreter run as a command with a code flag, with a
   delete call anywhere on the line; or a delete call in the code the parser lifted off the line.
   Since R2 the first way is judged per command rather than off the line: the command's program,
   past wrappers and runners (timeout, doas, npx, xargs and the rest), is an interpreter and one of
   its words is a code flag. */

/** A flag that hands the interpreter code on the line, as a whole word. */
const CODE_FLAG = /^(-e|--eval|-p|--print|-pe|-ne|-E|-r|eval)(?![A-Za-z0-9_])/;

/** A command that runs an interpreter and gives it code on the line rather than a file. */
const runsInlineCode = (words) => {
  const { program, rest } = runOf(words);
  return program !== undefined && INTERPRETERS.has(base(program)) && rest.some((a) => CODE_FLAG.test(a));
};

/** A call that removes files, in any of those languages. */
const DELETE_CALL = /\b(rmSync|rmdirSync|unlinkSync|unlink|rimraf|rmtree|rm_rf|rm_r|remove_tree|removeSync|rm\s*\(|rmdir\s*\(|fs\.rm\b|promises\.rm\b|Deno\.remove|FileUtils\.rm)/;

module.exports = {
  id: "G03",
  name: "delete-in-inline-code",
  tier: "deny",
  reason: "a delete inside inline code is still a delete; if a delete is needed, say what was blocked and stop",
  // What an ask says, when a config moves this rule to ask: the operator answers it, so it does not tell anyone to stop.
  askReason: "a delete inside inline code",
  test: ({ line, commands, inlineCode }) => (commands.some(runsInlineCode) && DELETE_CALL.test(line)) || inlineCode.some((code) => DELETE_CALL.test(code)),
};
