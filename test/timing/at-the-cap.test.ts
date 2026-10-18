import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import path from "node:path";
import { INVENTARIS, ROOT } from "../harness.ts";

/*
 * The guard answers in time proportional to the line. Every shape here once took seconds or
 * minutes at the length cap, or is a cousin of one that did: a run of separators, one word of
 * great length, many git or node or cdk words, a regex tail that backtracked once per occurrence.
 * Each is judged at a quarter of the cap and at the cap; the time at the cap must stay under two
 * seconds, and must grow no faster than the line does (a floor of 25 ms keeps noise out of the
 * ratio). A quadratic shape would grow sixteen times between the two sizes and fail both.
 *
 * This file lives in test/timing/ and npm test runs it on its own, after the rest of the suite,
 * never beside other files: timed beside the table files, which spawn a hook process per case,
 * a 15 ms shape measured 163 ms on GitHub's runner and failed the growth check. Each size is
 * timed as the best of three runs, so one scheduling hiccup does not make a quadratic of a line.
 */
const require = createRequire(import.meta.url);
const { judge, MAX_COMMAND_LENGTH } = require(path.join(ROOT, "lib", "judge.js"));

const CAP = MAX_COMMAND_LENGTH;
const QUARTER = CAP / 4;
const LIMIT_MS = 2000;
const GROWTH = 6;
const FLOOR_MS = 25;
const RUNS = 3;
const DOLLAR_PAREN = "$" + "(";
const BACKTICK = String.fromCharCode(96);

/** `unit` repeated to fill `n` characters, between a prefix and a suffix; never longer than n. */
const fill = (n: number, unit: string, prefix = "", suffix = ""): string => prefix + unit.repeat(Math.floor((n - prefix.length - suffix.length) / unit.length)) + suffix;

export const SHAPES: Record<string, (n: number) => string> = {
  "ls then semicolons": (n) => fill(n, ";", "ls"),
  "x=a=a=a as one word": (n) => fill(n, "a=", "x="),
  "( repeated": (n) => fill(n, "("),
  "| repeated": (n) => fill(n, "|"),
  "x; repeated": (n) => fill(n, "x; "),
  "closed $(x) repeated": (n) => fill(n, `${DOLLAR_PAREN}x)`),
  "$( repeated inside single quotes": (n) => fill(n, DOLLAR_PAREN, "'", "'"),
  "$( repeated, never closed": (n) => fill(n, DOLLAR_PAREN),
  "backtick repeated, an even count": (n) => fill(n - (n % 2), BACKTICK),
  "backtick repeated, an odd count": (n) => fill(n - 1 - (n % 2), BACKTICK),
  "git repeated": (n) => fill(n, "git "),
  "git push repeated": (n) => fill(n, "git push "),
  "git -c repeated": (n) => fill(n, "git -c "),
  "cdk repeated": (n) => fill(n, "cdk "),
  "node repeated": (n) => fill(n, "node "),
  "node -e x repeated": (n) => fill(n, "node -e x "),
  "node then many -x": (n) => fill(n, "-x ", "node "),
  "find repeated": (n) => fill(n, "find "),
  "find=1 repeated": (n) => fill(n, "find=1 "),
  "xargs repeated": (n) => fill(n, "xargs "),
  "env repeated": (n) => fill(n, "env "),
  "npx repeated": (n) => fill(n, "npx "),
  "Remove-Item repeated": (n) => fill(n, "Remove-Item "),
  "Remove-Item x; repeated": (n) => fill(n, "Remove-Item x;"),
  "docker run repeated": (n) => fill(n, "docker run "),
  "docker run x; repeated": (n) => fill(n, "docker run x;"),
  "chromium repeated": (n) => fill(n, "chromium "),
  "AWS_SECRET_ACCESS_KEY repeated": (n) => fill(n, "AWS_SECRET_ACCESS_KEY "),
  "one long word": (n) => fill(n, "a"),
  "many short words": (n) => fill(n, "a "),
  "a=b prefixes then echo": (n) => fill(n, "a=b ", "", "echo"),
  "a=b prefixes then find -delete": (n) => fill(n, "a=b ", "", "find . -delete"),
  "semicolons then find -delete": (n) => fill(n, ";", "", "find . -delete"),
  "one long double-quoted word": (n) => fill(n, "a", '"', '"'),
  "backslashes": (n) => fill(n, "\\"),
  "rm with one long flag": (n) => fill(n, "a", "rm -"),
  "grep with many paths": (n) => fill(n, "y ", "grep x "),
  "a heredoc of many lines": (n) => fill(n, "x\n", "cat <<EOF\n", "EOF"),
  "many heredocs": (n) => { const k = Math.floor((n - 5) / 6); return `cat ${"<<a ".repeat(k)}\n${"a\n".repeat(k)}`; },
  "three shells deep, a long string": (n) => { const inner = "a ".repeat(Math.floor((n - 60) / 2)); return `bash -c "bash -c \\"bash -c \\\\\\"${inner}\\\\\\"\\""`; },
};

describe("judge() at the length cap", () => {
  /** The best of RUNS timings of one judgment, in milliseconds. */
  const time = (command: string): number => {
    let best = Infinity;
    for (let run = 0; run < RUNS; run++) {
      const t0 = process.hrtime.bigint();
      judge(command, INVENTARIS);
      best = Math.min(best, Number(process.hrtime.bigint() - t0) / 1e6);
    }
    return best;
  };

  for (const [name, shape] of Object.entries(SHAPES)) {
    it(`${name}: under ${LIMIT_MS} ms at the cap, and growing no faster than the line`, (t) => {
      const small = shape(QUARTER), large = shape(CAP);
      assert.ok(small.length <= QUARTER && large.length <= CAP, `${name}: ${small.length} and ${large.length} characters`);
      assert.ok(large.length > CAP - 64, `${name}: the shape does not reach the cap (${large.length})`);
      const quarter = time(small), cap = time(large);
      const verdict = judge(large, INVENTARIS);
      t.diagnostic(`${name}: ${quarter.toFixed(0)} ms at ${QUARTER}, ${cap.toFixed(0)} ms at ${CAP}, best of ${RUNS}, ${verdict.decision}${verdict.rule ? ` ${verdict.rule}` : ""}`);
      assert.ok(cap < LIMIT_MS, `${name}: ${cap.toFixed(0)} ms at the cap`);
      assert.ok(cap <= GROWTH * Math.max(quarter, FLOOR_MS), `${name}: ${quarter.toFixed(0)} ms at a quarter of the cap, ${cap.toFixed(0)} ms at the cap`);
    });
  }

  it("past the cap, every shape is G17 at once", () => {
    for (const [name, shape] of Object.entries(SHAPES)) {
      const t0 = process.hrtime.bigint();
      const v = judge(shape(CAP) + " ".repeat(64), INVENTARIS);
      const ms = Number(process.hrtime.bigint() - t0) / 1e6;
      assert.equal(v.rule, "G17", name);
      assert.match(v.reason, /^the command is too long to judge/, name);
      assert.ok(ms < 100, `${name}: ${ms.toFixed(0)} ms to refuse`);
    }
  });
});
