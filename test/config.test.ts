import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import { CURRENT, DEFAULTS, INVENTARIS, ROOT, defaultsProject, inventarisProject, projectWith, runGuard, runGuardWithCwd } from "./harness.ts";
import * as bash from "./tables/bash.ts";

/*
 * lib/config.js: the defaults, the worked example, the lookup of the file, each kind of invalid
 * file, and what the hook does with no file (blocks everything, naming the file), an unreadable
 * one, and one that fails validation. Then the rules that read config, each with a custom value
 * that blocks and one that allows, and the comparison the roadmap asks for: which cases of the
 * v0.1 table come out differently under the built-in defaults than under configs/inventaris.json.
 */
const require = createRequire(import.meta.url);
const config = require(path.join(ROOT, "lib", "config.js"));
const { judge } = require(path.join(ROOT, "lib", "judge.js"));

const PUSH = "git push origin main";
const DOT_CLAUDE = "." + "claude"; // spelled in two parts so the file itself never carries the protected name as one word

describe("the defaults and the worked example", () => {
  it("DEFAULTS validate unchanged, with no operator and an empty rules map", () => {
    const v = config.validate(DEFAULTS);
    assert.deepEqual(v, { ...DEFAULTS, rules: {} });
    assert.equal(v.operator, undefined);
    assert.ok(Object.isFrozen(DEFAULTS));
  });

  it("DEFAULTS leave python and pip out of blockedPrograms and COGNITO_CLIENT_SECRET out of secretEnv", () => {
    for (const p of ["python", "python3", "pip", "pip3"]) assert.ok(!(DEFAULTS.blockedPrograms as string[]).includes(p), p);
    assert.ok(!(DEFAULTS.secretEnv as string[]).includes("COGNITO_CLIENT_SECRET"));
  });

  it("configs/inventaris.json validates and is the v0.1 set: Jake, python and pip blocked, COGNITO in secretEnv", () => {
    const v = config.validate(INVENTARIS);
    assert.equal(v.operator, "Jake");
    for (const p of ["python", "python3", "pip", "pip3"]) assert.ok(v.blockedPrograms.includes(p), p);
    assert.ok(v.secretEnv.includes("COGNITO_CLIENT_SECRET"));
    assert.deepEqual(v.protectedBranches, ["main", "master"]);
    assert.deepEqual(v.secretPaths, [".env", ".env.*", "*.pem", "*.key", "*.p12"]);
    assert.deepEqual(v.credentialPaths, ["~/.aws", "~/.ssh", "~/.config", "~/.netrc", "~/.npmrc"]);
    assert.deepEqual(v.rules, {});
  });

  it("fills the defaults in for keys a file leaves out, and a given list replaces the default rather than adding to it", () => {
    const v = config.validate({ version: 1, blockedPrograms: ["sudo"] });
    assert.deepEqual(v.blockedPrograms, ["sudo"]);
    assert.deepEqual(v.protectedBranches, DEFAULTS.protectedBranches);
    assert.deepEqual(v.secretEnv, DEFAULTS.secretEnv);
  });
});

describe("finding the file", () => {
  it("CLAUDE_PROJECT_DIR wins, then the hook's cwd, then the process working directory", () => {
    assert.equal(config.projectDir({ env: { CLAUDE_PROJECT_DIR: "/a" }, cwd: "/b" }), "/a");
    assert.equal(config.projectDir({ env: {}, cwd: "/b" }), "/b");
    assert.equal(config.projectDir({ env: {} }), process.cwd());
    assert.equal(config.configPath("/a"), path.join("/a", ".claude", "guard.config.json"));
  });

  it("a missing file throws, naming the file and who writes it", () => {
    const dir = projectWith(null);
    assert.throws(() => config.readConfig(dir), (err: Error) => {
      assert.ok(err.message.includes(config.configPath(dir)), err.message);
      assert.match(err.message, /is missing; the operator writes it, following configs\/README\.md/);
      return true;
    });
  });

  it("a file that cannot be read throws with the system's code", () => {
    const dir = projectWith(null);
    fs.mkdirSync(path.join(dir, ".claude", "guard.config.json"), { recursive: true }); // a directory where the file should be
    assert.throws(() => config.readConfig(dir), /could not be read: EISDIR/);
  });

  it("a file that is not JSON throws, saying so", () => {
    const dir = projectWith(null, "{ version: 1 ");
    assert.throws(() => config.readConfig(dir), /is not JSON: /);
  });

  it("a good file reads and validates through load()", () => {
    const dir = projectWith(INVENTARIS);
    const { config: v, path: file } = config.load({ env: { CLAUDE_PROJECT_DIR: dir } });
    assert.equal(v.operator, "Jake");
    assert.equal(file, config.configPath(dir));
  });
});

describe("validation", () => {
  const bad: [name: string, raw: unknown, message: RegExp][] = [
    ["nothing", undefined, /no config was given/],
    ["null", null, /no config was given/],
    ["a list", [], /must be a JSON object/],
    ["a string", "x", /must be a JSON object/],
    ["no version", {}, /version is required and must be 1/],
    ["version 2", { version: 2 }, /version must be 1/],
    ["version as a string", { version: "1" }, /version must be 1/],
    ["an unknown key", { version: 1, foo: 1 }, /unknown key "foo"/],
    ["a $comment key", { version: 1, $comment: "x" }, /unknown key "\$comment"/],
    ["a key a later round reads", { version: 1, packs: ["node"] }, /unknown key "packs"/],
    ["another key a later round reads", { version: 1, scan: { enabled: true } }, /unknown key "scan"/],
    ["an empty operator", { version: 1, operator: " " }, /operator must be a non-empty string/],
    ["an operator that is not a string", { version: 1, operator: 7 }, /operator must be a non-empty string/],
    ["a list given as a string", { version: 1, blockedPrograms: "sudo" }, /blockedPrograms must be a list of strings/],
    ["a list with a number in it", { version: 1, protectedPaths: [".claude/", 7] }, /protectedPaths must be a list of non-empty strings/],
    ["a list with an empty string", { version: 1, credentialPaths: [""] }, /credentialPaths must be a list of non-empty strings/],
    ["a program name with a space", { version: 1, blockedPrograms: ["sudo su"] }, /blockedPrograms: "sudo su" has whitespace in it/],
    ["an empty protectedBranches", { version: 1, protectedBranches: [] }, /protectedBranches cannot be empty: G07 is never off/],
    ["an empty secretEnv", { version: 1, secretEnv: [] }, /secretEnv cannot be empty: G09 is never off/],
    ["an empty secretPaths", { version: 1, secretPaths: [] }, /secretPaths cannot be empty: G12 is never off/],
    ["a secretEnv entry that is not a variable name", { version: 1, secretEnv: ["1TOKEN"] }, /secretEnv: "1TOKEN" is not an environment variable name/],
    ["a secretPaths entry with a slash", { version: 1, secretPaths: ["config/.env"] }, /secretPaths: "config\/.env" is a path, not a file name pattern/],
    ["rules as a list", { version: 1, rules: ["G01"] }, /rules must be an object/],
    ["a rule id the guard does not have", { version: 1, rules: { G99: "off" } }, /rules.G99 names a rule the guard does not have/],
    ["a rule set to ask", { version: 1, rules: { G01: "ask" } }, /rules.G01 must be "deny" or "off", not "ask"; the ask tier is not in this version/],
    ["a rule set to allow", { version: 1, rules: { G01: "allow" } }, /rules.G01 must be "deny" or "off", not "allow"/],
    ["a rule set to true", { version: 1, rules: { G01: true } }, /rules.G01 must be "deny" or "off"/],
    ["G02 off", { version: 1, rules: { G02: "off" } }, /rules.G02 cannot be off/],
    ["G06 off", { version: 1, rules: { G06: "off" } }, /rules.G06 cannot be off/],
    ["G07 off", { version: 1, rules: { G07: "off" } }, /rules.G07 cannot be off/],
    ["G09 off", { version: 1, rules: { G09: "off" } }, /rules.G09 cannot be off/],
    ["G10 off", { version: 1, rules: { G10: "off" } }, /rules.G10 cannot be off/],
    ["G12 off", { version: 1, rules: { G12: "off" } }, /rules.G12 cannot be off/],
    ["G16 off", { version: 1, rules: { G16: "off" } }, /rules.G16 cannot be off/],
    ["G17 off", { version: 1, rules: { G17: "off" } }, /rules.G17 cannot be off/],
    ["a pack rule off", { version: 1, rules: { "aws-cdk-01": "off" } }, /rules.aws-cdk-01 cannot be off yet; pack rules move to packs in a later version/],
    ["another pack rule off", { version: 1, rules: { "docker-01": "off" } }, /rules.docker-01 cannot be off yet/],
  ];
  for (const [name, raw, message] of bad) {
    it(`refuses ${name}`, () => {
      assert.throws(() => config.validate(raw), message);
    });
  }

  it("accepts deny for any rule, and off for an optional one", () => {
    const v = config.validate({ version: 1, rules: { G01: "off", G07: "deny", G17: "deny", G18: "off", "aws-cdk-01": "deny" } });
    assert.deepEqual(v.rules, { G01: "off", G07: "deny", G17: "deny", G18: "off", "aws-cdk-01": "deny" });
  });

  it("names the never-off set the spec gives, G24 to join when it lands", () => {
    assert.deepEqual(config.NEVER_OFF, ["G02", "G06", "G07", "G09", "G10", "G12", "G16", "G17"]);
    assert.deepEqual(config.KEYS, ["version", "operator", "protectedBranches", "protectedPaths", "secretPaths", "secretEnv", "credentialPaths", "blockedPrograms", "rules", "log"]);
  });

  const badLog: [name: string, raw: unknown, message: RegExp][] = [
    ["log as a string", { version: 1, log: "on" }, /log must be an object with enabled and path/],
    ["an unknown log key", { version: 1, log: { enabled: true, rotate: true } }, /unknown key "log\.rotate"/],
    ["log.enabled as a string", { version: 1, log: { enabled: "yes" } }, /log\.enabled must be true or false/],
    ["an empty log.path", { version: 1, log: { path: "" } }, /log\.path must be a non-empty string/],
    ["log.path as a number", { version: 1, log: { path: 7 } }, /log\.path must be a non-empty string/],
    ["an absolute log.path", { version: 1, log: { path: "/var/log/guard.jsonl" } }, /log\.path must be under \.claude\/ or a folder in protectedPaths, not "\/var\/log\/guard\.jsonl": an absolute path/],
    ["a Windows absolute log.path", { version: 1, log: { path: "C:\\guard.jsonl" } }, /an absolute path/],
    ["a log.path with .. in it", { version: 1, log: { path: ".claude/../guard.jsonl" } }, /a path with \.\. in it can leave the protected folder/],
    ["a log.path at the project root", { version: 1, log: { path: "guard.jsonl" } }, /not "guard\.jsonl": a log the session's shell can name is a log it can edit/],
    ["a log.path under an unprotected folder", { version: 1, log: { path: "logs/guard.jsonl" } }, /a log the session's shell can name is a log it can edit/],
    ["a log.path under a protected file, which is not a folder", { version: 1, protectedPaths: ["CLAUDE.md"], log: { path: "CLAUDE.md/guard.jsonl" } }, /a log the session's shell can name/],
    ["a log.path that is the folder itself", { version: 1, log: { path: ".claude/" } }, /a log the session's shell can name/],
    ["a log.path that is a folder under .claude", { version: 1, log: { path: ".claude/guard/" } }, /it names a folder, not a file/],
  ];
  for (const [name, raw, message] of badLog) {
    it(`refuses ${name}`, () => {
      assert.throws(() => config.validate(raw), message);
    });
  }

  it("accepts a log under .claude/ or under a folder in protectedPaths, with the defaults filled in", () => {
    assert.deepEqual(config.validate({ version: 1 }).log, { enabled: true, path: ".claude/guard/log.jsonl" });
    assert.deepEqual(config.validate({ version: 1, log: { enabled: false } }).log, { enabled: false, path: ".claude/guard/log.jsonl" });
    assert.deepEqual(config.validate({ version: 1, log: { path: ".claude/decisions.jsonl" } }).log, { enabled: true, path: ".claude/decisions.jsonl" });
    assert.deepEqual(config.validate({ version: 1, protectedPaths: ["secrets/"], log: { path: "secrets/guard/log.jsonl" } }).log, { enabled: true, path: "secrets/guard/log.jsonl" });
    assert.deepEqual(config.validate({ version: 1, log: { path: ".claude\\guard\\log.jsonl" } }).log, { enabled: true, path: ".claude/guard/log.jsonl" });
    assert.deepEqual(config.validate(INVENTARIS).log, { enabled: true, path: ".claude/guard/log.jsonl" });
    assert.deepEqual(config.LOG_KEYS, ["enabled", "path"]);
  });
});

describe("the hook and the config file", () => {
  it("no file blocks every command with G17, naming the missing file and who writes it", () => {
    const dir = projectWith(null);
    for (const command of [PUSH, "git status --short", "ls"]) {
      const r = runGuard(CURRENT.guard, command, dir);
      assert.equal(r.code, 2, r.stderr);
      assert.match(r.stderr, /^guard: blocked \(G17 unreadable: could not read the config: .*guard\.config\.json is missing; the operator writes it, following configs\/README\.md\): /);
      assert.ok(r.stderr.endsWith(`): ${command}`), r.stderr);
    }
  });

  it("a file that is not JSON blocks every command with G17", () => {
    const r = runGuard(CURRENT.guard, "ls", projectWith(null, "nope"));
    assert.equal(r.code, 2);
    assert.match(r.stderr, /^guard: blocked \(G17 unreadable: could not read the config: .*guard\.config\.json is not JSON: /);
  });

  it("a file that fails validation blocks every command with G17 and the validation message", () => {
    for (const [raw, message] of [
      [{ version: 1, rules: { G07: "off" } }, /the config is not valid: rules\.G07 cannot be off/],
      [{ version: 1, packs: ["node"] }, /the config is not valid: unknown key "packs"/],
      [{ operator: "Jake" }, /the config is not valid: version is required and must be 1/],
    ] as [unknown, RegExp][]) {
      const r = runGuard(CURRENT.guard, "ls", projectWith(raw));
      assert.equal(r.code, 2, r.stderr);
      assert.match(r.stderr, /^guard: blocked \(G17 unreadable: /);
      assert.match(r.stderr, message);
    }
  });

  it("with no CLAUDE_PROJECT_DIR, the file is found under the tool call's cwd", () => {
    assert.equal(runGuardWithCwd(CURRENT.guard, "git status --short", inventarisProject()).code, 0);
    const r = runGuardWithCwd(CURRENT.guard, PUSH, inventarisProject());
    assert.equal(r.code, 2);
    assert.match(r.stderr, /^guard: blocked \(G07 push-to-protected: /);
    assert.match(runGuardWithCwd(CURRENT.guard, "ls", projectWith(null)).stderr, /could not read the config: .* is missing/);
  });

  it("a good file judges as before, and the same call with the file removed is a block", () => {
    const dir = projectWith(INVENTARIS);
    assert.equal(runGuard(CURRENT.guard, "git status --short", dir).code, 0);
    fs.rmSync(path.join(dir, ".claude", "guard.config.json"));
    assert.match(runGuard(CURRENT.guard, "git status --short", dir).stderr, /could not read the config: .* is missing/);
  });
});

describe("the rules that read config", () => {
  it("judge() with no config is a G17 block", () => {
    const v = judge("ls");
    assert.equal(v.rule, "G17");
    assert.equal(v.reason, "the config is not valid: no config was given");
    assert.equal(v.parse.line, "ls");
  });

  it("judge() with a malformed config is a G17 block, never a wrong match", () => {
    assert.equal(judge(PUSH, { version: 1, protectedBranches: "main" }).reason, "the config is not valid: protectedBranches must be a list of strings");
    assert.equal(judge("ls", { version: 1, rules: { G07: "off" } }).reason, "the config is not valid: rules.G07 cannot be off");
  });

  it("G01 reads blockedPrograms", () => {
    assert.equal(judge("curl https://example.com", { version: 1, blockedPrograms: ["sudo"] }).decision, "allow");
    assert.equal(judge("make lint", { version: 1, blockedPrograms: ["make"] }).rule, "G01");
    assert.equal(judge("cmake", { version: 1, blockedPrograms: ["make"] }).decision, "allow");
    assert.equal(judge("echo make", { version: 1, blockedPrograms: ["make"] }).decision, "allow");
    assert.equal(judge("ls; make", { version: 1, blockedPrograms: ["make"] }).rule, "G01");
    assert.equal(judge("python3 -c 'print(1)'", DEFAULTS).decision, "allow");
    assert.equal(judge("python3 -c 'print(1)'", INVENTARIS).rule, "G01");
    assert.equal(judge("curl x", { version: 1, blockedPrograms: [] }).decision, "allow");
  });

  it("G07 reads protectedBranches, with v0.1's reason whichever branch was named", () => {
    const release = { version: 1, protectedBranches: ["release"] };
    assert.equal(judge("git push origin release", release).rule, "G07");
    assert.equal(judge("git push origin release", release).reason, "direct push to main; open a PR instead");
    assert.equal(judge("git push origin HEAD:refs/heads/release", release).rule, "G07");
    assert.equal(judge(PUSH, release).decision, "allow");
    assert.equal(judge("git push origin master", INVENTARIS).rule, "G07");
  });

  it("G09 reads secretEnv", () => {
    const custom = { version: 1, secretEnv: ["STRIPE_KEY"] };
    assert.equal(judge("STRIPE_KEY=sk npm test", custom).rule, "G09");
    assert.equal(judge("DATABASE_URL=x npm test", custom).decision, "allow");
    assert.equal(judge("COGNITO_CLIENT_SECRET=x npm test", DEFAULTS).decision, "allow");
    assert.equal(judge("COGNITO_CLIENT_SECRET=x npm test", INVENTARIS).rule, "G09");
  });

  it("G12 reads secretPaths as name globs", () => {
    const custom = { version: 1, secretPaths: ["*.secret", "id_?sa"] };
    assert.equal(judge("cat deploy.secret", custom).rule, "G12");
    assert.equal(judge("cat keys/id_rsa", custom).rule, "G12");
    assert.equal(judge("cat keys/id_rsa.pub", custom).decision, "allow");
    assert.equal(judge("cat .env", custom).decision, "allow");
    assert.equal(judge("cat .env", INVENTARIS).rule, "G12");
    assert.equal(judge("grep -rn secret packages", custom).decision, "allow");
  });

  it("G13 reads credentialPaths as prefixes", () => {
    const custom = { version: 1, credentialPaths: ["~/.gitconfig"] };
    assert.equal(judge("cat ~/.gitconfig", custom).rule, "G13");
    assert.equal(judge("cat ~/.aws/credentials", custom).decision, "allow");
    assert.equal(judge("cat ~/.aws/credentials", INVENTARIS).rule, "G13");
    assert.equal(judge("ls ~/.config", { version: 1, credentialPaths: [] }).decision, "allow");
  });

  it("G16 keeps the three built-in names whatever the list says, adds the config's names, and names the operator", () => {
    const empty = { version: 1, protectedPaths: [] };
    assert.equal(judge(`cat ${DOT_CLAUDE}/settings.json`, empty).rule, "G16");
    assert.equal(judge("cat CLAUDE.local.md", empty).rule, "G16");
    assert.equal(judge("cat .mcp.json", empty).rule, "G16");
    assert.equal(judge(`cat ${DOT_CLAUDE}/settings.json`, empty).reason, "the session's own rules (.claude/, CLAUDE.md, .mcp.json) are changed by the operator, not by a session. Shell commands can't touch them; to look at one, open it with the Read tool");

    const extra = { version: 1, operator: "Ann", protectedPaths: ["secrets/", ".releaserc", "CLAUDE.md"] };
    assert.equal(judge("cat secrets/x", extra).rule, "G16");
    assert.equal(judge("cat Secrets/x", extra).rule, "G16");
    assert.equal(judge("cat .releaserc", extra).rule, "G16");
    assert.equal(judge("cat secrets/x", extra).reason, "the session's own rules (.claude/, CLAUDE.md, .mcp.json, secrets/, .releaserc) are changed by Ann, not by a session. Shell commands can't touch them; to look at one, open it with the Read tool");
    assert.equal(judge("cat mysecrets/x", extra).decision, "allow");
    assert.equal(judge("cat foo.releaserc", extra).decision, "allow");
    assert.equal(judge("cat secrets/x", INVENTARIS).decision, "allow");
    assert.equal(judge(`cat ${DOT_CLAUDE}/settings.json`, INVENTARIS).reason, "the session's own rules (.claude/, CLAUDE.md, .mcp.json) are changed by Jake, not by a session. Shell commands can't touch them; to look at one, open it with the Read tool");
  });

  it("rules can turn an optional rule off, and deny changes nothing", () => {
    assert.equal(judge("curl x", { version: 1, rules: { G01: "off" } }).decision, "allow");
    assert.equal(judge("curl x", { version: 1, rules: { G01: "deny" } }).rule, "G01");
    assert.equal(judge("npx playwright test", { version: 1, rules: { G18: "off" } }).decision, "allow");
    assert.equal(judge("find . -delete", { version: 1, rules: { G04: "off" } }).decision, "allow");
    assert.equal(judge("find . -delete", { version: 1, rules: { G18: "off" } }).rule, "G04");
    // Off is not a pass for the rest of the line: the next rule still judges it.
    assert.equal(judge("curl x && git push origin main", { version: 1, rules: { G01: "off" } }).rule, "G07");
  });
});

describe("the v0.1 table under the built-in defaults", () => {
  it("differs from the run under configs/inventaris.json in exactly the cases that depend on Inventaris's lists", () => {
    const differences: string[] = [];
    const outcome = (command: string, project: string) => { const r = runGuard(CURRENT.guard, command, project); return `${r.code} ${r.stderr}`; };
    // What a run came to, in a few words: allowed, or the rule that blocked, and whether the reason names the operator.
    const summary = (run: string) => (run.startsWith("0") ? "allowed" : `${run.match(/\((\S+ \S+): /)?.[1]}${run.includes("changed by the operator") ? ", changed by the operator" : ""}`);
    for (const command of [...bash.BLOCKED.map(([c]) => c), ...bash.ALLOWED]) {
      const inv = outcome(command, inventarisProject()), def = outcome(command, defaultsProject());
      if (inv !== def) differences.push(`${command} :: ${summary(inv)} -> ${summary(def)}`);
    }
    assert.deepEqual(differences, [
      // python is not a blocked program by default; the pipe rule still catches it as an interpreter.
      "python3 -c 'print(1)' :: G01 blocked-program -> allowed",
      "cat probe.txt | python :: G01 blocked-program -> G11 pipe-into-interpreter",
      "cat probe.txt | python3 :: G01 blocked-program -> G11 pipe-into-interpreter",
      // The operator is not named by default.
      `sed -i 's/a/b/' ${DOT_CLAUDE}/settings.json :: G16 protected-path -> G16 protected-path, changed by the operator`,
      "echo x >> CLAUDE.md :: G16 protected-path -> G16 protected-path, changed by the operator",
    ]);
  });

  it("the defaults project really holds the defaults", () => {
    assert.deepEqual(JSON.parse(fs.readFileSync(path.join(defaultsProject(), ".claude", "guard.config.json"), "utf8")), DEFAULTS);
    assert.ok(defaultsProject().startsWith(os.tmpdir()));
  });
});
