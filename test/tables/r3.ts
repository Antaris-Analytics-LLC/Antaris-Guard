/*
 * R3's table: every decision the round changed, and the lookalikes that it did not. The same five
 * sides as test/tables/r2.ts:
 *
 *   BLOCKED    v0.1 allows, R3 blocks: a new block, listed in test/compare.test.ts as this round's
 *              difference, with the rule's reason the row must carry.
 *   LOOSENED   v0.1 blocks, R3 allows: a block that became an allow, which CLAUDE.md says needs a
 *              test that says why. The row carries the reason v0.1 gave and the why. The same list,
 *              in the pull request, is the yes the round asked Jake for.
 *   REWORDED   blocked by both, for a different reason: the row carries both and the why.
 *   UNCHANGED  blocked by both with the same reason: the anchors around a change.
 *   ALLOWED    allowed by both: the lookalikes.
 *
 * R3 moves G16 from the line to the commands on it: every word of every command with the quotes
 * and backslashes removed, plus the delimiter and body of every heredoc a command is given. Not
 * judged, because none of it is a command or a path: a comment, and the message text of git
 * commit, git tag, gh pr and gh issue. Like every table, it never shrinks.
 */

export const BLOCKED: [command: string, reason: RegExp][] = [
  // A protected name split by quotes or a backslash is one word to the shell, and now to the guard. v0.1 read the line as written and saw no name.
  // The harness reads the reason up to the first closing bracket, which this reason has in its list of names.
  ['cat .cl"aude"/settings.json', /^G16 protected-path: the session's own rules \(\.claude\/, CLAUDE\.md, \.mcp\.json$/],
  ["cat .cl\\aude/settings.json", /session's own rules/],
  ["echo x > .cl'aude'/settings.json", /session's own rules/],
  ["ls .\\claude", /session's own rules/],
  ['head CLA"UDE.md"', /session's own rules/],
  ['cat .mcp".json"', /session's own rules/],
  // The same, inside a shell string: the string is one word with the quotes still in it, and the command inside it is judged on its own.
  [`bash -c 'cat .cl"aude"/settings.json'`, /session's own rules/],
];

export const LOOSENED: [command: string, was: RegExp, why: string][] = [
  // A commit message is text, not a path: git commit -m, in every spelling git takes, is not judged.
  ['git commit -m "docs: say in CLAUDE.md what the log proves"', /session's own rules/, "a commit message is text; git commit -m is not judged, and nothing else on the line names a protected path"],
  ["git commit -am 'the parser keeps heredoc bodies; see .claude/guard.config.json'", /session's own rules/, "-am is -a -m, so the next word is the message"],
  ["git commit -m'see CLAUDE.md'", /session's own rules/, "the message attached to -m is the message"],
  ["git commit --message 'see CLAUDE.md'", /session's own rules/, "--message is -m"],
  ["git commit --message='see CLAUDE.md'", /session's own rules/, "--message= carries the message in the word"],
  ["git commit -m CLAUDE.md", /session's own rules/, "a bare name as the message is still a message, not a pathspec: git commit names its paths after the options"],
  ["git -C packages/app commit -q -m 'see CLAUDE.md'", /session's own rules/, "git's own options before the subcommand take their values, and commit is still the subcommand"],
  ["timeout 60 git commit -m 'see CLAUDE.md'", /session's own rules/, "the same past a wrapper"],
  ["git tag -a v0.2.0 -m 'the log lands; see CLAUDE.md'", /session's own rules/, "a tag message is text too"],
  // A heredoc that only feeds the message is the message.
  ["git commit -q -F - <<'EOF'\nR3: the log\n\nSee CLAUDE.md for the session rule.\nEOF", /session's own rules/, "a heredoc into git commit -F - is the message; nothing else is given the body"],
  ["git commit --file=- <<EOF\nsee .claude/guard/\nEOF", /session's own rules/, "--file=- is -F -"],
  // A pull request or issue title and body are text.
  ["gh pr create --title 'R3: the decision log' --body 'The log sits under .claude/guard/; see CLAUDE.md'", /session's own rules/, "a pull request title and body are text; gh pr create --title and --body are not judged"],
  ["gh pr create -t 'see CLAUDE.md' -b 'and .claude/'", /session's own rules/, "-t and -b are --title and --body"],
  ["gh pr create --title 'R3: the decision log' --body-file - <<'EOF'\nThe log sits under .claude/guard/; see CLAUDE.md\nEOF", /session's own rules/, "a heredoc into gh --body-file - is the body"],
  ["gh pr edit 6 --body='see CLAUDE.md'", /session's own rules/, "--body= carries the body in the word, on gh pr edit"],
  ["gh pr comment 6 --body 'see CLAUDE.md'", /session's own rules/, "a comment on a pull request is text, on gh pr comment"],
  ["gh issue create --title 'CLAUDE.md names a rule the guard lacks' --body 'details'", /session's own rules/, "gh issue create takes the same two"],
  ["gh issue comment 3 --body-file - <<'EOF'\nsee .claude/\nEOF", /session's own rules/, "a heredoc into gh issue comment --body-file - is the body"],
  ["gh issue edit 3 -t 'see CLAUDE.md'", /session's own rules/, "gh issue edit -t is --title"],
  // A comment is not a command.
  ["ls # see CLAUDE.md", /session's own rules/, "a comment is not a command; the shell never sees it, and neither does the guard"],
  ["npm test # the table under .claude/ is the old one", /session's own rules/, "the same with a folder named in the comment"],
  // A name glued to another word by a quote is not that name once the quote is gone.
  ['echo x".claude"', /session's own rules/, "the word is x.claude once the quotes are gone, a file of that name, not the folder; v0.1 read the quote as a boundary in front of the name"],
];

export const REWORDED: [command: string, was: RegExp, now: RegExp, why: string][] = [
  ["npx playwright test # see CLAUDE.md", /session's own rules/, /browser automation is off in this repo/, "the comment is not judged, and what is left is G18's"],
];

export const UNCHANGED: [command: string, reason: RegExp][] = [
  // Everything about git commit and git tag but the message is judged: pathspecs, -F files, trailers.
  ["git commit -m 'x' CLAUDE.md", /session's own rules/],
  ["git commit -m 'x' -- .claude/settings.json", /session's own rules/],
  ["git commit -m 'x' .claude/", /session's own rules/],
  ["git commit -F .claude/msg", /session's own rules/],
  ["git commit --trailer 'See: CLAUDE.md'", /session's own rules/],
  ["git add .claude/settings.json && git commit -F - <<'EOF'\nmsg\nEOF", /session's own rules/],
  ["git tag -a v1 -F .claude/notes", /session's own rules/],
  // A heredoc into anything but a message is judged, and so is a delimiter.
  ["cat <<'EOF'\nsee .claude/settings.json\nEOF", /session's own rules/],
  ["cat <<EOF > .claude/settings.json\n{}\nEOF", /session's own rules/],
  ["tee .claude/guard.config.json <<EOF\n{}\nEOF", /session's own rules/],
  ["cat <<CLAUDE.md\nx\nCLAUDE.md", /session's own rules/],
  ["<<EOF\n.claude/settings.json\nEOF", /session's own rules/],
  ["gh pr create --title x --body-file - <<'EOF' && cat .claude/settings.json\nbody\nEOF", /session's own rules/],
  // Message options the round does not skip: other git subcommands, other gh subcommands, echo.
  ["echo 'see CLAUDE.md'", /session's own rules/],
  ["git merge -m 'see CLAUDE.md' topic", /session's own rules/],
  ["git notes add -m 'see CLAUDE.md'", /session's own rules/],
  ["git stash push -m 'see CLAUDE.md'", /session's own rules/],
  ["gh pr review --body 'see CLAUDE.md'", /session's own rules/],
  ["gh pr merge --body 'see CLAUDE.md'", /session's own rules/],
  ["gh pr create --body-file .claude/notes.md", /session's own rules/],
  // The whole string a shell is given is judged as text, so a message inside one is not skipped.
  ["bash -c 'git commit -m \"see CLAUDE.md\"'", /session's own rules/],
];

export const ALLOWED: string[] = [
  "git commit -m 'fix the parser'",
  "git commit -F - <<'EOF'\nR3: the log\nEOF",
  "git tag -a v0.2.0 -m 'R3'",
  "gh pr create --title 'R3: the decision log' --body 'the log, verify-log and the lock'",
  "grep -rn claude docs/",
  "git log --grep='the log' -- lib/log.js",
  "cat <<'EOF'\nsee the session rule\nEOF",
  "ls foo.claude",
  "ls # the parser",
];
