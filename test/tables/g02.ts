import os from "node:os";

/*
 * The G02 PR's table: G02 recursive-delete and G13 credential-directory judge commands, not the
 * line, as G16 has since R3. The same five sides as test/tables/r3.ts:
 *
 *   BLOCKED    v0.1 allows, now blocked: G02's misses (-R, options after the path, --recursive cut
 *              short, a quoted or escaped rm, git rm with -r anywhere, rm run by find -ok or a shell
 *              string) and G13's (home written as $HOME, ${HOME}, spelled out or ~user, a name split
 *              by quotes or a backslash). Listed in test/compare.test.ts as this PR's difference.
 *   LOOSENED   v0.1 blocks, now allowed: a block that became an allow, which CLAUDE.md says needs a
 *              test that says why. Jake's yes is his answers of 2026-10-20 (answers 1 and 2): the
 *              message text G16 skips, and a comment, are not commands. The row carries the reason
 *              v0.1 gave and the why.
 *   REWORDED   blocked by both, for a different reason: the row carries both and the why.
 *   UNCHANGED  blocked by both with the same reason: the anchors around the change. A delete or a
 *              credential path beside a message, a message holding $( or a backtick, a process
 *              substitution, a heredoc into cat or bash, the whole string a shell is given, message
 *              options R3 did not skip, -F files, --body-file paths and pathspecs are all still judged.
 *   ALLOWED    allowed by both: the lookalikes.
 *
 * The rows that spell the home folder out use os.homedir(), the folder the hook reads as
 * context.home when the test harness spawns it. Like every table, this one never shrinks.
 */
const HOME = os.homedir().replace(/\/+$/, "");
const DELETE = /^G02 recursive-delete: recursive delete$/;
const CREDENTIALS = /^G13 credential-directory: reading credential directories$/;

export const BLOCKED: [command: string, reason: RegExp][] = [
  // G02: -R, alone or in a cluster. v0.1 matched a lowercase r only.
  ["rm -R build", DELETE],
  ["rm -Rf build", DELETE],
  ["rm -fR build", DELETE],
  // G02: the recursive option anywhere before --, not only first. rm takes its options in any order.
  ["rm -f -r build", DELETE],
  ["rm -v -R build", DELETE],
  ["rm build -rf", DELETE],
  ["rm build/ -R", DELETE],
  ["rm --force --recursive build", DELETE],
  ["rm -f --recursive build", DELETE],
  // G02: --recursive cut short. rm takes any abbreviation of a long option, and --recursive is its only one starting with r.
  ["rm --recur build", DELETE],
  ["rm --rec build", DELETE],
  ["rm --r build", DELETE],
  // G02: rm quoted, escaped or by path is still rm.
  ['"rm" -rf build', DELETE],
  ["'rm' -R build", DELETE],
  ["r\\m -rf build", DELETE],
  ["/bin/rm -R build", DELETE],
  ["/usr/bin/rm build -r", DELETE],
  // G02: past a wrapper.
  ["timeout 5 rm -R build", DELETE],
  ["nice -n 5 rm build -r", DELETE],
  ["env -u NODE_ENV rm --rec build", DELETE],
  ["command rm -Rf build", DELETE],
  // G02: git rm with -r anywhere before --.
  ["git rm --cached -r lib", DELETE],
  ["git rm lib -r", DELETE],
  ["git -C packages/app rm -q -r lib", DELETE],
  // G02: inside a shell string, the command is judged on its own.
  ["bash -c 'rm -R build'", DELETE],
  ['bash -c "rm build -rf"', DELETE],
  ["sh -c 'timeout 5 rm --rec build'", DELETE],
  // G02: a string handed to another program, and a heredoc into bash, read with the pattern widened to -R.
  ['watch "rm -R build"', DELETE],
  ["bash <<'EOF'\nrm -R build\nEOF", DELETE],
  // G02: the rm or git rm find runs, -ok and -okdir included, which G04 does not name.
  ["find . -name x -exec git rm --cached -r {} +", DELETE],
  ["find . -okdir rm {} -R \\;", DELETE],
  ["find . -ok rm -R {} \\;", DELETE],
  // G13: home written as $HOME, ${HOME}, quoted, spelled out, or ~ with a user name.
  ["cat $HOME/.aws/credentials", CREDENTIALS],
  ["cat ${HOME}/.ssh/config", CREDENTIALS],
  ['cat "$HOME"/.netrc', CREDENTIALS],
  ['cat "${HOME}/.npmrc"', CREDENTIALS],
  [`cat ${HOME}/.aws/credentials`, CREDENTIALS],
  [`ls ${HOME}/.ssh`, CREDENTIALS],
  ["cat ~root/.aws/credentials", CREDENTIALS],
  ["ls ~jake/.ssh", CREDENTIALS],
  // G13: a name split by quotes or a backslash is one word to the shell, and now to the guard.
  ['cat ~/.a"ws"/credentials', CREDENTIALS],
  ["cat ~/.\\ssh/config", CREDENTIALS],
  // G13: inside a shell string, as an argument to any program, and in a heredoc.
  ["bash -c 'cat $HOME/.aws/config'", CREDENTIALS],
  ["cp $HOME/.npmrc npmrc.bak", CREDENTIALS],
  ["tar czf keys.tgz ${HOME}/.ssh", CREDENTIALS],
  ["cat <<EOF\n$HOME/.aws\nEOF", CREDENTIALS],
];

export const LOOSENED: [command: string, was: RegExp, why: string][] = [
  // G02: a commit message is text, in every spelling git takes, as R3 decided for G16.
  ['git commit -m "docs: say why rm -rf build is blocked"', /recursive delete/, "a commit message is text; G02 skips git commit -m now, as G16 has since R3"],
  ["git commit -am 'G02: rm -r in any spelling'", /recursive delete/, "-am is -a -m, so the next word is the message"],
  ["git commit -m'rm -rf build'", /recursive delete/, "the message attached to -m is the message"],
  ["git commit --message 'rm -rf build'", /recursive delete/, "--message is -m"],
  ["git commit --message='rm -rf build'", /recursive delete/, "--message= carries the message in the word"],
  ["git -C packages/app commit -q -m 'rm -rf build'", /recursive delete/, "git's own options before the subcommand take their values, and commit is still the subcommand"],
  ["timeout 60 git commit -m 'rm -rf build'", /recursive delete/, "the same past a wrapper"],
  ["git tag -a v1 -m 'rm -r'", /recursive delete/, "a tag message is text too"],
  // G02: a heredoc that only feeds the message is the message.
  ["git commit -q -F - <<'EOF'\nG02: rm -rf build is a recursive delete\nEOF", /recursive delete/, "a heredoc into git commit -F - is the message, and a quoted one expands nothing"],
  ["git commit --file=- <<EOF\nrm -rf build\nEOF", /recursive delete/, "--file=- is -F -, and an unquoted message with no $( or backtick in it runs nothing"],
  // G02: a pull request or issue title and body are text.
  ["gh pr create --title 'G02: rm -rf' --body 'rm -rf build stays blocked'", /recursive delete/, "a pull request title and body are text; gh pr create --title and --body are not judged"],
  ["gh pr create --title x --body-file - <<'EOF'\nrm -rf build stays blocked\nEOF", /recursive delete/, "a heredoc into gh --body-file - is the body"],
  ["gh pr edit 6 --body='rm -rf build'", /recursive delete/, "--body= carries the body in the word, on gh pr edit"],
  ["gh issue comment 3 --body 'rm -r build is still a delete'", /recursive delete/, "a comment on an issue is text, on gh issue comment"],
  // G02: a comment is not a command.
  ["ls # rm -rf build", /recursive delete/, "a comment is not a command; the shell never sees it, and neither does the guard"],
  ["npm test # then rm -rf build", /recursive delete/, "the same after another command"],
  // G02: a line break ends a command.
  ["echo rm\n-r build", /recursive delete/, "a line break ends a command, so rm and -r are in two commands and neither deletes; v0.1 read the line with the break collapsed to a space"],
  // G13: the same message text and comments.
  ["git commit -m 'deny Read(~/.aws/**) in the managed settings'", /reading credential directories/, "a commit message is text; G13 skips git commit -m now, as G16 has since R3"],
  ["git commit -F - <<'EOF'\nThe managed settings deny Read(~/.ssh/**).\nEOF", /reading credential directories/, "a heredoc into git commit -F - is the message"],
  ["git tag -a v2 -m 'no reads of ~/.npmrc'", /reading credential directories/, "a tag message is text too"],
  ["gh pr create --title 'Read denies' --body 'covers ~/.aws, ~/.ssh and ~/.netrc'", /reading credential directories/, "a pull request body is text"],
  ["ls # not ~/.aws", /reading credential directories/, "a comment is not a command"],
  // Both: a message naming a delete and a credential folder at once is still only a message.
  ['git commit -m "rm -rf ~/.aws is blocked twice"', /recursive delete/, "the message names a recursive delete and a credential folder, and neither rule reads message text now"],
];

export const REWORDED: [command: string, was: RegExp, now: RegExp, why: string][] = [
  ["echo build | xargs rm -R", /^xargs rm is a delete$/, DELETE, "G02 now judges the rm xargs runs by its options, -R included, and G02 runs before G04"],
  ["find . -name x -exec rm {} -R \\;", /^find -exec rm is a delete$/, DELETE, "G02 now judges the rm find -exec runs by its options wherever they sit, and G02 runs before G04"],
  ['git commit -m "rm -rf build, then git reset --hard"', /^recursive delete$/, /^G08 destructive-git: destructive git$/, "G02 no longer reads the message, and G08 still reads the whole line until its own follow-up pull request"],
  ['git commit -m "no rm -rf, no chmod 777"', /^recursive delete$/, /^G15 wide-chmod: wide chmod$/, "G02 no longer reads the message, and G15 still reads the whole line until its own follow-up pull request"],
];

export const UNCHANGED: [command: string, reason: RegExp][] = [
  // G02 as v0.1 had it.
  ["rm -rf build", /recursive delete/],
  ["rm --recursive build", /recursive delete/],
  ["git rm -rf --cached lib", /recursive delete/],
  // Beside a message, a delete is still a delete.
  ["git commit -m 'x' && rm -rf build", /recursive delete/],
  ["gh pr create --title x --body-file - <<'EOF' && rm -rf build\nbody\nEOF", /recursive delete/],
  // Message text the shell runs: a $( or a backtick in a message, an unquoted message heredoc holding one, and a process substitution, which the parser splits out as its own command.
  ['git commit -m "$(rm -rf build)"', /recursive delete/],
  ["git commit -m 'drop `rm -rf build`'", /recursive delete/],
  ["git commit -F - <<EOF\nnote $(rm -rf build)\nEOF", /recursive delete/],
  ["git commit -m <(rm -rf build)", /recursive delete/],
  // The whole string a shell is given is judged as text, so a message inside one is not skipped.
  ["bash -c 'git commit -m \"rm -rf build\"'", /recursive delete/],
  // Message options the PR does not skip, and text that is not a message.
  ["echo 'rm -rf build'", /recursive delete/],
  ["git merge -m 'rm -rf build' topic", /recursive delete/],
  ["git notes add -m 'rm -rf build'", /recursive delete/],
  ["git stash push -m 'rm -rf build'", /recursive delete/],
  ["gh pr review --body 'rm -rf build'", /recursive delete/],
  ["gh pr merge --body 'rm -rf build'", /recursive delete/],
  ["grep -n rm -r src", /recursive delete/],
  // Pathspecs are judged.
  ["git commit -m x -- rm -rf", /recursive delete/],
  // A heredoc into anything but a message is judged, and so is a heredoc into bash.
  ["cat <<'EOF'\nrm -rf build\nEOF", /recursive delete/],
  ["bash <<'EOF'\nrm -rf build\nEOF", /recursive delete/],
  // A string handed to another program, and the rm xargs or find runs.
  ['watch "rm -rf build"', /recursive delete/],
  ["find . -name x -exec rm -rf {} +", /recursive delete/],
  ["echo build | xargs rm -r", /recursive delete/],
  // G13 as v0.1 had it: a prefix, anywhere in a word.
  ["cat ~/.aws/credentials", /reading credential directories/],
  ["ls ~/.awsome", /reading credential directories/],
  ["cat <~/.netrc", /reading credential directories/],
  // Beside a message, in a shell string, in a heredoc, in text that is not a message, as a -F file or a --body-file path.
  ["git commit -m x && cat ~/.aws/credentials", /reading credential directories/],
  ["bash -c 'git commit -m \"see ~/.aws\"'", /reading credential directories/],
  ["echo '~/.ssh/config'", /reading credential directories/],
  ["cat <<'EOF'\nsee ~/.aws\nEOF", /reading credential directories/],
  ["git merge -m 'see ~/.aws' topic", /reading credential directories/],
  ["git commit -F ~/.aws/msg", /reading credential directories/],
  ["gh pr create --title x --body-file ~/.ssh/notes", /reading credential directories/],
  // A $( in a message is judged, and G10 comes first, as it did in v0.1.
  ['git commit -m "$(cat ~/.aws/credentials)"', /command substitution/],
];

export const ALLOWED: string[] = [
  // Deletes that are not recursive, and rm's lookalikes.
  "rm -- -r",
  "rm -f notes.txt",
  "rm -i notes.txt",
  "rm -d empty-dir",
  "rmdir -p build/a",
  "npm rm lodash",
  "git rm -q lib/x.js",
  "git rm --cached lib/x.js",
  "git rm -f lib/x.js",
  "rm notes.txt && ls -R",
  // -r and -R that belong to another program.
  "ls -R",
  "cp -R src dist",
  "git diff -R",
  "grep -rn rm src",
  "echo rm build -r",
  "git commit -m 'drop the -r from rm'",
  // Home folders that are not credential folders, and .aws inside the project.
  "cat ~/projects/notes.md",
  "echo $HOME",
  "ls $HOME/projects",
  "ls ${HOME}",
  "cat ~/.bashrc",
  "cat .aws/config",
  "cat docs/aws.md",
  "echo ~",
];
