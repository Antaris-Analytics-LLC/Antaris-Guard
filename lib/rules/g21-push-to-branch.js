"use strict";
const { hasPush } = require("../parse");

/* G21: a push to a branch, ask by default. A push is code leaving the machine, the moment an
   operator wants to see, so every git push the deny rules leave is an ask: G06 denies a force
   push and G07 a push to a protected branch, and since a deny wins over an ask on the same line,
   what reaches G21 is every other push (G19, a URL or an unknown remote, joins the deny rules in
   R5). A push is found the way G06 and G07 find one: wherever git is a word in a command, behind a
   wrapper, xargs, find -exec or watch, by path, and in the string a shell is given. A push inside
   inline code is G14's, a deny. The config can move G21 to deny or turn it off; the worked example
   turns it off, since Inventaris pushes a branch in every round. */

module.exports = {
  id: "G21",
  name: "push-to-branch",
  tier: "ask",
  reason: "a push leaves the machine; confirm it",
  test: ({ commands }) => commands.some(hasPush),
};
