import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { CURRENT, ROOT, inventarisProject, logOf, runGuard, runGuardRaw } from "./harness.ts";
import { ALLOWED, BLOCKED, UNREADABLE_TOOL_CALL } from "./tables/bash.ts";

const require = createRequire(import.meta.url);
const { verify } = require(path.join(ROOT, "lib", "log.js"));

/*
 * The Bash guard, run as Claude Code runs it: the tool call as JSON on stdin, exit 2 with a
 * reason on stderr to block, exit 0 to allow. The table lives in test/tables/bash.ts and is the
 * one Inventaris tests its copy with. The assertions are v0.1's: a blocked case is blocked with a
 * reason that matches, an allowed case exits 0. The rule id at the front of the reason since R1
 * sits before the text each regex matches, so the table reads the new line unchanged.
 */
describe("the Bash guard", () => {
  for (const [command, reason] of BLOCKED) {
    it(`blocks: ${command}`, () => {
      const r = runGuard(CURRENT.guard, command);
      assert.equal(r.allowed, false, "expected a block, got allow");
      assert.match(r.reason, reason);
    });
  }

  for (const command of ALLOWED) {
    it(`allows: ${command}`, () => {
      const r = runGuard(CURRENT.guard, command);
      assert.equal(r.allowed, true, `blocked with: ${r.reason}`);
    });
  }

  it("blocks a tool call it cannot read", () => {
    const run = runGuardRaw(CURRENT.guard, UNREADABLE_TOOL_CALL.input);
    assert.equal(run.code, 2);
    assert.match(run.stderr, UNREADABLE_TOOL_CALL.reason);
  });

  it("never shrinks below the v0.1 table: 107 blocked, 58 allowed", () => {
    assert.ok(BLOCKED.length >= 107, `blocked table has ${BLOCKED.length} rows`);
    assert.ok(ALLOWED.length >= 58, `allowed table has ${ALLOWED.length} rows`);
  });

  it("names a rule on every block", () => {
    for (const [command] of BLOCKED) {
      const r = runGuard(CURRENT.guard, command);
      assert.match(r.reason, /^(G\d\d|aws-cdk-\d\d|docker-\d\d) [a-z-]+: /, `no rule id on: ${r.stderr}`);
    }
  });

  it("logged every run above into this file's project, in one chain that holds", () => {
    const file = logOf(inventarisProject());
    const verdict = verify(file);
    assert.equal(verdict.ok, true, JSON.stringify(verdict));
    assert.ok(verdict.lines >= BLOCKED.length * 2 + ALLOWED.length + 1, `${verdict.lines} lines`);
    assert.ok(!fs.existsSync(`${file}.lock`), "the lock was left behind");
  });
});
