# Antaris-Guard

A fail-closed command guard for coding agents. Parses every shell command the way a shell does, judges it, and blocks what it can't read.

Two hooks for Claude Code, published as they run in production at Antaris Analytics:

- `guard.js` judges every Bash command before it runs.
- `subagent-guard.js` caps what subagents may do: which model, how many, no forks, no nesting.

Both read the tool call as JSON on stdin, exit 2 with a reason to block, exit 0 to allow. Anything they cannot read is blocked.

Since v0.2 round 1, the Bash guard is a thin shell around a judge library: `lib/parse.js` reads the line, `lib/rules/` holds one file per rule with a stable id, and `lib/judge.js` runs them in order and returns `{ decision, rule, reason, parse }`. Every block names its rule. Since round 2, the lists that name a repository (the blocked programs, the protected branches, the secret names and files, the credential directories, the protected paths and the operator's name) live in a config file, `.claude/guard.config.json`, which `lib/config.js` reads and validates; the hook refuses every command until that file exists and is valid. Since round 3, every decision, allows included, is appended to a hash-chained log under `.claude/guard/` by `lib/log.js`, with the command stored as a hash and never as text; a decision the log cannot keep is a block.

## Why this exists

A rule in a prompt is not a guard. A coding agent will follow "never push to main" in a CLAUDE.md right up until the push is hidden inside a quoted shell string, handed to `xargs`, run through `timeout 60`, or written into `node -e`. The permission lists in Claude Code's settings are prefix matches on the first command on the line; they cannot see a second command after `&&`, a subshell, or a pipe into `sh`.

The first version of this guard was a set of regexes over the line. When a comparison test replayed the suite against it, it missed nineteen command shapes, including a push to main inside a quoted shell string and a delete inside inline code. The version here parses the line instead:

- The line is split the way the shell would run it, on `;`, `&&`, `||`, `|`, `&`, `(`, `)` and newlines outside quotes. Quotes are removed from each word; a heredoc body and a `#` comment are no command at all. So a commit message, a quoted string or a grep pattern that merely mentions `git push origin main` is not caught, and a command that runs it is.
- A command's program is its first word after any `VAR=value` prefixes, `env`, and the wrappers that run a command (`time`, `nohup`, `nice`, `timeout`, `stdbuf`, `exec`, `command`, `builtin`, `setsid`, `ionice`, `chrt`, `taskset`, `flock`, `unbuffer`, `doas`, `busybox`). `timeout 60 git push` is still `git push`, and `flock -c` is read as the `sh -c` it runs. For the two rules that judge `find` and inline code, the runners that hand their first word to the shell (`npx`, `npm exec`, `xargs`) are seen through as well, so `xargs find . -delete` is a `find`.
- The string given to `sh -c`, `bash -c` and the like is itself a command and is judged as one, three shells deep, wherever the shell sits: on its own, behind a wrapper (`timeout 5 bash -c`), or behind `xargs`, `npx` or `npm exec`. The strings `npx -c`, `npx --call`, `npm exec -c` and `flock -c` hand to a shell are read the same way.
- `git` and `cdk` are found as a word anywhere in a command, by name or by path, so `xargs git push`, `find -exec git push`, `/usr/bin/git push` and `npx aws-cdk@2 deploy` are all caught.
- Code handed to an interpreter on the line (`node -e`, `tsx --eval`, `perl -e`, `ruby -e`, `bun -e`, `deno eval`, `php -r`) is judged too: a delete, a `git push`, a `cdk deploy` or a browser inside it is blocked.
- A command after a real `|` or `|&` is marked as piped; `||` is not a pipe. Piping into `sh`, `bash`, `zsh`, `node` or `python` is blocked.
- It fails closed. A line the guard cannot read (an unclosed quote, an unclosed `$(` or backtick, an unfinished heredoc, shells nested more than three deep) or a rule that throws is blocked, never let through. `$(` and backticks are counted the way the shell expands them: outside single quotes, in the string a shell runs, and in the body of an unquoted heredoc; not in a comment, not escaped, not in a quoted heredoc.
- It answers in time proportional to the line, and a command longer than 262,144 characters is refused before the parser sees it, with a reason that says to put long content in a file with the Write tool. Every shape that once made a rule backtrack (a run of separators, one word of great length, many `git` or `node` or `cdk` words) is timed at the cap in CI.

## What the agent sees

A block is one line on stderr, with the rule's id and name at the front of the reason and the command at the end:

```
guard: blocked (G07 push-to-protected: direct push to main; open a PR instead): git push origin main
guard: blocked (G18 browser-automation: browser automation is off in this repo: playwright run through npx; say what was blocked and stop): npx playwright test
guard: blocked (G17 unreadable: could not read the command: an unclosed quote): echo 'unclosed
guard: blocked (G17 unreadable: could not read the config: /repo/.claude/guard.config.json is missing; the operator writes it, following configs/README.md): git status
guard: blocked (G17 unreadable: the config is not valid: rules.G07 cannot be off): git status
guard: blocked (G17 unreadable: could not write the log: /repo/.claude/guard/log.jsonl: EACCES: permission denied, open '/repo/.claude/guard/log.jsonl'): git status
guard: blocked (G17 unreadable: the guard could not load: Cannot find module '/repo/.claude/hooks/lib/judge.js' Require stack: - /repo/.claude/hooks/guard.js)
```

An allow is silence: exit 0, nothing printed, and Claude Code's own permission settings apply as usual. Every decision, the silent allows included, is one line in the decision log first.

The hook fails closed by itself, with exit 2, in every case it can reach: a tool call that is not JSON, a config file that is missing, unreadable, not JSON or not valid, a log it cannot write, a line it cannot read, a rule that throws, a `lib/` folder it cannot load, and anything else that throws anywhere in the process (an `uncaughtException` handler is the last net). It never exits 1. That matters because Claude Code reads exit 1 as a non-blocking error unless the hook entry has `onFailure: block`, which exists from Claude Code 2.1.295 on; a copy of `guard.js` without `lib/` beside it would otherwise let `git push origin main` run on an older Claude Code or under a settings file without that line. `onFailure: block` is the second layer, not the first.

## The rules

In the order they run, which is the order v0.1 ran them, with G18 last so it only ever adds a block. The reason text of every v0.1 rule is unchanged, word for word; the test table matches on it. Ids are stable and never reused. Every tier is `deny` in this round; the `ask` tier arrives in round 4. Six rules read a list from the config file; the key is named in the table and [configs/README.md](configs/README.md) says what each key does and what it defaults to.

| Id | Name | Tier | What it catches | Reason shown |
| --- | --- | --- | --- | --- |
| G01 | blocked-program | deny | A program from `blockedPrograms` as a command anywhere in the line. By default `sudo`, `su`, `curl`, `wget`, `ssh`, `scp`, `nc`, `ncat`, `telnet`, `dd`, `mkfs`, `crontab`, `eval`, `base64`, `xxd`; Inventaris adds `python`, `python3`, `pip`, `pip3` | a blocked program appears somewhere in the line |
| G02 | recursive-delete | deny | `rm -r` in any spelling, `git rm -r` included | recursive delete |
| G03 | delete-in-inline-code | deny | A delete call inside inline code (`rmSync`, `unlink`, `rimraf`, `rmtree`, `rm_rf`, `fs.rm` and the like); also an interpreter run as a command with a code flag, past any wrapper or runner, with a delete call anywhere on the line | a delete inside inline code is still a delete; if a delete is needed, say what was blocked and stop |
| G04 | find-or-xargs-delete | deny | `find -delete`, `find -exec rm` (and `-execdir`), `xargs rm`, judged per command: `find` or `xargs` is the command's program past any wrapper, runner or path, and the flag is one of its words with the quotes removed | find -delete is a delete; find -exec rm is a delete; xargs rm is a delete |
| G05 | remove-item-recurse | deny | PowerShell's `Remove-Item -Recurse`, each word counted at the start of a word only, so a file named after them (`g05-remove-item-recurse.js`) is not one; the cmdlet qualified with its module (`Microsoft.PowerShell.Management\Remove-Item`) is | recursive delete |
| G06 | force-push | deny | A force push: `--force`, `--force-with-lease`, `--force-if-includes`, `-f` alone or among short flags, or `+branch` | force push |
| G07 | push-to-protected | deny | A push to a branch in `protectedBranches` (`main` and `master` by default), by any way of naming it: `HEAD:main`, `:main`, `--delete origin main`, `refs/heads/main`. The reason is v0.1's whichever branch was named | direct push to main; open a PR instead |
| G08 | destructive-git | deny | `git reset --hard`, `git clean -f`, `git branch -D` | destructive git |
| G09 | secret-on-command-line | deny | A variable from `secretEnv` set on the command line. By default `AWS_SECRET_ACCESS_KEY=`, `AWS_SESSION_TOKEN=`, `DATABASE_URL=`, `GITHUB_TOKEN=`; Inventaris adds `COGNITO_CLIENT_SECRET=` | setting a secret on the command line |
| G10 | command-substitution | deny | `$(...)` or a pair of backticks. One left open is G17 instead: the shell could not run it | command substitution |
| G11 | pipe-into-interpreter | deny | A pipe into `sh`, `bash`, `zsh`, `node` or `python`, by name or path | piping into an interpreter |
| G12 | reads-secret-file | deny | `cat`, `less`, `head`, `tail`, `grep` or `rg` given a path whose name matches a glob in `secretPaths`: `.env`, `.env.*`, `*.pem`, `*.key`, `*.p12` by default. Judged on the paths read, never on a grep pattern | reading a secret file |
| G13 | credential-directory | deny | A prefix from `credentialPaths` anywhere in the line: `~/.aws`, `~/.ssh`, `~/.config`, `~/.netrc`, `~/.npmrc` by default | reading credential directories |
| aws-cdk-01 | cdk-deploy-or-destroy | deny | `cdk deploy` or `cdk destroy`, however cdk is run and whatever it is called | cdk deploy or destroy; sessions run cdk synth only |
| G14 | push-or-deploy-in-inline-code | deny | A `git push` or a `cdk deploy` inside inline code, however the code calls it | a git push or a cdk deploy or destroy inside inline code is still one; push with git on the command line, and sessions run cdk synth only |
| aws-cdk-02 | prod-profile | deny | `--profile inventaris-prod` | the prod profile is never used from a session |
| docker-01 | docker-outside-postgres | deny | `docker exec`, `docker rm`, `docker system`, `docker run --privileged` or with `/` mounted | docker outside running a local Postgres |
| G15 | wide-chmod | deny | `chmod 777` or `chmod -R` | wide chmod |
| G16 | protected-path | deny | Any command naming `.claude`, `CLAUDE.md` (and `CLAUDE.local.md`) or `.mcp.json`, always, plus any name in `protectedPaths`. Judged per command since round 3: on every word with the quotes and backslashes removed (so `.cl"aude"` is `.claude`), on the delimiter and body of every heredoc a command is given, and on the whole string a shell is given. Not judged, since none of it is a command or a path: a `#` comment; the message of `git commit` and `git tag` (`-m`, `--message`, a heredoc into `-F -`); the title and body of `gh pr` and `gh issue` `create`, `edit` and `comment` (`--title`, `--body`, a heredoc into `--body-file -`). A pathspec, a `-F` file, a `--body-file` path and a heredoc into anything else count. One read is let through: a reading program (`cat`, `head`, `tail`, `wc`, `file`, `stat`, `ls`, `grep`, `diff`, `cmp`, `sha256sum`, `md5sum`, `od`, `hexdump`, `strings`), or `cp` with the path as a source, reading a file the user uploaded under the home uploads folder `~/.claude/uploads` (written with `~`, `$HOME`, `${HOME}` or the home folder spelled out). A `..` in the path, a redirection anywhere in the command, or the folder as `cp`'s destination turns it off. So does `cp` that makes links (`-l`, `-s`, a short cluster holding either such as `-rs`, `--link`, `--symbolic-link` or an abbreviation of them), since the link it leaves in the project lets a later plain write change the upload. So does `file -C` or `--compile`, which writes a compiled magic file. `rg`, `less` and `more` are not reading programs here: `rg --pre`, `--pre-glob` and `--hostname-bin` run a program on each file and `RIPGREP_CONFIG_PATH` can add one off the line, and the pagers write log files (`-o`, `-O`, `--LOG-FILE`) and run `LESSOPEN`. And it applies only when every command on the line is a reading program or `cp`, with no assignment before its program, on its own or through `env` (`LD_PRELOAD=`, `LESSOPEN=`, `RIPGREP_CONFIG_PATH=`, even `LC_ALL=C`), since an assignment changes what the program runs; `env` with no assignment counts as well, since `-S` can carry one inside a word. So an `export`, `declare`, `set` or `source` anywhere on the line, or any other command beside the read (`cd`, `echo`, a pipe into `sort`), turns it off for the whole line. Wrappers such as `timeout` and `nice` keep it. What is left is anything set outside the line the guard judges, by an earlier tool call or a sourced file, the same class as a script file; see what it does not catch, below. Every other `.claude` path stays blocked, reads included. The reason names the config's `operator`, or "the operator" | the session's own rules (.claude/, CLAUDE.md, .mcp.json) are changed by Jake, not by a session. Shell commands can't touch them; to look at one, open it with the Read tool |
| G17 | unreadable | deny | A tool call that is not JSON; a config file that is missing, unreadable or not JSON, or that fails validation; a decision log that cannot be written; a command longer than 262,144 characters; a line the parser cannot read (an unclosed quote, an unclosed `$(` or backtick, a heredoc with no end, shells nested more than three deep); a rule that threw; a `lib/` the hook could not load (a missing folder, a rule file that throws when it loads), or anything else that threw in the hook | could not read the tool call; could not read the config: `<why>`; the config is not valid: `<why>`; could not write the log: `<why>`; the command is too long to judge: `<length>` characters; the guard reads at most 262144. Put long content in a file with the Write tool; could not read the command: `<why>`; the guard could not judge the command: `<why>`; the guard could not load: `<why>` |
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

prints the config file it read, where the log goes, each command on the line with its program (and whether it is piped or came out of a shell string), the inline code it lifted out, and the decision with its rule and reason. Exit 0 is allow, exit 2 is deny, as the hook does it. `explain` never writes the log.

### The decision log

Every decision either hook makes, allows included, is one line appended to `.claude/guard/log.jsonl` before the hook answers, so the file is the session's whole history of commands and subagent calls, in order:

```
{"v":1,"t":"2026-10-18T06:53:24.108Z","session":"b1c2…","tool":"Bash","decision":"deny","rule":"G07","reason":"direct push to main; open a PR instead","cmd_sha256":"16f8…","prev":"46c0…","hash":"2749…"}
```

`v` is the shape of the line, `1` for now. The command itself is never written, only its SHA-256, so the log holds no secret a command carried; an allow has a null `rule` and an empty `reason`; an Agent line carries `model`, the model asked for, after `tool`. `hash` is the SHA-256 of the line's JSON without `hash`, keys in that order, and `prev` is the hash of the line before, `genesis` on the first. A tool call the hook could not read is logged too, with session `unknown` and the hash of what came in.

Parallel tool calls run hook processes at the same time, and two lines must never share a `prev`. So the tail is read and the line appended under a lock, a file beside the log created with the `wx` flag and holding the writer's pid and a random token. A writer that finds it held waits in 5 ms steps for up to 15 seconds; a lock whose holder is dead is cleared at once, and one older than 60 seconds is cleared as well. A lock is removed only while it is still the one that was read: a writer clearing a stale lock looks at it again just before removing it and leaves it if it changed, and a writer releasing its lock leaves it if it no longer holds the writer's own token. Appending takes about a millisecond, so ordinary contention never comes near the limit; a lock held that long means the log is stuck, and the hook blocks with a reason that says so rather than letting the command through unrecorded. A log the hook cannot write for any reason is a block: an allow becomes `G17 could not write the log`, and a deny keeps its own line and adds a second one saying the log failed.

```
node bin/antaris-guard.js verify-log              # walks the chain; exit 0 whole, exit 1 with every bad line named
node bin/antaris-guard.js verify-log --tip <hash> # the same, and names the line that carries that hash, or fails when none does
node bin/antaris-guard.js log                     # lines, size, the tip, and counts by decision, rule, day, session and tool
```

What the chain proves, and what it does not. `verify-log` proves that every line's hash matches its content and every `prev` is the hash before it, back to `genesis`: a line changed, added or removed by anyone who did not also recompute every line after it is found, and so is a line cut short by a crash. It does not prove the file is the one the hooks wrote. Whoever can write the file can rewrite the whole chain, and the hook has no secret a session could not also read, so no scheme inside the repository can do better. The protection is that a session cannot reach the file: `.claude/` is unreachable to the session's shell (G16) and denied to the editing tools, and the config refuses a `log.path` anywhere but under `.claude/` or a folder in `protectedPaths`, since a log the session's shell can name is a log it can edit. To make a full rewrite visible as well, keep the tip somewhere no session can write: `log` prints it, note it (in the pull request thread, say), and a later `verify-log --tip <hash>` names the line that carries it, which proves every line up to that one is as it was when you noted it, while the lines after it are the log growing since. It fails when no line carries the tip any more, or when the chain breaks at or before that line.

One limit, so that a fork is not read as tampering. Looking at a lock again before removing it narrows a race; it cannot close it. If a hook dies holding the lock and two writers clear it at the same moment, a few microseconds remain between the second look and the removal, in which one writer can remove the other's fresh lock. And a hook that stalls inside its write for more than 60 seconds has its lock cleared as stale while it still runs. Either way two hooks can append at once and the chain forks: two lines carry the same `prev`, each with a hash that matches its own content, and `verify-log` reports the second as `prev is not the hash of line N` and says that the two lines share one prev, which looks like a fork. It takes a crash or a stall and a race in the same moment. A changed line shows differently, as a hash that does not match it, and so does a removed line, as a `prev` that no line in the file carries. A line inserted by someone who can write the file does look like a fork, which is why the protection is that no session can reach the file. `verify-log` keeps walking after a break, from the hash the broken line carries, and lists every break, so a fork does not hide a change after it; every line still holds its decision, and `log` still counts them all.

`.claude/guard/` is in this repository's `.gitignore`, so the log the hooks write is never staged. Add the same line to yours (round 7's `init` will). `log.enabled: false` in the config writes nothing.

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

Every decision, allowed or blocked, is logged with the model asked for, in the same chain as the session's commands; the hook reads the config for the log's path and fails closed, like the Bash guard, when `lib/` or the config cannot be read or the log cannot be written. Its limits stay constants until the `subagents` config key lands.

## What it does not catch

Be clear about this with whoever reads the guard's log.

- **A script file.** The guard and the permission prompt see the command, not the file. `node walkthrough.js` looks the same whether the script runs a unit test or deletes a directory, and `npm run e2e` looks the same whether the script runs vitest or Playwright. The rule that covers this lives in CLAUDE.md, not in code: doing the same thing by another route is the same act. Round 5 reads the script a command runs and judges its text; until then, the sessions this guard runs under are told to stop and say what was blocked rather than reach for a script, and they do.
- **Shell variables.** `x=push; git $x origin main` is not expanded by the guard. The same rule covers it, and round 5 closes it.
- **Anything set before the line.** The guard judges one line at a time. A variable, a function or an alias set outside the line it judges, by an earlier tool call or a file sourced earlier, still reaches the commands on it, the uploads read included: `LD_PRELOAD` exported two tool calls ago loads its code into the `cat` that reads an upload. That is the same class as a script file, and the same rule covers it.
- **A string run by a program the guard does not read yet.** `sh -c`, `bash -c`, `npx -c`, `npm exec -c` and `flock -c` are read as commands; `find -exec sh -c`, `script -c`, `watch`, `env -S`, `parallel` and `tmux new-session` run strings too and are not read yet. Nor is `$'...'` quoting, which the parser reads as a word beginning with `$`, so `bash -c $'git push origin main'` is not seen as the push it is; nor `git push --mirror`, which pushes every branch without naming one and so passes G07. Round 5 reads them, each with its cases.
- **Anything outside Bash and Agent calls.** Edits go through the permission lists in settings, which is where `.claude/`, `CLAUDE.md`, `.mcp.json` and `/opt/pw-browsers/` are denied to the Read and Edit tools.

The rule to add to your CLAUDE.md, as this repository's own session rule reads:

> If the guard blocks a command, say what was blocked and stop. Doing the same thing by another route (a script, another language, another tool) is the same as doing it directly, and is not allowed. This includes reads. There are two exceptions. If the guard blocked a command substitution or a line it couldn't read, you may redo the work as plain, separate commands, which the guard then judges one by one. If the guard's message names another way, such as opening the file with the Read tool, use that.

## Install

1. Copy `guard.js`, `subagent-guard.js` and the `lib/` folder into `.claude/hooks/` in your repository. `guard.js` requires `lib/judge.js` and `lib/config.js` relative to its own location. With `lib/` missing, or a rule file that throws when it loads, the hook blocks every command by itself (G17, exit 2); it does not depend on the settings to do that.
2. Write `.claude/guard.config.json`. Start from `configs/inventaris.json` and change the lists to fit your repository, following `configs/README.md`. Until the file exists and is valid, the hook blocks every command. Add `.claude/guard/` to `.gitignore`, so the decision log the hooks write there is never staged.
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
- `test/explain.test.ts` runs `bin/antaris-guard.js explain` on an allow, a deny, a shell string with inline code, a line that cannot be read, and a missing or invalid config, and checks that it names the log and never writes it.
- `test/log.test.ts` covers the decision log: the chain and its fixed field order, what `verify` finds (a changed line, a deleted line, an inserted line, a line cut short, the wrong version, a wrong first `prev`, a field the shape does not have), every break listed rather than the first, and a fork named as one, a tip found on any line holding and a missing one or one with a break before it failing, the summary's counts, the hooks logging every decision with the command's hash and never its text (a marker string is logged and must not appear in the file), a missing config logging nothing, logging off, a log that cannot be written blocking an allow and keeping a deny's reason, a log under a protected folder of the config's, the subagent hook in the same chain with its model and failing closed on its own, 64 hook processes appending at once with no two lines sharing a `prev`, the lock cleared after a dead holder and after going stale and the hook waiting out a live one, a stale lock removed only while it is still the one that was read, a writer releasing only its own lock, 64 hook processes starting from a lock a dead hook left, the `verify-log` and `log` commands, and the `.gitignore` line. Every table run also logs into its own temporary project, and `test/guard.test.ts` verifies that chain after the table.
- `test/r2.test.ts` runs round 2's table in `test/tables/r2.ts`: the new blocks (the length cap, `find -delete` past every wrapper and runner, the new wrappers reaching the rules that judge per command, an unclosed `$(` or backtick), the three blocks that became allows with the reason each row gives, the five blocks whose reason changed, the blocks that did not move (`$((1+2))`, a case statement inside `$( )`), and the lookalikes that stay allowed (escaped, single-quoted, commented, in a quoted heredoc).
- `test/r3.test.ts` runs round 3's table in `test/tables/r3.ts`: the new blocks (a protected name split by quotes or a backslash, on the line or inside a shell string), the blocks that became allows with the reason each row gives (commit, tag, pull request and issue message text in every spelling `git` and `gh` take, a heredoc that only feeds a message, a comment, a name glued to another word by a quote), the one block whose reason changed, the blocks that did not move (a pathspec, a `-F` file, a heredoc into `cat` or `tee`, a message option the round does not skip, a message inside a shell string), and the lookalikes that stay allowed. The uploads exemption is in the same table: a reading program or `cp` source reading a file under `~/.claude/uploads` is allowed, in every way of naming home, while a `..`, a redirection, a write into the folder, a `cp` that makes links, `file -C`, `rg`, `less` or `more`, an assignment, an `export`, `declare`, `set` or `source`, any other command on the same line, or any other `.claude` path still blocks.
- `test/timing/at-the-cap.test.ts` judges forty command shapes at a quarter of the length cap and at the cap, each size timed as the best of three runs, and fails if any takes longer than two seconds at the cap or grows faster than the line does between the two sizes. Each shape once took seconds or minutes, or is a cousin of one that did. `npm test` runs this file on its own after the rest of the suite (`npm run test:suite`, then `npm run test:timing`), never beside other files: timed next to the table files, which spawn a hook process per case, a 15 ms shape measured 163 ms on GitHub's runner. `test/syntax.test.ts` checks that every test file sits in one of the three folders the scripts name.
- `test/linear.test.ts` holds the six one-pass rewrites (G10, G05, docker-01, aws-cdk-01, the push predicate behind G06 and G07, and `inlineCodeOf`) against the code they replaced, over twenty thousand generated inputs each, and fails on the first input where the two disagree. Five are held against v0.1's own code; G05, whose match round 2 also narrowed to the start of a word, is held against the regex that states that match.
- `test/subagent-guard.test.ts` runs the subagent guard through its model, fork, isolation and nesting rules, the five-per-session count, and eight parallel calls (18 cases, in `test/tables/subagent.ts`).
- `test/rules/g18.test.ts` runs G18's own table, and checks that every block there carries G18's id and not some other rule's.
- `test/compare.test.ts` replays every case in every table through the frozen v0.1 hooks under `bench/versions/v0.1/` and the current ones, and requires the same decision and the same stderr line once the rule id is stripped. The only differences it accepts are the ones a round listed: G18's blocked cases (round 1) and rounds 2 and 3's blocked, loosened and reworded sides, and it requires each of them to be exactly the change the row claims. It also pins the frozen files' SHA-256.
- `test/load.test.ts` copies `guard.js` into a temp folder without `lib/`, with a rule file that throws when it loads, with a rule file that does not parse, with a `judge.js` of the wrong shape, with a `judge()` that throws, and with a throw on the next tick outside every `try`, and requires a G17 block with exit 2 from each; a whole copy with `lib/` must judge as the original does.
- `test/syntax.test.ts` runs `node --check` on every JavaScript file in the repository.
- `test/judge.test.ts` covers `judge()` as a library: the shape of a decision, G17 for a line the parser cannot read, for a rule that throws and for a missing or invalid config, the rule order, and that the G17 words spelled out in `guard.js` (which has to work without `lib/`) match `lib/rules/g17-unreadable.js`.

## What comes next

v0.2 keeps every behavior above and adds the parts a second repository needs to adopt the guard without editing code: a config file under `.claude/` (round 2), a decision log the session cannot edit (round 3), the `ask` tier (round 4), reading the script a command runs (round 5), rule packs for toolchains (round 6), a command line with `init`, `explain` and `check` (round 7), and a benchmark with a score per version (round 8). Rounds 1 (the split), 2 (the config) and 3 (the log) are done. The design is in [docs/SPEC.md](docs/SPEC.md) and the order of work in [docs/ROADMAP.md](docs/ROADMAP.md).

## Provenance

These files are the hooks running in [Inventaris](https://inventaris.live), an inventory and order system built at Antaris Analytics in Claude Code sessions, with every line reviewed before merge. They were published as they are there, from that repository's `main` at the commit this repository's first pull request names, so the test table is the one that gates changes to the live hook. That version, v0.1, is frozen byte for byte under `bench/versions/v0.1/`, and every round since is held against it.

MIT. Built by Jake Stanier, [Antaris Analytics LLC](https://antarisanalytics.ai).
