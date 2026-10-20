"use strict";
const { judgedOf } = require("../parse");

/* G13: a credential directory or file named in a command, by the config's credentialPaths list:
   ~/.aws, ~/.ssh, ~/.config, ~/.netrc, ~/.npmrc by default. Each entry is matched as a prefix, as
   v0.1 did, so ~/.aws covers ~/.aws/credentials, anywhere in a word.

   An entry that starts with ~/ names the home folder, and since the G02 PR it is matched however
   home is written: ~/, $HOME/, ${HOME}/, the home folder spelled out (the hook passes it as
   context.home; without it that form is not recognized), and ~ with a user name (~root/.aws).
   Any other entry is matched as it is written.

   Since the G02 PR the rule judges commands, not the line, as G16 has since R3: every word with
   the quotes and backslashes removed (so ~/.a"ws" is ~/.aws), shell strings included, plus the
   delimiter and body of every heredoc a command is given. Not judged: a # comment, and the message
   text G16 skips (git commit and git tag -m, a heredoc into -F -, the title and body of gh pr and
   gh issue), unless it holds a $( or a backtick. What it cannot see: a cd to home on the line,
   then a path relative to it (cd ~ && cat .aws/credentials). */
const escape = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

// Ways to write the home folder before the rest of a ~/ entry. A user name after ~ holds no slash,
// space or second ~, so the pattern never backtracks over more than one word's run of characters.
const HOME_FORMS = ["~[^/\\s~]*", "\\$HOME", "\\$\\{HOME\\}"];

/** One regex for every entry: a ~/ entry by any way of writing home, any other entry as it is written. */
function credentialPattern(paths, home) {
  const homes = [...HOME_FORMS];
  const spelled = typeof home === "string" ? home.replace(/\/+$/, "") : "";
  if (spelled) homes.push(escape(spelled));
  return new RegExp(paths.map((p) => (p.startsWith("~/") ? `(?:${homes.join("|")})/${escape(p.slice(2))}` : escape(p))).join("|"));
}

module.exports = {
  id: "G13",
  name: "credential-directory",
  tier: "deny",
  reason: "reading credential directories",
  test: ({ commands }, config, context = {}) => {
    if (config.credentialPaths.length === 0) return false;
    const pattern = credentialPattern(config.credentialPaths, context.home);
    return commands.some((words) => {
      const { words: judged, texts } = judgedOf(words);
      return judged.some((w) => pattern.test(w)) || texts.some((text) => pattern.test(text));
    });
  },
};
