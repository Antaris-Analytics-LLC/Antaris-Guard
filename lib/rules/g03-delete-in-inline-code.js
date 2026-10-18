"use strict";
const { COMMAND_START } = require("../parse");

/* G03: a delete call inside the code a command hands an interpreter on the line (node -e, tsx
   --eval, perl -e, ruby -e, bun -e, deno eval, php -r), wherever the interpreter sits in the
   command. Judged two ways, as v0.1 did: an interpreter run as a command with a code flag, with a
   delete call anywhere on the line; or a delete call in the code the parser lifted off the line. */

// An interpreter run as a command and given code on the line rather than a file, read off the line too, broad on purpose.
const INLINE_CODE_LINE = new RegExp(`${COMMAND_START}(node|nodejs|tsx|ts-node|bun|deno|perl|ruby|php)\\b[^|;&]*?\\s(-e|--eval|-p|--print|-pe|-ne|-E|-r|eval)\\b`);

/** A call that removes files, in any of those languages. */
const DELETE_CALL = /\b(rmSync|rmdirSync|unlinkSync|unlink|rimraf|rmtree|rm_rf|rm_r|remove_tree|removeSync|rm\s*\(|rmdir\s*\(|fs\.rm\b|promises\.rm\b|Deno\.remove|FileUtils\.rm)/;

module.exports = {
  id: "G03",
  name: "delete-in-inline-code",
  tier: "deny",
  reason: "a delete inside inline code is still a delete; if a delete is needed, say what was blocked and stop",
  test: ({ line, inlineCode }) => (INLINE_CODE_LINE.test(line) && DELETE_CALL.test(line)) || inlineCode.some((code) => DELETE_CALL.test(code)),
};
