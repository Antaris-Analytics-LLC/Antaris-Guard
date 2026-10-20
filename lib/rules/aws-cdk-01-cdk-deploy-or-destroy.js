"use strict";
const { base } = require("../parse");

/* aws-cdk-01: cdk deploy or destroy, with cdk as a word anywhere in the command (run by npx, npm
   exec, pnpm, yarn, xargs or a path) and by any of its names (cdk, aws-cdk, with a version).
   Sessions run cdk synth only. A pack rule: it moves to packs/aws-cdk in R6 and keeps this id. */

/** cdk by any of its names: cdk, aws-cdk, with a version, or by path. */
const CDK = /^(aws-)?cdk(@[^/]*)?$/;

/** A deploy or destroy word after a cdk word: true for some cdk word exactly when true for the first one, so one pass. */
const cdkDeploys = (words) => {
  const first = words.findIndex((w) => CDK.test(base(w)));
  if (first === -1) return false;
  for (let i = words.length - 1; i > first; i--) if (words[i] === "deploy" || words[i] === "destroy") return true;
  return false;
};

module.exports = {
  id: "aws-cdk-01",
  name: "cdk-deploy-or-destroy",
  tier: "deny",
  reason: "cdk deploy or destroy; sessions run cdk synth only",
  // What an ask says, when a config moves this rule to ask: the operator answers it, so it does not say what sessions may run.
  askReason: "cdk deploy or destroy",
  test: ({ commands }) => commands.some(cdkDeploys),
};
