import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { CURRENT, defaultsProject, inventarisProject, runGuard } from "./harness.ts";
import { ALLOWED, ASKED, BLOCKED } from "./tables/r4.ts";

/*
 * R4's table through the real hook, under the built-in defaults, where G21 asks. The frozen side
 * of each row, what v0.1 did, is held in test/compare.test.ts. Under the worked example, which
 * turns G21 off, every asked row is a silent allow, as the v0.1 table needs.
 */
describe("R4's table, under the built-in defaults", () => {
  for (const [command, reason] of ASKED) {
    it(`asks: ${command}`, () => {
      const r = runGuard(CURRENT.guard, command, defaultsProject());
      assert.equal(r.decision, "ask", JSON.stringify(r));
      assert.match(r.reason, reason);
    });
  }

  for (const [command, reason] of BLOCKED) {
    it(`blocks: ${command}`, () => {
      const r = runGuard(CURRENT.guard, command, defaultsProject());
      assert.equal(r.decision, "deny", JSON.stringify(r));
      assert.match(r.reason, reason);
    });
  }

  for (const command of ALLOWED) {
    it(`allows, in silence: ${command}`, () => {
      const r = runGuard(CURRENT.guard, command, defaultsProject());
      assert.equal(r.decision, "allow", JSON.stringify(r));
    });
  }
});

describe("R4's asked rows under the worked example, which turns G21 off", () => {
  for (const [command] of ASKED) {
    it(`allows, in silence: ${command}`, () => {
      const r = runGuard(CURRENT.guard, command, inventarisProject());
      assert.equal(r.decision, "allow", JSON.stringify(r));
    });
  }
});
