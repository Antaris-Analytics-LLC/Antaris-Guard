# Antaris-Guard

A fail-closed command guard for coding agents. Parses every shell command the way a shell does, judges it, and blocks what it can't read.

Two hooks for Claude Code, published as they run in production at Antaris Analytics:

- `guard.js` judges every Bash command before it runs.
- `subagent-guard.js` caps what subagents may do: which model, how many, no forks, no nesting.

Both read the tool call as JSON on stdin, exit 2 with a reason to block, exit 0 to allow. Anything they cannot read is blocked.

## Why this exists

A rule in a prompt is not a guard. A coding agent will follow "never push to main" in a CLAUDE.md right up until the push is hidden inside a quoted shell string, handed to `xargs`, run through `timeout 60`, or written into `node -e`. The permission lists in Claude Code's settings are prefix matches on the first command on the line; they cannot see a second command after `&&`, a subshell, or a pipe into `sh`.

The first version of this guard was a set of regexes over the line. When a comparison test replayed the suite against it, it missed nineteen command shapes, including a push to main inside a quoted shell string and a delete inside inline code. The version here parses the line instead:

- The line is split the way the shell would run it, on `;`, `&&`, `||`, `|`, `&`, `(`, `)` and newlines outside quotes. Quotes are removed from each word; a heredoc body and a `#` comment are no command at all. So a commit message, a quoted string or a grep pattern that merely mentions `git push origin main` is not caught, and a command that runs it is.
- A command's program is its first word after any `VAR=value` prefixes, `env`, and the wrappers that run a command (`time`, `nohup`, `nice`, `timeout`, `stdbuf`, `exec`, `command`, `builtin`). `timeout 60 git push` is still `git push`.
- The string given to `sh -c`, `bash -c` and the like is itself a command and is judged as one, three shells deep.
- `git` and `cdk` are found as a word anywhere in a command, by name or by path, so `xargs git push`, `find -exec git push`, `/usr/bin/git push` and `npx aws-cdk@2 deploy` are all caught.
- Code handed to an interpreter on the line (`node -e`, `tsx --eval`, `perl -e`, `ruby -e`, `bun -e`, `deno eval`, `php -r`) is judged too: a delete, a `git push` or a `cdk deploy` inside it is blocked.
- A command after a real `|` or `|&` is marked as piped; `||` is not a pipe. Piping into `sh`, `bash`, `zsh`, `node` or `python` is blocked.
- It fails closed. A line the guard cannot read (an unclosed quote, an unfinished heredoc, shells nested more than three deep) or a rule that throws is blocked, never let through.

## What the Bash guard blocks

In the order the rules run, with the reason the agent sees:

| Rule | Reason shown |
| --- | --- |
| A blocked program anywhere in the line: `sudo`, `su`, `curl`, `wget`, `ssh`, `scp`, `nc`, `ncat`, `telnet`, `dd`, `mkfs`, `crontab`, `eval`, `base64`, `xxd`, `python`, `pip` | a blocked program appears somewhere in the line |
| `rm -r` in any spelling | recursive delete |
| A delete call inside inline code (`rmSync`, `unlink`, `rimraf`, `rmtree`, `rm_rf`, `fs.rm` and the like) | a delete inside inline code is still a delete |
| `find -delete`, `find -exec rm`, `xargs rm`, `Remove-Item -Recurse` | find -delete is a delete, and so on |
| A force push: `--force`, `--force-with-lease`, `--force-if-includes`, `-f` alone or among short flags, or `+branch` | force push |
| A push to `main` or `master`, by any way of naming it: `HEAD:main`, `:main`, `--delete origin main`, `refs/heads/main` | direct push to main; open a PR instead |
| `git reset --hard`, `git clean -f`, `git branch -D` | destructive git |
| A secret set on the command line (`AWS_SECRET_ACCESS_KEY=`, `DATABASE_URL=` and the like) | setting a secret on the command line |
| `$(...)` or backticks | command substitution |
| A pipe into `sh`, `bash`, `zsh`, `node` or `python` | piping into an interpreter |
| `cat`, `less`, `head`, `tail`, `grep` or `rg` given a path whose basename is `.env`, `.env.*`, or ends in `.pem`, `.key` or `.p12`. Judged on the paths read, never on a grep pattern | reading a secret file |
| `~/.aws`, `~/.ssh`, `~/.config`, `~/.netrc`, `~/.npmrc` | reading credential directories |
| `cdk deploy` or `cdk destroy`, however cdk is run | cdk deploy or destroy; sessions run cdk synth only |
| A `git push` or a `cdk deploy` inside inline code | a git push or a cdk deploy or destroy inside inline code is still one |
| `--profile inventaris-prod` | the prod profile is never used from a session |
| `docker exec`, `docker rm`, `docker system`, `docker run --privileged` or with `/` mounted | docker outside running a local Postgres |
| `chmod 777` or `chmod -R` | wide chmod |
| Any shell command naming `.claude`, `CLAUDE.md` or `.mcp.json` | the session's own rules (.claude/, CLAUDE.md, .mcp.json) are changed by Jake, not by a session |

Several rules carry names from the repository this came from: an AWS CDK app with a dev and a prod profile, a local Postgres in Docker, and the operator's name in the last reason. Keep them if they fit, change the names if they don't, and add your own to the `blocked` table at the bottom of `guard.js`, where each rule is a regex over the whitespace-collapsed line or a function over the parsed commands.

## What the subagent guard blocks

Claude Code's settings can cap concurrent subagents, forks, nesting depth, teams and workflows. They cannot cap the total number of subagents a session starts, and without a model pin a call that names no model can fall back to the main session's model. `subagent-guard.js` adds both:

1. A call from inside another subagent is blocked (no nesting).
2. A fork is blocked; forks always run on the main session's model.
3. Isolation (`remote`, `worktree`) is blocked.
4. A model other than `sonnet`, `opus` or `haiku` is blocked, `inherit` included. With no pin in settings, a call that names no model is blocked, so every call names one.
5. After five subagents in a session, the sixth is blocked. The count is one empty file per subagent in the system temp folder, created with the `wx` flag, which the operating system makes atomic, so eight calls at once still let exactly five through.

## What it does not catch

Be clear about this with whoever reads the guard's log.

- **A script file.** The guard and the permission prompt see the command, not the file. `node walkthrough.js` looks the same whether the script runs a unit test or deletes a directory. The rule that covers this lives in CLAUDE.md, not in code: doing the same thing by another route is the same act. The sessions this guard runs under are told to stop and say what was blocked rather than reach for a script, and they do.
- **Shell variables.** `x=push; git $x origin main` is not expanded by the guard. The same rule covers it.
- **Anything outside Bash and Agent calls.** Edits go through the permission lists in settings, which is where `.claude/`, `CLAUDE.md` and `.mcp.json` are denied.

The line to add to your CLAUDE.md, in whatever words fit your repository:

> If the guard blocks a command, say what was blocked and stop. Doing the same thing by another route (a script, another language, another tool) is the same as doing it directly, and is not allowed.

## Install

1. Copy `guard.js` and `subagent-guard.js` into `.claude/hooks/` in your repository.
2. Merge `settings.example.json` into `.claude/settings.json`: the two `PreToolUse` hooks with `onFailure: block`, the subagent caps in `env`, and the denies that keep a session out of its own rules.
3. Commit both. Every session inherits them when it starts.
4. Read the `blocked` table in `guard.js` and change the repository-specific rules to yours.

Node 22 or later. No dependencies at runtime.

## Tests

```
npm install
npm test
```

`test/guard.test.ts` runs the Bash guard against a table of 165 commands, 107 that must be blocked and 58 that must be allowed, plus a tool call that cannot be read, each run the way Claude Code runs the hook. The allowed side matters as much as the blocked side: a commit message that mentions `git push origin main`, a grep for `cdk deploy`, a heredoc with a quote in it, a push to a branch with `main` elsewhere on the line, all pass. `test/subagent-guard.test.ts` runs the subagent guard through its model, fork, isolation and nesting rules, the five-per-session count, and eight parallel calls.

## What comes next

v0.2 keeps every behavior above and adds the parts a second repository needs to adopt the guard without editing code: a judge library with three answers (allow, ask, deny), a config file under `.claude/`, a decision log the session cannot edit, rule packs for toolchains, a command line with `init`, `explain` and `check`, and a benchmark with a score per version. The design is in [docs/SPEC.md](docs/SPEC.md) and the order of work in [docs/ROADMAP.md](docs/ROADMAP.md).

## Provenance

These files are the hooks running in [Inventaris](https://inventaris.live), an inventory and order system built at Antaris Analytics in Claude Code sessions, with every line reviewed before merge. They are published as they are there, from that repository's `main` at the commit this repository's first pull request names, so the test table is the one that gates changes to the live hook.

MIT. Built by Jake Stanier, [Antaris Analytics LLC](https://antarisanalytics.ai).
