# The config file

The guard reads one file, `.claude/guard.config.json` under the project root, and nowhere else. The
project root is `CLAUDE_PROJECT_DIR` when Claude Code sets it, else the `cwd` field of the tool
call the hook receives, else the hook process's working directory.

The file sits under `.claude/` on purpose: the session's shell cannot name that folder (G16) and
the settings deny the editing tools there, so the config has the same standing as the hooks. The
operator writes it; a session does not. A file at the project root would be one the session could
edit, which is a guard the session could loosen.

**No file is a block.** Every command is refused with `G17 unreadable: could not read the config:
<path> is missing; the operator writes it, following configs/README.md`. A file the hook cannot
read, a file that is not JSON, and a file that fails validation block every command the same way,
with the reason saying what is wrong. Absence is refusal: a file that git can remove without
anyone naming it (checking out an older commit) must not quietly loosen the guard.

`inventaris.json` in this folder is the worked example: the values v0.1 had hard-coded, for the
repository the test table was written for. The table runs under it. Copy it to
`.claude/guard.config.json` and edit, or write the file from the keys below. Validation is strict:
`version` is required, unknown keys fail (a `$comment` key included), and every list is a list of
non-empty strings with no whitespace in them.

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
| `rules` | the judge | `{}` | A map of rule id to `"deny"` or `"off"`. `"off"` turns an optional rule off; `"deny"` is the default and changes nothing this version. The rules that are never off refuse `"off"`: G02, G06, G07, G09, G10, G12, G16, G17. The three pack rules (`aws-cdk-01`, `aws-cdk-02`, `docker-01`) refuse it too until packs arrive. An id the guard does not have fails. `"ask"` fails; the ask tier is a later version. |
| `log` | both hooks | `{ "enabled": true, "path": ".claude/guard/log.jsonl" }` | The decision log. `enabled: false` writes nothing. `path` is relative to the project root and must sit under `.claude/` or under a folder that `protectedPaths` names (an entry ending in `/`): a log the session's shell can name is a log it can edit, so an absolute path, a path with `..` in it, a path at the project root or under any other folder fails validation, naming the path. The two keys are the only ones; anything else under `log` fails. |

Keys from the design that later versions read (`remotes`, `askPrograms`, `packs`, `scan`,
`subagents`) fail validation until the version that reads them lands, so a key the guard does not
act on never looks like a rule in force.

## Seeing what the guard sees

```
node bin/antaris-guard.js explain "git status | tail -1"
```

prints the config file it read, where the log goes, the commands on the line with their programs,
the shell strings and inline code it lifted out, and the decision with its rule and reason. It
reads the config the way the hook does, from `CLAUDE_PROJECT_DIR` or the working directory. Exit 0
is allow, exit 2 is deny, the same as the hook. `verify-log` and `log` read the same config to find
the log:

```
node bin/antaris-guard.js verify-log              # walks the chain, names every bad line and says when one looks like a fork
node bin/antaris-guard.js verify-log --tip <hash> # and names the line that carries that hash, or fails when none does
node bin/antaris-guard.js log                     # the tip, the size, and counts by decision, rule, day, session and tool
```
