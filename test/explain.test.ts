import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { INVENTARIS, inventarisProject, projectWith, runExplain } from "./harness.ts";

/*
 * bin/antaris-guard.js explain: the config it read, the commands with their programs, shell
 * strings and inline code, and the decision with its rule, with the hook's exit codes.
 */
describe("antaris-guard explain", () => {
  it("prints the parse and an allow, exit 0", () => {
    const r = runExplain(["explain", "git status | tail -1"]);
    assert.equal(r.code, 0, r.stderr);
    assert.match(r.stdout, /^config: .*guard\.config\.json\nlog: .*guard\/log\.jsonl\n/);
    assert.match(r.stdout, /command: git status \| tail -1\n/);
    assert.match(r.stdout, /commands:\n {3}1\. git status {4}\[program git\]\n {3}2\. tail -1 {4}\[program tail, piped\]\n/);
    assert.match(r.stdout, /inline code: none\n/);
    assert.match(r.stdout, /decision: allow\n$/);
    assert.ok(!r.stdout.includes("rule:"));
  });

  it("prints a deny with its rule and reason, exit 2", () => {
    const r = runExplain(["explain", "git commit -m x && git push origin main"]);
    assert.equal(r.code, 2);
    assert.match(r.stdout, /decision: deny\nrule: G07 push-to-protected \(deny\)\nreason: direct push to main; open a PR instead\n$/);
  });

  it("shows shell strings and inline code", () => {
    const r = runExplain(["explain", "bash -c 'cd x && node -e \"1+1\"'"]);
    assert.equal(r.code, 0, r.stderr);
    assert.match(r.stdout, /1\. bash -c cd x && node -e "1\+1" {4}\[program bash\]\n {3}2\. cd x {4}\[program cd, inside a shell string, 1 deep\]\n {3}3\. node -e 1\+1 {4}\[program node, inside a shell string, 1 deep\]\n/);
    assert.match(r.stdout, /inline code:\n {2}1\+1\n/);
  });

  it("says when the line could not be read, with G17", () => {
    const r = runExplain(["explain", "echo 'unclosed"]);
    assert.equal(r.code, 2);
    assert.match(r.stdout, /commands: the line could not be read\n/);
    assert.match(r.stdout, /rule: G17 unreadable \(deny\)\nreason: could not read the command: an unclosed quote\n$/);
  });

  it("with no config file, says the built-in defaults judge, as the hook does (round 4b; it was a G17 deny)", () => {
    const dir = projectWith(null);
    const r = runExplain(["explain", "ls"], dir);
    assert.equal(r.code, 0, r.stdout);
    assert.ok(r.stdout.startsWith(`config: none at ${path.join(dir, ".claude", "guard.config.json")}; judged by the built-in defaults\n`), r.stdout);
    assert.match(r.stdout, /decision: allow\n$/);
    assert.equal(runExplain(["explain", "git push origin main"], dir).code, 2);
  });

  it("with no config file and --fallback, says which fallback judges, as the plugin's org edition does", () => {
    const r = runExplain(["explain", "--fallback", "antaris-analytics", "aws s3 ls"], projectWith(null));
    assert.equal(r.code, 2, r.stdout);
    assert.match(r.stdout, /^config: none at .*; judged by the fallback .*configs\/antaris-analytics\.json\n/);
    assert.match(r.stdout, /rule: G01 blocked-program \(deny\)/);
  });

  it("with a config file, --fallback changes nothing: the file judges", () => {
    const r = runExplain(["explain", "--fallback", "antaris-analytics", "python3 -c 'print(1)'"], inventarisProject());
    assert.ok(r.stdout.startsWith(`config: ${inventarisProject()}`), r.stdout);
    assert.equal(r.code, 2, r.stdout);
  });

  it("a fallback it cannot read is a deny with G17, exit 2", () => {
    const r = runExplain(["explain", "--fallback", "no-such-config", "ls"], projectWith(null));
    assert.equal(r.code, 2);
    assert.match(r.stdout, /reason: could not read the config: the fallback .*no-such-config\.json could not be read: ENOENT\n$/);
  });

  it("with a config that fails validation, denies with G17 and the message", () => {
    const r = runExplain(["explain", "ls"], projectWith({ ...INVENTARIS, rules: { G07: "off" } }));
    assert.equal(r.code, 2);
    assert.match(r.stdout, /reason: the config is not valid: rules\.G07 cannot be off\n$/);
  });

  it("reads the config under CLAUDE_PROJECT_DIR", () => {
    const r = runExplain(["explain", "ls"], inventarisProject());
    assert.ok(r.stdout.startsWith(`config: ${inventarisProject()}`), r.stdout);
  });

  it("says where the log goes, or that it is off, and never writes it", () => {
    const off = projectWith({ ...INVENTARIS, log: { enabled: false } });
    assert.match(runExplain(["explain", "ls"], off).stdout, /\nlog: off\n/);
    const on = projectWith(INVENTARIS);
    assert.match(runExplain(["explain", "git push origin main"], on).stdout, /\nlog: .*log\.jsonl\n/);
    assert.ok(!fs.existsSync(path.join(on, ".claude", "guard")), "explain wrote the log");
  });

  it("prints usage and exits 1 without a command", () => {
    for (const args of [[], ["explain"], ["explain", "a", "b"], ["judge", "ls"], ["explain", "--fallback"], ["explain", "--fallback", "antaris-analytics"]]) {
      const r = runExplain(args);
      assert.equal(r.code, 1, args.join(" "));
      assert.match(r.stderr, /^usage: antaris-guard explain \[--fallback <name>\] "<command>"/);
    }
  });
});
