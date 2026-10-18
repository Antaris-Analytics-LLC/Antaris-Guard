"use strict";

/* G05: PowerShell's recursive delete, Remove-Item -Recurse, when a line reaches the guard from
   Windows. Same reason text as G02, so a reader sees one thing: a recursive delete. */
module.exports = {
  id: "G05",
  name: "remove-item-recurse",
  tier: "deny",
  reason: "recursive delete",
  test: ({ line }) => /\bRemove-Item\b[^|;&]*-Recurse\b/i.test(line),
};
