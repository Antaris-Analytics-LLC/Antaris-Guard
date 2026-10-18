"use strict";

/* G05: PowerShell's recursive delete, Remove-Item -Recurse, when a line reaches the guard from
   Windows. Same reason text as G02, so a reader sees one thing: a recursive delete. The v0.1 match
   is Remove-Item followed by -Recurse before the next | ; or &; it is read here segment by
   segment, from the first Remove-Item in each, which is the same answer in one pass. */
const REMOVE_ITEM = /\bRemove-Item\b/i;
const RECURSE = /-Recurse\b/i;

module.exports = {
  id: "G05",
  name: "remove-item-recurse",
  tier: "deny",
  reason: "recursive delete",
  test: ({ line }) => line.split(/[|;&]/).some((segment) => {
    const at = segment.search(REMOVE_ITEM);
    return at !== -1 && RECURSE.test(segment.slice(at + "Remove-Item".length));
  }),
};
