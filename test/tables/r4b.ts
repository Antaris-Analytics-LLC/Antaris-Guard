/*
 * R4b's table: the round that makes the guard a plugin. Its one change to a rule is G16's, and the
 * table holds it with the same five sides as test/tables/r3.ts:
 *
 *   BLOCKED    v0.1 allows, R4b blocks: none this round.
 *   LOOSENED   v0.1 blocks, R4b allows: a block that became an allow, which CLAUDE.md says needs a
 *              test that says why. Jake's yes is his answer of 2026-10-19: the exact folder name
 *              .claude-plugin, where a plugin keeps its manifest and a marketplace its catalog, is
 *              not .claude.
 *   REWORDED   none this round.
 *   UNCHANGED  blocked by both with the same reason: every other name after .claude-, and a
 *              .claude-plugin that leads to .claude.
 *   ALLOWED    allowed by both: the lookalikes.
 *
 * The round's other change, a missing config file judged under the fallback config instead of
 * blocked, has no v0.1 side (v0.1 read no config), so it is held in test/config.test.ts and
 * test/plugin.test.ts. Like every table, this one never shrinks.
 */

export const BLOCKED: [command: string, reason: RegExp][] = [];

export const LOOSENED: [command: string, was: RegExp, why: string][] = [
  ["cat .claude-plugin/marketplace.json", /session's own rules/, "a plugin keeps its catalog in that folder, and its exact name is not the protected one"],
  ["git add .claude-plugin/marketplace.json", /session's own rules/, "staging the catalog by name, the same folder"],
  ["git diff -- .claude-plugin/", /session's own rules/, "a slash ends the name"],
  ["ls .claude-plugin", /session's own rules/, "the name at the end of the word"],
  ["cat plugins/guard/.claude-plugin/plugin.json", /session's own rules/, "a plugin's manifest folder below the root, after a slash"],
  ["git log --oneline -- .claude-plugin/marketplace.json docs/SPEC.md", /session's own rules/, "a pathspec naming the catalog beside another file"],
  ["echo 'see .claude-plugin'", /session's own rules/, "inside a quoted word, ending at the end of the word"],
  ["cat <<'EOF' > notes.md\nThe catalog sits in .claude-plugin/marketplace.json\nEOF", /session's own rules/, "a heredoc body is judged as text, where a slash ends the name"],
  ["bash -c 'cat .claude-plugin/marketplace.json'", /session's own rules/, "a shell string is judged as text first, then the command inside it, and the name is exact in both"],
  ["node bin/antaris-guard.js explain 'git add .claude-plugin/marketplace.json'", /session's own rules/, "explain given a command that names the folder"],
];

export const REWORDED: [command: string, was: RegExp, now: RegExp, why: string][] = [];

export const UNCHANGED: [command: string, reason: RegExp][] = [
  // Only the exact name: every other name after .claude- is still .claude.
  ["cat .claude-plugins/marketplace.json", /session's own rules/],
  ["cat .claude-plugin.json", /session's own rules/],
  ["ls .claude-pluginx", /session's own rules/],
  ["cat .claude-plugin:x", /session's own rules/],
  ["cat .claude-foo/settings.json", /session's own rules/],
  ["cat .claude-/x", /session's own rules/],
  // Exact means lowercase, as Claude Code spells the folder.
  ["cat .Claude-Plugin/marketplace.json", /session's own rules/],
  ["cat .CLAUDE-PLUGIN/marketplace.json", /session's own rules/],
  // A .claude-plugin that leads to .claude, or a line that names .claude beside it, is still .claude.
  ["cat .claude-plugin/../.claude/settings.json", /session's own rules/],
  ["cat .claude-plugin/marketplace.json .claude/settings.json", /session's own rules/],
  ["cp .claude-plugin/marketplace.json .claude/", /session's own rules/],
  ["ls {.claude-plugin,.claude}", /session's own rules/],
  ["echo x > .claude-plugin/../CLAUDE.md", /session's own rules/],
  ["bash -c 'cat .claude-plugin/x .claude/settings.json'", /session's own rules/],
  ["cat <<'EOF'\nsee .claude-plugins\nEOF", /session's own rules/],
];

export const ALLOWED: string[] = [
  "ls foo.claude-plugin",
  "grep -rn claude-plugin docs/",
];
