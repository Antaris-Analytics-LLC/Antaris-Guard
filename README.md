# Antaris-Guard

A fail-closed command guard for coding agents. Parses every shell command the way a shell does, judges it, and blocks what it can't read.

Two hooks for Claude Code, published as they run in production at Antaris Analytics:

- `guard.js` judges every Bash command before it runs.
- `subagent-guard.js` caps what subagents may do: which model, how many, no forks, no nesting.

Both read the tool call as JSON on stdin, exit 2 with a reason to block, exit 0 to allow. Anything they cannot read is blocked.

Since v0.2 round 1, the Bash guard is a thin shell around a judge library: `lib/parse.js` reads the line, `lib/rules/` holds one file per rule with a stable id, and `lib/judge.js` runs them in order and returns `{ decision, rule, reason, parse }`. Every block names its rule.

## Why this exists

A rule in a prompt is not a guard. A coding agent will follow "never push to main" in a CLAUDE.md right up until the push is hidden inside a quoted shell string, handed to `xargs`, run through `timeout 60`, or written into `node -e`. The permission lists in Claude Code's settings are prefix matches on the first command on the line; they cannot see a second command after `&&`, a subshell, or a pipe into `sh`.

The first version of this guard was a set of regexes over the line. When a comparison test replayed the suite against it, it missed nineteen command shapes, including a push to main inside a quoted shell string and a delete inside inline code. The version here parses the line instead:

- The line is split the way the shell would run it, on `;`, `&&`, `||`, `|`, `&`, `(`, `)` and newlines outside quotes. Quotes are removed from each word; a heredoc body and a `#` comment are no command at all. So a commit message, a quoted string or a grep pattern that merely mentions `git push origin main` is not caught, and a command that runs it is.
- A command's program is its first word after any `VAR=value` prefixes, `env`, and the wrappers that run a command (`time`, `nohup`, `nice`, `timeout`, `stdbuf`, `exec`, `command`, `builtin`). `timeout 60 git push` is still `git push`.
- The string given to `sh -c`, `bash -c` and the like is itself a command and is judged as one, three shells deep.
- `git` and `cdk` are found as a word anywhere in a command, by name or by path, so `xargs git push`, `find -exec git push`, `/usr/bin/git push` and `npx aws-cdk@2 deploy` are all caught.
- Code handed to an interpreter on the line (`node -e`, `tsx --eval`, `perl -e`, `ruby -e`, `bun -e`, `deno eval`, `php -r`) is judged too: a delete, a `git push`, a `cdk deploy` or a browser inside it is blocked.
- A command after a real `|` or `|&` is marked as piped; `||` is not a pipe. Piping into `sh`, `bash`, `zsh`, `node` or `python` is blocked.
- It fails closed. A line the guard cannot read (an unclosed quote, an unfinished heredoc, shells nested more than three deep) or a rule that throws is blocked, never let through.

## What the agent sees

A block is one line on stderr, with the rule's id and name at the front of the reason and the command at the end:

```
guard: blocked (G07 push-to-protected: direct push to main; open a PR instead): git push origin main
guard: blocked (G18 browser-automation: browser automation is off in this repo: playwright run through npx; say what was blocked and stop): npx playwright test
guard: blocked (G17 unreadable: could not read the command: an unclosed quote): echo 'unclosed
```

An allow is silence: exit 0, nothing printed, and Claude Code's own permission settings apply as usual.

## The rules

In the order they run, which is the order v0.1 ran them, with G18 last so it only ever adds a block. The reason text of every v0.1 rule is unchanged, word for word; the test table matches on it. Ids are stable and never reused. Every tier is `deny` in this round; the `ask` tier arrives in round 4.

| Id | Name | Tier | What it catches | Reason shown |
| --- | --- | --- | --- | --- |
| G01 | blocked-program | deny | A blocked program as a command anywhere in the line: `sudo`, `su`, `curl`, `wget`, `ssh`, `scp`, `nc`, `ncat`, `telnet`, `dd`, `mkfs`, `crontab`, `eval`, `base64`, `xxd`, `python`, `pip` | a blocked program appears somewhere in the line |
| G02 | recursive-delete | deny | `rm -r` in any spelling, `git rm -r` included | recursive delete |
| G03 | delete-in-inline-code | deny | A delete call inside inline code (`rmSync`, `unlink`, `rimraf`, `rmtree`, `rm_rf`, `fs.rm` and the like) | a delete inside inline code is still a delete; if a delete is needed, say what was blocked and stop |
| G04 | find-or-xargs-delete | deny | `find -delete`, `find -exec rm` (and `-execdir`), `xargs rm` | find -delete is a delete; find -exec rm is a delete; xargs rm is a delete |
| G05 | remove-item-recurse | deny | PowerShell's `Remove-Item -Recurse` | recursive delete |
| G06 | force-push | deny | A force push: `--force`, `--force-with-lease`, `--force-if-includes`, `-f` alone or among short flags, or `+branch` | force push |
| G07 | push-to-protected | deny | A push to `main` or `master`, by any way of naming it: `HEAD:main`, `:main`, `--delete origin main`, `refs/heads/main` | direct push to main; open a PR instead |
| G08 | destructive-git | deny | `git reset --hard`, `git clean -f`, `git branch -D` | destructive git |
| G09 | secret-on-command-line | deny | A secret set on the command line: `AWS_SECRET_ACCESS_KEY=`, `AWS_SESSION_TOKEN=`, `DATABASE_URL=`, `COGNITO_CLIENT_SECRET=`, `GITHUB_TOKEN=` | setting a secret on the command line |
| G10 | command-substitution | deny | `$(...)` or backticks | command substitution |
| G11 | pipe-into-interpreter | deny | A pipe into `sh`, `bash`, `zsh`, `node` or `python`, by name or path | piping into an interpreter |
| G12 | reads-secret-file | deny | `cat`, `less`, `head`, `tail`, `grep` or `rg` given a path whose basename is `.env`, `.env.*`, or ends in `.pem`, `.key` or `.p12`. Judged on the paths read, never on a grep pattern | reading a secret file |
| G13 | credential-directory | deny | `~/.aws`, `~/.ssh`, `~/.config`, `~/.netrc`, `~/.npmrc` | reading credential directories |
| aws-cdk-01 | cdk-deploy-or-destroy | deny | `cdk deploy` or `cdk destroy`, however cdk is run and whatever it is called | cdk deploy or destroy; sessions run cdk synth only |
| G14 | push-or-deploy-in-inline-code | deny | A `git push` or a `cdk deploy` inside inline code, however the code calls it | a git push or a cdk deploy or destroy inside inline code is still one; push with git on the command line, and sessions run cdk synth only |
| aws-cdk-02 | prod-profile | deny | `--profile inventaris-prod` | the prod profile is never used from a session |
| docker-01 | docker-outside-postgres | deny | `docker exec`, `docker rm`, `docker system`, `docker run --privileged` or with `/` mounted | docker outside running a local Postgres |
| G15 | wide-chmod | deny | `chmod 777` or `chmod -R` | wide chmod |
| G16 | protected-path | deny | Any shell command naming `.claude`, `CLAUDE.md` or `.mcp.json` | the session's own rules (.claude/, CLAUDE.md, .mcp.json) are changed by Jake, not by a session. Shell commands can't touch them; to look at one, open it with the Read tool |
| G17 | unreadable | deny | A tool call that is not JSON; a line the parser cannot read (an unclosed quote, a heredoc with no end, shells nested more than three deep); a rule that threw | could not read the tool call; could not read the command: `<why>`; the guard could not judge the command: `<why>` |
| G18 | browser-automation | deny | Browser automation, by every route below | browser automation is off in this repo: `<what was run, installed or named>`; say what was blocked and stop |

The three rules with pack ids (`aws-cdk-01`, `aws-cdk-02`, `docker-01`) name an AWS CDK app with a dev and a prod profile and a local Postgres in Docker, which is the repository this guard came from. They move into optional packs in round 6, so a repository without those tools never sees them; until then they run for everyone. The lists inside G01, G07, G09, G12, G13 and G16 move to a config file in round 2. Each rule is one file in `lib/rules/`, exporting `{ id, name, tier, reason, test }`; `lib/rules/index.js` is the order.

### G18, browser automation

Nothing a session does needs a browser, and a browser binary or an automation framework in a session's hands is the shape that started this rule. A command is blocked when it runs, installs or names one:

- **By program.** `playwright`, `puppeteer`, `cypress`, `nightwatch`, `testcafe`, `chromedriver`, `geckodriver`, `msedgedriver`, `safaridriver`, `selenium` and its managers, `webdriver-manager`, `chromium`, `chromium-browser`, `chrome`, `google-chrome` and its channels, `chrome-headless-shell`, by name or by path, after `env`, `timeout`, `nice`, `xargs`, `watch`, `xvfb-run`, `setsid` or `find -exec`, and anything under `/opt/pw-browsers/`.
- **By package.** The thing `npx`, `npm exec`, `pnpm exec`, `pnpm dlx`, `yarn`, `yarn dlx`, `bunx`, `bun x`, `deno run` and `corepack` run, including `-p`/`--package` values and versions, and the packages `npm install`, `pnpm add`, `yarn add`, `bun add`, `deno add`, `pip install`, `apt install`, `brew install` and the other managers add, when the name contains `playwright`, `puppeteer`, `selenium`, `webdriver`, `webdriverio`, `wdio`, `chromedriver`, `geckodriver`, `msedgedriver`, `chromium`, `chrome`, `cypress`, `nightwatch` or `testcafe` as a word. That is `@playwright/test`, `playwright-core`, `puppeteer-core`, `@puppeteer/browsers`, `selenium-webdriver`, `npm:puppeteer`, and also `eslint-plugin-playwright`. A script under `node_modules/` with one of those names in its path, run with `node`, `tsx` or `bun`, counts too, as does a module preloaded with `-r` or `--import`.
- **By inline code.** Code handed to `node -e`, `tsx --eval`, `bun -e`, `deno eval` and the rest, when it names one of those packages, a headless flag, the preinstalled browser path, or one of the two variables below.
- **By variable.** `PLAYWRIGHT_BROWSERS_PATH=` or `PUPPETEER_EXECUTABLE_PATH=` set on a command, through `export` or `env` too.
- **By flag.** `--headless`, `--headless=anything` or `-headless` on any command, whatever the program.
- **By path.** `/opt/pw-browsers` at the start of any word.

Allowed, because none of those is any of these: searching for the word (`grep -rn playwright src`, `rg "chromium|puppeteer" packages`, a grep for `--headless` or `/opt/pw-browsers` as a pattern), a commit message or a log search that contains it, a file named after it (`cat playwright.config.ts`), reading a variable (`echo $PLAYWRIGHT_BROWSERS_PATH`), and uninstalling (`npm uninstall playwright`). The table in `test/tables/g18.ts` has 82 blocked and 28 allowed cases, one or more per route.

## What the subagent guard blocks

Claude Code's settings can cap concurrent subagents, forks, nesting depth, teams and workflows. They cannot cap the total number of subagents a session starts, and without a model pin a call that names no model can fall back to the main session's model. `subagent-guard.js` adds both:

1. A call from inside another subagent is blocked (no nesting).
2. A fork is blocked; forks always run on the main session's model.
3. Isolation (`remote`, `worktree`) is blocked.
4. A model other than `sonnet`, `opus` or `haiku` is blocked, `inherit` included. With no pin in settings, a call that names no model is blocked, so every call names one.
5. After five subagents in a session, the sixth is blocked. The count is one empty file per subagent in the system temp folder, created with the `wx` flag, which the operating system makes atomic, so eight calls at once still let exactly five through.

## What it does not catch

Be clear about this with whoever reads the guard's log.

- **A script file.** The guard and the permission prompt see the command, not the file. `node walkthrough.js` looks the same whether the script runs a unit test or deletes a directory, and `npm run e2e` looks the same whether the script runs vitest or Playwright. The rule that covers this lives in CLAUDE.md, not in code: doing the same thing by another route is the same act. Round 5 reads the script a command runs and judges its text; until then, the sessions this guard runs under are told to stop and say what was blocked rather than reach for a script, and they do.
- **Shell variables.** `x=push; git $x origin main` is not expanded by the guard. The same rule covers it, and round 5 closes it.
- **Anything outside Bash and Agent calls.** Edits go through the permission lists in settings, which is where `.claude/`, `CLAUDE.md`, `.mcp.json` and `/opt/pw-browsers/` are denied to the Read and Edit tools.

The line to add to your CLAUDE.md, in whatever words fit your repository:

> If the guard blocks a command, say what was blocked and stop. Doing the same thing by another route (a script, another language, another tool) is the same as doing it directly, and is not allowed.

## Install

1. Copy `guard.js`, `subagent-guard.js` and the `lib/` folder into `.claude/hooks/` in your repository. `guard.js` requires `lib/judge.js` relative to its own location; with `lib/` missing it fails to load, and `onFailure: block` then blocks every command, which is the failure you want.
2. Merge `settings.example.json` into `.claude/settings.json`: the two `PreToolUse` hooks with `onFailure: block`, the subagent caps in `env`, and the denies that keep a session out of its own rules.
3. Commit all of it. Every session inherits them when it starts.
4. Read the table above. The three pack-bound rules and the lists inside G01, G07, G09, G12, G13 and G16 name the repository this came from; change them in `lib/rules/` if they don't fit, until round 2 moves them to config.

Node 22 or later for the hooks, 22.18 or later to run the tests. No dependencies at runtime.

## Tests

```
npm test
```

Nothing to install: the tests run on Node's own test runner (`node --test`), which also reads the `.ts` table files without a build step on Node 22.18 and later. Every case runs the hook the way Claude Code runs it, a process with the tool call on stdin.

- `test/guard.test.ts` runs the v0.1 table in `test/tables/bash.ts`: 107 commands that must be blocked, 58 that must be allowed, and a tool call that cannot be read. The allowed side matters as much as the blocked side: a commit message that mentions `git push origin main`, a grep for `cdk deploy`, a heredoc with a quote in it, a push to a branch with `main` elsewhere on the line, all pass. The table never shrinks.
- `test/subagent-guard.test.ts` runs the subagent guard through its model, fork, isolation and nesting rules, the five-per-session count, and eight parallel calls (18 cases, in `test/tables/subagent.ts`).
- `test/rules/g18.test.ts` runs G18's own table, and checks that every block there carries G18's id and not some other rule's.
- `test/compare.test.ts` replays every case in every table through the frozen v0.1 hooks under `bench/versions/v0.1/` and the current ones, and requires the same decision and the same stderr line once the rule id is stripped. The only differences it accepts are G18's blocked cases, and it requires each of them to be exactly a v0.1 allow turned into a G18 deny. It also pins the frozen files' SHA-256.
- `test/syntax.test.ts` runs `node --check` on every JavaScript file in the repository.
- `test/judge.test.ts` covers `judge()` as a library: the shape of a decision, G17 for a line the parser cannot read and for a rule that throws, and the rule order.

## What comes next

v0.2 keeps every behavior above and adds the parts a second repository needs to adopt the guard without editing code: a config file under `.claude/` (round 2), a decision log the session cannot edit (round 3), the `ask` tier (round 4), reading the script a command runs (round 5), rule packs for toolchains (round 6), a command line with `init`, `explain` and `check` (round 7), and a benchmark with a score per version (round 8). Round 1, this split, is done. The design is in [docs/SPEC.md](docs/SPEC.md) and the order of work in [docs/ROADMAP.md](docs/ROADMAP.md).

## Provenance

These files are the hooks running in [Inventaris](https://inventaris.live), an inventory and order system built at Antaris Analytics in Claude Code sessions, with every line reviewed before merge. They were published as they are there, from that repository's `main` at the commit this repository's first pull request names, so the test table is the one that gates changes to the live hook. That version, v0.1, is frozen byte for byte under `bench/versions/v0.1/`, and every round since is held against it.

MIT. Built by Jake Stanier, [Antaris Analytics LLC](https://antarisanalytics.ai).
