import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fs from "node:fs";
import { CURRENT, FROZEN, agentCall, runGuard, runGuardRaw, runSubagent, runSubagentParallel, stripId, tempEnv } from "./harness.ts";
import * as bash from "./tables/bash.ts";
import * as g18 from "./tables/g18.ts";
import * as r2 from "./tables/r2.ts";
import * as r3 from "./tables/r3.ts";
import * as subagent from "./tables/subagent.ts";

/*
 * Every case in every table, through the frozen v0.1 hooks under bench/versions/v0.1/ and the
 * current ones, side by side. The decision must be the same and the stderr line must be the same
 * once the rule id and name are stripped from the current one. The only differences allowed are
 * the ones a round lists as new behavior: in R1, the blocked side of G18's table, where v0.1
 * allows and the current guard denies; in R2 and R3, the BLOCKED side of the round's table (the
 * same shape), its LOOSENED side, where v0.1 denies and the current guard allows, each row saying
 * why, and its REWORDED side, where both deny for different reasons. Those are asserted as exactly
 * that, not skipped, so a row that stops being a difference (or starts being one for another
 * reason) is caught too. The current hook runs under configs/inventaris.json, which the harness
 * arranges; v0.1 has no config to read.
 */

type Round = { BLOCKED: [string, RegExp][]; LOOSENED: [string, RegExp, string][]; REWORDED: [string, RegExp, RegExp, string][]; UNCHANGED: [string, RegExp][]; ALLOWED: string[] };
const ROUNDS: [name: string, table: Round][] = [["R2", r2], ["R3", r3]];

// SHA-256 of the two files at main fdf0a2e. A frozen copy that drifts fails here before anything else runs.
const FROZEN_SHA256 = {
  guard: "04e6f11ffad7604acf5ba65abafabf83f0e10402ed5de0641f57923d4ab8cb39",
  subagent: "0be009426f0d0c4d38eab19c036b9ddb2ecb4736fff0aedb033b00c07554c05d",
};
const sha256 = (file: string): string => createHash("sha256").update(fs.readFileSync(file)).digest("hex");

describe("the frozen v0.1 hooks", () => {
  it("are byte for byte the files at main fdf0a2e", () => {
    assert.equal(sha256(FROZEN.guard), FROZEN_SHA256.guard, "bench/versions/v0.1/guard.js has changed");
    assert.equal(sha256(FROZEN.subagent), FROZEN_SHA256.subagent, "bench/versions/v0.1/subagent-guard.js has changed");
  });
});

describe("compare: the v0.1 Bash table through v0.1 and the current guard", () => {
  for (const [command] of bash.BLOCKED) {
    it(`same block: ${command}`, () => {
      const was = runGuard(FROZEN.guard, command), now = runGuard(CURRENT.guard, command);
      assert.equal(was.code, 2, `v0.1 did not block: ${was.stderr}`);
      assert.equal(now.code, 2, `the current guard did not block: ${now.stderr}`);
      assert.equal(stripId(now.stderr), was.stderr);
      assert.notEqual(stripId(now.stderr), now.stderr, "the current line carries no rule id");
    });
  }

  for (const command of bash.ALLOWED) {
    it(`same allow: ${command}`, () => {
      const was = runGuard(FROZEN.guard, command), now = runGuard(CURRENT.guard, command);
      assert.equal(was.code, 0, `v0.1 blocked: ${was.stderr}`);
      assert.equal(now.code, 0, `the current guard blocked: ${now.stderr}`);
      assert.equal(was.stderr, "");
      assert.equal(now.stderr, "");
    });
  }

  it("same block: a tool call that is not JSON", () => {
    const was = runGuardRaw(FROZEN.guard, bash.UNREADABLE_TOOL_CALL.input), now = runGuardRaw(CURRENT.guard, bash.UNREADABLE_TOOL_CALL.input);
    assert.equal(was.code, 2);
    assert.equal(now.code, 2);
    assert.equal(stripId(now.stderr), was.stderr);
  });
});

describe("compare: G18's table, R1's listed difference", () => {
  for (const [command] of g18.BLOCKED) {
    it(`new block in R1: ${command}`, () => {
      const was = runGuard(FROZEN.guard, command), now = runGuard(CURRENT.guard, command);
      assert.equal(was.code, 0, `v0.1 already blocked this, so it is not new behavior: ${was.stderr}`);
      assert.equal(now.code, 2, `the current guard did not block: ${now.stderr}`);
      assert.match(now.reason, /^G18 browser-automation: /, `blocked by something other than G18: ${now.stderr}`);
    });
  }

  for (const command of g18.ALLOWED) {
    it(`same allow: ${command}`, () => {
      const was = runGuard(FROZEN.guard, command), now = runGuard(CURRENT.guard, command);
      assert.equal(was.code, 0, `v0.1 blocked: ${was.stderr}`);
      assert.equal(now.code, 0, `the current guard blocked: ${now.stderr}`);
    });
  }
});

for (const [round, table] of ROUNDS) {
  describe(`compare: ${round}'s table, ${round}'s listed differences`, () => {
    for (const [command, reason] of table.BLOCKED) {
      it(`new block in ${round}: ${command.slice(0, 80)}`, () => {
        const was = runGuard(FROZEN.guard, command), now = runGuard(CURRENT.guard, command);
        assert.equal(was.code, 0, `v0.1 already blocked this, so it is not new behavior: ${was.stderr.slice(0, 300)}`);
        assert.equal(now.code, 2, `the current guard did not block: ${now.stderr.slice(0, 300)}`);
        assert.match(now.reason, reason, now.stderr.slice(0, 300));
      });
    }

    for (const [command, was, why] of table.LOOSENED) {
      it(`new allow in ${round}, since ${why.split(/[.;]/)[0]}: ${command.slice(0, 80)}`, () => {
        const before = runGuard(FROZEN.guard, command), now = runGuard(CURRENT.guard, command);
        assert.equal(before.code, 2, `v0.1 allowed this, so it is not a loosening: ${before.stderr}`);
        assert.match(before.reason, was, `v0.1 blocked it for another reason: ${before.stderr}`);
        assert.equal(now.code, 0, `the current guard still blocks: ${now.stderr}`);
      });
    }

    for (const [command, was, now, why] of table.REWORDED) {
      it(`same block, new reason in ${round}, since ${why.split(",")[0]}: ${command}`, () => {
        const before = runGuard(FROZEN.guard, command), after = runGuard(CURRENT.guard, command);
        assert.equal(before.code, 2, `v0.1 did not block: ${before.stderr}`);
        assert.equal(after.code, 2, `the current guard did not block: ${after.stderr}`);
        assert.match(before.reason, was, `v0.1 gave another reason: ${before.stderr}`);
        assert.match(after.reason, now, `the current guard gave another reason: ${after.stderr}`);
        assert.notEqual(stripId(after.stderr), before.stderr, "the reason did not change, so this row belongs in UNCHANGED");
      });
    }

    for (const [command] of table.UNCHANGED) {
      it(`same block: ${command.slice(0, 80)}`, () => {
        const was = runGuard(FROZEN.guard, command), now = runGuard(CURRENT.guard, command);
        assert.equal(was.code, 2, `v0.1 did not block: ${was.stderr}`);
        assert.equal(now.code, 2, `the current guard did not block: ${now.stderr}`);
        assert.equal(stripId(now.stderr), was.stderr);
      });
    }

    for (const command of table.ALLOWED) {
      it(`same allow: ${command.slice(0, 80)}`, () => {
        const was = runGuard(FROZEN.guard, command), now = runGuard(CURRENT.guard, command);
        assert.equal(was.code, 0, `v0.1 blocked: ${was.stderr.slice(0, 300)}`);
        assert.equal(now.code, 0, `the current guard blocked: ${now.stderr.slice(0, 300)}`);
      });
    }
  });
}

describe("compare: the subagent table through v0.1 and the current hook", () => {
  for (const [name, payload, env, exit] of subagent.CASES) {
    it(`same decision: ${name}`, () => {
      const was = runSubagent(FROZEN.subagent, payload, tempEnv(env)), now = runSubagent(CURRENT.subagent, payload, tempEnv(env));
      assert.equal(now.code, exit, now.stderr);
      assert.equal(now.code, was.code);
      assert.equal(now.stderr, was.stderr);
    });
  }

  it("same count: five in a session, then a block", () => {
    const run = (file: string) => { const env = tempEnv(subagent.SETTINGS); return subagent.SEQUENCE.models.map((model) => runSubagent(file, agentCall({ model }), env).code); };
    assert.deepEqual(run(CURRENT.subagent), run(FROZEN.subagent));
    assert.deepEqual(run(CURRENT.subagent), subagent.SEQUENCE.codes);
  });

  it("same count under parallel calls: exactly five of eight", async () => {
    const payloads = Array.from({ length: subagent.PARALLEL.count }, (_, i) => agentCall({ model: i % 2 ? "opus" : "sonnet" }));
    const was = await runSubagentParallel(FROZEN.subagent, payloads, tempEnv(subagent.SETTINGS));
    const now = await runSubagentParallel(CURRENT.subagent, payloads, tempEnv(subagent.SETTINGS));
    assert.equal(was.filter((c) => c === 0).length, subagent.PARALLEL.allowed);
    assert.equal(now.filter((c) => c === 0).length, subagent.PARALLEL.allowed);
  });
});

describe("compare: the count", () => {
  it("reports zero differences apart from the listed new blocks, new allows and new reasons", (t) => {
    let differences = 0, newBlocks = 0, newAllows = 0, newReasons = 0;
    const same = (command: string) => { const was = runGuard(FROZEN.guard, command), now = runGuard(CURRENT.guard, command); return was.code === now.code && stripId(now.stderr) === was.stderr; };
    const rounds = ROUNDS.map(([, table]) => table);
    const unchanged = [...bash.BLOCKED.map(([c]) => c), ...bash.ALLOWED, ...g18.ALLOWED, ...rounds.flatMap((r) => [...r.UNCHANGED.map(([c]) => c), ...r.ALLOWED])];
    const blocked = [...g18.BLOCKED, ...rounds.flatMap((r) => r.BLOCKED)];
    const loosened = rounds.flatMap((r) => r.LOOSENED), reworded = rounds.flatMap((r) => r.REWORDED);
    for (const command of unchanged) if (!same(command)) differences++;
    for (const [command] of blocked) if (!same(command)) newBlocks++;
    for (const [command] of loosened) if (!same(command)) newAllows++;
    for (const [command] of reworded) if (!same(command)) newReasons++;
    t.diagnostic(`the v0.1 table, G18's allowed side and the rounds' unchanged sides: ${differences} differences across ${unchanged.length} cases`);
    t.diagnostic(`G18's and the rounds' blocked sides: ${newBlocks} new blocks across ${blocked.length} cases`);
    t.diagnostic(`the rounds' loosened sides: ${newAllows} new allows across ${loosened.length} cases`);
    t.diagnostic(`the rounds' reworded sides: ${newReasons} new reasons across ${reworded.length} cases`);
    assert.equal(differences, 0);
    assert.equal(newBlocks, blocked.length);
    assert.equal(newAllows, loosened.length);
    assert.equal(newReasons, reworded.length);
  });
});
