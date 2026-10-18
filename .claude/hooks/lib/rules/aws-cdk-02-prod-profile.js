"use strict";

/* aws-cdk-02: the prod AWS profile, anywhere in the line. A pack rule: it moves to packs/aws-cdk
   in R6, where the profile names come from config, and keeps this id. */
module.exports = {
  id: "aws-cdk-02",
  name: "prod-profile",
  tier: "deny",
  reason: "the prod profile is never used from a session",
  test: ({ line }) => /--profile\s+inventaris-prod/.test(line),
};
