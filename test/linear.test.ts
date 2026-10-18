import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import path from "node:path";
import { ROOT } from "./harness.ts";

/*
 * The exact rewrites in R2, held against what they replaced. Six places in v0.1 cost a pass per
 * occurrence (a regex tail that backtracked from every Remove-Item or docker run, a slice of the
 * words from every git or cdk word, a scan from every interpreter word, and G10's .*). Each was
 * rewritten to give the same answer in one pass. The old code is kept here, word for word from
 * bench/versions/v0.1/guard.js, and both are run over tens of thousands of generated inputs built
 * from the tokens that matter to each; any input where they disagree fails with the input shown.
 * The generator is seeded, so a failure is the same failure every run. G05 is the one whose
 * match R2 also changed (the two words count at the start of a word only), so its reference is
 * the regex that states that match rather than v0.1's.
 */
const require = createRequire(import.meta.url);
const parse = require(path.join(ROOT, "lib", "parse.js"));
const G10 = require(path.join(ROOT, "lib", "rules", "g10-command-substitution.js"));
const G05 = require(path.join(ROOT, "lib", "rules", "g05-remove-item-recurse.js"));
const DOCKER = require(path.join(ROOT, "lib", "rules", "docker-01-docker-outside-postgres.js"));
const CDK = require(path.join(ROOT, "lib", "rules", "aws-cdk-01-cdk-deploy-or-destroy.js"));
const G06 = require(path.join(ROOT, "lib", "rules", "g06-force-push.js"));
const G07 = require(path.join(ROOT, "lib", "rules", "g07-push-to-protected.js"));

const CONFIG = { version: 1, protectedBranches: ["main", "master"] };
const SAMPLES = 20000;

/** A small seeded generator, so every run draws the same inputs. */
function random(seed: number) {
  let s = seed >>> 0;
  return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
}
const pick = <T>(next: () => number, from: T[]): T => from[Math.floor(next() * from.length)];
const sequence = <T>(next: () => number, from: T[], max: number): T[] => Array.from({ length: Math.floor(next() * (max + 1)) }, () => pick(next, from));

// The v0.1 code, word for word.
const v01 = {
  substitution: (line: string) => /\$\(.*\)|`[^`]*`/.test(line),
  docker: (line: string) => /\b(docker)\s+(exec|rm|system|run\b.*(--privileged|-v\s*\/:))/.test(line),
  cdkDeploys: (words: string[]) => { const CDK_NAME = /^(aws-)?cdk(@[^/]*)?$/; return words.some((w, at) => CDK_NAME.test(parse.base(w)) && words.slice(at + 1).some((a) => a === "deploy" || a === "destroy")); },
  pushesOf: (words: string[]) => {
    const out: { options: string[]; positionals: string[] }[] = [];
    words.forEach((w, at) => {
      if (parse.base(w) !== "git") return;
      const rest = words.slice(at + 1);
      let i = 0;
      while (i < rest.length && rest[i].startsWith("-")) i += parse.GIT_VALUE_OPTIONS.has(rest[i]) ? 2 : 1;
      if (rest[i] !== "push") return;
      const options: string[] = [], positionals: string[] = [];
      for (let j = i + 1; j < rest.length; j++) {
        const a = rest[j];
        if (a === "--") { positionals.push(...rest.slice(j + 1)); break; }
        if (a.startsWith("-") && a !== "-") { options.push(a); if (parse.PUSH_VALUE_OPTIONS.has(a)) j++; continue; }
        positionals.push(a);
      }
      out.push({ options, positionals });
    });
    return out;
  },
  inlineCodeOf: (words: string[]) => {
    const out: string[] = [];
    words.forEach((w, at) => {
      if (!parse.INTERPRETERS.has(parse.base(w))) return;
      for (let j = at + 1; j < words.length; j++) {
        const a = words[j];
        if (a.startsWith("--eval=") || a.startsWith("--print=")) { out.push(a.slice(a.indexOf("=") + 1)); break; }
        if ((parse.CODE_FLAGS.has(a) || /^-[A-Za-z]+e$/.test(a)) && words[j + 1] !== undefined) { out.push(words[j + 1]); break; }
      }
    });
    return out;
  },
};
const MAIN_REFS = new Set(["main", "master", "refs/heads/main", "refs/heads/master"]);
const v01pushesToMain = (words: string[]) => v01.pushesOf(words).some((p) => p.positionals.some((a) => MAIN_REFS.has(a.replace(/^\+/, "").replace(/^[^:]*:/, ""))));
const v01forcePushes = (words: string[]) => v01.pushesOf(words).some((p) => p.options.some((o) => /^--force(-with-lease|-if-includes)?(=.*)?$/.test(o) || /^-[A-Za-z]*f[A-Za-z]*$/.test(o)) || p.positionals.some((a) => a.startsWith("+")));

/** Runs `check` over SAMPLES generated inputs and names the first disagreement. */
function agree<T>(name: string, seed: number, make: (next: () => number) => T, was: (input: T) => unknown, now: (input: T) => unknown) {
  const next = random(seed);
  let hits = 0;
  for (let i = 0; i < SAMPLES; i++) {
    const input = make(next);
    const a = was(input), b = now(input);
    assert.deepEqual(b, a, `${name} disagrees on ${JSON.stringify(input)}: v0.1 ${JSON.stringify(a)}, now ${JSON.stringify(b)}`);
    if (a === true || (Array.isArray(a) && a.length)) hits++;
  }
  assert.ok(hits > SAMPLES / 50, `${name}: only ${hits} of ${SAMPLES} inputs matched; the generator is not exercising the rule`);
  assert.ok(hits < SAMPLES - SAMPLES / 50, `${name}: ${hits} of ${SAMPLES} inputs matched; the generator is not exercising the misses`);
}

describe("the one-pass rewrites give v0.1's answer", () => {
  it("G10: $( with a ) after it, or two backticks", () => {
    agree("G10", 1, (next) => sequence(next, ["$", "(", ")", "`", "a", " ", "$(", "x)"], 12).join(""), v01.substitution, (line) => G10.test({ line }));
  });

  it("G05: Remove-Item then -Recurse in the same segment, each at the start of a word", () => {
    // R2's match, as one regex: the two words count only when nothing word-like, dot, dash or path separator sits before them.
    const reference = /(?<![A-Za-z0-9_.\/\\-])Remove-Item\b[^|;&]*(?<![A-Za-z0-9_.\/\\-])-Recurse\b/i;
    const tokens = ["Remove-Item", "remove-item", "-Recurse", "-recurse", "-Recursex", "xRemove-Item", "Remove-Items", "|", ";", "&", "x", " ", "Remove-Item-Recurse", "g05-remove-item-recurse.js", "lib/Remove-Item", "C:\\Remove-Item", "\"Remove-Item", "'-Recurse'", "x.-Recurse", "(-Recurse"];
    agree("G05", 2, (next) => sequence(next, tokens, 8).join(pick(next, [" ", ""])), (line) => reference.test(line), (line) => G05.test({ line }));
  });

  it("docker-01: docker exec, rm, system, or run with --privileged or / mounted after it", () => {
    const tokens = ["docker", "run", "exec", "rm", "rmi", "system", "--privileged", "-v", "/:", "-v /:", "-v/:", "x", ";", "runner", "dockerx", "docker run", "docker  exec"];
    agree("docker-01", 3, (next) => sequence(next, tokens, 8).join(" "), v01.docker, (line) => DOCKER.test({ line }));
  });

  it("aws-cdk-01: a deploy or destroy word after a cdk word", () => {
    const tokens = ["cdk", "aws-cdk", "aws-cdk@2.150.0", "./node_modules/.bin/cdk", "deploy", "destroy", "synth", "x", "npx", "--all"];
    agree("aws-cdk-01", 4, (next) => sequence(next, tokens, 7), v01.cdkDeploys, (words) => CDK.test({ commands: [words] }));
  });

  const pushTokens = ["git", "push", "-f", "--force", "--force-with-lease=x", "--force-if-includes", "-o", "x", "main", "+main", "+m1/x", "--", "-C", "dir", "origin", "HEAD:main", "refs/heads/main", "-uf", "--delete", "-", "/usr/bin/git", "master", ":main", "--repo", "m1/x", "-u", "--tags"];
  // Most draws start as a push would, so the rule is exercised as often as it is missed; the rest start anywhere.
  const pushStarts = [[], [], ["git", "push"], ["git", "push"], ["git", "-C", "dir", "push"], ["/usr/bin/git", "push"], ["git"], ["xargs", "git", "push"]];
  const pushWords = (next: () => number) => [...pick(next, pushStarts), ...sequence(next, pushTokens, 8)];

  it("G07: a push whose positional names main, by any way of naming it", () => {
    agree("G07", 5, pushWords, v01pushesToMain, (words) => G07.test({ commands: [words] }, CONFIG));
  });

  it("G06: a push with a force flag or a + on a positional", () => {
    agree("G06", 6, pushWords, v01forcePushes, (words) => G06.test({ commands: [words] }));
  });

  it("anyPush() against pushesOf() with arbitrary tests", () => {
    const option = (o: string) => o.includes("f"), positional = (a: string) => a.length > 3;
    agree("anyPush", 7, pushWords, (words) => v01.pushesOf(words).some((p) => p.options.some(option) || p.positionals.some(positional)), (words) => parse.anyPush(words, { option, positional }));
  });

  it("inlineCodeOf(): the code the first code flag after each interpreter word carries", () => {
    const tokens = ["node", "tsx", "/usr/bin/node", "perl", "-e", "-p", "--eval=x", "--print=y", "-pe", "-ne", "eval", "-E", "-r", "--eval", "code", "x", "y"];
    agree("inlineCodeOf", 8, (next) => sequence(next, tokens, 8), v01.inlineCodeOf, parse.inlineCodeOf);
  });
});
