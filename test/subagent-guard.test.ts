import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { CURRENT, agentCall, runSubagent, runSubagentParallel, tempEnv } from "./harness.ts";
import { CASES, PARALLEL, SEQUENCE, SETTINGS } from "./tables/subagent.ts";

/*
 * The subagent guard, run as Claude Code runs it: the tool call as JSON on stdin, exit 2 with a
 * reason on stderr to block, exit 0 to allow. It counts subagents in the system temp folder, so
 * every test here gets an empty one of its own. The table lives in test/tables/subagent.ts.
 */
describe("the subagent guard", () => {
  for (const [name, payload, env, exit] of CASES) {
    it(name, () => {
      const r = runSubagent(CURRENT.subagent, payload, tempEnv(env));
      assert.equal(r.code, exit, r.stderr);
    });
  }

  it("allows five subagents in one session, Sonnet and Opus together, and blocks the sixth", () => {
    const env = tempEnv(SETTINGS);
    const codes = SEQUENCE.models.map((model) => runSubagent(CURRENT.subagent, agentCall({ model }), env).code);
    assert.deepEqual(codes, SEQUENCE.codes);
    // A different session starts its own count.
    assert.equal(runSubagent(CURRENT.subagent, agentCall({ model: "opus" }, { session_id: "another-session" }), env).code, 0);
  });

  it("lets exactly five of eight parallel calls through", async () => {
    // Eight calls at once, as if the session asked for eight subagents in one message. The
    // processes cannot start closely enough to prove there is no race; the guarantee is the
    // "wx" flag in subagent-guard.js, which the operating system makes atomic.
    const env = tempEnv(SETTINGS);
    const payloads = Array.from({ length: PARALLEL.count }, (_, i) => agentCall({ model: i % 2 ? "opus" : "sonnet" }));
    const codes = await runSubagentParallel(CURRENT.subagent, payloads, env);
    assert.equal(codes.filter((c) => c === 0).length, PARALLEL.allowed);
  });
});
