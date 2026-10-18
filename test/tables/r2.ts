import { createRequire } from "node:module";
import path from "node:path";
import { ROOT } from "../harness.ts";

/*
 * R2's table: every decision the round changed, and the lookalikes that it did not. Four sides:
 *
 *   BLOCKED    v0.1 allows, R2 blocks: a new block, listed in test/compare.test.ts as this round's
 *              difference, with the rule's reason the row must carry.
 *   LOOSENED   v0.1 blocks, R2 allows: a block that became an allow, which CLAUDE.md says needs a
 *              test that says why. The row carries the reason v0.1 gave and the why.
 *   REWORDED   blocked by both, for a different reason: the row carries both and the why.
 *   UNCHANGED  blocked by both with the same reason: the anchors around a change.
 *   ALLOWED    allowed by both: the lookalikes.
 *
 * Like every table, it never shrinks.
 */
const require = createRequire(import.meta.url);
const { MAX_COMMAND_LENGTH } = require(path.join(ROOT, "lib", "judge.js"));

/** A command of exactly `length` characters: echo and a run of a's. */
export const ofLength = (length: number): string => `echo ${"a".repeat(length - 5)}`;

// Spelled in parts so this file never carries them as text the shell hook would read.
const DOLLAR_PAREN = "$" + "(";
const BACKTICK = String.fromCharCode(96);

export const BLOCKED: [command: string, reason: RegExp][] = [
  // The length cap: a command one character past it is G17 before the parser sees it.
  [ofLength(MAX_COMMAND_LENGTH + 1), /^G17 unreadable: the command is too long to judge: 262145 characters; the guard reads at most 262144\. Put long content in a file with the Write tool$/],
  // G04 judged per command: find is the program past the wrappers, by path, and with its quotes removed.
  ["timeout 60 find . -delete", /^G04 find-or-xargs-delete: find -delete is a delete$/],
  ["nohup find packages/probe -type f -delete", /find -delete is a delete/],
  ["nice -n 10 find . -name '*.log' -exec rm {} \\;", /find -exec rm is a delete/],
  ["/usr/bin/find . -delete", /find -delete is a delete/],
  ["find . -name '*.tmp' '-delete'", /find -delete is a delete/],
  ["find . -type f -execdir 'rm' -f {} +", /find -exec rm is a delete/],
  // The wrappers R2 adds, each running find -delete.
  ["setsid find . -delete", /find -delete is a delete/],
  ["ionice -c 3 find . -delete", /find -delete is a delete/],
  ["chrt -i 0 find . -delete", /find -delete is a delete/],
  ["taskset -c 0 find . -delete", /find -delete is a delete/],
  ["flock /tmp/lock find . -delete", /find -delete is a delete/],
  ["flock -n /tmp/lock -c 'find . -delete'", /find -delete is a delete/],
  ["unbuffer find . -delete", /find -delete is a delete/],
  ["doas find . -delete", /find -delete is a delete/],
  ["busybox find . -delete", /find -delete is a delete/],
  ["doas busybox find . -delete", /find -delete is a delete/],
  // xargs runs its command; so do npx and npm exec after a --.
  ["echo . | xargs find -delete", /find -delete is a delete/],
  ["xargs -I{} find {} -delete", /find -delete is a delete/],
  ["npm exec -- find . -delete", /find -delete is a delete/],
  ["timeout 5 xargs rm", /xargs rm is a delete/],
  ["/usr/bin/xargs rm", /xargs rm is a delete/],
  // G03's first way, judged per command: an interpreter past a wrapper, with a code flag, and a delete word on the line.
  ["timeout 60 node -e 'console.log(1)' && echo rmSync", /^G03 delete-in-inline-code: a delete inside inline code is still a delete/],
  // The new wrappers reach the rules that already judged per command.
  ["doas cat .env", /^G12 reads-secret-file: reading a secret file$/],
  ["busybox cat .env", /reading a secret file/],
  ["unbuffer cat packages/app/.env.local", /reading a secret file/],
  ["setsid bash -c 'git push origin main'", /^G07 push-to-protected: direct push to main; open a PR instead$/],
  ["cat scripts/setup.txt | busybox sh", /^G11 pipe-into-interpreter: piping into an interpreter$/],
  ["cat scripts/setup.txt | doas bash", /piping into an interpreter/],
  // A shell string behind a runner is read as commands: xargs, npx and npm exec running bash -c, and the strings
  // npx -c, npx --call and npm exec -c hand to a shell. v0.1 never read these; the string was one word to it.
  ["echo x | xargs bash -c 'git push --force origin main'", /^G06 force-push: force push$/],
  ["echo x | xargs sh -c 'git push origin main'", /^G07 push-to-protected: direct push to main; open a PR instead$/],
  ["xargs -I{} sh -c 'git push origin main'", /direct push to main/],
  ["echo x | xargs bash -c 'npx cdk deploy'", /^aws-cdk-01 cdk-deploy-or-destroy: cdk deploy or destroy/],
  ["echo x | xargs sh -c 'cat .env'", /^G12 reads-secret-file: reading a secret file$/],
  ["npx bash -c 'git push origin main'", /direct push to main/],
  ["npm exec -- bash -c 'git push origin main'", /direct push to main/],
  ["npx -c 'git push origin main'", /direct push to main/],
  ["npx --call 'cat .env'", /reading a secret file/],
  ["npx --call='git push --force origin main'", /force push/],
  ["npm exec -c 'git push origin main'", /direct push to main/],
  ["npm exec --call 'cat .env'", /reading a secret file/],
  ["timeout 5 xargs bash -c 'git push origin main'", /direct push to main/],
  [`npx -c "echo 'oops"`, /^G17 unreadable: could not read the command: an unclosed quote$/],
  // An unclosed $( or backtick: the shell could not run the line, so the guard does not read it. v0.1 saw no closing ) or
  // second backtick, matched nothing, and let it through.
  [`echo ${DOLLAR_PAREN}`, /^G17 unreadable: could not read the command: an unclosed command substitution$/],
  [`echo ${DOLLAR_PAREN}date`, /an unclosed command substitution/],
  [`echo "${DOLLAR_PAREN}ls"`, /an unclosed command substitution/],
  [`echo ${DOLLAR_PAREN} ; echo ok`, /an unclosed command substitution/],
  [`bash -c 'echo ${DOLLAR_PAREN}'`, /an unclosed command substitution/],
  [`cat <<EOF\n${DOLLAR_PAREN}\nEOF`, /an unclosed command substitution/],
  [`echo ${BACKTICK}ls`, /^G17 unreadable: could not read the command: an unclosed backtick$/],
  [BACKTICK, /an unclosed backtick/],
  [`echo "${BACKTICK}"`, /an unclosed backtick/],
  [`cat <<EOF\n${BACKTICK}\nEOF`, /an unclosed backtick/],
];

export const LOOSENED: [command: string, was: RegExp, why: string][] = [
  ['git commit -m "docs; find . -delete is now blocked"', /find -delete is a delete/, "a commit message is one word with the quotes removed; find is not run. v0.1 read the ; inside the quotes as a command start"],
  ['git commit -m "fix; node -e rmSync no longer runs"', /a delete inside inline code/, "the same: node is not run, and a delete word in a message is not a delete"],
  ["env foo find . -delete", /find -delete is a delete/, "env runs foo, and find is foo's argument; v0.1 skipped any words after env. A wrapper the guard does not know is foo"],
  // G05 counts Remove-Item and -Recurse at the start of a word only, so the rule's own file name is not a delete.
  ["cat lib/rules/g05-remove-item-recurse.js", /recursive delete/, "a file named after Remove-Item -Recurse is not a delete; v0.1 matched the two words inside the name"],
  ["git add lib/rules/g05-remove-item-recurse.js", /recursive delete/, "the same file, staged"],
];

export const REWORDED: [command: string, was: RegExp, now: RegExp, why: string][] = [
  ["ls | xargs -I{} find {} -exec rm {} \\;", /xargs rm is a delete/, /find -exec rm is a delete/, "find is now seen through xargs, and the find checks run before the xargs one, as v0.1 ordered them"],
  // Still blocked, now for the real reason: the substitution is open, whatever a ) elsewhere on the line looked like to v0.1.
  [`echo ${DOLLAR_PAREN}')'`, /command substitution/, /an unclosed command substitution/, "the ) is inside quotes, so the substitution is still open; v0.1 saw a ) somewhere on the line"],
  [`echo ${DOLLAR_PAREN}ls # )`, /command substitution/, /an unclosed command substitution/, "the ) is in a comment, so the substitution is still open"],
  [`echo ${DOLLAR_PAREN}(1+2)`, /command substitution/, /an unclosed command substitution/, "arithmetic one ) short is still open; v0.1 saw a ) on the line"],
  [`echo ${BACKTICK}ls${BACKTICK} ${BACKTICK}date`, /command substitution/, /an unclosed backtick/, "three backticks leave one open; v0.1 saw a pair"],
];

export const UNCHANGED: [command: string, reason: RegExp][] = [
  ["npx find . -delete", /find -delete is a delete/],
  ["npm exec find -- . -delete", /find -delete is a delete/],
  ["CI=1 find . -delete", /find -delete is a delete/],
  ["env -u X find . -delete", /find -delete is a delete/],
  ["env X=1 find . -delete", /find -delete is a delete/],
  ["env nice find . -delete", /find -delete is a delete/],
  ["(find . -delete)", /find -delete is a delete/],
  ["ls; find . -delete", /find -delete is a delete/],
  ["find . -exec rm -rf {} +", /recursive delete/],
  ["xargs rm; find . -delete", /find -delete is a delete/],
  ["xargs -I{} sh -c 'rm {}'", /xargs rm is a delete/],
  ["ls | xargs -I{} find {} -name rm", /xargs rm is a delete/],
  ["node -e 'x' ; echo rmSync", /a delete inside inline code/],
  ["npx tsx -e 'x' && echo unlinkSync", /a delete inside inline code/],
  // Remove-Item -Recurse as a command, in either order and inside a pwsh string, is what it always was.
  ["Remove-Item -Recurse x", /recursive delete/],
  ["Remove-Item x -Recurse", /recursive delete/],
  ['pwsh -c "Remove-Item -Recurse x"', /recursive delete/],
  ["powershell -NoProfile -Command \"Remove-Item -Path out -Recurse -Force\"", /recursive delete/],
  // A closed substitution is what it always was, G10: arithmetic, a case statement's ) inside one, a body the shell expands.
  [`echo ${DOLLAR_PAREN}(1+2))`, /command substitution/],
  [`echo ${DOLLAR_PAREN}case x in a) echo a;; esac)`, /command substitution/],
  [`echo "${DOLLAR_PAREN}ls)"`, /command substitution/],
  [`echo '${DOLLAR_PAREN}ls)'`, /command substitution/],
  [`cat <<EOF\n${DOLLAR_PAREN}ls)\nEOF`, /command substitution/],
  [`echo ${BACKTICK}ls${BACKTICK}`, /command substitution/],
  [`echo ${DOLLAR_PAREN}echo ${BACKTICK}ls${BACKTICK})`, /command substitution/],
];

export const ALLOWED: string[] = [
  // Exactly at the cap: judged, and allowed.
  ofLength(MAX_COMMAND_LENGTH),
  // find and xargs doing something else, past the same wrappers.
  "timeout 60 find . -name '*.log'",
  "doas ls",
  "busybox ls -la",
  "setsid npm test",
  "flock /tmp/lock npm test",
  "echo . | xargs find -name '*.log'",
  "xargs -I{} find {} -newer package.json",
  "find . -name '*-delete*'",
  "find . -exec rmdir {} \\;",
  "grep -rn -- -delete lib",
  "echo xargs rm",
  "git commit -m 'flock, doas and busybox are wrappers now'",
  "git log --grep='find -delete'",
  "node scripts/report.js --exec-dir out",
  "ruby scripts/notes.rb -e",
  // The words of G05 mentioned, not run.
  "grep -rn Remove-Item lib/rules",
  "git log --oneline -- lib/rules",
  "echo Remove-Item",
  // A shell string behind a runner that does nothing the rules name, and a runner that runs no shell string.
  "xargs bash -c 'echo ok'",
  "ls | xargs sh",
  "echo x | xargs bash -c 'npm test'",
  "npx -c 'npm run build'",
  "npm exec -c 'ls -la'",
  "npx --call 'echo hi'",
  // $( and backticks that the shell does not expand: in single quotes, escaped, in a comment, in a quoted heredoc.
  `echo '${DOLLAR_PAREN}'`,
  `echo '${BACKTICK}'`,
  `echo \\$\\(`,
  `echo \\${BACKTICK}`,
  `echo "\\$("`,
  `echo "\\${BACKTICK}"`,
  `grep -n '\\$(' lib/parse.js`,
  `ls # ${DOLLAR_PAREN}`,
  `ls # ${BACKTICK}`,
  `cat <<'EOF'\n${DOLLAR_PAREN}\nEOF`,
  `cat <<"EOF"\n${BACKTICK}\nEOF`,
  `cat <<\\EOF\n${DOLLAR_PAREN}\nEOF`,
  `git commit -q -F - <<'EOF'\nThe guard now refuses an unclosed ${DOLLAR_PAREN} or backtick\nEOF`,
  "echo $ (ls)",
  "echo ')'",
];
