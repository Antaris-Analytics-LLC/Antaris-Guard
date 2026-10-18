"use strict";
const { programOf, base, readPathsOf, INTERPRETERS } = require("../parse");

/* G18: browser automation. Nothing a session does needs a browser, and a browser binary or an
   automation framework in a session's hands is the shape that started this rule. A command is
   blocked when it runs, installs or names one:
     by program: playwright, puppeteer, chromium, chrome, a webdriver, a browser under the
       preinstalled path, by name or by path, after env, timeout, nice, xargs, watch, find -exec;
     by package: the thing npx, npm exec, pnpm dlx, yarn, bunx and the like run, and the packages
       an install command adds (npm, pnpm, yarn, bun, pip, apt, brew and the rest);
     by inline code: the code node -e and the like run, when it names one of these, a headless
       flag, the preinstalled path or one of the two variables;
     by variable: PLAYWRIGHT_BROWSERS_PATH or PUPPETEER_EXECUTABLE_PATH set on a command;
     by flag: --headless, --headless=anything or -headless on any command;
     by path: /opt/pw-browsers at the start of any word.
   Searching for the word (a grep or rg pattern), a commit message that contains it, reading a
   variable (echo $PLAYWRIGHT_BROWSERS_PATH), uninstalling, and a config file's name are not any
   of those, and are allowed. Judged per command, shell strings included, never on the whole line. */

const BROWSER_PATH = "/opt/pw-browsers";
const VARIABLES = ["PLAYWRIGHT_BROWSERS_PATH", "PUPPETEER_EXECUTABLE_PATH"];

// The names, matched as a word inside a package name, a path under node_modules, or inline code:
// playwright-core, @playwright/test, selenium-webdriver, @puppeteer/browsers, eslint-plugin-playwright all count.
const TOKENS = ["playwright", "puppeteer", "selenium", "webdriver", "webdriverio", "wdio", "chromedriver", "geckodriver", "msedgedriver", "chromium", "chrome", "cypress", "nightwatch", "testcafe"];
const TOKEN_WORD = new RegExp(`(^|[^A-Za-z0-9_])(${TOKENS.join("|")})(?![A-Za-z0-9_])`, "i");

// Programs matched by their whole name, after the path, a version (playwright@1.50) and a common extension are removed.
const PROGRAMS = new Set([
  "playwright", "puppeteer", "cypress", "nightwatch", "testcafe",
  "chromedriver", "geckodriver", "msedgedriver", "safaridriver", "operadriver",
  "selenium", "selenium-manager", "selenium-server", "selenium-standalone", "webdriver-manager", "wdio",
  "chromium", "chromium-browser", "chrome", "google-chrome", "google-chrome-stable", "google-chrome-beta", "google-chrome-unstable",
  "chrome-headless-shell", "headless_shell", "headless-shell",
]);
const programName = (w) => base(w).replace(/@.*$/, "").replace(/\.(exe|cmd|bat|sh|js|mjs|cjs|ts)$/i, "");

const HEADLESS = /^(--headless(=.*)?|-headless)$/;
const VAR_SET = new RegExp(`^(${VARIABLES.join("|")})=`);
const VAR_NAMED = new RegExp(`\\b(${VARIABLES.join("|")})\\b`);

// Programs whose first positional word is a package or program they run, with the options that take a value.
const RUNNERS = {
  npx: [], pnpx: [], bunx: [], setsid: [],
  xargs: ["-I", "-n", "-P", "-L", "-s", "-d", "-a", "-E", "--max-args", "--max-procs", "--max-lines", "--max-chars", "--delimiter", "--arg-file", "--eof", "--replace"],
  watch: ["-n", "--interval"],
  "xvfb-run": ["-s", "--server-args", "-e", "--error-file", "-f", "--auth-file", "-n", "--server-num", "-p", "--xauth-protocol", "-w", "--wait"],
};
// Package managers: the subcommands that run a package, and the subcommands that install packages.
const MANAGERS = {
  npm: { runs: ["exec", "x"], installs: ["install", "i", "in", "ins", "inst", "add", "install-test", "it"] },
  pnpm: { runs: ["exec", "dlx"], bin: true, installs: ["add", "install", "i", "in", "install-test", "it"] },
  yarn: { runs: ["dlx", "exec", "run"], bin: true, installs: ["add"] },
  bun: { runs: ["x", "run"], installs: ["add", "install", "i", "a"] },
  deno: { runs: ["run"], installs: ["add", "install"] },
  pip: { installs: ["install"] }, pip3: { installs: ["install"] }, pipx: { installs: ["install"] }, pipenv: { installs: ["install"] }, poetry: { installs: ["add"] }, uv: { installs: ["add", "install"] },
  apt: { installs: ["install"] }, "apt-get": { installs: ["install"] }, apk: { installs: ["add"] }, brew: { installs: ["install"] },
  dnf: { installs: ["install"] }, yum: { installs: ["install"] }, zypper: { installs: ["install"] }, pacman: { installs: ["-S"] },
  snap: { installs: ["install"] }, choco: { installs: ["install"] }, winget: { installs: ["install"] }, scoop: { installs: ["install"] },
};
// A package manager's own options that take a value as the next word, before its subcommand.
const MANAGER_VALUE_OPTIONS = new Set(["--filter", "-F", "-w", "--workspace", "-C", "--dir", "--prefix", "--cwd", "--registry", "--reporter", "--config", "--userconfig"]);
// Interpreter options whose value is a module the interpreter loads before the script.
const MODULE_OPTIONS = new Set(["-r", "--require", "--import", "--loader", "--experimental-loader"]);

const why = (detail) => `browser automation is off in this repo: ${detail}; say what was blocked and stop`;

/** The package or program an npx-style runner runs: its -p/--package values, its -c string, and the first positional. */
function runnerTargets(rest, valueOptions = []) {
  const targets = [];
  for (let i = 0; i < rest.length; i++) {
    const a = rest[i];
    if (a === "--") { if (rest[i + 1] !== undefined) targets.push(rest[i + 1]); break; }
    if (a === "-p" || a === "--package" || a === "-c" || a === "--call") { if (rest[i + 1] !== undefined) targets.push(rest[i + 1]); i++; continue; }
    if (a.startsWith("--package=") || a.startsWith("--call=")) { targets.push(a.slice(a.indexOf("=") + 1)); continue; }
    if (a.startsWith("-")) { if (valueOptions.includes(a)) i++; continue; }
    targets.push(a);
    break;
  }
  return targets;
}

/** The packages an install subcommand adds: every word after it that is not an option. */
const installedPackages = (rest, at) => rest.slice(at + 1).filter((a) => !a.startsWith("-"));

/** The words of a command a flag or a path is judged on: for a reader (cat, grep, rg and the rest), the paths it reads, so a pattern is never a flag or a path. */
function judgedWords(words) {
  const read = readPathsOf(words);
  return read ? read.paths : words;
}

/** A manager's words with its own value options removed, so the subcommand is the first word that is not an option. */
function withoutManagerOptions(rest) {
  const out = [];
  for (let i = 0; i < rest.length; i++) {
    if (MANAGER_VALUE_OPTIONS.has(rest[i])) { i++; continue; }
    out.push(rest[i]);
  }
  return out;
}

/** The first hit in one command, as a reason, or null. */
function judgeCommand(words) {
  const set = words.find((w) => VAR_SET.test(w));
  if (set) return why(`${set.slice(0, set.indexOf("="))} set`);

  const { program, rest } = programOf(words);
  if (program === undefined) return null;
  if (program.startsWith(BROWSER_PATH)) return why("the preinstalled browser path");
  const name = programName(program);
  if (PROGRAMS.has(name)) return why(`${base(program)} run by name`);
  // corepack pnpm dlx x is pnpm dlx x.
  if (name === "corepack" && rest.length) return judgeCommand(rest);

  if (Object.hasOwn(RUNNERS, name)) {
    const target = runnerTargets(rest, RUNNERS[name]).find((t) => TOKEN_WORD.test(t) || PROGRAMS.has(programName(t)) || t.startsWith(BROWSER_PATH));
    if (target) return why(`${target} run through ${name}`);
  }
  if (name === "find") {
    const at = rest.findIndex((a) => a === "-exec" || a === "-execdir");
    const target = at === -1 ? undefined : rest[at + 1];
    if (target !== undefined && (PROGRAMS.has(programName(target)) || target.startsWith(BROWSER_PATH))) return why(`${target} run through find -exec`);
  }
  if (Object.hasOwn(MANAGERS, name)) {
    const m = MANAGERS[name];
    const words2 = withoutManagerOptions(rest).filter((a) => a !== "global"); // yarn global add
    const sub = words2.findIndex((a) => !a.startsWith("-") || a === "-S");
    const subcommand = words2[sub];
    if (subcommand !== undefined) {
      if ((m.runs || []).includes(subcommand)) {
        const target = runnerTargets(words2.slice(sub + 1)).find((t) => TOKEN_WORD.test(t) || PROGRAMS.has(programName(t)) || t.startsWith(BROWSER_PATH));
        if (target) return why(`${target} run through ${name} ${subcommand}`);
      } else if (m.installs.includes(subcommand)) {
        const pkg = installedPackages(words2, sub).find((p) => TOKEN_WORD.test(p));
        if (pkg) return why(`${pkg} installed with ${name}`);
      } else if (m.bin && (TOKEN_WORD.test(subcommand) || PROGRAMS.has(programName(subcommand)))) {
        return why(`${subcommand} run through ${name}`);
      }
    }
  }
  if (INTERPRETERS.has(name)) {
    for (let i = 0; i < rest.length; i++) {
      const a = rest[i];
      if (MODULE_OPTIONS.has(a)) { if (rest[i + 1] !== undefined && TOKEN_WORD.test(rest[i + 1])) return why(`${rest[i + 1]} loaded by ${name}`); i++; continue; }
      if (/^--(require|import|loader|experimental-loader)=/.test(a)) { const v = a.slice(a.indexOf("=") + 1); if (TOKEN_WORD.test(v)) return why(`${v} loaded by ${name}`); continue; }
      if (a === "-e" || a === "--eval" || a === "-p" || a === "--print" || a === "eval" || a.startsWith("--eval=") || a.startsWith("--print=")) break; // code, judged below
      if (a.startsWith("-")) continue;
      // The script: a browser program by name, or a package under node_modules with one of the names in it.
      const segments = a.split("/");
      const under = segments.indexOf("node_modules");
      if (PROGRAMS.has(programName(a)) || (under !== -1 && segments.slice(under + 1).some((s) => TOKEN_WORD.test(s)))) return why(`${a} run with ${name}`);
      break;
    }
  }

  for (const w of judgedWords(words)) {
    if (HEADLESS.test(w)) return why("a headless flag");
    if (w.startsWith(BROWSER_PATH)) return why("the preinstalled browser path");
  }
  return null;
}

/** The first hit in a piece of inline code, as a reason, or null. */
function judgeCode(code) {
  const token = code.match(TOKEN_WORD);
  if (token) return why(`${token[2].toLowerCase()} in inline code`);
  if (/(^|[^A-Za-z0-9_])-{1,2}headless\b|\bheadless\b/.test(code)) return why("a headless flag in inline code");
  if (code.includes(BROWSER_PATH)) return why("the preinstalled browser path in inline code");
  const named = code.match(VAR_NAMED);
  if (named) return why(`${named[1]} in inline code`);
  return null;
}

module.exports = {
  id: "G18",
  name: "browser-automation",
  tier: "deny",
  reason: "browser automation is off in this repo: <what was run, installed or named>; say what was blocked and stop",
  test: ({ commands, inlineCode }) => {
    for (const words of commands) { const r = judgeCommand(words); if (r) return r; }
    for (const code of inlineCode) { const r = judgeCode(code); if (r) return r; }
    return false;
  },
};
