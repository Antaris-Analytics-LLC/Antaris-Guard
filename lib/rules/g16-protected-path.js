"use strict";
const { programOf, base, GIT_VALUE_OPTIONS } = require("../parse");

/* G16: a shell command naming the session's own rules. .claude/, CLAUDE.md (and CLAUDE.local.md)
   and .mcp.json are always protected, exactly as v0.1 matched them: the config file lives under
   .claude/, so no config can unprotect the folder it sits in. The config's protectedPaths adds
   names on top; it cannot remove one. The rule is broad on purpose so no write slips through;
   reading one with the Read tool is fine.

   Since R3 the rule judges commands, not the line: every word of every command, shell strings
   included, with the quotes and backslashes removed (so .cl"aude" and .cl\aude are .claude), plus
   the delimiter and the body of every heredoc a command is given. What it does not judge, because
   none of it is a command or a path: a # comment; the message text of git commit and git tag
   (-m, --message, and a heredoc into -F - or --file -); the title and body of gh pr and gh issue
   create, edit and comment (--title, -t, --body, -b, and a heredoc into --body-file - or -F -). A
   pathspec, a -F file, a --body-file path and a heredoc into anything else are judged, and so is
   the whole string a shell is given, as text, before the commands inside it are judged on their own.

   A name is matched the way v0.1 matched its three: whole, case-insensitive, anywhere in the word;
   a name that starts with a dot needs a character before it that is not part of a path or a word,
   so foo.claude is not .claude but a/.claude is. A trailing slash on a configured name marks a
   folder and is not part of the match.

   The reason names the operator from the config, or "the operator" when the config does not. */

const BUILT_IN = [".claude/", "CLAUDE.md", ".mcp.json"];
const BUILT_IN_LINE = /(^|[^\w.-])\.claude\b|\bclaude(\.local)?\.md\b|(^|[^\w.-])\.mcp\.json\b/i;

const escape = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const nameOf = (p) => p.replace(/\/+$/, "");
const isBuiltIn = (p) => BUILT_IN.some((b) => nameOf(b).toLowerCase() === nameOf(p).toLowerCase());

/** The names the config adds beyond the three, in its order, each once. */
const added = (paths) => paths.filter((p, i) => !isBuiltIn(p) && paths.findIndex((q) => nameOf(q).toLowerCase() === nameOf(p).toLowerCase()) === i);

/** One regex for every added name. */
const addedLine = (paths) =>
  new RegExp(paths.map((p) => { const n = nameOf(p); return `${n.startsWith(".") ? "(^|[^\\w.-])" : "(^|[^A-Za-z0-9_])"}${escape(n)}(?![A-Za-z0-9_])`; }).join("|"), "i");

const reasonFor = (config) => {
  const names = [...BUILT_IN, ...added(config.protectedPaths)].join(", ");
  return `the session's own rules (${names}) are changed by ${config.operator ?? "the operator"}, not by a session. Shell commands can't touch them; to look at one, open it with the Read tool`;
};

// The git subcommands whose message is skipped, each with the short options other than -m that take a value, so -F x is a file and -cm is -c with the value m.
const GIT_MESSAGE = { commit: "CcFt", tag: "uF" };
// The gh subcommands whose title and body are skipped.
const GH_MESSAGE = { pr: ["create", "edit", "comment"], issue: ["create", "edit", "comment"] };
const GH_TEXT = new Set(["--title", "-t", "--body", "-b"]);

/**
 * What a command gives as message text: the indices of the words to skip, and whether its
 * standard input is the message too (git commit -F -, gh pr create --body-file -), in which case
 * the one heredoc feeding it is skipped as well. Everything else about the command is judged.
 */
function messageOf(words) {
  const skip = new Set();
  let stdin = false;
  const { program, rest } = programOf(words);
  if (program === undefined) return { skip, stdin };
  const offset = words.length - rest.length;
  const name = base(program);
  if (name === "git") {
    let i = 0;
    while (i < rest.length && rest[i].startsWith("-")) i += GIT_VALUE_OPTIONS.has(rest[i]) ? 2 : 1;
    if (!Object.hasOwn(GIT_MESSAGE, rest[i])) return { skip, stdin };
    const values = GIT_MESSAGE[rest[i]];
    for (let j = i + 1; j < rest.length; j++) {
      const a = rest[j];
      if (a === "--") break;
      if (a === "-m" || a === "--message") { if (j + 1 < rest.length) skip.add(offset + ++j); continue; }
      if (a.startsWith("--message=")) { skip.add(offset + j); continue; }
      if (a === "-F" || a === "--file") { if (rest[j + 1] === "-") stdin = true; j++; continue; }
      if (a === "--file=-") { stdin = true; continue; }
      if (a.startsWith("--") || !a.startsWith("-")) continue;
      // A cluster of short options: -am x and -qm x take the next word, -mx and -amx carry the message in the word.
      for (let k = 1; k < a.length; k++) {
        const c = a[k];
        if (c === "m") { if (k + 1 < a.length) skip.add(offset + j); else if (j + 1 < rest.length) skip.add(offset + ++j); break; }
        if (values.includes(c)) { if (k + 1 === a.length) j++; break; }
      }
    }
  } else if (name === "gh" && Object.hasOwn(GH_MESSAGE, rest[0]) && GH_MESSAGE[rest[0]].includes(rest[1])) {
    for (let j = 2; j < rest.length; j++) {
      const a = rest[j];
      if (a === "--") break;
      if (GH_TEXT.has(a)) { if (j + 1 < rest.length) skip.add(offset + ++j); continue; }
      if (/^(--title|--body|-t|-b)=/.test(a) || /^-[tb][^=]/.test(a)) { skip.add(offset + j); continue; }
      if (a === "--body-file" || a === "-F") { if (rest[j + 1] === "-") stdin = true; j++; continue; }
      if (a === "--body-file=-" || a === "-F-") { stdin = true; continue; }
    }
  }
  return { skip, stdin };
}

module.exports = {
  id: "G16",
  name: "protected-path",
  tier: "deny",
  reason: "the session's own rules (.claude/, CLAUDE.md, .mcp.json) are changed by the operator, not by a session. Shell commands can't touch them; to look at one, open it with the Read tool",
  test: ({ commands }, config) => {
    const extra = added(config.protectedPaths);
    const addedRe = extra.length > 0 ? addedLine(extra) : null;
    const names = (text) => BUILT_IN_LINE.test(text) || (addedRe !== null && addedRe.test(text));
    for (const words of commands) {
      const { skip, stdin } = messageOf(words);
      for (let i = 0; i < words.length; i++) if (!skip.has(i) && names(words[i])) return reasonFor(config);
      const heredocs = words.heredocs ?? [];
      for (const { delimiter, body } of heredocs) {
        if (names(delimiter)) return reasonFor(config);
        if (!(stdin && heredocs.length === 1) && names(body)) return reasonFor(config);
      }
    }
    return false;
  },
};
