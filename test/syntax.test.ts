import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { ROOT } from "./harness.ts";

/*
 * node --check on every JavaScript file in the repository, the frozen copies included, so the
 * exit test's "node --check on every file" is something CI enforces rather than something a
 * session remembers to run. node_modules and .git are skipped; nothing else is.
 */
function javascriptFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === "node_modules" || entry.name === ".git") continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...javascriptFiles(full));
    else if (/\.(c|m)?js$/.test(entry.name)) out.push(full);
  }
  return out.sort();
}

/** Every test file under test/, wherever it sits. */
function testFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...testFiles(full));
    else if (entry.name.endsWith(".test.ts")) out.push(full);
  }
  return out.sort();
}

describe("node --check", () => {
  const files = javascriptFiles(ROOT);

  it("finds the hooks, lib/ and the frozen copies", () => {
    const names = files.map((f) => path.relative(ROOT, f));
    for (const expected of ["guard.js", "subagent-guard.js", "lib/parse.js", "lib/judge.js", "lib/rules/index.js", "lib/rules/g18-browser-automation.js", "bench/versions/v0.1/guard.js", "bench/versions/v0.1/subagent-guard.js"]) {
      assert.ok(names.includes(expected), `${expected} not found`);
    }
  });

  it("every test file is in a folder npm test runs: test/, test/rules/ or test/timing/", () => {
    // package.json names those three folders rather than a glob over everything, so test/timing/ can
    // run on its own after the rest; a test file anywhere else would be left out in silence.
    const folders = new Set(["test", path.join("test", "rules"), path.join("test", "timing")]);
    for (const file of testFiles(path.join(ROOT, "test"))) {
      assert.ok(folders.has(path.relative(ROOT, path.dirname(file))), `${path.relative(ROOT, file)} is in a folder npm test does not run`);
    }
    assert.ok(testFiles(path.join(ROOT, "test", "timing")).length >= 1, "test/timing/ has no test file");
  });

  for (const file of files) {
    it(`passes: ${path.relative(ROOT, file)}`, () => {
      const r = spawnSync(process.execPath, ["--check", file], { encoding: "utf8" });
      assert.equal(r.status, 0, r.stderr);
    });
  }
});
