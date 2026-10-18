"use strict";
const { programOf, runOf, base } = require("../parse");

/* G04: the ways around rm -r that run a delete through another program: find -delete, find -exec
   rm (and -execdir), and xargs rm. Judged per command since R2: find is the command's program,
   past wrappers and runners (timeout 60 find, doas find, xargs find, npx find, /usr/bin/find), and
   -delete is one of its words with the quotes removed, so a search whose pattern mentions them is
   left alone. Three checks, three reasons, one id, each check run over every command before the
   next, so a line two checks would catch gets the reason v0.1 gave it. */

const DELETE_FLAG = /^-delete(?![A-Za-z0-9_])/;
const RM = /^rm(?![A-Za-z0-9_])/;
const RM_WORD = /\brm\b/;

/** The words after find when the command runs find, else null. */
const findArguments = (words) => {
  const { program, rest } = runOf(words);
  return program !== undefined && base(program) === "find" ? rest : null;
};

const CHECKS = [
  [(words) => { const rest = findArguments(words); return !!rest && rest.some((a) => DELETE_FLAG.test(a)); }, "find -delete is a delete"],
  [(words) => { const rest = findArguments(words); return !!rest && rest.some((a, i) => (a === "-exec" || a === "-execdir") && RM.test(rest[i + 1] ?? "")); }, "find -exec rm is a delete"],
  [(words) => { const { program, rest } = programOf(words); return program !== undefined && base(program) === "xargs" && rest.some((a) => RM_WORD.test(a)); }, "xargs rm is a delete"],
];

module.exports = {
  id: "G04",
  name: "find-or-xargs-delete",
  tier: "deny",
  reason: "find -delete is a delete",
  reasons: CHECKS.map(([, reason]) => reason),
  test: ({ commands }) => {
    for (const [check, reason] of CHECKS) if (commands.some(check)) return reason;
    return false;
  },
};
