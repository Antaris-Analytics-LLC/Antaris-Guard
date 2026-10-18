"use strict";

/* G16: any shell command naming the session's own rules. .claude/, CLAUDE.md (and CLAUDE.local.md)
   and .mcp.json are always protected, exactly as v0.1 matched them: the config file lives under
   .claude/, so no config can unprotect the folder it sits in. The config's protectedPaths adds
   names on top; it cannot remove one. The rule is broad on purpose so no write slips through;
   reading one with the Read tool is fine.

   An added name is matched the way v0.1 matched its three: as a whole name, case-insensitive,
   anywhere in the line; a name that starts with a dot needs a character before it that is not
   part of a path or a word, so foo.claude is not .claude but a/.claude is. A trailing slash marks
   a folder and is not part of the match.

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

module.exports = {
  id: "G16",
  name: "protected-path",
  tier: "deny",
  reason: "the session's own rules (.claude/, CLAUDE.md, .mcp.json) are changed by the operator, not by a session. Shell commands can't touch them; to look at one, open it with the Read tool",
  test: ({ line }, config) => {
    const extra = added(config.protectedPaths);
    if (BUILT_IN_LINE.test(line) || (extra.length > 0 && addedLine(extra).test(line))) return reasonFor(config);
    return false;
  },
};
