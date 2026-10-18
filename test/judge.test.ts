import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { INVENTARIS, ROOT, nest } from "./harness.ts";

/*
 * judge() as a library: the shape of a decision, the id on every block, G17 for a line the parser
 * cannot read and for a rule that throws, the rule order, and the registry of ids. The hooks are
 * CommonJS, so the tests load them with require. Every call here hands judge() the worked example
 * config, configs/inventaris.json, as the tables do.
 */
const require = createRequire(import.meta.url);
const { judge, blockedLine, MAX_COMMAND_LENGTH } = require(path.join(ROOT, "lib", "judge.js"));
const { RULES, UNREADABLE, ALL } = require(path.join(ROOT, "lib", "rules", "index.js"));
const parse = require(path.join(ROOT, "lib", "parse.js"));

const CONFIG = INVENTARIS;

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
    const v = judge("git status --short", CONFIG);
    assert.equal(v.decision, "allow");
    assert.equal(v.rule, null);
    assert.equal(v.reason, "");
    assert.deepEqual(v.parse.commands.map((c: string[]) => [...c]), [["git", "status", "--short"]]);
    assert.equal(v.parse.line, "git status --short");
  });

  it("denies with the rule's id, name, tier and reason", () => {
    const v = judge("git push origin main", CONFIG);
    assert.equal(v.decision, "deny");
    assert.equal(v.rule, "G07");
    assert.equal(v.name, "push-to-protected");
    assert.equal(v.tier, "deny");
    assert.equal(v.reason, "direct push to main; open a PR instead");
    assert.equal(blockedLine(v), "guard: blocked (G07 push-to-protected: direct push to main; open a PR instead): git push origin main");
  });

  it("collapses whitespace in the line it reports, as v0.1 did", () => {
    const v = judge("git   push \t origin   main ", CONFIG);
    assert.equal(v.rule, "G07");
    assert.equal(v.parse.line, "git push origin main");
    assert.equal(blockedLine(v), "guard: blocked (G07 push-to-protected: direct push to main; open a PR instead): git push origin main");
  });

  it("reads a newline as a command separator, as the shell does", () => {
    // Two commands, git push and origin main: neither names main as a push target.
    assert.equal(judge("git push\norigin main", CONFIG).decision, "allow");
    assert.equal(judge("git status\ngit push origin main", CONFIG).rule, "G07");
  });

  it("gives G17 to a line the parser cannot read, with the parser's words", () => {
    for (const [command, message] of [["echo 'unclosed", "an unclosed quote"], ["cat <<EOF", "a heredoc that never reaches EOF"]]) {
      const v = judge(command, CONFIG);
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
      const v = judge("ls", CONFIG);
      assert.equal(v.decision, "deny");
      assert.equal(v.rule, "G17");
      assert.equal(v.reason, "the guard could not judge the command: boom");
    } finally {
      RULES.shift();
    }
  });

  it("gives G17 to a missing or invalid config, before anything else", () => {
    assert.equal(judge("ls").reason, "the config is not valid: no config was given");
    assert.equal(judge("ls", { version: 1, foo: 1 }).reason, 'the config is not valid: unknown key "foo"');
    const v = judge("echo 'unclosed", { version: 2 });
    assert.equal(v.rule, "G17");
    assert.equal(v.reason, "the config is not valid: version must be 1");
    assert.equal(v.parse.line, "echo 'unclosed");
  });

  it("runs the rules in v0.1's order, G18 last", () => {
    assert.deepEqual(RULES.map((r: { id: string; name: string }) => [r.id, r.name]), ORDER);
    assert.equal(judge("sudo rm -rf /", CONFIG).rule, "G01");
    assert.equal(judge("rm -rf out && npx playwright test", CONFIG).rule, "G02");
    assert.equal(judge("npx playwright test && git push origin main", CONFIG).rule, "G07");
    assert.equal(judge("npx playwright test", CONFIG).rule, "G18");
  });

  it("lets a rule name a more exact reason than its default", () => {
    assert.equal(judge("find . -delete", CONFIG).reason, "find -delete is a delete");
    assert.equal(judge("find . -exec rm {} \\;", CONFIG).reason, "find -exec rm is a delete");
    assert.equal(judge("ls | xargs rm", CONFIG).reason, "xargs rm is a delete");
    assert.equal(judge("npm install playwright", CONFIG).reason, "browser automation is off in this repo: playwright installed with npm; say what was blocked and stop");
  });

  it("gives the same answer to the same command", () => {
    for (const command of ["git push origin main", "npm test", "npx playwright test", "echo 'unclosed"]) {
      assert.deepEqual(judge(command, CONFIG), judge(command, CONFIG));
    }
  });

  it("judges a command at the length cap and refuses one past it, before the parser sees it", () => {
    assert.equal(MAX_COMMAND_LENGTH, 262144);
    const atCap = "echo " + "a".repeat(MAX_COMMAND_LENGTH - 5);
    assert.equal(atCap.length, MAX_COMMAND_LENGTH);
    assert.equal(judge(atCap, CONFIG).decision, "allow");
    const past = judge(atCap + "a", CONFIG);
    assert.equal(past.rule, "G17");
    assert.equal(past.reason, `the command is too long to judge: ${MAX_COMMAND_LENGTH + 1} characters; the guard reads at most ${MAX_COMMAND_LENGTH}. Put long content in a file with the Write tool`);
    assert.equal(past.parse.line, `echo ${"a".repeat(195)} ...`);
    assert.equal(blockedLine(past).length, "guard: blocked (G17 unreadable: ): ".length + past.reason.length + 204);
    // Past the cap nothing is parsed: an unclosed quote in it is never seen, and a push to main in it is G17, not G07.
    assert.match(judge("echo '" + "a".repeat(MAX_COMMAND_LENGTH), CONFIG).reason, /^the command is too long to judge/);
    assert.match(judge("git push origin main # " + "a".repeat(MAX_COMMAND_LENGTH), CONFIG).reason, /^the command is too long to judge/);
    // The cap counts characters of the command as given, before whitespace is collapsed.
    assert.match(judge("echo" + " ".repeat(MAX_COMMAND_LENGTH), CONFIG).reason, /^the command is too long to judge/);
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
    assert.ok(source.includes("`" + UNREADABLE.readConfig(err).replace("why", "${message(err)}") + "`"), "guard.js spells the config reason differently");
    assert.deepEqual(UNREADABLE.reasons, [
      "could not read the tool call",
      "could not read the command: <why>",
      "the guard could not judge the command: <why>",
      "the guard could not load: <why>",
      "could not read the config: <why>",
      "the config is not valid: <why>",
      "the command is too long to judge: <length> characters; the guard reads at most <limit>. Put long content in a file with the Write tool",
    ]);
    assert.equal(UNREADABLE.config(err), "the config is not valid: why");
    assert.equal(UNREADABLE.tooLong(300000, 262144), "the command is too long to judge: 300000 characters; the guard reads at most 262144. Put long content in a file with the Write tool");
  });

  it("print no em dashes", () => {
    const emDash = String.fromCharCode(0x2014);
    for (const rule of ALL) {
      for (const text of [rule.reason, ...(rule.reasons || [])]) assert.ok(!text.includes(emDash), `${rule.id}: ${text}`);
    }
    for (const text of [judge("cat secrets/x", { version: 1, protectedPaths: ["secrets/"], operator: "Ann" }).reason, judge("ls").reason, judge("ls", { version: 1, rules: { G01: "ask" } }).reason]) {
      assert.ok(!text.includes(emDash), text);
    }
  });
});

describe("parse()", () => {
  it("returns the line, the commands with shell strings expanded, and the inline code", () => {
    const p = parse.parse("bash -c 'cd x && node -e \"1+1\"' | tail -1");
    assert.equal(p.line, "bash -c 'cd x && node -e \"1+1\"' | tail -1");
    assert.deepEqual(p.commands.map((c: string[]) => [...c]), [["bash", "-c", 'cd x && node -e "1+1"'], ["cd", "x"], ["node", "-e", "1+1"], ["tail", "-1"]]);
    assert.deepEqual(p.commands.map((c: string[] & { piped?: boolean }) => !!c.piped), [false, false, false, true]);
    assert.deepEqual(p.commands.map((c: string[] & { depth?: number }) => c.depth), [0, 1, 1, 0]);
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

  it("counts $( and backticks as the shell does, and throws on one left open", () => {
    const D = "$" + "(", T = String.fromCharCode(96);
    const open = /an unclosed command substitution/, tick = /an unclosed backtick/;
    assert.throws(() => parse.parse(`echo ${D}`), open);
    assert.throws(() => parse.parse(`echo ${D}(1+2)`), open);
    assert.throws(() => parse.parse(`echo "${D}ls"`), open);
    assert.throws(() => parse.parse(`echo ${D}')'`), open);
    assert.throws(() => parse.parse(`echo ${D}ls # )`), open);
    assert.throws(() => parse.parse(`echo ${T}ls`), tick);
    assert.throws(() => parse.parse(`echo "${T}"`), tick);
    assert.throws(() => parse.parse(`echo ${T}a${T} ${T}`), tick);
    // Closed ones parse; what they run is G10's business, and the words come out as they did in v0.1.
    assert.deepEqual(parse.parse(`echo ${D}(1+2))`).commands.map((c: string[]) => [...c]), [["echo", "$"], ["1+2"]]);
    assert.deepEqual(parse.parse(`echo ${D}case x in a) echo a;; esac)`).commands.map((c: string[]) => [...c]), [["echo", "$"], ["case", "x", "in", "a"], ["echo", "a"], ["esac"]]);
    assert.doesNotThrow(() => parse.parse(`echo ${D}echo ${T}ls${T})`));
    // Not expanded by the shell, not counted: single quotes, escapes, comments, quoted heredocs.
    for (const line of [`echo '${D}'`, `echo '${T}'`, "echo \\$\\(", `echo \\${T}`, `echo "\\$("`, `echo "\\${T}"`, `ls # ${D}`, `ls # ${T}`, `cat <<'EOF'\n${D}\nEOF`, `cat <<"EOF"\n${T}\nEOF`, `cat <<\\EOF\n${D}\nEOF`, "echo $ (ls)"]) {
      assert.doesNotThrow(() => parse.parse(line), line);
    }
    // Expanded by the shell, counted: an unquoted heredoc body, and the string a shell runs.
    assert.throws(() => parse.parse(`cat <<EOF\n${D}\nEOF`), open);
    assert.throws(() => parse.parse(`cat <<EOF\n${T}\nEOF`), tick);
    assert.throws(() => parse.parse(`cat <<EOF\n\\${D}\n${D}\nEOF`), open);
    assert.doesNotThrow(() => parse.parse(`cat <<EOF\n\\${D}\nEOF`));
    assert.doesNotThrow(() => parse.parse(`cat <<EOF\n${D}ls)\nEOF`));
    assert.throws(() => parse.parse(`bash -c 'echo ${D}'`), open);
  });

  it("finds the program past the wrappers, their options and their own positional words", () => {
    const program = (line: string) => parse.programOf(parse.commandsOf(line)[0]).program;
    assert.equal(program("timeout -s KILL 60 git push"), "git");
    assert.equal(program("nice -n 10 git push"), "git");
    assert.equal(program("setsid -f npm test"), "npm");
    assert.equal(program("ionice -c 3 -n 7 find ."), "find");
    assert.equal(program("chrt -i 0 find ."), "find");
    assert.equal(program("taskset -c 0,1 find ."), "find");
    assert.equal(program("taskset 0x1 find ."), "find");
    assert.equal(program("flock -w 5 /tmp/lock find ."), "find");
    assert.equal(program("flock -n /tmp/lock"), undefined);
    assert.equal(program("unbuffer -p find ."), "find");
    assert.equal(program("doas -u root find ."), "find");
    assert.equal(program("busybox find ."), "find");
    assert.equal(program("doas busybox find ."), "find");
    assert.equal(program("CI=1 env -u X nohup timeout 5 find ."), "find");
    // flock -c runs its string with sh -c, and is read as that.
    assert.deepEqual(parse.programOf(parse.commandsOf("flock /tmp/lock -c 'find . -delete'")[0]), { program: "sh", rest: ["-c", "find . -delete"] });
    assert.deepEqual(parse.parse("flock /tmp/lock -c 'git push origin main'").commands.map((c: string[]) => [...c]), [["flock", "/tmp/lock", "-c", "git push origin main"], ["git", "push", "origin", "main"]]);
  });

  it("finds the command a runner runs, for the rules that judge find and inline code", () => {
    const run = (line: string) => parse.runOf(parse.commandsOf(line)[0]);
    assert.deepEqual(run("xargs find . -delete"), { program: "find", rest: [".", "-delete"] });
    assert.deepEqual(run("xargs -0 -I{} find {} -delete"), { program: "find", rest: ["{}", "-delete"] });
    assert.deepEqual(run("npx find . -delete"), { program: "find", rest: [".", "-delete"] });
    assert.deepEqual(run("npx -y -p pkg find ."), { program: "find", rest: ["."] });
    assert.deepEqual(run("npm exec -- find ."), { program: "find", rest: ["."] });
    assert.deepEqual(run("npm exec find -- ."), { program: "find", rest: ["--", "."] });
    assert.deepEqual(run("timeout 5 xargs npx tsx -e 1"), { program: "tsx", rest: ["-e", "1"] });
    assert.deepEqual(run("xargs"), { program: undefined, rest: [] });
    assert.deepEqual(run("npm install"), { program: "npm", rest: ["install"] });
    assert.deepEqual(run("ls -la"), { program: "ls", rest: ["-la"] });
    // npx -c, npx --call and npm exec -c run their string with a shell, and come back as sh -c.
    assert.deepEqual(run("npx -c 'git push origin main'"), { program: "sh", rest: ["-c", "git push origin main"] });
    assert.deepEqual(run("npx -y --call 'cat .env'"), { program: "sh", rest: ["-c", "cat .env"] });
    assert.deepEqual(run("npx --call='ls -la'"), { program: "sh", rest: ["-c", "ls -la"] });
    assert.deepEqual(run("npm exec -c 'git push origin main'"), { program: "sh", rest: ["-c", "git push origin main"] });
    assert.deepEqual(run("npm exec --call 'ls'"), { program: "sh", rest: ["-c", "ls"] });
    assert.deepEqual(run("xargs -c ls"), { program: "ls", rest: [] }); // xargs has no -c; it is a flag like any other
  });

  it("reads the shell string behind a runner as commands", () => {
    const commands = (line: string) => parse.parse(line).commands.map((c: string[] & { depth?: number }) => [c.depth, ...c]);
    assert.deepEqual(commands("echo x | xargs bash -c 'cd a && git push origin main'"), [[0, "echo", "x"], [0, "xargs", "bash", "-c", "cd a && git push origin main"], [1, "cd", "a"], [1, "git", "push", "origin", "main"]]);
    assert.deepEqual(commands("npx -c 'cat .env'"), [[0, "npx", "-c", "cat .env"], [1, "cat", ".env"]]);
    assert.deepEqual(commands("npm exec -- bash -c 'ls'"), [[0, "npm", "exec", "--", "bash", "-c", "ls"], [1, "ls"]]);
    assert.deepEqual(commands("ls | xargs sh"), [[0, "ls"], [0, "xargs", "sh"]]);
    assert.throws(() => parse.parse(`npx -c "echo 'oops"`), /an unclosed quote/);
    assert.throws(() => parse.parse(nest(3, "xargs bash -c 'ls'")), /shells nested more than three deep/);
  });
});
