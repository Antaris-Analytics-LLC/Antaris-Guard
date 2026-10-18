import os from "node:os";

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
 * commit, git tag, gh pr and gh issue. R3 also lets one read through: a reading program, or cp
 * with the path as a source, reading a file the user uploaded under the home uploads folder
 * ~/.claude/uploads. Like every table, it never shrinks.
 *
 * The uploads rows spell the home folder out with os.homedir(), the same folder the hook reads
 * from context.home when the test harness spawns it, so the absolute form is the hook's own home.
 */
const HOME = os.homedir().replace(/\/+$/, "");

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
  // A file the user uploaded under the home uploads folder, read by a reading program or copied as a source.
  ["cat ~/.claude/uploads/report.csv", /session's own rules/, "a reading program reading an uploaded file under the home uploads folder; the tilde form of home"],
  ['head -n 5 "$HOME/.claude/uploads/data.json"', /session's own rules/, "the $HOME form of home"],
  ["ls ${HOME}/.claude/uploads", /session's own rules/, "the folder itself, listed, and the ${HOME} form"],
  ["wc -l ~/.claude/uploads/notes.md", /session's own rules/, "wc is a reading program"],
  ["grep -n TODO ~/.claude/uploads/log.txt", /session's own rules/, "grep reading an upload, the pattern aside"],
  ["diff ~/.claude/uploads/a.txt ~/.claude/uploads/b.txt", /session's own rules/, "two uploads, both read by diff"],
  [`cat ${HOME}/.claude/uploads/report.csv`, /session's own rules/, "home spelled out, which the hook knows from context.home"],
  ["cp ~/.claude/uploads/input.txt ./work/", /session's own rules/, "cp with the upload as a source and a destination outside the folder"],
  ["cp -t ./work ~/.claude/uploads/a ~/.claude/uploads/b", /session's own rules/, "cp -t names the destination first, so both uploads are sources"],
  // R3 follow-up 3 keeps the wrappers: no assignment comes before the program, so the read stays a read. The merged round already allowed these.
  ["timeout 5 cat ~/.claude/uploads/report.csv", /session's own rules/, "a wrapper that sets no variable keeps the exemption, as the follow-up decided"],
  ["nice -n 10 head ~/.claude/uploads/report.csv", /session's own rules/, "the same with nice and its value"],
  // Second pass, answer 3: file without -C is still a read. The merged round already allowed it.
  ["file -b --mime-type ~/.claude/uploads/report.csv", /session's own rules/, "file without -C or --compile only reads, so its options keep the exemption"],
  // Second pass, answer 4: a line of plain reads keeps the exemption. The merged round already allowed these.
  ["cat ~/.claude/uploads/report.csv | head -n 5", /session's own rules/, "every command on the line is a reading program, a pipe between two of them included"],
  ["cp ~/.claude/uploads/report.csv ./work/report.csv && wc -l ./work/report.csv", /session's own rules/, "cp of an upload and a read of the copy are both plain reads"],
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
  // The uploads exemption forgives one read, nothing more; every write and every other .claude path stays blocked.
  ["cat ~/.claude/uploads/../settings.json", /session's own rules/],
  ["cat ~/.claude/settings.json", /session's own rules/],
  ["cat .claude/uploads/x", /session's own rules/],
  ["cat ~/.claude/uploadsX/secret", /session's own rules/],
  ["cp ~/data.txt ~/.claude/uploads/", /session's own rules/],
  ["cp ~/.claude/uploads/x ~/.claude/settings.json", /session's own rules/],
  ["cat ~/.claude/uploads/x ~/.claude/settings.json", /session's own rules/],
  ["cat ~/.claude/uploads/x > out.txt", /session's own rules/],
  ["cat ~/.claude/uploads/x 2>~/.claude/err", /session's own rules/],
  ["rm ~/.claude/uploads/x", /session's own rules/],
  ["mv ~/.claude/uploads/x ./", /session's own rules/],
  ["node ~/.claude/uploads/script.js", /session's own rules/],
  ["tee ~/.claude/uploads/x", /session's own rules/],
  // R3 follow-up 1. cp that makes links is not a read: the link it leaves in the project lets a later
  // plain write change the upload. Blocked by v0.1 too, since they name the folder; against the merged
  // R3, which let them through, these are new blocks.
  ["cp -l ~/.claude/uploads/report.csv ./report.csv", /session's own rules/],
  ["cp -s ~/.claude/uploads/report.csv ./report.csv", /session's own rules/],
  ["cp -rs ~/.claude/uploads ./uploads", /session's own rules/],
  ["cp -al ~/.claude/uploads/report.csv ./report.csv", /session's own rules/],
  ["cp --link ~/.claude/uploads/report.csv ./report.csv", /session's own rules/],
  ["cp --symbolic-link ~/.claude/uploads/report.csv ./report.csv", /session's own rules/],
  ["cp --sym ~/.claude/uploads/report.csv ./report.csv", /session's own rules/],
  ["cp --li ~/.claude/uploads/report.csv ./report.csv", /session's own rules/],
  ["cp ~/.claude/uploads/report.csv ./report.csv -s", /session's own rules/],
  ["cp -t ./work -l ~/.claude/uploads/report.csv", /session's own rules/],
  // R3 follow-up 2. rg, less and more are not reading programs for the uploads read: rg runs a program
  // on each file with --pre, --pre-glob and --hostname-bin, and the pagers write log files. Even a
  // plain rg, less or more of an upload blocks now.
  ["rg TODO ~/.claude/uploads/log.txt", /session's own rules/],
  ["rg --pre ./decode.sh TODO ~/.claude/uploads/log.txt", /session's own rules/],
  ["rg --pre=./decode.sh --pre-glob '*.gz' TODO ~/.claude/uploads/log.gz", /session's own rules/],
  ["rg --hostname-bin ./name TODO ~/.claude/uploads/log.txt", /session's own rules/],
  ["less ~/.claude/uploads/report.csv", /session's own rules/],
  ["less -o ./copy.csv ~/.claude/uploads/report.csv", /session's own rules/],
  ["less -O ./copy.csv ~/.claude/uploads/report.csv", /session's own rules/],
  ["less --LOG-FILE=./copy.csv ~/.claude/uploads/report.csv", /session's own rules/],
  ["more ~/.claude/uploads/report.csv", /session's own rules/],
  // R3 follow-up 3. An assignment before the program changes what it runs, so the command is not a plain
  // read: directly, through env, behind a wrapper, and even a harmless one. env with no assignment counts
  // too, since -S can carry one inside a word.
  ["LD_PRELOAD=./hook.so cat ~/.claude/uploads/report.csv", /session's own rules/],
  ["env LD_PRELOAD=./hook.so cat ~/.claude/uploads/report.csv", /session's own rules/],
  ["RIPGREP_CONFIG_PATH=./rg.conf grep TODO ~/.claude/uploads/log.txt", /session's own rules/],
  ["LESSOPEN='|./show %s' head ~/.claude/uploads/report.csv", /session's own rules/],
  ["timeout 5 env LD_PRELOAD=./hook.so cat ~/.claude/uploads/report.csv", /session's own rules/],
  ["nice -n 10 LD_PRELOAD=./hook.so cat ~/.claude/uploads/report.csv", /session's own rules/],
  ["LC_ALL=C grep TODO ~/.claude/uploads/log.txt", /session's own rules/],
  ["env cat ~/.claude/uploads/report.csv", /session's own rules/],
  ["env -S'LD_PRELOAD=./hook.so' cat ~/.claude/uploads/report.csv", /session's own rules/],
  // R3 follow-up, second pass, answer 3. file -C or --compile writes a compiled magic file, so it is not a read.
  ["file -C -m ~/.claude/uploads/magic", /session's own rules/],
  ["file --compile -m ~/.claude/uploads/magic", /session's own rules/],
  ["file -bC -m ~/.claude/uploads/magic", /session's own rules/],
  ["file --comp -m ~/.claude/uploads/magic", /session's own rules/],
  ["file -m ~/.claude/uploads/magic -C", /session's own rules/],
  // Second pass, answer 4. The read is let through only when every command on the line is a reading program
  // or cp with no assignment: an export, declare, set or source anywhere on the line, a command that is only
  // an assignment, and any other command beside the read turn it off for the whole line.
  ["export LD_PRELOAD=./hook.so; cat ~/.claude/uploads/report.csv", /session's own rules/],
  ["declare -x LD_PRELOAD=./hook.so; cat ~/.claude/uploads/report.csv", /session's own rules/],
  ["typeset -x LD_PRELOAD=./hook.so; cat ~/.claude/uploads/report.csv", /session's own rules/],
  ["set -a; cat ~/.claude/uploads/report.csv", /session's own rules/],
  ["source ./env.sh && cat ~/.claude/uploads/report.csv", /session's own rules/],
  [". ./env.sh; head ~/.claude/uploads/report.csv", /session's own rules/],
  ["X=1; cat ~/.claude/uploads/report.csv", /session's own rules/],
  ["cat ~/.claude/uploads/report.csv; LC_ALL=C grep TODO ./notes.txt", /session's own rules/],
  ["cd docs && cat ~/.claude/uploads/report.csv", /session's own rules/],
  ["cat ~/.claude/uploads/report.csv && echo done", /session's own rules/],
  ["cat ~/.claude/uploads/report.csv | sort", /session's own rules/],
  ["bash -c 'cat ~/.claude/uploads/report.csv'", /session's own rules/],
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
