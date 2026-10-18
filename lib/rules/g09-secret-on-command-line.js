"use strict";

/* G09: a secret set on the command line, by the environment names that carry one. The names are
   hard-coded until R2 moves them to config. */
module.exports = {
  id: "G09",
  name: "secret-on-command-line",
  tier: "deny",
  reason: "setting a secret on the command line",
  test: ({ line }) => /\b(AWS_SECRET_ACCESS_KEY|AWS_SESSION_TOKEN|DATABASE_URL|COGNITO_CLIENT_SECRET|GITHUB_TOKEN)\s*=/.test(line),
};
