"use strict";

/* G16: any shell command naming .claude, CLAUDE.md or .mcp.json. The rule is broad on purpose so
   no write slips through; reading one with the Read tool is fine. The paths and the operator's
   name are hard-coded until R2 moves them to config. */
module.exports = {
  id: "G16",
  name: "protected-path",
  tier: "deny",
  reason: "the session's own rules (.claude/, CLAUDE.md, .mcp.json) are changed by Jake, not by a session. Shell commands can't touch them; to look at one, open it with the Read tool",
  test: ({ line }) => /(^|[^\w.-])\.claude\b|\bclaude(\.local)?\.md\b|(^|[^\w.-])\.mcp\.json\b/i.test(line),
};
