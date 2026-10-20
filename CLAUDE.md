# Antaris-Guard

A fail-closed command guard for coding agents: two Claude Code hooks (`guard.js` for Bash,
`subagent-guard.js` for the Agent tool), the test table that gates them, and from v0.2 a judge
library, a config file, an Ask tier, a decision log, rule packs and a benchmark.
Built by Jake Stanier, Antaris Analytics LLC. MIT.

## Read first

- `docs/SPEC.md` is the design for v0.2: the architecture, the decision model, the config, the
  log, the rules and the benchmark. It wins over the code.
- `docs/ROADMAP.md` is the order of work, in rounds. Each round is one pull request with an exit
  test. Nothing from a later round starts early.
- `README.md` is what a user reads. It changes in the same pull request as the behavior it
  describes.

## Rules for every session

- Work on a branch and open a pull request. Never push to `main`.
- - Plan before you build, but ask only when it matters. Ask me, and stop, when a choice
  is hard to undo or touches what the server stores, who can see it, money or security.
  Everything else, housekeeping, file layout, names, defaults and the small behavioral
  calls that come up mid-build: take the option you would recommend and list it under
  "Calls made" in the PR, where I can change it at review. A question that could have
  been a "Calls made" line is a question too many.
- The guard fails closed. Every new path through the parser or a rule either reaches a decision
  or blocks. A throw is a block. A config the guard cannot read blocks everything. No change may
  turn a block into an allow without a test that says why.
- The test table never shrinks. A case removed or weakened needs Jake's yes in the PR, with the
  reason. A behavior change ships with the cases that prove it, blocked and allowed.
- No browser automation. No Playwright, Puppeteer, Chromium or any headless browser, installed,
  preinstalled or scripted. Checks are the tests and `node --check`; nothing here has a screen.
- No network in tests. The hooks have no dependencies at runtime, and the tests need nothing
  beyond Node and the test runner `package.json` pins.
- Never read, print, write or commit secrets. Test fixtures that look like secrets are assembled
  from parts, never pasted whole.
- Run `npm test` before opening a PR; say plainly what ran and what did not.
- Every PR says which rule ids it added or changed and which cases it added.
- Subagents: Sonnet for short, well-defined lookups; Opus only when a task needs wider reasoning,
  and say why. A few at a time, no forks, workflows or teams. Never try to get around a cap; if a
  task really needs more, stop and say so.
- Never change .claude/, CLAUDE.md or .mcp.json by any route: editor, shell, script or git. If a
  rule gets in your way, say so in the PR description and Jake will decide.
- If the guard blocks a command, say what was blocked and stop. Doing the same thing by another route (a script, another language, another tool) is the same as doing it directly, and is not allowed. This includes reads. There are two exceptions. If the guard blocked a command substitution or a line it couldn't read, you may redo the work as plain, separate commands, which the guard then judges one by one. If the guard's message names another way, such as opening the file with the Read tool, use that.
- Docs and every message the guard prints: plain and direct, no em dashes.

## Design philosophy

The guard's job is to let through what it understands, and nothing else.

- Judge commands, not lines. The shell's own grammar decides what a command is.
- Unreadable is refusal. A config that can't be read or isn't valid, a fallback that can't be read, a rule that throws: blocked. A missing config is judged by the defaults, or by the organization's config under its edition.
- Three answers, never two: allow, ask, deny. The operator decides the middle.
- The agent cannot edit its own record. The log is append-only and hash-chained, and it lives
  where the session's shell cannot reach it.
- Say why. Every decision names its rule and the reason in words a person acts on.
- Measure it. A rule that is not in the test table does not exist; a guard version that is not
  in the benchmark has no score.
