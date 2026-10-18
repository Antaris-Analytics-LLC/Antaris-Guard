import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { ROOT, nest } from "./harness.ts";

/*
 * judge() as a library: the shape of a decision, the id on every block, G17 for a line the parser
 * cannot read and for a rule that throws, the rule order, and the registry of ids. The hooks are
 * CommonJS, so the tests load them with require.
 */
const require = createRequire(import.meta.url);
const { judge, blockedLine } = require(path.join(ROOT, "lib", "judge.js"));
const { RULES, UNREADABLE, ALL } = require(path.join(ROOT, "lib", "rules", "index.js"));
const parse = require(path.join(ROOT, "lib", "parse.js"));

// The ids and names docs/SPEC.md section 3 gives the v0.1 rules and G18, in the order v0.1 ran them.
const ORDER = [
  ["G01", "blocked-program"], ["G02", "recursive-delete"], ["G03", "delete-in-inline-code"], ["G04", "find-or-xargs-delete"],
  ["G05", "remove-item-recurse"], ["G06", "force-push"], ["G07", "push-to-protected"], ["G08", "destructive-git"],
  ["G09", "secret-on-command-line"], ["G10", "command-substitution"], ["G11", "pipe-into-interpreter"], ["G12", "reads-secret-file"],
  ["G13", "credential-directory"], ["aws-cdk-01", "cdk-deploy-or-destroy"], ["G14", "push-or-deploy-in-inline-code"], ["aws-cdk-02", "prod-profile"],
  ["docker-01", "docker-outside-postgres"], ["G15", "wide-chmod"], ["G16", "protected-path"], ["G18", "browser-automation"],
];

describe("judge()", () => {
  it("allows with a null rule and the parse", () => {
    const v = judge("git status --short");
    assert.equal(v.decision, "allow");
    assert.equal(v.rule, null);
    assert.equal(v.reason, "");
    assert.deepEqual(v.parse.commands.map((c: string[]) => [...c]), [["git", "status", "--short"]]);
    assert.equal(v.parse.line, "git status --short");
  });

  it("denies with the rule's id, name, tier and reason", () => {
    const v = judge("git push origin main");
    assert.equal(v.decision, "deny");
    assert.equal(v.rule, "G07");
    assert.equal(v.name, "push-to-protected");
    assert.equal(v.tier, "deny");
    assert.equal(v.reason, "direct push to main; open a PR instead");
    assert.equal(blockedLine(v), "guard: blocked (G07 push-to-protected: direct push to main; open a PR instead): git push origin main");
  });

  it("collapses whitespace in the line it reports, as v0.1 did", () => {
    const v = judge("git   push \t origin   main ");
    assert.equal(v.rule, "G07");
    assert.equal(v.parse.line, "git push origin main");
    assert.equal(blockedLine(v), "guard: blocked (G07 push-to-protected: direct push to main; open a PR instead): git push origin main");
  });

  it("reads a newline as a command separator, as the shell does", () => {
    // Two commands, git push and origin main: neither names main as a push target.
    assert.equal(judge("git push\norigin main").decision, "allow");
    assert.equal(judge("git status\ngit push origin main").rule, "G07");
  });

  it("gives G17 to a line the parser cannot read, with the parser's words", () => {
    for (const [command, message] of [["echo 'unclosed", "an unclosed quote"], ["cat <<EOF", "a heredoc that never reaches EOF"]]) {
      const v = judge(command);
      assert.equal(v.rule, "G17");
      assert.equal(v.name, "unreadable");
      assert.equal(v.reason, `could not read the command: ${message}`);
      assert.equal(v.parse.line, command);
    }
  });

  it("gives G17 to a rule that throws, and never lets the line through", () => {
    const broken = { id: "T00", name: "throws", tier: "deny", reason: "never", test: () => { throw new Error("boom"); } };
    RULES.unshift(broken);
    try {
      const v = judge("ls");
      assert.equal(v.decision, "deny");
      assert.equal(v.rule, "G17");
      assert.equal(v.reason, "the guard could not judge the command: boom");
    } finally {
      RULES.shift();
    }
  });

  it("runs the rules in v0.1's order, G18 last", () => {
    assert.deepEqual(RULES.map((r: { id: string; name: string }) => [r.id, r.name]), ORDER);
    assert.equal(judge("sudo rm -rf /").rule, "G01");
    assert.equal(judge("rm -rf out && npx playwright test").rule, "G02");
    assert.equal(judge("npx playwright test && git push origin main").rule, "G07");
    assert.equal(judge("npx playwright test").rule, "G18");
  });

  it("lets a rule name a more exact reason than its default", () => {
    assert.equal(judge("find . -delete").reason, "find -delete is a delete");
    assert.equal(judge("find . -exec rm {} \\;").reason, "find -exec rm is a delete");
    assert.equal(judge("ls | xargs rm").reason, "xargs rm is a delete");
    assert.equal(judge("npm install playwright").reason, "browser automation is off in this repo: playwright installed with npm; say what was blocked and stop");
  });

  it("gives the same answer to the same command", () => {
    for (const command of ["git push origin main", "npm test", "npx playwright test", "echo 'unclosed"]) {
      assert.deepEqual(judge(command), judge(command));
    }
  });
});

describe("the rules", () => {
  it("each export an id, a name, a deny tier, a reason and a test", () => {
    for (const rule of RULES) {
      assert.match(rule.id, /^(G\d\d|[a-z][a-z0-9-]*-\d\d)$/, rule.id);
      assert.match(rule.name, /^[a-z][a-z0-9-]*$/, rule.id);
      assert.equal(rule.tier, "deny", rule.id);
      assert.equal(typeof rule.reason, "string", rule.id);
      assert.ok(rule.reason.length > 0, rule.id);
      assert.equal(typeof rule.test, "function", rule.id);
    }
  });

  it("have ids that are unique, G17 included", () => {
    const ids = ALL.map((r: { id: string }) => r.id);
    assert.equal(new Set(ids).size, ids.length);
    assert.ok(ids.includes("G17"));
    assert.equal(UNREADABLE.id, "G17");
    assert.equal(UNREADABLE.test, null);
  });

  it("G17's words in guard.js, which must work without lib/, match lib/rules/g17-unreadable.js", () => {
    const source = fs.readFileSync(path.join(ROOT, "guard.js"), "utf8");
    const err = new Error("why");
    assert.ok(source.includes(`"${UNREADABLE.id} ${UNREADABLE.name}"`), "guard.js spells the id and name differently");
    assert.ok(source.includes(`block("${UNREADABLE.toolCall()}")`), "guard.js spells the tool-call reason differently");
    assert.ok(source.includes("`" + UNREADABLE.load(err).replace("why", "${message(err)}") + "`"), "guard.js spells the load reason differently");
    assert.ok(source.includes("`" + UNREADABLE.rule(err).replace("why", "${message(err)}") + "`"), "guard.js spells the judge reason differently");
    assert.deepEqual(UNREADABLE.reasons, ["could not read the tool call", "could not read the command: <why>", "the guard could not judge the command: <why>", "the guard could not load: <why>"]);
  });

  it("print no em dashes", () => {
    const emDash = String.fromCharCode(0x2014);
    for (const rule of ALL) {
      for (const text of [rule.reason, ...(rule.reasons || [])]) assert.ok(!text.includes(emDash), `${rule.id}: ${text}`);
    }
  });
});

describe("parse()", () => {
  it("returns the line, the commands with shell strings expanded, and the inline code", () => {
    const p = parse.parse("bash -c 'cd x && node -e \"1+1\"' | tail -1");
    assert.equal(p.line, "bash -c 'cd x && node -e \"1+1\"' | tail -1");
    assert.deepEqual(p.commands.map((c: string[]) => [...c]), [["bash", "-c", 'cd x && node -e "1+1"'], ["cd", "x"], ["node", "-e", "1+1"], ["tail", "-1"]]);
    assert.deepEqual(p.commands.map((c: string[] & { piped?: boolean }) => !!c.piped), [false, false, false, true]);
    assert.deepEqual(p.inlineCode, ["1+1"]);
  });

  it("reads the paths a reader is given, never the pattern", () => {
    assert.deepEqual(parse.readPathsOf(["grep", "-rn", "TOKEN", "src", "lib"]).paths, ["src", "lib"]);
    assert.deepEqual(parse.readPathsOf(["rg", "-e", "TOKEN", "--", ".env.production"]).paths, [".env.production"]);
    assert.deepEqual(parse.readPathsOf(["grep", "-f", ".env", "packages"]).paths, [".env", "packages"]);
    assert.deepEqual(parse.readPathsOf(["cat", "a", "b"]).paths, ["a", "b"]);
    assert.equal(parse.readPathsOf(["ls", "a"]), null);
  });

  it("throws on what the shell could not run", () => {
    assert.throws(() => parse.parse("echo 'unclosed"), /an unclosed quote/);
    assert.throws(() => parse.parse("cat <<EOF"), /a heredoc that never reaches EOF/);
    assert.throws(() => parse.parse(nest(4, "ls")), /shells nested more than three deep/);
    assert.doesNotThrow(() => parse.parse(nest(3, "ls")));
  });
});
