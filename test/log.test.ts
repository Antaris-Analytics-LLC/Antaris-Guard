import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import { CURRENT, INVENTARIS, ROOT, agentCall, logOf, projectWith, runGuard, runGuardParallel, runGuardRaw, runSubagent, tempEnv } from "./harness.ts";
import { SETTINGS } from "./tables/subagent.ts";

/*
 * The decision log: lib/log.js as a library (the chain, what verify() finds), the hooks writing
 * it (every decision, allows included, the command's hash and never its text, a log that cannot
 * be written blocking, logging off, the subagent hook in the same chain), many hook processes
 * appending at once, the lock's recovery, the verify-log and log commands, and the .gitignore
 * line that keeps the log out of the repository.
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
    assert.deepEqual(log.verify(file), { ok: true, lines: 2, tip: b.hash });
    assert.equal(log.verify(file, { tip: b.hash }).ok, true);
    assert.match(log.verify(file, { tip: "abc" }).reason, /^the chain ends at [0-9a-f]{64}, not at the tip abc$/);
    assert.deepEqual(linesOf(file), [a, b]);
  });

  it("verify() names the first line that does not hold: changed, deleted, inserted, truncated, the wrong version, not genesis", () => {
    const file = fiveLines();
    const good = fs.readFileSync(file, "utf8");
    const rows = good.trim().split("\n");
    const written = (text: string) => { fs.writeFileSync(file, text); return log.verify(file); };
    assert.deepEqual(log.verify(file).ok, true);
    // A field changed on line 3: its hash no longer matches.
    assert.deepEqual(written([...rows.slice(0, 2), rows[2].replace('"decision":"allow"', '"decision":"deny"'), ...rows.slice(3)].join("\n") + "\n"), { ok: false, line: 3, reason: "hash does not match the line" });
    // Line 3 deleted: line 4 (now the third) points at a hash that is not before it.
    assert.deepEqual(written([...rows.slice(0, 2), ...rows.slice(3)].join("\n") + "\n"), { ok: false, line: 3, reason: "prev is not the hash of line 2" });
    // A line inserted after line 2, with a good hash of its own but the wrong prev.
    const forged = log.line(entry({ cmd_sha256: log.sha256("forged") }), "0".repeat(64));
    assert.deepEqual(written([...rows.slice(0, 2), JSON.stringify(forged), ...rows.slice(2)].join("\n") + "\n"), { ok: false, line: 3, reason: "prev is not the hash of line 2" });
    // The last line cut short, as a crash mid-write would leave it.
    assert.deepEqual(written(good.slice(0, -20)), { ok: false, line: 5, reason: "not JSON" });
    // The wrong shape version, a first line that is not genesis, and a field the shape does not have.
    assert.deepEqual(written(rows[0].replace('"v":1', '"v":2') + "\n"), { ok: false, line: 1, reason: "v is 2, not 1" });
    assert.deepEqual(written(rows[1] + "\n"), { ok: false, line: 1, reason: "prev is not genesis" });
    const extra = JSON.parse(rows[0]); extra.note = "x";
    assert.deepEqual(written(JSON.stringify(extra) + "\n"), { ok: false, line: 1, reason: "unknown field note" });
    // Not JSON at all, and no file.
    assert.deepEqual(written("{\n"), { ok: false, line: 1, reason: "not JSON" });
    fs.rmSync(file);
    assert.match(log.verify(file).reason, /^could not read .*ENOENT/);
    assert.equal(log.verify(file).line, 0);
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
    assert.deepEqual(log.verify(logOf(project)), { ok: true, lines: 3, tip: rows[2].hash });
    assert.ok(!fs.existsSync(`${logOf(project)}.lock`), "the lock was left behind");
    assert.match(new Date(rows[0].t as string).toISOString(), /^\d{4}-\d{2}-\d{2}T/);
  });

  it("a missing config logs nothing, since there is no path to log to", () => {
    const project = projectWith(null);
    assert.equal(runGuard(CURRENT.guard, STATUS, project).code, 2);
    assert.ok(!fs.existsSync(path.join(project, ".claude", "guard")));
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

  it("the subagent hook fails closed on a missing config, an unwritable log, and a lib/ it cannot load", () => {
    const missing = runSubagent(CURRENT.subagent, agentCall({ model: "sonnet" }), tempEnv(SETTINGS, projectWith(null)));
    assert.equal(missing.code, 2);
    assert.match(missing.stderr, /^subagent-guard: blocked \(could not read the config: .* is missing/);
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
    assert.deepEqual(log.verify(logOf(project)), { ok: true, lines: 64, tip: rows[63].hash });
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

  it(".gitignore keeps the log out of the repository", () => {
    const lines = fs.readFileSync(path.join(ROOT, ".gitignore"), "utf8").split("\n");
    assert.ok(lines.includes(`${DOT_CLAUDE}/guard/`), ".gitignore does not list the guard folder");
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
    assert.match(r.stdout, /\(matches the tip given\)\n$/);
    r = cli(["verify-log", `--tip=${rows[0].hash}`], project);
    assert.equal(r.code, 1);
    assert.match(r.stdout, /broken at line 2: the chain ends at [0-9a-f]{64}, not at the tip [0-9a-f]{64}\n$/);
    const text = fs.readFileSync(logOf(project), "utf8").replace('"rule":"G07"', '"rule":"G06"');
    fs.writeFileSync(logOf(project), text);
    r = cli(["verify-log"], project);
    assert.equal(r.code, 1);
    assert.match(r.stdout, /broken at line 2: hash does not match the line\n$/);
    fs.rmSync(logOf(project));
    r = cli(["verify-log"], project);
    assert.equal(r.code, 1);
    assert.match(r.stdout, /broken at line 0: could not read .*ENOENT/);
    r = cli(["verify-log"], projectWith({ ...INVENTARIS, log: { enabled: false } }));
    assert.equal(r.code, 1);
    assert.match(r.stdout, /log: off \(the config turns the log off\)\n$/);
    r = cli(["verify-log"], projectWith(null));
    assert.equal(r.code, 1);
    assert.match(r.stdout, /^config: none \(.* is missing/);
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
