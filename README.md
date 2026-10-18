# Antaris-Guard

A fail-closed command guard for coding agents. Parses every shell command the way a shell does, judges it, and blocks what it can't read.

Two hooks for Claude Code, published as they run in production at Antaris Analytics:

- `guard.js` judges every Bash command before it runs.
- `subagent-guard.js` caps what subagents may do: which model, how many, no forks, no nesting.

Both read the tool call as JSON on stdin, exit 2 with a reason to block, exit 0 to allow. Anything they cannot read is blocked.

Since v0.2 round 1, the Bash guard is a thin shell around a judge library: `lib/parse.js` reads the line, `lib/rules/` holds one file per rule with a stable id, and `lib/judge.js` runs them in order and returns `{ decision, rule, reason, parse }`. Every block names its rule. Since round 2, the lists that name a repository (the blocked programs, the protected branches, the secret names and files, the credential directories, the protected paths and the operator's name) live in a config file, `.claude/guard.config.json`, which `lib/config.js` reads and validates; the hook refuses every command until that file exists and is valid.

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
guard: blocked (G17 unreadable: could not read the config: /repo/.claude/guard.config.json is missing; the operator writes it, following configs/README.md): git status
guard: blocked (G17 unreadable: the config is not valid: rules.G07 cannot be off): git status
guard: blocked (G17 unreadable: the guard could not load: Cannot find module '/repo/.claude/hooks/lib/judge.js' Require stack: - /repo/.claude/hooks/guard.js)
```

An allow is silence: exit 0, nothing printed, and Claude Code's own permission settings apply as usual.

The hook fails closed by itself, with exit 2, in every case it can reach: a tool call that is not JSON, a config file that is missing, unreadable, not JSON or not valid, a line it cannot read, a rule that throws, a `lib/` folder it cannot load, and anything else that throws anywhere in the process (an `uncaughtException` handler is the last net). It never exits 1. That matters because Claude Code reads exit 1 as a non-blocking error unless the hook entry has `onFailure: block`, which exists from Claude Code 2.1.295 on; a copy of `guard.js` without `lib/` beside it would otherwise let `git push origin main` run on an older Claude Code or under a settings file without that line. `onFailure: block` is the second layer, not the first.

## The rules

In the order they run, which is the order v0.1 ran them, with G18 last so it only ever adds a block. The reason text of every v0.1 rule is unchanged, word for word; the test table matches on it. Ids are stable and never reused. Every tier is `deny` in this round; the `ask` tier arrives in round 4. Six rules read a list from the config file; the key is named in the table and [configs/README.md](configs/README.md) says what each key does and what it defaults to.

| Id | Name | Tier | What it catches | Reason shown |
| --- | --- | --- | --- | --- |
| G01 | blocked-program | deny | A program from `blockedPrograms` as a command anywhere in the line. By default `sudo`, `su`, `curl`, `wget`, `ssh`, `scp`, `nc`, `ncat`, `telnet`, `dd`, `mkfs`, `crontab`, `eval`, `base64`, `xxd`; Inventaris adds `python`, `python3`, `pip`, `pip3` | a blocked program appears somewhere in the line |
| G02 | recursive-delete | deny | `rm -r` in any spelling, `git rm -r` included | recursive delete |
| G03 | delete-in-inline-code | deny | A delete call inside inline code (`rmSync`, `unlink`, `rimraf`, `rmtree`, `rm_rf`, `fs.rm` and the like) | a delete inside inline code is still a delete; if a delete is needed, say what was blocked and stop |
| G04 | find-or-xargs-delete | deny | `find -delete`, `find -exec rm` (and `-execdir`), `xargs rm` | find -delete is a delete; find -exec rm is a delete; xargs rm is a delete |
| G05 | remove-item-recurse | deny | PowerShell's `Remove-Item -Recurse` | recursive delete |
| G06 | force-push | deny | A force push: `--force`, `--force-with-lease`, `--force-if-includes`, `-f` alone or among short flags, or `+branch` | force push |
| G07 | push-to-protected | deny | A push to a branch in `protectedBranches` (`main` and `master` by default), by any way of naming it: `HEAD:main`, `:main`, `--delete origin main`, `refs/heads/main`. The reason is v0.1's whichever branch was named | direct push to main; open a PR instead |
| G08 | destructive-git | deny | `git reset --hard`, `git clean -f`, `git branch -D` | destructive git |
| G09 | secret-on-command-line | deny | A variable from `secretEnv` set on the command line. By default `AWS_SECRET_ACCESS_KEY=`, `AWS_SESSION_TOKEN=`, `DATABASE_URL=`, `GITHUB_TOKEN=`; Inventaris adds `COGNITO_CLIENT_SECRET=` | setting a secret on the command line |
| G10 | command-substitution | deny | `$(...)` or backticks | command substitution |
| G11 | pipe-into-interpreter | deny | A pipe into `sh`, `bash`, `zsh`, `node` or `python`, by name or path | piping into an interpreter |
| G12 | reads-secret-file | deny | `cat`, `less`, `head`, `tail`, `grep` or `rg` given a path whose name matches a glob in `secretPaths`: `.env`, `.env.*`, `*.pem`, `*.key`, `*.p12` by default. Judged on the paths read, never on a grep pattern | reading a secret file |
| G13 | credential-directory | deny | A prefix from `credentialPaths` anywhere in the line: `~/.aws`, `~/.ssh`, `~/.config`, `~/.netrc`, `~/.npmrc` by default | reading credential directories |
| aws-cdk-01 | cdk-deploy-or-destroy | deny | `cdk deploy` or `cdk destroy`, however cdk is run and whatever it is called | cdk deploy or destroy; sessions run cdk synth only |
| G14 | push-or-deploy-in-inline-code | deny | A `git push` or a `cdk deploy` inside inline code, however the code calls it | a git push or a cdk deploy or destroy inside inline code is still one; push with git on the command line, and sessions run cdk synth only |
| aws-cdk-02 | prod-profile | deny | `--profile inventaris-prod` | the prod profile is never used from a session |
| docker-01 | docker-outside-postgres | deny | `docker exec`, `docker rm`, `docker system`, `docker run --privileged` or with `/` mounted | docker outside running a local Postgres |
| G15 | wide-chmod | deny | `chmod 777` or `chmod -R` | wide chmod |
| G16 | protected-path | deny | Any shell command naming `.claude`, `CLAUDE.md` (and `CLAUDE.local.md`) or `.mcp.json`, always, plus any name in `protectedPaths`. The reason names the config's `operator`, or "the operator" | the session's own rules (.claude/, CLAUDE.md, .mcp.json) are changed by Jake, not by a session. Shell commands can't touch them; to look at one, open it with the Read tool |
| G17 | unreadable | deny | A tool call that is not JSON; a config file that is missing, unreadable or not JSON, or that fails validation; a line the parser cannot read (an unclosed quote, a heredoc with no end, shells nested more than three deep); a rule that threw; a `lib/` the hook could not load (a missing folder, a rule file that throws when it loads), or anything else that threw in the hook | could not read the tool call; could not read the config: `<why>`; the config is not valid: `<why>`; could not read the command: `<why>`; the guard could not judge the command: `<why>`; the guard could not load: `<why>` |
| G18 | browser-automation | deny | Browser automation, by every route below | browser automation is off in this repo: `<what was run, installed or named>`; say what was blocked and stop |

The three rules with pack ids (`aws-cdk-01`, `aws-cdk-02`, `docker-01`) name an AWS CDK app with a dev and a prod profile and a local Postgres in Docker, which is the repository this guard came from. They move into optional packs in round 6, so a repository without those tools never sees them; until then they run for everyone, and the config's `rules` map refuses to turn them off. Each rule is one file in `lib/rules/`, exporting `{ id, name, tier, reason, test }`, where `test` is given the parse and the config; `lib/rules/index.js` is the order.

### The config file

One file, `.claude/guard.config.json` under the project root, and nowhere else. It sits under `.claude/` so that the session's shell cannot name it (G16) and the editing tools are denied there: the config has the same standing as the hooks, and only the operator changes it. The project root is `CLAUDE_PROJECT_DIR` when Claude Code sets it, else the `cwd` field of the tool call, else the hook's working directory.

No file is a block: every command is refused with G17 until the operator writes one. Absence is refusal, because a file git can remove without anyone naming it (checking out an older commit) must not quietly loosen the guard. A file that is not JSON or fails validation blocks every command the same way, with the reason saying what is wrong. Validation is strict: `version` is required and must be `1`, unknown keys fail (so a typo cannot silently do nothing, and a key a later round reads does not look like a rule in force yet), every list is a list of non-empty strings, the lists behind the rules that are never off cannot be empty, and the `rules` map accepts only ids the guard has, set to `"deny"` or `"off"`; the never-off set (G02, G06, G07, G09, G10, G12, G16, G17) and the three pack rules refuse `"off"`.

[configs/inventaris.json](configs/inventaris.json) is the worked example: the values v0.1 had hard-coded, for the repository the test table was written for, and the config every table runs under. [configs/README.md](configs/README.md) says what each key does and what it defaults to. The built-in defaults are the generic set, with `python` and `pip` left out of `blockedPrograms` and `COGNITO_CLIENT_SECRET` out of `secretEnv`; they are what `init` will write for a new repository in round 7, never a stand-in for a missing file.

To see what the guard sees, from the repository root:

```
node bin/antaris-guard.js explain "git status | tail -1"
```

prints the config file it read, each command on the line with its program (and whether it is piped or came out of a shell string), the inline code it lifted out, and the decision with its rule and reason. Exit 0 is allow, exit 2 is deny, as the hook does it.

### G18, browser automation

Nothing a session does needs a browser, and a browser binary or an automation framework in a session's hands is the shape that started this rule. A command is blocked when it runs, installs or names one:

- **By program.** `playwright`, `puppeteer`, `cypress`, `nightwatch`, `testcafe`, `chromedriver`, `geckodriver`, `msedgedriver`, `safaridriver`, `selenium` and its managers, `webdriver-manager`, `chromium`, `chromium-browser`, `chrome`, `google-chrome` and its channels, `chrome-headless-shell`, by name or by path, after `env`, `timeout`, `nice`, `xargs`, `watch`, `xvfb-run`, `setsid` or `find -exec`, and anything under `/opt/pw-browsers/`.
- **By package.** The thing `npx`, `npm exec`, `pnpm exec`, `pnpm dlx`, `yarn`, `yarn dlx`, `bunx`, `bun x`, `deno run` and `corepack` run, including `-p`/`--package` values and versions, and the packages `npm install`, `pnpm add`, `yarn add`, `bun add`, `deno add`, `pip install`, `apt install`, `brew install` and the other managers add, when the name contains `playwright`, `puppeteer`, `selenium`, `webdriver`, `webdriverio`, `wdio`, `chromedriver`, `geckodriver`, `msedgedriver`, `chromium`, `chrome`, `cypress`, `nightwatch` or `testcafe` as a word. That is `@playwright/test`, `playwright-core`, `puppeteer-core`, `@puppeteer/browsers`, `selenium-webdriver`, `npm:puppeteer`, and also `eslint-plugin-playwright`. A script under `node_modules/` with one of those names in its path, run with `node`, `tsx` or `bun`, counts too, as does a module preloaded with `-r` or `--import`.
- **By inline code.** Code handed to `node -e`, `tsx --eval`, `bun -e`, `deno eval` and the rest, when it names one of those packages, a headless flag, the preinstalled browser path, or one of the two variables below.
- **By variable.** `PLAYWRIGHT_BROWSERS_PATH=` or `PUPPETEER_EXECUTABLE_PATH=` set on a command, through `export` or `env` too.
- **By flag.** `--headless`, `--headless=anything` or `-headless` on any command, whatever the program. That includes programs that are not browsers, LibreOffice's `--headless` among them. On purpose: the guard does not keep a list of which headless programs are fine, so it fails closed.
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

1. Copy `guard.js`, `subagent-guard.js` and the `lib/` folder into `.claude/hooks/` in your repository. `guard.js` requires `lib/judge.js` and `lib/config.js` relative to its own location. With `lib/` missing, or a rule file that throws when it loads, the hook blocks every command by itself (G17, exit 2); it does not depend on the settings to do that.
2. Write `.claude/guard.config.json`. Start from `configs/inventaris.json` and change the lists to fit your repository, following `configs/README.md`. Until the file exists and is valid, the hook blocks every command.
3. Merge `settings.example.json` into `.claude/settings.json`: the two `PreToolUse` hooks with `onFailure: block` (the second layer, for Claude Code 2.1.295 and later), the subagent caps in `env`, and the denies that keep a session out of its own rules.
4. Commit all of it. Every session inherits them when it starts.
5. Read the table above. The three pack-bound rules name the repository this came from (an AWS CDK app and a local Postgres in Docker); they run for everyone until round 6 moves them to packs.

Node 22 or later for the hooks, 22.18 or later to run the tests. No dependencies at runtime.

## Tests

```
npm test
```

Nothing to install: the tests run on Node's own test runner (`node --test`), which also reads the `.ts` table files without a build step on Node 22.18 and later. Every case runs the hook the way Claude Code runs it, a process with the tool call on stdin and `CLAUDE_PROJECT_DIR` pointing at a temporary project directory that holds `configs/inventaris.json` as its config file, since that is the repository the table was written for.

- `test/guard.test.ts` runs the v0.1 table in `test/tables/bash.ts`: 107 commands that must be blocked, 58 that must be allowed, and a tool call that cannot be read. The allowed side matters as much as the blocked side: a commit message that mentions `git push origin main`, a grep for `cdk deploy`, a heredoc with a quote in it, a push to a branch with `main` elsewhere on the line, all pass. The table never shrinks.
- `test/config.test.ts` covers the config: the defaults, the worked example, where the file is looked for, every kind of invalid file, what the hook does with no file (blocks everything, naming it), each rule that reads a list with a custom value that blocks and one that allows, and the comparison of the v0.1 table under the built-in defaults against the run under `configs/inventaris.json`, which must differ in exactly the five cases that depend on Inventaris's lists.
- `test/explain.test.ts` runs `bin/antaris-guard.js explain` on an allow, a deny, a shell string with inline code, a line that cannot be read, and a missing or invalid config.
- `test/subagent-guard.test.ts` runs the subagent guard through its model, fork, isolation and nesting rules, the five-per-session count, and eight parallel calls (18 cases, in `test/tables/subagent.ts`).
- `test/rules/g18.test.ts` runs G18's own table, and checks that every block there carries G18's id and not some other rule's.
- `test/compare.test.ts` replays every case in every table through the frozen v0.1 hooks under `bench/versions/v0.1/` and the current ones, and requires the same decision and the same stderr line once the rule id is stripped. The only differences it accepts are G18's blocked cases, and it requires each of them to be exactly a v0.1 allow turned into a G18 deny. It also pins the frozen files' SHA-256.
- `test/load.test.ts` copies `guard.js` into a temp folder without `lib/`, with a rule file that throws when it loads, with a rule file that does not parse, with a `judge.js` of the wrong shape, with a `judge()` that throws, and with a throw on the next tick outside every `try`, and requires a G17 block with exit 2 from each; a whole copy with `lib/` must judge as the original does.
- `test/syntax.test.ts` runs `node --check` on every JavaScript file in the repository.
- `test/judge.test.ts` covers `judge()` as a library: the shape of a decision, G17 for a line the parser cannot read, for a rule that throws and for a missing or invalid config, the rule order, and that the G17 words spelled out in `guard.js` (which has to work without `lib/`) match `lib/rules/g17-unreadable.js`.

## What comes next

v0.2 keeps every behavior above and adds the parts a second repository needs to adopt the guard without editing code: a config file under `.claude/` (round 2), a decision log the session cannot edit (round 3), the `ask` tier (round 4), reading the script a command runs (round 5), rule packs for toolchains (round 6), a command line with `init`, `explain` and `check` (round 7), and a benchmark with a score per version (round 8). Rounds 1 (the split) and 2 (the config) are done. The design is in [docs/SPEC.md](docs/SPEC.md) and the order of work in [docs/ROADMAP.md](docs/ROADMAP.md).

## Provenance

These files are the hooks running in [Inventaris](https://inventaris.live), an inventory and order system built at Antaris Analytics in Claude Code sessions, with every line reviewed before merge. They were published as they are there, from that repository's `main` at the commit this repository's first pull request names, so the test table is the one that gates changes to the live hook. That version, v0.1, is frozen byte for byte under `bench/versions/v0.1/`, and every round since is held against it.

MIT. Built by Jake Stanier, [Antaris Analytics LLC](https://antarisanalytics.ai).
