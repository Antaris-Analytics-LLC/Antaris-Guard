"use strict";
const { judgedOf, runOf, base, GIT_VALUE_OPTIONS } = require("../parse");

/* G02: rm -r in any spelling, including git rm -r. v0.1 read the whole line for rm, then a flag
   with a lowercase r right after it, or --recursive in full. Since the G02 PR it judges commands,
   not the line, as G16 has since R3: every word with the quotes and backslashes removed, shell
   strings included, plus the delimiter and body of every heredoc a command is given. Not judged: a
   # comment, and the message text G16 skips (git commit and git tag -m, --message, a heredoc into
   -F -; the title and body of gh pr and gh issue create, edit and comment), unless that text holds
   a $( or a backtick, which the shell runs even inside a message. Three checks:

   1. v0.1's pattern, widened to -R and to --recursive cut short (--rec, --r: rm takes any
      abbreviation of a long option), over each command's words joined with spaces. A string handed
      to any program (watch "rm -rf x", echo, a grep pattern) is judged as text this way.
   2. Where rm is the command's program (past wrappers and runners: timeout, env, xargs, npx and the
      rest), git's subcommand, or the program find -exec, -execdir, -ok or -okdir runs: any option
      before -- that asks for a recursive delete, wherever it sits. A short cluster holding r or R
      (-r, -R, -Rf, -fr), or a long option whose name is a prefix of recursive (--recursive, --rec,
      --r). So rm build -rf, rm -f -r, rm --force --recursive and git rm --cached -r are all one.
   3. The same pattern as 1 over every heredoc delimiter and body but the message one: a heredoc
      into bash runs its body.

   Each check reads a command once, so a line of any length is judged in time proportional to it. */

/** v0.1's pattern, widened: rm, then -r or -R in a cluster, --recursive, or --recursive cut short. */
const RM_TEXT = /\brm\s+(-[a-zA-Z]*[rR][a-zA-Z]*|--recursive|--r(?:e(?:c(?:u(?:r(?:s(?:i(?:v(?:e)?)?)?)?)?)?)?)?(?![A-Za-z]))/;

/** Whether one word is an option asking for a recursive delete: a short cluster holding r or R, or a long option whose name is a prefix of recursive. */
const recursive = (a) => {
  if (a.startsWith("--")) {
    const name = a.slice(2).split("=")[0];
    return a.startsWith("--recursive") || (name.length > 0 && "recursive".startsWith(name));
  }
  return a.length > 1 && a[0] === "-" && /[rR]/.test(a);
};

/** Whether any word from `from` on, before a --, is a recursive option. */
const recursiveFrom = (words, from) => {
  for (let i = from; i < words.length; i++) {
    if (words[i] === "--") return false;
    if (recursive(words[i])) return true;
  }
  return false;
};

/** Where git's subcommand sits, past git's own options and their values, from word `from`. */
const gitSubcommand = (words, from) => {
  let i = from;
  while (i < words.length && words[i].startsWith("-")) i += GIT_VALUE_OPTIONS.has(words[i]) ? 2 : 1;
  return i;
};

const EXEC = new Set(["-exec", "-execdir", "-ok", "-okdir"]);

/**
 * Whether a program find runs (-exec, -execdir, -ok, -okdir, up to its ; or +) is rm or git rm
 * with a recursive option before the ; or + or a --. Two passes from the right: rec[j] says a
 * recursive option sits at or after j before a terminator, and sub[j] where git's subcommand sits
 * when git's own options start at j, so each -exec is answered in one step.
 */
function findRunsRecursiveRm(rest) {
  const n = rest.length;
  const rec = new Array(n + 2).fill(false);
  for (let j = n - 1; j >= 0; j--) {
    const a = rest[j];
    rec[j] = a === ";" || a === "+" || a === "--" ? false : recursive(a) || rec[j + 1];
  }
  const sub = new Array(n + 2).fill(n);
  for (let j = n - 1; j >= 0; j--) sub[j] = rest[j].startsWith("-") ? sub[j + (GIT_VALUE_OPTIONS.has(rest[j]) ? 2 : 1)] : j;
  for (let i = 0; i + 1 < n; i++) {
    if (!EXEC.has(rest[i])) continue;
    const program = base(rest[i + 1]);
    if (program === "rm" && rec[i + 2]) return true;
    if (program === "git") { const s = sub[i + 2]; if (rest[s] === "rm" && rec[s + 1]) return true; }
  }
  return false;
}

/** Check 2: rm as the program, git rm, or rm or git rm run by find, with a recursive option anywhere before --. */
function deletesRecursively(words) {
  const { program, rest } = runOf(words);
  if (program === undefined) return false;
  const name = base(program);
  if (name === "rm") return recursiveFrom(rest, 0);
  if (name === "git") { const s = gitSubcommand(rest, 0); return rest[s] === "rm" && recursiveFrom(rest, s + 1); }
  if (name === "find") return findRunsRecursiveRm(rest);
  return false;
}

module.exports = {
  id: "G02",
  name: "recursive-delete",
  tier: "deny",
  reason: "recursive delete",
  test: ({ commands }) =>
    commands.some((words) => {
      const { words: judged, texts } = judgedOf(words);
      return RM_TEXT.test(judged.join(" ")) || deletesRecursively(words) || texts.some((text) => RM_TEXT.test(text));
    }),
};
