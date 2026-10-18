import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { ROOT, runGuard } from "./harness.ts";

/*
 * The hook fails closed by itself. A copy of guard.js without lib/, a rule file that throws when
 * it loads, a rule file that does not parse, a judge that throws: each is a G17 block with exit 2,
 * never a crash with exit 1, because Claude Code reads exit 1 as a non-blocking error unless the
 * hook has onFailure: block (2.1.295 and later). That setting is the second layer; this is the
 * first. Every case runs a copy of the hook in its own temp folder and asks it to judge a push to
 * main, the command that must not get through.
 */
const PUSH = "git push origin main";
const LOAD_FAILURE = /^guard: blocked \(G17 unreadable: the guard could not load: /;

function copyOfGuard(withLib: boolean): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "antaris-guard-load-"));
  fs.copyFileSync(path.join(ROOT, "guard.js"), path.join(dir, "guard.js"));
  if (withLib) fs.cpSync(path.join(ROOT, "lib"), path.join(dir, "lib"), { recursive: true });
  return dir;
}

describe("guard.js fails closed when it cannot load", () => {
  it("a copy without lib/ blocks with G17 and exit 2", () => {
    const dir = copyOfGuard(false);
    const r = runGuard(path.join(dir, "guard.js"), PUSH);
    assert.equal(r.code, 2, r.stderr);
    assert.match(r.stderr, LOAD_FAILURE);
    assert.match(r.stderr, /Cannot find module/);
  });

  it("a copy with lib/ but no rules folder blocks with G17 and exit 2", () => {
    const dir = copyOfGuard(true);
    fs.renameSync(path.join(dir, "lib", "rules"), path.join(dir, "lib", "rules-elsewhere"));
    const r = runGuard(path.join(dir, "guard.js"), PUSH);
    assert.equal(r.code, 2, r.stderr);
    assert.match(r.stderr, LOAD_FAILURE);
  });

  it("a rule file that throws when it loads blocks with G17, exit 2 and the throw's words", () => {
    const dir = copyOfGuard(true);
    fs.writeFileSync(path.join(dir, "lib", "rules", "g01-blocked-program.js"), 'throw new Error("boom at load");\n');
    const r = runGuard(path.join(dir, "guard.js"), PUSH);
    assert.equal(r.code, 2, r.stderr);
    assert.match(r.stderr, LOAD_FAILURE);
    assert.match(r.stderr, /boom at load/);
  });

  it("a rule file that does not parse blocks with G17 and exit 2", () => {
    const dir = copyOfGuard(true);
    fs.writeFileSync(path.join(dir, "lib", "rules", "g07-push-to-protected.js"), "module.exports = {\n");
    const r = runGuard(path.join(dir, "guard.js"), PUSH);
    assert.equal(r.code, 2, r.stderr);
    assert.match(r.stderr, LOAD_FAILURE);
  });

  it("a judge.js that exports the wrong shape blocks with G17 and exit 2", () => {
    const dir = copyOfGuard(true);
    fs.writeFileSync(path.join(dir, "lib", "judge.js"), "module.exports = {};\n");
    const r = runGuard(path.join(dir, "guard.js"), PUSH);
    assert.equal(r.code, 2, r.stderr);
    assert.match(r.stderr, LOAD_FAILURE);
    assert.match(r.stderr, /does not export judge\(\) and blockedLine\(\)/);
  });

  it("a judge() that throws blocks with G17, exit 2 and the third v0.1 reason", () => {
    const dir = copyOfGuard(true);
    fs.writeFileSync(path.join(dir, "lib", "judge.js"), 'module.exports = { judge: () => { throw new Error("boom while judging"); }, blockedLine: () => "" };\n');
    const r = runGuard(path.join(dir, "guard.js"), PUSH);
    assert.equal(r.code, 2, r.stderr);
    assert.match(r.stderr, /^guard: blocked \(G17 unreadable: the guard could not judge the command: boom while judging\)/);
  });

  it("a throw outside every try, on the next tick, still blocks with G17 and exit 2", () => {
    // The last net: lib/ loads fine, then something throws where no try can see it, before stdin
    // is read. The uncaughtException handler turns it into a block.
    const dir = copyOfGuard(true);
    fs.writeFileSync(path.join(dir, "lib", "judge.js"), 'process.nextTick(() => { throw new Error("boom later"); });\nmodule.exports = { judge: () => ({ decision: "allow" }), blockedLine: () => "" };\n');
    const r = runGuard(path.join(dir, "guard.js"), PUSH);
    assert.equal(r.code, 2, r.stderr);
    assert.match(r.stderr, LOAD_FAILURE);
    assert.match(r.stderr, /boom later/);
  });

  it("a whole copy, lib/ included, still judges as the original does", () => {
    const dir = copyOfGuard(true);
    const r = runGuard(path.join(dir, "guard.js"), PUSH);
    assert.equal(r.code, 2);
    assert.equal(r.stderr, "guard: blocked (G07 push-to-protected: direct push to main; open a PR instead): git push origin main");
    assert.equal(runGuard(path.join(dir, "guard.js"), "git status --short").code, 0);
  });
});
