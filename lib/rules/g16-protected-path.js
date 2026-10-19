"use strict";
const { programOf, setting, base, GIT_VALUE_OPTIONS } = require("../parse");

/* G16: a shell command naming the session's own rules. .claude/, CLAUDE.md (and CLAUDE.local.md)
   and .mcp.json are always protected, exactly as v0.1 matched them: the config file lives under
   .claude/, so no config can unprotect the folder it sits in. The config's protectedPaths adds
   names on top; it cannot remove one. The rule is broad on purpose so no write slips through;
   reading one with the Read tool is fine.

   One read is let through: a file the user uploaded, which Claude Code puts under the home uploads
   folder ~/.claude/uploads. A reading program (cat, head and the rest below) given a path under
   that folder, or cp with such a path as a source, is allowed, so the session can look at what the
   user handed it. The path may be written ~/, $HOME/, ${HOME}/ or the home folder spelled out
   (the hook passes it as context.home; without it the spelled-out form is not recognized, which is
   the stricter choice). Nothing is written into the folder: a redirection anywhere in the command,
   or the folder as cp's destination, turns the exemption off, and a path with .. in it is never
   under the folder. cp that makes links is not a read either: -l, -s, a short cluster holding l
   or s (-rs), and --link or --symbolic-link (or any abbreviation of them) leave a link to the
   upload in the project, and a later plain write through it changes the upload, so none of them
   keeps the exemption. Nor is file -C or --compile (or a cluster holding C), which writes a
   compiled magic file. And the exemption applies only when every command on the line is a reading
   program or cp, with no assignment before its program, on its own or through env (LD_PRELOAD=,
   LESSOPEN=, RIPGREP_CONFIG_PATH=), since an assignment changes what the program runs. So an
   export, declare, set or source anywhere on the line, or any other command beside the read, turns
   it off for the whole line; wrappers such as timeout and nice keep it. What is left is anything
   set outside the line the guard judges, by an earlier tool call or a sourced file, the same class
   as a script file. Every other .claude path stays blocked, reads included.

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

   One name that starts with .claude is not .claude: the folder .claude-plugin, where a plugin keeps
   its manifest and a marketplace its catalog, which this repository has since it became a plugin
   (Jake, 2026-10-19). Only that exact name: lowercase, and ending at a slash or the end of the word,
   or at a space, a quote or a shell operator in a heredoc or shell string. .claude-plugins,
   .claude-plugin.json, .Claude-Plugin and every other name after .claude- stay blocked.

   The reason names the operator from the config, or "the operator" when the config does not. */

const BUILT_IN = [".claude/", "CLAUDE.md", ".mcp.json"];
const DOT_CLAUDE = /(^|[^\w.-])\.claude\b/gi;
const OTHER_BUILT_IN = /\bclaude(\.local)?\.md\b|(^|[^\w.-])\.mcp\.json\b/i;
const PLUGIN_FOLDER = /^\.claude-plugin(?=$|[/\s"'`;|&()<>])/;
/** Whether text names one of the three, each .claude in it checked on its own, so .claude-plugin/.claude still names .claude. */
const namesBuiltIn = (text) => {
  for (const m of text.matchAll(DOT_CLAUDE)) if (!PLUGIN_FOLDER.test(text.slice(m.index + m[1].length))) return true;
  return OTHER_BUILT_IN.test(text);
};

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

// Programs that read the files named on their line and change nothing, so a path under the uploads folder they are given is a read.
// rg, less and more are not on it: rg's --pre, --pre-glob and --hostname-bin run a program on each
// file, and RIPGREP_CONFIG_PATH can add one off the line; the pagers write log files (-o, -O,
// --LOG-FILE) and run LESSOPEN. cat, head, tail and grep do the same reading.
const READ_PROGRAMS = new Set(["cat", "head", "tail", "wc", "file", "stat", "ls", "grep", "diff", "cmp", "sha256sum", "md5sum", "od", "hexdump", "strings"]);
// The home uploads folder, under which a read is let through, after the home prefix is removed. The folder itself and anything beneath it.
const UPLOADS = /^\.claude\/uploads(\/|$)/;

/**
 * Whether a command is a plain read: its program, past wrappers such as timeout and nice, is a
 * reading program or cp, with no assignment and no env before it. An assignment changes what the
 * program runs (LD_PRELOAD=, LESSOPEN=, RIPGREP_CONFIG_PATH=); env counts whatever follows it,
 * since -S can carry an assignment inside one word. A command that is only an assignment, and
 * export, declare, typeset, set, source and . are not reading programs, so none of them is one.
 */
function isPlainRead(words) {
  const { program, rest } = programOf(words);
  if (program === undefined) return false;
  const offset = words.length - rest.length;
  for (let i = 0; i < offset - 1; i++) if (setting(words[i]) || base(words[i]) === "env") return false;
  const name = base(program);
  return READ_PROGRAMS.has(name) || name === "cp";
}

/** The index into `words` of each word the uploads exemption may let through: the paths a reading program is given, or cp's sources, and nothing when the command writes. */
function readableIndices(words) {
  const set = new Set();
  // A redirection anywhere, by any word carrying < or >, is a write the exemption does not cover.
  if (words.some((w) => /[<>]/.test(w))) return set;
  const { program, rest } = programOf(words);
  if (program === undefined) return set;
  const offset = words.length - rest.length;
  const name = base(program);
  if (READ_PROGRAMS.has(name)) {
    if (name === "file" && compiles(rest)) return set;
    for (let i = 0; i < rest.length; i++) set.add(offset + i);
    return set;
  }
  if (name === "cp") {
    if (makesLinks(rest)) return set;
    // Every positional but the destination is a source. -t/--target-directory names the destination and makes every positional a source; -S/--suffix takes a value.
    const positionals = [];
    let targetDir = false;
    for (let i = 0; i < rest.length; i++) {
      const a = rest[i];
      if (a === "--") { for (let j = i + 1; j < rest.length; j++) positionals.push(offset + j); break; }
      if (a === "-t" || a === "--target-directory") { targetDir = true; i++; continue; }
      if (a.startsWith("--target-directory=")) { targetDir = true; continue; }
      if (a === "-S" || a === "--suffix") { i++; continue; }
      if (a.startsWith("-") && a !== "-") continue;
      positionals.push(offset + i);
    }
    const sources = targetDir ? positionals : positionals.slice(0, -1);
    for (const idx of sources) set.add(idx);
  }
  return set;
}

/**
 * Whether any option before a -- is one of `short`, as a letter anywhere in a short cluster (a
 * value attached to another option counts too, which is the stricter reading), or one of the long
 * names in `long` or any abbreviation of one, which getopt accepts.
 */
function hasOption(rest, short, long) {
  for (const a of rest) {
    if (a === "--") return false;
    if (a.startsWith("--")) {
      const option = a.slice(2).split("=")[0];
      if (option && long.some((name) => name.startsWith(option))) return true;
      continue;
    }
    if (a.startsWith("-") && a.length > 1 && [...a.slice(1)].some((c) => short.includes(c))) return true;
  }
  return false;
}

/** Whether cp is asked to make links instead of copies: -l, -s, a cluster holding either (-rs, -al), --link, --symbolic-link. */
const makesLinks = (rest) => hasOption(rest, "ls", ["link", "symbolic-link"]);
/** Whether file is asked to compile a magic file, which writes one: -C, a cluster holding it, --compile. */
const compiles = (rest) => hasOption(rest, "C", ["compile"]);

/** Whether a word is a path at or under the home uploads folder, with no .. in it, by any way of naming home. */
function underUploads(word, home) {
  if (word.includes("..")) return false;
  const prefixes = ["~/", "$HOME/", "${HOME}/"];
  if (typeof home === "string" && home) prefixes.push(`${home.replace(/\/+$/, "")}/`);
  for (const p of prefixes) if (word.startsWith(p) && UPLOADS.test(word.slice(p.length))) return true;
  return false;
}

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
  test: ({ commands }, config, context = {}) => {
    const extra = added(config.protectedPaths);
    const addedRe = extra.length > 0 ? addedLine(extra) : null;
    const names = (text) => namesBuiltIn(text) || (addedRe !== null && addedRe.test(text));
    // The uploads read applies only when every command on the line is a plain read, so nothing set
    // earlier on the line (an export, a declare, a set, a sourced file) reaches the read.
    const plainReads = commands.every(isPlainRead);
    for (const words of commands) {
      const { skip, stdin } = messageOf(words);
      // A word under the home uploads folder, read by a reading program or copied as a source, is let
      // through, unless it also trips an added name: only the built-in .claude match is forgiven.
      const readable = plainReads ? readableIndices(words) : new Set();
      const exempt = (i) => readable.has(i) && underUploads(words[i], context.home) && !(addedRe !== null && addedRe.test(words[i]));
      for (let i = 0; i < words.length; i++) if (!skip.has(i) && names(words[i]) && !exempt(i)) return reasonFor(config);
      const heredocs = words.heredocs ?? [];
      for (const { delimiter, body } of heredocs) {
        if (names(delimiter)) return reasonFor(config);
        if (!(stdin && heredocs.length === 1) && names(body)) return reasonFor(config);
      }
    }
    return false;
  },
};
