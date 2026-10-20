import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { CURRENT, runGuard } from "./harness.ts";
import { ALLOWED, BLOCKED, LOOSENED, REWORDED, UNCHANGED } from "./tables/g02.ts";

/*
 * The G02 PR's table through the real hook: process in, stderr out. The frozen side of each row
 * (what v0.1 did) is held in test/compare.test.ts; this file holds what the current guard does.
 */
describe("the G02 PR's table", () => {
  for (const [command, reason] of BLOCKED) {
    it(`blocks: ${command.slice(0, 80)}`, () => {
      const r = runGuard(CURRENT.guard, command);
      assert.equal(r.decision, "deny", `expected a block, got ${r.decision}`);
      assert.match(r.reason, reason, r.stderr.slice(0, 300));
    });
  }

  for (const [command, , why] of LOOSENED) {
    it(`allows, since ${why.split(/[,;]/)[0]}: ${command.slice(0, 80)}`, () => {
      const r = runGuard(CURRENT.guard, command);
      assert.equal(r.decision, "allow", `not allowed in silence: ${r.stderr}${r.stdout}`);
    });
  }

  for (const [command, , now, why] of REWORDED) {
    it(`blocks with a new reason, since ${why.split(",")[0]}: ${command}`, () => {
      const r = runGuard(CURRENT.guard, command);
      assert.equal(r.decision, "deny", `expected a block, got ${r.decision}`);
      assert.match(r.reason, now, r.stderr);
    });
  }

  for (const [command, reason] of UNCHANGED) {
    it(`still blocks: ${command.slice(0, 80)}`, () => {
      const r = runGuard(CURRENT.guard, command);
      assert.equal(r.decision, "deny", `expected a block, got ${r.decision}`);
      assert.match(r.reason, reason, r.stderr);
    });
  }

  for (const command of ALLOWED) {
    it(`allows: ${command.slice(0, 80)}`, () => {
      const r = runGuard(CURRENT.guard, command);
      assert.equal(r.decision, "allow", `not allowed in silence: ${r.stderr.slice(0, 200)}`);
    });
  }

  it("names a rule on every block", () => {
    for (const [command] of [...BLOCKED, ...REWORDED, ...UNCHANGED]) {
      const r = runGuard(CURRENT.guard, command);
      assert.match(r.reason, /^(G\d\d|aws-cdk-\d\d|docker-\d\d) [a-z-]+: /, `no rule id on: ${r.stderr.slice(0, 200)}`);
    }
  });
});
