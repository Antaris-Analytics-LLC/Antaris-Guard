import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { CURRENT, INVENTARIS, ROOT, logOf, projectWith, runExplain, runGuard } from "./harness.ts";

/*
 * The third answer, ask, through the real hook. A config moves a rule to ask; the hook answers
 * with exit 0 and the hook's JSON alone on stdout, logs the ask, and lets a deny on the same line
 * win whichever rule comes first. A log it cannot write turns an ask into a block, as it does an
 * allow. explain prints the ask with the hook's exit code. The rules that ask by default have
 * their own table in test/tables/r4.ts.
 */
const require = createRequire(import.meta.url);
const { judge } = require(path.join(ROOT, "lib", "judge.js"));

// G01 and docker-01 moved to ask by the config: curl and docker exec are asks, everything else is as it was.
const ASK_CONFIG = { ...INVENTARIS, rules: { ...((INVENTARIS.rules as Record<string, string>) ?? {}), G01: "ask", "docker-01": "ask" } };
const askProject = () => projectWith(ASK_CONFIG);

describe("ask", () => {
  it("is exit 0 with the hook's JSON alone on stdout, naming the rule, the reason and the command", () => {
    const r = runGuard(CURRENT.guard, "curl https://example.com", askProject());
    assert.equal(r.decision, "ask", JSON.stringify(r));
    assert.equal(r.code, 0);
    assert.equal(r.stderr, "");
    assert.deepEqual(JSON.parse(r.stdout), {
      hookSpecificOutput: {
        hookEventName: "PreToolUse",
        permissionDecision: "ask",
        permissionDecisionReason: "guard: ask (G01 blocked-program: a blocked program appears somewhere in the line): curl https://example.com",
      },
    });
  });

  it("lets a deny on the same line win, whichever rule comes first", () => {
    const project = askProject();
    for (const command of ["curl https://example.com && git push origin main", "git push origin main; curl https://example.com"]) {
      const r = runGuard(CURRENT.guard, command, project);
      assert.equal(r.decision, "deny", command);
      assert.match(r.reason, /^G07 push-to-protected: direct push to main/);
      assert.equal(r.stdout, "");
    }
    assert.equal(runGuard(CURRENT.guard, "docker exec pg ls; rm -rf build", project).decision, "deny");
    // Two asks on one line: the first rule in order answers.
    assert.match(runGuard(CURRENT.guard, "docker exec pg ls; curl https://example.com", project).reason, /^G01 blocked-program/);
  });

  it("is judged at the config's tier: the same command is a deny under the worked example", () => {
    assert.equal(judge("curl https://example.com", INVENTARIS).decision, "deny");
    const asked = judge("curl https://example.com", ASK_CONFIG);
    assert.deepEqual([asked.decision, asked.rule, asked.tier], ["ask", "G01", "ask"]);
    const denied = judge("curl https://example.com && git push origin main", ASK_CONFIG);
    assert.deepEqual([denied.decision, denied.rule, denied.tier], ["deny", "G07", "deny"]);
  });

  it("is logged, as every decision is", () => {
    const project = askProject();
    runGuard(CURRENT.guard, "curl https://example.com", project);
    const line = JSON.parse(fs.readFileSync(logOf(project), "utf8").trim());
    assert.deepEqual([line.decision, line.rule, line.reason], ["ask", "G01", "a blocked program appears somewhere in the line"]);
  });

  it("becomes a block when the log cannot be written, as an allow does", () => {
    const project = askProject();
    fs.mkdirSync(path.join(project, ".claude", "guard"), { recursive: true });
    fs.mkdirSync(logOf(project));
    const r = runGuard(CURRENT.guard, "curl https://example.com", project);
    assert.equal(r.decision, "deny");
    assert.match(r.stderr, /^guard: blocked \(G17 unreadable: could not write the log: .*\): curl https:\/\/example\.com$/);
    assert.equal(r.stdout, "");
  });

  it("explain prints the ask with its rule and reason, and exits 0 as the hook does", () => {
    const r = runExplain(["explain", "curl https://example.com"], askProject());
    assert.equal(r.code, 0, r.stderr);
    assert.match(r.stdout, /decision: ask\nrule: G01 blocked-program \(ask\)\nreason: a blocked program appears somewhere in the line\n$/);
  });
});
