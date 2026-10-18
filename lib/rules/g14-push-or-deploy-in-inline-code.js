"use strict";

/* G14: a git push, or a cdk deploy or destroy, inside the code a command hands an interpreter on
   the line, however the code calls it (execSync, spawnSync, system, Bun.spawnSync). */

/** Inline code that runs a git push, or a cdk deploy or destroy, however it calls them. */
const pushOrDeployIn = (code) => /\bgit\b[\s\S]*\bpush\b/.test(code) || /\b(aws-)?cdk\b[\s\S]*\b(deploy|destroy)\b/.test(code);

module.exports = {
  id: "G14",
  name: "push-or-deploy-in-inline-code",
  tier: "deny",
  reason: "a git push or a cdk deploy or destroy inside inline code is still one; push with git on the command line, and sessions run cdk synth only",
  test: ({ inlineCode }) => inlineCode.some(pushOrDeployIn),
};
