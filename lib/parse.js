/*
 * Antaris-Guard: the parser. How the guard reads a shell line before any rule judges it.
 *
 * The line is split the way the shell would run it, on ; && || | & ( ) and newlines outside
 * quotes, and a command's program is its first word after any VAR=value prefixes (and env, time,
 * nohup, nice, timeout and the like, which run the rest). Quotes are removed from each word, a
 * heredoc's body and a # comment are no command at all, so a commit message, a quoted string or a
 * grep pattern that only mentions a command is not that command; the string given to sh -c or
 * bash -c is a command, and is read as one, three shells deep. A command after a real | or |& is
 * marked as piped; || is not a pipe.
 *
 * Nothing here decides anything. A line the parser cannot read throws, and judge() turns the
 * throw into a block: an unclosed quote, a heredoc with no end, shells nested too deep.
 *
 * Everything here runs in time proportional to the line. A command of many words, many
 * separators, many git or node or cdk words, or one word of great length is read in one pass,
 * never a pass per word; test/timing.test.ts holds that at the length cap judge() applies.
 *
 * This file is CommonJS and has no dependencies, like the hooks that load it.
 */
"use strict";

/**
 * The line as the shell would run it: a list of commands, each a list of words with quotes removed.
 * A command that reads the output of the one before it, after a real | or |&, has piped set.
 */
function commandsOf(src) {
  const commands = [];
  let words = [], word = "", inWord = false, quote = null, heredocs = [], piped = false;
  const endWord = () => { if (inWord) words.push(word); word = ""; inWord = false; };
  // A pipe carries over ( and a line break, so a | (sh) and a | at the end of a line still pipe into what follows.
  const endCommand = () => { endWord(); if (words.length) { words.piped = piped; commands.push(words); piped = false; } words = []; };
  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (quote) {
      if (ch === quote) quote = null;
      else if (ch === "\\" && quote === '"' && i + 1 < src.length) word += src[++i];
      else word += ch;
      continue;
    }
    if (ch === "'" || ch === '"') { quote = ch; inWord = true; continue; }
    if (ch === "\\") { if (src[i + 1] === "\n") i++; else if (i + 1 < src.length) { word += src[++i]; inWord = true; } continue; }
    if (ch === "#" && !inWord) { while (i + 1 < src.length && src[i + 1] !== "\n") i++; continue; }
    if (ch === "\n") {
      endCommand();
      // The bodies of the heredocs opened on this line are text, not commands.
      for (const delimiter of heredocs) {
        let j = i + 1, closed = false;
        while (j < src.length) {
          const end = src.indexOf("\n", j) === -1 ? src.length : src.indexOf("\n", j);
          const text = src.slice(j, end).replace(/^\t+/, "");
          j = end + 1;
          if (text === delimiter) { closed = true; break; }
        }
        if (!closed) throw new Error(`a heredoc that never reaches ${delimiter}`);
        i = j - 1;
      }
      heredocs = [];
      continue;
    }
    if (ch === "<" && src[i + 1] === "<" && src[i + 2] !== "<") {
      endWord();
      let j = i + 2, delimiter = "", q = null;
      if (src[j] === "-") j++;
      while (src[j] === " " || src[j] === "\t") j++;
      for (; j < src.length; j++) {
        const c = src[j];
        if (q) { if (c === q) q = null; else delimiter += c; continue; }
        if (c === "'" || c === '"') { q = c; continue; }
        if (/[\s;&|<>()]/.test(c)) break;
        if (c !== "\\") delimiter += c;
      }
      if (delimiter) heredocs.push(delimiter);
      i = j - 1;
      continue;
    }
    // >& and &> are redirections, not separators.
    if (ch === "&" && (src[i - 1] === ">" || src[i - 1] === "<" || src[i + 1] === ">")) { word += ch; inWord = true; continue; }
    if (ch === "|") {
      endCommand();
      if (src[i + 1] === "|") { i++; piped = false; } // || runs the next command when this one fails; nothing is piped
      else { if (src[i + 1] === "&") i++; piped = true; }
      continue;
    }
    if (ch === ";" || ch === "&") { endCommand(); piped = false; continue; }
    if (ch === "(" || ch === ")") { endCommand(); continue; }
    if (ch === " " || ch === "\t" || ch === "\r") { endWord(); continue; }
    word += ch; inWord = true;
  }
  // What the shell itself could not run is not let through: the guard fails closed.
  if (quote) throw new Error("an unclosed quote");
  if (heredocs.length) throw new Error(`a heredoc that never reaches ${heredocs[0]}`);
  endCommand();
  return commands;
}

/**
 * Programs that run the rest of their words as a command: the options of each that take a value
 * as the next word, and how many words of its own come before the command (timeout's duration,
 * chrt's priority, taskset's mask, flock's file). flock -c runs its string with sh -c, and is
 * read as that.
 */
const WRAPPERS = {
  time: { values: [] },
  nohup: { values: [] },
  command: { values: [] },
  exec: { values: ["-a"] },
  builtin: { values: [] },
  nice: { values: ["-n", "--adjustment"] },
  timeout: { values: ["-s", "--signal", "-k", "--kill-after"], positionals: 1 },
  stdbuf: { values: [] },
  setsid: { values: [] },
  ionice: { values: ["-c", "--class", "-n", "--classdata", "-p", "--pid", "-u", "--uid"] },
  chrt: { values: [], positionals: 1 },
  taskset: { values: [], positionals: 1 },
  flock: { values: ["-w", "--wait", "--timeout", "-E", "--conflict-exit-code"], positionals: 1 },
  unbuffer: { values: [] },
  doas: { values: ["-C", "-u"] },
  busybox: { values: [] },
};

const setting = (w) => /^[A-Za-z_][A-Za-z0-9_]*=/.test(w);

/** The index of a command's program, from `start`: past VAR=value prefixes, env and the wrappers. flock -c hands back its string instead. */
function programIndex(words, start) {
  let i = start;
  for (;;) {
    while (i < words.length && setting(words[i])) i++;
    const w = words[i];
    if (w === "env") {
      i++;
      while (i < words.length && (words[i].startsWith("-") || setting(words[i]))) i += words[i] === "-u" || words[i] === "--unset" ? 2 : 1;
      continue;
    }
    if (w !== undefined && Object.hasOwn(WRAPPERS, w)) {
      const { values, positionals = 0 } = WRAPPERS[w];
      i++;
      while (i < words.length && words[i].startsWith("-")) i += values.includes(words[i]) ? 2 : 1;
      i += positionals;
      if (w === "flock" && (words[i] === "-c" || words[i] === "--command") && words[i + 1] !== undefined) return { at: i, shellString: words[i + 1] };
      continue;
    }
    return { at: i };
  }
}

/**
 * A command's program and the words after it: past any VAR=value prefixes, env with its options
 * and settings, and the wrappers that run a command (time, nohup, nice, timeout, setsid, doas,
 * busybox and the like), so timeout 60 git push is still git push.
 */
function programOf(words) {
  const { at, shellString } = programIndex(words, 0);
  if (shellString !== undefined) return { program: "sh", rest: ["-c", shellString] };
  return { program: words[at], rest: words.slice(at + 1) };
}

/** Programs that run their first positional word as a command, and their options that take a value. npm exec is handled by name. */
const RUNNERS = {
  npx: ["-p", "--package", "-c", "--call"],
  xargs: ["-I", "-n", "-P", "-L", "-s", "-d", "-a", "-E", "--max-args", "--max-procs", "--max-lines", "--max-chars", "--delimiter", "--arg-file", "--eof", "--replace"],
};

/**
 * The command a list of words runs in the end: past the wrappers programOf() skips and past the
 * runners that hand their first positional word to the shell as a command (npx, npm exec, xargs).
 * What G03 and G04 judge, so xargs find . -delete and npx find . -delete are finds.
 */
function runOf(words) {
  let at = 0;
  for (;;) {
    const r = programIndex(words, at);
    if (r.shellString !== undefined) return { program: "sh", rest: ["-c", r.shellString] };
    at = r.at;
    const program = words[at];
    if (program === undefined) return { program: undefined, rest: [] };
    const name = base(program);
    let values, i = at + 1;
    if (name === "npm" && words[i] === "exec") { i++; values = []; }
    else if (Object.hasOwn(RUNNERS, name)) values = RUNNERS[name];
    else return { program, rest: words.slice(at + 1) };
    while (i < words.length && words[i].startsWith("-") && words[i] !== "--") i += values.includes(words[i]) ? 2 : 1;
    if (words[i] === "--") i++;
    at = i;
  }
}

/**
 * The commands a line runs, with the string given to sh -c, bash -c and the like run as commands
 * too. Each command carries its depth: 0 on the line itself, 1 inside a shell string, and so on.
 */
function withShellStrings(commands, depth = 0) {
  const out = [];
  for (const words of commands) {
    words.depth = depth;
    out.push(words);
    const { program, rest } = programOf(words);
    if (!/^(sh|bash|zsh|dash|ksh)$/.test((program ?? "").split("/").pop())) continue;
    const c = rest.findIndex((a) => /^-[A-Za-z]*c[A-Za-z]*$/.test(a));
    if (c === -1 || rest[c + 1] === undefined) continue;
    if (depth >= 3) throw new Error("shells nested more than three deep");
    out.push(...withShellStrings(commandsOf(rest[c + 1]), depth + 1));
  }
  return out;
}

/** A word's last path part: what /usr/bin/git and node_modules/.bin/cdk name. */
const base = (w) => w.split("/").pop();

// git's own options that take a value as the next word, before the subcommand.
const GIT_VALUE_OPTIONS = new Set(["-C", "-c", "--git-dir", "--work-tree", "--namespace", "--exec-path", "--config-env", "--super-prefix"]);
// git push's options that take a value as the next word.
const PUSH_VALUE_OPTIONS = new Set(["-o", "--push-option", "--repo", "--receive-pack", "--exec"]);

/**
 * Every git push in a command, wherever git appears as a word in it (after xargs, find -exec,
 * watch, or by path): each one's options and positional arguments. A listing, for a tool that
 * wants to show them; it costs a pass per push, so the rules ask anyPush() instead.
 */
function pushesOf(words) {
  const out = [];
  words.forEach((w, at) => {
    if (base(w) !== "git") return;
    const rest = words.slice(at + 1);
    let i = 0;
    while (i < rest.length && rest[i].startsWith("-")) i += GIT_VALUE_OPTIONS.has(rest[i]) ? 2 : 1;
    if (rest[i] !== "push") return;
    const options = [], positionals = [];
    for (let j = i + 1; j < rest.length; j++) {
      const a = rest[j];
      if (a === "--") { positionals.push(...rest.slice(j + 1)); break; }
      if (a.startsWith("-") && a !== "-") { options.push(a); if (PUSH_VALUE_OPTIONS.has(a)) j++; continue; }
      positionals.push(a);
    }
    out.push({ options, positionals });
  });
  return out;
}

/**
 * Whether any git push in a command (as pushesOf() finds them) has an option that satisfies
 * `option` or a positional argument that satisfies `positional`. The same answer as reading
 * pushesOf(), in one pass over the words from the right: each index records what reading push's
 * arguments from there to the end would find, and each git word asks the index after its
 * subcommand.
 */
function anyPush(words, { option = () => false, positional = () => false }) {
  const n = words.length;
  // later[i]: a word at or after i satisfies positional(); what comes after "--" is all positional.
  const later = new Array(n + 1).fill(false);
  for (let i = n - 1; i >= 0; i--) later[i] = later[i + 1] || positional(words[i]);
  // hit[i]: reading push's arguments from word i to the end finds an option or a positional that satisfies the test.
  const hit = new Array(n + 2).fill(false);
  for (let i = n - 1; i >= 0; i--) {
    const a = words[i];
    if (a === "--") hit[i] = later[i + 1];
    else if (a.startsWith("-") && a !== "-") hit[i] = option(a) || hit[i + (PUSH_VALUE_OPTIONS.has(a) ? 2 : 1)];
    else hit[i] = positional(a) || hit[i + 1];
  }
  // sub[i]: where git's subcommand sits when git's own options start at word i.
  const sub = new Array(n + 2).fill(n);
  for (let i = n - 1; i >= 0; i--) sub[i] = words[i].startsWith("-") ? sub[i + (GIT_VALUE_OPTIONS.has(words[i]) ? 2 : 1)] : i;
  return words.some((w, at) => base(w) === "git" && words[sub[at + 1]] === "push" && hit[sub[at + 1] + 1]);
}

// Interpreters that take code on the line, and the flags that hand it to them.
const INTERPRETERS = new Set(["node", "nodejs", "tsx", "ts-node", "bun", "deno", "perl", "ruby", "php"]);
const CODE_FLAGS = new Set(["-e", "--eval", "-p", "--print", "-E", "-r", "eval"]);

/**
 * The code a command hands an interpreter on the line, wherever the interpreter sits in it (after
 * npx, timeout, xargs, or by path): for each interpreter word, the code the first code flag after
 * it carries. One pass from the right finds the next code flag for every index.
 */
function inlineCodeOf(words) {
  const n = words.length;
  const next = new Array(n + 1).fill(-1);
  for (let j = n - 1; j >= 0; j--) {
    const a = words[j];
    // --eval=code, or -e and the short flags ending in e as perl and ruby run them (-pe, -ne, -we), with code in the next word.
    const handsCode = a.startsWith("--eval=") || a.startsWith("--print=") || ((CODE_FLAGS.has(a) || /^-[A-Za-z]+e$/.test(a)) && j + 1 < n);
    next[j] = handsCode ? j : next[j + 1];
  }
  const out = [];
  words.forEach((w, at) => {
    if (!INTERPRETERS.has(base(w))) return;
    const j = next[at + 1];
    if (j === -1) return;
    const a = words[j];
    out.push(a.startsWith("--eval=") || a.startsWith("--print=") ? a.slice(a.indexOf("=") + 1) : words[j + 1]);
  });
  return out;
}

// Programs that read files given on the line. grep and rg take a pattern first, which is not a path.
const READERS = new Set(["cat", "less", "head", "tail", "grep", "rg"]);
// The options of grep and rg that take a value as the next word; -e and -f name the pattern, -f from a file that is read.
const SEARCH_VALUE_OPTIONS = {
  grep: new Set(["-e", "--regexp", "-f", "--file", "-m", "--max-count", "-A", "-B", "-C", "--after-context", "--before-context", "--context", "-d", "--directories", "-D", "--devices", "--label", "--binary-files", "--include", "--exclude", "--exclude-dir", "--exclude-from"]),
  rg: new Set(["-e", "--regexp", "-f", "--file", "-g", "--glob", "--iglob", "-t", "--type", "-T", "--type-not", "-m", "--max-count", "-A", "-B", "-C", "--after-context", "--before-context", "--context", "-M", "--max-columns", "-j", "--threads", "-r", "--replace", "-E", "--encoding", "-d", "--max-depth"]),
};

/**
 * The paths a reader (cat, less, head, tail, grep, rg) is given: every word that is not an option,
 * an option's value, or the grep or rg pattern. A -f or --file pattern file is read, so it is a path.
 * null when the command's program is not a reader.
 */
function readPathsOf(words) {
  const { program, rest } = programOf(words);
  if (!READERS.has(program)) return null;
  const paths = [];
  const takesValue = SEARCH_VALUE_OPTIONS[program];
  let patternGiven = !takesValue;
  for (let i = 0; i < rest.length; i++) {
    const a = rest[i];
    if (a === "--") { paths.push(...rest.slice(i + 1).slice(patternGiven ? 0 : 1)); break; }
    if (takesValue && takesValue.has(a)) {
      if (a === "-e" || a === "--regexp") patternGiven = true;
      if (a === "-f" || a === "--file") { patternGiven = true; paths.push(rest[i + 1] ?? ""); }
      i++;
      continue;
    }
    if (takesValue && /^--(regexp|file)=/.test(a)) { patternGiven = true; if (a.startsWith("--file=")) paths.push(a.slice(7)); continue; }
    if (a.startsWith("-") && a !== "-" && !/^\d*[<>]/.test(a)) continue;
    if (!patternGiven) { patternGiven = true; continue; }
    paths.push(a);
  }
  return { program, paths };
}

/** The whitespace-collapsed line: what the regex rules read, and what the stderr line shows. */
const lineOf = (cmd) => String(cmd).replace(/\s+/g, " ").trim();

/**
 * Everything a rule may need from one tool call: the raw command, the whitespace-collapsed line
 * the regex rules read, the commands with shell strings expanded, and the inline code those
 * commands hand to interpreters. Throws when the line cannot be read; judge() turns that into G17.
 */
function parse(cmd) {
  const line = lineOf(cmd);
  const commands = withShellStrings(commandsOf(cmd));
  const inlineCode = commands.flatMap(inlineCodeOf);
  return { cmd, line, commands, inlineCode };
}

module.exports = {
  commandsOf,
  WRAPPERS,
  programOf,
  RUNNERS,
  runOf,
  withShellStrings,
  base,
  GIT_VALUE_OPTIONS,
  PUSH_VALUE_OPTIONS,
  pushesOf,
  anyPush,
  INTERPRETERS,
  CODE_FLAGS,
  inlineCodeOf,
  READERS,
  SEARCH_VALUE_OPTIONS,
  readPathsOf,
  lineOf,
  parse,
};
