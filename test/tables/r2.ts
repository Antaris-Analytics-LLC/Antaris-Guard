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
];

export const LOOSENED: [command: string, was: RegExp, why: string][] = [
  ['git commit -m "docs; find . -delete is now blocked"', /find -delete is a delete/, "a commit message is one word with the quotes removed; find is not run. v0.1 read the ; inside the quotes as a command start"],
  ['git commit -m "fix; node -e rmSync no longer runs"', /a delete inside inline code/, "the same: node is not run, and a delete word in a message is not a delete"],
  ["env foo find . -delete", /find -delete is a delete/, "env runs foo, and find is foo's argument; v0.1 skipped any words after env. A wrapper the guard does not know is foo"],
];

export const REWORDED: [command: string, was: RegExp, now: RegExp, why: string][] = [
  ["ls | xargs -I{} find {} -exec rm {} \\;", /xargs rm is a delete/, /find -exec rm is a delete/, "find is now seen through xargs, and the find checks run before the xargs one, as v0.1 ordered them"],
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
];
