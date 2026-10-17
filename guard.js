#!/usr/bin/env node
/*
 * Antaris-Guard: the Bash guard. This file is the hook that runs in Inventaris (Antaris Analytics)
 * as .claude/hooks/guard.js, published as it is there, rules and all. test/guard.test.ts runs it
 * against every command in its table. The rules at the bottom name a few things specific to that
 * repository (cdk, an AWS profile, Docker); the README says which to keep and which to change.
 *
 * PreToolUse hook for Bash. Reads the tool call from stdin, exits 2 to block with a reason,
 * exits 0 to allow. The permission rules in settings.json are prefix matches on the first
 * command; this hook looks at the whole line, so chained commands, subshells, pipes to
 * interpreters and secret-shaped arguments are caught too. It also keeps sessions away from
 * their own rules: .claude/, CLAUDE.md and .mcp.json are Jake's to change. Reading them with
 * the Read tool is fine; the shell rule is broad on purpose so no write slips through.
 * If the tool call can't be read, the command is blocked.
 *
 * Deletes are the rule most worth getting around, so the ways around the shell's "rm -r" are
 * blocked by name: a delete call inside inline code (node -e, tsx -e, perl -e and the like),
 * find with -delete or -exec rm, and xargs rm. Searching code for those words (grep, rg) is
 * still fine, and so is a plain git rm of a tracked file. A script file that deletes is not
 * caught here: that is the rule in CLAUDE.md, and the session's to keep.
 *
 * Four rules judge commands, not the line (16 October): a push to main or a force push, cdk
 * deploy or destroy, reading a secret file, and piping into an interpreter. The line is split the
 * way the shell would run it, on ; && || | & ( ) and newlines outside quotes, and a command's
 * program is its first word after any VAR=value prefixes (and env, time, nohup, nice, timeout and
 * the like, which run the rest). Quotes are removed from each word, a heredoc's body and a #
 * comment are no command at all, so a commit message, a quoted string or a grep pattern that only
 * mentions one of these is not caught; the string given to sh -c or bash -c is a command, and is
 * judged as one. A command after a real | or |& is marked as piped; || is not a pipe. The other
 * rules still read the whole line, on purpose: they are broad so nothing slips through.
 *
 * Second round (16 October): git and cdk are found as a word anywhere in a command, by name or
 * by path, so whatever runs them (npx, npm exec, xargs, find -exec, watch, /usr/bin/git) is
 * caught, and cdk by any of its names (cdk, aws-cdk, with a version). The code a command hands an
 * interpreter on the line (node -e and the like, wherever the interpreter sits in the command) is
 * judged too: a delete, a git push, or a cdk deploy or destroy in it is blocked. And the guard
 * fails closed: a line it cannot read (an unclosed quote, an unfinished heredoc, shells nested
 * more than three deep) or a rule that throws is blocked, never let through.
 */

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

// Programs that run the rest of their words as a command, and their own options that take a value.
const WRAPPERS = { time: [], nohup: [], command: [], exec: ["-a"], builtin: [], nice: ["-n", "--adjustment"], timeout: ["-s", "--signal", "-k", "--kill-after"], stdbuf: [] };

/**
 * A command's program and the words after it: past any VAR=value prefixes, env with its options
 * and settings, and the wrappers that run a command (time, nohup, nice, timeout and the like), so
 * timeout 60 git push is still git push.
 */
function programOf(words) {
  let i = 0;
  const setting = (w) => /^[A-Za-z_][A-Za-z0-9_]*=/.test(w);
  for (;;) {
    while (i < words.length && setting(words[i])) i++;
    const w = words[i];
    if (w === "env") {
      i++;
      while (i < words.length && (words[i].startsWith("-") || setting(words[i]))) i += words[i] === "-u" || words[i] === "--unset" ? 2 : 1;
      continue;
    }
    if (w !== undefined && Object.hasOwn(WRAPPERS, w)) {
      i++;
      while (i < words.length && words[i].startsWith("-")) i += WRAPPERS[w].includes(words[i]) ? 2 : 1;
      if (w === "timeout") i++; // the duration
      continue;
    }
    return { program: words[i], rest: words.slice(i + 1) };
  }
}

/** The commands a line runs, with the string given to sh -c, bash -c and the like run as commands too. */
function withShellStrings(commands, depth = 0) {
  const out = [];
  for (const words of commands) {
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

// git's own options that take a value as the next word, before the subcommand.
const GIT_VALUE_OPTIONS = new Set(["-C", "-c", "--git-dir", "--work-tree", "--namespace", "--exec-path", "--config-env", "--super-prefix"]);
// git push's options that take a value as the next word.
const PUSH_VALUE_OPTIONS = new Set(["-o", "--push-option", "--repo", "--receive-pack", "--exec"]);
const MAIN_REFS = new Set(["main", "master", "refs/heads/main", "refs/heads/master"]);

/** A word's last path part: what /usr/bin/git and node_modules/.bin/cdk name. */
const base = (w) => w.split("/").pop();

/**
 * Every git push in a command, wherever git appears as a word in it (after xargs, find -exec,
 * watch, or by path): each one's options and positional arguments.
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

/** A push whose positional argument names main or master, once a leading + and anything before a colon are removed. */
const pushesToMain = (words) =>
  pushesOf(words).some((p) => p.positionals.some((a) => MAIN_REFS.has(a.replace(/^\+/, "").replace(/^[^:]*:/, ""))));

/** A push with --force, --force-with-lease, --force-if-includes, -f (alone or among short flags, like -uf), or a positional starting with +. */
const forcePushes = (words) =>
  pushesOf(words).some((p) => p.options.some((o) => /^--force(-with-lease|-if-includes)?(=.*)?$/.test(o) || /^-[A-Za-z]*f[A-Za-z]*$/.test(o)) || p.positionals.some((a) => a.startsWith("+")));

/** cdk by any of its names: cdk, aws-cdk, with a version, or by path. */
const CDK = /^(aws-)?cdk(@[^/]*)?$/;

/**
 * cdk deploy or destroy: cdk as a word anywhere in the command (run by npx, npm exec, pnpm, yarn,
 * xargs or a path), with deploy or destroy after it. Sessions run cdk synth only (CLAUDE.md), whatever the profile.
 */
const cdkDeploys = (words) => words.some((w, at) => CDK.test(base(w)) && words.slice(at + 1).some((a) => a === "deploy" || a === "destroy"));

// Interpreters that take code on the line, and the flags that hand it to them.
const INTERPRETERS = new Set(["node", "nodejs", "tsx", "ts-node", "bun", "deno", "perl", "ruby", "php"]);
const CODE_FLAGS = new Set(["-e", "--eval", "-p", "--print", "-E", "-r", "eval"]);

/** The code a command hands an interpreter on the line, wherever the interpreter sits in it (after npx, timeout, xargs, or by path). */
function inlineCodeOf(words) {
  const out = [];
  words.forEach((w, at) => {
    if (!INTERPRETERS.has(base(w))) return;
    for (let j = at + 1; j < words.length; j++) {
      const a = words[j];
      if (a.startsWith("--eval=") || a.startsWith("--print=")) { out.push(a.slice(a.indexOf("=") + 1)); break; }
      // -e, and short flags ending in e as perl and ruby run them (-pe, -ne, -we).
      if ((CODE_FLAGS.has(a) || /^-[A-Za-z]+e$/.test(a)) && words[j + 1] !== undefined) { out.push(words[j + 1]); break; }
    }
  });
  return out;
}

/** A call that removes files, in any of those languages. */
const DELETE_CALL = /\b(rmSync|rmdirSync|unlinkSync|unlink|rimraf|rmtree|rm_rf|rm_r|remove_tree|removeSync|rm\s*\(|rmdir\s*\(|fs\.rm\b|promises\.rm\b|Deno\.remove|FileUtils\.rm)/;

/** Inline code that runs a git push, or a cdk deploy or destroy, however it calls them. */
const pushOrDeployIn = (code) => /\bgit\b[\s\S]*\bpush\b/.test(code) || /\b(aws-)?cdk\b[\s\S]*\b(deploy|destroy)\b/.test(code);

const READERS = new Set(["cat", "less", "head", "tail", "grep", "rg"]);
// The options of grep and rg that take a value as the next word; -e and -f name the pattern, -f from a file that is read.
const SEARCH_VALUE_OPTIONS = {
  grep: new Set(["-e", "--regexp", "-f", "--file", "-m", "--max-count", "-A", "-B", "-C", "--after-context", "--before-context", "--context", "-d", "--directories", "-D", "--devices", "--label", "--binary-files", "--include", "--exclude", "--exclude-dir", "--exclude-from"]),
  rg: new Set(["-e", "--regexp", "-f", "--file", "-g", "--glob", "--iglob", "-t", "--type", "-T", "--type-not", "-m", "--max-count", "-A", "-B", "-C", "--after-context", "--before-context", "--context", "-M", "--max-columns", "-j", "--threads", "-r", "--replace", "-E", "--encoding", "-d", "--max-depth"]),
};

/** A path whose basename is .env or .env.anything, or ends in .pem, .key or .p12. A redirection's arrows are not part of it. */
const secretPath = (w) => {
  const base = w.replace(/^\d*[<>]+&?/, "").split("/").pop();
  return base === ".env" || base.startsWith(".env.") || /\.(pem|key|p12)$/.test(base);
};

/** cat, less, head, tail, grep or rg reading a secret file: judged on the paths it reads, never on a grep or rg pattern. */
const readsSecret = (words) => {
  const { program, rest } = programOf(words);
  if (!READERS.has(program)) return false;
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
  return paths.some(secretPath);
};

/** A command after a real pipe whose program is sh, bash, zsh, node or python, by name or path: what comes down the pipe is run as code. */
const pipesIntoInterpreter = (words) => !!words.piped && /^(sh|bash|zsh|node|python(3(\.\d+)?)?)$/.test((programOf(words).program ?? "").split("/").pop());

let input = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (d) => (input += d));
process.stdin.on("end", () => {
  let cmd = "";
  try { cmd = String(JSON.parse(input).tool_input?.command || ""); } catch { process.stderr.write("guard: blocked (could not read the tool call)\n"); process.exit(2); }
  const line = cmd.replace(/\s+/g, " ").trim();
  const block = (why) => { process.stderr.write(`guard: blocked (${why}): ${line}\n`); process.exit(2); };
  // The commands in the line, for the rules that judge commands rather than text. A line that cannot be read is blocked.
  let commands = [];
  try { commands = withShellStrings(commandsOf(cmd)); } catch (e) { block(`could not read the command: ${e.message}`); }
  const anyCommand = (test) => () => commands.some(test);
  const inlineCode = commands.flatMap(inlineCodeOf);

  // The start of a command in the line: the line itself, or after ; & | ( and any VAR=value, env or npx prefix.
  const command = "(^|[;&|(]\\s*)(\\S+=\\S+ )*(env( \\S+)*? |npx |npm exec )?";
  // An interpreter run as a command and given code on the line rather than a file, read off the line too, broad on purpose.
  const inlineCodeLine = new RegExp(`${command}(node|nodejs|tsx|ts-node|bun|deno|perl|ruby|php)\\b[^|;&]*?\\s(-e|--eval|-p|--print|-pe|-ne|-E|-r|eval)\\b`);
  // find and xargs run as commands, so a search whose pattern mentions them is left alone.
  const findDelete = new RegExp(`${command}find\\b[^|;&]*\\s-delete\\b`);
  const findExecRm = new RegExp(`${command}find\\b[^|;&]*\\s-exec(dir)?\\s+rm\\b`);
  const xargsRm = new RegExp(`${command}xargs\\b[^|;&]*\\brm\\b`);

  const blocked = [
    [/(^|[;&|`(]\s*)(sudo|su|curl|wget|ssh|scp|nc|ncat|telnet|dd|mkfs|crontab|eval|base64|xxd|python3?|pip3?)\b/, "a blocked program appears somewhere in the line"],
    [/\brm\s+(-[a-zA-Z]*r[a-zA-Z]*|--recursive)/, "recursive delete"],
    [(l) => (inlineCodeLine.test(l) && DELETE_CALL.test(l)) || inlineCode.some((code) => DELETE_CALL.test(code)), "a delete inside inline code is still a delete; if a delete is needed, say what was blocked and stop"],
    [findDelete, "find -delete is a delete"],
    [findExecRm, "find -exec rm is a delete"],
    [xargsRm, "xargs rm is a delete"],
    [/\bRemove-Item\b[^|;&]*-Recurse\b/i, "recursive delete"],
    [anyCommand(forcePushes), "force push"],
    [anyCommand(pushesToMain), "direct push to main; open a PR instead"],
    [/\bgit\s+(reset\s+--hard|clean\s+-[a-zA-Z]*f|branch\s+-D)/, "destructive git"],
    [/\b(AWS_SECRET_ACCESS_KEY|AWS_SESSION_TOKEN|DATABASE_URL|COGNITO_CLIENT_SECRET|GITHUB_TOKEN)\s*=/, "setting a secret on the command line"],
    [/\$\(.*\)|`[^`]*`/, "command substitution"],
    [anyCommand(pipesIntoInterpreter), "piping into an interpreter"],
    [anyCommand(readsSecret), "reading a secret file"],
    [/~\/\.(aws|ssh|config|netrc|npmrc)/, "reading credential directories"],
    [anyCommand(cdkDeploys), "cdk deploy or destroy; sessions run cdk synth only"],
    [() => inlineCode.some(pushOrDeployIn), "a git push or a cdk deploy or destroy inside inline code is still one; push with git on the command line, and sessions run cdk synth only"],
    [/--profile\s+inventaris-prod/, "the prod profile is never used from a session"],
    [/\b(docker)\s+(exec|rm|system|run\b.*(--privileged|-v\s*\/:))/, "docker outside running a local Postgres"],
    [/\bchmod\s+(777|-R)/, "wide chmod"],
    [/(^|[^\w.-])\.claude\b|\bclaude(\.local)?\.md\b|(^|[^\w.-])\.mcp\.json\b/i, "the session's own rules (.claude/, CLAUDE.md, .mcp.json) are changed by Jake, not by a session. Shell commands can't touch them; to look at one, open it with the Read tool"],
  ];
  for (const [rule, why] of blocked) {
    // A rule that throws has not judged the line, so the line is blocked rather than let through.
    let hit = true;
    try { hit = typeof rule === "function" ? rule(line) : rule.test(line); } catch (e) { block(`the guard could not judge the command: ${e.message}`); }
    if (hit) block(why);
  }
  process.exit(0);
});
