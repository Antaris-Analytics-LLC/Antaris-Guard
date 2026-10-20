import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import { CURRENT, INVENTARIS, ROOT, agentCall, bashCall, logOf, projectWith, runGuard, runGuardParallel, runGuardRaw, runSubagent, tempEnv } from "./harness.ts";
import { SETTINGS } from "./tables/subagent.ts";

/*
 * The decision log: lib/log.js as a library (the chain, what verify() finds), the hooks writing
 * it (every decision, allows included, the command's hash and never its text, a log that cannot
 * be written blocking, logging off, the subagent hook in the same chain), many hook processes
 * appending at once, the lock's recovery, the verify-log and log commands, the .gitignore line that
 * keeps the log out of this repository, and (since the G02 PR) the .gitignore the log writes into
 * its own folder so it stays out of any repository. No git runs here: the PR reports the check of
 * that .gitignore in a real git repository, done by hand.
 */
const require = createRequire(import.meta.url);
const log = require(path.join(ROOT, "lib", "log.js"));

const PUSH = "git push origin main";
const STATUS = "git status --short";
const DOT_CLAUDE = "." + "claude";

type Line = Record<string, unknown> & { hash: string; prev: string };
const linesOf = (file: string): Line[] => fs.readFileSync(file, "utf8").trim().split("\n").map((l) => JSON.parse(l));
const entry = (over: Record<string, unknown> = {}) => ({ t: "2026-10-18T10:00:00.000Z", session: "s", tool: "Bash", decision: "allow", rule: null, reason: "", cmd_sha256: log.sha256("ls"), ...over });
const cli = (args: string[], project: string) => {
  const r = spawnSync(process.execPath, [path.join(ROOT, "bin", "antaris-guard.js"), ...args], { encoding: "utf8", env: { ...process.env, CLAUDE_PROJECT_DIR: project } });
  return { code: r.status, stdout: r.stdout, stderr: r.stderr };
};
/** A fresh project with the worked example's config and no log yet. */
const freshProject = () => projectWith(INVENTARIS);
/** A log of five decisions written through the library, and its path. */
function fiveLines(): string {
  const file = logOf(projectWith(null));
  for (let i = 0; i < 5; i++) log.append(file, entry({ cmd_sha256: log.sha256(`cmd ${i}`), decision: i % 2 ? "deny" : "allow", rule: i % 2 ? "G07" : null }));
  return file;
}

describe("lib/log.js", () => {
  it("chains lines from genesis, hashing the fields in a fixed order, with model on Agent lines only", () => {
    const file = logOf(projectWith(null));
    const a = log.append(file, entry());
    const b = log.append(file, entry({ tool: "Agent", model: "sonnet", decision: "deny", rule: "subagent-guard", reason: "x", cmd_sha256: log.sha256("{}") }));
    assert.equal(a.v, 1);
    assert.equal(a.prev, "genesis");
    assert.equal(b.prev, a.hash);
    assert.deepEqual(Object.keys(a), ["v", "t", "session", "tool", "decision", "rule", "reason", "cmd_sha256", "prev", "hash"]);
    assert.deepEqual(Object.keys(b), ["v", "t", "session", "tool", "model", "decision", "rule", "reason", "cmd_sha256", "prev", "hash"]);
    const { hash, ...rest } = a;
    assert.equal(hash, log.sha256(JSON.stringify(rest)));
    assert.deepEqual(log.verify(file), { ok: true, lines: 2, tip: b.hash, breaks: [] });
    assert.equal(log.verify(file, { tip: b.hash }).ok, true);
    assert.equal(log.verify(file, { tip: b.hash }).tipLine, 2);
    assert.match(log.verify(file, { tip: "abc" }).reason, /^the tip given is not the hash of any line: /);
    assert.deepEqual(linesOf(file), [a, b]);
  });

  it("verify() names every line that does not hold: changed, deleted, inserted, truncated, the wrong version, not genesis", () => {
    const file = fiveLines();
    const good = fs.readFileSync(file, "utf8");
    const rows = good.trim().split("\n");
    // The breaks a text gives, each as [line, reason, fork]; the first one is also the result's line and reason.
    const breaks = (text: string) => {
      fs.writeFileSync(file, text);
      const r = log.verify(file);
      assert.equal(r.ok, false);
      assert.deepEqual([r.line, r.reason], [r.breaks[0].line, r.breaks[0].reason]);
      return r.breaks.map((b: { line: number; reason: string; fork: number }) => [b.line, b.reason, b.fork]);
    };
    assert.deepEqual(log.verify(file).ok, true);
    // A field changed on line 3: its hash no longer matches, and line 4 still follows from the hash line 3 carries.
    assert.deepEqual(breaks([...rows.slice(0, 2), rows[2].replace('"decision":"allow"', '"decision":"deny"'), ...rows.slice(3)].join("\n") + "\n"), [[3, "hash does not match the line", 0]]);
    // Line 3 deleted: line 4 (now the third) points at a hash that no line carries. Not a fork.
    assert.deepEqual(breaks([...rows.slice(0, 2), ...rows.slice(3)].join("\n") + "\n"), [[3, "prev is not the hash of line 2", 0]]);
    // A line inserted after line 2, with a good hash of its own but the wrong prev: it breaks, and so does the line after it.
    const forged = log.line(entry({ cmd_sha256: log.sha256("forged") }), "0".repeat(64));
    assert.deepEqual(breaks([...rows.slice(0, 2), JSON.stringify(forged), ...rows.slice(2)].join("\n") + "\n"), [[3, "prev is not the hash of line 2", 0], [4, "prev is not the hash of line 3", 0]]);
    // The last line cut short, as a crash mid-write would leave it.
    assert.deepEqual(breaks(good.slice(0, -20)), [[5, "not JSON", 0]]);
    // The wrong shape version, a first line that is not genesis, and a field the shape does not have.
    assert.deepEqual(breaks(rows[0].replace('"v":1', '"v":2') + "\n"), [[1, "v is 2, not 1", 0]]);
    assert.deepEqual(breaks(rows[1] + "\n"), [[1, "prev is not genesis", 0]]);
    const extra = JSON.parse(rows[0]); extra.note = "x";
    assert.deepEqual(breaks(JSON.stringify(extra) + "\n"), [[1, "unknown field note", 0]]);
    // Not JSON at all, and no file.
    assert.deepEqual(breaks("{\n"), [[1, "not JSON", 0]]);
    fs.rmSync(file);
    assert.match(log.verify(file).reason, /^could not read .*ENOENT/);
    assert.equal(log.verify(file).line, 0);
    assert.equal(log.verify(file).breaks.length, 1);
  });

  it("verify() with a tip: found on any line it holds, with every line up to it proven; missing, or broken up to it, it fails", () => {
    const file = fiveLines();
    const text = fs.readFileSync(file, "utf8");
    const rows = text.trim().split("\n").map((t) => JSON.parse(t));
    // The log has grown since the tip was noted at line 2: the tip holds, and so does the chain.
    let r = log.verify(file, { tip: rows[1].hash });
    assert.deepEqual([r.ok, r.tipLine, r.tipReason, r.lines], [true, 2, null, 5]);
    // The tip on the last line, and on the first.
    assert.equal(log.verify(file, { tip: rows[4].hash }).tipLine, 5);
    assert.equal(log.verify(file, { tip: rows[0].hash }).tipLine, 1);
    // No line carries it: the tip fails, with no break in the chain itself.
    r = log.verify(file, { tip: "0".repeat(64) });
    assert.deepEqual([r.ok, r.tipLine, r.breaks.length], [false, 0, 0]);
    assert.match(r.tipReason, /^the tip given is not the hash of any line: the chain up to it was rewritten or cut, or the tip is from another log$/);
    assert.equal(r.reason, r.tipReason);
    // Lines cut from the end, through the line the tip names: no break is left, and only the tip finds the cut.
    fs.writeFileSync(file, text.trim().split("\n").slice(0, 3).join("\n") + "\n");
    assert.equal(log.verify(file).ok, true);
    assert.equal(log.verify(file, { tip: rows[4].hash }).ok, false);
    assert.equal(log.verify(file, { tip: rows[4].hash }).tipLine, 0);
    // A break before the tip line, and on it: the lines up to the tip are not proven.
    const lines = text.trim().split("\n");
    fs.writeFileSync(file, [lines[0].replace('"session":"s"', '"session":"x"'), ...lines.slice(1)].join("\n") + "\n");
    r = log.verify(file, { tip: rows[3].hash });
    assert.equal(r.ok, false);
    assert.equal(r.tipLine, 4);
    assert.equal(r.tipReason, "the tip given is line 4, but the chain breaks at line 1, before it, so the lines up to the tip are not proven");
    r = log.verify(file, { tip: rows[0].hash });
    assert.equal(r.tipReason, "the tip given is line 1, but that line does not hold, so the lines up to it are not proven");
    // A break after the tip line: the tip holds, the chain does not.
    fs.writeFileSync(file, [...lines.slice(0, 3), lines[3].replace('"session":"s"', '"session":"x"'), lines[4]].join("\n") + "\n");
    r = log.verify(file, { tip: rows[1].hash });
    assert.deepEqual([r.ok, r.tipLine, r.tipReason], [false, 2, null]);
    assert.deepEqual(r.breaks, [{ line: 4, reason: "hash does not match the line", fork: 0 }]);
  });

  it("verify() keeps walking after a break and lists every one, and marks a fork: two lines sharing one prev", () => {
    const file = fiveLines();
    const rows = fs.readFileSync(file, "utf8").trim().split("\n");
    // Two edits far apart: line 2 changed and line 4 removed. Both are listed, and the lines between are still checked.
    fs.writeFileSync(file, [rows[0], rows[1].replace('"session":"s"', '"session":"x"'), rows[2], rows[4]].join("\n") + "\n");
    let r = log.verify(file);
    assert.equal(r.ok, false);
    assert.deepEqual(r.breaks, [{ line: 2, reason: "hash does not match the line", fork: 0 }, { line: 4, reason: "prev is not the hash of line 3", fork: 0 }]);
    // A fork, as two hooks appending at once leave it: lines 4 and 5 both follow line 3, and line 6 follows line 5.
    const three = rows.slice(0, 3).map((t) => JSON.parse(t));
    const a = log.line(entry({ cmd_sha256: log.sha256("a") }), three[2].hash);
    const b = log.line(entry({ cmd_sha256: log.sha256("b") }), three[2].hash);
    const c = log.line(entry({ cmd_sha256: log.sha256("c") }), b.hash);
    fs.writeFileSync(file, [...rows.slice(0, 3), JSON.stringify(a), JSON.stringify(b), JSON.stringify(c)].join("\n") + "\n");
    r = log.verify(file);
    assert.equal(r.ok, false);
    assert.equal(r.lines, 6);
    assert.equal(r.tip, c.hash);
    assert.deepEqual(r.breaks, [{ line: 5, reason: "prev is not the hash of line 4", fork: 4 }]);
    // Three hooks at once: the third line shares the same prev too, and is named against the first that carried it.
    const d = log.line(entry({ cmd_sha256: log.sha256("d") }), three[2].hash);
    fs.writeFileSync(file, [...rows.slice(0, 3), JSON.stringify(a), JSON.stringify(b), JSON.stringify(d)].join("\n") + "\n");
    assert.deepEqual(log.verify(file).breaks, [{ line: 5, reason: "prev is not the hash of line 4", fork: 4 }, { line: 6, reason: "prev is not the hash of line 5", fork: 4 }]);
  });

  it("summary() counts by decision, rule, day, session and tool", () => {
    const file = logOf(projectWith(null));
    log.append(file, entry({ t: "2026-10-18T01:00:00.000Z", session: "a" }));
    log.append(file, entry({ t: "2026-10-18T02:00:00.000Z", session: "a", decision: "deny", rule: "G07", reason: "r" }));
    log.append(file, entry({ t: "2026-10-19T01:00:00.000Z", session: "b", decision: "deny", rule: "G07", reason: "r" }));
    log.append(file, entry({ t: "2026-10-19T01:00:00.000Z", session: "b", tool: "Agent", model: "opus", decision: "deny", rule: "subagent-guard", reason: "r" }));
    const s = log.summary(file);
    assert.equal(s.lines, 4);
    assert.equal(s.size, fs.statSync(file).size);
    assert.equal(s.chain.ok, true);
    assert.deepEqual(s.byDecision, { allow: 1, deny: 3 });
    assert.deepEqual(s.byRule, { G07: 2, "subagent-guard": 1 });
    assert.deepEqual(s.byDay, { "2026-10-18": 2, "2026-10-19": 2 });
    assert.deepEqual(s.bySession, { a: 2, b: 2 });
    assert.deepEqual(s.byTool, { Bash: 3, Agent: 1 });
  });

  it("reads the tail of a long log without reading it all, and refuses a last line it cannot read", () => {
    const file = logOf(projectWith(null));
    const long = "x".repeat(20000);
    for (let i = 0; i < 3; i++) log.append(file, entry({ reason: long, decision: "deny", rule: "G16" }));
    assert.equal(log.verify(file).ok, true);
    fs.appendFileSync(file, '{"v":1,"t":"x"\n');
    assert.throws(() => log.append(file, entry()), /the last line of .* is not JSON/);
  });
});

describe("the hooks and the log", () => {
  it("logs every decision, allows included, with the command's hash and never its text", () => {
    const project = freshProject();
    const marker = `MARKER-${process.pid}-${Date.now()}`;
    assert.equal(runGuard(CURRENT.guard, `echo ${marker}`, project).code, 0);
    assert.equal(runGuard(CURRENT.guard, PUSH, project).code, 2);
    assert.equal(runGuardRaw(CURRENT.guard, "not json", project).code, 2);
    const text = fs.readFileSync(logOf(project), "utf8");
    assert.ok(!text.includes(marker), "the command's text is in the log");
    const rows = linesOf(logOf(project));
    assert.equal(rows.length, 3);
    assert.equal(rows[0].v, 1);
    assert.equal(rows[0].session, "test-session");
    assert.equal(rows[0].tool, "Bash");
    assert.equal(rows[0].decision, "allow");
    assert.equal(rows[0].rule, null);
    assert.equal(rows[0].reason, "");
    assert.equal(rows[0].cmd_sha256, log.sha256(`echo ${marker}`));
    assert.equal(rows[0].prev, "genesis");
    assert.ok(!("model" in rows[0]));
    assert.equal(rows[1].decision, "deny");
    assert.equal(rows[1].rule, "G07");
    assert.equal(rows[1].reason, "direct push to main; open a PR instead");
    assert.equal(rows[1].cmd_sha256, log.sha256(PUSH));
    assert.equal(rows[1].prev, rows[0].hash);
    // A tool call that is not JSON is a decision too: logged with no session, and the hash of what came in.
    assert.equal(rows[2].session, "unknown");
    assert.equal(rows[2].rule, "G17");
    assert.equal(rows[2].reason, "could not read the tool call");
    assert.equal(rows[2].cmd_sha256, log.sha256("not json"));
    assert.deepEqual(log.verify(logOf(project)), { ok: true, lines: 3, tip: rows[2].hash, breaks: [] });
    assert.ok(!fs.existsSync(`${logOf(project)}.lock`), "the lock was left behind");
    assert.match(new Date(rows[0].t as string).toISOString(), /^\d{4}-\d{2}-\d{2}T/);
  });

  it("a config the guard cannot read logs nothing, since there is no path to log to; a missing one logs where the defaults say (round 4b; it was a block that logged nothing)", () => {
    const broken = projectWith(null, "nope");
    assert.equal(runGuard(CURRENT.guard, STATUS, broken).code, 2);
    assert.ok(!fs.existsSync(path.join(broken, ".claude", "guard")));
    const project = projectWith(null);
    assert.equal(runGuard(CURRENT.guard, STATUS, project).code, 0);
    assert.deepEqual(linesOf(logOf(project)).map((row) => [row.tool, row.decision]), [["Bash", "allow"]]);
  });

  it("logging off writes nothing and changes no decision", () => {
    const project = projectWith({ ...INVENTARIS, log: { enabled: false } });
    assert.equal(runGuard(CURRENT.guard, STATUS, project).code, 0);
    const r = runGuard(CURRENT.guard, PUSH, project);
    assert.equal(r.code, 2);
    assert.match(r.stderr, /^guard: blocked \(G07 push-to-protected: /);
    assert.ok(!fs.existsSync(path.join(project, ".claude", "guard")));
  });

  it("a log that cannot be written blocks an allow with G17, and keeps a deny's reason with a second line", () => {
    const project = freshProject();
    fs.mkdirSync(logOf(project), { recursive: true }); // a folder where the file should be
    const allow = runGuard(CURRENT.guard, STATUS, project);
    assert.equal(allow.code, 2);
    assert.match(allow.stderr, /^guard: blocked \(G17 unreadable: could not write the log: .*log\.jsonl.*\): git status --short$/);
    const deny = runGuard(CURRENT.guard, PUSH, project);
    assert.equal(deny.code, 2);
    const [first, second] = deny.stderr.split("\n");
    assert.equal(first, "guard: blocked (G07 push-to-protected: direct push to main; open a PR instead): git push origin main");
    assert.match(second, /^guard: could not write the log \(.*log\.jsonl.*\)$/);
  });

  it("the log may sit under a folder the config protects, and goes there", () => {
    const project = projectWith({ ...INVENTARIS, protectedPaths: [".claude/", "CLAUDE.md", ".mcp.json", "secrets/"], log: { enabled: true, path: "secrets/guard.jsonl" } });
    assert.equal(runGuard(CURRENT.guard, STATUS, project).code, 0);
    assert.equal(linesOf(path.join(project, "secrets", "guard.jsonl")).length, 1);
    assert.ok(!fs.existsSync(logOf(project)));
  });

  it("the subagent hook logs into the same chain, with the model asked for", () => {
    const project = freshProject();
    assert.equal(runGuard(CURRENT.guard, STATUS, project).code, 0);
    const env = tempEnv(SETTINGS, project);
    assert.equal(runSubagent(CURRENT.subagent, agentCall({ model: "sonnet" }), env).code, 0);
    assert.equal(runSubagent(CURRENT.subagent, agentCall({ model: "fable" }), env).code, 2);
    assert.equal(runSubagent(CURRENT.subagent, "not json", env).code, 2);
    assert.equal(runSubagent(CURRENT.subagent, { ...agentCall(), tool_name: "Bash", tool_input: { command: "ls" } }, env).code, 0); // not an Agent call: not this hook's decision, not logged
    const rows = linesOf(logOf(project));
    assert.equal(rows.length, 4);
    assert.equal(rows[0].tool, "Bash");
    assert.deepEqual([rows[1].tool, rows[1].model, rows[1].decision, rows[1].rule, rows[1].reason, rows[1].session], ["Agent", "sonnet", "allow", null, "", "test-session"]);
    assert.equal(rows[1].cmd_sha256, log.sha256(JSON.stringify(agentCall({ model: "sonnet" }).tool_input)));
    assert.deepEqual([rows[2].tool, rows[2].model, rows[2].decision, rows[2].rule], ["Agent", "fable", "deny", "subagent-guard"]);
    assert.equal(rows[2].reason, 'subagents run on sonnet or opus only, and this call asked for "fable"');
    assert.deepEqual([rows[3].session, rows[3].decision, rows[3].reason, rows[3].cmd_sha256], ["unknown", "deny", "could not read the tool call", log.sha256("not json")]);
    assert.equal(log.verify(logOf(project)).ok, true);
  });

  it("the subagent hook judges a missing config by the defaults, and fails closed on an unwritable log and a lib/ it cannot load", () => {
    // Round 4b: no config is no longer a block; the defaults judge and say where the log goes.
    const none = projectWith(null);
    const missing = runSubagent(CURRENT.subagent, agentCall({ model: "sonnet" }), tempEnv(SETTINGS, none));
    assert.equal(missing.code, 0, missing.stderr);
    assert.deepEqual(linesOf(logOf(none)).map((row) => [row.tool, row.decision]), [["Agent", "allow"]]);
    const project = freshProject();
    fs.mkdirSync(logOf(project), { recursive: true });
    const unwritable = runSubagent(CURRENT.subagent, agentCall({ model: "sonnet" }), tempEnv(SETTINGS, project));
    assert.equal(unwritable.code, 2);
    assert.match(unwritable.stderr, /^subagent-guard: blocked \(could not write the log: /);
    const denied = runSubagent(CURRENT.subagent, agentCall({ model: "fable" }), tempEnv(SETTINGS, project));
    assert.equal(denied.code, 2);
    assert.match(denied.stderr, /^subagent-guard: blocked \(subagents run on sonnet or opus only, and this call asked for "fable"\)\nsubagent-guard: could not write the log \(/);
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "antaris-guard-subagent-load-"));
    fs.copyFileSync(CURRENT.subagent, path.join(dir, "subagent-guard.js"));
    const alone = runSubagent(path.join(dir, "subagent-guard.js"), agentCall({ model: "sonnet" }), tempEnv(SETTINGS, freshProject()));
    assert.equal(alone.code, 2);
    assert.match(alone.stderr, /^subagent-guard: blocked \(the guard could not load: Cannot find module/);
  });

  it("64 hook processes at once: every one exits 0, no two lines share a prev, and the chain holds", async () => {
    const project = freshProject();
    const runs = await runGuardParallel(CURRENT.guard, Array.from({ length: 64 }, () => STATUS), project);
    assert.deepEqual(runs.map((r) => r.code), Array(64).fill(0), runs.filter((r) => r.code !== 0).map((r) => r.stderr).join("\n"));
    const rows = linesOf(logOf(project));
    assert.equal(rows.length, 64);
    assert.equal(new Set(rows.map((r) => r.prev)).size, 64, "two lines share a prev");
    assert.equal(new Set(rows.map((r) => r.hash)).size, 64);
    assert.deepEqual(log.verify(logOf(project)), { ok: true, lines: 64, tip: rows[63].hash, breaks: [] });
    assert.ok(!fs.existsSync(`${logOf(project)}.lock`), "the lock was left behind");
  });

  it("a lock left by a dead process is cleared at once, a stale one too, and a live one makes the hook wait and then say the log is busy", () => {
    const project = freshProject();
    const lock = `${logOf(project)}.lock`;
    fs.mkdirSync(path.dirname(lock), { recursive: true });
    // A pid that has exited: a child run to completion.
    const gone = spawnSync(process.execPath, ["-e", "0"]).pid;
    fs.writeFileSync(lock, String(gone));
    assert.equal(runGuard(CURRENT.guard, STATUS, project).code, 0);
    assert.ok(!fs.existsSync(lock));
    // A lock held by a live process (this one) but older than the stale limit.
    fs.writeFileSync(lock, String(process.pid));
    const old = (Date.now() - log.STALE_MS - 5000) / 1000;
    fs.utimesSync(lock, old, old);
    assert.equal(runGuard(CURRENT.guard, STATUS, project).code, 0);
    assert.ok(!fs.existsSync(lock));
    // A fresh lock held by a live process: the hook waits WAIT_MS, then blocks with the reason.
    fs.writeFileSync(lock, String(process.pid));
    const t0 = Date.now();
    const r = runGuard(CURRENT.guard, STATUS, project);
    const waited = Date.now() - t0;
    assert.equal(r.code, 2);
    assert.match(r.stderr, /^guard: blocked \(G17 unreadable: could not write the log: .*the log is busy: .*log\.jsonl\.lock has been held for 15 seconds\): git status --short$/);
    assert.ok(waited >= log.WAIT_MS - 500 && waited < log.WAIT_MS + 10000, `waited ${waited} ms`);
    fs.rmSync(lock);
    assert.equal(linesOf(logOf(project)).length, 2);
    assert.equal(log.verify(logOf(project)).ok, true);
  });

  it("a stale lock is removed only while it is still the lock that was read", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "antaris-guard-lock-"));
    const lock = path.join(dir, "log.jsonl.lock");
    const gone = spawnSync(process.execPath, ["-e", "0"]).pid;
    // Unchanged since it was read: removed.
    fs.writeFileSync(lock, String(gone));
    assert.equal(log.removeIfUnchanged(lock, log.readLock(lock)), true);
    assert.ok(!fs.existsSync(lock));
    // Read as a dead hook's lock, then cleared and taken by a fresh writer before this writer removes it:
    // the second look sees another lock, and it stays. This is the race the follow-up narrows.
    fs.writeFileSync(lock, String(gone));
    const seen = log.readLock(lock);
    fs.unlinkSync(lock);
    fs.writeFileSync(lock, `${process.pid} fresh`);
    assert.equal(log.removeIfUnchanged(lock, seen), false);
    assert.equal(fs.readFileSync(lock, "utf8"), `${process.pid} fresh`);
    // Nothing to remove, or nothing read: nothing removed.
    assert.equal(log.removeIfUnchanged(path.join(dir, "none.lock"), seen), false);
    assert.equal(log.removeIfUnchanged(lock, null), false);
    assert.ok(fs.existsSync(lock));
  });

  it("a writer releases the lock only while it still holds the writer's own token", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "antaris-guard-lock-"));
    const lock = path.join(dir, "log.jsonl.lock");
    // The lock holds this process's pid first, then a token, and is gone after the write.
    let held = "";
    assert.equal(log.withLock(lock, () => { held = fs.readFileSync(lock, "utf8"); return 7; }), 7);
    assert.match(held, new RegExp(`^${process.pid} [0-9a-f]{16}$`));
    assert.ok(!fs.existsSync(lock));
    // Cleared as stale while the writer ran, and taken by another writer: the first writer leaves it.
    log.withLock(lock, () => { fs.unlinkSync(lock); fs.writeFileSync(lock, "999999 other"); });
    assert.equal(fs.readFileSync(lock, "utf8"), "999999 other");
    // A throw inside still releases the writer's own lock.
    fs.unlinkSync(lock);
    assert.throws(() => log.withLock(lock, () => { throw new Error("boom"); }), /boom/);
    assert.ok(!fs.existsSync(lock));
  });

  it("64 hook processes at once, starting from a lock a dead hook left: every one exits 0 and the chain holds", async () => {
    const project = freshProject();
    const lock = `${logOf(project)}.lock`;
    fs.mkdirSync(path.dirname(lock), { recursive: true });
    fs.writeFileSync(lock, String(spawnSync(process.execPath, ["-e", "0"]).pid));
    const runs = await runGuardParallel(CURRENT.guard, Array.from({ length: 64 }, () => STATUS), project);
    assert.deepEqual(runs.map((r) => r.code), Array(64).fill(0), runs.filter((r) => r.code !== 0).map((r) => r.stderr).join("\n"));
    const rows = linesOf(logOf(project));
    assert.equal(rows.length, 64);
    assert.equal(new Set(rows.map((r) => r.prev)).size, 64, "two lines share a prev");
    assert.equal(log.verify(logOf(project)).ok, true);
    assert.ok(!fs.existsSync(lock), "the lock was left behind");
  });

  it(".gitignore keeps the log out of the repository", () => {
    const lines = fs.readFileSync(path.join(ROOT, ".gitignore"), "utf8").split("\n");
    assert.ok(lines.includes(`${DOT_CLAUDE}/guard/`), ".gitignore does not list the guard folder");
  });
});

describe("the log's folder keeps itself out of git (the G02 PR)", () => {
  const ignoreOf = (project: string): string => path.join(path.dirname(logOf(project)), ".gitignore");
  const EXPECTED = "# Written by Antaris-Guard. It keeps the guard's own files here out of git: the decision log, its lock and this file.\n/log.jsonl\n/log.jsonl.lock\n/.gitignore\n";
  /** Runs fn with fs[name] replaced, then puts it back. lib/log.js reads fs's functions when it calls them, so it sees the stand-in. */
  function swapped<T>(name: "openSync" | "writeFileSync", stand: (...args: unknown[]) => unknown, fn: () => T): T {
    const fsAny = fs as unknown as Record<string, unknown>;
    const original = fsAny[name];
    fsAny[name] = stand;
    try { return fn(); } finally { fsAny[name] = original; }
  }

  it("a fresh project gets a .gitignore naming the log, its lock and itself, anchored to the folder, and nothing else", () => {
    const project = freshProject();
    assert.equal(runGuard(CURRENT.guard, STATUS, project).code, 0);
    assert.equal(fs.readFileSync(ignoreOf(project), "utf8"), EXPECTED);
    assert.equal(log.gitignoreText("log.jsonl"), EXPECTED);
    assert.deepEqual(fs.readdirSync(path.dirname(logOf(project))).sort(), [".gitignore", "log.jsonl"]);
  });

  it("an existing folder with a log and no .gitignore gets one on the next write, and the chain goes on", () => {
    const project = freshProject();
    runGuard(CURRENT.guard, STATUS, project);
    fs.unlinkSync(ignoreOf(project));
    assert.equal(runGuard(CURRENT.guard, PUSH, project).code, 2);
    assert.equal(fs.readFileSync(ignoreOf(project), "utf8"), EXPECTED);
    assert.equal(log.verify(logOf(project)).lines, 2);
    assert.equal(log.verify(logOf(project)).ok, true);
    // A folder made before the guard ever wrote there, empty: the same.
    const empty = freshProject();
    fs.mkdirSync(path.dirname(logOf(empty)), { recursive: true });
    assert.equal(runGuard(CURRENT.guard, STATUS, empty).code, 0);
    assert.equal(fs.readFileSync(ignoreOf(empty), "utf8"), EXPECTED);
  });

  it("a .gitignore that is there is left exactly as it is, byte for byte, with nothing added", () => {
    const project = freshProject();
    fs.mkdirSync(path.dirname(logOf(project)), { recursive: true });
    const mine = Buffer.from("*.tmp\n# the operator's own\nno newline at the end");
    fs.writeFileSync(ignoreOf(project), mine);
    const before = fs.statSync(ignoreOf(project));
    for (const command of [STATUS, PUSH, STATUS]) runGuard(CURRENT.guard, command, project);
    assert.ok(fs.readFileSync(ignoreOf(project)).equals(mine));
    assert.equal(fs.statSync(ignoreOf(project)).mtimeMs, before.mtimeMs);
    assert.equal(fs.statSync(ignoreOf(project)).ino, before.ino);
    assert.equal(linesOf(logOf(project)).length, 3);
  });

  it("a .gitignore that is a folder or a link is left as it is, and a dangling link is never followed", () => {
    const folder = freshProject();
    fs.mkdirSync(ignoreOf(folder), { recursive: true });
    assert.equal(runGuard(CURRENT.guard, STATUS, folder).code, 0);
    assert.ok(fs.statSync(ignoreOf(folder)).isDirectory());
    assert.deepEqual(fs.readdirSync(ignoreOf(folder)), []);

    const dangling = freshProject();
    const nowhere = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "antaris-guard-nowhere-")), "target");
    fs.mkdirSync(path.dirname(logOf(dangling)), { recursive: true });
    fs.symlinkSync(nowhere, ignoreOf(dangling));
    assert.equal(runGuard(CURRENT.guard, STATUS, dangling).code, 0);
    assert.equal(fs.readlinkSync(ignoreOf(dangling)), nowhere);
    assert.ok(!fs.existsSync(nowhere), "the guard wrote through a link");

    const linked = freshProject();
    const target = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "antaris-guard-target-")), "ignore");
    fs.writeFileSync(target, "theirs\n");
    fs.mkdirSync(path.dirname(logOf(linked)), { recursive: true });
    fs.symlinkSync(target, ignoreOf(linked));
    assert.equal(runGuard(CURRENT.guard, STATUS, linked).code, 0);
    assert.equal(fs.readFileSync(target, "utf8"), "theirs\n");
  });

  it("a .gitignore the guard cannot create is a G17 block through the hook, and nothing is logged", () => {
    const project = freshProject();
    const preload = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "antaris-guard-preload-")), "refuse.cjs");
    // Stands in for a folder that refuses new files, which root's permissions cannot show: creating a .gitignore fails with EACCES.
    fs.writeFileSync(preload, [
      'const fs = require("node:fs");',
      "const open = fs.openSync;",
      'fs.openSync = function (p, flags, ...rest) { if (String(p).endsWith(".gitignore") && flags === "wx") { const e = new Error(`EACCES: permission denied, open \'${p}\'`); e.code = "EACCES"; throw e; } return open.call(this, p, flags, ...rest); };',
    ].join("\n"));
    const run = spawnSync(process.execPath, ["--require", preload, CURRENT.guard], { input: bashCall(STATUS), encoding: "utf8", env: { ...process.env, CLAUDE_PROJECT_DIR: project } });
    assert.equal(run.status, 2);
    assert.match(run.stderr.trim(), /^guard: blocked \(G17 unreadable: could not write the log: .*log\.jsonl: EACCES: permission denied, open '.*\.gitignore'\): git status --short$/);
    assert.ok(!fs.existsSync(logOf(project)), "a decision was logged although the .gitignore could not be made");
    assert.ok(!fs.existsSync(ignoreOf(project)));
  });

  it("the library: a .gitignore it cannot create throws, and one it created but could not write into is removed", () => {
    const file = logOf(projectWith(null));
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const refuse = () => { throw Object.assign(new Error("EACCES: permission denied"), { code: "EACCES" }); };
    assert.throws(() => swapped("openSync", refuse, () => log.append(file, entry())), /EACCES/);
    assert.ok(!fs.existsSync(file));
    const full = () => { throw Object.assign(new Error("ENOSPC: no space left on device, write"), { code: "ENOSPC" }); };
    assert.throws(() => swapped("writeFileSync", full, () => log.append(file, entry())), /ENOSPC/);
    assert.ok(!fs.existsSync(path.join(path.dirname(file), ".gitignore")), "an empty .gitignore was left behind");
    assert.ok(!fs.existsSync(file));
    // The next write, with nothing failing, makes it whole.
    log.append(file, entry());
    assert.equal(fs.readFileSync(path.join(path.dirname(file), ".gitignore"), "utf8"), EXPECTED);
    assert.equal(linesOf(file).length, 1);
  });

  it("the library: a .gitignore replaced by someone else before the failed write is cleaned up stays", () => {
    const file = logOf(projectWith(null));
    const ignore = path.join(path.dirname(file), ".gitignore");
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const replaceThenFail = () => {
      fs.unlinkSync(ignore);
      const fd = fs.openSync(ignore, "w");
      fs.writeSync(fd, "someone else's\n");
      fs.closeSync(fd);
      throw Object.assign(new Error("EIO: i/o error, write"), { code: "EIO" });
    };
    assert.throws(() => swapped("writeFileSync", replaceThenFail, () => log.keepOutOfGit(file)), /EIO/);
    assert.equal(fs.readFileSync(ignore, "utf8"), "someone else's\n");
  });

  it("returns whether it made the file, and never makes a second one", () => {
    const file = logOf(projectWith(null));
    fs.mkdirSync(path.dirname(file), { recursive: true });
    assert.equal(log.keepOutOfGit(file), true);
    assert.equal(log.keepOutOfGit(file), false);
    assert.equal(fs.readFileSync(path.join(path.dirname(file), ".gitignore"), "utf8"), EXPECTED);
  });

  it("names the log by its own file name, in a protected folder of the config's too", () => {
    const project = projectWith({ ...INVENTARIS, protectedPaths: [".claude/", "CLAUDE.md", ".mcp.json", "secrets/"], log: { enabled: true, path: "secrets/guard.jsonl" } });
    assert.equal(runGuard(CURRENT.guard, STATUS, project).code, 0);
    assert.equal(fs.readFileSync(path.join(project, "secrets", ".gitignore"), "utf8"), log.gitignoreText("guard.jsonl"));
    assert.match(log.gitignoreText("guard.jsonl"), /\n\/guard\.jsonl\n\/guard\.jsonl\.lock\n\/\.gitignore\n$/);
  });

  it("escapes what git reads as a pattern or trims, and matches a line break in a name with ?", () => {
    assert.equal(log.ignoreLine("log.jsonl"), "/log.jsonl");
    assert.equal(log.ignoreLine("a*b [x].jsonl"), "/a\\*b\\ \\[x].jsonl");
    assert.equal(log.ignoreLine("what?.jsonl"), "/what\\?.jsonl");
    assert.equal(log.ignoreLine("back\\slash.jsonl"), "/back\\\\slash.jsonl");
    assert.equal(log.ignoreLine("trailing "), "/trailing\\ ");
    assert.equal(log.ignoreLine("#hash!.jsonl"), "/#hash!.jsonl");
    assert.equal(log.ignoreLine("line\nbreak\r.jsonl"), "/line?break?.jsonl");
  });

  it("the subagent hook writes it too, and many hooks at once make exactly one, whole", async () => {
    const project = freshProject();
    assert.equal(runSubagent(CURRENT.subagent, agentCall({ model: "sonnet" }), tempEnv(SETTINGS, project)).code, 0);
    assert.equal(fs.readFileSync(ignoreOf(project), "utf8"), EXPECTED);
    const racing = freshProject();
    const runs = await runGuardParallel(CURRENT.guard, Array.from({ length: 32 }, () => STATUS), racing);
    assert.deepEqual(runs.map((r) => r.code), Array(32).fill(0), runs.filter((r) => r.code !== 0).map((r) => r.stderr).join("\n"));
    assert.equal(fs.readFileSync(ignoreOf(racing), "utf8"), EXPECTED);
    assert.equal(linesOf(logOf(racing)).length, 32);
  });

  it("logging off writes no .gitignore, as it writes no folder", () => {
    const project = projectWith({ ...INVENTARIS, log: { enabled: false } });
    assert.equal(runGuard(CURRENT.guard, STATUS, project).code, 0);
    assert.ok(!fs.existsSync(ignoreOf(project)));
    assert.ok(!fs.existsSync(path.dirname(logOf(project))));
  });
});

describe("verify-log and log", () => {
  it("verify-log: a whole chain, the tip, a wrong tip, a tampered line, no log, the log off", () => {
    const project = freshProject();
    runGuard(CURRENT.guard, STATUS, project);
    runGuard(CURRENT.guard, PUSH, project);
    const rows = linesOf(logOf(project));
    let r = cli(["verify-log"], project);
    assert.equal(r.code, 0, r.stdout + r.stderr);
    assert.match(r.stdout, new RegExp(`^config: .*\\nlog: .*log\\.jsonl\\nok: 2 lines, tip ${rows[1].hash}\\n$`));
    r = cli(["verify-log", "--tip", rows[1].hash], project);
    assert.equal(r.code, 0);
    assert.match(r.stdout, new RegExp(`\\nthe tip given is line 2: every line up to it is as it was when the tip was noted\\nok: 2 lines, tip ${rows[1].hash}\\n$`));
    // A tip noted earlier, with the log grown since: it names its line and passes.
    r = cli(["verify-log", `--tip=${rows[0].hash}`], project);
    assert.equal(r.code, 0);
    assert.match(r.stdout, /\nthe tip given is line 1: every line up to it is as it was when the tip was noted\nok: 2 lines, /);
    // A tip no line carries fails, and says so.
    r = cli(["verify-log", `--tip=${"0".repeat(64)}`], project);
    assert.equal(r.code, 1);
    assert.match(r.stdout, /\nthe tip given is not the hash of any line: the chain up to it was rewritten or cut, or the tip is from another log\n$/);
    const text = fs.readFileSync(logOf(project), "utf8").replace('"rule":"G07"', '"rule":"G06"');
    fs.writeFileSync(logOf(project), text);
    r = cli(["verify-log"], project);
    assert.equal(r.code, 1);
    assert.match(r.stdout, /broken at line 2: hash does not match the line\n$/);
    // Every break is listed, and a fork is named as one: a third line that follows line 1, as line 2 does.
    const first = JSON.parse(text.split("\n")[0]);
    const forked = log.line({ t: first.t, session: "test-session", tool: "Bash", decision: "allow", rule: null, reason: "", cmd_sha256: log.sha256("ls") }, first.hash);
    fs.appendFileSync(logOf(project), JSON.stringify(forked) + "\n");
    r = cli(["verify-log"], project);
    assert.equal(r.code, 1);
    assert.match(r.stdout, /\nbroken at line 2: hash does not match the line\nbroken at line 3: prev is not the hash of line 2; lines 2 and 3 share one prev, which looks like a fork: two hooks appending at once\n$/);
    const shown = cli(["log"], project);
    assert.equal(shown.code, 1);
    assert.match(shown.stdout, /\nchain: broken at line 2: hash does not match the line; 1 more break after it, which verify-log lists\n/);
    fs.rmSync(logOf(project));
    r = cli(["verify-log"], project);
    assert.equal(r.code, 1);
    assert.match(r.stdout, /broken at line 0: could not read .*ENOENT/);
    r = cli(["verify-log"], projectWith({ ...INVENTARIS, log: { enabled: false } }));
    assert.equal(r.code, 1);
    assert.match(r.stdout, /log: off \(the config turns the log off\)\n$/);
    // No config: the defaults say where the log goes, and there is none there yet (round 4b; it was "config: none").
    r = cli(["verify-log"], projectWith(null));
    assert.equal(r.code, 1);
    assert.match(r.stdout, /^config: none at .*; judged by the built-in defaults\nlog: .*log\.jsonl\nbroken at line 0: could not read .*ENOENT/);
    r = cli(["verify-log", "--tip"], project);
    assert.equal(r.code, 1);
    assert.match(r.stderr, /^usage: /);
  });

  it("log: the counts and the size", () => {
    const project = freshProject();
    for (const c of [STATUS, "npm test", "ls", PUSH, PUSH, `cat ${DOT_CLAUDE}/settings.json`]) runGuard(CURRENT.guard, c, project);
    runSubagent(CURRENT.subagent, agentCall({ model: "fable" }), tempEnv(SETTINGS, project));
    const r = cli(["log"], project);
    assert.equal(r.code, 0, r.stdout + r.stderr);
    const rows = linesOf(logOf(project));
    assert.match(r.stdout, new RegExp(`^config: .*\\nlog: .*log\\.jsonl\\nlines: 7, size: ${fs.statSync(logOf(project)).size} bytes\\nchain: holds, tip ${rows[6].hash}\\nby decision: allow 3, deny 4\\nby rule: G07 2, G16 1, subagent-guard 1\\nby day: \\d{4}-\\d{2}-\\d{2} 7\\nby session: test-session 7\\nby tool: Agent 1, Bash 6\\n$`));
    const text = fs.readFileSync(logOf(project), "utf8").replace('"decision":"allow"', '"decision":"deny"');
    fs.writeFileSync(logOf(project), text);
    const broken = cli(["log"], project);
    assert.equal(broken.code, 1);
    assert.match(broken.stdout, /chain: broken at line 1: hash does not match the line\n/);
  });
});
