import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { CURRENT, runGuard } from "../harness.ts";
import { ALLOWED, BLOCKED } from "../tables/g18.ts";

/*
 * G18 browser-automation, through the real hook: process in, stderr out. Every blocked case must
 * carry G18's id, so a block by some other rule does not pass for it, and must give the reason the
 * table names, which is how each route (program, package, inline code, variable, flag, path) is
 * proved on its own. The table lives in test/tables/g18.ts.
 */
describe("G18 browser-automation", () => {
  for (const [command, reason] of BLOCKED) {
    it(`blocks: ${command}`, () => {
      const r = runGuard(CURRENT.guard, command);
      assert.equal(r.allowed, false, "expected a block, got allow");
      assert.match(r.reason, /^G18 browser-automation: browser automation is off in this repo: /, `blocked by something other than G18: ${r.stderr}`);
      assert.match(r.reason, reason);
      assert.match(r.stderr, /; say what was blocked and stop\): /);
    });
  }

  for (const command of ALLOWED) {
    it(`allows: ${command}`, () => {
      const r = runGuard(CURRENT.guard, command);
      assert.equal(r.allowed, true, `blocked with: ${r.reason}`);
    });
  }

  it("has the table the roadmap asks for: twenty or more blocked, ten or more allowed", () => {
    assert.ok(BLOCKED.length >= 20, `blocked table has ${BLOCKED.length} rows`);
    assert.ok(ALLOWED.length >= 10, `allowed table has ${ALLOWED.length} rows`);
  });
});
