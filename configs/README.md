# The config file

The guard reads one file, `.claude/guard.config.json` under the project root, and nowhere else. The
project root is `CLAUDE_PROJECT_DIR` when Claude Code sets it, else the `cwd` field of the tool
call the hook receives, else the hook process's working directory.

The file sits under `.claude/` on purpose: the session's shell cannot name that folder (G16) and
the settings deny the editing tools there, so the config has the same standing as the hooks. The
operator writes it; a session does not. A file at the project root would be one the session could
edit, which is a guard the session could loosen.

**No file falls back** (since round 4b; until then no file was a block). A folder with no
`.claude/guard.config.json` is judged by a fallback: the config `configs/<name>.json` in this
folder when the hook is started with `--fallback <name>`, else the built-in defaults in the table
below. A session with several repositories starts in a folder above them, where there is no file,
so under the plugin the fallback is what judges it. The cost: a file git removes without anyone
naming it (checking out an older commit) loosens the guard to the fallback instead of blocking.
Jake chose that trade for a guard against honest mistakes. A file the hook cannot read, a file
that is not JSON, and a file that fails validation still block every command, with the reason
saying what is wrong; so does a fallback name that is not lowercase words joined by hyphens, and a
fallback file that is not here.

`inventaris.json` in this folder is the worked example: the values v0.1 had hard-coded, for the
repository the test table was written for. The table runs under it. Copy it to
`.claude/guard.config.json` and edit, or write the file from the keys below. Validation is strict:
`version` is required, unknown keys fail (a `$comment` key included), and every list is a list of
non-empty strings with no whitespace in them.

`antaris-analytics.json` is Antaris Analytics' own config, and a fallback: the plugin edition
`antaris-guard-antaris-analytics` starts both hooks with `--fallback antaris-analytics`, so it
judges every folder of that organization's sessions that has no file of its own. It is the
defaults plus `aws` in `blockedPrograms`; `ANTHROPIC_API_KEY`, `PARSICLAUDE_TOKENS` and
`COGNITO_CLIENT_SECRET` in `secretEnv`; and `*.env` in `secretPaths`, with `python` and `pip`
allowed. A fallback is validated like any config file. A file here is read only when a hook names
it, so a repository's own file always wins over it.

| Key | Read by | Default | What it does |
| --- | --- | --- | --- |
| `version` | the loader | required, must be `1` | The shape of the file. A later shape gets a new number. |
| `operator` | G16 | none | The person who changes the session's own rules. Named in G16's reason: "changed by Jake, not by a session". Without it the reason says "the operator". |
| `protectedBranches` | G07 | `["main", "master"]` | Branches a session may not push to, by any way of naming them (`HEAD:main`, `:main`, `--delete origin main`, `refs/heads/main`, `+main`). Cannot be empty: G07 is never off. |
| `protectedPaths` | G16 | `[".claude/", "CLAUDE.md", ".mcp.json"]` | Names a shell command may not mention. The three defaults are always protected, whatever the list says; this list only adds. A name is matched whole, case-insensitive, in any word of any command (quotes removed) and in any heredoc a command is given; a comment and the message text of `git commit`, `git tag`, `gh pr` and `gh issue` are not judged, as the README says under G16. A trailing slash marks a folder and is not part of the match. One read is let through whatever the list says: a reading program, or `cp` with the path as a source, reading a file under the home uploads folder `~/.claude/uploads`. |
| `secretPaths` | G12 | `[".env", ".env.*", "*.pem", "*.key", "*.p12"]` | File names `cat`, `less`, `head`, `tail`, `grep` and `rg` may not read, as globs on the name alone (`*` is any run of characters, `?` is one). A pattern with a `/` in it is refused: it is a path, not a name. Cannot be empty. |
| `secretEnv` | G09 | `["AWS_SECRET_ACCESS_KEY", "AWS_SESSION_TOKEN", "DATABASE_URL", "GITHUB_TOKEN"]` | Environment variables that carry a secret; setting one on a command line is blocked. Each must be a variable name. Cannot be empty. |
| `credentialPaths` | G13 | `["~/.aws", "~/.ssh", "~/.config", "~/.netrc", "~/.npmrc"]` | Credential directories and files, matched as a prefix anywhere in the line, so `~/.aws` covers `~/.aws/credentials`. |
| `blockedPrograms` | G01 | `["sudo", "su", "curl", "wget", "ssh", "scp", "nc", "ncat", "telnet", "dd", "mkfs", "crontab", "eval", "base64", "xxd"]` | Programs that may not run, matched as a command anywhere in the line. The defaults leave `python`, `python3`, `pip` and `pip3` out because most repositories need them; `inventaris.json` adds them back. |
| `rules` | the judge | `{}` | A map of rule id to `"deny"`, `"ask"` or `"off"`. `"deny"` and `"ask"` set the rule's tier, in place of its default; `"off"` turns an optional rule off. A rule cannot be set to allow: off is the only way to stop it. The rules that are never off refuse `"off"` and `"ask"` both: G02, G06, G07, G09, G10, G12, G16, G17. The three pack rules (`aws-cdk-01`, `aws-cdk-02`, `docker-01`) refuse `"off"` until packs arrive, and accept `"ask"`. An id the guard does not have fails. A deny wins over an ask on the same line, whichever rule runs first. No rule asks by default: prompting is Claude Code's own settings' job, and `"ask"` is for an operator who wants one of the guard's rules to prompt instead of block. |
| `log` | both hooks | `{ "enabled": true, "path": ".claude/guard/log.jsonl" }` | The decision log. `enabled: false` writes nothing. `path` is relative to the project root and must sit under `.claude/` or under a folder that `protectedPaths` names (an entry ending in `/`): a log the session's shell can name is a log it can edit, so an absolute path, a path with `..` in it, a path at the project root or under any other folder fails validation, naming the path. The two keys are the only ones; anything else under `log` fails. |

Keys from the design that later versions read (`remotes`, `packs`, `scan`, `subagents`) fail
validation until the version that reads them lands, so a key the guard does not act on never looks
like a rule in force. `askPrograms` is not one of them: round 4 dropped it, since Claude Code's
own settings already ask about programs, and it fails as an unknown key.

## Seeing what the guard sees

```
node bin/antaris-guard.js explain "git status | tail -1"
```

prints the config file it read (or, with none, which fallback judged), where the log goes, the
commands on the line with their programs, the shell strings and inline code it lifted out, and the
decision with its rule and reason. It reads the config the way the hook does, from
`CLAUDE_PROJECT_DIR` or the working directory; `explain --fallback antaris-analytics "<command>"`
judges a folder with no file the way the organization's edition does. Exit 0
is allow or ask, exit 2 is deny, the same as the hook, and the decision line says which. `verify-log` and `log` read the same config to find
the log:

```
node bin/antaris-guard.js verify-log              # walks the chain, names every bad line and says when one looks like a fork
node bin/antaris-guard.js verify-log --tip <hash> # and names the line that carries that hash, or fails when none does
node bin/antaris-guard.js log                     # the tip, the size, and counts by decision, rule, day, session and tool
```
