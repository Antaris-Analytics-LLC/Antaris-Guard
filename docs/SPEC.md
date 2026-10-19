# Antaris-Guard v0.2: the design

v0.1 is the two hooks as they run in Inventaris: one file each, the rules hard-coded, installed by
copying. v0.2 keeps every behavior v0.1 has (its 166-case table passes unchanged throughout) and
turns the guard into something a second repository can adopt without editing code: a judge
library with three answers, a config file, a decision log, rule packs, a command line, and a
benchmark. This document is the target. `docs/ROADMAP.md` is the order.

## 1. Decisions

A judgment has three outcomes:

| Decision | What happens | Default for |
| --- | --- | --- |
| `allow` | The command runs. | Everything no rule names. |
| `ask` | Claude Code asks the operator before running it, showing the rule and reason. | Nothing by default. A rule the config moves to ask. Prompting for commands is Claude Code's own permission settings' job, and the guard does not add a second layer of prompts on top of them. |
| `deny` | The command does not run; the session sees the rule and reason. | Irreversible or exfiltrating: force push, push to a protected branch, secrets, recursive deletes, browser automation, deploys. |

Every rule has a default tier, and since R4 every default tier is `deny`. Config can move a rule
between `ask` and `deny`, or turn an optional rule off. A rule cannot be moved to `allow`; turning
it off is the only way to stop it, and a rule turned off has no effect at all, logged or
otherwise: the operator turned it off on purpose. A deny wins over an ask on the same line,
whichever rule comes first.

How each answer reaches Claude Code:

- `allow` is silence: exit 0, nothing printed. Claude Code's own permission settings then apply
  as usual. The guard never prints an `allow` decision, because a printed allow bypasses the
  permission prompt for that call, and a guard that auto-approves everything it does not name
  would be worse than no guard.
- `deny` is exit 2 with the reason on stderr, exactly as v0.1 does it. The session sees the
  reason; the command does not run.
- `ask` is exit 0 with JSON on stdout: `hookSpecificOutput` with `hookEventName` of
  `PreToolUse`, `permissionDecision` of `ask` and `permissionDecisionReason` carrying the rule
  and reason. Claude Code shows the operator the command and the reason and waits.

The session that builds R4 checks the current hook reference before writing a line and records
in the PR which version of the reference it built against.

## 2. Architecture

```
guard.js                  the Bash hook: stdin in, decision out; thin
subagent-guard.js         the Agent hook; thin
lib/parse.js              commandsOf, programOf, withShellStrings, inlineCodeOf, expandVars
lib/judge.js              judge(command, config, context) -> { decision, rule, reason, parse }
lib/rules/*.js            the core rules, one file each, with an id, a default tier, a test
lib/config.js             load, validate and default guard.config.json; fail closed
lib/log.js                the append-only, hash-chained decision log
lib/scan.js               reading a script file a command runs, and judging its text
packs/<name>/rules.js     optional rule packs, each with its own test table
configs/inventaris.json   the worked example config, the one the v0.1 table runs under
configs/antaris-analytics.json   Antaris Analytics' own config, the fallback its plugin edition names
.claude-plugin/marketplace.json  the plugin marketplace: two editions of the hooks, from R4b
bin/antaris-guard.js      explain, test, init, upgrade, check, compare, bench, log, verify-log
test/                     the v0.1 table (never shrinks) and one file per rule or pack
bench/corpus/             the evasion corpus and the legitimate set
bench/versions/           frozen copies of every released guard, v0.1 first, for compare and bench
```

The hooks stay single-file-loadable: `guard.js` requires `lib/` relatively, and `init` copies the
whole set into a repository's `.claude/hooks/antaris-guard/`. No runtime dependency, Node 22+.

From R4b the repository is also a Claude Code plugin marketplace, `antaris-guard`, whose plugin
root is the repository root. It lists two editions that share every file and differ in one
argument: `antaris-guard`, whose hooks run `node guard.js` and `node subagent-guard.js`, and
`antaris-guard-antaris-analytics`, whose hooks add `--fallback antaris-analytics`. Each edition's
hooks are written inline in its marketplace entry, with `onFailure: block`; there is no
`plugin.json` and no `hooks/hooks.json`, so neither edition can pick up the other's. An
organization turns one edition on for every session through its server-managed settings, pinned
to a tag. That is the only way a hook reaches a cloud session with more than one repository
attached: such a session reads no hooks, permission rules or env from any repository's
`.claude/settings.json` (Claude Code's cloud documentation, read 2026-10-19). The same managed
settings carry the denies and subagent caps of `settings.example.json`, and the Read denies a
repository's settings put on secret files and credential folders, which the guard cannot enforce
since it does not see the Read tool. The per-repository install
stays, for one-repository sessions and for sessions the managed settings do not reach.

`judge()` is pure: the same command, config and context give the same decision. It never reads
the disk except through `scan`, which is passed in, so tests can hand it a fake file reader.

## 3. Rule ids

Every rule has a stable id, `G` plus two digits for core and `<pack>-NN` for packs, and a short
name: `G07 push-to-protected`. The stderr line keeps v0.1's shape, with the id and name at the
front of the reason, so the v0.1 test harness still reads it:

```
guard: blocked (G07 push-to-protected: direct push to main; open a PR instead): git push origin main
guard: ask (docker-01 docker-outside-postgres: docker outside running a local Postgres): docker exec pg psql
```

The reason text of every v0.1 rule is kept word for word, because the v0.1 table matches on it.
Ids never change meaning. A retired rule's id is not reused.

### Core rules, with their v0.1 origin

| Id | Name | Tier | From v0.1 |
| --- | --- | --- | --- |
| G01 | blocked-program | deny | the blocked programs list, now in config |
| G02 | recursive-delete | deny | `rm -r` |
| G03 | delete-in-inline-code | deny | delete calls inside `node -e` and the like |
| G04 | find-or-xargs-delete | deny | `find -delete`, `find -exec rm`, `xargs rm` |
| G05 | remove-item-recurse | deny | PowerShell |
| G06 | force-push | deny | |
| G07 | push-to-protected | deny | push to main or master; the branch list is config |
| G08 | destructive-git | deny | `reset --hard`, `clean -f`, `branch -D` |
| G09 | secret-on-command-line | deny | the env names are config |
| G10 | command-substitution | deny | `$(...)` and backticks |
| G11 | pipe-into-interpreter | deny | |
| G12 | reads-secret-file | deny | the path patterns are config |
| G13 | credential-directory | deny | `~/.aws` and the others, config |
| G14 | push-or-deploy-in-inline-code | deny | |
| G15 | wide-chmod | deny | |
| G16 | protected-path | deny | `.claude/`, `CLAUDE.md`, `.mcp.json`, plus config; from R3 judged per command, heredoc bodies included, with comments and the message text of `git commit`, `git tag`, `gh pr` and `gh issue` left out, and one read let through: a reading program or `cp` source reading a file under `~/.claude/uploads`; from R4b the exact folder name `.claude-plugin`, where a plugin keeps its manifest, is not `.claude`, and every other name after `.claude-` still is |
| G17 | unreadable | deny | an unclosed quote, a heredoc with no end, shells nested too deep, a rule that threw |
| G18 | browser-automation | deny | new: playwright, puppeteer, chromium, pw-browsers, headless, selenium, webdriver |
| G19 | push-to-url-or-unknown-remote | deny | new: `git push https://...`, a remote not in config, `git remote add` or `set-url` |
| G20 | script-file | by what it finds | new: the text of a script the command runs, judged by G03, G14, G18 and the packs |
| G21 | push-to-branch | dropped in R4 | Claude Code's own settings already ask about a push; the id is not reused |
| G22 | ask-program | dropped in R4 | Claude Code's own settings already ask about a program; the id is not reused |
| G23 | variable-command | deny | new: a git subcommand or a program that comes from a variable the guard cannot resolve |
| G24 | guard-install | deny | new: `antaris-guard init` or `upgrade`, by name or by script path; installing the guard is the operator's act |

The cdk, Docker and AWS profile rules leave core and become the `aws-cdk` and `docker` packs,
so a repository without them never sees them. Inventaris's config turns both packs on. Until the
packs round lands they stay in `lib/rules/` under their pack ids (`aws-cdk-01`, `aws-cdk-02`,
`docker-01`), so nothing in the table moves twice.

## 4. Config

One file, `.claude/guard.config.json`, and nowhere else. It sits under a protected path on
purpose: the session's shell cannot name it (G16) and the settings deny the editing tools, so the
config has the same standing as the hooks themselves. A config at the project root would be a
file the session can edit, which is a guard the session can loosen; there is none. The project
root is `CLAUDE_PROJECT_DIR` when Claude Code sets it, else the `cwd` field of the hook's stdin,
else the process working directory.

No config file is not a block from R4b (Jake, 2026-10-19). With the guard turned on for a whole
organization as a plugin, a session with several repositories starts in a folder above them where
there is no config, and a repository without one would have every command refused; that is a
cage, not a guard. A missing file falls back: to `configs/<name>.json` beside `lib/` when the hook
is started with `--fallback <name>` (a name of lowercase words joined by hyphens, so it can only
name a file in that folder), else to the built-in defaults. The cost is the one absence-is-refusal
used to prevent: a file git can remove without anyone naming it (checking out an older commit) now
loosens the guard to the fallback instead of blocking. For a guard against honest mistakes, Jake
chose that trade. Until R4b, no file blocked every command with `G17`.

A file that is there but cannot be read or is not JSON, a fallback that cannot be read, and
arguments the hook does not take still block every command with `G17`. The built-in defaults are
also what `init` writes for a new repository and what the defaults comparison in the tests runs
on. Unknown keys fail validation, and a config that fails validation, a fallback included, blocks
every command with `G17` and the validation message.

```json
{
  "version": 1,
  "operator": "Jake",
  "protectedBranches": ["main", "master"],
  "remotes": ["origin"],
  "protectedPaths": [".claude/", "CLAUDE.md", ".mcp.json"],
  "secretPaths": [".env", ".env.*", "*.pem", "*.key", "*.p12"],
  "secretEnv": ["AWS_SECRET_ACCESS_KEY", "AWS_SESSION_TOKEN", "DATABASE_URL", "GITHUB_TOKEN"],
  "credentialPaths": ["~/.aws", "~/.ssh", "~/.config", "~/.netrc", "~/.npmrc"],
  "blockedPrograms": ["sudo", "su", "curl", "wget", "ssh", "scp", "nc", "ncat", "telnet", "dd", "mkfs", "crontab", "eval", "base64", "xxd", "python", "python3", "pip", "pip3"],
  "packs": ["node", "aws-cdk", "docker"],
  "rules": { "docker-01": "ask" },
  "scan": { "enabled": true, "maxBytes": 262144 },
  "log": { "enabled": true, "path": ".claude/guard/log.jsonl" },
  "subagents": { "maxPerSession": 5, "models": ["sonnet", "opus", "haiku"], "forks": false, "isolation": false }
}
```

`rules` moves a rule between `ask` and `deny` or turns an optional one `off`. Core rules G02,
G06, G07, G09, G10, G12, G16, G17 and G24 cannot be turned off. `configs/inventaris.json` ships
as the worked example and is what Inventaris pins; the v0.1 table runs under it, since that is
the repository the table was written for. Tests hand `judge()` a config object directly; one
test covers the file lookup with a temporary project directory.

## 5. The decision log

Every judgment appends one line to `log.path` (default `.claude/guard/log.jsonl`, which sits
under a protected path, so the session's shell cannot touch it; the hook process writes it):

```json
{"v":1,"t":"2026-10-17T20:14:03.211Z","session":"b1c2…","tool":"Bash","decision":"deny","rule":"G07","reason":"direct push to main; open a PR instead","cmd_sha256":"…","prev":"…","hash":"…"}
```

`v` is the shape of the line, `1` for now, first on every line, so a later shape can be told
apart. `hash` is SHA-256 over the line's JSON text without `hash`, keys in the order shown; the
first line's `prev` is the string `genesis`. Every decision is logged, allows included, so the
chain is the session's whole command history and a gap is visible. On an allow, `rule` is null
and `reason` is empty. The command itself is not stored, only its hash, so the log holds no
secret a command carried.

Hook processes run at the same time when a session makes parallel tool calls, and two lines
must never share a `prev`. The tail is read and the line appended under a lock file beside the
log, created with the `wx` flag and holding the writer's pid and a random token; a writer waits
on it for up to 15 seconds, a lock whose holder is dead is cleared at once, and one older than 60
seconds is cleared as well. Ordinary contention never comes near the limit; a lock held that long
means the log is stuck, and that is a `G17` block that says so. A lock is removed only while it
is still the one that was read: a writer clearing a stale lock reads it again just before
removing it, and a writer releasing its lock checks that it still holds its own token. That
narrows a race it cannot close: a dead holder's lock cleared by two writers at the same moment,
or a holder that stalls past 60 seconds, can still let two hooks append at once, and the chain
forks, two lines with one `prev`, which `verify-log` reports as a bad line that looks like a
fork. The README names the limit and how a fork reads next to tampering.

`antaris-guard verify-log` walks the whole chain and reports every break, going on after each from
the hash the broken line carries, and says when a break looks like a fork, two lines sharing one
`prev`; with `--tip <hash>` it also names the line that carries that hash, which proves every
line up to it is as it was when the tip was noted, and fails when no line carries it or the chain
breaks at or before that line. `antaris-guard log` summarizes: decisions by rule,
by day, by session, by tool, and prints the tip. What the chain proves: that no line inside the
file was changed, added or removed by anyone who did not also recompute every line after it.
Lines cut from the end of the file leave nothing after them to break and are found only with
`--tip`, when the cut reaches the tip's line; lines added to the end look like the log growing. What it
does not prove: that the file is the one the hooks wrote, since whoever can write the file can
rewrite the whole chain, and the hook has no secret a session could not also read. The
protection is that a session cannot reach the file: `log.path` must sit under `.claude/` or a
folder `protectedPaths` names, and a config that points anywhere else fails validation, naming
the path. A tip the operator keeps where no session can write (the pull request thread) makes a
full rewrite visible to a later `verify-log --tip`.

A log the hook cannot write is itself a block (`G17`), because a guard that cannot keep its
record is not guarding. `init` adds `.claude/guard/` to the repository's `.gitignore`, and
`check` confirms the line is there, so a `git add -A` never stages the log.

Subagent decisions log the same way, with `tool` of `Agent` and `model`, the model asked for,
after `tool`; the two hooks write one chain.

## 6. Reading the script a command runs

The known gap in v0.1: the guard sees `node walkthrough.js`, never the file. In v0.2, when a
command's program is an interpreter or a shell and one of its arguments is a path inside the
project (not a symlink out of it, not larger than `scan.maxBytes`), the guard reads the file and
applies the text rules to it: G03 (delete calls), G14 (git push or a deploy via `child_process`,
`subprocess`, `system`), G18 (browser automation imports and requires), and any pack text rules.
`npm run <name>`, `yarn <name>` and `pnpm <name>` resolve the script line from `package.json`
and judge that line as a command, three levels deep. The edges:

- A file the guard cannot read, or that is too big, is `G17`.
- A path that resolves outside the project (a symlink out, `..`, an absolute path elsewhere) is
  `G17`: the guard does not read outside the repository it guards.
- A file the line itself writes before running it (`echo ... > x.js && node x.js`, `tee`, `cp`,
  `mv` to the same path) is `G17`: what is on disk when the guard looks is not what will run.
- A file that does not exist when the guard looks is `ask`: the command may be a mistake, or the
  file may be made by an earlier command on the same line, and the operator can tell which.

The scan is a text judgment and says so in its reason. It is not an execution sandbox, and the
README is plain about what it does not catch: code that builds a command from pieces at runtime,
a script that writes another script, a dependency that does the work.

## 7. Variables

`x=push; git $x origin main` is the other known gap. `expandVars` tracks `NAME=value` assignments
within the line (and `export NAME=value`) and substitutes `$NAME` and `${NAME}` before judging. A
`$NAME` the line does not define, sitting where a program or a git subcommand goes, is `G23`:
the guard cannot know what runs, so it does not let it run. A `$NAME` in an ordinary argument
position is left alone, since the rules on paths and refs already treat unknown text as unknown.

## 8. Packs

A pack is a folder with `rules.js` (rules with ids `<pack>-NN`, each with a default tier) and
`rules.test.ts` (its own blocked and allowed table). Config lists the packs in force. The first
set:

| Pack | Covers |
| --- | --- |
| `node` | `npm publish` (ask), `npx` of a package not in `package.json` (ask), `npm install -g` (deny) |
| `python` | `pip install` outside a virtualenv (ask), `python -c` with the text rules applied |
| `aws-cdk` | `cdk deploy` and `cdk destroy` by any name (deny), a `--profile` not in the pack's allowed list (deny) |
| `terraform` | `terraform apply` and `destroy` (deny), `plan` allowed |
| `kubernetes` | `kubectl delete` and `apply` (deny), contexts not in an allowed list (deny) |
| `cloud-cli` | `aws`, `gcloud`, `az` subcommands that delete or change IAM (deny); reads allowed |
| `docker` | `docker exec`, `rm`, `system`, `run --privileged` or with `/` mounted (deny); `docker run` of an image not in an allowed list (ask) |

Packs cannot weaken core rules. A pack rule that throws is `G17` like any other.

## 9. The command line

`npx antaris-guard <command>`:

| Command | What it does |
| --- | --- |
| `explain "<command>"` | Prints the parse (commands, programs, piped, inline code, variables, scanned files) and the decision with its rule. With `--fallback <name>`, a folder with no config is judged by that fallback, as the hook started with the same argument judges it. |
| `test` | Runs the v0.1 table, every rule's table and every pack's table. |
| `init` | Copies the hooks and `lib/` into `.claude/hooks/antaris-guard/`, writes a starter `.claude/guard.config.json` if there is none, adds `.claude/guard/` to `.gitignore`, and prints the `settings.json` block to add. An operator's command: it refuses to run without a terminal on stdin, which is how it tells a person from a session, and G24 denies it from a session by name. |
| `upgrade` | `init` again over an existing install, keeping the config. Same two checks. |
| `check` | Compares a repository's installed copy to the package at the version in its lockfile, and the `.gitignore` line, and fails CI when they differ. This replaces a copy-by-hand mirror and its test. |
| `compare <old-guard.js>` | Replays the whole table against an older guard and lists every case where the decision or the reason differs: the tool that found the nineteen. |
| `bench [guard.js]` | Scores a guard against the evasion corpus, by category. |
| `log`, `verify-log` | Summarize the decision log; verify the chain. |

## 10. The benchmark

`bench/corpus/` holds command shapes that get past naive guards, one file per category:
quoting, wrappers, inline code, variables, pipes, paths and names, shells within shells, script
files, browser automation, and protected paths. Each case says what must happen (`deny` or
`ask`) and why. Beside them, `bench/corpus/legitimate.json` holds commands a session needs
every day, each of which must be allowed, so a guard that denies everything does not score
well. The scorer runs a guard over every case and reports two numbers per category and
overall: the share of evasions caught, and the share of legitimate commands let through. The
table in the README shows both numbers for every released version, starting with v0.1 from its
frozen copy under `bench/versions/`, so a change that regresses is visible. Cases are added by
pull request with the assertion and a one-line reason; a case that a released version passes
stays in the corpus forever.

## 11. Subagent guard

Config replaces the constants: `maxPerSession`, the model list, `forks`, `isolation`. The count
still lives in the system temp folder with the `wx` flag. Every decision logs with the model
asked for, so a session's spawn history is in the same chain as its commands.

## 12. Out of scope for v0.2

PowerShell and cmd.exe parsing (the POSIX splitter handles the shapes Claude Code uses on Windows
badly, and a `G17` block on an unparseable line is the honest answer until a real parser lands);
network allowlists by host; log rotation (a line is a few hundred bytes and `log` reports the
size); anything that needs to run the command to judge it.

## 13. Compatibility

v0.2 passes the v0.1 table byte for byte. A repository running v0.1 hooks keeps working; `init`
upgrades it when the operator chooses. Semantic versioning: a new rule or a tier change is a
minor version, a parser change that alters any decision is a major version until the table proves
otherwise.
