/*
 * R4's table: the third answer. It runs under the built-in defaults, where G21 asks; the worked
 * example, configs/inventaris.json, turns G21 off, and the v0.1 table runs under that unchanged.
 *
 *   ASKED      v0.1 allows, R4 asks: a new ask, listed in test/compare.test.ts as this round's
 *              difference, with the rule's reason the row must carry.
 *   BLOCKED    blocked by both, the same reason: a deny on the same line wins over the ask.
 *   ALLOWED    allowed by both, silent: the lookalikes.
 *
 * The first five ASKED rows are the v0.1 table's branch pushes, which the worked example keeps
 * allowed. Like every table, it never shrinks.
 */

export const ASKED: [command: string, reason: RegExp][] = [
  // The v0.1 table's five pushes to a branch.
  ["git push -u origin m1/x", /^G21 push-to-branch: a push leaves the machine; confirm it$/],
  ["git push -u origin m1/calendar-screen-2; git log --oneline origin/main..HEAD", /^G21 push-to-branch: /],
  ["git push origin m1/main-docs", /^G21 push-to-branch: /],
  ["git push origin m1/x && rm -f notes.txt", /^G21 push-to-branch: /],
  ["git push origin m1/x 2>&1 | tail -2", /^G21 push-to-branch: /],
  // A push with no branch named, behind a wrapper, by path, in a shell string, and a tag.
  ["git push", /^G21 push-to-branch: /],
  ["timeout 60 git push -u origin r4/ask", /^G21 push-to-branch: /],
  ["/usr/bin/git -C packages/app push origin m1/x", /^G21 push-to-branch: /],
  ["bash -c 'git push origin m1/x'", /^G21 push-to-branch: /],
  ["git push origin v0.2.0", /^G21 push-to-branch: /],
];

export const BLOCKED: [command: string, reason: RegExp][] = [
  // A deny on the same line wins over the ask, whichever comes first.
  ["git push origin main", /^G07 push-to-protected: direct push to main; open a PR instead$/],
  ["git push --force origin m1/x", /^G06 force-push: force push$/],
  ["git push origin m1/x && git push origin main", /^G07 push-to-protected: /],
  ["git push origin m1/x && rm -rf build", /^G02 recursive-delete: recursive delete$/],
];

export const ALLOWED: string[] = [
  "git status --short",
  "git log --oneline origin/main..HEAD",
  "git fetch origin main",
  "git pull --ff-only",
  "git commit -m 'git push origin m1/x'",
  "echo 'git push -u origin m1/x'",
  "grep -rn 'git push' docs",
];
