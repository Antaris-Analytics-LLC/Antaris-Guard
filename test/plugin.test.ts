import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { CURRENT, DEFAULTS, INVENTARIS, ROOT, agentCall, bashCall, logOf, projectWith, runGuard, runGuardWithArgs, runSubagent, tempEnv } from "./harness.ts";

/*
 * Round 4b: the guard as a plugin. Three things this file holds.
 *
 * The fallback. A project with no config file is judged by a fallback instead of blocked (Jake,
 * 2026-10-19): the built-in DEFAULTS, or configs/<name>.json beside lib/ when the hook is started
 * with --fallback <name>. Everything else about the config still fails closed: a file that is
 * there but cannot be read or is not JSON or fails validation, a fallback name that is not
 * lowercase words joined by hyphens, a fallback file that is not there, and arguments the hook
 * does not take.
 *
 * Jake's config, configs/antaris-analytics.json: the defaults plus aws in blockedPrograms;
 * ANTHROPIC_API_KEY, PARSICLAUDE_TOKENS and COGNITO_CLIENT_SECRET in secretEnv; *.env in
 * secretPaths; python and pip allowed. Only his organization's edition of the plugin names it.
 *
 * The marketplace file at the repository root: two editions of one plugin, each wiring both hooks
 * with onFailure: block, run here the way Claude Code runs them.
 */
const require = createRequire(import.meta.url);
const config = require(path.join(ROOT, "lib", "config.js"));

const ORG = "antaris-analytics";
const ORG_FILE = path.join(ROOT, "configs", `${ORG}.json`);
const ORG_CONFIG: Record<string, unknown> = JSON.parse(fs.readFileSync(ORG_FILE, "utf8"));
const MARKETPLACE_FILE = path.join(ROOT, ".claude-plugin", "marketplace.json");
const MARKETPLACE = JSON.parse(fs.readFileSync(MARKETPLACE_FILE, "utf8"));
const PUSH = "git push origin main";
const PYTHON = "python3 -c 'print(1)'";
/** The decision log's lines, parsed. */
const linesOf = (file: string): Record<string, unknown>[] => fs.readFileSync(file, "utf8").trim().split("\n").map((l) => JSON.parse(l));

describe("the hook's one argument, --fallback <name>", () => {
  it("none, or --fallback and a name; anything else throws", () => {
    assert.equal(config.fallbackArg([]), undefined);
    assert.equal(config.fallbackArg(["--fallback", ORG]), ORG);
    for (const argv of [["--fallback"], ["antaris-analytics"], ["--fallback", ORG, "x"], ["--fallback=antaris-analytics"], ["-f", ORG]]) {
      assert.throws(() => config.fallbackArg(argv), /the hook takes no arguments but --fallback <name>/, argv.join(" "));
    }
  });
});

describe("resolveConfig: the project's file, else the fallback", () => {
  it("a project file wins, fallback or not", () => {
    const dir = projectWith(INVENTARIS);
    for (const fallback of [undefined, ORG]) {
      const found = config.resolveConfig(dir, fallback);
      assert.equal(found.source, "project");
      assert.equal(found.path, config.configPath(dir));
      assert.deepEqual(found.raw, INVENTARIS);
    }
  });

  it("no file and no fallback named: the built-in defaults", () => {
    const found = config.resolveConfig(projectWith(null), undefined);
    assert.deepEqual([found.source, found.path], ["defaults", null]);
    assert.equal(found.raw, DEFAULTS);
  });

  it("no file and a fallback named: configs/<name>.json beside lib/", () => {
    const found = config.resolveConfig(projectWith(null), ORG);
    assert.deepEqual([found.source, found.path], [`fallback ${ORG}`, ORG_FILE]);
    assert.deepEqual(found.raw, ORG_CONFIG);
    assert.equal(config.FALLBACK_DIR, path.join(ROOT, "configs"));
  });

  it("a fallback name that could reach outside configs/, or is not lowercase words joined by hyphens, throws", () => {
    for (const name of ["../antaris-analytics", "configs/antaris-analytics", "Antaris-Analytics", "antaris_analytics", "antaris-", "-antaris", "", ".", "..", "antaris analytics"]) {
      assert.throws(() => config.resolveConfig(projectWith(null), name), /the fallback's name must be lowercase words joined by hyphens/, JSON.stringify(name));
    }
  });

  it("a fallback that is not a file in configs/ throws", () => {
    assert.throws(() => config.resolveConfig(projectWith(null), "no-such-config"), /the fallback .*no-such-config\.json could not be read: ENOENT/);
  });

  it("a project file that is there but unreadable or not JSON still throws, fallback or not", () => {
    const dir = projectWith(null);
    fs.mkdirSync(config.configPath(dir), { recursive: true }); // a directory where the file should be
    for (const fallback of [undefined, ORG]) assert.throws(() => config.resolveConfig(dir, fallback), /could not be read: EISDIR/);
    for (const fallback of [undefined, ORG]) assert.throws(() => config.resolveConfig(projectWith(null, "{ version: 1 "), fallback), /is not JSON: /);
  });
});

describe("the Bash hook with no config file", () => {
  it("without --fallback, the defaults judge: aws and python run, curl and a push to main do not", () => {
    const dir = projectWith(null);
    for (const command of ["aws s3 ls", PYTHON, "git status --short"]) assert.equal(runGuard(CURRENT.guard, command, dir).decision, "allow", command);
    assert.match(runGuard(CURRENT.guard, "curl https://example.com", dir).reason, /^G01 blocked-program: /);
    assert.match(runGuard(CURRENT.guard, PUSH, dir).reason, /^G07 push-to-protected: /);
  });

  it("with --fallback antaris-analytics, Jake's config judges: aws, a new secret and a *.env read are blocked, python runs", () => {
    const dir = projectWith(null);
    const org = (command: string) => runGuardWithArgs(CURRENT.guard, ["--fallback", ORG], command, dir);
    assert.match(org("aws s3 ls").reason, /^G01 blocked-program: /);
    assert.match(org("PARSICLAUDE_TOKENS=x npm test").reason, /^G09 secret-on-command-line: /);
    assert.match(org("ANTHROPIC_API_KEY=x node app.js").reason, /^G09 secret-on-command-line: /);
    assert.match(org("cat prod.env").reason, /^G12 reads-secret-file: /);
    assert.match(org(PUSH).reason, /^G07 push-to-protected: /);
    for (const command of [PYTHON, "pip install -r requirements.txt", "git status --short", "npm test"]) assert.equal(org(command).decision, "allow", command);
  });

  it("names Jake as the operator in G16's reason under his config, and the operator under the defaults", () => {
    const dir = projectWith(null);
    const name = "." + "claude"; // spelled in two parts so this file never carries the protected name as one word
    // The whole stderr line: the harness's reason stops at the first closing bracket, inside G16's list of names.
    assert.match(runGuardWithArgs(CURRENT.guard, ["--fallback", ORG], `cat ${name}/settings.json`, dir).stderr, /are changed by Jake, not by a session/);
    assert.match(runGuard(CURRENT.guard, `cat ${name}/settings.json`, dir).stderr, /are changed by the operator, not by a session/);
  });

  it("with a config file, --fallback changes nothing: the file judges", () => {
    const dir = projectWith(INVENTARIS);
    assert.match(runGuardWithArgs(CURRENT.guard, ["--fallback", ORG], PYTHON, dir).reason, /^G01 blocked-program: /);
    assert.equal(runGuardWithArgs(CURRENT.guard, ["--fallback", ORG], "aws s3 ls", dir).decision, "allow");
  });

  it("logs under the fallback's log path, in the same chain the project's file would use", () => {
    const dir = projectWith(null);
    runGuardWithArgs(CURRENT.guard, ["--fallback", ORG], "aws s3 ls", dir);
    runGuard(CURRENT.guard, "ls", dir);
    const rows = linesOf(logOf(dir));
    assert.deepEqual(rows.map((r) => [r.decision, r.rule]), [["deny", "G01"], ["allow", null]]);
  });

  it("fails closed on a fallback it cannot read, a bad name, arguments it does not take, and a broken project file", () => {
    const dir = projectWith(null);
    const blocked = (args: string[], project = dir) => runGuardWithArgs(CURRENT.guard, args, "ls", project);
    let r = blocked(["--fallback", "no-such-config"]);
    assert.equal(r.code, 2);
    assert.match(r.stderr, /^guard: blocked \(G17 unreadable: could not read the config: the fallback .*no-such-config\.json could not be read: ENOENT\): ls$/);
    r = blocked(["--fallback", "../antaris-analytics"]);
    assert.equal(r.code, 2);
    assert.match(r.stderr, /could not read the config: the fallback's name must be lowercase words joined by hyphens/);
    for (const args of [["--fallback"], ["--fail-open"], ["--fallback", ORG, "--again"]]) {
      r = blocked(args);
      assert.equal(r.code, 2, args.join(" "));
      assert.match(r.stderr, /^guard: blocked \(G17 unreadable: could not read the config: the hook takes no arguments but --fallback <name>/);
    }
    r = blocked(["--fallback", ORG], projectWith(null, "nope"));
    assert.equal(r.code, 2);
    assert.match(r.stderr, /could not read the config: .*guard\.config\.json is not JSON/);
    r = blocked(["--fallback", ORG], projectWith({ version: 1, rules: { G07: "off" } }));
    assert.equal(r.code, 2);
    assert.match(r.stderr, /the config is not valid: rules\.G07 cannot be off/);
  });

  it("a tool call that is not JSON is still a block under a fallback", () => {
    const run = spawnSync(process.execPath, [CURRENT.guard, "--fallback", ORG], { input: "not json", encoding: "utf8", env: { ...process.env, CLAUDE_PROJECT_DIR: projectWith(null) } });
    assert.equal(run.status, 2);
    assert.equal(run.stderr.trim(), "guard: blocked (G17 unreadable: could not read the tool call)");
  });
});

describe("the subagent hook with no config file", () => {
  const SETTINGS = { CLAUDE_CODE_SUBAGENT_MODEL: "sonnet" };

  it("judges by the fallback and logs where it says, with or without --fallback", () => {
    for (const args of [[], ["--fallback", ORG]]) {
      const dir = projectWith(null);
      const env = tempEnv(SETTINGS, dir);
      assert.equal(runSubagent(CURRENT.subagent, agentCall({ model: "sonnet" }), env, args).code, 0, args.join(" "));
      assert.equal(runSubagent(CURRENT.subagent, agentCall({ model: "fable" }), env, args).code, 2, args.join(" "));
      assert.deepEqual(linesOf(logOf(dir)).map((r) => [r.tool, r.decision]), [["Agent", "allow"], ["Agent", "deny"]]);
    }
  });

  it("fails closed on a fallback it cannot read and on arguments it does not take", () => {
    const env = tempEnv(SETTINGS, projectWith(null));
    const missing = runSubagent(CURRENT.subagent, agentCall({ model: "sonnet" }), env, ["--fallback", "no-such-config"]);
    assert.equal(missing.code, 2);
    assert.match(missing.stderr, /^subagent-guard: blocked \(could not read the config: the fallback .*no-such-config\.json could not be read: ENOENT\)$/);
    const wrong = runSubagent(CURRENT.subagent, agentCall({ model: "sonnet" }), env, ["--open"]);
    assert.equal(wrong.code, 2);
    assert.match(wrong.stderr, /^subagent-guard: blocked \(could not read the config: the hook takes no arguments but --fallback <name>/);
  });
});

describe("configs/antaris-analytics.json, Jake's own config", () => {
  it("validates, with Jake as the operator", () => {
    const v = config.validate(ORG_CONFIG);
    assert.equal(v.operator, "Jake");
    assert.deepEqual(v.rules, {});
    assert.deepEqual(v.log, { enabled: true, path: ".claude/guard/log.jsonl" });
  });

  it("is the defaults plus exactly what Jake listed, and nothing else", () => {
    const v = config.validate(ORG_CONFIG);
    const plus = (key: string, added: string[]) => [...(DEFAULTS[key] as string[]), ...added];
    assert.deepEqual([...v.blockedPrograms].sort(), plus("blockedPrograms", ["aws"]).sort());
    assert.deepEqual([...v.secretEnv].sort(), plus("secretEnv", ["ANTHROPIC_API_KEY", "PARSICLAUDE_TOKENS", "COGNITO_CLIENT_SECRET"]).sort());
    assert.deepEqual([...v.secretPaths].sort(), plus("secretPaths", ["*.env"]).sort());
    for (const key of ["protectedBranches", "protectedPaths", "credentialPaths"]) assert.deepEqual(v[key], DEFAULTS[key], key);
    for (const p of ["python", "python3", "pip", "pip3"]) assert.ok(!v.blockedPrograms.includes(p), `${p} should stay allowed`);
  });
});

describe("the marketplace file: two editions of one plugin", () => {
  type Hook = { type: string; command: string; args: string[]; onFailure: string };
  type Entry = { name: string; source: string; description: string; hooks: { PreToolUse: { matcher: string; hooks: Hook[] }[] } };
  const entries: Entry[] = MARKETPLACE.plugins;
  const plugin = (name: string): Entry => { const e = entries.find((p) => p.name === name); assert.ok(e, `no entry named ${name}`); return e; };
  const argsOf = (e: Entry, matcher: string): string[] => { const m = e.hooks.PreToolUse.find((h) => h.matcher === matcher); assert.ok(m, `${e.name} has no ${matcher} hook`); assert.equal(m.hooks.length, 1); return m.hooks[0].args; };

  it("is the antaris-guard marketplace with exactly the two editions, both from the repository root", () => {
    assert.equal(MARKETPLACE.name, "antaris-guard");
    assert.equal(MARKETPLACE.owner.name, "Antaris Analytics LLC");
    assert.deepEqual(entries.map((e) => e.name), ["antaris-guard", "antaris-guard-antaris-analytics"]);
    for (const e of entries) {
      assert.equal(e.source, "./", e.name);
      assert.ok(e.description.length > 0, e.name);
      assert.deepEqual(Object.keys(e.hooks), ["PreToolUse"], e.name);
      assert.deepEqual(e.hooks.PreToolUse.map((h) => h.matcher), ["Bash", "Agent|Task"], e.name);
    }
  });

  it("wires both hooks the way the settings block does: node, the file under the plugin root, onFailure block", () => {
    for (const e of entries) {
      for (const { hooks } of e.hooks.PreToolUse) {
        for (const h of hooks) {
          assert.deepEqual([h.type, h.command, h.onFailure], ["command", "node", "block"], e.name);
          assert.match(h.args[0], /^\$\{CLAUDE_PLUGIN_ROOT\}\/(guard|subagent-guard)\.js$/, e.name);
          assert.ok(fs.existsSync(h.args[0].replace("${CLAUDE_PLUGIN_ROOT}", ROOT)), h.args[0]);
        }
      }
    }
    assert.equal(argsOf(plugin("antaris-guard"), "Bash")[0], "${CLAUDE_PLUGIN_ROOT}/guard.js");
    assert.equal(argsOf(plugin("antaris-guard"), "Agent|Task")[0], "${CLAUDE_PLUGIN_ROOT}/subagent-guard.js");
  });

  it("the public edition names no fallback, so the generic defaults stand in; the org edition names Jake's config", () => {
    for (const matcher of ["Bash", "Agent|Task"]) {
      assert.equal(argsOf(plugin("antaris-guard"), matcher).length, 1, matcher);
      assert.deepEqual(argsOf(plugin("antaris-guard-antaris-analytics"), matcher).slice(1), ["--fallback", ORG], matcher);
    }
    assert.ok(fs.existsSync(ORG_FILE));
  });

  it("has no plugin.json and no hooks/hooks.json at the root, so each edition's hooks are only its own", () => {
    assert.ok(!fs.existsSync(path.join(ROOT, ".claude-plugin", "plugin.json")));
    assert.ok(!fs.existsSync(path.join(ROOT, "hooks", "hooks.json")));
  });

  it("each edition's Bash hook, run as Claude Code runs it in a folder with no config, judges by its own fallback", () => {
    const dir = projectWith(null);
    const run = (e: Entry, command: string) => {
      const args = argsOf(e, "Bash").map((a) => a.replace("${CLAUDE_PLUGIN_ROOT}", ROOT));
      return spawnSync("node", args, { input: bashCall(command), encoding: "utf8", env: { ...process.env, CLAUDE_PROJECT_DIR: dir } });
    };
    assert.equal(run(plugin("antaris-guard"), "aws s3 ls").status, 0);
    const org = run(plugin("antaris-guard-antaris-analytics"), "aws s3 ls");
    assert.equal(org.status, 2);
    assert.match(org.stderr, /^guard: blocked \(G01 blocked-program: /);
    for (const e of entries) assert.equal(run(e, PUSH).status, 2, e.name);
  });
});
