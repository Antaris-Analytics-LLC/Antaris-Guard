"use strict";

/* G05: PowerShell's recursive delete, Remove-Item -Recurse, when a line reaches the guard from
   Windows. Same reason text as G02, so a reader sees one thing: a recursive delete.

   Remove-Item and -Recurse count only at the start of a word, never inside a file name: a name
   like lib/rules/g05-remove-item-recurse.js on a line is not a delete (R2; v0.1 matched the two
   anywhere, and a cat of that file was blocked). The start of a word is anything but a letter, a
   digit, an underscore, a dot, a dash or a slash before it, so a quote counts, and
   pwsh -c "Remove-Item -Recurse x" is still a delete. A backslash counts before Remove-Item and
   not before -Recurse: PowerShell qualifies a cmdlet with its module, as
   Microsoft.PowerShell.Management\Remove-Item, and that is the same delete. The pair must sit
   between the same | ; and &, read from the first Remove-Item in each segment, which is one pass. */
const BEFORE_NAME = "(?<![A-Za-z0-9_.\\/-])";
const BEFORE_FLAG = "(?<![A-Za-z0-9_.\\/\\\\-])";
const REMOVE_ITEM = new RegExp(`${BEFORE_NAME}Remove-Item\\b`, "i");
const RECURSE = new RegExp(`${BEFORE_FLAG}-Recurse\\b`, "i");

module.exports = {
  id: "G05",
  name: "remove-item-recurse",
  tier: "deny",
  reason: "recursive delete",
  test: ({ line }) => line.split(/[|;&]/).some((segment) => {
    const found = REMOVE_ITEM.exec(segment);
    // The slice keeps the last letter of Item, so a -Recurse glued to it is read as part of that name, not as a flag.
    return found !== null && RECURSE.test(segment.slice(found.index + "Remove-Item".length - 1));
  }),
};
