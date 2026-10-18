"use strict";

/* The core rules, in the order judge() runs them. The order is v0.1's, so a line that two rules
   would catch gets the reason v0.1 gave it, and G18 comes last so it only ever adds a block.
   G17 is here for its id and reasons; it has no test and judge() reaches for it directly. */
const RULES = [
  require("./g01-blocked-program"),
  require("./g02-recursive-delete"),
  require("./g03-delete-in-inline-code"),
  require("./g04-find-or-xargs-delete"),
  require("./g05-remove-item-recurse"),
  require("./g06-force-push"),
  require("./g07-push-to-protected"),
  require("./g08-destructive-git"),
  require("./g09-secret-on-command-line"),
  require("./g10-command-substitution"),
  require("./g11-pipe-into-interpreter"),
  require("./g12-reads-secret-file"),
  require("./g13-credential-directory"),
  require("./aws-cdk-01-cdk-deploy-or-destroy"),
  require("./g14-push-or-deploy-in-inline-code"),
  require("./aws-cdk-02-prod-profile"),
  require("./docker-01-docker-outside-postgres"),
  require("./g15-wide-chmod"),
  require("./g16-protected-path"),
  require("./g18-browser-automation"),
];

const UNREADABLE = require("./g17-unreadable");

/** Every rule with an id, G17 included, in id order for listings. */
const ALL = [...RULES, UNREADABLE].sort((a, b) => a.id.localeCompare(b.id, "en", { numeric: true }));

module.exports = { RULES, UNREADABLE, ALL };
