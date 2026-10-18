"use strict";
const { base } = require("../parse");

/* aws-cdk-01: cdk deploy or destroy, with cdk as a word anywhere in the command (run by npx, npm
   exec, pnpm, yarn, xargs or a path) and by any of its names (cdk, aws-cdk, with a version).
   Sessions run cdk synth only. A pack rule: it moves to packs/aws-cdk in R6 and keeps this id. */

/** cdk by any of its names: cdk, aws-cdk, with a version, or by path. */
const CDK = /^(aws-)?cdk(@[^/]*)?$/;

const cdkDeploys = (words) => words.some((w, at) => CDK.test(base(w)) && words.slice(at + 1).some((a) => a === "deploy" || a === "destroy"));

module.exports = {
  id: "aws-cdk-01",
  name: "cdk-deploy-or-destroy",
  tier: "deny",
  reason: "cdk deploy or destroy; sessions run cdk synth only",
  test: ({ commands }) => commands.some(cdkDeploys),
};
